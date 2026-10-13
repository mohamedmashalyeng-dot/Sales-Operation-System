export interface DemoNotification {
  id: string;
  title: string;
  message: string;
  time: string;
  tone: "danger" | "warning" | "primary" | "success" | "neutral";
  icon: string;
  category: string;
}

export const demoNotifications: DemoNotification[] = [
  {
    id: "n1",
    title: "3 emails are past SLA",
    message: "Admissions inbox has 3 unanswered emails over 24 hours old.",
    time: "12m ago",
    tone: "danger",
    icon: "ri-time-line",
    category: "Inbox",
  },
  {
    id: "n2",
    title: "Overdue task assigned to you",
    message: "Call back: Prospective MBA applicant — due yesterday 16:00.",
    time: "1h ago",
    tone: "warning",
    icon: "ri-error-warning-line",
    category: "Planner",
  },
  {
    id: "n3",
    title: "New application submitted",
    message: "Project Controls Professional Level 6 — Sept intake.",
    time: "2h ago",
    tone: "primary",
    icon: "ri-file-add-line",
    category: "Applications",
  },
  {
    id: "n4",
    title: "Event confirmation",
    message: "Rachel Okonkwo confirmed attendance for Open Evening.",
    time: "3h ago",
    tone: "success",
    icon: "ri-checkbox-circle-line",
    category: "Events",
  },
  {
    id: "n5",
    title: "Zoho CRM sync needs attention",
    message: "4 records failed to sync and can be retried.",
    time: "5h ago",
    tone: "neutral",
    icon: "ri-refresh-line",
    category: "Integrations",
  },
];