import type { WorkspaceState } from "@/store/types";

/**
 * Automated relationship / milestone integrity checks.
 *
 * These run against the live shared dataset and REPORT what they find — they
 * never invent a successful outcome. A check is "failed" when an authoritative
 * record contradicts a linked record, and "warning" when a milestone is implied
 * but not backed by an explicit record (for example an enrolment with no
 * employer agreement or DAS entry). Passing a build is not the same as passing
 * a browser interaction test — that distinction is handled by the QA panel.
 */

export type IntegrityStatus = "passed" | "failed" | "warning";

export interface IntegrityCheck {
  id: string;
  label: string;
  status: IntegrityStatus;
  detail: string;
  leadId?: string;
}

export interface IntegrityReport {
  checks: IntegrityCheck[];
  passed: number;
  failed: number;
  warnings: number;
}

const APOLLO_LEAD_IDS = ["L-2061", "L-2062", "L-2063", "L-2064", "L-2065", "L-2066"];
const WEBSITE_LEAD_ID = "L-2067";

function duplicateIds<T extends { id: string }>(list: T[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  list.forEach((record) => {
    if (seen.has(record.id)) dupes.add(record.id);
    seen.add(record.id);
  });
  return Array.from(dupes);
}

function duplicateLinkedTouchpoints(list: WorkspaceState["touchpoints"]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  list.forEach((tp) => {
    if (!tp.refId) return;
    const key = `${tp.leadId}::${tp.refId}::${tp.interactionType}`;
    if (seen.has(key)) dupes.add(key);
    seen.add(key);
  });
  return Array.from(dupes);
}

export function runIntegrityChecks(state: WorkspaceState): IntegrityReport {
  const checks: IntegrityCheck[] = [];
  const leads = Array.isArray(state.leads) ? state.leads : [];
  const leadById = new Map(leads.map((l) => [l.id, l]));

  const apps = Array.isArray(state.applications) ? state.applications : [];
  const calls = Array.isArray(state.calls) ? state.calls : [];
  const agreements = Array.isArray(state.employerAgreements) ? state.employerAgreements : [];
  const das = Array.isArray(state.dasRecords) ? state.dasRecords : [];
  const touchpoints = Array.isArray(state.touchpoints) ? state.touchpoints : [];
  const events = Array.isArray(state.events) ? state.events : [];
  const meetings = Array.isArray(state.meetings) ? state.meetings : [];
  const eventIds = new Set(events.map((e) => e.id));

  /* ---- acquisition integrity ---- */
  const missingApollo = APOLLO_LEAD_IDS.filter((id) => !leadById.has(id));
  checks.push({
    id: "apollo-exist",
    label: "All six Apollo-sourced demonstration leads exist",
    status: missingApollo.length === 0 ? "passed" : "failed",
    detail:
      missingApollo.length === 0
        ? "L-2061 … L-2066 are present."
        : `Missing lead records: ${missingApollo.join(", ")}.`,
  });

  APOLLO_LEAD_IDS.forEach((id) => {
    const lead = leadById.get(id);
    if (!lead) return;
    const ok = lead.source === "Apollo.io";
    checks.push({
      id: `apollo-src-${id}`,
      label: `${lead.name} retains Apollo.io as the original source`,
      status: ok ? "passed" : "failed",
      detail: ok ? "Original acquisition source: Apollo.io." : `Found "${lead.source}" instead of Apollo.io.`,
      leadId: id,
    });
  });

  const website = leadById.get(WEBSITE_LEAD_ID);
  checks.push({
    id: "website-src",
    label: "The direct lead remains Website-sourced",
    status: website?.source === "Website" ? "passed" : "failed",
    detail: website ? `Original acquisition source: ${website.source}.` : `Lead ${WEBSITE_LEAD_ID} is missing.`,
    leadId: WEBSITE_LEAD_ID,
  });

  /* ---- campaign membership must not rewrite acquisition source ---- */
  const campaigns = Array.isArray(state.campaigns) ? state.campaigns : [];
  const apolloSourcesRewritten: string[] = [];
  campaigns.forEach((campaign) => {
    (Array.isArray(campaign.recipients) ? campaign.recipients : []).forEach((recipient) => {
      if (!recipient.leadId) return;
      const lead = leadById.get(recipient.leadId);
      if (!lead) return;
      // A campaign invitation must never change a lead's original provider.
      if (campaign.acquisitionProvider && lead.source !== campaign.acquisitionProvider && recipient.leadId && [
        "Apollo.io",
      ].includes(campaign.acquisitionProvider)) {
        // Only flag when the lead is one of the known Apollo records that should
        // still read Apollo.io.
        if (APOLLO_LEAD_IDS.includes(recipient.leadId) && lead.source !== "Apollo.io") {
          apolloSourcesRewritten.push(`${recipient.leadId} → ${lead.source}`);
        }
      }
    });
  });
  checks.push({
    id: "campaign-acquisition",
    label: "Campaign membership never rewrites an original acquisition source",
    status: apolloSourcesRewritten.length === 0 ? "passed" : "failed",
    detail:
      apolloSourcesRewritten.length === 0
        ? "Apollo leads keep Apollo.io as their recorded source despite campaign membership."
        : `Rewritten sources: ${apolloSourcesRewritten.join(", ")}.`,
  });

  /* ---- duplicate ids across key collections ---- */
  const collections: Array<[string, { id: string }[]]> = [
    ["Lead", leads],
    ["Application", apps],
    ["Call", calls],
    ["Employer agreement", agreements],
    ["DAS", das],
  ];
  collections.forEach(([label, list]) => {
    const dupes = duplicateIds(list);
    checks.push({
      id: `dup-${label}`,
      label: `No duplicate ${label} IDs`,
      status: dupes.length === 0 ? "passed" : "failed",
      detail: dupes.length === 0 ? `All ${label.toLowerCase()} ids are unique.` : `Duplicates: ${dupes.join(", ")}.`,
    });
  });

  /* ---- relationship integrity ---- */
  const badApps = apps.filter((a) => a.leadId && !leadById.has(a.leadId));
  checks.push({
    id: "app-links",
    label: "Application → Lead links resolve",
    status: badApps.length === 0 ? "passed" : "failed",
    detail: badApps.length === 0 ? `${apps.length} applications link to a lead.` : `Dangling: ${badApps.map((a) => a.id).join(", ")}.`,
  });

  const badCalls = calls.filter((c) => c.leadId && !leadById.has(c.leadId));
  checks.push({
    id: "call-links",
    label: "Zoom call → Lead links resolve",
    status: badCalls.length === 0 ? "passed" : "failed",
    detail: badCalls.length === 0 ? `${calls.length} calls resolve to a lead (or are unlinked).` : `Dangling: ${badCalls.map((c) => c.id).join(", ")}.`,
  });

  const badMeetings = meetings.filter((m) => m.relatedEventId && !eventIds.has(m.relatedEventId));
  checks.push({
    id: "meeting-links",
    label: "Eventbrite → Zoom meeting links resolve",
    status: badMeetings.length === 0 ? "passed" : "failed",
    detail: badMeetings.length === 0 ? "All linked meetings resolve to an event." : `Dangling: ${badMeetings.map((m) => m.id).join(", ")}.`,
  });

  const badAgreements = agreements.filter((a) => a.leadId && !leadById.has(a.leadId));
  checks.push({
    id: "agreement-links",
    label: "Employer agreement → Lead links resolve",
    status: badAgreements.length === 0 ? "passed" : "failed",
    detail: badAgreements.length === 0 ? `${agreements.length} agreements resolve.` : `Dangling: ${badAgreements.map((a) => a.id).join(", ")}.`,
  });

  const badDas = das.filter((d) => d.leadId && !leadById.has(d.leadId));
  checks.push({
    id: "das-links",
    label: "DAS record → Lead links resolve",
    status: badDas.length === 0 ? "passed" : "failed",
    detail: badDas.length === 0 ? `${das.length} DAS records resolve.` : `Dangling: ${badDas.map((d) => d.id).join(", ")}.`,
  });

  /* ---- milestone integrity: an enrolment must be backed by explicit records ---- */
  leads
    .filter((l) => l.enrolment === "Enrolled" || l.enrolment === "Apprenticeship Started")
    .forEach((lead) => {
      const hasAgreement = agreements.some((a) => a.leadId === lead.id);
      const hasDas = das.some((d) => d.leadId === lead.id);
      const missing: string[] = [];
      if (!hasAgreement) missing.push("employer agreement");
      if (!hasDas) missing.push("DAS record");
      checks.push({
        id: `milestone-${lead.id}`,
        label: `${lead.name}: enrolment milestone backed by explicit records`,
        status: missing.length === 0 ? "passed" : "warning",
        detail:
          missing.length === 0
            ? "Explicit employer agreement and DAS records both present."
            : `Implied but not recorded: ${missing.join(" and ")}. Agreement, DAS, application, enrolment and start stay distinct.`,
        leadId: lead.id,
      });
    });

  /* ---- closing-touch stability ---- */
  leads
    .filter((l) => l.closing)
    .forEach((lead) => {
      const closingTp = touchpoints.find((t) => t.id === lead.closing?.touchpointId);
      const ok = Boolean(closingTp) && closingTp?.isClosing === true;
      checks.push({
        id: `closing-${lead.id}`,
        label: `${lead.name}: closing touch resolves to an explicit record`,
        status: ok ? "passed" : "warning",
        detail: ok
          ? `Closing touch ${closingTp?.id} recorded and flagged as closing.`
          : "A closing outcome is stored but the explicit closing touchpoint could not be resolved.",
        leadId: lead.id,
      });
    });

  /* ---- duplicate linked touchpoints ---- */
  const dupTp = duplicateLinkedTouchpoints(touchpoints);
  checks.push({
    id: "dup-touchpoints",
    label: "No duplicate linked touchpoints",
    status: dupTp.length === 0 ? "passed" : "failed",
    detail: dupTp.length === 0 ? "No linked touchpoint is recorded twice." : `Duplicates: ${dupTp.join(", ")}.`,
  });

  const passed = checks.filter((c) => c.status === "passed").length;
  const failed = checks.filter((c) => c.status === "failed").length;
  const warnings = checks.filter((c) => c.status === "warning").length;

  return { checks, passed, failed, warnings };
}