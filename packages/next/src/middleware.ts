import { createIntelRoute, type IntelRoute, type IntelRouteConfig, type RoutingDecision } from "@intelroute/core";
// The `.js` extensions are required: `next` has no `exports` map, so plain
// Node ESM can't resolve "next/server" (bundlers resolve either form).
import { NextResponse, type NextRequest } from "next/server.js";
import { encodeDecisionHeaders, HEADER_PREFIX } from "./headers.js";

export interface IntelRouteMiddlewareOptions {
  /**
   * Called with every non-pass decision, after it is applied. Useful for
   * logging; analytics sinks configured on the engine already receive events.
   */
  onDecision?: (decision: RoutingDecision, request: NextRequest) => void;
  /** Called when the engine throws. The request always proceeds untouched. */
  onError?: (error: unknown, request: NextRequest) => void;
  /** Only handle these HTTP methods (default GET and HEAD). */
  methods?: string[];
}

/**
 * Create a Next.js middleware (Next 14/15 `middleware.ts`) or proxy
 * (Next 16+ `proxy.ts`) handler.
 *
 * - Existing routes pass straight through.
 * - Confident recoveries become redirects.
 * - Suggestions and unresolved requests continue to the app's not-found
 *   page, with the decision attached as request headers so the page can show
 *   "Did you mean…?" links (see `getIntelRouteSuggestions`).
 */
export function createIntelRouteMiddleware(
  engineOrConfig: IntelRoute | IntelRouteConfig,
  options: IntelRouteMiddlewareOptions = {},
) {
  // Duck-typed rather than `instanceof`: hot reloads and duplicate installs
  // of @intelroute/core produce engines from a different class instance.
  const engine = isEngine(engineOrConfig) ? engineOrConfig : createIntelRoute(engineOrConfig);
  const methods = (options.methods ?? ["GET", "HEAD"]).map((m) => m.toUpperCase());

  return async function intelRouteMiddleware(request: NextRequest): Promise<NextResponse> {
    if (!methods.includes(request.method.toUpperCase())) return passThrough(request);

    const { pathname, search } = request.nextUrl;
    let decision: RoutingDecision;
    try {
      decision = await engine.resolve(pathname + search, {
        referrer: request.headers.get("referer") ?? undefined,
        userAgent: request.headers.get("user-agent") ?? undefined,
        signal: request.signal,
      });
    } catch (error) {
      options.onError?.(error, request);
      return passThrough(request);
    }

    if (decision.action === "pass") return passThrough(request);
    options.onDecision?.(decision, request);

    if (decision.action === "redirect" && decision.destination) {
      const url = new URL(decision.destination, request.nextUrl.origin);
      // Only ever redirect within the same origin unless the developer configured an absolute URL.
      const res = NextResponse.redirect(url, engine.redirectStatus);
      res.headers.set("x-intelroute-from", encodeURIComponent(pathname));
      res.headers.set("x-intelroute-stage", decision.stage ?? "");
      return res;
    }

    const headers = withoutIntelRouteHeaders(request.headers);
    for (const [k, v] of Object.entries(encodeDecisionHeaders(decision))) headers.set(k, v);
    return NextResponse.next({ request: { headers } });
  };
}

function isEngine(value: IntelRoute | IntelRouteConfig): value is IntelRoute {
  return typeof (value as IntelRoute).resolve === "function";
}

/**
 * Continue the request, removing any client-supplied `x-intelroute-*`
 * headers so visitors cannot inject suggestions into the not-found page.
 */
function passThrough(request: NextRequest): NextResponse {
  const spoofed = [...request.headers.keys()].some((k) => k.startsWith(HEADER_PREFIX));
  return spoofed ? NextResponse.next({ request: { headers: withoutIntelRouteHeaders(request.headers) } }) : NextResponse.next();
}

function withoutIntelRouteHeaders(source: Headers): Headers {
  const headers = new Headers(source);
  for (const key of [...headers.keys()]) if (key.startsWith(HEADER_PREFIX)) headers.delete(key);
  return headers;
}
