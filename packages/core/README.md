# @intelroute/core

The framework-independent engine behind [IntelRoute](https://github.com/saif1803/intelroute). Give it the URL of a request that didn't match a route, and it decides whether to redirect, suggest pages, or leave the 404 alone.

No dependencies, no network calls, no AI. It runs in Node, edge runtimes and browsers.

```bash
npm install @intelroute/core
```

```ts
import { createIntelRoute } from "@intelroute/core";

const engine = createIntelRoute({
  routes: [
    { path: "/about", title: "About us" },
    { path: "/pricing", title: "Pricing and plans" },
    { path: "/blog/[slug]", title: "Blog post", knownPaths: ["/blog/hello-world"] },
  ],
});

const d = await engine.resolve("/abuot");
// d.action === "redirect", d.destination === "/about"
```

In a server, that becomes a few lines of adapter code:

```ts
const d = await engine.resolve(req.url, { referrer: req.headers.referer });
if (d.action === "redirect") return res.redirect(engine.redirectStatus, d.destination!);
// "suggest" / "not_found": render your 404 with d.suggestions
```

Using Next.js? Install [`@intelroute/next`](https://www.npmjs.com/package/@intelroute/next) instead, which wraps this engine in a proxy/middleware.

See the [main README](https://github.com/saif1803/intelroute#readme) for how decisions are made and every configuration option.

## License

MIT
