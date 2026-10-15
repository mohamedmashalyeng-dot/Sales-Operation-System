import { buildJourney } from "@/config/attribution";
import { normaliseEmail } from "@/config/marketing";
import { resolveAttendance } from "@/utils/events";
import type { ScenarioDef, ScenarioExpectation } from "@/config/scenarios";
import type { Lead, WorkspaceState } from "@/store/types";

/**
 * Validates a demonstration scenario against the ACTUAL shared dataset. Checks
 * are automated and honest: a check only passes when the underlying records say
 * so, references are only resolved by stable id, and nothing is fabricated.
 *
 * Automated data checks are deliberately separated from the manual browser
 * checks, which are always reported as "not yet manually tested" — a successful
 * TypeScript build is not the same as a passed interaction test.
 */

export type CheckStatus = "passed" | "failed" | "not-tested";

export interface ScenarioCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface ScenarioValidation {
  scenarioId: string;
  recordFound: boolean;
  checks: ScenarioCheck[];
  passed: number;
  failed: number;
  notTested: number;
}

interface EvalResult {
  ok: boolean;
  detail: string;
}

function findLead(state: WorkspaceState, id: string): Lead | undefined {
  return (Array.isArray(state.leads) ? state.leads : []).find((l) => l.id === id);
}

function evaluate(
  exp: ScenarioExpectation,
  scenario: ScenarioDef,
  state: WorkspaceState,
  lead: Lead | undefined,
): EvalResult {
  const leadId = scenario.leadId;
  const leadEmail = normaliseEmail(lead?.email ?? "");
  const events = Array.isArray(state.events) ? state.events : [];

  switch (exp.kind) {
    case "lead-exists":
      return lead
        ? { ok: true, detail: `Lead ${lead.id} found.` }
        : { ok: false, detail: `Lead ${leadId} is missing from the dataset.` };

    case "source": {
      const ok = lead?.source === exp.value;
      return { ok, detail: ok ? `Source: ${lead?.source}.` : `Expected "${exp.value}", found "${lead?.source ?? "—"}".` };
    }

    case "campaign-matched": {
      const campaign = (Array.isArray(state.campaigns) ? state.campaigns : []).find((c) => c.id === exp.refId);
      if (!campaign) return { ok: false, detail: `Campaign ${exp.refId} is missing.` };
      const recipient = (Array.isArray(campaign.recipients) ? campaign.recipients : []).find(
        (r) => r.leadId === leadId,
      );
      if (!recipient && leadEmail) {
        const byEmail = campaign.recipients.find((r) => normaliseEmail(r.email) === leadEmail);
        return byEmail
          ? { ok: Boolean(byEmail.matched), detail: `Matched by email to existing lead ${leadId}.` }
          : { ok: false, detail: `Lead ${leadId} is not in the campaign audience.` };
      }
      return recipient
        ? { ok: true, detail: `Audience recipient matched to existing lead ${leadId}.` }
        : { ok: false, detail: `Lead ${leadId} is not in the campaign audience.` };
    }

    case "registered": {
      const event = events.find((e) => e.id === exp.refId);
      if (!event) return { ok: false, detail: `Event ${exp.refId} is missing.` };
      const reg = (Array.isArray(event.registrations) ? event.registrations : []).find(
        (r) => normaliseEmail(r.email) === leadEmail,
      );
      const ok = Boolean(reg) && reg?.outcome !== "declined";
      return { ok, detail: ok ? `Registered on ${event.name}.` : `No live registration found on ${event.name}.` };
    }

    case "attended": {
      const attended = events.some((e) =>
        (Array.isArray(e.registrations) ? e.registrations : []).some(
          (r) => normaliseEmail(r.email) === leadEmail && resolveAttendance(r) === "Attended",
        ),
      );
      return { ok: attended, detail: attended ? "Attendance explicitly recorded." : "No confirmed attendance recorded." };
    }

    case "no-session": {
      const anyReg = events.some((e) =>
        (Array.isArray(e.registrations) ? e.registrations : []).some(
          (r) => normaliseEmail(r.email) === leadEmail,
        ),
      );
      return {
        ok: !anyReg,
        detail: anyReg ? "A session registration exists (expected none)." : "No information-session registration exists.",
      };
    }

    case "call-linked": {
      const call = (Array.isArray(state.calls) ? state.calls : []).find((c) => c.id === exp.refId);
      if (!call) return { ok: false, detail: `Call ${exp.refId} is missing.` };
      const ok = call.leadId === leadId;
      return { ok, detail: ok ? `Call ${call.id} linked to ${leadId}.` : `Call ${call.id} is not linked to ${leadId}.` };
    }

    case "call-answered": {
      const call = (Array.isArray(state.calls) ? state.calls : []).find((c) => c.id === exp.refId);
      if (!call) return { ok: false, detail: `Call ${exp.refId} is missing.` };
      const ok = call.status === "answered" || call.status === "connected";
      return { ok, detail: ok ? `Call ${call.id} was answered.` : `Call ${call.id} was not answered.` };
    }

    case "transcript": {
      const call = (Array.isArray(state.calls) ? state.calls : []).find((c) => c.id === exp.refId);
      if (!call) return { ok: false, detail: `Call ${exp.refId} is missing.` };
      const ok = Boolean(call.transcriptAvailable) && (call.transcript?.length ?? 0) > 0;
      return { ok, detail: ok ? `Transcript available (${call.transcript?.length} segments).` : "No transcript is flagged available." };
    }

    case "follow-up-linked": {
      const task = (Array.isArray(state.tasks) ? state.tasks : []).find((t) => t.relatedCallId === exp.refId);
      return task
        ? { ok: true, detail: `Follow-up task ${task.id} linked (${task.status}).` }
        : { ok: false, detail: `No Planner follow-up linked to call ${exp.refId}.` };
    }

    case "application-linked": {
      const app = (Array.isArray(state.applications) ? state.applications : []).find((a) => a.id === exp.refId);
      if (!app) return { ok: false, detail: `Application ${exp.refId} is missing.` };
      const ok = app.leadId === leadId;
      return { ok, detail: ok ? `Application ${app.id} linked (${app.status}).` : `Application ${app.id} is not linked to ${leadId}.` };
    }

    case "future-intake": {
      const record = (Array.isArray(state.futureIntakes) ? state.futureIntakes : []).find((f) => f.leadId === leadId);
      return record
        ? { ok: true, detail: `Future Intake ${record.id} (${record.preferredIntake}).` }
        : { ok: false, detail: "No Future Intake record found." };
    }

    case "commercial": {
      const record = (Array.isArray(state.commercialOpportunities) ? state.commercialOpportunities : []).find(
        (c) => c.leadId === leadId,
      );
      return record
        ? { ok: true, detail: `Commercial opportunity ${record.id} (${record.stage}).` }
        : { ok: false, detail: "No commercial opportunity found." };
    }

    case "employer-commitment": {
      const agreement = (Array.isArray(state.employerAgreements) ? state.employerAgreements : []).find(
        (a) => a.leadId === leadId,
      );
      const ok = agreement?.status === "Signed" || agreement?.status === "Awaiting Signature";
      return { ok, detail: agreement ? `Employer agreement ${agreement.id} — ${agreement.status}.` : "No employer agreement found." };
    }

    case "eligibility-decision": {
      const decision = lead?.eligibility?.decision ?? lead?.eligibility?.status;
      const ok = decision === exp.value;
      return { ok, detail: ok ? `Recorded: ${decision}.` : `Expected "${exp.value}", found "${decision ?? "Not Assessed"}".` };
    }

    case "closing-touch": {
      const journey = buildJourney((state.touchpoints ?? []).filter((t) => t.leadId === leadId));
      return journey.closing
        ? { ok: true, detail: `Closing touch: ${journey.closing.interactionType} (${journey.closing.timestamp.slice(0, 10)}).` }
        : { ok: false, detail: "No explicitly recorded closing touch." };
    }

    case "enrolment": {
      const ok = lead?.enrolment === exp.value;
      return { ok, detail: ok ? `Enrolment: ${lead?.enrolment}.` : `Expected "${exp.value}", found "${lead?.enrolment ?? "Not Started"}".` };
    }

    case "chronology": {
      const journey = buildJourney((state.touchpoints ?? []).filter((t) => t.leadId === leadId));
      const qualifying = journey.qualifying;
      let ok = true;
      for (let i = 1; i < qualifying.length; i += 1) {
        if (new Date(qualifying[i].timestamp).getTime() < new Date(qualifying[i - 1].timestamp).getTime()) {
          ok = false;
          break;
        }
      }
      return { ok, detail: ok ? `${qualifying.length} qualifying touchpoints in order.` : "Qualifying touchpoints are out of order." };
    }

    case "no-duplicate-touchpoints": {
      const list = (state.touchpoints ?? []).filter((t) => t.leadId === leadId);
      const keys = new Set<string>();
      let ok = true;
      list.forEach((t) => {
        const key = t.refId ? `${t.leadId}::${t.refId}::${t.interactionType}` : t.id;
        if (keys.has(key)) ok = false;
        keys.add(key);
      });
      return { ok, detail: ok ? `No duplicates across ${list.length} touchpoints.` : "Duplicate linked touchpoints detected." };
    }

    default:
      return { ok: false, detail: "Unknown check." };
  }
}

export function validateScenario(scenario: ScenarioDef, state: WorkspaceState): ScenarioValidation {
  const lead = findLead(state, scenario.leadId);
  const checks: ScenarioCheck[] = [];

  scenario.expectations.forEach((exp) => {
    const result = evaluate(exp, scenario, state, lead);
    checks.push({
      id: exp.id,
      label: exp.label,
      status: result.ok ? "passed" : "failed",
      detail: result.detail,
    });
  });

  scenario.manualChecks.forEach((label, index) => {
    checks.push({
      id: `${scenario.key}-manual-${index}`,
      label,
      status: "not-tested",
      detail: "Reported as not yet manually tested — requires a browser walkthrough.",
    });
  });

  return {
    scenarioId: scenario.id,
    recordFound: Boolean(lead),
    checks,
    passed: checks.filter((c) => c.status === "passed").length,
    failed: checks.filter((c) => c.status === "failed").length,
    notTested: checks.filter((c) => c.status === "not-tested").length,
  };
}

/* ------------------------- linked record references -------------------- */

export interface ScenarioRecordLink {
  label: string;
  id: string;
  found: boolean;
  detail: string;
  route?: string;
}

/** Resolves the real records a scenario links to, so the UI can navigate honestly. */
export function scenarioRecords(scenario: ScenarioDef, state: WorkspaceState): ScenarioRecordLink[] {
  const lead = findLead(state, scenario.leadId);
  const links: ScenarioRecordLink[] = [
    {
      label: "Lead",
      id: scenario.leadId,
      found: Boolean(lead),
      detail: lead ? `${lead.name} · ${lead.source}` : "Missing record",
      route: scenario.related.leadRoute,
    },
  ];

  const push = (label: string, refId: string | undefined, found: boolean, detail: string, route?: string) => {
    if (!refId) return;
    links.push({ label, id: refId, found, detail: found ? detail : "Missing record", route });
  };

  const campaigns = Array.isArray(state.campaigns) ? state.campaigns : [];
  const events = Array.isArray(state.events) ? state.events : [];
  const calls = Array.isArray(state.calls) ? state.calls : [];
  const apps = Array.isArray(state.applications) ? state.applications : [];
  const intakes = Array.isArray(state.futureIntakes) ? state.futureIntakes : [];
  const commercial = Array.isArray(state.commercialOpportunities) ? state.commercialOpportunities : [];
  const agreements = Array.isArray(state.employerAgreements) ? state.employerAgreements : [];
  const tasks = Array.isArray(state.tasks) ? state.tasks : [];

  const campaignExp = scenario.expectations.find((e) => e.kind === "campaign-matched");
  const campaign = campaigns.find((c) => c.id === campaignExp?.refId);

  const regExp = scenario.expectations.find((e) => e.kind === "registered");
  const event = events.find((e) => e.id === regExp?.refId);
  push("Event", regExp?.refId, Boolean(event), event ? event.name : "", event ? `/events/${event.id}` : "/events");

  const callExp = scenario.expectations.find((e) => e.kind === "call-linked");
  const call = calls.find((c) => c.id === callExp?.refId);
  push("Sales call", callExp?.refId, Boolean(call), call ? `${call.status} · ${call.durationSec}s` : "", "/leads");

  const appExp = scenario.expectations.find((e) => e.kind === "application-linked");
  const app = apps.find((a) => a.id === appExp?.refId);
  push("Application", appExp?.refId, Boolean(app), app ? app.status : "", app ? `/applications/${app.id}` : "/applications");

  const intake = intakes.find((f) => f.leadId === scenario.leadId);

  const commercialRecord = commercial.find((c) => c.leadId === scenario.leadId);
  push("Commercial opportunity", commercialRecord?.id, Boolean(commercialRecord), commercialRecord ? commercialRecord.stage : "", "/commercial");

  const agreement = agreements.find((a) => a.leadId === scenario.leadId);
  push("Employer agreement", agreement?.id, Boolean(agreement), agreement ? `${agreement.employerName} · ${agreement.status}` : "", "/employers");

  const followTask = tasks.find((t) => t.relatedCallId === callExp?.refId);
  push("Planner follow-up", followTask?.id, Boolean(followTask), followTask ? followTask.title : "", "/planner");

  return links;
}

/** A quick summary used by the scenario list. */
export function scenarioSummary(scenario: ScenarioDef, state: WorkspaceState) {
  const validation = validateScenario(scenario, state);
  const lead = findLead(state, scenario.leadId);
  const journey = buildJourney((state.touchpoints ?? []).filter((t) => t.leadId === scenario.leadId));
  return {
    validation,
    lead,
    firstTouch: journey.first,
    closingTouch: journey.closing,
    leadSource: lead?.source ?? "Not recorded",
  };
}

/* ---------------------------- data revision ---------------------------- */

function hashString(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

/**
 * A lightweight, deterministic signature of the parts of a scenario's own data
 * that a manual test result depends on. When any of them change (a stage move,
 * a new application, a new touchpoint, an eligibility decision) the signature
 * changes, so stored QA evidence can be flagged as potentially outdated — it is
 * never auto-upgraded from Failed to Passed.
 */
export function scenarioDataRevision(scenario: ScenarioDef, state: WorkspaceState): string {
  const lead = findLead(state, scenario.leadId);
  const touchpoints = (state.touchpoints ?? []).filter((t) => t.leadId === scenario.leadId);
  const applications = (Array.isArray(state.applications) ? state.applications : [])
    .filter((a) => a.leadId === scenario.leadId)
    .map((a) => `${a.id}:${a.status}`);
  const parts = [
    lead ? `${lead.id}:${lead.source}` : "missing-lead",
    lead?.stage ?? "-",
    lead?.enrolment ?? "-",
    lead?.eligibility?.decision ?? lead?.eligibility?.status ?? "-",
    `tp${touchpoints.length}`,
    applications.join(","),
  ];
  return hashString(parts.join("|"));
}

/** Re-exported so consumers do not need a second import for type helpers. */
export type { ScenarioDef };
