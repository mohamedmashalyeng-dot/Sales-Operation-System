import type {
  Application,
  Call,
  CampaignRecipient,
  CollegeEvent,
  CommercialOpportunity,
  DasRecord,
  EligibilityAssessment,
  EligibilityResponse,
  EmployerAgreement,
  EventCampaign,
  FutureIntakeRecord,
  Lead,
  Meeting,
  ParticipationOutcome,
  Task,
  Touchpoint,
  TranscriptSegment,
} from "@/store/types";
import type { EligibilityStatus, EvidenceStatus, ScreeningAnswer } from "@/config/eligibility";
import { ELIGIBILITY_QUESTIONS } from "@/config/eligibility";
import { categoryForInteractionType } from "@/config/attribution";
import { at } from "@/store/seed/helpers";

/**
 * Apollo.io-sourced demonstration leads.
 *
 * These are genuine individual Lead records whose OWN original acquisition
 * source is Apollo.io — not merely campaign-audience membership. They exist so
 * the reporting can distinguish:
 *   - Apollo-sourced contacts inside a campaign audience
 *   - Apollo-sourced CRM Leads
 *   - Apollo Leads invited / registered / reached / qualified / applied / enrolled
 *
 * Every record is fictional. IDs are stable so the v4 → v5 migration can add
 * them without ever duplicating or overwriting existing data.
 */

/* ------------------------------- helpers ------------------------------- */

type AnswerSeed = {
  answer: ScreeningAnswer;
  evidence?: EvidenceStatus;
  notes?: string;
  weeklyHours?: number;
  checkedById?: string;
};

function assessment(
  status: EligibilityStatus,
  answers: Record<string, AnswerSeed>,
  extra: Partial<EligibilityAssessment> = {},
): EligibilityAssessment {
  const responses: EligibilityResponse[] = ELIGIBILITY_QUESTIONS.map((q) => {
    const seed = answers[q.id];
    return {
      questionId: q.id,
      answer: seed?.answer ?? "Unknown",
      evidence: seed?.evidence ?? "Not Requested",
      notes: seed?.notes ?? "",
      weeklyHours: seed?.weeklyHours,
      checkedById: seed?.checkedById,
      checkedAt: seed ? at(-2, 11, 0) : undefined,
    };
  });
  return { status, responses, updatedAt: at(-2, 11, 0), ...extra };
}

const EVIDENCE_OK: Record<string, AnswerSeed> = {
  "eq-residency": { answer: "Yes", evidence: "Verified", checkedById: "u-hannah" },
  "eq-immigration": { answer: "Yes", evidence: "Verified", checkedById: "u-hannah" },
  "eq-other-funding": { answer: "No", evidence: "Verified", checkedById: "u-hannah" },
  "eq-employment-type": { answer: "Yes", evidence: "Verified", checkedById: "u-hannah" },
  "eq-paid-hours": { answer: "Yes", evidence: "Verified", weeklyHours: 37, checkedById: "u-hannah" },
  "eq-employer-england": { answer: "Yes", evidence: "Verified", checkedById: "u-hannah" },
  "eq-hours-england": { answer: "Yes", evidence: "Verified", checkedById: "u-hannah" },
};

/* ----------------------------- the leads ------------------------------- */

export function buildApolloLeads(): Lead[] {
  return [
    /* Scenario A — Apollo → Eventbrite invitation → registration → Zoom session → Sales call → application */
    {
      id: "L-2061",
      name: "Olivia Hartley",
      contactName: "Olivia Hartley",
      email: "olivia.hartley@meridian-group.co.uk",
      phone: "+44 7700 900611",
      programme: "CMI Level 6",
      intake: "September 2026",
      source: "Apollo.io",
      channel: "Outreach",
      platform: "Apollo.io",
      ownerId: "u-leila",
      originalOwnerId: "u-leila",
      stage: "Qualified",
      priority: "High",
      value: 3200,
      createdAt: at(-28, 9, 0),
      acquisitionDate: at(-28, 9, 0),
      lastContactAt: at(-3, 10, 0),
      nextAction: "Review submitted application",
      nextActionAt: at(1, 10, 0),
      tags: ["CMI", "Apollo", "Information session"],
      zohoSynced: true,
      zohoId: "ZH-881301",
      notes: [
        {
          id: "n-ap-1",
          body: "Sourced from Apollo.io, managed in Zoho CRM and invited through Eventbrite. Attended the Zoom information session.",
          authorId: "u-leila",
          createdAt: at(-8, 10, 30),
        },
      ],
      applicationIds: ["APP-50250"],
      eligibility: assessment("Provisionally Eligible", EVIDENCE_OK),
      intakePlanning: "Current Intake",
      enrolment: "Application",
    },
    /* Scenario B — Apollo → Eventbrite invitation → Sales call → application, no session */
    {
      id: "L-2062",
      name: "Nathan Cole",
      contactName: "Nathan Cole",
      email: "nathan.cole@bramblewood.co.uk",
      phone: "+44 7700 900612",
      programme: "Project Controls Professional Level 6",
      intake: "January 2026",
      source: "Apollo.io",
      channel: "Outreach",
      platform: "Apollo.io",
      ownerId: "u-tom",
      originalOwnerId: "u-tom",
      stage: "Qualified",
      priority: "High",
      value: 5400,
      createdAt: at(-27, 10, 0),
      acquisitionDate: at(-27, 10, 0),
      lastContactAt: at(-5, 11, 0),
      nextAction: "Confirm funding route",
      nextActionAt: at(1, 14, 0),
      tags: ["Project Controls", "Apollo"],
      zohoSynced: true,
      zohoId: "ZH-881302",
      notes: [
        {
          id: "n-ap-2",
          body: "Invited via Eventbrite but never registered for an information session. Progressed straight to a Zoom Phone call and application.",
          authorId: "u-tom",
          createdAt: at(-6, 11, 30),
        },
      ],
      applicationIds: ["APP-50251"],
      eligibility: assessment("Screening In Progress", {
        "eq-residency": { answer: "Yes", evidence: "Received", checkedById: "u-hannah" },
        "eq-paid-hours": { answer: "Yes", evidence: "Received", weeklyHours: 34, checkedById: "u-hannah" },
      }),
      intakePlanning: "Current Intake",
      enrolment: "Application",
    },
    /* Journey 3 — Apollo → Zoom call → eligible but waiting for future intake */
    {
      id: "L-2063",
      name: "Simone Dubois",
      contactName: "Simone Dubois",
      email: "simone.dubois@lumenpartners.co.uk",
      phone: "+44 7700 900613",
      programme: "Operations Manager Level 5",
      intake: "May 2027",
      source: "Apollo.io",
      channel: "Outreach",
      platform: "Apollo.io",
      ownerId: "u-leila",
      originalOwnerId: "u-leila",
      stage: "Nurture",
      priority: "Medium",
      value: 2700,
      createdAt: at(-30, 11, 0),
      acquisitionDate: at(-30, 11, 0),
      lastContactAt: at(-9, 14, 0),
      nextAction: "Re-engage ahead of the May 2027 intake",
      nextActionAt: at(3, 10, 0),
      tags: ["Operations", "Apollo", "Future intake"],
      zohoSynced: true,
      zohoId: "ZH-881303",
      notes: [
        {
          id: "n-ap-3",
          body: "Eligible but wants a later intake. Remains an active Future Intake opportunity — never counted as lost.",
          authorId: "u-leila",
          createdAt: at(-4, 10, 20),
        },
      ],
      applicationIds: [],
      eligibility: assessment("Provisionally Eligible", EVIDENCE_OK),
      intakePlanning: "Future Intake",
      enrolment: "Not Started",
    },
    /* Journey 4 — Apollo → eligibility review → commercial referral */
    {
      id: "L-2064",
      name: "Curtis Ballard",
      contactName: "Curtis Ballard",
      email: "curtis.ballard@halcyonworks.co.uk",
      phone: "+44 7700 900614",
      programme: "Digital Marketing Level 4",
      intake: "September 2026",
      source: "Apollo.io",
      channel: "Outreach",
      platform: "Apollo.io",
      ownerId: "u-tom",
      originalOwnerId: "u-tom",
      stage: "Nurture",
      priority: "Medium",
      value: 1500,
      createdAt: at(-30, 13, 0),
      acquisitionDate: at(-30, 13, 0),
      lastContactAt: at(-20, 15, 0),
      nextAction: "Commercial suitability review",
      nextActionAt: at(2, 14, 0),
      tags: ["Digital", "Apollo", "Commercial"],
      zohoSynced: true,
      zohoId: "ZH-881304",
      notes: [
        {
          id: "n-ap-4",
          body: "Not eligible for government funding — referred for a commercial review. Acquisition and interaction history preserved.",
          authorId: "u-tom",
          createdAt: at(-20, 15, 30),
        },
      ],
      applicationIds: [],
      eligibility: assessment(
        "Not Eligible for Funding",
        {
          "eq-residency": { answer: "Yes", evidence: "Verified", checkedById: "u-hannah" },
          "eq-immigration": { answer: "Needs Review", evidence: "Received", notes: "Leave status not fundable for an apprenticeship.", checkedById: "u-hannah" },
          "eq-paid-hours": { answer: "No", evidence: "Verified", weeklyHours: 18, checkedById: "u-hannah" },
        },
        {
          decision: "Not Eligible for Funding",
          verificationDate: at(-20, 15, 40),
          decisionMakerId: "u-hannah",
          decisionReasons: "Weekly hours and leave status do not meet funding rules. Referred for commercial review.",
        },
      ),
      intakePlanning: "Unassigned",
      enrolment: "Not Started",
    },
    /* Scenario F + journey 5 — Apollo → Zoom call (transcript) → employer commitment → closing touch → application → enrolment */
    {
      id: "L-2065",
      name: "Helena Voss",
      contactName: "Helena Voss",
      email: "helena.voss@vossgroup.co.uk",
      phone: "+44 7700 900615",
      programme: "CMI Level 6",
      intake: "January 2026",
      source: "Apollo.io",
      channel: "Outreach",
      platform: "Apollo.io",
      ownerId: "u-amara",
      originalOwnerId: "u-amara",
      stage: "Won",
      priority: "High",
      value: 3200,
      createdAt: at(-46, 9, 30),
      acquisitionDate: at(-46, 9, 30),
      lastContactAt: at(-10, 10, 0),
      nextAction: "Onboarding complete — monitor first 12 weeks",
      nextActionAt: at(21, 9, 0),
      tags: ["CMI", "Apollo", "Closed Won"],
      zohoSynced: true,
      zohoId: "ZH-881305",
      notes: [
        {
          id: "n-ap-5",
          body: "Reviewed the recorded Zoom Phone call and transcript, then recorded an explicit closing touch after the employer commitment.",
          authorId: "u-amara",
          createdAt: at(-14, 10, 20),
        },
      ],
      applicationIds: ["APP-50252"],
      closing: {
        closingDate: at(-14, 10, 0),
        closingOwnerId: "u-amara",
        outcome: "won",
        interactionType: "Closing decision recorded",
        source: "Apollo.io",
        channel: "Outreach",
        campaign: "Apollo Outreach — Professional Pathways Invitation",
        notes: "Employer commitment confirmed after reviewing the recorded call; closing touch recorded explicitly.",
        touchpointId: "TP-2065-10",
        recordedAt: at(-14, 10, 20),
      },
      eligibility: assessment(
        "Verified Eligible",
        EVIDENCE_OK,
        {
          decision: "Verified Eligible",
          verificationDate: at(-15, 10, 0),
          decisionMakerId: "u-hannah",
          decisionReasons: "All evidence verified; employer committed to a levy-funded place.",
        },
      ),
      intakePlanning: "Intake Confirmed",
      enrolment: "Enrolled",
    },
    /* Journey 6 — Apollo contact who never responds to the campaign */
    {
      id: "L-2066",
      name: "Gary Thorne",
      contactName: "Gary Thorne",
      email: "gary.thorne@penrose-systems.co.uk",
      phone: "+44 7700 900616",
      programme: "Business Administration Level 3",
      intake: "September 2026",
      source: "Apollo.io",
      channel: "Outreach",
      platform: "Apollo.io",
      ownerId: "u-leila",
      originalOwnerId: "u-leila",
      stage: "New",
      priority: "Low",
      value: 2100,
      createdAt: at(-12, 15, 0),
      acquisitionDate: at(-12, 15, 0),
      lastContactAt: at(-11, 9, 40),
      nextAction: "Awaiting any response to the invitation",
      nextActionAt: at(4, 9, 0),
      tags: ["Business Admin", "Apollo"],
      zohoSynced: true,
      zohoId: "ZH-881306",
      notes: [
        {
          id: "n-ap-6",
          body: "Delivered the Eventbrite invitation but the contact has not responded. No qualified lead or engagement is implied.",
          authorId: "u-leila",
          createdAt: at(-11, 9, 45),
        },
      ],
      applicationIds: [],
    },
    /* Scenario C — additional demonstration lead: direct website route to enrolment (no Eventbrite / Zoom session) */
    {
      id: "L-2067",
      name: "Priti Sandhu",
      contactName: "Priti Sandhu",
      email: "priti.sandhu@westgate.com",
      phone: "+44 7700 900617",
      programme: "Business Administration Level 3",
      intake: "January 2026",
      source: "Website",
      channel: "Web",
      platform: "kentbusinesscollege.ac.uk",
      ownerId: "u-hannah",
      originalOwnerId: "u-hannah",
      stage: "Won",
      priority: "Medium",
      value: 2100,
      createdAt: at(-38, 10, 0),
      acquisitionDate: at(-38, 10, 0),
      lastContactAt: at(-11, 10, 0),
      nextAction: "Onboarding complete",
      nextActionAt: at(6, 9, 0),
      tags: ["Business Admin", "Direct"],
      zohoSynced: false,
      notes: [
        {
          id: "n-ap-7",
          body: "Enquired directly through the website. Reached enrolment with no Eventbrite registration or Zoom information session — information sessions are optional.",
          authorId: "u-hannah",
          createdAt: at(-11, 10, 30),
        },
      ],
      applicationIds: ["APP-50253"],
      closing: {
        closingDate: at(-12, 10, 0),
        closingOwnerId: "u-hannah",
        outcome: "won",
        interactionType: "Closing decision recorded",
        source: "Website",
        channel: "Web",
        notes: "Direct application route — closing decision recorded explicitly.",
        touchpointId: "TP-2067-7",
        recordedAt: at(-12, 10, 20),
      },
      eligibility: assessment(
        "Verified Eligible",
        EVIDENCE_OK,
        {
          decision: "Verified Eligible",
          verificationDate: at(-30, 10, 0),
          decisionMakerId: "u-hannah",
          decisionReasons: "All evidence verified through the direct application route.",
        },
      ),
      intakePlanning: "Intake Confirmed",
      enrolment: "Enrolled",
    },
  ];
}

/* ----------------------------- the campaign ---------------------------- */

function recipient(
  id: string,
  name: string,
  email: string,
  phone: string,
  leadId: string | undefined,
  outcome: ParticipationOutcome,
  extra: Partial<CampaignRecipient> = {},
): CampaignRecipient {
  return {
    id,
    name,
    email,
    phone,
    leadId,
    matched: Boolean(leadId),
    valid: true,
    duplicate: false,
    outcome,
    invitedAt: at(-24, 9, 30),
    ...extra,
  };
}

export function buildApolloCampaigns(): EventCampaign[] {
  return [
    {
      id: "CMP-EV-3004",
      name: "Apollo Outreach — Professional Pathways Invitation",
      type: "Email invitation",
      platform: "Eventbrite",
      channel: "Email",
      crmSystem: "Zoho CRM",
      acquisitionProvider: "Apollo.io",
      eventId: "EV-2105",
      stage: "Registration Received",
      ownerId: "u-leila",
      subject: "You're invited: Professional Pathways Information Session",
      body:
        "Hello,\n\nYou are invited to our Professional Pathways Information Session on Zoom. " +
        "Meet the programme leads, explore funding routes and ask any questions about our apprenticeship and " +
        "professional pathways.\n\nKind regards,\nKent Business College Admissions",
      audienceFileName: "zoho-export-apollo-professional-pathways.csv",
      recipients: [
        recipient("CR-31", "Olivia Hartley", "olivia.hartley@meridian-group.co.uk", "+44 7700 900611", "L-2061", "Attended", {
          registeredAt: at(-12, 9, 0),
          registrationRef: "EV-2105:R-9110",
          delivered: true,
          opened: true,
          clicked: true,
        }),
        recipient("CR-32", "Nathan Cole", "nathan.cole@bramblewood.co.uk", "+44 7700 900612", "L-2062", "Invited", {
          delivered: true,
          opened: true,
        }),
        recipient("CR-33", "Simone Dubois", "simone.dubois@lumenpartners.co.uk", "+44 7700 900613", "L-2063", "Invited", {
          delivered: true,
          opened: true,
        }),
        recipient("CR-34", "Curtis Ballard", "curtis.ballard@halcyonworks.co.uk", "+44 7700 900614", "L-2064", "Invited", {
          delivered: true,
        }),
        recipient("CR-35", "Helena Voss", "helena.voss@vossgroup.co.uk", "+44 7700 900615", "L-2065", "Invited", {
          delivered: true,
          opened: true,
        }),
        recipient("CR-36", "Gary Thorne", "gary.thorne@penrose-systems.co.uk", "+44 7700 900616", "L-2066", "Invited", {
          delivered: true,
          opened: false,
        }),
        recipient("CR-37", "Yvonne Traherne", "yvonne.traherne@sundial.co.uk", "+44 7700 900255", undefined, "Did Not Attend", {
          matched: false,
          registeredAt: at(-11, 9, 0),
          registrationRef: "EV-2105:R-9111",
          delivered: true,
          opened: true,
        }),
      ],
      notes:
        "Audience exported from Zoho CRM and uploaded to Eventbrite. Every contact originates from Apollo.io. " +
        "Membership of the audience does NOT imply engagement or conversion.",
      createdAt: at(-26, 9, 0),
      updatedAt: at(-8, 10, 0),
      sentAt: at(-24, 9, 0),
    },
  ];
}

/* ------------------------------- the event ----------------------------- */

export function buildApolloEvents(): CollegeEvent[] {
  return [
    {
      id: "EV-2105",
      name: "Professional Pathways Information Session (Apollo Outreach)",
      startAt: at(-8, 10, 0),
      endAt: at(-8, 11, 0),
      source: "Zoom",
      status: "completed",
      location: "Online — Zoom",
      meetingLink: "https://zoom.us/j/92011447788",
      eventbriteRef: "EVB-7712005",
      zoomMeetingId: "ZM-7706",
      campaignId: "CMP-EV-3004",
      informationSessionAt: at(-8, 10, 0),
      description:
        "Online information session for contacts sourced from Apollo.io, invited through an Eventbrite campaign.",
      registrations: [
        {
          id: "R-9110",
          name: "Olivia Hartley",
          email: "olivia.hartley@meridian-group.co.uk",
          phone: "+44 7700 900611",
          programme: "CMI Level 6",
          outcome: "confirmed",
          registeredAt: at(-12, 9, 0),
          attendance: "Attended",
          salesOwnerId: "u-leila",
          notes: "",
        },
        {
          id: "R-9111",
          name: "Yvonne Traherne",
          email: "yvonne.traherne@sundial.co.uk",
          phone: "+44 7700 900255",
          programme: "Business Administration Level 3",
          outcome: "confirmed",
          registeredAt: at(-11, 9, 0),
          attendance: "Did Not Attend",
          followUpRequired: true,
          notes: "Registered but did not attend; follow-up required.",
        },
      ],
    },
  ];
}

export function buildApolloMeetings(): Meeting[] {
  return [
    {
      id: "ZM-7706",
      topic: "Professional Pathways Information Session (Apollo Outreach)",
      hostId: "u-leila",
      account: "marketing@kentbusinesscollege.ac.uk",
      startAt: at(-8, 10, 0),
      durationMins: 60,
      joinUrl: "https://zoom.us/j/92011447788",
      relatedEventId: "EV-2105",
      status: "completed",
      participants: 2,
      zoomMeetingId: "ZM-7706",
      eventbriteRef: "EVB-7712005",
      attendanceRecorded: true,
    },
  ];
}

/* ------------------------------- the calls ----------------------------- */

function seg(id: string, startSec: number, speaker: string, text: string): TranscriptSegment {
  return { id, startSec, speaker, text };
}

export function buildApolloCalls(): Call[] {
  return [
    {
      id: "CL-5511",
      direction: "outgoing",
      status: "connected",
      durationSec: 420,
      caller: "Amara Whitfield",
      receiver: "Helena Voss",
      phoneNumber: "+44 7700 900615",
      leadId: "L-2065",
      occurredAt: at(-20, 10, 0),
      notes: "Reviewed the recorded call and transcript; employer commitment confirmed.",
      matchConfidence: "verified",
      platform: "Zoom Phone",
      salesOwnerId: "u-amara",
      employerName: "Voss Group",
      programme: "CMI Level 6",
      outcome: "Interested",
      recordingAvailable: true,
      recordingDurationSec: 420,
      transcriptAvailable: true,
      followUpTaskId: "T-3410",
      transcript: [
        seg("hv1", 0, "Amara Whitfield", "Good morning Helena, thanks for making time today. How can I help?"),
        seg("hv2", 14, "Helena Voss", "We're interested in the CMI Level 6 programme for two managers and wanted to understand the levy process."),
        seg("hv3", 48, "Amara Whitfield", "Great. As a levy-paying employer you can fund the training through your Apprenticeship Service account. Do you have an account set up?"),
        seg("hv4", 96, "Helena Voss", "We do. We'd need Kent added as a provider though."),
        seg("hv5", 150, "Amara Whitfield", "Understood — I'll send the employer agreement and guide you through the provider addition, then we can agree the January cohort."),
        seg("hv6", 240, "Helena Voss", "That works. Two places for the January intake, please."),
        seg("hv7", 330, "Amara Whitfield", "Perfect — I'll confirm the employer commitment in writing and record the closing decision here."),
      ],
    },
    {
      id: "CL-5512",
      direction: "outgoing",
      status: "answered",
      durationSec: 300,
      caller: "Leila Haddad",
      receiver: "Olivia Hartley",
      phoneNumber: "+44 7700 900611",
      leadId: "L-2061",
      occurredAt: at(-4, 11, 0),
      notes: "Advisory call after the information session; application link sent.",
      matchConfidence: "verified",
      platform: "Zoom Phone",
      salesOwnerId: "u-leila",
      programme: "CMI Level 6",
      outcome: "Interested",
      recordingAvailable: true,
      recordingDurationSec: 300,
      transcriptAvailable: false,
    },
    {
      id: "CL-5513",
      direction: "outgoing",
      status: "answered",
      durationSec: 265,
      caller: "Leila Haddad",
      receiver: "Simone Dubois",
      phoneNumber: "+44 7700 900613",
      leadId: "L-2063",
      occurredAt: at(-9, 14, 0),
      notes: "Eligibility discussed; wants to start in the later May intake.",
      matchConfidence: "verified",
      platform: "Zoom Phone",
      salesOwnerId: "u-leila",
      programme: "Operations Manager Level 5",
      outcome: "Wants Future Intake",
      recordingAvailable: true,
      recordingDurationSec: 265,
      transcriptAvailable: false,
    },
    {
      id: "CL-5514",
      direction: "outgoing",
      status: "answered",
      durationSec: 240,
      caller: "Tom Blackwood",
      receiver: "Curtis Ballard",
      phoneNumber: "+44 7700 900614",
      leadId: "L-2064",
      occurredAt: at(-21, 15, 0),
      notes: "Weekly hours below the funding threshold — referred for a commercial review.",
      matchConfidence: "verified",
      platform: "Zoom Phone",
      salesOwnerId: "u-tom",
      programme: "Digital Marketing Level 4",
      outcome: "Eligibility Review Required",
      recordingAvailable: false,
      recordingDurationSec: 0,
      transcriptAvailable: false,
    },
    {
      id: "CL-5515",
      direction: "outgoing",
      status: "connected",
      durationSec: 210,
      caller: "Tom Blackwood",
      receiver: "Nathan Cole",
      phoneNumber: "+44 7700 900612",
      leadId: "L-2062",
      occurredAt: at(-6, 11, 0),
      notes: "No information-session attendance; progressed directly to application.",
      matchConfidence: "verified",
      platform: "Zoom Phone",
      salesOwnerId: "u-tom",
      programme: "Project Controls Professional Level 6",
      outcome: "Interested",
      recordingAvailable: true,
      recordingDurationSec: 210,
      transcriptAvailable: true,
      transcript: [
        seg("nc1", 0, "Tom Blackwood", "Hi Nathan, thanks for your time — this follows your Eventbrite invitation."),
        seg("nc2", 12, "Nathan Cole", "Thanks. I couldn't make the session but I'm keen to get started."),
        seg("nc3", 60, "Tom Blackwood", "No problem — the information session isn't required. I'll send the application link and funding pack now."),
        seg("nc4", 140, "Nathan Cole", "Perfect, I'll get that submitted this week."),
      ],
    },
  ];
}

/* ------------------------------ the calls' tasks ----------------------- */

export function buildApolloTasks(): Task[] {
  return [
    {
      id: "T-3410",
      title: "Employer agreement follow-up: Helena Voss",
      description: "Send the employer agreement and guide the Voss Group provider addition after the recorded call.",
      ownerId: "u-amara",
      priority: "High",
      dueAt: at(-19, 10, 0),
      source: "Zoom",
      status: "completed",
      completedAt: at(-15, 10, 0),
      relatedLeadId: "L-2065",
      relatedCallId: "CL-5511",
      programme: "CMI Level 6",
      notes: "Employer commitment subsequently confirmed in writing.",
      createdAt: at(-20, 10, 20),
    },
    {
      id: "T-3411",
      title: "Future intake follow-up: Simone Dubois",
      description: "Re-engage and re-verify eligibility ahead of the May 2027 intake.",
      ownerId: "u-leila",
      priority: "Medium",
      dueAt: at(3, 10, 0),
      source: "Zoom",
      status: "open",
      relatedLeadId: "L-2063",
      relatedCallId: "CL-5513",
      programme: "Operations Manager Level 5",
      notes: "",
      createdAt: at(-9, 14, 20),
    },
    {
      id: "T-3412",
      title: "Send funding pack: Olivia Hartley",
      description: "Send the funding pack following the advisory call.",
      ownerId: "u-leila",
      priority: "Medium",
      dueAt: at(1, 10, 0),
      source: "Zoom",
      status: "open",
      relatedLeadId: "L-2061",
      relatedCallId: "CL-5512",
      programme: "CMI Level 6",
      notes: "",
      createdAt: at(-4, 11, 15),
    },
    {
      id: "T-3413",
      title: "Commercial review: Curtis Ballard",
      description: "Complete the commercial suitability review following the funding ineligibility.",
      ownerId: "u-tom",
      priority: "Medium",
      dueAt: at(2, 14, 0),
      source: "Zoom",
      status: "open",
      relatedLeadId: "L-2064",
      relatedCallId: "CL-5514",
      programme: "Digital Marketing Level 4",
      notes: "",
      createdAt: at(-21, 15, 20),
    },
  ];
}

/* --------------------------- the applications -------------------------- */

export function buildApolloApplications(): Application[] {
  return [
    {
      id: "APP-50250",
      applicantName: "Olivia Hartley",
      email: "olivia.hartley@meridian-group.co.uk",
      phone: "+44 7700 900611",
      programme: "CMI Level 6",
      intake: "September 2026",
      status: "Submitted",
      ownerId: "u-leila",
      submittedAt: at(-3, 10, 0),
      updateAt: at(-3, 10, 0),
      leadId: "L-2061",
      documents: [{ id: "d-ap-1", name: "CV", type: "Supporting", status: "Received" }],
      notes: "Applied after attending the information session and completing an advisory call.",
      history: [{ id: "h-ap-1", status: "Submitted", at: at(-3, 10, 0), byId: "u-leila", note: "" }],
    },
    {
      id: "APP-50251",
      applicantName: "Nathan Cole",
      email: "nathan.cole@bramblewood.co.uk",
      phone: "+44 7700 900612",
      programme: "Project Controls Professional Level 6",
      intake: "January 2026",
      status: "Submitted",
      ownerId: "u-tom",
      submittedAt: at(-5, 11, 0),
      updateAt: at(-5, 11, 0),
      leadId: "L-2062",
      documents: [{ id: "d-ap-2", name: "Employer letter", type: "Funding", status: "Pending" }],
      notes: "Direct route — no information-session attendance required.",
      history: [{ id: "h-ap-2", status: "Submitted", at: at(-5, 11, 0), byId: "u-tom", note: "" }],
    },
    {
      id: "APP-50252",
      applicantName: "Helena Voss",
      email: "helena.voss@vossgroup.co.uk",
      phone: "+44 7700 900615",
      programme: "CMI Level 6",
      intake: "January 2026",
      status: "Enrolled",
      ownerId: "u-amara",
      submittedAt: at(-13, 10, 0),
      updateAt: at(-10, 10, 0),
      leadId: "L-2065",
      documents: [
        { id: "d-ap-3", name: "Employer agreement", type: "Funding", status: "Verified" },
        { id: "d-ap-4", name: "Passport scan", type: "Identity", status: "Verified" },
      ],
      notes: "Employer commitment confirmed; enrolled after the recorded closing touch.",
      history: [
        { id: "h-ap-3", status: "Submitted", at: at(-13, 10, 0), byId: "u-amara", note: "" },
        { id: "h-ap-4", status: "Offer", at: at(-11, 10, 0), byId: "u-amara", note: "" },
        { id: "h-ap-5", status: "Enrolled", at: at(-10, 10, 0), byId: "u-hannah", note: "Enrolment completed." },
      ],
    },
    {
      id: "APP-50253",
      applicantName: "Priti Sandhu",
      email: "priti.sandhu@westgate.com",
      phone: "+44 7700 900617",
      programme: "Business Administration Level 3",
      intake: "January 2026",
      status: "Enrolled",
      ownerId: "u-hannah",
      submittedAt: at(-25, 10, 0),
      updateAt: at(-11, 10, 0),
      leadId: "L-2067",
      documents: [
        { id: "d-ap-5", name: "Passport scan", type: "Identity", status: "Verified" },
        { id: "d-ap-6", name: "Employer agreement", type: "Funding", status: "Verified" },
      ],
      notes: "Direct website application — no Eventbrite registration or information session required.",
      history: [
        { id: "h-ap-6", status: "Submitted", at: at(-25, 10, 0), byId: "u-hannah", note: "" },
        { id: "h-ap-7", status: "Offer", at: at(-16, 10, 0), byId: "u-hannah", note: "" },
        { id: "h-ap-8", status: "Enrolled", at: at(-11, 10, 0), byId: "u-hannah", note: "Enrolment completed." },
      ],
    },
  ];
}

/* -------------------- future intake / commercial / employer ------------ */

export function buildApolloFutureIntakes(): FutureIntakeRecord[] {
  return [
    {
      id: "FI-3005",
      leadId: "L-2063",
      currentProgramme: "Operations Manager Level 5",
      currentIntake: "September 2026",
      preferredIntake: "May 2027",
      preferredStartMonth: "2027-05",
      reason: "Personal timing",
      learnerReadiness: "Ready",
      employerReadiness: "Partly ready",
      salesOwnerId: "u-leila",
      enrolmentOwnerId: "u-hannah",
      lastContactAt: at(-9, 14, 0),
      nextFollowUpAt: at(3, 10, 0),
      notes: "Eligible but wants a later intake — remains an active Future Intake opportunity.",
      deferredAt: at(-4, 10, 0),
      reengagementFlag: true,
    },
  ];
}

export function buildApolloCommercialOpportunities(): CommercialOpportunity[] {
  return [
    {
      id: "CO-4004",
      leadId: "L-2064",
      fundingEligibilityOutcome: "Not Eligible for Funding",
      referralReason: "Below minimum weekly hours",
      programmeInterest: "Digital Marketing Level 4",
      suggestedProgramme: "Short Course — Digital Marketing Fundamentals",
      optionType: "Commercial course",
      fundingInterest: "Self-funded",
      budgetStatus: "Not discussed",
      quoteStatus: "Not required",
      commercialOwnerId: "u-tom",
      nextFollowUpAt: at(2, 14, 0),
      notes: "Referred for a commercial review after the funding eligibility decision.",
      stage: "Referred",
      referredAt: at(-20, 15, 40),
      updatedAt: at(-20, 15, 40),
    },
  ];
}

export function buildApolloEmployerAgreements(): EmployerAgreement[] {
  return [
    {
      id: "EA-5006",
      employerName: "Voss Group",
      employerContact: "Helena Voss",
      status: "Signed",
      dateSent: at(-19, 10, 0),
      dateSigned: at(-16, 11, 0),
      verifiedById: "u-hannah",
      notes: "Employer agreement signed — kept separate from the enrolment record.",
      leadId: "L-2065",
      applicationId: "APP-50252",
      updatedAt: at(-16, 11, 0),
    },
    {
      id: "EA-5007",
      employerName: "Westgate",
      employerContact: "Priti Sandhu",
      status: "Signed",
      dateSent: at(-18, 10, 0),
      dateSigned: at(-16, 10, 0),
      verifiedById: "u-hannah",
      notes: "Direct website applicant — employer agreement explicitly recorded as signed, kept separate from enrolment.",
      leadId: "L-2067",
      applicationId: "APP-50253",
      updatedAt: at(-16, 10, 0),
    },
  ];
}

export function buildApolloDasRecords(): DasRecord[] {
  return [
    {
      id: "DAS-6006",
      employerName: "Voss Group",
      status: "Confirmed",
      accountSetupHelpNeeded: false,
      ukprnShared: true,
      providerAdditionRequested: true,
      providerAdditionConfirmed: true,
      fundingActionsReviewed: true,
      responsibleStaffId: "u-hannah",
      lastUpdatedAt: at(-16, 11, 30),
      notes: "Apprenticeship Service provider addition confirmed — tracked separately from enrolment.",
      leadId: "L-2065",
      applicationId: "APP-50252",
    },
    {
      id: "DAS-6007",
      employerName: "Westgate",
      status: "Confirmed",
      accountSetupHelpNeeded: false,
      ukprnShared: true,
      providerAdditionRequested: true,
      providerAdditionConfirmed: true,
      fundingActionsReviewed: true,
      responsibleStaffId: "u-hannah",
      lastUpdatedAt: at(-15, 10, 0),
      notes: "Apprenticeship Service provider addition explicitly confirmed — kept separate from the enrolment record.",
      leadId: "L-2067",
      applicationId: "APP-50253",
    },
  ];
}

/* ------------------------------ touchpoints ---------------------------- */

function tp(
  id: string,
  leadId: string,
  timestamp: string,
  source: string,
  channel: string,
  interactionType: string,
  outcome: string,
  ownerId: string,
  notes: string,
  refType: Touchpoint["refType"],
  refId?: string,
  isClosing = false,
  campaignId?: string,
): Touchpoint {
  return {
    id,
    leadId,
    timestamp,
    source,
    channel,
    interactionType,
    outcome,
    ownerId,
    notes,
    isClosing,
    refType,
    refId,
    category: categoryForInteractionType(interactionType),
    campaignId,
  };
}

const AP = "Apollo.io";
const OUT = "Outreach";

export function buildApolloTouchpoints(): Touchpoint[] {
  return [
    /* ---- Olivia Hartley (L-2061) — Scenario A ---- */
    tp("TP-2061-1", "L-2061", at(-28, 9, 0), AP, OUT, "Contact acquired", "Neutral", "u-leila", "Contact sourced from Apollo.io and created in Zoho CRM.", "manual"),
    tp("TP-2061-2", "L-2061", at(-25, 9, 0), AP, OUT, "Added to campaign audience", "Neutral", "u-leila", "Added to the Eventbrite campaign audience from a Zoho CRM export.", "campaign", undefined, false, "CMP-EV-3004"),
    tp("TP-2061-3", "L-2061", at(-24, 9, 30), AP, OUT, "Invitation sent", "Neutral", "u-leila", "Eventbrite email invitation sent (simulated).", "email", "CMP-EV-3004:CR-31:invite", false, "CMP-EV-3004"),
    tp("TP-2061-4", "L-2061", at(-24, 14, 0), AP, OUT, "Email opened", "Neutral", "u-leila", "Invitation opened.", "email", "CMP-EV-3004:CR-31:open", false, "CMP-EV-3004"),
    tp("TP-2061-5", "L-2061", at(-12, 9, 0), "Eventbrite", "Events", "Event registered", "Positive", "u-leila", "Registered for the Professional Pathways information session.", "event", "EV-2105:R-9110:registration"),
    tp("TP-2061-6", "L-2061", at(-8, 10, 0), "Zoom Meetings", "Webinar", "Information session attended", "Positive", "u-leila", "Attended the Zoom information session.", "event", "EV-2105:R-9110:attendance"),
    tp("TP-2061-7", "L-2061", at(-4, 11, 0), AP, OUT, "Zoom Phone call attempted", "Neutral", "u-leila", "Outbound Zoom Phone call attempt.", "call", "CL-5512:attempted"),
    tp("TP-2061-8", "L-2061", at(-4, 11, 0), AP, OUT, "Call answered", "Positive", "u-leila", "Advisory call completed on Zoom Phone.", "call", "CL-5512"),
    tp("TP-2061-9", "L-2061", at(-4, 11, 15), AP, OUT, "Sales conversation outcome recorded", "Positive", "u-leila", "Outcome recorded: Interested.", "call", "CL-5512:outcome"),
    tp("TP-2061-10", "L-2061", at(-3, 10, 0), "Website", "Web", "Application submitted", "Positive", "u-leila", "Application APP-50250 submitted.", "application", "APP-50250"),

    /* ---- Nathan Cole (L-2062) — Scenario B (no session) ---- */
    tp("TP-2062-1", "L-2062", at(-27, 10, 0), AP, OUT, "Contact acquired", "Neutral", "u-tom", "Contact sourced from Apollo.io and created in Zoho CRM.", "manual"),
    tp("TP-2062-2", "L-2062", at(-25, 9, 0), AP, OUT, "Added to campaign audience", "Neutral", "u-tom", "Added to the Eventbrite campaign audience.", "campaign", undefined, false, "CMP-EV-3004"),
    tp("TP-2062-3", "L-2062", at(-24, 9, 30), AP, OUT, "Invitation sent", "Neutral", "u-tom", "Eventbrite email invitation sent (simulated).", "email", "CMP-EV-3004:CR-32:invite", false, "CMP-EV-3004"),
    tp("TP-2062-4", "L-2062", at(-24, 16, 0), AP, OUT, "Email opened", "Neutral", "u-tom", "Invitation opened.", "email", "CMP-EV-3004:CR-32:open", false, "CMP-EV-3004"),
    tp("TP-2062-5", "L-2062", at(-6, 11, 0), AP, OUT, "Zoom Phone call attempted", "Neutral", "u-tom", "Outbound Zoom Phone call attempt.", "call", "CL-5515:attempted"),
    tp("TP-2062-6", "L-2062", at(-6, 11, 0), AP, OUT, "Call answered", "Positive", "u-tom", "Sales call completed on Zoom Phone.", "call", "CL-5515"),
    tp("TP-2062-7", "L-2062", at(-6, 11, 20), AP, OUT, "Sales conversation outcome recorded", "Positive", "u-tom", "Outcome recorded: Interested.", "call", "CL-5515:outcome"),
    tp("TP-2062-8", "L-2062", at(-5, 11, 0), "Website", "Web", "Application submitted", "Positive", "u-tom", "Application APP-50251 submitted without any session attendance.", "application", "APP-50251"),

    /* ---- Simone Dubois (L-2063) — future intake ---- */
    tp("TP-2063-1", "L-2063", at(-30, 11, 0), AP, OUT, "Contact acquired", "Neutral", "u-leila", "Contact sourced from Apollo.io.", "manual"),
    tp("TP-2063-2", "L-2063", at(-25, 9, 0), AP, OUT, "Added to campaign audience", "Neutral", "u-leila", "Added to the Eventbrite campaign audience.", "campaign", undefined, false, "CMP-EV-3004"),
    tp("TP-2063-3", "L-2063", at(-24, 9, 30), AP, OUT, "Invitation sent", "Neutral", "u-leila", "Eventbrite email invitation sent (simulated).", "email", "CMP-EV-3004:CR-33:invite", false, "CMP-EV-3004"),
    tp("TP-2063-4", "L-2063", at(-24, 12, 0), AP, OUT, "Email opened", "Neutral", "u-leila", "Invitation opened.", "email", "CMP-EV-3004:CR-33:open", false, "CMP-EV-3004"),
    tp("TP-2063-5", "L-2063", at(-9, 14, 0), AP, OUT, "Zoom Phone call attempted", "Neutral", "u-leila", "Outbound Zoom Phone call attempt.", "call", "CL-5513:attempted"),
    tp("TP-2063-6", "L-2063", at(-9, 14, 0), AP, OUT, "Call answered", "Positive", "u-leila", "Sales call completed on Zoom Phone.", "call", "CL-5513"),
    tp("TP-2063-7", "L-2063", at(-9, 14, 20), AP, OUT, "Sales conversation outcome recorded", "Neutral", "u-leila", "Outcome recorded: Wants Future Intake.", "call", "CL-5513:outcome"),
    tp("TP-2063-8", "L-2063", at(-8, 10, 0), AP, OUT, "Eligibility assessment completed", "Positive", "u-hannah", "Provisionally eligible for funding.", "manual", "L-2063:eligibility"),
    tp("TP-2063-9", "L-2063", at(-4, 10, 0), AP, OUT, "Future intake selected", "Neutral", "u-leila", "Deferred to the May 2027 intake; remains an active opportunity.", "manual", "L-2063:future-intake"),

    /* ---- Curtis Ballard (L-2064) — commercial referral ---- */
    tp("TP-2064-1", "L-2064", at(-30, 13, 0), AP, OUT, "Contact acquired", "Neutral", "u-tom", "Contact sourced from Apollo.io.", "manual"),
    tp("TP-2064-2", "L-2064", at(-25, 9, 0), AP, OUT, "Added to campaign audience", "Neutral", "u-tom", "Added to the Eventbrite campaign audience.", "campaign", undefined, false, "CMP-EV-3004"),
    tp("TP-2064-3", "L-2064", at(-24, 9, 30), AP, OUT, "Invitation sent", "Neutral", "u-tom", "Eventbrite email invitation sent (simulated).", "email", "CMP-EV-3004:CR-34:invite", false, "CMP-EV-3004"),
    tp("TP-2064-4", "L-2064", at(-21, 15, 0), AP, OUT, "Zoom Phone call attempted", "Neutral", "u-tom", "Outbound Zoom Phone call attempt.", "call", "CL-5514:attempted"),
    tp("TP-2064-5", "L-2064", at(-21, 15, 0), AP, OUT, "Call answered", "Positive", "u-tom", "Sales call completed on Zoom Phone.", "call", "CL-5514"),
    tp("TP-2064-6", "L-2064", at(-21, 15, 20), AP, OUT, "Sales conversation outcome recorded", "Neutral", "u-tom", "Outcome recorded: Eligibility Review Required.", "call", "CL-5514:outcome"),
    tp("TP-2064-7", "L-2064", at(-20, 15, 40), AP, OUT, "Eligibility assessment completed", "Rejected", "u-hannah", "Not eligible for government funding — referred for commercial review.", "manual", "L-2064:eligibility"),

    /* ---- Helena Voss (L-2065) — Scenario F + enrolment ---- */
    tp("TP-2065-1", "L-2065", at(-46, 9, 30), AP, OUT, "Contact acquired", "Neutral", "u-amara", "Contact sourced from Apollo.io.", "manual"),
    tp("TP-2065-2", "L-2065", at(-25, 9, 0), AP, OUT, "Added to campaign audience", "Neutral", "u-amara", "Added to the Eventbrite campaign audience.", "campaign", undefined, false, "CMP-EV-3004"),
    tp("TP-2065-3", "L-2065", at(-24, 9, 30), AP, OUT, "Invitation sent", "Neutral", "u-amara", "Eventbrite email invitation sent (simulated).", "email", "CMP-EV-3004:CR-35:invite", false, "CMP-EV-3004"),
    tp("TP-2065-4", "L-2065", at(-20, 10, 0), AP, OUT, "Zoom Phone call attempted", "Neutral", "u-amara", "Outbound Zoom Phone call attempt.", "call", "CL-5511:attempted"),
    tp("TP-2065-5", "L-2065", at(-20, 10, 0), AP, OUT, "Call answered", "Positive", "u-amara", "Recorded Zoom Phone call reviewed with the transcript.", "call", "CL-5511"),
    tp("TP-2065-6", "L-2065", at(-20, 10, 20), AP, OUT, "Sales conversation outcome recorded", "Positive", "u-amara", "Outcome recorded: Interested.", "call", "CL-5511:outcome"),
    tp("TP-2065-7", "L-2065", at(-19, 10, 0), AP, OUT, "Follow-up email sent", "Neutral", "u-amara", "Sent the employer agreement and provider-addition guide.", "email", "T-3410:follow-up"),
    tp("TP-2065-8", "L-2065", at(-16, 11, 0), AP, OUT, "Employer commitment recorded", "Positive", "u-amara", "Voss Group committed to two levy-funded places.", "manual", "L-2065:employer-commitment"),
    tp("TP-2065-9", "L-2065", at(-15, 10, 0), AP, OUT, "Employer agreement signed", "Positive", "u-hannah", "Employer agreement signed (separate from enrolment).", "manual", "EA-5006"),
    tp("TP-2065-10", "L-2065", at(-14, 10, 0), AP, OUT, "Closing decision recorded", "Converted", "u-amara", "Explicit closing touch recorded after the employer commitment.", "manual", "L-2065:closing", true),
    tp("TP-2065-11", "L-2065", at(-13, 10, 0), "Website", "Web", "Application submitted", "Positive", "u-amara", "Application APP-50252 submitted.", "application", "APP-50252"),
    tp("TP-2065-12", "L-2065", at(-10, 10, 0), AP, OUT, "Enrolment completed", "Converted", "u-hannah", "Enrolment completed after the employer agreement and DAS confirmation.", "manual", "L-2065:enrolment"),

    /* ---- Gary Thorne (L-2066) — never responds ---- */
    tp("TP-2066-1", "L-2066", at(-12, 15, 0), AP, OUT, "Contact acquired", "Neutral", "u-leila", "Contact sourced from Apollo.io.", "manual"),
    tp("TP-2066-2", "L-2066", at(-11, 9, 0), AP, OUT, "Added to campaign audience", "Neutral", "u-leila", "Added to the Eventbrite campaign audience.", "campaign", undefined, false, "CMP-EV-3004"),
    tp("TP-2066-3", "L-2066", at(-11, 9, 30), AP, OUT, "Invitation sent", "Neutral", "u-leila", "Eventbrite email invitation sent (simulated).", "email", "CMP-EV-3004:CR-36:invite", false, "CMP-EV-3004"),
    tp("TP-2066-4", "L-2066", at(-11, 9, 40), AP, OUT, "Email delivered", "Neutral", "u-leila", "Delivery recorded. No open, click, registration or reply has been recorded.", "email", "CMP-EV-3004:CR-36:delivery", false, "CMP-EV-3004"),

    /* ---- Priti Sandhu (L-2067) — direct website route, no Eventbrite / no session ---- */
    tp("TP-2067-1", "L-2067", at(-38, 10, 0), "Website", "Web", "Contact acquired", "Neutral", "u-hannah", "Direct enquiry through the Kent Business College website.", "manual"),
    tp("TP-2067-2", "L-2067", at(-38, 10, 5), "Website", "Web", "Web form", "Positive", "u-hannah", "Website enquiry form submitted.", "manual", "L-2067:webform"),
    tp("TP-2067-3", "L-2067", at(-30, 10, 0), "Website", "Web", "Eligibility assessment completed", "Positive", "u-hannah", "Verified eligible for funding.", "manual", "L-2067:eligibility"),
    tp("TP-2067-4", "L-2067", at(-25, 10, 0), "Website", "Web", "Application submitted", "Positive", "u-hannah", "Application APP-50253 submitted directly.", "application", "APP-50253"),
    tp("TP-2067-5", "L-2067", at(-16, 10, 0), "Website", "Web", "Employer agreement signed", "Positive", "u-hannah", "Employer agreement signed.", "manual", "L-2067:agreement"),
    tp("TP-2067-6", "L-2067", at(-15, 10, 0), "Website", "Web", "DAS/provider addition confirmed", "Positive", "u-hannah", "Apprenticeship Service provider addition confirmed.", "manual", "L-2067:das"),
    tp("TP-2067-7", "L-2067", at(-12, 10, 0), "Website", "Web", "Closing decision recorded", "Converted", "u-hannah", "Explicit closing touch recorded.", "manual", "L-2067:closing", true),
    tp("TP-2067-8", "L-2067", at(-11, 10, 0), "Website", "Web", "Enrolment completed", "Converted", "u-hannah", "Enrolment completed.", "manual", "L-2067:enrolment"),
  ];
}