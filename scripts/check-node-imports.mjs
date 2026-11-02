// Import every published entry point in plain Node ESM (no bundler).
// Vitest and Next.js resolve imports more leniently than Node, so a bad
// import like "next/server" (without .js) passes the tests but breaks users.
// Run after `npm run build`.
import { readFile } from "node:fs/promises";

const packages = ["packages/core", "packages/next"];
let failed = false;

for (const dir of packages) {
  const pkg = JSON.parse(await readFile(new URL(`../${dir}/package.json`, import.meta.url), "utf8"));
  for (const subpath of Object.keys(pkg.exports)) {
    const specifier = subpath === "." ? pkg.name : `${pkg.name}/${subpath.slice(2)}`;
    try {
      await import(specifier);
      console.log(`ok   ${specifier}`);
    } catch (error) {
      failed = true;
      console.error(`FAIL ${specifier}\n     ${error.message}`);
    }
  }
}

process.exit(failed ? 1 : 0);
