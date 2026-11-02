import type { NormalizedUrl } from "./types.js";

export interface NormalizeOptions {
  /** Treat paths case-sensitively (default false). */
  caseSensitive?: boolean;
  /** File extensions to strip from the last segment (default: common server page extensions). */
  stripExtensions?: string[];
  /** Index documents treated as their parent directory (default: `index`, `default`, `home`). */
  indexNames?: string[];
}

const DEFAULT_EXTENSIONS = ["html", "htm", "php", "asp", "aspx", "jsp", "cfm", "shtml"];
const DEFAULT_INDEX_NAMES = ["index", "default"];

/** Decode percent-encoding without throwing on malformed sequences. */
export function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // Decode what can be decoded, leave broken escapes in place.
    return value.replace(/(%[0-9a-f]{2})+/gi, (seq) => {
      try {
        return decodeURIComponent(seq);
      } catch {
        return seq;
      }
    });
  }
}

/** Remove diacritics so `café` and `cafe` compare equal. */
export function stripDiacritics(value: string): string {
  return value.normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

/** Split a URL or path into path, query and hash without requiring an absolute URL. */
export function splitUrl(input: string): { path: string; search: string; hash: string } {
  let rest = input.trim();
  // Absolute URL: drop scheme and host.
  const abs = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i.exec(rest);
  if (abs) rest = rest.slice(abs[0].length);

  let hash = "";
  const hashIdx = rest.indexOf("#");
  if (hashIdx >= 0) {
    hash = rest.slice(hashIdx);
    rest = rest.slice(0, hashIdx);
  }
  let search = "";
  const qIdx = rest.indexOf("?");
  if (qIdx >= 0) {
    search = rest.slice(qIdx);
    rest = rest.slice(0, qIdx);
  }
  if (search === "?") search = "";
  if (!rest.startsWith("/")) rest = "/" + rest;
  return { path: rest, search, hash };
}

/** Normalize a single path segment into its comparison form. */
export function normalizeSegment(segment: string, opts: NormalizeOptions = {}): string {
  let s = stripDiacritics(safeDecode(segment));
  if (!opts.caseSensitive) s = s.toLowerCase();
  return s
    .replace(/[\s_+]+/g, "-") // spaces, underscores and plus signs act as word separators
    .replace(/[^\p{L}\p{N}\-.~]/gu, "") // drop punctuation that never appears in clean slugs
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Normalize a URL into a canonical comparison form: decoding, casing,
 * duplicate and trailing slashes, dot segments, file extensions and index
 * documents are all handled.
 */
export function normalizeUrl(input: string, opts: NormalizeOptions = {}): NormalizedUrl {
  const { path: rawPath, search, hash } = splitUrl(input);
  const extensions = opts.stripExtensions ?? DEFAULT_EXTENSIONS;
  const indexNames = opts.indexNames ?? DEFAULT_INDEX_NAMES;

  const out: string[] = [];
  for (const raw of rawPath.split("/")) {
    if (raw === "" || raw === ".") continue;
    if (raw === "..") {
      out.pop();
      continue;
    }
    const seg = normalizeSegment(raw, opts);
    if (seg) out.push(seg);
  }

  // Strip file extensions and index documents from the last segment.
  const last = out[out.length - 1];
  if (last !== undefined) {
    const dot = last.lastIndexOf(".");
    if (dot > 0 && extensions.includes(last.slice(dot + 1).toLowerCase())) {
      out[out.length - 1] = last.slice(0, dot);
    }
    const base = out[out.length - 1]!;
    if (indexNames.includes(base.toLowerCase())) out.pop();
  }

  return {
    original: rawPath,
    path: "/" + out.join("/"),
    segments: out,
    search,
    hash,
  };
}

/** Split text into lowercase word tokens (handles kebab, snake, camel case and digits). */
export function tokenize(text: string): string[] {
  return stripDiacritics(text)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
}
