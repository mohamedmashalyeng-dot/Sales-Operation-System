import type { BadgeTone } from "@/components/base/Badge";
import type { Touchpoint, TouchpointRefType } from "@/store/types";

/**
 * Multi-touch attribution configuration for the demonstration workspace.
 *
 * IMPORTANT: The workspace deliberately keeps FOUR separate concepts apart:
 *   - source        (where the lead came from, e.g. Facebook Ads)
 *   - channel       (the broad channel, e.g. Paid Social)
 *   - platform      (the tool / network, e.g. Meta)
 *   - interactionType (what actually happened, e.g. Web form, Inbound call)
 * They are never treated as interchangeable. All values below are fictional.
 */

export interface AcquisitionSource {
  id: string;
  label: string;
  channel: string;
  platform: string;
  category: "Paid" | "Organic" | "Direct" | "Events" | "Offline" | "Partner" | "Referral" | "Outreach";
  /**
   * The layer this source represents. Kept explicit so an Eventbrite invite to
   * an Apollo-sourced contact can never be mistaken for a new acquisition.
   */
  layer: "Acquisition provider" | "CRM import" | "Campaign platform" | "Direct" | "Offline";
}

export const ACQUISITION_SOURCES: AcquisitionSource[] = [
  { id: "apollo", label: "Apollo.io", channel: "Outreach", platform: "Apollo.io", category: "Outreach", layer: "Acquisition provider" },
  { id: "zoho-import", label: "Zoho CRM Export", channel: "Outreach", platform: "Zoho CRM", category: "Outreach", layer: "CRM import" },
  { id: "facebook-ads", label: "Facebook Ads", channel: "Paid Social", platform: "Meta", category: "Paid", layer: "Campaign platform" },
  { id: "google-ads", label: "Google Ads", channel: "Paid Search", platform: "Google", category: "Paid", layer: "Campaign platform" },
  { id: "linkedin", label: "LinkedIn", channel: "Paid Social", platform: "LinkedIn", category: "Paid", layer: "Campaign platform" },
  { id: "website", label: "Website", channel: "Web", platform: "kentbusinesscollege.ac.uk", category: "Direct", layer: "Direct" },
  { id: "direct-email", label: "Direct Email Enquiry", channel: "Email", platform: "Admissions inbox", category: "Direct", layer: "Direct" },
  { id: "organic-search", label: "Organic Search", channel: "Organic", platform: "Google", category: "Organic", layer: "Direct" },
  { id: "eventbrite", label: "Eventbrite", channel: "Events", platform: "Eventbrite", category: "Events", layer: "Campaign platform" },
  { id: "eventbrite-direct", label: "Eventbrite Listing", channel: "Events", platform: "Eventbrite", category: "Events", layer: "Campaign platform" },
  { id: "zoom-webinars", label: "Zoom Webinars", channel: "Webinar", platform: "Zoom", category: "Events", layer: "Campaign platform" },
  { id: "email-campaigns", label: "Email Campaigns", channel: "Email", platform: "Mailchimp", category: "Paid", layer: "Campaign platform" },
  { id: "referral", label: "Referral", channel: "Referral", platform: "Word of mouth", category: "Referral", layer: "Direct" },
  { id: "partner", label: "Partner", channel: "Partner", platform: "Partner network", category: "Partner", layer: "Direct" },
  { id: "telephone", label: "Telephone", channel: "Direct", platform: "Phone", category: "Direct", layer: "Direct" },
  { id: "manual-import", label: "Manual Import", channel: "Offline", platform: "Manual", category: "Offline", layer: "Offline" },
];

export const ACQUISITION_SOURCE_LABELS = ACQUISITION_SOURCES.map((s) => s.label);

export function sourceByName(label: string): AcquisitionSource | undefined {
  return ACQUISITION_SOURCES.find((s) => s.label === label);
}

/**
 * Describes, without conflation, the layers behind a contact record. Sending an
 * Eventbrite invitation to an Apollo-sourced contact never changes the original
 * acquisition source — this helper is what keeps that separation visible.
 */
export interface AcquisitionLayers {
  originalAcquisitionSource: string;
  crmSystem: string;
  campaignPlatform: string;
  communicationChannel: string;
  eventRegistrationSource: string;
}

export function describeAcquisitionLayers(input: {
  acquisitionSource: string;
  crmSystem?: string;
  campaignPlatform?: string;
  communicationChannel?: string;
  eventRegistrationSource?: string;
}): AcquisitionLayers {
  const source = sourceByName(input.acquisitionSource);
  return {
    originalAcquisitionSource: input.acquisitionSource,
    crmSystem: input.crmSystem ?? "Not recorded",
    campaignPlatform: input.campaignPlatform ?? source?.platform ?? "Not recorded",
    communicationChannel: input.communicationChannel ?? source?.channel ?? "Not recorded",
    eventRegistrationSource: input.eventRegistrationSource ?? "Not recorded",
  };
}

/* --------------------- Touchpoint event taxonomy ---------------------- */

/**
 * The broad meaning of a touchpoint. Reports rely on this so an import (a data
 * event) is never counted the same way as an answered sales conversation.
 */
export type TouchpointCategory =
  | "Acquisition"
  | "Marketing"
  | "Events"
  | "Sales"
  | "Enrolment"
  | "Internal";

export const TOUCHPOINT_CATEGORIES: TouchpointCategory[] = [
  "Acquisition",
  "Marketing",
  "Events",
  "Sales",
  "Enrolment",
  "Internal",
];

export const TOUCHPOINT_CATEGORY_TONES: Record<TouchpointCategory, BadgeTone> = {
  Acquisition: "neutral",
  Marketing: "secondary",
  Events: "accent",
  Sales: "primary",
  Enrolment: "success",
  Internal: "neutral",
};

/**
 * HOW MUCH a touchpoint actually represents contact with the prospect:
 *   - Data event          → a record change (import, audience add, delivery)
 *   - Outbound attempt    → we reached out; not proof they engaged
 *   - Customer interaction→ a two-way moment with the prospect
 *   - Outcome             → a decision or milestone was recorded
 */
export type EngagementLevel =
  | "Data event"
  | "Outbound attempt"
  | "Customer interaction"
  | "Outcome";

export interface TouchpointTypeDef {
  type: string;
  category: TouchpointCategory;
  engagement: EngagementLevel;
  refType: TouchpointRefType;
  /** Data events are recorded but never qualify as a first/second/latest touch. */
  qualifying: boolean;
}

function def(
  type: string,
  category: TouchpointCategory,
  engagement: EngagementLevel,
  refType: TouchpointRefType = "manual",
): TouchpointTypeDef {
  return { type, category, engagement, refType, qualifying: engagement !== "Data event" };
}

/**
 * Every supported touchpoint type, grouped by the customer-journey meaning it
 * carries. This is the single source of truth used to categorise touchpoints,
 * so importing a contact, sending an invitation and answering a call are all
 * recorded honestly and distinguishably.
 */
export const TOUCHPOINT_TYPES: TouchpointTypeDef[] = [
  /* Marketing */
  def("Contact acquired", "Acquisition", "Data event"),
  def("Added to campaign audience", "Acquisition", "Data event"),
  def("Invitation sent", "Marketing", "Outbound attempt", "email"),
  def("Email delivered", "Marketing", "Data event", "email"),
  def("Email opened", "Marketing", "Customer interaction", "email"),
  def("Campaign clicked", "Marketing", "Customer interaction", "campaign"),
  /* Events */
  def("Event registered", "Events", "Customer interaction", "event"),
  def("Registration cancelled", "Events", "Outcome", "event"),
  def("Information session attended", "Events", "Customer interaction", "event"),
  def("Did not attend", "Events", "Outcome", "event"),
  /* Sales */
  def("Zoom Phone call attempted", "Sales", "Outbound attempt", "call"),
  def("Call answered", "Sales", "Customer interaction", "call"),
  def("Call unanswered", "Sales", "Outbound attempt", "call"),
  def("Sales conversation outcome recorded", "Sales", "Outcome", "call"),
  def("Follow-up email sent", "Sales", "Outbound attempt", "email"),
  def("Incoming email received", "Sales", "Customer interaction", "email"),
  def("Employer meeting recorded", "Sales", "Customer interaction", "meeting"),
  def("Employer commitment recorded", "Sales", "Outcome", "manual"),
  def("Closing decision recorded", "Sales", "Outcome", "manual"),
  /* Enrolment */
  def("Eligibility assessment completed", "Enrolment", "Outcome", "manual"),
  def("Future intake selected", "Enrolment", "Outcome", "manual"),
  def("Application submitted", "Enrolment", "Customer interaction", "application"),
  def("Employer agreement signed", "Enrolment", "Outcome", "manual"),
  def("DAS/provider addition confirmed", "Enrolment", "Outcome", "manual"),
  def("Enrolment completed", "Enrolment", "Outcome", "manual"),
  def("Apprenticeship start confirmed", "Enrolment", "Outcome", "manual"),
  /* Internal */
  def("Planner task", "Internal", "Data event", "manual"),
  def("Record updated", "Internal", "Data event", "manual"),
];

/** Legacy / general types kept so older saved touchpoints still resolve. */
const LEGACY_TYPE_DEFAULTS: Record<string, TouchpointTypeDef> = {
  "Web form": def("Web form", "Acquisition", "Customer interaction", "manual"),
  "Inbound call": def("Inbound call", "Sales", "Customer interaction", "call"),
  "Outbound call": def("Outbound call", "Sales", "Outbound attempt", "call"),
  "Email sent": def("Email sent", "Marketing", "Outbound attempt", "email"),
  "Email reply": def("Email reply", "Sales", "Customer interaction", "email"),
  "Event registration": def("Event registration", "Events", "Customer interaction", "event"),
  "Event attendance": def("Event attendance", "Events", "Customer interaction", "event"),
  Meeting: def("Meeting", "Sales", "Customer interaction", "meeting"),
  "Webinar attended": def("Webinar attended", "Events", "Customer interaction", "event"),
  "Application submitted": def("Application submitted", "Enrolment", "Customer interaction", "application"),
  "Manual note": def("Manual note", "Sales", "Customer interaction", "manual"),
  Other: def("Other", "Internal", "Data event", "manual"),
};

const TYPE_INDEX: Record<string, TouchpointTypeDef> = [
  ...TOUCHPOINT_TYPES,
  ...Object.values(LEGACY_TYPE_DEFAULTS),
].reduce<Record<string, TouchpointTypeDef>>((acc, entry) => {
  acc[entry.type] = entry;
  return acc;
}, {});

/** Resolves the definition for a touchpoint type, with a safe fallback. */
export function touchpointTypeDef(type: string): TouchpointTypeDef {
  return (
    TYPE_INDEX[type] ?? {
      type,
      category: "Sales",
      engagement: "Customer interaction",
      refType: "manual",
      qualifying: true,
    }
  );
}

const CATEGORY_INDEX: Record<string, TouchpointCategory> = TOUCHPOINT_TYPES.reduce<
  Record<string, TouchpointCategory>
>((acc, entry) => {
  acc[entry.type] = entry.category;
  return acc;
}, {});

/** Category for an interaction type. Used by the migration and the seed. */
export function categoryForInteractionType(type: string): TouchpointCategory {
  return CATEGORY_INDEX[type] ?? touchpointTypeDef(type).category;
}

/** The resolved category of a stored touchpoint (falls back to inference). */
export function resolveCategory(t: Pick<Touchpoint, "interactionType" | "category">): TouchpointCategory {
  return t.category ?? categoryForInteractionType(t.interactionType);
}

/** Whether a touchpoint counts as a qualifying attribution interaction. */
export function isQualifyingTouch(
  t: Pick<Touchpoint, "interactionType" | "category">,
): boolean {
  const category = resolveCategory(t);
  if (category === "Internal") return false;
  return touchpointTypeDef(t.interactionType).qualifying;
}

/** Human-readable explanation of the attribution definitions, surfaced in the UI. */
export const ATTRIBUTION_DEFINITIONS = [
  "First Touch — the earliest recorded qualifying interaction (imports and data events are excluded).",
  "Second Touch — the second qualifying interaction in chronological order.",
  "Latest Touch — the most recent qualifying interaction recorded.",
  "Closing Touch — the interaction explicitly recorded against the closing decision; it never changes after other activity.",
  "Original acquisition source is preserved separately from the First Touch timeline.",
] as const;

export const INTERACTION_TYPES = TOUCHPOINT_TYPES.map((t) => t.type);

export type InteractionType = string;

export const TOUCHPOINT_OUTCOMES = [
  "Positive",
  "Neutral",
  "No answer",
  "Converted",
  "Rejected",
  "Referred",
] as const;

export type TouchpointOutcome = (typeof TOUCHPOINT_OUTCOMES)[number];

export const LOSS_REASONS = [
  "Chose another provider",
  "Funding not secured",
  "Entry requirements not met",
  "Timing / intake unsuitable",
  "No response after follow-ups",
  "Cost / budget",
  "Withdrew for personal reasons",
  "Unknown",
] as const;

export const OUTCOME_TONES: Record<TouchpointOutcome, BadgeTone> = {
  Positive: "success",
  Neutral: "neutral",
  "No answer": "warning",
  Converted: "success",
  Rejected: "danger",
  Referred: "accent",
};

export interface AttributionCampaign {
  id: string;
  name: string;
  source: string;
  channel: string;
}

export const CAMPAIGNS: AttributionCampaign[] = [
  { id: "CMP-1001", name: "Autumn CMI Lead Gen", source: "Facebook Ads", channel: "Paid Social" },
  { id: "CMP-1002", name: "Project Controls Search", source: "Google Ads", channel: "Paid Search" },
  { id: "CMP-1003", name: "Apprenticeship Employer Push", source: "LinkedIn", channel: "Paid Social" },
  { id: "CMP-1004", name: "October Newsletter", source: "Email Campaigns", channel: "Email" },
  { id: "CMP-1005", name: "Postgraduate Open Evening", source: "Eventbrite", channel: "Events" },
  { id: "CMP-1006", name: "Winter Webinar Series", source: "Zoom Webinars", channel: "Webinar" },
  { id: "CMP-1007", name: "Careers Advisor Referrals", source: "Referral", channel: "Referral" },
];

export function campaignById(id: string | undefined): AttributionCampaign | undefined {
  if (!id) return undefined;
  return CAMPAIGNS.find((c) => c.id === id);
}

/**
 * The chronological attribution journey for a single lead. First and second
 * touch are derived from chronological order; the closing touch is the
 * touchpoint explicitly flagged as closing and is never overwritten by later
 * interactions.
 */
export interface LeadJourney {
  /** Full chronological timeline, including data events, for display. */
  ordered: Touchpoint[];
  /** Only the interactions that qualify for first/second/latest attribution. */
  qualifying: Touchpoint[];
  first?: Touchpoint;
  second?: Touchpoint;
  latest?: Touchpoint;
  closing?: Touchpoint;
  additionalCount: number;
}

export function buildJourney(input: Touchpoint[] | undefined | null): LeadJourney {
  // Defensive: an older saved record (or a partially written one) may not have
  // a touchpoints array at all. Never assume it exists.
  const list = Array.isArray(input) ? input : [];
  const ordered = list
    .filter((t): t is Touchpoint => Boolean(t && t.timestamp))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const qualifying = ordered.filter((t) => isQualifyingTouch(t));
  const closingSet = ordered
    .filter((t) => t.isClosing)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  return {
    ordered,
    qualifying,
    first: qualifying[0],
    second: qualifying[1],
    latest: qualifying[qualifying.length - 1],
    closing: closingSet[closingSet.length - 1],
    additionalCount: Math.max(0, qualifying.length - 2),
  };
}

/** Highest-anchored location of the closing interaction for a lead. */
export function closingTouchpoint(
  touchpoints: import("@/store/types").Touchpoint[],
): import("@/store/types").Touchpoint | undefined {
  return buildJourney(touchpoints).closing;
}

export const CHANNELS = Array.from(new Set(ACQUISITION_SOURCES.map((s) => s.channel)));