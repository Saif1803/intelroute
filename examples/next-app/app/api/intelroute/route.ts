import { createAnalyticsHandlers } from "@intelroute/next";
import { analytics, engine } from "@/lib/intelroute";

const handlers = createAnalyticsHandlers(engine, analytics, {
  token: process.env.INTELROUTE_ANALYTICS_TOKEN,
});

export const GET = handlers.GET;
export const POST = handlers.POST;
