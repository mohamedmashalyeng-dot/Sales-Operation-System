import { useMemo } from "react";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/store/WorkspaceProvider";
import type { Lead, Task, User } from "@/store/types";
import { formatDate, relativeTime } from "@/utils/format";
import { computeApprenticeshipMetrics } from "@/utils/apprenticeship";
import type {
  ActivityItem,
  Appointment,
  AttentionItem,
  InboxTracking,
  Kpi,
  Lead as LeadRow,
  WorkTask,
} from "@/pages/today/types";

export interface TeamRow {
  userId: string;
  name: string;
  role: string;
  team: string;
  openTasks: number;
  overdue: number;
  leadsOwned: number;
  unanswered: number;
}

export interface TodayFilterValues {
  range: string;
  programme: string;
  intake: string;
  owner: string;
  source: string;
  search: string;
}

const PRIORITY_ORDER: Record<string, number> = { High: 0, Medium: 1, Low: 2 };

function timeLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const isToday = date.toDateString() === new Date().toDateString();
  if (isToday) {
    return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }
  return formatDate(iso);
}

function daysSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 86400000;
}

export interface TodayData {
  kpis: Kpi[];
  attention: AttentionItem[];
  leads: LeadRow[];
  tasks: WorkTask[];
  appointments: Appointment[];
  activity: ActivityItem[];
  inboxTracking: InboxTracking;
  team: TeamRow[];
  ownerOptions: { value: string; label: string }[];
  programmeOptions: { value: string; label: string }[];
}

export function useTodayData(filters: TodayFilterValues): TodayData {
  const { state, userName, getUser } = useWorkspace();
  const { canSeeOwner, seesAll, can } = usePermissions();

  return useMemo(() => {
    const now = Date.now();
    const activeThread = (t: (typeof state.threads)[number]) => !t.trashed;

    const visibleLeads = state.leads.filter((l) => canSeeOwner(l.ownerId));
    const visibleThreads = state.threads.filter((t) => activeThread(t) && canSeeOwner(t.ownerId));
    const visibleTasks = state.tasks.filter((t) => canSeeOwner(t.ownerId));
    const visibleApps = state.applications.filter((a) => canSeeOwner(a.ownerId));

    const openTasks = visibleTasks.filter((t) => t.status === "open");
    const overdueTasks = openTasks.filter((t) => new Date(t.dueAt).getTime() < now);
    const unreadThreads = visibleThreads.filter((t) => t.readState === "unread");
    const unansweredThreads = visibleThreads.filter((t) => t.responseState === "unanswered");
    const overdueEmails = unansweredThreads.filter((t) => new Date(t.deadlineAt).getTime() < now);
    const resolved24h = visibleThreads.filter((t) => {
      if (t.responseState !== "resolved" || !t.resolvedAt) return false;
      return now - new Date(t.resolvedAt).getTime() <= 86400000;
    });
    const answeredThreads = visibleThreads
      .map((thread) => {
        const firstOutbound = thread.messages
          .filter((message) => message.direction === "outbound")
          .sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime())[0];
        if (!firstOutbound) return null;
        return {
          receivedAt: thread.receivedAt,
          responseAt: firstOutbound.sentAt,
        };
      })
      .filter((thread): thread is { receivedAt: string; responseAt: string } => Boolean(thread));
    const averageHours =
      answeredThreads.length > 0
        ? answeredThreads.reduce(
            (sum, thread) =>
              sum +
              Math.max(
                0,
                (new Date(thread.responseAt).getTime() - new Date(thread.receivedAt).getTime()) /
                  3600000,
              ),
            0,
          ) / answeredThreads.length
        : 0;
    const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const trend = dayLabels.map((label, index) => {
      const samples = answeredThreads
        .filter((thread) => {
          const date = new Date(thread.responseAt);
          return Number.isFinite(date.getTime()) && ((date.getDay() + 6) % 7) === index;
        })
        .map(
          (thread) =>
            Math.max(
              0,
              (new Date(thread.responseAt).getTime() - new Date(thread.receivedAt).getTime()) /
                3600000,
            ),
        );
      const hours =
        samples.length > 0 ? samples.reduce((sum, sample) => sum + sample, 0) / samples.length : 0.1;
      return { label, hours };
    });
    const inboxTracking: InboxTracking = {
      unanswered: unansweredThreads.length,
      overdue: overdueEmails.length,
      resolved24h: resolved24h.length,
      averageHours,
      trend,
    };
    const newApplicants = visibleApps.filter(
      (a) => a.status === "Submitted" || a.status === "Under review",
    );
    const integrationAlerts = state.notifications.filter(
      (n) => n.module === "Integrations" && n.tone === "danger",
    );
    const overdueFollowUps = visibleLeads.filter(
      (l) => l.stage !== "Won" && l.stage !== "Lost" && new Date(l.nextActionAt).getTime() < now,
    );
    const newLeadsWeek = visibleLeads.filter((l) => daysSince(l.createdAt) <= 7);
    const appMetrics = computeApprenticeshipMetrics(state, canSeeOwner);

    const kpis: Kpi[] = [
      {
        id: "new-leads",
        label: "New leads",
        value: newLeadsWeek.length,
        hint: `Created in the last 7 days`,
        icon: "ri-user-add-line",
        tone: "primary",
        route: "/leads?created=week",
      },
      {
        id: "follow-ups",
        label: "Follow-ups due",
        value: overdueFollowUps.length,
        hint: overdueFollowUps.length ? `${overdueFollowUps.length} already overdue` : "On track",
        icon: "ri-reply-line",
        tone: "accent",
        route: "/leads?followup=overdue",
      },
      {
        id: "overdue-tasks",
        label: "Overdue tasks",
        value: overdueTasks.length,
        hint: overdueTasks.length ? "Needs action today" : "Nothing overdue",
        icon: "ri-error-warning-line",
        tone: "danger",
        route: "/planner?view=overdue",
      },
      {
        id: "open-tasks",
        label: "Open tasks",
        value: openTasks.length,
        hint: `${openTasks.filter((t) => new Date(t.dueAt).toDateString() === new Date().toDateString()).length} due today`,
        icon: "ri-checkbox-multiple-line",
        tone: "secondary",
        route: "/planner?view=list",
      },
      {
        id: "unread-mails",
        label: "Unread emails",
        value: unreadThreads.length,
        hint: `${unreadThreads.filter((t) => t.important).length} marked important`,
        icon: "ri-mail-line",
        tone: "primary",
        route: "/inbox?status=unread",
      },
      {
        id: "unanswered-mails",
        label: "Unanswered emails",
        value: unansweredThreads.length,
        hint: `${unansweredThreads.filter((t) => new Date(t.deadlineAt).getTime() < now).length} past SLA`,
        icon: "ri-mail-send-line",
        tone: "danger",
        route: "/inbox?status=unanswered",
      },
      {
        id: "new-applications",
        label: "New applications",
        value: newApplicants.length,
        hint: `Awaiting review or decision`,
        icon: "ri-file-add-line",
        tone: "accent",
        route: "/applications?status=Submitted",
      },
      {
        id: "integration-alerts",
        label: "Operational alerts",
        value: integrationAlerts.length,
        hint: integrationAlerts.length ? "Zoho sync needs attention" : "No active alerts",
        icon: "ri-plug-line",
        tone: "danger",
        route: "/zoho",
      },
      {
        id: "apprenticeship-eligibility",
        label: "Eligibility to review",
        value: appMetrics.reviewRequired + appMetrics.informationRequired,
        hint: appMetrics.notEligibleFunding
          ? `${appMetrics.notEligibleFunding} not eligible for funding`
          : "Screening progressing",
        icon: "ri-shield-check-line",
        tone: "accent",
        route: "/apprenticeship-reports",
      },
      {
        id: "future-intake",
        label: "Future intake pipeline",
        value: appMetrics.futureIntakePipeline,
        hint: appMetrics.futureIntakeOverdue
          ? `${appMetrics.futureIntakeOverdue} follow-ups overdue`
          : "Eligible learners deferred",
        icon: "ri-calendar-schedule-line",
        tone: "primary",
        route: "/future-intake",
      },
      {
        id: "commercial",
        label: "Commercial pipeline",
        value: appMetrics.commercialOpen,
        hint: `${appMetrics.commercialClosedWon} closed won`,
        icon: "ri-briefcase-4-line",
        tone: "secondary",
        route: "/commercial",
      },
    ];

    /* ---------------------------- attention queue ---------------------------- */
    const attention: AttentionItem[] = [];
    if (overdueEmails.length) {
      const oldest = overdueEmails.reduce((min, t) =>
        new Date(t.receivedAt).getTime() < new Date(min.receivedAt).getTime() ? t : min,
      );
      attention.push({
        id: "att-emails",
        title: `${overdueEmails.length} email${overdueEmails.length > 1 ? "s" : ""} past response SLA`,
        detail: `Oldest unanswered thread is "${oldest.subject}".`,
        module: "Inbox",
        ageLabel: relativeTime(oldest.receivedAt),
        severity: "overdue",
        action: "Open inbox",
        route: "/inbox?status=overdue",
      });
    }
    overdueTasks.slice(0, 2).forEach((task) => {
      attention.push({
        id: `att-task-${task.id}`,
        title: task.title,
        detail: task.description || "Overdue task assigned to you.",
        module: "Planner",
        ageLabel: relativeTime(task.dueAt),
        severity: "urgent",
        action: "Open task",
        route: "/planner?view=overdue",
      });
    });
    if (integrationAlerts.length && seesAll) {
      attention.push({
        id: "att-integration",
        title: "Zoho CRM sync needs attention",
        detail: integrationAlerts[0].message,
        module: "Integrations",
        ageLabel: relativeTime(integrationAlerts[0].createdAt),
        severity: "urgent",
        action: "Review sync",
        route: "/zoho",
      });
    }
    const pendingCallbacks = state.events
      .flatMap((e) => e.registrations.map((r) => ({ event: e, reg: r })))
      .filter(({ reg }) => reg.outcome === "pending" && reg.callbackAt);
    if (pendingCallbacks.length) {
      attention.push({
        id: "att-callbacks",
        title: `${pendingCallbacks.length} event callbacks scheduled`,
        detail: `Confirm attendance for ${pendingCallbacks[0].event.name}.`,
        module: "Events",
        ageLabel: timeLabel(pendingCallbacks[0].reg.callbackAt as string),
        severity: "due",
        action: "Open event",
        route: "/events",
      });
    }
    const newApps24 = visibleApps.filter(
      (a) => a.status === "Submitted" && daysSince(a.submittedAt) <= 1,
    );
    if (newApps24.length) {
      attention.push({
        id: "att-apps",
        title: `${newApps24.length} application${newApps24.length > 1 ? "s" : ""} awaiting review`,
        detail: `${newApps24[0].applicantName} — ${newApps24[0].programme}.`,
        module: "Applications",
        ageLabel: relativeTime(newApps24[0].submittedAt),
        severity: "due",
        action: "Open applications",
        route: "/applications?status=Submitted",
      });
    }

    const overdueIntakes = state.futureIntakes
      .map((fi) => ({ fi, lead: state.leads.find((l) => l.id === fi.leadId) }))
      .filter(({ fi, lead }) => canSeeOwner(lead?.ownerId ?? fi.salesOwnerId))
      .filter(({ fi }) => new Date(fi.nextFollowUpAt).getTime() < now);
    if (overdueIntakes.length) {
      attention.push({
        id: "att-future-intake",
        title: `${overdueIntakes.length} future intake follow-up${overdueIntakes.length > 1 ? "s" : ""} overdue`,
        detail: `${overdueIntakes[0].lead?.name ?? overdueIntakes[0].fi.leadId} is due for re-engagement (${overdueIntakes[0].fi.preferredIntake}).`,
        module: "Future Intake",
        ageLabel: relativeTime(overdueIntakes[0].fi.nextFollowUpAt),
        severity: "overdue",
        action: "Open future intake",
        route: "/future-intake",
      });
    }
    const eligibilityReviews = visibleLeads.filter(
      (l) => l.eligibility?.status === "Review Required" || l.eligibility?.status === "Information Required",
    );
    if (eligibilityReviews.length) {
      attention.push({
        id: "att-eligibility",
        title: `${eligibilityReviews.length} eligibility case${eligibilityReviews.length > 1 ? "s" : ""} need attention`,
        detail: `${eligibilityReviews[0].name} — ${eligibilityReviews[0].eligibility?.status}.`,
        module: "Eligibility",
        ageLabel: relativeTime(eligibilityReviews[0].lastContactAt),
        severity: "urgent",
        action: "Open lead",
        route: `/leads/${eligibilityReviews[0].id}`,
      });
    }
    const dasBlocked = state.dasRecords
      .map((d) => ({ d, lead: d.leadId ? state.leads.find((l) => l.id === d.leadId) : undefined }))
      .filter(({ lead }) => !lead || canSeeOwner(lead.ownerId))
      .filter(({ d }) => d.status === "Blocked / Needs Help" || d.status === "Employer Account Required");
    if (dasBlocked.length) {
      attention.push({
        id: "att-das",
        title: `${dasBlocked.length} employer Apprenticeship Service issue${dasBlocked.length > 1 ? "s" : ""}`,
        detail: `${dasBlocked[0].d.employerName} — ${dasBlocked[0].d.status}.`,
        module: "Employers",
        ageLabel: relativeTime(dasBlocked[0].d.lastUpdatedAt),
        severity: "urgent",
        action: "Open employer",
        route: "/employers",
      });
    }

    /* ------------------------------- mappings -------------------------------- */
    const toLeadRow = (lead: Lead): LeadRow => ({
      id: lead.id,
      name: lead.name,
      programme: lead.programme,
      intake: lead.intake,
      stage: lead.stage,
      priority: lead.priority,
      owner: userName(lead.ownerId),
      source: lead.source,
      lastContact: relativeTime(lead.lastContactAt),
      nextAction: lead.nextAction || "Follow up",
      overdue:
        lead.stage !== "Won" &&
        lead.stage !== "Lost" &&
        new Date(lead.nextActionAt).getTime() < now,
    });

    const relatedLabel = (task: Task): string => {
      const lead = state.leads.find((l) => l.id === task.relatedLeadId);
      if (lead) return lead.name;
      const thread = state.threads.find((t) => t.id === task.relatedThreadId);
      if (thread) return thread.subject;
      const event = state.events.find((e) => e.id === task.relatedEventId);
      if (event) return event.name;
      return task.programme ?? "—";
    };

    const toWorkTask = (task: Task): WorkTask => ({
      id: task.id,
      title: task.title,
      due: timeLabel(task.dueAt),
      priority: task.priority,
      source: task.source,
      related: relatedLabel(task),
    });

    /* --------------------------------- filters ------------------------------- */
    const query = filters.search.trim().toLowerCase();
    const matchesCommon = (p: string, i: string, ownerId: string, source: string) => {
      if (filters.programme !== "all" && p !== filters.programme) return false;
      if (filters.intake !== "all" && i !== filters.intake) return false;
      if (filters.owner !== "all" && ownerId !== filters.owner) return false;
      if (filters.source !== "all" && source !== filters.source) return false;
      return true;
    };

    const sortedPriorityLeads = [...visibleLeads]
      .filter((l) => l.stage !== "Won" && l.stage !== "Lost")
      .sort((a, b) => {
        const po = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
        if (po !== 0) return po;
        return new Date(a.nextActionAt).getTime() - new Date(b.nextActionAt).getTime();
      });

    const leadRows = sortedPriorityLeads
      .filter((l) => matchesCommon(l.programme, l.intake, l.ownerId, l.source))
      .filter((l) => {
        if (!query) return true;
        return `${l.name} ${l.programme} ${l.ownerId} ${l.source} ${l.tags.join(" ")}`
          .toLowerCase()
          .includes(query);
      })
      .slice(0, 6)
      .map(toLeadRow);

    const myTasks = openTasks
      .filter((t) => {
        if (filters.owner !== "all" && t.ownerId !== filters.owner) return false;
        if (query && !`${t.title} ${t.description}`.toLowerCase().includes(query)) return false;
        return true;
      })
      .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
      .slice(0, 6)
      .map(toWorkTask);

    const todayMeetings: Appointment[] = state.meetings
      .filter((m) => new Date(m.startAt).toDateString() === new Date().toDateString())
      .filter((m) => {
        if (filters.owner !== "all" && m.hostId !== filters.owner) return false;
        return true;
      })
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
      .map((m) => {
        const start = new Date(m.startAt);
        const end = new Date(start.getTime() + m.durationMins * 60000);
        const fmt = (d: Date) =>
          d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
        return {
          id: m.id,
          title: m.topic,
          time: `${fmt(start)} – ${fmt(end)}`,
          type: "Zoom",
          host: userName(m.hostId),
        };
      });

    const activityItems: ActivityItem[] = state.activity
      .filter((a) => (seesAll ? true : canSeeOwner(a.actorId)))
      .filter((a) => {
        if (!query) return true;
        return `${userName(a.actorId)} ${a.action} ${a.target} ${a.module}`
          .toLowerCase()
          .includes(query);
      })
      .slice(0, 7)
      .map((a) => ({
        id: a.id,
        actor: userName(a.actorId),
        action: a.action,
        target: a.target,
        module: a.module,
        time: relativeTime(a.createdAt),
        icon: a.icon,
        tone: a.tone,
      }));

    /* ------------------------------ team overview ---------------------------- */
    let team: TeamRow[] = [];
    if (can("reports.team")) {
      team = state.users.map((u: User) => ({
        userId: u.id,
        name: u.name,
        role: u.role,
        team: u.team,
        openTasks: state.tasks.filter((t) => t.ownerId === u.id && t.status === "open").length,
        overdue: state.tasks.filter(
          (t) => t.ownerId === u.id && t.status === "open" && new Date(t.dueAt).getTime() < now,
        ).length,
        leadsOwned: state.leads.filter(
          (l) => l.ownerId === u.id && l.stage !== "Won" && l.stage !== "Lost",
        ).length,
        unanswered: state.threads.filter(
          (t) => t.ownerId === u.id && !t.trashed && t.responseState === "unanswered",
        ).length,
      }));
    }

    /* --------------------------------- options ------------------------------- */
    const programmes = Array.from(new Set(state.leads.map((l) => l.programme))).sort();
    const programmeOptions = [
      { value: "all", label: "All programmes" },
      ...programmes.map((p) => ({ value: p, label: p })),
    ];
    const ownerOptions = [
      { value: "all", label: "All owners" },
      ...state.users.map((u) => ({ value: u.id, label: u.name })),
    ];

    // getUser referenced to keep the dependency honest when host names resolve.
    void getUser;

    return {
      kpis,
      attention,
      leads: leadRows,
      tasks: myTasks,
      appointments: todayMeetings,
      activity: activityItems,
      inboxTracking,
      team,
      ownerOptions,
      programmeOptions,
    };
  }, [state, filters, canSeeOwner, seesAll, can, userName, getUser]);
}
