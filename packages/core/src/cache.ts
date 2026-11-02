import type { CacheStore, RoutingDecision } from "./types.js";

interface Entry {
  value: RoutingDecision;
  expires: number;
}

/** In-memory LRU cache with per-entry TTL. Works in Node, edge and browser runtimes. */
export class MemoryCache implements CacheStore {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly maxEntries = 5000) {}

  get(key: string): RoutingDecision | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expires <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    // Refresh recency.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: RoutingDecision, ttlMs: number): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expires: Date.now() + ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
