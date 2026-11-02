import { describe, expect, it } from "vitest";
import { editDistance, normalizeUrl, parsePattern, tokenize, typoSimilarity } from "../src/index.js";

describe("normalizeUrl", () => {
  it.each([
    ["/About/", "/about"],
    ["//blog///hello-world//", "/blog/hello-world"],
    ["/blog/./posts/../hello", "/blog/hello"],
    ["/about.html", "/about"],
    ["/docs/index.php", "/docs"],
    ["/Hello%20World", "/hello-world"],
    ["/hello_world", "/hello-world"],
    ["/caf%C3%A9", "/cafe"],
    ["/bad%E0%A4%A", "/bad%e0%a4%a".replace(/%/g, "")],
    ["https://example.com/Pricing?ref=x#top", "/pricing"],
    ["pricing", "/pricing"],
    ["/", "/"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeUrl(input).path).toBe(expected);
  });

  it("keeps the query string and hash separately", () => {
    const n = normalizeUrl("/a?x=1&y=2#frag");
    expect(n.search).toBe("?x=1&y=2");
    expect(n.hash).toBe("#frag");
    expect(n.original).toBe("/a");
  });

  it("respects caseSensitive", () => {
    expect(normalizeUrl("/Users/AbC", { caseSensitive: true }).path).toBe("/Users/AbC");
  });
});

describe("parsePattern", () => {
  it("understands Next.js and colon syntaxes, and drops route groups", () => {
    const segs = parsePattern("/(marketing)/shop/[category]/[...rest]/:id/[[...opt]]");
    expect(segs.map((s) => s.kind)).toEqual(["static", "dynamic", "catchAll", "dynamic", "optionalCatchAll"]);
    expect(segs.map((s) => s.value)).toEqual(["shop", "category", "rest", "id", "opt"]);
  });
});

describe("similarity", () => {
  it("counts adjacent transpositions as one edit", () => {
    expect(editDistance("pirce", "price")).toBe(1);
    expect(editDistance("kitten", "sitting")).toBe(3);
  });

  it("scores single typos highly and unrelated words low", () => {
    expect(typoSimilarity("abuot", "about")).toBeGreaterThan(0.85);
    expect(typoSimilarity("pricng", "pricing")).toBeGreaterThan(0.85);
    expect(typoSimilarity("blog", "shop")).toBeLessThan(0.5);
  });

  it("tokenizes kebab, snake and camel case", () => {
    expect(tokenize("myFirst-post_v2")).toEqual(["my", "first", "post", "v2"]);
  });
});
