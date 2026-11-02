import { createIntelRouteMiddleware } from "@intelroute/next";
import { engine } from "./lib/intelroute";

export const proxy = createIntelRouteMiddleware(engine, {
  onDecision: (d) => console.log(`[intelroute] ${d.action} ${d.requestedPath}${d.destination ? ` -> ${d.destination}` : ""} (${d.reason})`),
});

export const config = {
  // Skip Next.js internals and static files; IntelRoute also excludes these itself.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
