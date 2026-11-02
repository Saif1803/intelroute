import type { IntelRoute, MemoryAnalytics } from "@intelroute/core";

export interface AnalyticsHandlerOptions {
  /**
   * Require `Authorization: Bearer <token>` to read the summary (recommended
   * in production). Feedback `POST`s stay public so visitors' browsers can send them.
   */
  token?: string;
}

/**
 * Route handlers for an analytics endpoint, e.g. `app/api/intelroute/route.ts`:
 *
 * - `GET` returns the analytics summary.
 * - `POST { requestedPath, destination, accepted }` records visitor feedback,
 *   which powers the recovery accuracy metric.
 */
export function createAnalyticsHandlers(engine: IntelRoute, analytics: MemoryAnalytics, options: AnalyticsHandlerOptions = {}) {
  const authorized = (req: Request) => !options.token || req.headers.get("authorization") === `Bearer ${options.token}`;

  async function GET(req: Request): Promise<Response> {
    if (!authorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
    const limit = Number(new URL(req.url).searchParams.get("limit") ?? 10) || 10;
    return Response.json(analytics.summary(limit));
  }

  async function POST(req: Request): Promise<Response> {
    let body: { requestedPath?: unknown; destination?: unknown; accepted?: unknown };
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "invalid JSON" }, { status: 400 });
    }
    const { requestedPath, destination, accepted } = body;
    if (typeof requestedPath !== "string" || typeof destination !== "string" || typeof accepted !== "boolean") {
      return Response.json({ error: "expected { requestedPath: string, destination: string, accepted: boolean }" }, { status: 400 });
    }
    engine.recordFeedback(requestedPath.slice(0, 2048), destination.slice(0, 2048), accepted);
    return Response.json({ ok: true });
  }

  return { GET, POST };
}
