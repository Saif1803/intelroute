import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { normalizeUrl, parsePattern, type RouteDefinition } from "@intelroute/core";

const PAGE_EXTENSIONS = ["tsx", "ts", "jsx", "js", "mdx", "md"];
const PAGES_ROUTER_SPECIAL = new Set(["_app", "_document", "_error", "404", "500"]);

export interface DiscoverOptions {
  /** Project root (default `process.cwd()`). */
  rootDir?: string;
  /** Override the App Router directory (default `app` or `src/app`). */
  appDir?: string;
  /** Override the Pages Router directory (default `pages` or `src/pages`). */
  pagesDir?: string;
  /** Prefix every route with the Next.js `basePath`. */
  basePath?: string;
}

export interface RouteManifest {
  generatedAt: string;
  routes: RouteDefinition[];
}

/**
 * Discover routes from a Next.js project's file system (App Router and
 * Pages Router), including titles and descriptions from static `metadata`
 * exports where present.
 */
export async function discoverRoutes(options: DiscoverOptions = {}): Promise<RouteDefinition[]> {
  const root = options.rootDir ?? process.cwd();
  const appDir = options.appDir ?? firstExisting(root, ["app", join("src", "app")]);
  const pagesDir = options.pagesDir ?? firstExisting(root, ["pages", join("src", "pages")]);

  const found = new Map<string, RouteDefinition>();
  if (appDir) for (const r of await discoverAppRouter(appDir)) found.set(r.path, r);
  if (pagesDir) for (const r of await discoverPagesRouter(pagesDir)) if (!found.has(r.path)) found.set(r.path, r);

  const base = options.basePath ? "/" + options.basePath.replace(/^\/|\/$/g, "") : "";
  return [...found.values()]
    .map((r) => (base ? { ...r, path: r.path === "/" ? base : base + r.path } : r))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function firstExisting(root: string, candidates: string[]): string | undefined {
  return candidates.map((c) => join(root, c)).find((p) => existsSync(p));
}

async function discoverAppRouter(appDir: string): Promise<RouteDefinition[]> {
  const routes: RouteDefinition[] = [];

  async function walk(dir: string, segments: string[]): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    const page = entries.find((e) => e.isFile() && isPageFile(e.name, "page"));
    if (page) {
      const meta = await readMetadata(join(dir, page.name));
      routes.push({ path: "/" + segments.join("/"), ...meta });
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const name = e.name;
      if (name.startsWith("_") || name === "node_modules") continue; // private folders
      if (/^\(\.{1,3}\)/.test(name)) continue; // intercepting routes duplicate real ones
      if (name === "api") continue;
      const isGroup = /^\(.*\)$/.test(name);
      const isSlot = name.startsWith("@");
      await walk(join(dir, name), isGroup || isSlot ? segments : [...segments, name]);
    }
  }

  await walk(appDir, []);
  return routes;
}

async function discoverPagesRouter(pagesDir: string): Promise<RouteDefinition[]> {
  const routes: RouteDefinition[] = [];

  async function walk(dir: string): Promise<void> {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (relative(pagesDir, full) === "api") continue;
        await walk(full);
        continue;
      }
      const m = /^(.*)\.([a-z]+)$/.exec(e.name);
      if (!m || !PAGE_EXTENSIONS.includes(m[2]!)) continue;
      const rel = relative(pagesDir, join(dir, m[1]!)).split(sep);
      if (rel.length === 1 && PAGES_ROUTER_SPECIAL.has(rel[0]!)) continue;
      if (rel[rel.length - 1] === "index") rel.pop();
      const meta = await readMetadata(full);
      routes.push({ path: "/" + rel.join("/"), ...meta });
    }
  }

  await walk(pagesDir);
  return routes;
}

function isPageFile(file: string, base: string): boolean {
  return PAGE_EXTENSIONS.some((ext) => file === `${base}.${ext}`);
}

/** Pull `title` and `description` from a static `export const metadata = {...}`. */
async function readMetadata(file: string): Promise<Pick<RouteDefinition, "title" | "description">> {
  let source: string;
  try {
    source = await readFile(file, "utf8");
  } catch {
    return {};
  }
  const block = /export\s+const\s+metadata[^=]*=\s*\{([\s\S]*?)\n\}/.exec(source)?.[1];
  if (!block) return {};
  const str = (key: string) =>
    new RegExp(`(?:^|[\\s,{])${key}\\s*:\\s*(["'\`])((?:\\\\.|(?!\\1).)*)\\1`).exec(block)?.[2];
  const title = str("title") ?? str("default");
  const description = str("description");
  return { ...(title ? { title } : {}), ...(description ? { description } : {}) };
}

/** Extract paths from a sitemap XML document (`<loc>` entries). */
export function parseSitemap(xml: string): string[] {
  const paths = new Set<string>();
  for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
    const loc = m[1]!.replace(/&amp;/g, "&");
    paths.add(normalizeUrl(loc, { caseSensitive: true, stripExtensions: [], indexNames: [] }).original);
  }
  return [...paths];
}

/**
 * Attach sitemap paths to the routes they belong to. Paths that match a
 * dynamic route become its `knownPaths` (IntelRoute then treats the sitemap
 * as the complete list of pages for that route); paths that match no route
 * are added as static routes.
 */
export function applySitemap(routes: RouteDefinition[], sitemapPaths: string[]): RouteDefinition[] {
  const result = routes.map((r) => ({ ...r }));
  const parsed = result.map((r) => ({ route: r, segments: parsePattern(r.path, { caseSensitive: true }) }));
  const exists = new Set(result.map((r) => r.path));

  for (const path of sitemapPaths) {
    if (exists.has(path)) continue;
    const segs = path.split("/").filter(Boolean);
    const owner = parsed.find(({ segments }) => matchesPattern(segs, segments));
    if (owner) {
      if (owner.segments.every((s) => s.kind === "static")) continue;
      owner.route.knownPaths = [...new Set([...(owner.route.knownPaths ?? []), path])];
    } else {
      result.push({ path });
      exists.add(path);
    }
  }
  return result;
}

function matchesPattern(segs: string[], pattern: ReturnType<typeof parsePattern>): boolean {
  let i = 0;
  for (const seg of pattern) {
    if (seg.kind === "optionalCatchAll") return true;
    if (seg.kind === "catchAll") return i < segs.length;
    const value = segs[i];
    if (value === undefined) return false;
    if (seg.kind === "static" && value !== seg.literal) return false;
    i++;
  }
  return i === segs.length;
}

/**
 * Merge freshly discovered routes with an existing manifest, keeping fields a
 * developer added by hand (titles, keywords, aliases, priorities...).
 */
export function mergeManifest(discovered: RouteDefinition[], existing?: RouteManifest): RouteDefinition[] {
  if (!existing) return discovered;
  const previous = new Map(existing.routes.map((r) => [r.path, r]));
  return discovered.map((r) => {
    const prev = previous.get(r.path);
    if (!prev) return r;
    return { ...prev, ...r, title: prev.title ?? r.title, description: prev.description ?? r.description };
  });
}
