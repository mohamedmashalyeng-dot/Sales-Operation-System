import type { AttendanceOutcome } from "@/config/marketing";

export type AttendanceDisplay = AttendanceOutcome | "Waiting";
type Timing = { startAt?: string; endAt?: string; status?: string };
type RecordedAttendance = { attendance?: string; status?: string; outcome?: string; attended_at?: string | null; checked_in_at?: string | null };

export function eventPhase(event: Timing, now = Date.now()): "upcoming" | "live" | "completed" {
  const start = Date.parse(event.startAt || "");
  const end = Date.parse(event.endAt || "");
  if (Number.isFinite(start) && start > now) return "upcoming";
  if (Number.isFinite(end) && (!Number.isFinite(start) || end >= start)) {
    if (end <= now) return "completed";
    return Number.isFinite(start) ? "live" : "upcoming";
  }
  const status = (event.status || "").toLowerCase();
  if (["completed", "past", "ended"].includes(status)) return "completed";
  if (["live", "started", "ongoing", "in progress"].includes(status)) return "live";
  return Number.isFinite(start) && start <= now ? "completed" : "upcoming";
}

export function recordedAttendance(person: RecordedAttendance): AttendanceOutcome {
  const explicit = (person.attendance || "").trim().toLowerCase();
  if (explicit === "attended") return "Attended";
  if (explicit === "did not attend") return "Did Not Attend";
  if (person.attended_at || person.checked_in_at) return "Attended";
  const statuses = [person.attendance, person.outcome, person.status].map(value => (value || "").trim().toLowerCase());
  if (statuses.some(status => ["no show", "no-show", "absent", "did not attend", "not attended"].includes(status))) return "Did Not Attend";
  if (statuses.some(status => ["attended", "present", "checked in", "checked_in", "checked-in"].includes(status))) return "Attended";
  return "Attendance Unknown";
}

export function eventAttendance(event: Timing, person: RecordedAttendance, now = Date.now()): AttendanceDisplay {
  return eventPhase(event, now) === "completed" ? recordedAttendance(person) : "Waiting";
}
