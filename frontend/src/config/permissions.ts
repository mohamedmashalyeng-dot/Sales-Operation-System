import type { BadgeTone } from "@/components/base/Badge";

/**
 * Frontend-only, simulated permission model.
 *
 * IMPORTANT: This is NOT real security. It exists purely so the browser
 * workspace can show how the four operational roles behave differently. All
 * checks happen in the browser and can be bypassed by anyone with devtools.
 */

export type RoleId = "sales" | "enrolment" | "manager" | "admin";

export type DataScope = "own" | "all";

export type Capability =
  /* overview */
  | "today.view"
  | "reports.team"
  /* leads */
  | "leads.view"
  | "leads.create"
  | "leads.edit"
  | "leads.delete"
  | "leads.assign"
  | "leads.logCall"
  | "attribution.view"
  | "attribution.manage"
  /* inbox */
  | "inbox.view"
  | "inbox.reply"
  | "inbox.compose"
  | "inbox.assign"
  | "inbox.resolve"
  | "inbox.bulk"
  /* planner */
  | "planner.view"
  | "planner.create"
  | "planner.edit"
  | "planner.complete"
  | "planner.delete"
  | "planner.assign"
  /* applications */
  | "applications.view"
  | "applications.edit"
  | "applications.note"
  | "applications.approve"
  /* events */
  | "events.view"
  | "events.manage"
  | "events.callback"
  | "events.import"
  | "events.reports"
  /* campaigns */
  | "campaigns.view"
  | "campaigns.manage"
  | "scenarios.view"
  /* zoom */
  | "zoom.view"
  | "zoom.callback"
  | "zoom.recordings"
  /* zoho */
  | "zoho.view"
  | "zoho.retry"
  /* administration */
  | "admin.view"
  | "admin.manageUsers"
  | "developer.view"
  | "settings.view"
  | "settings.manageWorkspace"
  | "audit.view"
  /* attribution */
  | "attribution.view"
  | "attribution.manage"
  | "attribution.correct"
  /* apprenticeship eligibility & progression */
  | "eligibility.view"
  | "eligibility.screen"
  | "eligibility.verify"
  | "intake.view"
  | "intake.manage"
  | "commercial.view"
  | "commercial.refer"
  | "commercial.manage"
  | "employer.view"
  | "employer.manage";

export interface RoleDefinition {
  id: RoleId;
  name: string;
  short: string;
  userId: string;
  description: string;
  icon: string;
  tone: BadgeTone;
  scope: DataScope;
  /** Navigation keys the role may see. "*" means everything. */
  navKeys: string[] | "*";
  capabilities: Capability[];
}

/* Shared capability building blocks ---------------------------------------- */

const SALES_OPS: Capability[] = [
  "today.view",
  "leads.view",
  "leads.create",
  "leads.edit",
  "leads.assign",
  "leads.logCall",
  "attribution.view",
  "attribution.manage",
  "inbox.view",
  "inbox.reply",
  "inbox.compose",
  "inbox.assign",
  "inbox.resolve",
  "planner.view",
  "planner.create",
  "planner.edit",
  "planner.complete",
  "planner.assign",
  "events.view",
  "zoom.view",
  "zoom.callback",
  "zoom.recordings",
  "campaigns.view",
  "scenarios.view",
  "eligibility.view",
  "eligibility.screen",
  "intake.view",
  "intake.manage",
  "commercial.view",
  "commercial.refer",
  "employer.view",
  "settings.view",
];

const ENROLMENT_OPS: Capability[] = [
  "today.view",
  "leads.view",
  "attribution.view",
  "attribution.manage",
  "inbox.view",
  "inbox.reply",
  "inbox.compose",
  "inbox.assign",
  "inbox.resolve",
  "planner.view",
  "planner.create",
  "planner.edit",
  "planner.complete",
  "planner.assign",
  "applications.view",
  "applications.edit",
  "applications.note",
  "applications.approve",
  "events.view",
  "events.manage",
  "events.callback",
  "zoom.view",
  "zoom.callback",
  "zoom.recordings",
  "campaigns.view",
  "scenarios.view",
  "eligibility.view",
  "eligibility.screen",
  "eligibility.verify",
  "intake.view",
  "intake.manage",
  "commercial.view",
  "commercial.manage",
  "employer.view",
  "employer.manage",
  "settings.view",
];

const MANAGER_OPS: Capability[] = [
  "today.view",
  "reports.team",
  "leads.view",
  "leads.create",
  "leads.edit",
  "leads.delete",
  "leads.assign",
  "leads.logCall",
  "inbox.view",
  "inbox.reply",
  "inbox.compose",
  "inbox.assign",
  "inbox.resolve",
  "inbox.bulk",
  "planner.view",
  "planner.create",
  "planner.edit",
  "planner.complete",
  "planner.delete",
  "planner.assign",
  "applications.view",
  "applications.edit",
  "applications.note",
  "applications.approve",
  "events.view",
  "events.manage",
  "events.callback",
  "events.import",
  "events.reports",
  "zoom.view",
  "zoom.callback",
  "zoom.recordings",
  "campaigns.view",
  "scenarios.view",
  "campaigns.manage",
  "zoho.view",
  "zoho.retry",
  "settings.view",
  "audit.view",
  "attribution.view",
  "attribution.manage",
  "eligibility.view",
  "intake.view",
  "commercial.view",
  "employer.view",
];

const ADMIN_OPS: Capability[] = [
  ...MANAGER_OPS,
  "admin.view",
  "admin.manageUsers",
  "developer.view",
  "settings.manageWorkspace",
  "attribution.correct",
  "eligibility.screen",
  "eligibility.verify",
  "intake.manage",
  "commercial.refer",
  "commercial.manage",
  "employer.manage",
];

/* Role definitions --------------------------------------------------------- */

export const ROLES: Record<RoleId, RoleDefinition> = {
  sales: {
    id: "sales",
    name: "Staff Sales",
    short: "Sales",
    userId: "u-tom",
    description:
      "Manages their assigned leads, sales emails, follow-ups and tasks, logs calls and notes, and sees individual sales performance.",
    icon: "ri-user-star-line",
    tone: "accent",
    scope: "own",
    navKeys: [
      "today",
      "leads",
      "campaigns",
      "scenarios",
      "inbox",
      "planner",
      "applications",
      "events",
      "future-intake",
      "commercial",
      "employers",
      "zoom",
      "zoho",
      "attribution",
      "settings",
    ],
    capabilities: SALES_OPS,
  },
  enrolment: {
    id: "enrolment",
    name: "Staff Enrolment",
    short: "Enrolment",
    userId: "u-hannah",
    description:
      "Owns assigned applications and enrolment workflows, works with applicant records and communications, and raises enrolment follow-ups.",
    icon: "ri-file-user-line",
    tone: "secondary",
    scope: "own",
    navKeys: [
      "today",
      "leads",
      "campaigns",
      "scenarios",
      "inbox",
      "planner",
      "applications",
      "future-intake",
      "commercial",
      "employers",
      "events",
      "zoom",
      "attribution",
      "settings",
    ],
    capabilities: ENROLMENT_OPS,
  },
  manager: {
    id: "manager",
    name: "Manager",
    short: "Manager",
    userId: "u-amara",
    description:
      "Sees team-wide records and performance, distributes work, reviews overdue workloads and operational bottlenecks. No system-admin rights.",
    icon: "ri-team-line",
    tone: "primary",
    scope: "all",
    navKeys: [
      "today",
      "leads",
      "campaigns",
      "scenarios",
      "inbox",
      "planner",
      "applications",
      "events",
      "zoom",
      "zoho",
      "future-intake",
      "commercial",
      "employers",
      "apprenticeship-reports",
      "settings",
      "audit",
      "attribution",
    ],
    capabilities: MANAGER_OPS,
  },
  admin: {
    id: "admin",
    name: "Admin",
    short: "Admin",
    userId: "u-owen",
    description:
      "Full workspace access - manages workspace users, roles and preferences, and can view system-wide audit activity.",
    icon: "ri-shield-user-line",
    tone: "danger",
    scope: "all",
    navKeys: "*",
    capabilities: ADMIN_OPS,
  },
};

export const ROLE_LIST: RoleDefinition[] = [
  ROLES.sales,
  ROLES.enrolment,
  ROLES.manager,
  ROLES.admin,
];

export const DEFAULT_ROLE_ID: RoleId = "manager";

export function isRoleId(value: unknown): value is RoleId {
  return value === "sales" || value === "enrolment" || value === "manager" || value === "admin";
}

export function roleById(id: RoleId): RoleDefinition {
  return ROLES[id] ?? ROLES[DEFAULT_ROLE_ID];
}

export function roleCan(roleId: RoleId, capability: Capability): boolean {
  return roleById(roleId).capabilities.includes(capability);
}

export function roleNavVisible(roleId: RoleId, navKey: string): boolean {
  const keys = roleById(roleId).navKeys;
  return keys === "*" || keys.includes(navKey);
}
