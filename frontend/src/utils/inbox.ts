import type { EmailThread, ThreadStatusKey } from "@/store/types";

export const THREAD_STATUS_LABELS: Record<ThreadStatusKey, string> = {
  unanswered: "Unanswered",
  unread: "Unread",
  "seen-no-reply": "Seen, no reply",
  overdue: "Overdue",
  resolved: "Resolved",
  sent: "Sent",
  all: "All",
  trash: "Trash",
};

export const THREAD_STATUS_ORDER: ThreadStatusKey[] = [
  "all",
  "unanswered",
  "unread",
  "seen-no-reply",
  "overdue",
  "resolved",
  "sent",
  "trash",
];

export function isAwaitingReply(thread: EmailThread): boolean {
  return thread.responseState === "unanswered" || thread.responseState === "seen-no-reply";
}

export function isOverdue(thread: EmailThread): boolean {
  return (
    !thread.trashed &&
    isAwaitingReply(thread) &&
    new Date(thread.deadlineAt).getTime() < Date.now()
  );
}

export function matchesStatus(thread: EmailThread, key: ThreadStatusKey): boolean {
  switch (key) {
    case "all":
      return !thread.trashed;
    case "trash":
      return thread.trashed;
    case "resolved":
      return !thread.trashed && thread.responseState === "resolved";
    case "sent":
      return !thread.trashed && thread.responseState === "replied";
    case "overdue":
      return isOverdue(thread);
    case "unanswered":
      return !thread.trashed && isAwaitingReply(thread);
    case "unread":
      return !thread.trashed && thread.readState === "unread";
    case "seen-no-reply":
      return !thread.trashed && thread.responseState === "seen-no-reply";
    default:
      return false;
  }
}

export function threadStatusCounts(threads: EmailThread[]): Record<ThreadStatusKey, number> {
  const counts = {
    unanswered: 0,
    unread: 0,
    "seen-no-reply": 0,
    overdue: 0,
    resolved: 0,
    sent: 0,
    all: 0,
    trash: 0,
  } as Record<ThreadStatusKey, number>;
  threads.forEach((thread) => {
    THREAD_STATUS_ORDER.forEach((key) => {
      if (matchesStatus(thread, key)) counts[key] += 1;
    });
  });
  return counts;
}

export function durationLabel(fromIso: string): string {
  const diff = Date.now() - new Date(fromIso).getTime();
  const abs = Math.abs(diff);
  const minutes = Math.round(abs / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

export function responseDeadlineTone(thread: EmailThread): "danger" | "warning" | "success" | "neutral" {
  if (thread.responseState === "resolved") return "success";
  if (isOverdue(thread)) return "danger";
  if (isAwaitingReply(thread)) {
    const hoursLeft = (new Date(thread.deadlineAt).getTime() - Date.now()) / 3600000;
    if (hoursLeft <= 6) return "warning";
    return "neutral";
  }
  return "neutral";
}
