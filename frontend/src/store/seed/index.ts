import { EMAIL_LABELS } from "@/config/crm";
import { INTEGRATIONS } from "@/config/navigation";
import { DEFAULT_ROLE_ID } from "@/config/permissions";
import { CURRENT_SCHEMA_VERSION } from "@/store/migrations";
import { buildApolloApplications, buildApolloCalls, buildApolloCampaigns, buildApolloCommercialOpportunities, buildApolloDasRecords, buildApolloEmployerAgreements, buildApolloEvents, buildApolloFutureIntakes, buildApolloLeads, buildApolloMeetings, buildApolloTasks, buildApolloTouchpoints } from "@/store/seed/apollo";
import { buildCommercialOpportunities, buildDasRecords, buildEmployerAgreements, buildFutureIntakes, buildLeadProgression } from "@/store/seed/apprenticeship";
import { withCallDetail } from "@/store/seed/callDetails";
import { buildCampaigns } from "@/store/seed/campaigns";
import { buildEvents } from "@/store/seed/events";
import { buildThreads } from "@/store/seed/inbox";
import { buildLeads } from "@/store/seed/leads";
import { buildActivity, buildApplications, buildAudit, buildCalls, buildMeetings, buildNotifications } from "@/store/seed/operations";
import { buildTasks } from "@/store/seed/tasks";
import { buildTouchpoints } from "@/store/seed/touchpoints";
import { SEED_USERS } from "@/store/seed/users";
import type { Lead, User, WorkspaceState } from "@/store/types";

const WORKSPACE_USERS: User[] = [
  ...SEED_USERS,
  {
    id: "u-leila",
    name: "Marketing User",
    role: "Marketing",
    email: "marketing@kentbusinesscollege.local",
    team: "Workspace",
  },
];

function withProgression(leads: Lead[]): Lead[] {
  const progression = buildLeadProgression();
  return leads.map((lead) => {
    const match = progression[lead.id];
    if (!match) return lead;
    return {
      ...lead,
      eligibility: lead.eligibility ?? match.eligibility,
      intakePlanning: lead.intakePlanning ?? match.intakePlanning,
      enrolment: lead.enrolment ?? match.enrolment,
    };
  });
}

export function createSeedState(): WorkspaceState {
  const leads = withProgression([...buildLeads(), ...buildApolloLeads()]);
  const calls = [...buildCalls(), ...buildApolloCalls()].map(withCallDetail);

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    roleId: DEFAULT_ROLE_ID,
    users: WORKSPACE_USERS,
    leads,
    touchpoints: [...buildTouchpoints(), ...buildApolloTouchpoints()],
    futureIntakes: [...buildFutureIntakes(), ...buildApolloFutureIntakes()],
    commercialOpportunities: [...buildCommercialOpportunities(), ...buildApolloCommercialOpportunities()],
    employerAgreements: [...buildEmployerAgreements(), ...buildApolloEmployerAgreements()],
    dasRecords: [...buildDasRecords(), ...buildApolloDasRecords()],
    threads: buildThreads(),
    labels: EMAIL_LABELS,
    tasks: [...buildTasks(), ...buildApolloTasks()],
    events: [...buildEvents(), ...buildApolloEvents()],
    campaigns: [...buildCampaigns(), ...buildApolloCampaigns()],
    applications: [...buildApplications(), ...buildApolloApplications()],
    meetings: [...buildMeetings(), ...buildApolloMeetings()],
    calls,
    activity: buildActivity(),
    notifications: buildNotifications(),
    audit: buildAudit(),
    integrationStatuses: INTEGRATIONS,
  };
}
