import type { Judge, JudgeRequest, JudgeResult, RouteDefinition } from "../src/index.js";

export const routes: RouteDefinition[] = [
  { path: "/", title: "Home" },
  { path: "/about", title: "About us" },
  { path: "/pricing", title: "Pricing and plans" },
  { path: "/contact", title: "Contact us" },
  { path: "/login", title: "Log in" },
  { path: "/signup", title: "Create an account" },
  { path: "/careers", title: "Careers", aliases: ["/jobs-at-acme"] },
  { path: "/blog", title: "Blog" },
  {
    path: "/blog/[slug]",
    title: "Blog post",
    knownPaths: ["/blog/hello-world", "/blog/nextjs-routing-guide", "/blog/my-first-post"],
  },
  { path: "/docs/[...slug]", title: "Documentation" },
  { path: "/products/:id", title: "Product details" },
  { path: "/account/settings", title: "Account settings" },
  { path: "/account/password-reset", title: "Reset your password", keywords: ["forgot password"] },
  { path: "/help/getting-started", title: "Getting started guide" },
  { path: "/help/billing", title: "Billing help" },
];

/** Deterministic judge for tests: returns a fixed choice and probabilities. */
export class FakeJudge implements Judge {
  readonly name = "fake";
  calls: JudgeRequest[] = [];
  constructor(private readonly respond: (req: JudgeRequest) => JudgeResult | Promise<JudgeResult>) {}
  async judge(req: JudgeRequest): Promise<JudgeResult> {
    this.calls.push(req);
    return this.respond(req);
  }
}
