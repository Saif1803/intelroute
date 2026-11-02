#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { applySitemap, discoverRoutes, mergeManifest, parseSitemap, type RouteManifest } from "./discover.js";

const HELP = `Usage: intelroute discover [options]

Scan a Next.js project for routes and write an IntelRoute manifest.

Options:
  --root <dir>        Project root (default: current directory)
  --out <file>        Output file (default: intelroute.routes.json)
  --sitemap <src>     Sitemap file path or URL; its paths become known paths of dynamic routes
  --base-path <path>  Next.js basePath to prefix routes with
  --no-merge          Overwrite the manifest instead of keeping hand-edited fields
  -h, --help          Show this help
`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      root: { type: "string" },
      out: { type: "string" },
      sitemap: { type: "string" },
      "base-path": { type: "string" },
      "no-merge": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help || positionals[0] !== "discover") {
    process.stdout.write(HELP);
    process.exit(values.help ? 0 : 1);
  }

  const root = resolve(values.root ?? ".");
  const out = resolve(root, values.out ?? "intelroute.routes.json");

  let routes = await discoverRoutes({ rootDir: root, basePath: values["base-path"] });

  if (values.sitemap) {
    const src = values.sitemap;
    const xml = /^https?:\/\//.test(src) ? await (await fetch(src)).text() : await readFile(resolve(root, src), "utf8");
    routes = applySitemap(routes, parseSitemap(xml));
  }

  if (!values["no-merge"] && existsSync(out)) {
    const existing = JSON.parse(await readFile(out, "utf8")) as RouteManifest;
    routes = mergeManifest(routes, existing);
  }

  const manifest: RouteManifest = { generatedAt: new Date().toISOString(), routes };
  await writeFile(out, JSON.stringify(manifest, null, 2) + "\n");
  process.stdout.write(`IntelRoute: wrote ${routes.length} routes to ${out}\n`);
}

main().catch((err) => {
  process.stderr.write(`IntelRoute: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
