# IntelRoute

[![CI](https://github.com/Saif1803/intelroute/actions/workflows/ci.yml/badge.svg)](https://github.com/Saif1803/intelroute/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@intelroute/next)](https://www.npmjs.com/package/@intelroute/next)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Intelligent URL recovery and routing. When a request doesn't match a route, IntelRoute works out where the visitor meant to go. If it's confident, it redirects; if a few pages are plausible, it suggests them; and if nothing fits, it leaves the normal 404 alone.

```
/abuot                         → 307 /about
/Pricing.html?ref=ad           → 307 /pricing?ref=ad
/sign-in                       → 307 /login
/blgo/helo-world               → 307 /blog/hello-world
/en/blog/2023/routing-guide    → 307 /blog/routing-guide
/forgot-password               → 404 + "Did you mean: Reset your password?"
/wp-admin                      → 404 (untouched)
```

## Packages

| Package | What it is |
| --- | --- |
| [`@intelroute/core`](packages/core) | Framework-independent engine. No dependencies; runs in Node, edge runtimes and browsers. |
| [`@intelroute/next`](packages/next) | Next.js integration: proxy/middleware, `not-found` suggestions, route discovery CLI, analytics endpoint. |
| [`examples/next-app`](examples/next-app) | A Next.js 16 demo site wired up end to end. |

## How a request is decided

```
request ──► excluded? (/_next, /api, assets…) ─────────────────► pass
        ──► route exists literally? ───────────────────────────► pass
        ──► normalized match? (case, slashes, .html, encoding…) ─► redirect (confidence 1)
        ──► explicit redirect rule / route alias? ──────────────► redirect (confidence 1)
        ──► cache hit? ─────────────────────────────────────────► cached decision
        ──► candidate scoring
              structural: segment alignment with typo similarity,
                          extra/missing/redundant segments, dynamic params
              lexical:    word coverage with stemming and synonyms
              semantic:   optional embedding provider
        ──► certain? (high structural score + clear margin) ────► redirect
        ──► best score ≥ suggest threshold ─────────────────────► suggest (404 + links)
        ──► otherwise ──────────────────────────────────────────► not_found (plain 404)
```

Everything is deterministic: no AI service, API key or network call is involved.

Design rules:

- **Structure is evidence, wildcards are not.** A `[slug]` segment accepts anything, so it never makes an unrelated URL look like a match.
- **Meaning alone never redirects.** Word overlap (for example `/forgot-password` against "Reset your password") is capped below the redirect threshold, so it can only produce suggestions.
- **Ambiguity becomes suggestions.** When two candidates are close, IntelRoute doesn't pick one.
- **Redirects are 307 by default.** A guess shouldn't be cached forever by browsers. Use 308 once you trust it.
- **Failures are safe.** If the engine throws, the request continues untouched.

## Quick start (Next.js)

```bash
npm install @intelroute/next
```

**1. Discover your routes.** This scans `app/` and `pages/`, reads `metadata` titles and descriptions, and can pull known slugs from a sitemap:

```bash
npx intelroute discover --sitemap public/sitemap.xml
```

This writes `intelroute.routes.json`. You can hand-edit it to add `keywords`, `aliases` and `priority`; re-running discovery keeps your edits.

**2. Create the engine** (`lib/intelroute.ts`):

```ts
import { createIntelRoute, MemoryAnalytics } from "@intelroute/next";
import manifest from "../intelroute.routes.json";

export const analytics = new MemoryAnalytics();
export const engine = createIntelRoute({ routes: manifest.routes, analytics });
```

**3. Add the proxy** (`proxy.ts` on Next 16+, `middleware.ts` on Next 14/15 with `export const middleware`):

```ts
import { createIntelRouteMiddleware } from "@intelroute/next";
import { engine } from "./lib/intelroute";

export const proxy = createIntelRouteMiddleware(engine);
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
```

**4. Show suggestions** in `app/not-found.tsx`:

```tsx
import { getIntelRouteSuggestions } from "@intelroute/next/server";

export default async function NotFound() {
  const { requestedPath, suggestions } = await getIntelRouteSuggestions();
  return (
    <main>
      <h1>Page not found</h1>
      {suggestions.map((s) => <a key={s.path} href={s.path}>{s.title ?? s.path}</a>)}
    </main>
  );
}
```

**5. Optional: analytics endpoint** (`app/api/intelroute/route.ts`):

```ts
import { createAnalyticsHandlers } from "@intelroute/next";
import { analytics, engine } from "@/lib/intelroute";

const h = createAnalyticsHandlers(engine, analytics, { token: process.env.INTELROUTE_ANALYTICS_TOKEN });
export const GET = h.GET;   // summary (token-protected)
export const POST = h.POST; // { requestedPath, destination, accepted } feedback
```

## Optional: plugging in an AI judge

No AI is included. To have an AI decide ambiguous cases, pass any object that implements `Judge` as the `judge` option:

```ts
judge(request) → Promise<{ choice, confidence, matchProbability, probabilities }>
```

It is only called when deterministic matching is ambiguous. Its confidence is `matchProbability × confidence`, compared against the redirect threshold. If it throws or times out, IntelRoute falls back to deterministic suggestions.

## Configuration

| Option | Default | |
| --- | --- | --- |
| `routes` | — | `{ path, title?, description?, keywords?, aliases?, knownPaths?, priority? }[]`. Paths support `[param]`, `[...rest]`, `[[...opt]]`, `:param`. |
| `thresholds.redirect` | `0.85` | Minimum confidence to redirect automatically. |
| `thresholds.suggest` | `0.5` | Minimum confidence (or judge match probability) to suggest. |
| `thresholds.judgeFloor` | `0.3` | Candidates below this aren't worth judging. |
| `thresholds.minMargin` | `0.08` | Lead the top candidate needs to redirect without the judge. |
| `judge` | none | Any `Judge` implementation (see above). |
| `judgeCandidates` / `maxSuggestions` | `8` / `3` | |
| `onJudgeError` | `"suggest"` | Or `"not_found"`. |
| `autoRedirect` | `true` | `false` turns every redirect into a suggestion (observe mode). |
| `redirectStatus` | `307` | `301`, `302`, `307` or `308`. |
| `preserveQuery` | `true` | |
| `redirects` | `{}` | Explicit rules, with params: `{ "/articles/[slug]": "/blog/[slug]" }`. |
| `exclude` | `/_next/*`, `/api/*`, assets… | Strings (trailing `*`) or RegExps, added to the defaults (`replaceDefaultExclusions` to replace). |
| `synonyms` | built-in groups | Extra groups such as `[["kb", "knowledge-base"]]`; `replaceDefaultSynonyms` to replace. |
| `semantic` | none | `SemanticProvider` for embedding similarity. |
| `cache` | in-memory LRU | Any `CacheStore` (e.g. Redis), or `false`. |
| `cacheTtlMs` / `negativeCacheTtlMs` | 1 h / 10 min | |
| `analytics` | none | One or more `AnalyticsSink`s. |
| `caseSensitive`, `trailingSlash`, `stripExtensions`, `indexNames` | | Normalization. |
| `siteContext` | none | One sentence about the site, given to the judge. |
| `onDecision` | none | Inspect or override any decision. |

### Known paths

When a dynamic route lists `knownPaths` (from a sitemap or `generateStaticParams`), IntelRoute treats that list as the complete set of pages for the route. `/blog/helo-world` is then recovered to `/blog/hello-world` instead of passing through to a 404. Only use this when the list really is complete.

## Analytics

`MemoryAnalytics.summary()` reports:

- failed requests, redirected, suggested and unresolved counts
- recovery rate
- judge calls, cache hits and average latency
- counts per match stage
- accuracy, from feedback
- top unresolved and top recovered URLs

It holds data per process, so on serverless or multi-instance deployments implement `AnalyticsSink.record(event)` to forward events to your own storage.

## Other frameworks

The core takes a URL and returns a decision, so an adapter is a few lines:

```ts
const d = await engine.resolve(req.url, { referrer: req.headers.referer });
if (d.action === "redirect") return res.redirect(engine.redirectStatus, d.destination!);
// "suggest" / "not_found": render your 404 with d.suggestions
```

## Development

```bash
npm install
npm test            # vitest, all packages
npm run build       # core, then next
npm run typecheck
npm run dev -w intelroute-example-next   # demo on http://localhost:3100
```

## Contributing

Found a URL IntelRoute got wrong? [Open a "Wrong decision" issue](https://github.com/Saif1803/intelroute/issues/new?template=wrong-decision.yml); each one becomes a test case. For code changes, see [CONTRIBUTING.md](CONTRIBUTING.md). Please report security issues privately, as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
