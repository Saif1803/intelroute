import type { DecisionAction, RoutingDecision, Suggestion } from "@intelroute/core";

/** Request headers the middleware sets for the not-found page to read. */
export const HEADER_PREFIX = "x-intelroute-";
export const HEADER_ACTION = "x-intelroute-action";
export const HEADER_PATH = "x-intelroute-path";
export const HEADER_SUGGESTIONS = "x-intelroute-suggestions";
export const HEADER_CONFIDENCE = "x-intelroute-confidence";

export interface IntelRouteNotFoundInfo {
  action: DecisionAction | null;
  requestedPath: string | null;
  confidence: number;
  suggestions: Suggestion[];
}

/** Encode a decision into header values (header-safe: percent-encoded JSON). */
export function encodeDecisionHeaders(decision: RoutingDecision): Record<string, string> {
  return {
    [HEADER_ACTION]: decision.action,
    [HEADER_PATH]: encodeURIComponent(decision.requestedPath),
    [HEADER_CONFIDENCE]: decision.confidence.toFixed(3),
    [HEADER_SUGGESTIONS]: encodeURIComponent(
      JSON.stringify(decision.suggestions.map((s) => ({ path: s.path, title: s.title, confidence: round(s.confidence) }))),
    ),
  };
}

/** Read the decision headers set by the middleware. Never throws. */
export function decodeDecisionHeaders(headers: { get(name: string): string | null }): IntelRouteNotFoundInfo {
  const action = headers.get(HEADER_ACTION) as DecisionAction | null;
  let suggestions: Suggestion[] = [];
  try {
    const raw = headers.get(HEADER_SUGGESTIONS);
    if (raw) {
      const parsed: unknown = JSON.parse(decodeURIComponent(raw));
      if (Array.isArray(parsed)) {
        suggestions = parsed.filter(
          (s): s is Suggestion =>
            !!s && typeof s.path === "string" && s.path.startsWith("/") && !s.path.startsWith("//"),
        );
      }
    }
  } catch {
    suggestions = [];
  }
  const path = headers.get(HEADER_PATH);
  return {
    action,
    requestedPath: path ? safeDecode(path) : null,
    confidence: Number(headers.get(HEADER_CONFIDENCE) ?? 0) || 0,
    suggestions,
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}
