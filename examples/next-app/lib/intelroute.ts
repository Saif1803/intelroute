import { createIntelRoute, MemoryAnalytics, type IntelRoute } from "@intelroute/next";
import manifest from "../intelroute.routes.json";

type Instance = { engine: IntelRoute; analytics: MemoryAnalytics };

// One engine per server process, shared by the proxy and route handlers
// (and kept across hot reloads in development).
const g = globalThis as typeof globalThis & { __intelroute?: Instance };

function create(): Instance {
  const analytics = new MemoryAnalytics();
  const engine = createIntelRoute({ routes: manifest.routes, analytics });
  return { engine, analytics };
}

export const { engine, analytics } = (g.__intelroute ??= create());
