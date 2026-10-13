import type { CampaignRecipient, EventCampaign, ParticipationOutcome } from "@/store/types";
import { at, hoursAgo } from "@/store/seed/helpers";

/**
 * Fictional Eventbrite event campaigns. Recipients are linked to the SHARED
 * dataset by normalised email — a contact present in both Zoho and Eventbrite
 * is never duplicated. Participation outcomes are tracked separately from
 * registration and from attendance.
 */

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
    invitedAt: hoursAgo(72),
    ...extra,
  };
}

export function buildCampaigns(): EventCampaign[] {
  return [
    {
      id: "CMP-EV-3001",
      name: "Postgraduate Open Evening — Email Invitation",
      type: "Email invitation",
      platform: "Eventbrite",
      channel: "Email",
      crmSystem: "Zoho CRM",
      acquisitionProvider: "Apollo.io",
      eventId: "EV-2101",
      stage: "Registration Received",
      ownerId: "u-leila",
      subject: "You're invited: Kent Business College Postgraduate Open Evening",
      body:
        "Hello,\n\nWe would love to welcome you to our Postgraduate Open Evening at the Canterbury Campus. " +
        "Meet the programme leads, explore funding routes and ask any questions about the apprenticeship and " +
        "professional pathways.\n\nKind regards,\nKent Business College Admissions",
      audienceFileName: "zoho-export-open-evening.csv",
      recipients: [
        recipient("CR-1", "Grace Adeyemi", "grace.adeyemi@gmail.com", "+44 7700 900877", "L-2033", "Registered", {
          registeredAt: at(-9, 18, 30),
          registrationRef: "EV-2101:R-9001",
          delivered: true,
          opened: true,
          clicked: true,
        }),
        recipient("CR-2", "Nadia Rahman", "nadia.rahman@cypress.org", "+44 7700 900911", "L-1992", "Registered", {
          registeredAt: at(-5, 14, 0),
          registrationRef: "EV-2101:R-9002",
          delivered: true,
          opened: true,
        }),
        recipient("CR-3", "Rachel Okonkwo", "rachel.okonkwo@zorian.co.uk", "+44 7700 900311", "L-2024", "Registered", {
          registeredAt: at(-5, 16, 30),
          registrationRef: "EV-2101:R-9003",
          delivered: true,
          opened: true,
          clicked: true,
        }),
        recipient("CR-4", "Marek Kowalski", "m.kowalski@outlook.com", "+44 7700 900654", "L-2029", "Invited", {
          delivered: true,
        }),
        recipient("CR-5", "Yvonne Traherne", "yvonne.traherne@sundial.co.uk", "+44 7700 900255", undefined, "Invited", {
          matched: false,
          delivered: true,
        }),
        recipient("CR-6", "Amir Haddad", "amir.haddad@venta.co.uk", "+44 7700 900565", "L-2007", "Cancelled Registration", {
          registeredAt: at(-3, 15, 45),
          registrationRef: "EV-2101:R-9008",
          delivered: true,
          opened: true,
        }),
      ],
      notes: "Audience exported from Zoho CRM and uploaded to Eventbrite. Contacts originated from Apollo.io.",
      createdAt: at(-6, 9, 0),
      updatedAt: at(-5, 14, 0),
      sentAt: hoursAgo(72),
    },
    {
      id: "CMP-EV-3002",
      name: "Apprenticeship Employer Briefing — Invitation",
      type: "Email invitation",
      platform: "Eventbrite",
      channel: "Email",
      crmSystem: "Zoho CRM",
      acquisitionProvider: "Apollo.io",
      eventId: "EV-2098",
      stage: "Sent",
      ownerId: "u-amara",
      subject: "Invitation: Apprenticeship Employer Briefing",
      body:
        "Hello,\n\nYou are invited to our Apprenticeship Employer Briefing on Zoom, where we will outline " +
        "cohort plans, levy funding and the onboarding process.\n\nKind regards,\nKent Business College Employer Team",
      audienceFileName: "zoho-export-employer-briefing.csv",
      recipients: [
        recipient("CR-10", "Peter Ashworth", "p.ashworth@ashworthgroup.co.uk", "+44 7700 900655", "L-1987", "Registered", {
          registeredAt: at(-2, 9, 0),
          registrationRef: "EV-2098:R-8901",
          delivered: true,
          opened: true,
        }),
        recipient("CR-11", "Elaine Foster", "e.foster@brightworks.co.uk", "+44 7712 445566", "L-2036", "Invited", {
          delivered: true,
        }),
        recipient("CR-12", "Harrison Cole", "harrison.cole@brightpath.com", "+44 7700 900988", "L-2016", "Invited", {
          delivered: true,
          opened: true,
        }),
        recipient("CR-13", "Gareth Llewellyn", "gareth.l@gmail.com", "+44 7700 900344", "L-1998", "Registered", {
          registeredAt: at(-1, 16, 0),
          registrationRef: "EV-2098:R-8904",
          delivered: true,
        }),
      ],
      notes: "Employer audience exported from Zoho CRM. Some contacts were originally sourced from Apollo.io.",
      createdAt: at(-3, 10, 0),
      updatedAt: at(-2, 9, 0),
      sentAt: at(-2, 8, 0),
    },
    {
      id: "CMP-EV-3003",
      name: "CIM Level 6 Taster — Reminder",
      type: "Reminder",
      platform: "Eventbrite",
      channel: "Email",
      crmSystem: "Zoho CRM",
      acquisitionProvider: "Website",
      eventId: "EV-2094",
      stage: "Audience Imported",
      ownerId: "u-leila",
      subject: "Reminder: your CIM Level 6 Taster Session",
      body: "Hello,\n\nJust a reminder that the CIM Level 6 Taster Session is coming up. We look forward to seeing you.\n\nKent Business College",
      audienceFileName: "zoho-export-cim-taster.csv",
      recipients: [
        recipient("CR-20", "Nadia Rahman", "nadia.rahman@cypress.org", "+44 7700 900911", "L-1992", "Invited", { delivered: false }),
        recipient("CR-21", "Grace Adeyemi", "grace.adeyemi@gmail.com", "+44 7700 900877", "L-2033", "Invited", { delivered: false }),
      ],
      notes: "Audience imported, awaiting final checks before sending.",
      createdAt: hoursAgo(20),
      updatedAt: hoursAgo(20),
    },
  ];
}