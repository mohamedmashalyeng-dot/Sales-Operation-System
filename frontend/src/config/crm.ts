import type { BadgeTone } from "@/components/base/Badge";

export const PROGRAMMES = [
  "CMI Level 6",
  "Project Controls Professional Level 6",
  "Marketing Manager with CIM Level 6",
  "Operations Manager Level 5",
  "Business Administration Level 3",
  "Digital Marketing Level 4",
  "Apprenticeship — Levy funded",
  "DAS Matter",
];

export const INTAKES = ["January 2026", "May 2026", "September 2026", "January 2027"];

export const LEAD_SOURCES = [
  "Apollo.io",
  "Facebook Ads",
  "Google Ads",
  "LinkedIn",
  "Website",
  "Organic Search",
  "Eventbrite",
  "Eventbrite Listing",
  "Direct Email Enquiry",
  "Zoom Webinars",
  "Email Campaigns",
  "Referral",
  "Partner",
  "Telephone",
  "Manual Import",
];

export const LEAD_STAGES = [
  "New",
  "Contacted",
  "Qualified",
  "Proposal sent",
  "Nurture",
  "Won",
  "Lost",
] as const;

export const PRIORITIES = ["High", "Medium", "Low"] as const;

export const TASK_SOURCES = [
  "Call analysis",
  "Zoho CRM",
  "Gmail / Inbox",
  "Events",
  "Zoom",
  "Applications",
  "Manual",
] as const;

export const APPLICATION_STATUSES = [
  "Submitted",
  "Under review",
  "Interview",
  "Offer",
  "Enrolled",
  "Rejected",
  "Withdrawn",
] as const;

export interface EmailLabel {
  id: string;
  name: string;
  tone: BadgeTone;
  system?: boolean;
}

export const EMAIL_LABELS: EmailLabel[] = [
  { id: "lbl-inbox", name: "Inbox", tone: "primary", system: true },
  { id: "lbl-unread", name: "Unread", tone: "primary", system: true },
  { id: "lbl-important", name: "Important", tone: "danger", system: true },
  { id: "lbl-starred", name: "Starred", tone: "accent", system: true },
  { id: "lbl-sent", name: "Sent", tone: "secondary", system: true },
  { id: "lbl-resolved", name: "Resolved", tone: "success", system: true },
  { id: "lbl-trash", name: "Trash", tone: "neutral", system: true },
  { id: "lbl-zoho", name: "Zoho", tone: "primary" },
  { id: "lbl-zoho-contracts", name: "Zoho Contracts", tone: "primary" },
  { id: "lbl-events", name: "Events", tone: "accent" },
  { id: "lbl-contract", name: "Contract Matter", tone: "secondary" },
  { id: "lbl-das", name: "DAS Matter", tone: "secondary" },
  { id: "lbl-aptem", name: "Aptem Matter", tone: "secondary" },
  { id: "lbl-apprenticeship", name: "Apprenticeship Interests", tone: "accent" },
  { id: "lbl-mkt-cim", name: "Marketing Manager with CIM Level 6", tone: "primary" },
  { id: "lbl-pc-l6", name: "Project Controls Professional Level 6", tone: "primary" },
  { id: "lbl-bookings", name: "Bookings", tone: "accent" },
  { id: "lbl-commercial", name: "Commercial", tone: "secondary" },
  { id: "lbl-left-job", name: "Left The Job", tone: "neutral" },
  { id: "lbl-others", name: "Others", tone: "neutral" },
  { id: "lbl-ooo", name: "Out of Office", tone: "warning" as BadgeTone },
  { id: "lbl-personal", name: "Personal", tone: "neutral" },
  { id: "lbl-promotions", name: "Promotions", tone: "neutral" },
  { id: "lbl-unsubscribe", name: "Unsubscribe", tone: "neutral" },
  { id: "lbl-updates", name: "Updates", tone: "secondary" },
];

export function labelById(id: string): EmailLabel | undefined {
  return EMAIL_LABELS.find((label) => label.id === id);
}

export function labelName(id: string): string {
  return labelById(id)?.name ?? id;
}
