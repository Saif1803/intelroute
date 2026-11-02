/**
 * A route the application can serve.
 *
 * `path` may be a concrete path (`/about`) or a pattern. Supported pattern
 * syntaxes: Next.js style (`/blog/[slug]`, `/docs/[...parts]`,
 * `/shop/[[...filters]]`) and colon style (`/users/:id`).
 */
export interface RouteDefinition {
  path: string;
  /** Human-readable page title; improves semantic matching and AI judgment. */
  title?: string;
  /** Short description of the page's content. */
  description?: string;
  /** Extra words people might use to look for this page. */
  keywords?: string[];
  /** Old or alternative paths that should resolve to this route. */
  aliases?: string[];
  /**
   * Known concrete values for a dynamic route (for example from a sitemap or
   * `generateStaticParams`). When present, the route only "exists" for these
   * paths, and mistyped values can be recovered against them.
   */
  knownPaths?: string[];
  /** Relative importance (default 1). Breaks ties between similar candidates. */
  priority?: number;
}

export type SegmentKind = "static" | "dynamic" | "catchAll" | "optionalCatchAll";

export interface RouteSegment {
  kind: SegmentKind;
  /** Normalized literal for static segments, parameter name otherwise. */
  value: string;
}

export interface IndexedRoute {
  id: string;
  definition: RouteDefinition;
  /** Canonical path as declared by the developer (pattern syntax normalized to `[param]`). */
  pattern: string;
  segments: RouteSegment[];
  isDynamic: boolean;
  /** Words describing the route: path tokens, title, description, keywords. */
  tokens: string[];
  knownPaths: string[];
}

export interface NormalizedUrl {
  /** The path exactly as received (without query or hash). */
  original: string;
  /** Canonical comparison form: decoded, lowercased, cleaned. */
  path: string;
  segments: string[];
  /** Query string including the leading `?`, or an empty string. */
  search: string;
  hash: string;
}

export type MatchStage =
  | "exact"
  | "normalized"
  | "alias"
  | "redirectMap"
  | "fuzzy"
  | "semantic"
  | "judge";

export interface Candidate {
  route: IndexedRoute;
  /** Concrete destination path (dynamic params filled in where possible). */
  target: string;
  /** Combined deterministic score, 0..1. */
  score: number;
  signals: {
    structural: number;
    lexical: number;
    semantic?: number;
  };
  stage: MatchStage;
}

export type DecisionAction = "pass" | "redirect" | "suggest" | "not_found";

export interface Suggestion {
  path: string;
  title?: string;
  confidence: number;
}

export interface RoutingDecision {
  action: DecisionAction;
  /** Requested path (as received). */
  requestedPath: string;
  /** Redirect destination including preserved query string, for `redirect`. */
  destination?: string;
  /** Overall confidence in `destination` (or in the top suggestion). */
  confidence: number;
  stage?: MatchStage;
  suggestions: Suggestion[];
  /** Whether this decision was served from cache. */
  cached: boolean;
  /** Whether the AI judge was consulted. */
  judged: boolean;
  /** Human-readable explanation, for debugging and analytics. */
  reason: string;
  durationMs: number;
}

/** Input given to an AI judge when deterministic matching is ambiguous. */
export interface JudgeRequest {
  requestedPath: string;
  normalizedPath: string;
  candidates: Array<{
    path: string;
    title?: string;
    description?: string;
    score: number;
  }>;
  referrer?: string;
  siteContext?: string;
}

export interface JudgeResult {
  /** Path of the chosen candidate, or null if the judge chose none. */
  choice: string | null;
  /** Probability that the choice is what the visitor intended, 0..1. */
  confidence: number;
  /** Probability that any candidate matches at all, 0..1. */
  matchProbability: number;
  /** Per-candidate probabilities, keyed by path. */
  probabilities: Record<string, number>;
  model?: string;
}

export interface Judge {
  readonly name: string;
  judge(request: JudgeRequest, signal?: AbortSignal): Promise<JudgeResult>;
}

/**
 * Optional embedding-backed similarity. Return one score in 0..1 per
 * candidate text, in the same order.
 */
export interface SemanticProvider {
  similarity(query: string, candidates: string[]): Promise<number[]>;
}

export interface CacheStore {
  get(key: string): Promise<RoutingDecision | undefined> | RoutingDecision | undefined;
  set(key: string, value: RoutingDecision, ttlMs: number): Promise<void> | void;
  clear?(): Promise<void> | void;
}

export interface RoutingEvent {
  type: "decision";
  timestamp: number;
  decision: RoutingDecision;
  referrer?: string;
  userAgent?: string;
}

export interface FeedbackEvent {
  type: "feedback";
  timestamp: number;
  requestedPath: string;
  destination: string;
  /** True if the visitor stayed on / chose the destination, false if not. */
  accepted: boolean;
}

export interface AnalyticsSink {
  record(event: RoutingEvent | FeedbackEvent): void | Promise<void>;
}
