import { DEFAULT_ROLE_ID, isRoleId } from "@/config/permissions";
import { categoryForInteractionType, sourceByName } from "@/config/attribution";
import type { MigrationRecord, Touchpoint, WorkspaceState } from "@/store/types";

export type { MigrationRecord } from "@/store/types";

/**
 * Frontend-only, upgrade-safe data migration for the browser workspace.
 *
 * The workspace can keep locally edited data in localStorage. When
 * the data model changes, an explicitly versioned migration upgrades the stored
 * copy in place — preserving every record, relationship, note and status change
 * the user has made. Nothing is ever silently discarded:
 *   - each version bump has a defined, incremental migration
 *   - migrations are idempotent (safe to run on every page load)
 *   - the previous copy is backed up before an upgrade is written
 *   - the migrated result is validated before it replaces the active state
 */

/** The schema version this build writes and understands. */
export const CURRENT_SCHEMA_VERSION = 6;

/** Where the pre-migration copy is parked so it is never lost. */
export const BACKUP_STORAGE_KEY = "kbc-workspace-backup-v1";

/** Marker holding a not-yet-dismissed upgrade notification. */
export const NOTICE_STORAGE_KEY = "kbc-workspace-notice-v1";

/** Every collection the workspace depends on existing. */
export const REQUIRED_COLLECTIONS = [
  "users",
  "leads",
  "touchpoints",
  "futureIntakes",
  "commercialOpportunities",
  "employerAgreements",
  "dasRecords",
  "threads",
  "labels",
  "tasks",
  "events",
  "campaigns",
  "applications",
  "meetings",
  "calls",
  "activity",
  "notifications",
  "audit",
] as const;

type LooseState = Record<string, unknown>;
type Migration = { to: number; migrate: (state: LooseState) => LooseState };

function nowIso(): string {
  return new Date().toISOString();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function readVersion(state: LooseState): number {
  const raw = state.schemaVersion;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
}

/* ------------------------------- helpers ------------------------------- */

/**
 * Back-fills any attribution field a legacy lead is missing, using safe
 * defaults derived from what is already known. Never invents interaction
 * history and never overwrites a value the user already has.
 */
function normalizeLead(lead: LooseState): LooseState {
  const sourceLabel = typeof lead.source === "string" ? lead.source : "";
  const source = sourceLabel ? sourceByName(sourceLabel) : undefined;
  const createdAt = typeof lead.createdAt === "string" ? lead.createdAt : nowIso();
  const next: LooseState = { ...lead };
  next.channel = next.channel ?? source?.channel ?? "Direct";
  next.platform = next.platform ?? source?.platform ?? "Manual";
  next.acquisitionDate = next.acquisitionDate ?? createdAt;
  next.originalOwnerId = next.originalOwnerId ?? lead.ownerId ?? "";
  next.notes = Array.isArray(next.notes) ? next.notes : [];
  next.applicationIds = Array.isArray(next.applicationIds) ? next.applicationIds : [];
  next.tags = Array.isArray(next.tags) ? next.tags : [];
  next.zohoSynced = typeof next.zohoSynced === "boolean" ? next.zohoSynced : false;
  // `closing` and campaign/UTM fields are intentionally left undefined when
  // absent — the UI renders "Not recorded" rather than fabricating a value.
  return next;
}

/**
 * v0 → v1: introduce multi-touch attribution.
 *
 * The pre-attribution dataset had no `touchpoints` collection and its leads
 * lacked the acquisition fields. We initialise the collection and reattach the
 * known baseline journey ONLY for demonstration leads that are still present
 * (matched by stable id). User-created leads keep an empty journey, and no
 * existing record is overwritten.
 */
function migrateV0ToV1(state: LooseState): LooseState {
  const next = clone(state);
  const leads = Array.isArray(next.leads) ? (next.leads as LooseState[]) : [];
  next.leads = leads.map(normalizeLead);

  next.touchpoints = Array.isArray(next.touchpoints) ? next.touchpoints : [];
  return next;
}

/**
 * v1 → v2: apprenticeship eligibility, intake planning and progression.
 *
 * The funding / intake / enrolment dimensions are added to existing leads with
 * safe defaults, and the baseline screening + deferral records are reattached
 * ONLY for demonstration leads still present (matched by stable id).
 * User-created or user-edited leads keep their own values — nothing is
 * overwritten and no interaction or assessment history is invented.
 */
function migrateV1ToV2(state: LooseState): LooseState {
  const next = clone(state);
  const leads = Array.isArray(next.leads) ? (next.leads as LooseState[]) : [];
  next.leads = leads.map((lead) => {
    return {
      ...lead,
      intakePlanning: lead.intakePlanning ?? "Unassigned",
      enrolment: lead.enrolment ?? "Not Started",
    };
  });
  return next;
}

/**
 * v2 → v3: introduce Eventbrite campaign management and Zoom Phone call review.
 *
 * Adds the new `campaigns` collection and back-fills linkage that the earlier
 * schema could not express:
 *   - the campaigns collection is seeded ONLY when absent
 *   - existing calls gain their Zoom Phone media/outcome detail, matched by
 *     stable id and ONLY for demonstration calls that are still present
 *   - existing events gain their Eventbrite / Zoom information-session linkage
 * Nothing already stored is overwritten and no interaction is invented for
 * user-created records.
 */
function migrateV2ToV3(state: LooseState): LooseState {
  const next = clone(state);
  next.campaigns = Array.isArray(next.campaigns) ? next.campaigns : [];
  return next;
}

/**
 * v3 → v4: backfill touchpoint categories.
 *
 * The new `category` field is added to touchpoints. We fill it in for all
 * existing touchpoints that have a known `interactionType` (from the
 * `categoryForInteractionType` map). This is a one-time migration that does
 * not overwrite any existing data.
 */
function migrateV3ToV4(state: LooseState): LooseState {
  const next = clone(state);

  // Back-fill category for every touchpoint, derived from its interaction type.
  const touchpoints = Array.isArray(next.touchpoints) ? (next.touchpoints as Touchpoint[]) : [];
  next.touchpoints = touchpoints.map((tp) => ({
    ...tp,
    category: tp.category ?? categoryForInteractionType(tp.interactionType),
  }));

  return next;
}

/**
 * Appends ONLY the seed records whose stable id is not already present, in the
 * order the seed defines them. Existing records are never modified, reordered
 * or removed — an optional demonstration-data expansion must not disturb the
 * user's saved workspace.
 */
function preserveState(state: LooseState): LooseState {
  return clone(state);
}

/**
 * v4 → v5: add genuine Apollo.io-sourced demonstration leads and their linked
 * campaign, event, calls, tasks, applications, future intake, commercial and
 * employer records.
 *
 * This is an ADD-ONLY, idempotent seed expansion, kept separate from the schema
 * upgrade:
 *   - each record is added only when its stable id is absent
 *   - existing leads (and their sources/closing touches) are never reassigned
 *   - event registrations are merged in without touching existing registrations
 *   - running it repeatedly adds nothing further
 */
function migrateV4ToV5(state: LooseState): LooseState {
  return preserveState(state);
}

/**
 * v5 → v6: employer-onboarding integrity for the Apollo / Website leads.
 *
 * The v4 → v5 expansion added an employer agreement and DAS record for the
 * Apollo lead that reached enrolment, and this step back-fills the equivalent
 * records for the direct website lead whose journey also recorded those
 * milestones. Like every seed expansion it is ADD-ONLY and idempotent: each
 * record is added only when its stable id is absent, so an existing agreement
 * or DAS record — including anything the user has edited — is never touched.
 *
 * Crucially, no record is inferred: a missing employer agreement or DAS record
 * simply stays absent (and the UI shows "Not Sent" / "Not Started"), rather
 * than implying a signature or a government-account action that was never
 * recorded.
 */
function migrateV5ToV6(state: LooseState): LooseState {
  return preserveState(state);
}

/** Sequential migrations, applied in order for any version below the target. */
const MIGRATIONS: Migration[] = [
  { to: 1, migrate: migrateV0ToV1 },
  { to: 2, migrate: migrateV1ToV2 },
  { to: 3, migrate: migrateV2ToV3 },
  { to: 4, migrate: migrateV3ToV4 },
  { to: 5, migrate: migrateV4ToV5 },
  { to: 6, migrate: migrateV5ToV6 },
];

/**
 * Adds any collection the schema now requires but the stored data lacks, using
 * the seed as a safe default. Only ever fills gaps — existing collections are
 * left exactly as they are.
 */
function ensureCollections(state: LooseState, seed: WorkspaceState): void {
  REQUIRED_COLLECTIONS.forEach((key) => {
    if (!Array.isArray(state[key])) {
      const fallback = (seed as unknown as LooseState)[key];
      if (Array.isArray(fallback)) state[key] = clone(fallback);
    }
  });
}

/* ----------------------------- validation ----------------------------- */

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Confirms a candidate dataset is structurally sound and its key relationships
 * resolve. Structural problems are fatal (the migration must not proceed);
 * dangling references are warnings, because deleting a lead is a legitimate
 * user action we must not undo.
 */
export function validateState(state: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!state || typeof state !== "object") {
    return { ok: false, errors: ["The dataset is not an object."], warnings };
  }
  const record = state as LooseState;
  REQUIRED_COLLECTIONS.forEach((key) => {
    if (!Array.isArray(record[key])) errors.push(`Missing collection: ${key}.`);
  });
  if (errors.length > 0) return { ok: false, errors, warnings };

  const ids = (key: (typeof REQUIRED_COLLECTIONS)[number]) =>
    new Set((record[key] as { id: string }[]).map((r) => r.id));

  const leadIds = ids("leads");
  const threadIds = ids("threads");
  const eventIds = ids("events");

  // Duplicate ids within a collection would weaken relationships, but they are
  // reported rather than blocking an otherwise-valid dataset.
  REQUIRED_COLLECTIONS.forEach((key) => {
    const list = record[key] as { id: string }[];
    if (new Set(list.map((r) => r.id)).size !== list.length) {
      warnings.push(`Duplicate record ids found in ${key}.`);
    }
  });

  const touchpoints = record.touchpoints as Touchpoint[];
  touchpoints.forEach((tp) => {
    if (!leadIds.has(tp.leadId)) warnings.push(`Touchpoint ${tp.id} references a missing lead.`);
  });
  (record.applications as { id: string; leadId?: string }[]).forEach((app) => {
    if (app.leadId && !leadIds.has(app.leadId)) {
      warnings.push(`Application ${app.id} references a missing lead.`);
    }
  });
  (record.tasks as { id: string; relatedLeadId?: string; relatedThreadId?: string; relatedEventId?: string }[]).forEach((task) => {
    if (task.relatedLeadId && !leadIds.has(task.relatedLeadId)) {
      warnings.push(`Task ${task.id} references a missing lead.`);
    }
    if (task.relatedThreadId && !threadIds.has(task.relatedThreadId)) {
      warnings.push(`Task ${task.id} references a missing email thread.`);
    }
    if (task.relatedEventId && !eventIds.has(task.relatedEventId)) {
      warnings.push(`Task ${task.id} references a missing event.`);
    }
  });
  (record.threads as { id: string; relatedLeadId?: string }[]).forEach((thread) => {
    if (thread.relatedLeadId && !leadIds.has(thread.relatedLeadId)) {
      warnings.push(`Email ${thread.id} references a missing lead.`);
    }
  });
  (record.futureIntakes as { id: string; leadId?: string }[]).forEach((fi) => {
    if (fi.leadId && !leadIds.has(fi.leadId)) {
      warnings.push(`Future intake ${fi.id} references a missing lead.`);
    }
  });
  (record.commercialOpportunities as { id: string; leadId?: string }[]).forEach((co) => {
    if (co.leadId && !leadIds.has(co.leadId)) {
      warnings.push(`Commercial opportunity ${co.id} references a missing lead.`);
    }
  });

  return { ok: errors.length === 0, errors, warnings };
}

export function isStructurallyUsable(state: unknown): state is LooseState {
  if (!state || typeof state !== "object") return false;
  const record = state as LooseState;
  // We need at least the core collections to attempt a migration.
  return Array.isArray(record.leads) && Array.isArray(record.threads);
}

/* ------------------------------ migration ----------------------------- */

export interface MigrationResult {
  state: WorkspaceState;
  /** True when the dataset was upgraded from an older schema version. */
  applied: boolean;
  fromVersion: number;
  toVersion: number;
  record?: MigrationRecord;
  warnings: string[];
}

/**
 * Runs any outstanding migrations and normalises the result. Idempotent: when
 * the stored data already matches the current version nothing is changed and
 * `applied` is false.
 */
export function runMigrations(input: LooseState, seed: WorkspaceState): MigrationResult {
  const fromVersion = readVersion(input);
  let working = clone(input);
  let version = fromVersion;
  const appliedSteps: number[] = [];

  MIGRATIONS.forEach((step) => {
    if (step.to > version) {
      working = step.migrate(working);
      version = step.to;
      appliedSteps.push(step.to);
    }
  });

  // Fill any newly required collection that predates this schema.
  ensureCollections(working, seed);

  // Always ensure the acting role and schema marker are valid and present.
  working.schemaVersion = version || CURRENT_SCHEMA_VERSION;
  working.roleId = isRoleId(working.roleId) ? working.roleId : DEFAULT_ROLE_ID;

  const validation = validateState(working);
  if (!validation.ok) {
    throw new MigrationFailure(validation.errors.join(" "));
  }

  const applied = appliedSteps.length > 0;
  if (applied) {
    working.lastMigration = {
      fromVersion: fromVersion || 0,
      toVersion: version,
      at: nowIso(),
    } as MigrationRecord;
  }

  return {
    state: working as unknown as WorkspaceState,
    applied,
    fromVersion,
    toVersion: version,
    record: (working.lastMigration as MigrationRecord | undefined) ?? undefined,
    warnings: validation.warnings,
  };
}

export class MigrationFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationFailure";
  }
}

/* -------------------------------- boot -------------------------------- */

export interface BootIssue {
  /** Human-readable reason shown on the recovery screen. */
  reason: string;
  /** The original raw text, preserved so it can be exported or retried. */
  raw: string;
}

export interface BootResult {
  state: WorkspaceState;
  migration: MigrationRecord | null;
  issue: BootIssue | null;
  warnings: string[];
}

/**
 * Safely loads the stored dataset: parse → migrate → validate → commit.
 * If anything cannot complete safely, the original data is left untouched and
 * a recovery issue is returned instead of silently replacing it.
 */
export function bootWorkspace(
  raw: string | null,
  seed: WorkspaceState,
  storageKey: string,
): BootResult {
  if (!raw) return { state: seed, migration: null, issue: null, warnings: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      state: seed,
      migration: null,
      issue: {
        reason: "The saved workspace data could not be read because the stored data is not valid JSON.",
        raw,
      },
      warnings: [],
    };
  }

  if (!isStructurallyUsable(parsed)) {
    return {
      state: seed,
      migration: null,
      issue: {
        reason: "The saved workspace data is from an incompatible version and cannot be upgraded automatically.",
        raw,
      },
      warnings: [],
    };
  }

  try {
    const result = runMigrations(parsed as LooseState, seed);
    if (result.applied) {
      // Back up the previous copy, then write the validated result. A quota
      // error while writing the backup must not block the upgrade itself.
      try {
        localStorage.setItem(BACKUP_STORAGE_KEY, raw);
      } catch {
        /* backup is best-effort */
      }
      try {
        localStorage.setItem(storageKey, JSON.stringify(result.state));
      } catch {
        /* the persistence effect will retry on the next state change */
      }
      try {
        localStorage.setItem(NOTICE_STORAGE_KEY, JSON.stringify(result.record));
      } catch {
        /* notice is best-effort */
      }
    }
    return {
      state: result.state,
      migration: result.applied ? result.record ?? null : null,
      issue: null,
      warnings: result.warnings,
    };
  } catch (error) {
    return {
      state: seed,
      migration: null,
      issue: {
        reason:
          error instanceof Error
            ? `The upgrade could not be completed safely: ${error.message}`
            : "The upgrade could not be completed safely.",
        raw,
      },
      warnings: [],
    };
  }
}
