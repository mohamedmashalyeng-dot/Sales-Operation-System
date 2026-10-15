/**
 * End-to-end demonstration scenarios for the Kent Business College workspace.
 *
 * Each scenario walks a real shared demo record through the actual screens —
 * Leads, Campaigns, Events, Zoom, Planner, Applications, Future Intake,
 * Commercial and Sources & Attribution — and is validated against the live
 * dataset. Nothing here fabricates a link: if a record is missing, the UI shows
 * an honest missing-record state.
 */

export interface ScenarioStep {
  id: string;
  label: string;
  detail: string;
  module: string;
  icon: string;
  /** Real in-app route that opens the underlying record, when one exists. */
  route?: string;
}

export type ExpectationKind =
  | "lead-exists"
  | "source"
  | "campaign-matched"
  | "registered"
  | "attended"
  | "no-session"
  | "call-linked"
  | "call-answered"
  | "transcript"
  | "follow-up-linked"
  | "application-linked"
  | "future-intake"
  | "commercial"
  | "employer-commitment"
  | "eligibility-decision"
  | "closing-touch"
  | "enrolment"
  | "chronology"
  | "no-duplicate-touchpoints";

export interface ScenarioExpectation {
  id: string;
  label: string;
  kind: ExpectationKind;
  /** Referenced record id (campaign, event, call, application…). */
  refId?: string;
  /** Expected value (source name, eligibility decision, enrolment stage…). */
  value?: string;
}

export interface ScenarioDef {
  id: string;
  key: string;
  title: string;
  summary: string;
  leadId: string;
  roles: string;
  steps: ScenarioStep[];
  expectations: ScenarioExpectation[];
  manualChecks: string[];
  reportImpact: string[];
  related: {
    leadRoute: string;
    sourceRoute: string;
  };
}

const ALL_SCENARIOS: ScenarioDef[] = [
  {
    id: "A",
    key: "scenario-a",
    title: "Eventbrite campaign + Zoom information session",
    summary:
      "Apollo.io sourced contact invited by an Eventbrite campaign, registered, attended the Zoom information session, completed a Zoom Phone sales call and submitted an application.",
    leadId: "L-2061",
    roles: "Sales · Enrolment · Manager · Admin",
    steps: [
      {
        id: "a1",
        label: "Apollo.io contact sourced",
        detail: "Contact sourced from Apollo.io and stored in Zoho CRM.",
        module: "Zoho CRM",
        icon: "ri-radar-line",
        route: "/zoho",
      },
      {
        id: "a2",
        label: "Eventbrite campaign invitation",
        detail: "Invitation sent from the Apollo outreach Eventbrite campaign (simulated).",
        module: "Campaigns",
        icon: "ri-megaphone-line",
        route: "/campaigns",
      },
      {
        id: "a3",
        label: "Event registration",
        detail: "Registered for the Professional Pathways information session.",
        module: "Events",
        icon: "ri-calendar-event-line",
        route: "/events/EV-2105",
      },
      {
        id: "a4",
        label: "Zoom information session",
        detail: "Attendance confirmed for the Zoom Meetings information session.",
        module: "Zoom",
        icon: "ri-vidicon-line",
        route: "/zoom",
      },
      {
        id: "a5",
        label: "Zoom Phone sales call",
        detail: "Advisory call completed; application link sent.",
        module: "Zoom",
        icon: "ri-phone-line",
        route: "/leads",
      },
      {
        id: "a6",
        label: "Application submitted",
        detail: "Application submitted for CMI Level 6.",
        module: "Applications",
        icon: "ri-file-list-3-line",
        route: "/applications/APP-50250",
      },
    ],
    expectations: [
      { id: "a-src", label: "Original acquisition source is Apollo.io", kind: "source", value: "Apollo.io" },
      { id: "a-lead", label: "Lead record exists with a unique Lead ID", kind: "lead-exists" },
      { id: "a-campaign", label: "Campaign audience matched to the existing lead (no duplicate)", kind: "campaign-matched", refId: "CMP-EV-3004" },
      { id: "a-reg", label: "Event registration recorded (not cancelled)", kind: "registered", refId: "EV-2105" },
      { id: "a-att", label: "Information-session attendance explicitly recorded", kind: "attended" },
      { id: "a-call", label: "Zoom Phone call linked to the lead", kind: "call-linked", refId: "CL-5512" },
      { id: "a-ans", label: "Zoom Phone call was answered", kind: "call-answered", refId: "CL-5512" },
      { id: "a-app", label: "Application linked to the lead", kind: "application-linked", refId: "APP-50250" },
      { id: "a-chron", label: "Qualifying touchpoints are in chronological order", kind: "chronology" },
      { id: "a-dup", label: "No duplicate touchpoints recorded", kind: "no-duplicate-touchpoints" },
    ],
    manualChecks: [
      "Browser click-through of every step route",
      "Role-scoped visibility for Staff Sales and Staff Enrolment",
      "Refresh persistence of the journey",
    ],
    reportImpact: [
      "Counts once toward Apollo-sourced contacts and Apollo CRM leads",
      "Counts once as an invited Apollo lead and as a confirmed attendee",
      "Counts once as an Apollo lead reached by Zoom Phone and with an application",
    ],
    related: { leadRoute: "/leads/L-2061", sourceRoute: "/sources?tab=conversion" },
  },
  {
    id: "B",
    key: "scenario-b",
    title: "No information session",
    summary:
      "Apollo.io sourced contact invited by an Eventbrite campaign, progressed straight to a Zoom Phone sales call and an application without attending any information session.",
    leadId: "L-2062",
    roles: "Sales · Manager · Admin",
    steps: [
      {
        id: "b1",
        label: "Apollo.io contact sourced",
        detail: "Contact sourced from Apollo.io and stored in Zoho CRM.",
        module: "Zoho CRM",
        icon: "ri-radar-line",
        route: "/zoho",
      },
      {
        id: "b2",
        label: "Eventbrite invitation sent",
        detail: "Invitation sent (invited, never registered).",
        module: "Campaigns",
        icon: "ri-megaphone-line",
        route: "/campaigns",
      },
      {
        id: "b3",
        label: "Zoom Phone sales call",
        detail: "Sales call completed without any session attendance.",
        module: "Zoom",
        icon: "ri-phone-line",
        route: "/leads",
      },
      {
        id: "b4",
        label: "Application submitted",
        detail: "Application submitted for Project Controls Professional Level 6.",
        module: "Applications",
        icon: "ri-file-list-3-line",
        route: "/applications/APP-50251",
      },
    ],
    expectations: [
      { id: "b-src", label: "Original acquisition source is Apollo.io", kind: "source", value: "Apollo.io" },
      { id: "b-lead", label: "Lead record exists with a unique Lead ID", kind: "lead-exists" },
      { id: "b-campaign", label: "Campaign audience matched to the existing lead (no duplicate)", kind: "campaign-matched", refId: "CMP-EV-3004" },
      { id: "b-none", label: "No information-session registration (session is optional)", kind: "no-session" },
      { id: "b-call", label: "Zoom Phone call linked to the lead", kind: "call-linked", refId: "CL-5515" },
      { id: "b-ans", label: "Zoom Phone call was answered", kind: "call-answered", refId: "CL-5515" },
      { id: "b-app", label: "Application linked to the lead", kind: "application-linked", refId: "APP-50251" },
      { id: "b-chron", label: "Qualifying touchpoints are in chronological order", kind: "chronology" },
      { id: "b-dup", label: "No duplicate touchpoints recorded", kind: "no-duplicate-touchpoints" },
    ],
    manualChecks: [
      "Browser click-through of every step route",
      "Confirm the application is reachable without a session step",
    ],
    reportImpact: [
      "Counts as an invited Apollo lead but NOT as a registrant or attendee",
      "Counts toward the 'never registered' session group — never penalised",
      "Counts once as an Apollo lead with an application",
    ],
    related: { leadRoute: "/leads/L-2062", sourceRoute: "/sources?tab=conversion" },
  },
  {
    id: "C",
    key: "scenario-c",
    title: "Direct website route",
    summary:
      "A direct website enquiry that progressed through eligibility review, a direct application and enrolment with no Eventbrite event or Zoom information session at all.",
    leadId: "L-2067",
    roles: "Enrolment · Manager · Admin",
    steps: [
      {
        id: "c1",
        label: "Website enquiry",
        detail: "Enquiry submitted directly through the Kent Business College website.",
        module: "Leads",
        icon: "ri-global-line",
        route: "/leads/L-2067",
      },
      {
        id: "c2",
        label: "Eligibility review",
        detail: "Funding eligibility verified — kept separate from the sales pipeline.",
        module: "Leads",
        icon: "ri-shield-check-line",
        route: "/leads/L-2067",
      },
      {
        id: "c3",
        label: "Direct application",
        detail: "Application submitted with no campaign or information session.",
        module: "Applications",
        icon: "ri-file-list-3-line",
        route: "/applications/APP-50253",
      },
      {
        id: "c4",
        label: "Enrolment completed",
        detail: "Employer agreement and DAS confirmed, then enrolled.",
        module: "Leads",
        icon: "ri-graduation-cap-line",
        route: "/leads/L-2067",
      },
    ],
    expectations: [
      { id: "c-src", label: "Original acquisition source is Website", kind: "source", value: "Website" },
      { id: "c-lead", label: "Lead record exists with a unique Lead ID", kind: "lead-exists" },
      { id: "c-none", label: "No Eventbrite registration and no Zoom information session", kind: "no-session" },
      { id: "c-elig", label: "Verified eligible for funding", kind: "eligibility-decision", value: "Verified Eligible" },
      { id: "c-app", label: "Application linked to the lead", kind: "application-linked", refId: "APP-50253" },
      { id: "c-close", label: "Explicit closing touch recorded", kind: "closing-touch" },
      { id: "c-enrol", label: "Enrolment completed", kind: "enrolment", value: "Enrolled" },
      { id: "c-chron", label: "Qualifying touchpoints are in chronological order", kind: "chronology" },
      { id: "c-dup", label: "No duplicate touchpoints recorded", kind: "no-duplicate-touchpoints" },
    ],
    manualChecks: [
      "Browser click-through of every step route",
      "Confirm no session step is required anywhere in the flow",
    ],
    reportImpact: [
      "Counts once toward Website enquiries",
      "Counts as a 'never registered' prospect — direct routes are never penalised",
      "Counts once as an enrolment without any session attribution",
    ],
    related: { leadRoute: "/leads/L-2067", sourceRoute: "/sources?tab=conversion" },
  },
  {
    id: "D",
    key: "scenario-d",
    title: "Direct Eventbrite registration → future intake",
    summary:
      "A direct Eventbrite registrant followed up by Sales, found provisionally eligible, moved to a future intake and given a scheduled follow-up.",
    leadId: "L-2033",
    roles: "Sales · Enrolment · Manager · Admin",
    steps: [
      {
        id: "d1",
        label: "Direct Eventbrite registration",
        detail: "Registered directly through a public Eventbrite listing.",
        module: "Events",
        icon: "ri-calendar-event-line",
        route: "/events/EV-2101",
      },
      {
        id: "d2",
        label: "Sales call",
        detail: "Advisory call following the registration.",
        module: "Zoom",
        icon: "ri-phone-line",
        route: "/leads",
      },
      {
        id: "d3",
        label: "Provisionally eligible",
        detail: "Screening recorded as provisionally eligible.",
        module: "Leads",
        icon: "ri-shield-check-line",
        route: "/leads/L-2033",
      },
      {
        id: "d4",
        label: "Future Intake",
        detail: "Moved to a later intake — never counted as lost.",
        module: "Future Intake",
        icon: "ri-calendar-schedule-line",
        route: "/future-intake",
      },
      {
        id: "d5",
        label: "Scheduled follow-up",
        detail: "A Planner follow-up is scheduled against the intake.",
        module: "Planner",
        icon: "ri-calendar-todo-line",
        route: "/planner",
      },
    ],
    expectations: [
      { id: "d-src", label: "Original acquisition source is Eventbrite", kind: "source", value: "Eventbrite" },
      { id: "d-lead", label: "Lead record exists with a unique Lead ID", kind: "lead-exists" },
      { id: "d-reg", label: "Event registration recorded", kind: "registered", refId: "EV-2101" },
      { id: "d-call", label: "Sales call linked to the lead", kind: "call-linked", refId: "CL-5506" },
      { id: "d-fi", label: "Future Intake record exists for the lead", kind: "future-intake" },
      { id: "d-chron", label: "Qualifying touchpoints are in chronological order", kind: "chronology" },
    ],
    manualChecks: [
      "Browser click-through of every step route",
      "Confirm Future Intake is not classified as Closed Lost",
    ],
    reportImpact: [
      "Counts once toward Eventbrite-sourced contacts and registrants",
      "Counts as a Future Intake opportunity — excluded from Closed Lost",
    ],
    related: { leadRoute: "/leads/L-2033", sourceRoute: "/sources?tab=conversion" },
  },
  {
    id: "E",
    key: "scenario-e",
    title: "Commercial opportunity",
    summary:
      "An Apollo.io sourced contact reviewed for funding eligibility, found not eligible, then referred for a commercial review and captured as a commercial opportunity.",
    leadId: "L-2064",
    roles: "Sales · Enrolment · Manager · Admin",
    steps: [
      {
        id: "e1",
        label: "Zoom Phone sales call",
        detail: "Sales call recorded the funding concern.",
        module: "Zoom",
        icon: "ri-phone-line",
        route: "/leads",
      },
      {
        id: "e2",
        label: "Funding eligibility review",
        detail: "Eligibility reviewed against funding rules.",
        module: "Leads",
        icon: "ri-shield-check-line",
        route: "/leads/L-2064",
      },
      {
        id: "e3",
        label: "Not eligible for funding",
        detail: "Decision recorded without altering acquisition or interaction history.",
        module: "Leads",
        icon: "ri-close-circle-line",
        route: "/leads/L-2064",
      },
      {
        id: "e4",
        label: "Commercial referral",
        detail: "Referred for a commercial review and captured as an opportunity.",
        module: "Commercial",
        icon: "ri-briefcase-4-line",
        route: "/commercial",
      },
    ],
    expectations: [
      { id: "e-src", label: "Original acquisition source is Apollo.io", kind: "source", value: "Apollo.io" },
      { id: "e-lead", label: "Lead record exists with a unique Lead ID", kind: "lead-exists" },
      { id: "e-call", label: "Zoom Phone call linked to the lead", kind: "call-linked", refId: "CL-5514" },
      { id: "e-ans", label: "Zoom Phone call was answered", kind: "call-answered", refId: "CL-5514" },
      { id: "e-elig", label: "Funding decision recorded as Not Eligible for Funding", kind: "eligibility-decision", value: "Not Eligible for Funding" },
      { id: "e-com", label: "Commercial opportunity linked to the lead", kind: "commercial" },
      { id: "e-chron", label: "Qualifying touchpoints are in chronological order", kind: "chronology" },
    ],
    manualChecks: [
      "Browser click-through of every step route",
      "Confirm the commercial referral did not overwrite the acquisition source",
    ],
    reportImpact: [
      "Counts once as an Apollo CRM lead and as a commercial referral",
      "Counts toward Not Eligible for Funding — never as a funded apprenticeship start",
    ],
    related: { leadRoute: "/leads/L-2064", sourceRoute: "/sources?tab=conversion" },
  },
  {
    id: "F",
    key: "scenario-f",
    title: "Recorded call, follow-up & explicit closing touch",
    summary:
      "A recorded Zoom Phone call with a fictional transcript, a sales outcome, a Planner follow-up, an employer commitment and an explicitly recorded closing touch.",
    leadId: "L-2065",
    roles: "Sales · Enrolment · Manager · Admin",
    steps: [
      {
        id: "f1",
        label: "Zoom Phone call",
        detail: "Recorded call with the employer contact.",
        module: "Zoom",
        icon: "ri-phone-line",
        route: "/leads",
      },
      {
        id: "f2",
        label: "Transcript review",
        detail: "Searchable, timestamped fictional transcript reviewed.",
        module: "Zoom",
        icon: "ri-file-text-line",
        route: "/leads",
      },
      {
        id: "f3",
        label: "Sales outcome recorded",
        detail: "Sales outcome recorded from the call review.",
        module: "Zoom",
        icon: "ri-record-circle-line",
        route: "/leads",
      },
      {
        id: "f4",
        label: "Planner follow-up",
        detail: "A follow-up task was explicitly scheduled from the call.",
        module: "Planner",
        icon: "ri-calendar-todo-line",
        route: "/planner",
      },
      {
        id: "f5",
        label: "Employer commitment",
        detail: "Employer agreement signed and tracked separately from enrolment.",
        module: "Employers",
        icon: "ri-building-2-line",
        route: "/employers",
      },
      {
        id: "f6",
        label: "Explicit closing touch",
        detail: "Closing decision recorded explicitly; later activity never overwrites it.",
        module: "Leads",
        icon: "ri-flag-2-line",
        route: "/leads/L-2065",
      },
    ],
    expectations: [
      { id: "f-src", label: "Original acquisition source is Apollo.io", kind: "source", value: "Apollo.io" },
      { id: "f-lead", label: "Lead record exists with a unique Lead ID", kind: "lead-exists" },
      { id: "f-call", label: "Zoom Phone call linked to the lead", kind: "call-linked", refId: "CL-5511" },
      { id: "f-ans", label: "Zoom Phone call was answered", kind: "call-answered", refId: "CL-5511" },
      { id: "f-trans", label: "A transcript is flagged available for the call", kind: "transcript", refId: "CL-5511" },
      { id: "f-follow", label: "A Planner follow-up is linked to the call", kind: "follow-up-linked", refId: "CL-5511" },
      { id: "f-emp", label: "Employer commitment recorded", kind: "employer-commitment" },
      { id: "f-close", label: "Explicit closing touch recorded", kind: "closing-touch" },
      { id: "f-app", label: "Application linked to the lead", kind: "application-linked", refId: "APP-50252" },
      { id: "f-enrol", label: "Enrolment completed", kind: "enrolment", value: "Enrolled" },
      { id: "f-chron", label: "Qualifying touchpoints are in chronological order", kind: "chronology" },
      { id: "f-dup", label: "No duplicate touchpoints recorded", kind: "no-duplicate-touchpoints" },
    ],
    manualChecks: [
      "Browser click-through of every step route",
      "Confirm the closing touch is unchanged by later enrolment activity",
    ],
    reportImpact: [
      "Counts once as an Apollo lead reached by Zoom Phone and closed won",
      "Counts once as an employer commitment, application and enrolment",
      "Closing touch remains stable after the enrolment record is added",
    ],
    related: { leadRoute: "/leads/L-2065", sourceRoute: "/sources?tab=conversion" },
  },
];

// Walkthroughs for removed modules are no longer offered in the workspace.
export const SCENARIOS = ALL_SCENARIOS.filter(scenario =>
  !scenario.steps.some(step => step.route && /^\/(campaigns|future-intake|sources)(?:[/?]|$)/.test(step.route)));

export function scenarioById(id: string): ScenarioDef | undefined {
  return SCENARIOS.find((s) => s.id === id || s.key === id);
}
