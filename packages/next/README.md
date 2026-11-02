# @intelroute/next

Next.js integration for [IntelRoute](https://github.com/Saif1803/intelroute): automatic recovery of mistyped and outdated URLs.

```
/abuot                 → 307 /about
/blgo/helo-world       → 307 /blog/hello-world
/forgot-password       → 404 + "Did you mean: Reset your password?"
/wp-admin              → 404 (untouched)
```

It's fully deterministic: no AI service, API key or network call. It works with Next.js 14 and later (`middleware.ts`, or `proxy.ts` on Next 16+).

```bash
npm install @intelroute/next
npx intelroute discover --sitemap public/sitemap.xml
```

Then add the proxy and a `not-found` page. The [quick start in the main README](https://github.com/Saif1803/intelroute#quick-start-nextjs) walks through all five steps.

## What's included

- `createIntelRouteMiddleware`: the proxy/middleware handler
- `getIntelRouteSuggestions` (from `@intelroute/next/server`): "Did you mean…?" links for `app/not-found.tsx`
- `intelroute discover`: a CLI that builds your route list from `app/`, `pages/` and your sitemap
- `createAnalyticsHandlers`: an optional endpoint for recovery stats and visitor feedback

## License

MIT
