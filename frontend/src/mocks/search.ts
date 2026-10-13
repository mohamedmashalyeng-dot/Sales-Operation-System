export interface SearchEntry {
  id: string;
  title: string;
  subtitle: string;
  category: string;
  icon: string;
  path: string;
}

export const searchIndex: SearchEntry[] = [
  {
    id: "nav-inbox",
    title: "Inbox",
    subtitle: "Email response tracking",
    category: "Go to",
    icon: "ri-inbox-archive-line",
    path: "/inbox",
  },
  {
    id: "nav-leads",
    title: "Leads",
    subtitle: "CRM lead management",
    category: "Go to",
    icon: "ri-contacts-book-2-line",
    path: "/leads",
  },
  {
    id: "nav-planner",
    title: "Planner",
    subtitle: "Tasks and follow-ups",
    category: "Go to",
    icon: "ri-calendar-todo-line",
    path: "/planner",
  },
  {
    id: "nav-applications",
    title: "Applications",
    subtitle: "Admissions pipeline",
    category: "Go to",
    icon: "ri-file-list-3-line",
    path: "/applications",
  },
  {
    id: "nav-events",
    title: "Events",
    subtitle: "Registration and attendance",
    category: "Go to",
    icon: "ri-calendar-event-line",
    path: "/events",
  },
  {
    id: "lead-1",
    title: "Daniel Mercer",
    subtitle: "CMI Level 6 · Owner: Amara Whitfield",
    category: "Lead",
    icon: "ri-user-add-line",
    path: "/leads/L-2041",
  },
  {
    id: "lead-2",
    title: "Priya Raman",
    subtitle: "Project Controls Professional Level 6 · Owner: Tom Blackwood",
    category: "Lead",
    icon: "ri-user-add-line",
    path: "/leads/L-2038",
  },
  {
    id: "app-1",
    title: "Sofia Almeida",
    subtitle: "DAS Matter · Sept intake",
    category: "Application",
    icon: "ri-file-text-line",
    path: "/applications/APP-7781",
  },
  {
    id: "event-1",
    title: "Postgraduate Open Evening",
    subtitle: "12 Oct · Zoom",
    category: "Event",
    icon: "ri-calendar-event-line",
    path: "/events/EV-318",
  },
  {
    id: "email-1",
    title: "Re: Apprenticeship enquiry — Levy funding",
    subtitle: "From: h.osei@brightworks.co.uk",
    category: "Email",
    icon: "ri-mail-line",
    path: "/inbox/TH-5521",
  },
];