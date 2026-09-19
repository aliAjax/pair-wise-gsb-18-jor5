import type { Store } from "./types";
import { seedStore } from "./seed";

const KEY = "rc-loop-store-v1";

function valid(store: unknown): store is Store {
  if (!store || typeof store !== "object") return false;
  const s = store as Store;
  return Array.isArray(s.teeth) && Array.isArray(s.revisions) && Array.isArray(s.conflicts);
}

export function loadStore(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (valid(parsed)) return parsed;
    }
  } catch {
    // 损坏数据：回落到演示数据
  }
  const seeded = seedStore();
  persistStore(seeded);
  return seeded;
}

export function persistStore(store: Store): void {
  localStorage.setItem(KEY, JSON.stringify(store));
}

export function resetStore(): Store {
  const seeded = seedStore();
  persistStore(seeded);
  return seeded;
}
