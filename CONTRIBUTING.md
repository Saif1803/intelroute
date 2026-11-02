# Contributing to IntelRoute

Thanks for helping. The most useful contribution is often the simplest: a URL that IntelRoute got wrong.

## Reporting a wrong decision

If IntelRoute redirected somewhere it shouldn't have, missed an obvious recovery, or suggested the wrong pages, [open a "Wrong decision" issue](https://github.com/saif1803/intelroute/issues/new?template=wrong-decision.yml). Include:

- the requested URL
- what IntelRoute did (the `reason` field of the decision helps a lot)
- what you expected
- the routes involved (the relevant entries from `intelroute.routes.json`)

Each report becomes a test case, so the fix stays fixed.

## Development setup

You need Node.js 20 or later.

```bash
git clone https://github.com/saif1803/intelroute.git
cd intelroute
npm install
npm run build
npm test
```

| Command | What it does |
| --- | --- |
| `npm test` | Runs every package's tests with Vitest. |
| `npm run build` | Builds `@intelroute/core`, then `@intelroute/next`. |
| `npm run typecheck` | Type-checks both packages. |
| `npm run dev -w intelroute-example-next` | Starts the demo site on http://localhost:3100. |

## Project layout

```
packages/core     framework-independent engine (no dependencies)
  src/normalize.ts   URL cleanup: case, slashes, extensions, encoding
  src/routes.ts      route patterns and the route index
  src/similarity.ts  typo, token and synonym similarity
  src/matcher.ts     candidate scoring (structural + lexical + semantic)
  src/engine.ts      the decision pipeline, cache and judge
packages/next     Next.js proxy/middleware, not-found helper, discovery CLI
examples/next-app demo site
```

## Fixing matching behavior

1. Add the failing case to `packages/core/test/engine.test.ts`. The shared route table is in `packages/core/test/fixtures.ts`; add a route there if your case needs one.
2. Run `npm test` and confirm it fails for the reason you expect. `decision.reason` shows the score and margin.
3. Make the smallest change that fixes it, and check that every existing case still passes.

Please keep these design rules intact. Pull requests that break them won't be merged:

- **Structure is evidence, wildcards are not.** A `[slug]` segment accepts anything, so it must never make an unrelated URL look like a match.
- **Meaning alone never redirects.** Word overlap and synonyms can produce suggestions, but not automatic redirects.
- **Ambiguity becomes suggestions.** When two candidates are close, don't pick one.
- **Failures are safe.** If anything throws, the request continues untouched.
- **Core stays dependency-free** and must run in Node, edge runtimes and browsers.

## Pull requests

- Keep each pull request to one change, with tests.
- Run `npm run typecheck && npm test` before pushing. CI runs the same checks.
- If your change affects a published package, add a changeset:

  ```bash
  npx changeset
  ```

  Pick the packages you changed and the bump type (`patch` for fixes, `minor` for features while we're on 0.x), and write one line for the changelog. Docs-only and test-only changes don't need one.

## Security issues

Don't open a public issue for security problems, such as a way to make IntelRoute redirect to another site. See [SECURITY.md](SECURITY.md).

## Code of conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md). By taking part, you agree to it.
