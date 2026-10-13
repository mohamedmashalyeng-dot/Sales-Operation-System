import type {
  CommercialOpportunity,
  DasRecord,
  EligibilityAssessment,
  EligibilityResponse,
  EmployerAgreement,
  EnrolmentStage,
  FutureIntakeRecord,
  IntakePlanningStatus,
} from "@/store/types";
import type { EligibilityStatus, EvidenceStatus, ScreeningAnswer } from "@/config/eligibility";
import { ELIGIBILITY_QUESTIONS } from "@/config/eligibility";
import { at, hoursAgo } from "@/store/seed/helpers";

type AnswerSeed = {
  answer: ScreeningAnswer;
  evidence?: EvidenceStatus;
  notes?: string;
  weeklyHours?: number;
  checkedById?: string;
};

function makeAssessment(
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

export interface LeadProgression {
  eligibility: EligibilityAssessment;
  intakePlanning: IntakePlanningStatus;
  enrolment: EnrolmentStage;
}

/**
 * Attaches the apprenticeship progression dimensions to the existing fictional
 * leads (matched by stable id). Leads deliberately omitted here are treated as
 * Not Assessed / Unassigned / Not Started.
 */
export function buildLeadProgression(): Record<string, LeadProgression> {
  return {
    "L-2038": {
      eligibility: makeAssessment(
        "Verified Eligible",
        {
          "eq-residency": { answer: "Yes", evidence: "Verified", checkedById: "u-hannah" },
          "eq-immigration": { answer: "Yes", evidence: "Verified", checkedById: "u-hannah" },
          "eq-other-funding": { answer: "No", evidence: "Verified", checkedById: "u-hannah" },
          "eq-employment-type": { answer: "Yes", evidence: "Verified", checkedById: "u-hannah" },
          "eq-paid-hours": { answer: "Yes", evidence: "Verified", weeklyHours: 37, checkedById: "u-hannah" },
          "eq-employer-england": { answer: "Yes", evidence: "Verified", checkedById: "u-hannah" },
          "eq-hours-england": { answer: "Yes", evidence: "Verified", checkedById: "u-hannah" },
        },
        {
          decision: "Verified Eligible",
          verificationDate: at(-8, 10, 0),
          decisionMakerId: "u-hannah",
          decisionReasons: "All evidence verified; employer confirmed a levy-funded place.",
        },
      ),
      intakePlanning: "Current Intake",
      enrolment: "Employer Onboarding",
    },
    "L-2024": {
      eligibility: makeAssessment("Verified Eligible", {
        "eq-residency": { answer: "Yes", evidence: "Verified", checkedById: "u-hannah" },
        "eq-immigration": { answer: "Yes", evidence: "Verified", checkedById: "u-hannah" },
        "eq-paid-hours": { answer: "Yes", evidence: "Received", weeklyHours: 32, checkedById: "u-hannah" },
        "eq-employer-england": { answer: "Yes", evidence: "Verified", checkedById: "u-hannah" },
        "eq-hours-england": { answer: "Yes", evidence: "Received", checkedById: "u-hannah" },
      }, { decision: "Verified Eligible", verificationDate: at(-7, 9, 0), decisionMakerId: "u-hannah" }),
      intakePlanning: "Current Intake",
      enrolment: "Document Review",
    },
    "L-2019": {
      eligibility: makeAssessment("Verified Eligible", {
        "eq-residency": { answer: "Yes", evidence: "Verified", checkedById: "u-hannah" },
        "eq-immigration": { answer: "Yes", evidence: "Verified", checkedById: "u-hannah" },
        "eq-paid-hours": { answer: "Yes", evidence: "Verified", weeklyHours: 35, checkedById: "u-hannah" },
        "eq-employer-england": { answer: "Yes", evidence: "Verified", checkedById: "u-hannah" },
        "eq-hours-england": { answer: "Yes", evidence: "Verified", checkedById: "u-hannah" },
      }, { decision: "Verified Eligible", verificationDate: at(-17, 12, 0), decisionMakerId: "u-hannah" }),
      intakePlanning: "Current Intake",
      enrolment: "Ready to Enrol",
    },
    "L-2007": {
      eligibility: makeAssessment("Verified Eligible", {
        "eq-residency": { answer: "Yes", evidence: "Verified", checkedById: "u-hannah" },
        "eq-immigration": { answer: "Yes", evidence: "Verified", checkedById: "u-hannah" },
        "eq-paid-hours": { answer: "Yes", evidence: "Verified", weeklyHours: 30, checkedById: "u-hannah" },
        "eq-employer-england": { answer: "Yes", evidence: "Received", checkedById: "u-hannah" },
        "eq-hours-england": { answer: "Yes", evidence: "Verified", checkedById: "u-hannah" },
      }, { decision: "Verified Eligible", verificationDate: at(-8, 11, 0), decisionMakerId: "u-hannah" }),
      intakePlanning: "Current Intake",
      enrolment: "Document Review",
    },
    "L-1998": {
      eligibility: makeAssessment("Verified Eligible", {
        "eq-residency": { answer: "Yes", evidence: "Verified", checkedById: "u-hannah" },
        "eq-immigration": { answer: "Yes", evidence: "Verified", checkedById: "u-hannah" },
        "eq-paid-hours": { answer: "Yes", evidence: "Verified", weeklyHours: 40, checkedById: "u-hannah" },
        "eq-employer-england": { answer: "Yes", evidence: "Verified", checkedById: "u-hannah" },
        "eq-hours-england": { answer: "Yes", evidence: "Verified", checkedById: "u-hannah" },
      }, { decision: "Verified Eligible", verificationDate: at(-35, 10, 0), decisionMakerId: "u-hannah" }),
      intakePlanning: "Intake Confirmed",
      enrolment: "Apprenticeship Started",
    },
    "L-2050": {
      eligibility: makeAssessment("Verified Eligible", {
        "eq-residency": { answer: "Yes", evidence: "Verified", checkedById: "u-hannah" },
        "eq-immigration": { answer: "Yes", evidence: "Verified", checkedById: "u-hannah" },
        "eq-paid-hours": { answer: "Yes", evidence: "Verified", weeklyHours: 38, checkedById: "u-hannah" },
        "eq-employer-england": { answer: "Yes", evidence: "Verified", checkedById: "u-hannah" },
        "eq-hours-england": { answer: "Yes", evidence: "Verified", checkedById: "u-hannah" },
      }, { decision: "Verified Eligible", verificationDate: at(-28, 10, 0), decisionMakerId: "u-hannah" }),
      intakePlanning: "Intake Confirmed",
      enrolment: "Apprenticeship Started",
    },
    "L-2049": {
      eligibility: makeAssessment("Verified Eligible", {
        "eq-residency": { answer: "Yes", evidence: "Verified", checkedById: "u-hannah" },
        "eq-immigration": { answer: "Yes", evidence: "Verified", checkedById: "u-hannah" },
        "eq-paid-hours": { answer: "Yes", evidence: "Verified", weeklyHours: 36, checkedById: "u-hannah" },
        "eq-employer-england": { answer: "Yes", evidence: "Verified", checkedById: "u-hannah" },
      }, { decision: "Verified Eligible", verificationDate: at(-20, 10, 0), decisionMakerId: "u-hannah" }),
      intakePlanning: "Intake Confirmed",
      enrolment: "Enrolled",
    },
    "L-1987": {
      eligibility: makeAssessment("Verified Eligible", {
        "eq-residency": { answer: "Yes", evidence: "Verified", checkedById: "u-hannah" },
        "eq-immigration": { answer: "Yes", evidence: "Verified", checkedById: "u-hannah" },
        "eq-paid-hours": { answer: "Yes", evidence: "Verified", weeklyHours: 39, checkedById: "u-hannah" },
        "eq-employer-england": { answer: "Yes", evidence: "Verified", checkedById: "u-hannah" },
      }, { decision: "Verified Eligible", verificationDate: at(-15, 10, 0), decisionMakerId: "u-hannah" }),
      intakePlanning: "Current Intake",
      enrolment: "Employer Onboarding",
    },
    "L-2041": {
      eligibility: makeAssessment("Screening In Progress", {
        "eq-residency": { answer: "Yes", notes: "Confirmed verbally — evidence pending.", checkedById: "u-amara" },
        "eq-immigration": { answer: "Needs Review", notes: "Requires specialist review of leave status.", checkedById: "u-amara" },
        "eq-paid-hours": { answer: "Yes", weeklyHours: 34, checkedById: "u-amara" },
      }),
      intakePlanning: "Current Intake",
      enrolment: "Not Started",
    },
    "L-1992": {
      eligibility: makeAssessment("Screening In Progress", {
        "eq-residency": { answer: "Yes", checkedById: "u-leila" },
        "eq-paid-hours": { answer: "Yes", weeklyHours: 31, checkedById: "u-leila" },
      }),
      intakePlanning: "Unassigned",
      enrolment: "Not Started",
    },
    "L-2033": {
      eligibility: makeAssessment("Provisionally Eligible", {
        "eq-residency": { answer: "Yes", evidence: "Received", checkedById: "u-hannah" },
        "eq-immigration": { answer: "Yes", evidence: "Received", checkedById: "u-hannah" },
        "eq-paid-hours": { answer: "Yes", evidence: "Received", weeklyHours: 30, checkedById: "u-hannah" },
        "eq-employer-england": { answer: "Yes", evidence: "Received", checkedById: "u-hannah" },
      }),
      intakePlanning: "Future Intake",
      enrolment: "Not Started",
    },
    "L-2046": {
      eligibility: makeAssessment("Provisionally Eligible", {
        "eq-residency": { answer: "Yes", evidence: "Received", checkedById: "u-hannah" },
        "eq-paid-hours": { answer: "Yes", evidence: "Received", weeklyHours: 30, checkedById: "u-hannah" },
      }),
      intakePlanning: "Future Intake",
      enrolment: "Not Started",
    },
    "L-2029": {
      eligibility: makeAssessment("Information Required", {
        "eq-residency": { answer: "Yes", evidence: "Received", checkedById: "u-hannah" },
        "eq-other-funding": { answer: "Unknown", evidence: "Requested", notes: "Confirm no conflicting funded training.", checkedById: "u-hannah" },
        "eq-paid-hours": { answer: "Unknown", evidence: "Requested", notes: "Employer hours letter outstanding.", checkedById: "u-hannah" },
      }),
      intakePlanning: "Future Intake",
      enrolment: "Not Started",
    },
    "L-2047": {
      eligibility: makeAssessment("Information Required", {
        "eq-residency": { answer: "Unknown", evidence: "Requested", checkedById: "u-hannah" },
        "eq-paid-hours": { answer: "Unknown", evidence: "Requested", checkedById: "u-hannah" },
      }),
      intakePlanning: "Future Intake",
      enrolment: "Not Started",
    },
    "L-2016": {
      eligibility: makeAssessment("Review Required", {
        "eq-residency": { answer: "Yes", evidence: "Received", checkedById: "u-hannah" },
        "eq-immigration": { answer: "Yes", evidence: "Received", checkedById: "u-hannah" },
        "eq-paid-hours": {
          answer: "Needs Review",
          evidence: "Received",
          weeklyHours: 22,
          notes: "Below 30 hours — requires review, not automatic rejection.",
          checkedById: "u-hannah",
        },
      }),
      intakePlanning: "Unassigned",
      enrolment: "Not Started",
    },
    "L-2003": {
      eligibility: makeAssessment(
        "Not Eligible for Funding",
        {
          "eq-residency": { answer: "Yes", evidence: "Verified", checkedById: "u-hannah" },
          "eq-immigration": { answer: "Needs Review", evidence: "Received", notes: "Leave status not fundable for apprenticeship.", checkedById: "u-hannah" },
          "eq-paid-hours": { answer: "No", evidence: "Verified", weeklyHours: 18, checkedById: "u-hannah" },
        },
        {
          decision: "Not Eligible for Funding",
          verificationDate: at(-5, 10, 0),
          decisionMakerId: "u-hannah",
          decisionReasons: "Residency/leave status and weekly hours do not meet funding rules. Referred for commercial review.",
        },
      ),
      intakePlanning: "Unassigned",
      enrolment: "Not Started",
    },
    "L-1981": {
      eligibility: makeAssessment("Not Eligible for Funding", {
        "eq-paid-hours": { answer: "No", evidence: "Verified", weeklyHours: 16, checkedById: "u-hannah" },
      }),
      intakePlanning: "Withdrawn",
      enrolment: "Not Started",
    },
  };
}

/* --------------------------- Future intake ---------------------------- */

export function buildFutureIntakes(): FutureIntakeRecord[] {
  return [
    {
      id: "FI-3001",
      leadId: "L-2033",
      currentProgramme: "Marketing Manager with CIM Level 6",
      currentIntake: "September 2026",
      preferredIntake: "January 2027",
      preferredStartMonth: "2027-01",
      reason: "Personal timing",
      learnerReadiness: "Ready",
      employerReadiness: "Partly ready",
      salesOwnerId: "u-leila",
      enrolmentOwnerId: "u-hannah",
      lastContactAt: at(-1, 15, 10),
      nextFollowUpAt: at(12, 10, 0),
      notes: "Learner wants to start after a personal commitment; employer supports a later cohort.",
      deferredAt: at(-4, 14, 0),
      reengagementFlag: false,
    },
    {
      id: "FI-3002",
      leadId: "L-2046",
      currentProgramme: "Marketing Manager with CIM Level 6",
      currentIntake: "September 2026",
      preferredIntake: "May 2026",
      preferredStartMonth: "2026-05",
      reason: "Waiting for employer approval",
      learnerReadiness: "Ready",
      employerReadiness: "Not ready",
      salesOwnerId: "u-leila",
      enrolmentOwnerId: "u-hannah",
      lastContactAt: hoursAgo(4),
      nextFollowUpAt: at(-2, 10, 0),
      notes: "Partner-funded place awaiting employer sign-off.",
      deferredAt: at(-6, 11, 0),
      reengagementFlag: true,
    },
    {
      id: "FI-3003",
      leadId: "L-2029",
      currentProgramme: "DAS Matter",
      currentIntake: "January 2026",
      preferredIntake: "September 2027",
      preferredStartMonth: "2027-09",
      reason: "Waiting for documentation",
      learnerReadiness: "Partly ready",
      employerReadiness: "Unknown",
      salesOwnerId: "u-tom",
      enrolmentOwnerId: "u-hannah",
      lastContactAt: at(-5, 9, 35),
      nextFollowUpAt: at(20, 10, 0),
      notes: "DAS eligibility evidence still outstanding before a firm start date can be agreed.",
      deferredAt: at(-3, 9, 0),
      reengagementFlag: false,
    },
    {
      id: "FI-3004",
      leadId: "L-2047",
      currentProgramme: "Business Administration Level 3",
      currentIntake: "September 2026",
      preferredIntake: "September 2026",
      preferredStartMonth: "2026-09",
      reason: "Wants a later cohort",
      learnerReadiness: "Unknown",
      employerReadiness: "Unknown",
      salesOwnerId: "u-hannah",
      enrolmentOwnerId: "u-hannah",
      lastContactAt: at(-3, 11, 5),
      nextFollowUpAt: at(4, 9, 0),
      notes: "Imported record — historic contact details being confirmed before intake planning.",
      deferredAt: at(-2, 9, 0),
      reengagementFlag: false,
    },
  ];
}

/* -------------------------- Commercial -------------------------------- */

export function buildCommercialOpportunities(): CommercialOpportunity[] {
  return [
    {
      id: "CO-4001",
      leadId: "L-2003",
      fundingEligibilityOutcome: "Not Eligible for Funding",
      referralReason: "Not eligible for government funding",
      programmeInterest: "Marketing Manager with CIM Level 6",
      suggestedProgramme: "Marketing Manager with CIM Level 6 — Commercial",
      optionType: "Privately funded apprenticeship",
      fundingInterest: "Self-funded",
      budgetStatus: "Not discussed",
      quoteStatus: "Not required",
      commercialOwnerId: "u-leila",
      nextFollowUpAt: at(1, 11, 0),
      notes: "Referred for a commercial review; suitability not yet confirmed.",
      stage: "Referred",
      referredAt: at(-5, 10, 15),
      updatedAt: at(-5, 10, 15),
    },
    {
      id: "CO-4002",
      leadId: "L-2016",
      fundingEligibilityOutcome: "Review Required",
      referralReason: "Below minimum weekly hours",
      programmeInterest: "Operations Manager Level 5",
      suggestedProgramme: "Short Course — Leadership Essentials",
      optionType: "Commercial course",
      fundingInterest: "Employer-funded",
      budgetStatus: "Budget approved",
      quoteStatus: "Sent",
      commercialOwnerId: "u-tom",
      nextFollowUpAt: at(2, 14, 0),
      notes: "Employer happy to fund a short course while the funding review continues.",
      stage: "Quote Sent",
      referredAt: at(-6, 12, 0),
      updatedAt: at(-1, 15, 0),
    },
    {
      id: "CO-4003",
      leadId: "L-2012",
      fundingEligibilityOutcome: "Not Eligible for Funding",
      referralReason: "Outside apprenticeship scope",
      programmeInterest: "Digital Marketing Level 4",
      suggestedProgramme: "Short Course — Project Controls Fundamentals",
      optionType: "Commercial course",
      fundingInterest: "Self-funded",
      budgetStatus: "Budget approved",
      quoteStatus: "Accepted",
      commercialOwnerId: "u-leila",
      nextFollowUpAt: at(5, 10, 0),
      notes: "Accepted a self-funded short course instead of the funded route.",
      stage: "Closed Won",
      referredAt: at(-14, 11, 0),
      updatedAt: at(-2, 10, 0),
    },
  ];
}

/* ------------------------ Employer onboarding -------------------------- */

export function buildEmployerAgreements(): EmployerAgreement[] {
  return [
    {
      id: "EA-5001",
      employerName: "Maven Projects",
      employerContact: "Priya Raman",
      status: "Requires Amendment",
      dateSent: at(-9, 10, 0),
      verifiedById: "u-hannah",
      followUpDueAt: at(1, 10, 0),
      notes: "Legal entity name needs correcting before countersignature.",
      leadId: "L-2038",
      applicationId: "APP-50231",
      updatedAt: at(-1, 10, 0),
    },
    {
      id: "EA-5002",
      employerName: "Ashworth Group",
      employerContact: "Peter Ashworth",
      status: "Awaiting Signature",
      dateSent: at(-4, 10, 0),
      verifiedById: "u-hannah",
      followUpDueAt: at(3, 10, 0),
      notes: "Sent to the employer for signature.",
      leadId: "L-1987",
      updatedAt: at(-4, 10, 0),
    },
    {
      id: "EA-5003",
      employerName: "Kingsley Group",
      employerContact: "Sandra Whitmore",
      status: "Signed",
      dateSent: at(-30, 10, 0),
      dateSigned: at(-26, 14, 0),
      verifiedById: "u-hannah",
      notes: "Agreement signed in the demonstration dataset.",
      leadId: "L-2050",
      updatedAt: at(-26, 14, 0),
    },
    {
      id: "EA-5004",
      employerName: "Stonebridge",
      employerContact: "Tariq Mahmood",
      status: "Signed",
      dateSent: at(-20, 10, 0),
      dateSigned: at(-17, 11, 0),
      verifiedById: "u-hannah",
      notes: "Signed and filed.",
      leadId: "L-2049",
      updatedAt: at(-17, 11, 0),
    },
    {
      id: "EA-5005",
      employerName: "Brightworks Ltd",
      employerContact: "Elaine Foster",
      status: "Sent",
      dateSent: at(-1, 16, 0),
      followUpDueAt: at(2, 10, 0),
      notes: "New employer enquiry — agreement issued pending confirmation of volumes.",
      leadId: "L-2036",
      updatedAt: at(-1, 16, 0),
    },
  ];
}

export function buildDasRecords(): DasRecord[] {
  return [
    {
      id: "DAS-6001",
      employerName: "Maven Projects",
      status: "Provider Addition Requested",
      accountSetupHelpNeeded: false,
      ukprnShared: true,
      providerAdditionRequested: true,
      providerAdditionConfirmed: false,
      fundingActionsReviewed: false,
      responsibleStaffId: "u-hannah",
      lastUpdatedAt: at(-2, 10, 0),
      followUpAt: at(1, 10, 0),
      notes: "Provider addition requested; awaiting the employer's confirmation.",
      leadId: "L-2038",
    },
    {
      id: "DAS-6002",
      employerName: "Ashworth Group",
      status: "Awaiting Confirmation",
      accountSetupHelpNeeded: false,
      ukprnShared: true,
      providerAdditionRequested: true,
      providerAdditionConfirmed: false,
      fundingActionsReviewed: true,
      responsibleStaffId: "u-hannah",
      lastUpdatedAt: at(-3, 10, 0),
      followUpAt: at(2, 10, 0),
      notes: "Employer action taken; awaiting confirmation of the provider addition.",
      leadId: "L-1987",
    },
    {
      id: "DAS-6003",
      employerName: "Kingsley Group",
      status: "Confirmed",
      accountSetupHelpNeeded: false,
      ukprnShared: true,
      providerAdditionRequested: true,
      providerAdditionConfirmed: true,
      fundingActionsReviewed: true,
      responsibleStaffId: "u-hannah",
      lastUpdatedAt: at(-25, 10, 0),
      notes: "Kent Business College confirmed as a provider.",
      leadId: "L-2050",
    },
    {
      id: "DAS-6004",
      employerName: "Stonebridge",
      status: "Confirmed",
      accountSetupHelpNeeded: false,
      ukprnShared: true,
      providerAdditionRequested: true,
      providerAdditionConfirmed: true,
      fundingActionsReviewed: true,
      responsibleStaffId: "u-hannah",
      lastUpdatedAt: at(-16, 10, 0),
      notes: "Provider addition confirmed.",
      leadId: "L-2049",
    },
    {
      id: "DAS-6005",
      employerName: "Brightworks Ltd",
      status: "Employer Account Required",
      accountSetupHelpNeeded: true,
      ukprnShared: false,
      providerAdditionRequested: false,
      providerAdditionConfirmed: false,
      fundingActionsReviewed: false,
      responsibleStaffId: "u-hannah",
      lastUpdatedAt: at(-1, 16, 10),
      followUpAt: at(2, 10, 0),
      notes: "New employer without an apprenticeship service account — setup assistance needed.",
      leadId: "L-2036",
    },
  ];
}