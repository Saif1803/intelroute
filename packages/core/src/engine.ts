import { MemoryCache } from "./cache.js";
import { findCandidates } from "./matcher.js";
import { normalizeUrl, splitUrl } from "./normalize.js";
import { buildPath, matchSegments, parsePattern, RouteIndex, type ParsedSegment } from "./routes.js";
import { DEFAULT_SYNONYMS, SynonymTable } from "./similarity.js";
import type {
  AnalyticsSink,
  CacheStore,
  Candidate,
  Judge,
  JudgeResult,
  MatchStage,
  NormalizedUrl,
  RouteDefinition,
  RoutingDecision,
  SemanticProvider,
  Suggestion,
} from "./types.js";

export interface Thresholds {
  /** Minimum confidence for an automatic redirect (default 0.85). */
  redirect: number;
  /** Minimum confidence to offer suggestions (default 0.5). */
  suggest: number;
  /** Candidates scoring below this are not worth judging; the request stays a 404 (default 0.3). */
  judgeFloor: number;
  /** Minimum lead the top candidate needs over the runner-up to redirect without the judge (default 0.08). */
  minMargin: number;
}

export interface IntelRouteConfig {
  /** Routes the application serves. */
  routes: RouteDefinition[];
  thresholds?: Partial<Thresholds>;
  /** Optional AI judge for ambiguous requests (any `Judge` implementation). Omit or pass false to run deterministically. */
  judge?: Judge | false;
  /** Number of candidates sent to the judge (default 8). */
  judgeCandidates?: number;
  /** Maximum suggestions returned (default 3). */
  maxSuggestions?: number;
  /** What to do when the judge fails or times out (default `suggest`). */
  onJudgeError?: "suggest" | "not_found";
  /** Paths IntelRoute never touches. Strings support a trailing `*` wildcard. Added to the defaults. */
  exclude?: Array<string | RegExp>;
  /** Replace the default exclusions instead of extending them. */
  replaceDefaultExclusions?: boolean;
  /** Explicit redirects, e.g. `{ "/old-blog/[slug]": "/blog/[slug]" }`. Checked before fuzzy matching. */
  redirects?: Record<string, string>;
  /** Redirect automatically when confident (default true). When false, redirects become suggestions. */
  autoRedirect?: boolean;
  /** HTTP status for redirects (default 307: a guess should not be cached forever by browsers). */
  redirectStatus?: 301 | 302 | 307 | 308;
  /** Carry the query string over to the destination (default true). */
  preserveQuery?: boolean;
  caseSensitive?: boolean;
  trailingSlash?: boolean;
  stripExtensions?: string[];
  indexNames?: string[];
  /** Extra synonym groups, e.g. `[["kb", "knowledge-base", "help"]]`. */
  synonyms?: string[][];
  replaceDefaultSynonyms?: boolean;
  /** Optional embedding-based similarity provider. */
  semantic?: SemanticProvider;
  /** Decision cache (default in-memory LRU). Pass false to disable. */
  cache?: CacheStore | false;
  /** TTL for recovered decisions (default 1 hour). */
  cacheTtlMs?: number;
  /** TTL for unresolved decisions (default 10 minutes). */
  negativeCacheTtlMs?: number;
  analytics?: AnalyticsSink | AnalyticsSink[];
  /** One sentence about the site, given to the judge as context. */
  siteContext?: string;
  /** Inspect or override any decision before it is returned. */
  onDecision?: (decision: RoutingDecision) => RoutingDecision | void;
}

export interface ResolveContext {
  referrer?: string;
  userAgent?: string;
  signal?: AbortSignal;
}

const DEFAULT_THRESHOLDS: Thresholds = { redirect: 0.85, suggest: 0.5, judgeFloor: 0.3, minMargin: 0.08 };

export const DEFAULT_EXCLUSIONS: Array<string | RegExp> = [
  "/_next/*",
  "/api/*",
  "/.well-known/*",
  "/favicon.ico",
  "/robots.txt",
  "/sitemap.xml",
  /\.(?:png|jpe?g|gif|webp|avif|svg|ico|css|js|mjs|map|json|txt|xml|woff2?|ttf|otf|eot|mp4|webm|mp3|wav|pdf|zip|wasm)$/i,
];

type CompiledRedirect = { from: ParsedSegment[]; to: string; toSegments: ParsedSegment[] | null };

export class IntelRoute {
  readonly config: IntelRouteConfig;
  private index: RouteIndex;
  private readonly thresholds: Thresholds;
  private readonly synonyms: SynonymTable;
  private readonly cache: CacheStore | null;
  private readonly sinks: AnalyticsSink[];
  private readonly exclusions: Array<(path: string) => boolean>;
  private readonly redirects: CompiledRedirect[];
  private readonly inflight = new Map<string, Promise<RoutingDecision>>();

  constructor(config: IntelRouteConfig) {
    this.config = config;
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...config.thresholds };
    this.index = this.buildIndex(config.routes);
    this.synonyms = new SynonymTable([
      ...(config.replaceDefaultSynonyms ? [] : DEFAULT_SYNONYMS),
      ...(config.synonyms ?? []),
    ]);
    this.cache = config.cache === false ? null : (config.cache ?? new MemoryCache());
    this.sinks = config.analytics ? (Array.isArray(config.analytics) ? config.analytics : [config.analytics]) : [];
    this.exclusions = [...(config.replaceDefaultExclusions ? [] : DEFAULT_EXCLUSIONS), ...(config.exclude ?? [])].map(
      compileExclusion,
    );
    this.redirects = Object.entries(config.redirects ?? {}).map(([from, to]) => ({
      from: parsePattern(from, this.normalizeOptions),
      to,
      toSegments: /^[a-z][a-z0-9+.-]*:/i.test(to) ? null : parsePattern(to),
    }));
  }

  private get normalizeOptions() {
    const { caseSensitive, stripExtensions, indexNames, trailingSlash } = this.config;
    return { caseSensitive, stripExtensions, indexNames, trailingSlash };
  }

  private buildIndex(routes: RouteDefinition[]): RouteIndex {
    return new RouteIndex(routes, this.normalizeOptions);
  }

  /** Replace the route table (e.g. after a deploy or sitemap refresh). Cached decisions are invalidated by version. */
  updateRoutes(routes: RouteDefinition[]): void {
    this.config.routes = routes;
    this.index = this.buildIndex(routes);
  }

  get routeIndex(): RouteIndex {
    return this.index;
  }

  get redirectStatus(): number {
    return this.config.redirectStatus ?? 307;
  }

  isExcluded(path: string): boolean {
    return this.exclusions.some((test) => test(path));
  }

  /** True if the application serves this exact path. */
  isKnownRoute(path: string): boolean {
    return this.index.matchLiteral(splitUrl(path).path) !== null;
  }

  /**
   * Decide what to do with a request: pass it through, redirect it,
   * suggest alternatives, or leave it as a 404.
   */
  async resolve(url: string, ctx: ResolveContext = {}): Promise<RoutingDecision> {
    const started = now();
    const normalized = normalizeUrl(url, this.normalizeOptions);
    const raw = normalized.original;

    if (this.isExcluded(raw)) return this.finish(this.decision(raw, "pass", started, { reason: "excluded" }), ctx, false);
    if (this.index.matchLiteral(raw)) return this.finish(this.decision(raw, "pass", started, { reason: "route exists" }), ctx, false);

    const quick = this.resolveDeterministic(normalized, started);
    if (quick) {
      return this.finish({ ...quick, destination: quick.destination && this.withQuery(quick.destination, normalized) }, ctx);
    }

    const key = `${this.index.version}:${normalized.path}`;
    if (this.cache) {
      const hit = await this.cache.get(key);
      if (hit) {
        return this.finish(
          { ...hit, requestedPath: raw, cached: true, durationMs: now() - started, destination: hit.destination && this.withQuery(hit.destination, normalized) },
          ctx,
        );
      }
    }

    let pending = this.inflight.get(key);
    if (!pending) {
      pending = this.recover(normalized, ctx, started).finally(() => this.inflight.delete(key));
      this.inflight.set(key, pending);
    }
    const decision = await pending;

    if (this.cache) {
      const ttl = decision.action === "not_found" ? (this.config.negativeCacheTtlMs ?? 600_000) : (this.config.cacheTtlMs ?? 3_600_000);
      await this.cache.set(key, decision, ttl);
    }
    return this.finish(
      { ...decision, requestedPath: raw, destination: decision.destination && this.withQuery(decision.destination, normalized) },
      ctx,
    );
  }

  /** Record whether a visitor accepted a redirect or suggestion (powers the accuracy metric). */
  recordFeedback(requestedPath: string, destination: string, accepted: boolean): void {
    this.emit({ type: "feedback", timestamp: Date.now(), requestedPath, destination, accepted });
  }

  /** Normalization, aliases and explicit redirects: certain answers that need no scoring. */
  private resolveDeterministic(url: NormalizedUrl, started: number): RoutingDecision | null {
    const exact = this.index.matchNormalized(url.segments);
    if (exact) {
      if (exact.target === url.original) return this.decision(url.original, "pass", started, { reason: "route exists" });
      return this.redirectTo(url, exact.target, exact.route.definition.title, started, "normalized", "URL differs from a route only by formatting");
    }

    for (const r of this.redirects) {
      const params = matchSegments(url.segments, r.from, (value, seg) => value === seg.value);
      if (!params) continue;
      const target = r.toSegments ? buildPath(r.toSegments, params, this.config.trailingSlash) : r.to;
      if (target) return this.redirectTo(url, target, undefined, started, "redirectMap", "explicit redirect rule");
    }

    const alias = this.index.matchAlias(url.path);
    if (alias) {
      const target = this.index.staticTarget(alias);
      if (target) return this.redirectTo(url, target, alias.definition.title, started, "alias", "route alias");
    }
    return null;
  }

  private redirectTo(url: NormalizedUrl, target: string, title: string | undefined, started: number, stage: MatchStage, reason: string) {
    return this.decision(url.original, "redirect", started, {
      destination: target,
      confidence: 1,
      stage,
      suggestions: [{ path: target, title, confidence: 1 }],
      reason,
    });
  }

  /** Fuzzy/semantic candidate search, then the judge for anything ambiguous. */
  private async recover(url: NormalizedUrl, ctx: ResolveContext, started: number): Promise<RoutingDecision> {
    const t = this.thresholds;
    const maxSuggestions = this.config.maxSuggestions ?? 3;
    const candidates = await findCandidates(url, this.index, {
      synonyms: this.synonyms,
      semantic: this.config.semantic,
      maxCandidates: Math.max(this.config.judgeCandidates ?? 8, maxSuggestions),
      trailingSlash: this.config.trailingSlash,
    });
    const plausible = candidates.filter((c) => c.score >= t.judgeFloor);
    const top = plausible[0];
    if (!top) {
      return this.decision(url.original, "not_found", started, { reason: "no plausible candidates" });
    }

    const margin = top.score - (plausible[1]?.score ?? 0);
    const certain = top.score >= t.redirect && margin >= t.minMargin && top.signals.structural >= t.redirect;
    const deterministicSuggestions = () =>
      plausible
        .filter((c) => c.score >= t.suggest)
        .slice(0, maxSuggestions)
        .map((c) => toSuggestion(c, c.score));

    if (certain) {
      return this.decision(url.original, "redirect", started, {
        destination: top.target,
        confidence: top.score,
        stage: top.stage,
        suggestions: deterministicSuggestions(),
        reason: `deterministic match (score ${top.score.toFixed(2)}, margin ${margin.toFixed(2)})`,
      });
    }

    const judge = this.config.judge || null;
    if (judge) {
      const judged = plausible.slice(0, this.config.judgeCandidates ?? 8);
      let result: JudgeResult | null = null;
      let error: unknown;
      try {
        result = await judge.judge(
          {
            requestedPath: url.original,
            normalizedPath: url.path,
            candidates: judged.map((c) => ({
              path: c.target,
              title: c.route.definition.title,
              description: c.route.definition.description,
              score: c.score,
            })),
            referrer: ctx.referrer,
            siteContext: this.config.siteContext,
          },
          ctx.signal,
        );
      } catch (e) {
        error = e;
      }

      if (result) return this.decideFromJudge(url, judged, result, started, judge.name);

      const message = error instanceof Error ? error.message : String(error);
      if (this.config.onJudgeError === "not_found") {
        return this.decision(url.original, "not_found", started, { judged: true, reason: `judge failed: ${message}` });
      }
      const suggestions = deterministicSuggestions();
      return this.decision(url.original, suggestions.length ? "suggest" : "not_found", started, {
        confidence: suggestions[0]?.confidence ?? 0,
        stage: top.stage,
        suggestions,
        judged: true,
        reason: `judge failed (${message}); fell back to deterministic suggestions`,
      });
    }

    const suggestions = deterministicSuggestions();
    return this.decision(url.original, suggestions.length ? "suggest" : "not_found", started, {
      confidence: suggestions[0]?.confidence ?? top.score,
      stage: top.stage,
      suggestions,
      reason: suggestions.length
        ? `ambiguous deterministic match (score ${top.score.toFixed(2)}, margin ${margin.toFixed(2)})`
        : `best candidate below suggest threshold (score ${top.score.toFixed(2)})`,
    });
  }

  private decideFromJudge(
    url: NormalizedUrl,
    judged: Candidate[],
    result: JudgeResult,
    started: number,
    judgeName: string,
  ): RoutingDecision {
    const t = this.thresholds;
    const maxSuggestions = this.config.maxSuggestions ?? 3;
    const confidence = result.choice ? result.matchProbability * result.confidence : 0;
    const suggestions = judged
      .map((c) => toSuggestion(c, result.matchProbability * (result.probabilities[c.target] ?? 0)))
      .filter((s) => s.confidence >= 0.05)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, maxSuggestions);
    const detail = `${judgeName}: match ${result.matchProbability.toFixed(2)}, choice ${result.choice ?? "none"} p=${result.confidence.toFixed(2)}`;

    if (result.choice && confidence >= t.redirect) {
      return this.decision(url.original, "redirect", started, {
        destination: result.choice,
        confidence,
        stage: "judge",
        suggestions,
        judged: true,
        reason: detail,
      });
    }
    if (result.matchProbability >= t.suggest && suggestions.length) {
      return this.decision(url.original, "suggest", started, {
        confidence,
        stage: "judge",
        suggestions,
        judged: true,
        reason: detail,
      });
    }
    return this.decision(url.original, "not_found", started, { confidence, stage: "judge", judged: true, reason: detail });
  }

  private decision(
    requestedPath: string,
    action: RoutingDecision["action"],
    started: number,
    extra: Partial<RoutingDecision> = {},
  ): RoutingDecision {
    return {
      action,
      requestedPath,
      confidence: action === "pass" ? 1 : 0,
      suggestions: [],
      cached: false,
      judged: false,
      reason: "",
      durationMs: now() - started,
      ...extra,
    };
  }

  private finish(decision: RoutingDecision, ctx: ResolveContext, record = true): RoutingDecision {
    let d = decision;
    if (d.action === "redirect" && this.config.autoRedirect === false) {
      d = { ...d, action: "suggest", destination: undefined, reason: `${d.reason} (auto-redirect disabled)` };
    }
    if (d.action === "redirect" && d.destination && samePath(d.destination, d.requestedPath)) {
      d = { ...d, action: "not_found", destination: undefined, reason: "destination equals request" };
    }
    d = this.config.onDecision?.(d) ?? d;
    if (record) this.emit({ type: "decision", timestamp: Date.now(), decision: d, referrer: ctx.referrer, userAgent: ctx.userAgent });
    return d;
  }

  private emit(event: Parameters<AnalyticsSink["record"]>[0]): void {
    for (const sink of this.sinks) {
      try {
        const r = sink.record(event);
        if (r && typeof (r as Promise<void>).catch === "function") (r as Promise<void>).catch(() => {});
      } catch {
        // Analytics must never break routing.
      }
    }
  }

  private withQuery(destination: string, url: NormalizedUrl): string {
    if (this.config.preserveQuery === false || !url.search || destination.includes("?")) return destination;
    return destination + url.search;
  }
}

function toSuggestion(c: Candidate, confidence: number): Suggestion {
  return { path: c.target, title: c.route.definition.title, confidence };
}

function samePath(a: string, b: string): boolean {
  const strip = (p: string) => p.split(/[?#]/)[0]!.replace(/\/+$/, "") || "/";
  return strip(a) === strip(b);
}

function compileExclusion(rule: string | RegExp): (path: string) => boolean {
  if (rule instanceof RegExp) return (p) => rule.test(p);
  if (rule.endsWith("*")) {
    const prefix = rule.slice(0, -1);
    const bare = prefix.replace(/\/$/, "");
    return (p) => p.startsWith(prefix) || p === bare;
  }
  return (p) => p === rule;
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** Create an IntelRoute engine. */
export function createIntelRoute(config: IntelRouteConfig): IntelRoute {
  return new IntelRoute(config);
}
