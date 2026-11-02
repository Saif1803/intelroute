import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applySitemap, discoverRoutes, mergeManifest, parseSitemap } from "../src/discover.js";

let root: string;

async function file(rel: string, content = "export default function Page() { return null }\n") {
  const full = join(root, rel);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content);
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "intelroute-"));
  await file("app/page.tsx");
  await file(
    "app/about/page.tsx",
    `export const metadata = {\n  title: "About us",\n  description: 'Who we are, and why.',\n};\nexport default function P() { return null }\n`,
  );
  await file("app/(marketing)/pricing/page.tsx");
  await file("app/blog/[slug]/page.tsx");
  await file("app/docs/[...parts]/page.mdx");
  await file("app/@modal/(.)photo/[id]/page.tsx");
  await file("app/_components/page.tsx");
  await file("app/dashboard/layout.tsx");
  await file("app/dashboard/@analytics/page.tsx");
  await file("app/api/users/route.ts", "export function GET() {}");
  await file("pages/legacy/index.tsx");
  await file("pages/legacy/[id].jsx");
  await file("pages/_app.tsx");
  await file("pages/api/hello.ts");
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("discoverRoutes", () => {
  it("finds App Router and Pages Router routes", async () => {
    const routes = await discoverRoutes({ rootDir: root });
    expect(routes.map((r) => r.path)).toEqual([
      "/",
      "/about",
      "/blog/[slug]",
      "/dashboard",
      "/docs/[...parts]",
      "/legacy",
      "/legacy/[id]",
      "/pricing",
    ]);
    expect(routes.find((r) => r.path === "/about")).toMatchObject({
      title: "About us",
      description: "Who we are, and why.",
    });
  });

  it("applies basePath", async () => {
    const routes = await discoverRoutes({ rootDir: root, basePath: "/shop/" });
    expect(routes.map((r) => r.path)).toContain("/shop/about");
    expect(routes.map((r) => r.path)).toContain("/shop");
  });
});

describe("sitemaps and merging", () => {
  it("turns sitemap URLs into known paths and extra routes", () => {
    const xml = `<?xml version="1.0"?><urlset>
      <url><loc>https://example.com/blog/hello-world</loc></url>
      <url><loc> https://example.com/blog/second-post </loc></url>
      <url><loc>https://example.com/about</loc></url>
      <url><loc>https://example.com/landing/spring-sale</loc></url>
    </urlset>`;
    const paths = parseSitemap(xml);
    expect(paths).toEqual(["/blog/hello-world", "/blog/second-post", "/about", "/landing/spring-sale"]);
    const routes = applySitemap([{ path: "/about" }, { path: "/blog/[slug]" }], paths);
    expect(routes).toEqual([
      { path: "/about" },
      { path: "/blog/[slug]", knownPaths: ["/blog/hello-world", "/blog/second-post"] },
      { path: "/landing/spring-sale" },
    ]);
  });

  it("keeps hand-edited fields when regenerating", () => {
    const merged = mergeManifest([{ path: "/about", title: "About" }, { path: "/new" }], {
      generatedAt: "",
      routes: [{ path: "/about", title: "About Acme", keywords: ["team"], aliases: ["/company"] }, { path: "/gone" }],
    });
    expect(merged).toEqual([
      { path: "/about", title: "About Acme", keywords: ["team"], aliases: ["/company"] },
      { path: "/new" },
    ]);
  });
});
