import { useCallback, useEffect, useState } from "react";

/**
 * Guided scenario walkthrough state.
 *
 * A purely navigational aid for a human reviewer: it tracks where they are in a
 * scenario, which steps they have VISITED, which they have actually PERFORMED
 * an action on, and the per-step Pass/Fail/Blocked result. It is stored in its
 * own localStorage key so the reviewer can exit guided mode, navigate the real
 * app, and return later with the position preserved.
 *
 * Visiting a page never counts as testing it — "visited" and "actionPerformed"
 * are tracked separately from a step's manual result, so nothing is overstated.
 */

export type StepResult = "none" | "passed" | "failed" | "blocked";

export interface StepState {
  visited: boolean;
  actionPerformed: boolean;
  result: StepResult;
  note: string;
}

export interface WalkthroughState {
  scenarioId: string;
  currentStepId: string;
  steps: Record<string, StepState>;
  updatedAt: string;
}

type WalkthroughStore = Record<string, WalkthroughState>;

const STORAGE_KEY = "kbc-workspace-scenario-walkthrough-v1";
const EVENT = "kbc:scenario-walkthrough";

export const EMPTY_STEP: StepState = {
  visited: false,
  actionPerformed: false,
  result: "none",
  note: "",
};

function readStore(): WalkthroughStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as WalkthroughStore) : {};
  } catch {
    return {};
  }
}

function writeStore(store: WalkthroughStore) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* best-effort only */
  }
}

function baseState(scenarioId: string, firstStepId: string): WalkthroughState {
  return {
    scenarioId,
    currentStepId: firstStepId,
    steps: {},
    updatedAt: new Date().toISOString(),
  };
}

export function useScenarioWalkthrough() {
  const [store, setStore] = useState<WalkthroughStore>(() => readStore());

  useEffect(() => {
    const sync = () => setStore(readStore());
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) sync();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(EVENT, sync);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(EVENT, sync);
    };
  }, []);

  const getWalkthrough = useCallback(
    (scenarioId: string): WalkthroughState | undefined => store[scenarioId],
    [store],
  );

  const getStep = useCallback(
    (scenarioId: string, stepId: string): StepState =>
      store[scenarioId]?.steps[stepId] ?? EMPTY_STEP,
    [store],
  );

  const ensure = useCallback(
    (scenarioId: string, firstStepId: string): WalkthroughState =>
      store[scenarioId] ?? baseState(scenarioId, firstStepId),
    [store],
  );

  const setStepState = useCallback(
    (scenarioId: string, stepId: string, patch: Partial<StepState>, firstStepId: string) => {
      const current = readStore();
      const base = current[scenarioId] ?? baseState(scenarioId, firstStepId);
      const step: StepState = { ...EMPTY_STEP, ...base.steps[stepId], ...patch };
      const next: WalkthroughStore = {
        ...current,
        [scenarioId]: {
          ...base,
          steps: { ...base.steps, [stepId]: step },
          updatedAt: new Date().toISOString(),
        },
      };
      writeStore(next);
      setStore(next);
      window.dispatchEvent(new Event(EVENT));
    },
    [],
  );

  const setCurrentStep = useCallback(
    (scenarioId: string, stepId: string, firstStepId: string) => {
      const current = readStore();
      const base = current[scenarioId] ?? baseState(scenarioId, firstStepId);
      const next: WalkthroughStore = {
        ...current,
        [scenarioId]: { ...base, currentStepId: stepId, updatedAt: new Date().toISOString() },
      };
      writeStore(next);
      setStore(next);
      window.dispatchEvent(new Event(EVENT));
    },
    [],
  );

  const resetWalkthrough = useCallback((scenarioId: string) => {
    const current = readStore();
    const next = { ...current };
    delete next[scenarioId];
    writeStore(next);
    setStore(next);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return {
    store,
    ensure,
    getWalkthrough,
    getStep,
    setStepState,
    setCurrentStep,
    resetWalkthrough,
  };
}