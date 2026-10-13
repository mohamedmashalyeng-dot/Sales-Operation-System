import type { IntegrationStatus } from "@/store/types";

export interface NavItem {
  key: string;
  label: string;
  path: string;
  icon: string;
  badge?: number;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    title: "Overview",
    items: [{ key: "today", label: "Today", path: "/", icon: "ri-dashboard-3-line" }],
  },
  {
    title: "Admissions & Sales",
    items: [
      { key: "leads", label: "Leads", path: "/leads", icon: "ri-contacts-book-2-line" },
      { key: "campaigns", label: "Campaigns", path: "/campaigns", icon: "ri-megaphone-line" },
      {
        key: "applications",
        label: "Applications",
        path: "/applications",
        icon: "ri-file-list-3-line",
      },
    ],
  },
  {
    title: "Apprenticeships",
    items: [
      {
        key: "future-intake",
        label: "Future Intake",
        path: "/future-intake",
        icon: "ri-calendar-schedule-line",
      },
      {
        key: "commercial",
        label: "Commercial",
        path: "/commercial",
        icon: "ri-briefcase-4-line",
      },
      {
        key: "employers",
        label: "Employers",
        path: "/employers",
        icon: "ri-building-2-line",
      },
    ],
  },
  {
    title: "Communication",
    items: [
      { key: "inbox", label: "Inbox", path: "/inbox", icon: "ri-inbox-archive-line" },
      { key: "planner", label: "Planner", path: "/planner", icon: "ri-calendar-todo-line" },
    ],
  },
  {
    title: "Reporting",
    items: [
      {
        key: "attribution",
        label: "Sources & Attribution",
        path: "/sources",
        icon: "ri-flow-chart",
      },
      {
        key: "apprenticeship-reports",
        label: "Apprenticeship Reports",
        path: "/apprenticeship-reports",
        icon: "ri-bar-chart-box-line",
      },
      {
        key: "scenarios",
        label: "Scenarios",
        path: "/scenarios",
        icon: "ri-route-line",
      },
    ],
  },
  {
    title: "Integrations",
    items: [
      { key: "zoom", label: "Zoom", path: "/zoom", icon: "ri-vidicon-line" },
      { key: "events", label: "Events", path: "/events", icon: "ri-calendar-event-line" },
      { key: "zoho", label: "Zoho CRM", path: "/zoho", icon: "ri-cloud-line" },
      { key: "developer", label: "Developer", path: "/developer", icon: "ri-code-s-slash-line" },
    ],
  },
  {
    title: "Administration",
    items: [
      { key: "admin", label: "Admin", path: "/admin", icon: "ri-shield-user-line" },
      { key: "settings", label: "Settings", path: "/settings", icon: "ri-settings-4-line" },
      { key: "audit", label: "Audit Trail", path: "/audit", icon: "ri-history-line" },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

export const INTEGRATIONS: IntegrationStatus[] = [
  {
    key: "gmail",
    label: "Gmail",
    icon: "ri-mail-line",
    status: "disconnected",
    detail: "Not connected - no Gmail records loaded",
  },
  {
    key: "zoho",
    label: "Zoho CRM",
    icon: "ri-cloud-line",
    status: "disconnected",
    detail: "Not connected - no Zoho records loaded",
  },
  {
    key: "zoom",
    label: "Zoom",
    icon: "ri-vidicon-line",
    status: "disconnected",
    detail: "Not connected - no Zoom meetings or calls loaded",
  },
  {
    key: "eventbrite",
    label: "Eventbrite",
    icon: "ri-calendar-event-line",
    status: "disconnected",
    detail: "Not connected - no Eventbrite records loaded",
  },
];

export interface Crumb {
  label: string;
  path?: string;
}

function prettify(segment: string): string {
  return segment
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function getBreadcrumb(pathname: string): Crumb[] {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return [{ label: "Today" }];

  const crumbs: Crumb[] = [{ label: "Workspace", path: "/" }];
  let acc = "";
  segments.forEach((segment, index) => {
    acc += `/${segment}`;
    const match = ALL_NAV_ITEMS.find((item) => item.path === acc);
    const label = match ? match.label : prettify(segment);
    const isLast = index === segments.length - 1;
    crumbs.push({ label, path: isLast ? undefined : acc });
  });
  return crumbs;
}
