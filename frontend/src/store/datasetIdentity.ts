/**
 * Dataset identity for the browser workspace.
 *
 * The local workspace can live in localStorage. Manual QA evidence is
 * kept SEPARATE from that data (so clearing workspace data never deletes a
 * reviewer's notes), which means we need a way to tell whether a stored test
 * result still describes the CURRENT dataset. This module owns a lightweight
 * "generation" marker that is bumped ONLY when the dataset is deliberately
 * reset — never on an ordinary edit — so an old result can be honestly flagged
 * as "needs retest after dataset reset" instead of being presented as current.
 */

const GENERATION_KEY = "kbc-workspace-dataset-generation";

function makeGeneration(): string {
  return `gen-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Returns the current dataset generation, creating one lazily on first use. */
export function getDatasetGeneration(): string {
  try {
    const existing = localStorage.getItem(GENERATION_KEY);
    if (existing) return existing;
    const created = makeGeneration();
    localStorage.setItem(GENERATION_KEY, created);
    return created;
  } catch {
    return "gen-unavailable";
  }
}

/** Starts a new dataset generation. Called when browser workspace data is cleared. */
export function bumpDatasetGeneration(): string {
  const next = makeGeneration();
  try {
    localStorage.setItem(GENERATION_KEY, next);
  } catch {
    /* best-effort only */
  }
  return next;
}
