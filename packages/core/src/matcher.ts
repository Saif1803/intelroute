import { buildPath, meaningfulTokens, type IndexedRouteInternal, type ParsedSegment, type RouteIndex } from "./routes.js";
import { segmentSimilarity, SynonymTable, tokenCoverage, tokenSetSimilarity } from "./similarity.js";
import type { Candidate, NormalizedUrl, SemanticProvider } from "./types.js";

/** Value of a request segment filling a dynamic parameter. Below a perfect static match on purpose. */
const DYNAMIC_MATCH = 0.8;
/** Cost of leaving a segment unaligned, on either side. */
const GAP_PENALTY = 0.5;
/** Lexical-only evidence never reaches this cap, so it can't auto-redirect without the judge. */
const LEXICAL_CAP = 0.8;

export interface Alignment {
  /** Average per-segment similarity over aligned and unaligned segments, 0..1. */
  score: number;
  params: Record<string, string | string[]>;
  /** Whether every required dynamic segment received a value. */
  complete: boolean;
}

type Step = "match" | "skipReq" | "skipRoute" | "absorb";

/**
 * Align request segments with route segments (Needleman-Wunsch style), so
 * that mistyped, missing, extra and redundant segments are all tolerated.
 */
export function alignSegments(
  req: string[],
  route: ParsedSegment[],
  synonyms?: SynonymTable,
): Alignment {
  const n = req.length;
  const m = route.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(-Infinity));
  const back: Step[][] = Array.from({ length: n + 1 }, () => new Array<Step>(m + 1).fill("match"));
  dp[0]![0] = 0;

  const matchValue = (i: number, j: number): number => {
    const seg = route[j]!;
    if (seg.kind === "static") return segmentSimilarity(req[i]!, seg.value, synonyms);
    return DYNAMIC_MATCH;
  };

  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      if (i === 0 && j === 0) continue;
      let best = -Infinity;
      let step: Step = "match";
      const seg = j > 0 ? route[j - 1]! : undefined;
      if (i > 0 && j > 0) {
        const v = dp[i - 1]![j - 1]! + matchValue(i - 1, j - 1);
        if (v > best) [best, step] = [v, "match"];
        // Catch-all segments may absorb further request segments.
        if (seg && seg.kind !== "static" && seg.kind !== "dynamic") {
          const a = dp[i - 1]![j]! + DYNAMIC_MATCH;
          if (a > best) [best, step] = [a, "absorb"];
        }
      }
      if (i > 0) {
        const v = dp[i - 1]![j]! - GAP_PENALTY;
        if (v > best) [best, step] = [v, "skipReq"];
      }
      if (j > 0) {
        const penalty = seg!.kind === "optionalCatchAll" ? 0 : GAP_PENALTY;
        const v = dp[i]![j - 1]! - penalty;
        if (v > best) [best, step] = [v, "skipRoute"];
      }
      dp[i]![j] = best;
      back[i]![j] = step;
    }
  }

  // Backtrack to collect evidence and captured parameters.
  const params: Record<string, string | string[]> = {};
  let staticEvidence = 0;
  let extraPenalty = 1;
  let complete = true;
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const step = back[i]![j]!;
    if (step === "match" || step === "absorb") {
      const seg = route[j - 1]!;
      const value = req[i - 1]!;
      if (seg.kind === "static") staticEvidence += segmentSimilarity(value, seg.value, synonyms);
      else if (seg.kind === "dynamic") params[seg.value] = value;
      else {
        const list = (params[seg.value] as string[] | undefined) ?? [];
        list.unshift(value);
        params[seg.value] = list;
      }
      i--;
      if (step === "match") j--;
    } else if (step === "skipReq") {
      extraPenalty *= isNoiseSegment(req[i - 1]!) ? NOISE_SEGMENT_FACTOR : EXTRA_SEGMENT_FACTOR;
      i--;
    } else {
      const seg = route[j - 1]!;
      if (seg.kind === "dynamic" || seg.kind === "catchAll") complete = false;
      j--;
    }
  }

  // Only static segments are evidence: a wildcard accepts anything, so it
  // must not make an unrelated request look like a match.
  const staticCount = route.filter((s) => s.kind === "static").length;
  const evidence = staticCount ? staticEvidence / staticCount : PURE_DYNAMIC_EVIDENCE;
  return { score: evidence * extraPenalty, params, complete };
}

/** Penalty per extra request segment that looks like a locale, version, year or number. */
const NOISE_SEGMENT_FACTOR = 0.95;
/** Penalty per extra request segment that looks like content (e.g. a deleted post's slug). */
const EXTRA_SEGMENT_FACTOR = 0.75;
/** Evidence for routes made only of parameters, which any segment fills. */
const PURE_DYNAMIC_EVIDENCE = 0.4;

/** Segments that rarely carry meaning: `en`, `en-us`, `v2`, `2024`, `05`. */
export function isNoiseSegment(segment: string): boolean {
  return /^(?:[a-z]{2}(?:-[a-z]{2,4})?|v\d+(?:\.\d+)*|\d+)$/i.test(segment);
}

export interface ScoreOptions {
  synonyms: SynonymTable;
  semantic?: SemanticProvider;
  maxCandidates: number;
  trailingSlash?: boolean;
}

/** Text used to describe a route to semantic providers. */
export function routeText(route: IndexedRouteInternal): string {
  const d = route.definition;
  return [d.title, route.pattern, d.description, ...(d.keywords ?? [])].filter(Boolean).join(" — ");
}

/**
 * Score every route (and every known concrete path of dynamic routes)
 * against the request, returning the best candidates in descending order.
 */
export async function findCandidates(
  url: NormalizedUrl,
  index: RouteIndex,
  opts: ScoreOptions,
): Promise<Candidate[]> {
  const queryTokens = meaningfulTokens(url.segments.join(" "));

  let semanticScores: number[] | undefined;
  if (opts.semantic && queryTokens.length) {
    try {
      semanticScores = await opts.semantic.similarity(
        queryTokens.join(" "),
        index.routes.map(routeText),
      );
    } catch {
      semanticScores = undefined; // semantic signal is optional; fall back to lexical
    }
  }

  const candidates: Candidate[] = [];
  index.routes.forEach((route, routeIdx) => {
    // Lexical: how well the request words are covered by the route's words.
    const lexical = Math.max(
      tokenCoverage(queryTokens, route.tokens, opts.synonyms),
      tokenSetSimilarity(
        queryTokens,
        route.segments.filter((s) => s.kind === "static").flatMap((s) => meaningfulTokens(s.value)),
        opts.synonyms,
      ),
    );
    const semantic = semanticScores?.[routeIdx];

    const targets: Array<{ target: string | null; structural: number }> = [];
    if (route.known.length) {
      for (const k of route.known) {
        const a = alignSegments(url.segments, k.segments, opts.synonyms);
        targets.push({ target: index.withSlash(k.path), structural: a.score });
      }
    } else {
      const a = alignSegments(url.segments, route.segments, opts.synonyms);
      targets.push({
        target: a.complete ? buildPath(route.segments, a.params, opts.trailingSlash) : null,
        structural: a.score,
      });
    }

    for (const { target, structural } of targets) {
      if (!target) continue;
      const meaning = Math.max(lexical, semantic ?? 0);
      // Structure is the primary signal; meaning can lift a weak structural
      // match (renamed pages, synonyms) but only up to LEXICAL_CAP on its own.
      const meaningScore = Math.min(LEXICAL_CAP, meaning * 0.9);
      let score = Math.max(structural, meaningScore);
      if (structural > 0.5 && meaning > 0.5) score = Math.min(1, score + 0.05 * meaning);
      score *= 1 + 0.01 * ((route.definition.priority ?? 1) - 1);
      candidates.push({
        route,
        target,
        score: Math.min(1, score),
        signals: { structural, lexical, ...(semantic !== undefined ? { semantic } : {}) },
        stage: structural >= meaningScore ? "fuzzy" : "semantic",
      });
    }
  });

  candidates.sort((a, b) => b.score - a.score);

  // Keep one candidate per destination.
  const seen = new Set<string>();
  const unique: Candidate[] = [];
  for (const c of candidates) {
    if (seen.has(c.target)) continue;
    seen.add(c.target);
    unique.push(c);
    if (unique.length >= opts.maxCandidates) break;
  }
  return unique;
}
