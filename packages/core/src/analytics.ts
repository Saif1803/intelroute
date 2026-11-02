import type { AnalyticsSink, DecisionAction, FeedbackEvent, MatchStage, RoutingEvent } from "./types.js";

export interface AnalyticsSummary {
  /** Requests IntelRoute had to handle (anything that was not an exact match). */
  failedRequests: number;
  redirected: number;
  suggested: number;
  unresolved: number;
  /** Share of failed requests that were redirected or given suggestions. */
  recoveryRate: number;
  judgeCalls: number;
  cacheHits: number;
  averageLatencyMs: number;
  byStage: Partial<Record<MatchStage, number>>;
  /** Accepted / total feedback events; null until feedback is recorded. */
  accuracy: number | null;
  feedbackCount: number;
  topUnresolved: Array<{ path: string; count: number }>;
  topRecovered: Array<{ from: string; to: string; count: number }>;
}

/**
 * Aggregates routing events in memory. Suitable for development and
 * single-instance deployments; for serverless or multi-instance setups,
 * forward events to durable storage with your own `AnalyticsSink`.
 */
export class MemoryAnalytics implements AnalyticsSink {
  private counts: Record<Exclude<DecisionAction, "pass">, number> = { redirect: 0, suggest: 0, not_found: 0 };
  private failed = 0;
  private judgeCalls = 0;
  private cacheHits = 0;
  private latencyTotal = 0;
  private byStage: Partial<Record<MatchStage, number>> = {};
  private feedback = { accepted: 0, total: 0 };
  private unresolved = new Map<string, number>();
  private recovered = new Map<string, { from: string; to: string; count: number }>();
  private readonly listeners = new Set<(event: RoutingEvent | FeedbackEvent) => void>();

  constructor(private readonly maxTrackedPaths = 1000) {}

  record(event: RoutingEvent | FeedbackEvent): void {
    for (const listener of this.listeners) listener(event);

    if (event.type === "feedback") {
      this.feedback.total++;
      if (event.accepted) this.feedback.accepted++;
      return;
    }
    const d = event.decision;
    if (d.action === "pass") return;
    this.failed++;
    this.counts[d.action]++;
    if (d.judged) this.judgeCalls++;
    if (d.cached) this.cacheHits++;
    this.latencyTotal += d.durationMs;
    if (d.stage) this.byStage[d.stage] = (this.byStage[d.stage] ?? 0) + 1;

    if (d.action === "not_found") {
      bump(this.unresolved, d.requestedPath, this.maxTrackedPaths);
    } else if (d.action === "redirect" && d.destination) {
      // Group by path: the preserved query string would split identical recoveries.
      const to = d.destination.split(/[?#]/)[0]!;
      const key = `${d.requestedPath} -> ${to}`;
      const entry = this.recovered.get(key);
      if (entry) entry.count++;
      else if (this.recovered.size < this.maxTrackedPaths) {
        this.recovered.set(key, { from: d.requestedPath, to, count: 1 });
      }
    }
  }

  /** Subscribe to raw events (for example to forward them elsewhere). */
  subscribe(listener: (event: RoutingEvent | FeedbackEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  summary(limit = 10): AnalyticsSummary {
    const recoveredCount = this.counts.redirect + this.counts.suggest;
    return {
      failedRequests: this.failed,
      redirected: this.counts.redirect,
      suggested: this.counts.suggest,
      unresolved: this.counts.not_found,
      recoveryRate: this.failed ? recoveredCount / this.failed : 0,
      judgeCalls: this.judgeCalls,
      cacheHits: this.cacheHits,
      averageLatencyMs: this.failed ? this.latencyTotal / this.failed : 0,
      byStage: { ...this.byStage },
      accuracy: this.feedback.total ? this.feedback.accepted / this.feedback.total : null,
      feedbackCount: this.feedback.total,
      topUnresolved: [...this.unresolved.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([path, count]) => ({ path, count })),
      topRecovered: [...this.recovered.values()].sort((a, b) => b.count - a.count).slice(0, limit),
    };
  }

  reset(): void {
    this.counts = { redirect: 0, suggest: 0, not_found: 0 };
    this.failed = this.judgeCalls = this.cacheHits = this.latencyTotal = 0;
    this.byStage = {};
    this.feedback = { accepted: 0, total: 0 };
    this.unresolved.clear();
    this.recovered.clear();
  }
}

function bump(map: Map<string, number>, key: string, max: number): void {
  const current = map.get(key);
  if (current !== undefined) map.set(key, current + 1);
  else if (map.size < max) map.set(key, 1);
}
