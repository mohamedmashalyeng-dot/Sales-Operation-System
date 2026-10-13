import { EMAIL_LABELS } from "@/config/crm";
import { INTEGRATIONS } from "@/config/navigation";
import { DEFAULT_ROLE_ID } from "@/config/permissions";
import { CURRENT_SCHEMA_VERSION } from "@/store/migrations";
import type { User, WorkspaceState } from "@/store/types";

const WORKSPACE_USERS: User[] = [
  {
    id: "u-amara",
    name: "Workspace Manager",
    role: "Manager",
    email: "manager@kentbusinesscollege.local",
    team: "Workspace",
  },
  {
    id: "u-tom",
    name: "Sales User",
    role: "Sales",
    email: "sales@kentbusinesscollege.local",
    team: "Workspace",
  },
  {
    id: "u-hannah",
    name: "Enrolment User",
    role: "Enrolment",
    email: "enrolment@kentbusinesscollege.local",
    team: "Workspace",
  },
  {
    id: "u-owen",
    name: "Workspace Admin",
    role: "Admin",
    email: "admin@kentbusinesscollege.local",
    team: "Workspace",
  },
];

export function createSeedState(): WorkspaceState {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    roleId: DEFAULT_ROLE_ID,
    users: WORKSPACE_USERS,
    leads: [],
    touchpoints: [],
    futureIntakes: [],
    commercialOpportunities: [],
    employerAgreements: [],
    dasRecords: [],
    threads: [],
    labels: EMAIL_LABELS,
    tasks: [],
    events: [],
    campaigns: [],
    applications: [],
    meetings: [],
    calls: [],
    activity: [],
    notifications: [],
    audit: [],
    integrationStatuses: INTEGRATIONS,
  };
}
