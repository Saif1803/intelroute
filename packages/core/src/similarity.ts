/**
 * Optimal string alignment distance (Damerau-Levenshtein restricted to
 * adjacent transpositions). Transposed letters ("pirce" vs "price") are one
 * edit, which matches how people actually mistype URLs.
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prevPrev = new Array<number>(b.length + 1).fill(0);
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  let curr = new Array<number>(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prevPrev[j - 2]! + 1);
      }
      curr[j] = v;
    }
    [prevPrev, prev, curr] = [prev, curr, prevPrev];
  }
  return prev[b.length]!;
}

/** Similarity in 0..1 derived from edit distance, relative to the longer string. */
export function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return 1 - editDistance(a, b) / longest;
}

/** Jaro-Winkler similarity: rewards shared prefixes and tolerates transpositions in short strings. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatched = new Array<boolean>(a.length).fill(false);
  const bMatched = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - window);
    const hi = Math.min(b.length - 1, i + window);
    for (let j = lo; j <= hi; j++) {
      if (bMatched[j] || a[i] !== b[j]) continue;
      aMatched[i] = bMatched[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatched[i]) continue;
    while (!bMatched[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  const t = transpositions / 2;
  const jaro = (matches / a.length + matches / b.length + (matches - t) / matches) / 3;
  let prefix = 0;
  while (prefix < Math.min(4, a.length, b.length) && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/**
 * Typo-oriented similarity. Edit distance alone is harsh on short words (one
 * transposition in "about" costs 20%), Jaro-Winkler alone is generous to
 * unrelated words; averaging them when the strings are reasonably close
 * gives a score that tracks "is this a typo of that?".
 */
export function typoSimilarity(a: string, b: string): number {
  const edit = stringSimilarity(a, b);
  return edit >= 0.5 ? (edit + jaroWinkler(a, b)) / 2 : edit;
}

/**
 * Segment similarity that also understands separator differences:
 * `aboutus` vs `about-us`, and plural/singular forms.
 */
export function segmentSimilarity(a: string, b: string, synonyms?: SynonymTable): number {
  if (a === b) return 1;
  const ca = a.replace(/[-.~]/g, "");
  const cb = b.replace(/[-.~]/g, "");
  if (ca === cb) return 0.97;
  if (stem(ca) === stem(cb)) return 0.94;
  if (synonyms?.areSynonyms(ca, cb)) return 0.9;
  return Math.max(typoSimilarity(a, b), typoSimilarity(ca, cb));
}

/** Very light English stemmer: enough to equate plurals and common verb forms. */
export function stem(word: string): string {
  if (word.length <= 3) return word;
  return word
    .replace(/ies$/, "y")
    .replace(/(ss|sh|ch|x)es$/, "$1")
    .replace(/([^s])s$/, "$1")
    .replace(/(.{3,})ing$/, "$1")
    .replace(/(.{3,})ed$/, "$1");
}

/** Default synonym groups for words that commonly name the same page. */
export const DEFAULT_SYNONYMS: string[][] = [
  ["login", "signin", "sign-in", "logon", "log-in"],
  ["signup", "register", "registration", "sign-up", "join", "create-account"],
  ["logout", "signout", "sign-out", "log-out"],
  ["pricing", "price", "prices", "plans", "plan", "cost"],
  ["about", "about-us", "company", "who-we-are"],
  ["contact", "contact-us", "support", "get-in-touch"],
  ["help", "faq", "faqs", "support", "docs"],
  ["blog", "news", "articles", "posts"],
  ["account", "profile", "settings", "my-account"],
  ["cart", "basket", "bag"],
  ["checkout", "payment", "pay"],
  ["docs", "documentation", "guide", "guides", "manual"],
  ["terms", "tos", "terms-of-service", "terms-and-conditions"],
  ["privacy", "privacy-policy"],
  ["careers", "jobs", "hiring", "work-with-us"],
  ["product", "products", "shop", "store", "catalog"],
  ["home", "index", "start"],
  ["dashboard", "console", "admin", "overview"],
];

export class SynonymTable {
  private readonly groups = new Map<string, Set<number>>();

  constructor(groups: string[][]) {
    groups.forEach((group, i) => {
      for (const word of group) {
        for (const form of [word, word.replace(/-/g, ""), stem(word)]) {
          let set = this.groups.get(form);
          if (!set) this.groups.set(form, (set = new Set()));
          set.add(i);
        }
      }
    });
  }

  areSynonyms(a: string, b: string): boolean {
    const ga = this.groups.get(a) ?? this.groups.get(stem(a));
    const gb = this.groups.get(b) ?? this.groups.get(stem(b));
    if (!ga || !gb) return false;
    for (const g of ga) if (gb.has(g)) return true;
    return false;
  }
}

/** Similarity between two single tokens, accounting for typos, stems and synonyms. */
export function tokenSimilarity(a: string, b: string, synonyms?: SynonymTable): number {
  if (a === b) return 1;
  if (stem(a) === stem(b)) return 0.95;
  if (synonyms?.areSynonyms(a, b)) return 0.9;
  // Short tokens: a single typo changes meaning too much (e.g. "api" vs "app").
  const sim = typoSimilarity(a, b);
  const minLen = Math.min(a.length, b.length);
  if (minLen <= 3) return sim >= 0.99 ? sim : 0;
  return sim >= 0.75 ? sim : 0;
}

/**
 * Soft Dice coefficient over token bags: every token is greedily paired with
 * its most similar counterpart, and the pair similarities are summed.
 */
export function tokenSetSimilarity(a: string[], b: string[], synonyms?: SynonymTable): number {
  if (!a.length || !b.length) return 0;
  const used = new Set<number>();
  let total = 0;
  for (const ta of a) {
    let best = 0;
    let bestIdx = -1;
    b.forEach((tb, j) => {
      if (used.has(j)) return;
      const s = tokenSimilarity(ta, tb, synonyms);
      if (s > best) {
        best = s;
        bestIdx = j;
      }
    });
    if (bestIdx >= 0) {
      used.add(bestIdx);
      total += best;
    }
  }
  return (2 * total) / (a.length + b.length);
}

/**
 * Fraction of the query tokens that are covered by the target tokens. Unlike
 * Dice, a long page description does not dilute a short, precise query.
 */
export function tokenCoverage(query: string[], target: string[], synonyms?: SynonymTable): number {
  if (!query.length || !target.length) return 0;
  let total = 0;
  for (const q of query) {
    let best = 0;
    for (const t of target) {
      const s = tokenSimilarity(q, t, synonyms);
      if (s > best) best = s;
      if (best === 1) break;
    }
    total += best;
  }
  return total / query.length;
}
