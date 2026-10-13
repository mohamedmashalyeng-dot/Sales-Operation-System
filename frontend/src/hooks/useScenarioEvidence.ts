import { useCallback, useEffect, useState } from "react";
import { CURRENT_SCHEMA_VERSION } from "@/store/migrations";
import { getDatasetGeneration } from "@/store/datasetIdentity";

/**
 * Versioned manual QA evidence for the demonstration scenarios.
 *
 * This is deliberately kept in its OWN localStorage key, outside the shared
 * workspace dataset, so clearing local workspace data never wipes a reviewer's notes. To
 * stop stale results being mistaken for current evidence, every entry records:
 *   - the scenario id
 *   - the test date and tester role
 *   - the dataset generation it was captured against
 *   - the application schema version
 *   - a revision signature of the scenario's own data
 *
 * A result is only "current" when ALL of those still match. Otherwise it is
 * shown as "Previous test result — needs retest". History is preserved: we
 * never silently delete an old result, and an old Failed can never become a
 * Passed without a fresh, explicit reviewer action.
 */

export type ManualStatus = "passed" | "failed" | "blocked" | "not-tested";

export interface EvidenceRecord {
  id: string;
  scenarioId: string;
  status: ManualStatus;
  role: string;
  testedAt: string;
  datasetGeneration: string;
  schemaVersion: number;
  scenarioRevision: string;
  notes: string;
  defect: string;
}

export interface EvidenceInput {
  status: ManualStatus;
  role: string;
  notes: string;
  defect: string;
  scenarioRevision: string;
}

export interface EvidenceView {
  record: EvidenceRecord;
  /** True when the entry still describes the current dataset + scenario data. */
  current: boolean;
  reason: string;
}

type EvidenceStore = Record<string, EvidenceRecord[]>;

const STORAGE_KEY = "kbc-workspace-scenario-evidence-v1";
const EVENT = "kbc:scenario-evidence";

function readStore(): EvidenceStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as EvidenceStore) : {};
  } catch {
    return {};
  }
}

function writeStore(store: EvidenceStore) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* best-effort only */
  }
}

/**
 * Decides whether a stored result is still current evidence. `revision` is the
 * live signature of the scenario's own data (see `scenarioDataRevision`).
 */
export function describeEvidence(record: EvidenceRecord, revision: string): EvidenceView {
  const generation = getDatasetGeneration();
  if (record.datasetGeneration !== generation) {
    return {
      record,
      current: false,
      reason: "Previous test result — needs retest after dataset reset.",
    };
  }
  if (record.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    return {
      record,
      current: false,
      reason: `Recorded against schema v${record.schemaVersion}; workspace is now v${CURRENT_SCHEMA_VERSION}.`,
    };
  }
  if (record.scenarioRevision !== revision) {
    return {
      record,
      current: false,
      reason: "Scenario data has changed since this test — re-verify and retest.",
    };
  }
  return { record, current: true, reason: "Matches the current dataset and scenario data." };
}

export function useScenarioEvidence() {
  const [store, setStore] = useState<EvidenceStore>(() => readStore());

  useEffect(() => {
    // Keep every hook instance in this tab in sync (a storage event only fires
    // in OTHER tabs), so recording a result in one panel updates the summary.
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

  const record = useCallback((scenarioId: string, input: EvidenceInput) => {
    const current = readStore();
    const entry: EvidenceRecord = {
      id: `ev-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      scenarioId,
      status: input.status,
      role: input.role,
      testedAt: new Date().toISOString(),
      datasetGeneration: getDatasetGeneration(),
      schemaVersion: CURRENT_SCHEMA_VERSION,
      scenarioRevision: input.scenarioRevision,
      notes: input.notes,
      defect: input.defect,
    };
    const next: EvidenceStore = {
      ...current,
      [scenarioId]: [entry, ...(current[scenarioId] ?? [])],
    };
    writeStore(next);
    setStore(next);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  const history = useCallback((scenarioId: string) => store[scenarioId] ?? [], [store]);

  const latest = useCallback(
    (scenarioId: string): EvidenceRecord | undefined => store[scenarioId]?.[0],
    [store],
  );

  return { store, record, history, latest };
}
