export interface Kpi {
  id: string;
  label: string;
  value: number;
  hint: string;
  icon: string;
  tone: "primary" | "accent" | "secondary" | "danger" | "success";
  route: string;
}

export interface AttentionItem {
  id: string;
  title: string;
  detail: string;
  module: string;
  ageLabel: string;
  severity: "overdue" | "urgent" | "due" | "info";
  action: string;
  route: string;
}

export interface Lead {
  id: string;
  name: string;
  programme: string;
  intake: string;
  stage: string;
  priority: "High" | "Medium" | "Low";
  owner: string;
  source: string;
  lastContact: string;
  nextAction: string;
  overdue?: boolean;
}

export interface WorkTask {
  id: string;
  title: string;
  due: string;
  priority: "High" | "Medium" | "Low";
  source: string;
  related: string;
}

export interface Appointment {
  id: string;
  title: string;
  time: string;
  type: string;
  host: string;
}

export interface ActivityItem {
  id: string;
  actor: string;
  action: string;
  target: string;
  module: string;
  time: string;
  icon: string;
  tone: "primary" | "accent" | "secondary" | "success" | "danger";
}

export interface InboxTrendPoint {
  label: string;
  hours: number;
}

export interface InboxTracking {
  unanswered: number;
  overdue: number;
  resolved24h: number;
  averageHours: number;
  trend: InboxTrendPoint[];
}

export interface FilterOption {
  value: string;
  label: string;
}
