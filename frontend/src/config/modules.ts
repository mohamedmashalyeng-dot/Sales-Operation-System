export interface ModuleMeta {
  key: string;
  path: string;
  title: string;
  phase: string;
  icon: string;
  description: string;
  features: string[];
  integration?: string;
}

export const PENDING_MODULES: ModuleMeta[] = [
  {
    key: "leads",
    path: "leads",
    title: "Leads",
    phase: "Phase 2",
    icon: "ri-contacts-book-2-line",
    description:
      "Complete CRM lead management with a searchable data table, advanced filters, lead detail, assignment, priority, contact and email history, tasks, related applications and an activity timeline.",
    features: [
      "Lead list with status, programme, source and owner filters",
      "Lead detail with contact, email and activity history",
      "Create, edit and assign leads with priority",
      "Zoho CRM sync indicators",
    ],
    integration: "Zoho CRM",
  },
  {
    key: "inbox",
    path: "inbox",
    title: "Inbox",
    phase: "Phase 2",
    icon: "ri-inbox-archive-line",
    description:
      "An enterprise email queue built for response tracking, not just reading. Reading, response and deadline states are kept separate, with SLA indicators and overdue durations front and centre.",
    features: [
      "Statuses: Unanswered, Unread, Seen no reply, Overdue, Resolved, Sent, All, Trash",
      "Search, filters by owner, label and date; sort by urgency",
      "Email detail with full conversation history and reply composer",
      "Bulk actions and assignment",
    ],
    integration: "Gmail",
  },
  {
    key: "planner",
    path: "planner",
    title: "Planner",
    phase: "Phase 2",
    icon: "ri-calendar-todo-line",
    description:
      "A unified productivity workspace combining tasks from Zoho CRM, Inbox, Events, Zoom, Applications and manual entries, with list and interactive calendar views.",
    features: [
      "Overview, task list, calendar, overdue, today, upcoming and completed views",
      "Create, edit, assign, reschedule, complete and reopen tasks",
      "Day, week and month calendar",
      "Overdue work surfaced prominently",
    ],
  },
  {
    key: "applications",
    path: "applications",
    title: "Applications",
    phase: "Phase 3",
    icon: "ri-file-list-3-line",
    description:
      "The admissions pipeline — overview, application list, search, filtering and full application detail with programme, intake, documents, notes, follow-up tasks and status history.",
    features: [
      "Applications overview and pipeline status",
      "Applicant detail with programme and intake",
      "Supporting documents and notes",
      "Status history and follow-up tasks",
    ],
  },
  {
    key: "events",
    path: "events",
    title: "Events",
    phase: "Phase 3",
    icon: "ri-calendar-event-line",
    description:
      "Registration and attendance management with a dashboard, events list, date filters, event detail, registration table, attendance marking and callbacks.",
    features: [
      "Dashboard metrics: registrations, confirmed, declined, pending, show-up rate",
      "Events list with date filters",
      "Event detail with booking statistics and registration table",
      "Excel/CSV import, Eventbrite and Zoom sync workflows",
    ],
    integration: "Eventbrite · Zoom",
  },
  {
    key: "zoom",
    path: "zoom",
    title: "Zoom",
    phase: "Phase 3",
    icon: "ri-vidicon-line",
    description:
      "Meetings and call management with an overview, meetings, calls, phone numbers and follow-ups. Verified contact matches are clearly distinguished from uncertain ones.",
    features: [
      "Upcoming and past meetings with host, account and join links",
      "Calls: incoming, outgoing, answered, no answer, duration",
      "Phone number directory with call frequency",
      "Linked CRM leads and scheduled callbacks",
    ],
    integration: "Zoom",
  },
  {
    key: "zoho",
    path: "zoho",
    title: "Zoho CRM",
    phase: "Phase 3",
    icon: "ri-cloud-line",
    description:
      "An integration-oriented CRM workspace showing synced contacts and leads, sync health, record detail, owner assignment, record mapping and sync errors with retry.",
    features: [
      "Synced contacts and leads",
      "Sync health monitoring",
      "Record detail and mapping",
      "Sync errors with retry states",
    ],
    integration: "Zoho CRM",
  },
  {
    key: "admin",
    path: "admin",
    title: "Admin",
    phase: "Phase 4",
    icon: "ri-shield-user-line",
    description:
      "Administrator views for users, roles and permissions, team performance, task monitoring, lead assignment, workflow monitoring, integration health, operational reporting and system alerts.",
    features: [
      "User and role management",
      "Team performance and task monitoring",
      "Workflow and integration monitoring",
      "Role-based visibility and system alerts",
    ],
  },
  {
    key: "developer",
    path: "developer",
    title: "Developer",
    phase: "Phase 4",
    icon: "ri-code-s-slash-line",
    description:
      "Diagnostics for API and integrations — sync logs, system status and error information for the engineering and integration team.",
    features: [
      "API and integration diagnostics",
      "Sync logs and system status",
      "Error information and retry",
      "Integration handoff notes",
    ],
  },
  {
    key: "settings",
    path: "settings",
    title: "Settings",
    phase: "Phase 4",
    icon: "ri-settings-4-line",
    description:
      "Workspace configuration including profile, workspace preferences, notifications, integration configuration, role permissions and display preferences.",
    features: [
      "Profile and workspace preferences",
      "Notification preferences",
      "Integration configuration",
      "Role permissions and display preferences",
    ],
  },
  {
    key: "audit",
    path: "audit",
    title: "Audit Trail",
    phase: "Phase 4",
    icon: "ri-history-line",
    description:
      "A complete audit trail of user actions and record changes with timestamps, actor, entity type, before/after values, search and filtering.",
    features: [
      "User actions and record changes",
      "Timestamp, actor and entity type",
      "Before/after values where available",
      "Search and filtering",
    ],
  },
];