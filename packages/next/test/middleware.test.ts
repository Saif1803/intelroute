import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { createIntelRoute, MemoryAnalytics } from "@intelroute/core";
import { createAnalyticsHandlers } from "../src/analytics-handler.js";
import { decodeDecisionHeaders, HEADER_ACTION, HEADER_SUGGESTIONS } from "../src/headers.js";
import { createIntelRouteMiddleware } from "../src/middleware.js";

const routes = [
  { path: "/", title: "Home" },
  { path: "/about", title: "About us" },
  { path: "/pricing", title: "Pricing" },
  { path: "/account/password-reset", title: "Reset your password", keywords: ["forgot password"] },
];

const req = (path: string, init?: ConstructorParameters<typeof NextRequest>[1]) =>
  new NextRequest(new URL(path, "https://example.com"), init);

/** Request headers forwarded by `NextResponse.next({ request: { headers } })`. */
function forwardedHeaders(res: Response): Headers {
  const out = new Headers();
  const names = res.headers.get("x-middleware-override-headers")?.split(",") ?? [];
  for (const name of names) {
    const value = res.headers.get(`x-middleware-request-${name}`);
    if (value !== null) out.set(name, value);
  }
  return out;
}

describe("createIntelRouteMiddleware", () => {
  const middleware = createIntelRouteMiddleware({ routes, cache: false });

  it("passes existing routes through", async () => {
    const res = await middleware(req("/about"));
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(res.headers.get("location")).toBeNull();
  });

  it("redirects confident recoveries, keeping the query string", async () => {
    const res = await middleware(req("/pricng?plan=pro"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://example.com/pricing?plan=pro");
    expect(res.headers.get("x-intelroute-stage")).toBe("fuzzy");
  });

  it("forwards suggestions to the not-found page as request headers", async () => {
    const res = await middleware(req("/forgot-password"));
    expect(res.headers.get("location")).toBeNull();
    const info = decodeDecisionHeaders(forwardedHeaders(res));
    expect(info.action).toBe("suggest");
    expect(info.requestedPath).toBe("/forgot-password");
    expect(info.suggestions[0]?.path).toBe("/account/password-reset");
  });

  it("strips spoofed intelroute headers from clients", async () => {
    const spoofed = encodeURIComponent(JSON.stringify([{ path: "/evil" }]));
    const res = await middleware(req("/about", { headers: { [HEADER_ACTION]: "suggest", [HEADER_SUGGESTIONS]: spoofed } }));
    const forwarded = forwardedHeaders(res);
    expect(forwarded.get(HEADER_SUGGESTIONS)).toBeNull();
    expect(res.headers.get("x-middleware-override-headers")).not.toContain(HEADER_SUGGESTIONS);
  });

  it("ignores non-GET requests", async () => {
    const res = await middleware(req("/pricng", { method: "POST" }));
    expect(res.headers.get("location")).toBeNull();
  });

  it("never breaks the request when the engine throws", async () => {
    const errors: unknown[] = [];
    const broken = createIntelRouteMiddleware(
      { routes, cache: false, onDecision: () => { throw new Error("boom"); } },
      { onError: (e) => errors.push(e) },
    );
    const res = await broken(req("/pricng"));
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(errors).toHaveLength(1);
  });
});

describe("decodeDecisionHeaders", () => {
  it("rejects malformed or off-site suggestions", () => {
    const h = new Headers({
      [HEADER_SUGGESTIONS]: encodeURIComponent(JSON.stringify([{ path: "//evil.com" }, { path: "https://x" }, { path: "/ok" }])),
    });
    expect(decodeDecisionHeaders(h).suggestions).toEqual([{ path: "/ok" }]);
    expect(decodeDecisionHeaders(new Headers({ [HEADER_SUGGESTIONS]: "%%%" })).suggestions).toEqual([]);
  });
});

describe("createAnalyticsHandlers", () => {
  it("serves the summary and records feedback, with optional auth", async () => {
    const analytics = new MemoryAnalytics();
    const engine = createIntelRoute({ routes, analytics });
    const { GET, POST } = createAnalyticsHandlers(engine, analytics, { token: "secret" });
    await engine.resolve("/abuot");

    expect((await GET(new Request("https://x/api/intelroute"))).status).toBe(401);
    const auth = { authorization: "Bearer secret" };
    const post = await POST(
      new Request("https://x/api/intelroute", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ requestedPath: "/abuot", destination: "/about", accepted: true }),
      }),
    );
    expect(post.status).toBe(200);
    const summary = await (await GET(new Request("https://x/api/intelroute", { headers: auth }))).json();
    expect(summary.redirected).toBe(1);
    expect(summary.accuracy).toBe(1);
  });
});
