import { headers } from "next/headers.js"; // `.js` for plain Node ESM; see middleware.ts
import { decodeDecisionHeaders, type IntelRouteNotFoundInfo } from "./headers.js";

export type { IntelRouteNotFoundInfo } from "./headers.js";

/**
 * Read IntelRoute's suggestions inside a Server Component, typically
 * `app/not-found.tsx`:
 *
 * ```tsx
 * const { suggestions } = await getIntelRouteSuggestions();
 * ```
 */
export async function getIntelRouteSuggestions(): Promise<IntelRouteNotFoundInfo> {
  // `headers()` is async in Next 15+, sync (but awaitable) in Next 14.
  const h = await headers();
  return decodeDecisionHeaders(h);
}
