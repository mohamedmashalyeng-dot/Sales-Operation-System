import type { RoleId } from "@/config/permissions";

/**
 * Guided, role-based User Acceptance checklist.
 *
 * IMPORTANT: this is frontend-only, SIMULATED permissions. It demonstrates how
 * the four operational roles behave, but it is NOT production authentication or
 * authorisation — every check runs in the browser and can be bypassed.
 */

export type UatExpectation = "permitted" | "restricted";

export interface UatItem {
  id: string;
  label: string;
  expect: UatExpectation;
  detail: string;
  route?: string;
}

export interface RoleUatGroup {
  roleId: RoleId;
  roleName: string;
  summary: string;
  icon: string;
  items: UatItem[];
}

export const ROLE_UAT: RoleUatGroup[] = [
  {
    roleId: "sales",
    roleName: "Staff Sales",
    summary: "Owns assigned leads, sales calls and follow-ups.",
    icon: "ri-user-star-line",
    items: [
      { id: "sales-leads", label: "Assigned Lead access", expect: "permitted", detail: "Only leads owned by the acting sales user are listed.", route: "/leads" },
      { id: "sales-call", label: "Call follow-up detail", expect: "permitted", detail: "Call follow-up records are visible for leads the sales user owns.", route: "/leads" },
      { id: "sales-recording", label: "Call evidence access", expect: "permitted", detail: "Call evidence appears only when the record flags media available; transcript only when flagged.", route: "/leads" },
      { id: "sales-notes", label: "Sales notes", expect: "permitted", detail: "Adds and saves a note on an assigned lead.", route: "/leads" },
      { id: "sales-followup", label: "Follow-up creation", expect: "permitted", detail: "Creates a Planner follow-up task.", route: "/planner" },
      { id: "sales-apollo", label: "Apollo filters", expect: "permitted", detail: "Apollo.io source filters work on Leads.", route: "/leads" },
      { id: "sales-enrolment", label: "Restricted enrolment actions", expect: "restricted", detail: "Cannot record a verified funding decision or edit restricted enrolment stages.", route: "/leads" },
    ],
  },
  {
    roleId: "enrolment",
    roleName: "Staff Enrolment",
    summary: "Owns applications, eligibility, employer onboarding and enrolments.",
    icon: "ri-file-user-line",
    items: [
      { id: "enrol-apps", label: "Relevant applications", expect: "permitted", detail: "Assigned applications are editable with notes and stage changes.", route: "/applications" },
      { id: "enrol-elig", label: "Eligibility review", expect: "permitted", detail: "Can record a verified funding decision on a lead.", route: "/leads" },
      { id: "enrol-agreement", label: "Employer Agreement", expect: "permitted", detail: "Manages employer agreement status explicitly.", route: "/employers" },
      { id: "enrol-das", label: "DAS tracking", expect: "permitted", detail: "Manages Apprenticeship Service provider-addition status, separate from enrolment.", route: "/employers" },
      { id: "enrol-sales", label: "Restricted sales actions", expect: "restricted", detail: "Cannot log sales calls or create leads.", route: "/leads" },
    ],
  },
  {
    roleId: "manager",
    roleName: "Manager",
    summary: "Team-wide visibility across sales, enrolment and reporting.",
    icon: "ri-team-line",
    items: [
      { id: "mgr-leads", label: "Team-wide leads & reports", expect: "permitted", detail: "Sees every lead and team-wide reporting figures.", route: "/apprenticeship-reports" },
      { id: "mgr-workload", label: "Sales & Enrolment workload", expect: "permitted", detail: "Team workload is visible on Today and the Audit trail.", route: "/" },
      { id: "mgr-audit", label: "Audit access", expect: "permitted", detail: "The audit trail is readable (where configured).", route: "/audit" },
      { id: "mgr-admin", label: "Admin-only controls", expect: "restricted", detail: "User and workspace-management controls belong to Admin.", route: "/admin" },
    ],
  },
  {
    roleId: "admin",
    roleName: "Admin",
    summary: "Full fictional workspace access and configuration.",
    icon: "ri-shield-user-line",
    items: [
      { id: "adm-all", label: "Full workspace visibility", expect: "permitted", detail: "Every module and record is reachable.", route: "/" },
      { id: "adm-users", label: "User & role controls", expect: "permitted", detail: "Demonstration users and roles are manageable.", route: "/admin" },
      { id: "adm-settings", label: "Demo settings", expect: "permitted", detail: "Preferences and workspace management are available.", route: "/settings" },
      { id: "adm-reset", label: "Data reset & migrations", expect: "permitted", detail: "Workspace data and migration state are available.", route: "/settings" },
    ],
  },
];
