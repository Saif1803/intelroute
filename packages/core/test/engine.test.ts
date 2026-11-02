import { describe, expect, it } from "vitest";
import { createIntelRoute, MemoryAnalytics, type JudgeResult } from "../src/index.js";
import { FakeJudge, routes } from "./fixtures.js";

const deterministic = () => createIntelRoute({ routes, cache: false });

describe("pass-through", () => {
  it.each(["/", "/about", "/blog/hello-world", "/docs/a/b/c", "/products/AbC-123", "/about/"])(
    "%s exists",
    async (path) => {
      const d = await deterministic().resolve(path);
      expect(d.action).toBe("pass");
    },
  );

  it.each(["/_next/static/chunk.js", "/api/users", "/logo.png", "/favicon.ico"])("%s is excluded", async (path) => {
    const d = await deterministic().resolve(path);
    expect(d.action).toBe("pass");
    expect(d.reason).toBe("excluded");
  });

  it("treats unknown values of routes with knownPaths as missing", async () => {
    const d = await deterministic().resolve("/blog/helo-world");
    expect(d.action).toBe("redirect");
    expect(d.destination).toBe("/blog/hello-world");
  });
});

describe("deterministic recovery", () => {
  it.each([
    ["/About", "/about", "normalized"],
    ["/pricing.html", "/pricing", "normalized"],
    ["/Blog/Hello_World/", "/blog/hello-world", "normalized"],
    ["/abuot", "/about", "fuzzy"],
    ["/pricng", "/pricing", "fuzzy"],
    ["/conatct", "/contact", "fuzzy"],
    ["/blog/nextjs-routing-guid", "/blog/nextjs-routing-guide", "fuzzy"],
    ["/blgo/my-first-post", "/blog/my-first-post", "fuzzy"],
    ["/accounts/setings", "/account/settings", "fuzzy"],
    ["/signin", "/login", "fuzzy"],
    ["/jobs-at-acme", "/careers", "alias"],
  ])("%s -> %s (%s)", async (path, destination, stage) => {
    const d = await deterministic().resolve(path);
    expect(d.action, d.reason).toBe("redirect");
    expect(d.destination).toBe(destination);
    expect(d.stage).toBe(stage);
  });

  it("drops redundant segments", async () => {
    const d = await deterministic().resolve("/en/blog/hello-world");
    expect(d.action, d.reason).toBe("redirect");
    expect(d.destination).toBe("/blog/hello-world");
  });

  it("tolerates noise segments like locales and dates", async () => {
    const d = await deterministic().resolve("/blog/2023/05/hello-world");
    expect(d.action, d.reason).toBe("redirect");
    expect(d.destination).toBe("/blog/hello-world");
  });

  it("does not redirect a deleted child page to its parent", async () => {
    const d = await deterministic().resolve("/blog/some-deleted-article");
    expect(d.action, d.reason).not.toBe("redirect");
  });

  it("fills dynamic parameters when correcting a static segment", async () => {
    const d = await deterministic().resolve("/prodcts/xyz-42");
    expect(d.action, d.reason).toBe("redirect");
    expect(d.destination).toBe("/products/xyz-42");
  });

  it("preserves the query string", async () => {
    const d = await deterministic().resolve("/pricng?plan=pro&ref=ad");
    expect(d.destination).toBe("/pricing?plan=pro&ref=ad");
    expect((await deterministic().resolve("/Pricing.html?ref=ad")).destination).toBe("/pricing?ref=ad");
    expect((await deterministic().resolve("/jobs-at-acme?x=1")).destination).toBe("/careers?x=1");
  });

  it("can drop the query string", async () => {
    const ir = createIntelRoute({ routes, cache: false, preserveQuery: false });
    expect((await ir.resolve("/pricng?plan=pro")).destination).toBe("/pricing");
  });

  it("applies explicit redirect rules with parameters", async () => {
    const ir = createIntelRoute({ routes, cache: false, redirects: { "/articles/[slug]": "/blog/[slug]" } });
    const d = await ir.resolve("/articles/hello-world");
    expect(d).toMatchObject({ action: "redirect", destination: "/blog/hello-world", stage: "redirectMap" });
  });

  it("only suggests when meaning matches but structure does not", async () => {
    const d = await deterministic().resolve("/forgot-password");
    expect(d.action, d.reason).toBe("suggest");
    expect(d.suggestions[0]?.path).toBe("/account/password-reset");
  });

  it("suggests instead of redirecting when two candidates are equally likely", async () => {
    const d = await deterministic().resolve("/help/bill");
    expect(["suggest", "redirect"]).toContain(d.action);
    const amb = await createIntelRoute({
      routes: [{ path: "/colour" }, { path: "/colours" }, { path: "/color-guide" }],
      cache: false,
    }).resolve("/colourz");
    expect(amb.action, amb.reason).toBe("suggest");
    expect(amb.suggestions.length).toBeGreaterThan(1);
  });

  it("keeps the 404 when nothing is close", async () => {
    for (const path of ["/wp-admin/setup-config", "/xyzzy", "/completely/unrelated/thing"]) {
      const d = await deterministic().resolve(path);
      expect(d.action, `${path}: ${d.reason}`).toBe("not_found");
    }
  });

  it("downgrades redirects to suggestions when autoRedirect is off", async () => {
    const ir = createIntelRoute({ routes, cache: false, autoRedirect: false });
    const d = await ir.resolve("/abuot");
    expect(d.action).toBe("suggest");
    expect(d.suggestions[0]?.path).toBe("/about");
  });
});

describe("AI judge", () => {
  const judgeResult = (choice: string | null, p: number, match: number): JudgeResult => ({
    choice,
    confidence: p,
    matchProbability: match,
    probabilities: choice ? { [choice]: p } : {},
  });

  it("is not consulted when the deterministic match is certain", async () => {
    const judge = new FakeJudge(() => judgeResult(null, 0, 0));
    const ir = createIntelRoute({ routes, judge, cache: false });
    expect((await ir.resolve("/pricng")).action).toBe("redirect");
    expect(judge.calls).toHaveLength(0);
  });

  it("redirects on a confident judgment for an ambiguous request", async () => {
    const judge = new FakeJudge(() => judgeResult("/account/password-reset", 0.95, 0.97));
    const ir = createIntelRoute({ routes, judge, cache: false, siteContext: "SaaS app" });
    const d = await ir.resolve("/forgot-password", { referrer: "https://google.com" });
    expect(d).toMatchObject({ action: "redirect", destination: "/account/password-reset", stage: "judge", judged: true });
    expect(judge.calls[0]?.candidates.map((c) => c.path)).toContain("/account/password-reset");
    expect(judge.calls[0]?.referrer).toBe("https://google.com");
    expect(judge.calls[0]?.siteContext).toBe("SaaS app");
  });

  it("suggests when the judge is unsure which candidate", async () => {
    const judge = new FakeJudge((req) => ({
      choice: req.candidates[0]!.path,
      confidence: 0.5,
      matchProbability: 0.9,
      probabilities: Object.fromEntries(req.candidates.map((c, i) => [c.path, i === 0 ? 0.5 : i === 1 ? 0.4 : 0.1 / req.candidates.length])),
    }));
    const ir = createIntelRoute({ routes, judge, cache: false });
    const d = await ir.resolve("/forgot-password");
    expect(d.action).toBe("suggest");
    expect(d.suggestions.length).toBe(2);
  });

  it("keeps the 404 when the judge says nothing matches", async () => {
    const judge = new FakeJudge((req) => judgeResult(req.candidates[0]!.path, 0.6, 0.1));
    const ir = createIntelRoute({ routes, judge, cache: false });
    expect((await ir.resolve("/forgot-password")).action).toBe("not_found");
  });

  it("falls back to deterministic suggestions when the judge fails", async () => {
    const judge = new FakeJudge(() => {
      throw new Error("timeout");
    });
    const ir = createIntelRoute({ routes, judge, cache: false });
    const d = await ir.resolve("/forgot-password");
    expect(d.action).toBe("suggest");
    expect(d.reason).toContain("judge failed");
  });
});

describe("caching and analytics", () => {
  it("serves repeated requests from cache and dedupes concurrent ones", async () => {
    const judge = new FakeJudge(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return { choice: "/account/password-reset", confidence: 0.95, matchProbability: 0.95, probabilities: {} };
    });
    const ir = createIntelRoute({ routes, judge });
    const [a, b] = await Promise.all([ir.resolve("/forgot-password"), ir.resolve("/forgot-password?x=1")]);
    expect(judge.calls).toHaveLength(1);
    expect(a.destination).toBe("/account/password-reset");
    expect(b.destination).toBe("/account/password-reset?x=1");
    const c = await ir.resolve("/Forgot-Password/");
    expect(c.cached).toBe(true);
    expect(judge.calls).toHaveLength(1);
  });

  it("invalidates the cache when routes change", async () => {
    const ir = createIntelRoute({ routes });
    expect((await ir.resolve("/abuot")).destination).toBe("/about");
    ir.updateRoutes([...routes.filter((r) => r.path !== "/about"), { path: "/about-us", title: "About us" }]);
    const d = await ir.resolve("/abuot");
    expect(d.cached).toBe(false);
    expect(d.suggestions[0]?.path).toBe("/about-us");
  });

  it("tracks recoveries, unresolved paths and accuracy", async () => {
    const analytics = new MemoryAnalytics();
    const ir = createIntelRoute({ routes, analytics });
    await ir.resolve("/about"); // exact matches are not failed requests
    await ir.resolve("/abuot");
    await ir.resolve("/abuot?utm_source=x");
    await ir.resolve("/xyzzy");
    await ir.resolve("/forgot-password");
    ir.recordFeedback("/abuot", "/about", true);
    ir.recordFeedback("/forgot-password", "/account/password-reset", false);

    const s = analytics.summary();
    expect(s.failedRequests).toBe(4);
    expect(s.redirected).toBe(2);
    expect(s.suggested).toBe(1);
    expect(s.unresolved).toBe(1);
    expect(s.cacheHits).toBe(1);
    expect(s.recoveryRate).toBeCloseTo(0.75);
    expect(s.accuracy).toBe(0.5);
    expect(s.topUnresolved).toEqual([{ path: "/xyzzy", count: 1 }]);
    expect(s.topRecovered[0]).toEqual({ from: "/abuot", to: "/about", count: 2 });
  });
});
