const SAVE_KEY = "empirekitchen:save";

export const EMPTY_META = {
  bestScore: 0,
  wins: 0,
  plays: 0,
  updatedAt: null,
};

export function mergeMeta(previous, state, now = new Date()) {
  const base = { ...EMPTY_META, ...(previous ?? {}) };
  const score = Number(state?.score ?? state?.lifetime?.revenue ?? 0);
  return {
    ...base,
    bestScore: Math.max(base.bestScore, score),
    wins: base.wins + (state?.outcome === "won" ? 1 : 0),
    plays: base.plays + (state?.outcome !== "playing" ? 1 : 0),
    updatedAt: now.toISOString(),
  };
}

export async function loadSave() {
  try {
    await globalThis.PG.ready;
    const raw = await globalThis.PG.kv.get(SAVE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function saveSave(payload, onError) {
  try {
    await globalThis.PG.kv.put(SAVE_KEY, JSON.stringify(payload));
  } catch (error) {
    onError?.(error);
  }
}
