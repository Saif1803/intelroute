import { normalizeSegment, normalizeUrl, safeDecode, tokenize, type NormalizeOptions } from "./normalize.js";
import type { IndexedRoute, RouteDefinition, RouteSegment } from "./types.js";

export interface ParsedSegment extends RouteSegment {
  /** Segment as declared, used when building destination URLs. */
  literal: string;
}

/** Words that carry no meaning when comparing URLs to page descriptions. */
export const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how", "i", "is", "it",
  "me", "my", "of", "on", "or", "our", "page", "the", "this", "to", "us", "we", "what",
  "with", "you", "your", "www", "html", "htm", "php",
]);

export function meaningfulTokens(text: string): string[] {
  return tokenize(text).filter((t) => !STOPWORDS.has(t));
}

/**
 * Parse a route pattern into segments. Route groups `(marketing)`, parallel
 * slots `@modal` and interception markers are removed, since they never
 * appear in URLs.
 */
export function parsePattern(pattern: string, opts: NormalizeOptions = {}): ParsedSegment[] {
  const segments: ParsedSegment[] = [];
  for (const raw of pattern.split("?")[0]!.split("/")) {
    if (!raw || raw === ".") continue;
    if (/^\(.*\)$/.test(raw) || raw.startsWith("@")) continue;
    let m: RegExpExecArray | null;
    if ((m = /^\[\[\.\.\.([^\]]+)\]\]$/.exec(raw))) {
      segments.push({ kind: "optionalCatchAll", value: m[1]!, literal: raw });
    } else if ((m = /^\[\.\.\.([^\]]+)\]$/.exec(raw))) {
      segments.push({ kind: "catchAll", value: m[1]!, literal: raw });
    } else if ((m = /^\[([^\]]+)\]$/.exec(raw)) || (m = /^:([A-Za-z_$][\w$]*)$/.exec(raw))) {
      segments.push({ kind: "dynamic", value: m[1]!, literal: raw });
    } else if ((m = /^:([A-Za-z_$][\w$]*)\*$/.exec(raw)) || raw === "*") {
      segments.push({ kind: "catchAll", value: m?.[1] ?? "rest", literal: raw });
    } else {
      segments.push({ kind: "static", value: normalizeSegment(raw, opts), literal: safeDecode(raw) });
    }
  }
  return segments;
}

export function patternToString(segments: ParsedSegment[]): string {
  const parts = segments.map((s) =>
    s.kind === "static"
      ? s.literal
      : s.kind === "dynamic"
        ? `[${s.value}]`
        : s.kind === "catchAll"
          ? `[...${s.value}]`
          : `[[...${s.value}]]`,
  );
  return "/" + parts.join("/");
}

/**
 * Match path segments against a pattern. Static segments are compared with
 * `compare`; returns captured parameters, or null if the pattern does not match.
 */
export function matchSegments(
  pathSegments: string[],
  pattern: ParsedSegment[],
  compare: (pathSeg: string, routeSeg: ParsedSegment) => boolean,
): Record<string, string | string[]> | null {
  const params: Record<string, string | string[]> = {};
  let i = 0;
  for (let j = 0; j < pattern.length; j++) {
    const seg = pattern[j]!;
    if (seg.kind === "catchAll" || seg.kind === "optionalCatchAll") {
      // Catch-alls are always last in valid patterns.
      const rest = pathSegments.slice(i);
      if (seg.kind === "catchAll" && rest.length === 0) return null;
      params[seg.value] = rest;
      return j === pattern.length - 1 ? params : null;
    }
    const value = pathSegments[i];
    if (value === undefined) return null;
    if (seg.kind === "dynamic") params[seg.value] = value;
    else if (!compare(value, seg)) return null;
    i++;
  }
  return i === pathSegments.length ? params : null;
}

/** Substitute captured parameters into a pattern to produce a concrete path. */
export function buildPath(
  pattern: ParsedSegment[],
  params: Record<string, string | string[]>,
  trailingSlash = false,
): string | null {
  const parts: string[] = [];
  for (const seg of pattern) {
    if (seg.kind === "static") {
      parts.push(encodePathSegment(seg.literal));
      continue;
    }
    const value = params[seg.value];
    if (value === undefined || (Array.isArray(value) && value.length === 0)) {
      if (seg.kind === "optionalCatchAll") continue;
      return null;
    }
    for (const v of Array.isArray(value) ? value : [value]) parts.push(encodePathSegment(v));
  }
  const path = "/" + parts.join("/");
  return trailingSlash && path !== "/" ? path + "/" : path;
}

function encodePathSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/%2C/gi, ",").replace(/%40/gi, "@");
}

/** Static segments rank ahead of dynamic ones, which rank ahead of catch-alls (Next.js semantics). */
function specificity(segments: ParsedSegment[]): number[] {
  return segments.map((s) =>
    s.kind === "static" ? 3 : s.kind === "dynamic" ? 2 : s.kind === "catchAll" ? 1 : 0,
  );
}

function compareSpecificity(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (b[i] ?? -1) - (a[i] ?? -1);
    if (d !== 0) return d;
  }
  return 0;
}

export interface IndexedRouteInternal extends IndexedRoute {
  segments: ParsedSegment[];
  /** Normalized known paths, parsed into all-static segments. */
  known: Array<{ path: string; segments: ParsedSegment[] }>;
}

export interface ExactMatch {
  route: IndexedRouteInternal;
  target: string;
  params: Record<string, string | string[]>;
}

export interface RouteIndexOptions extends NormalizeOptions {
  trailingSlash?: boolean;
}

/** Indexes application routes for exact, normalized and alias lookups. */
export class RouteIndex {
  readonly routes: IndexedRouteInternal[];
  readonly version: string;
  private readonly aliases = new Map<string, IndexedRouteInternal>();
  private readonly opts: RouteIndexOptions;

  constructor(definitions: RouteDefinition[], opts: RouteIndexOptions = {}) {
    this.opts = opts;
    this.routes = definitions
      .map((def, i) => this.indexRoute(def, i))
      .sort((a, b) => compareSpecificity(specificity(a.segments), specificity(b.segments)));

    for (const route of this.routes) {
      for (const alias of route.definition.aliases ?? []) {
        this.aliases.set(normalizeUrl(alias, opts).path, route);
      }
    }
    this.version = hashString(JSON.stringify(definitions));
  }

  private indexRoute(def: RouteDefinition, i: number): IndexedRouteInternal {
    const segments = parsePattern(def.path, this.opts);
    const isDynamic = segments.some((s) => s.kind !== "static");
    const known = (def.knownPaths ?? []).map((p) => {
      const literal = p.split(/[?#]/)[0]!;
      return { path: literal, segments: parsePattern(literal, this.opts) };
    });
    const tokens = [
      ...segments.filter((s) => s.kind === "static").flatMap((s) => meaningfulTokens(s.value)),
      ...meaningfulTokens(def.title ?? ""),
      ...meaningfulTokens(def.description ?? ""),
      ...(def.keywords ?? []).flatMap(meaningfulTokens),
    ];
    return {
      id: `r${i}`,
      definition: def,
      pattern: patternToString(segments),
      segments,
      isDynamic,
      tokens: [...new Set(tokens)],
      knownPaths: known.map((k) => k.path),
      known,
    };
  }

  /**
   * Literal match: does the application serve this exact path? Static
   * segments compare case-sensitively after percent-decoding.
   */
  matchLiteral(rawPath: string): ExactMatch | null {
    const segs = rawPath.split("/").filter(Boolean).map(safeDecode);
    const literalEq = (value: string, seg: ParsedSegment) => value === seg.literal;
    for (const route of this.routes) {
      if (route.known.length) {
        for (const k of route.known) {
          if (matchSegments(segs, k.segments, literalEq)) {
            return { route, target: k.path, params: {} };
          }
        }
        continue;
      }
      const params = matchSegments(segs, route.segments, literalEq);
      if (params) return { route, target: rawPath, params };
    }
    return null;
  }

  /** Match a normalized path against routes using normalized comparison. */
  matchNormalized(segments: string[]): ExactMatch | null {
    const normEq = (value: string, seg: ParsedSegment) => value === seg.value;
    for (const route of this.routes) {
      if (route.known.length) {
        for (const k of route.known) {
          if (matchSegments(segments, k.segments, normEq)) {
            return { route, target: this.withSlash(k.path), params: {} };
          }
        }
        continue;
      }
      const params = matchSegments(segments, route.segments, normEq);
      if (params) {
        const target = buildPath(route.segments, params, this.opts.trailingSlash);
        if (target) return { route, target, params };
      }
    }
    return null;
  }

  matchAlias(normalizedPath: string): IndexedRouteInternal | undefined {
    return this.aliases.get(normalizedPath);
  }

  /** Concrete destination for a route that has no parameters. */
  staticTarget(route: IndexedRouteInternal): string | null {
    return buildPath(route.segments, {}, this.opts.trailingSlash);
  }

  withSlash(path: string): string {
    const bare = path.length > 1 ? path.replace(/\/+$/, "") : path;
    return this.opts.trailingSlash && bare !== "/" ? bare + "/" : bare;
  }
}

/** Small non-cryptographic hash (FNV-1a) for cache versioning. */
export function hashString(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
