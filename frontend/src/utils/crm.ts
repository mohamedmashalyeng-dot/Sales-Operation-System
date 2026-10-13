import type { BadgeTone } from "@/components/base/Badge";
import type {
  ApplicationStatus,
  CallStatus,
  LeadStage,
  Priority,
  RegOutcome,
} from "@/store/types";

export const STAGE_TONES: Record<LeadStage, BadgeTone> = {
  New: "primary",
  Contacted: "secondary",
  Qualified: "accent",
  "Proposal sent": "warning",
  Nurture: "neutral",
  Won: "success",
  Lost: "danger",
};

export const PRIORITY_TONES: Record<Priority, BadgeTone> = {
  High: "danger",
  Medium: "warning",
  Low: "neutral",
};

export const OUTCOME_TONES: Record<RegOutcome, BadgeTone> = {
  confirmed: "success",
  declined: "danger",
  pending: "warning",
  attended: "primary",
  "no-show": "neutral",
};

export const APP_STATUS_TONES: Record<ApplicationStatus, BadgeTone> = {
  Submitted: "primary",
  "Under review": "secondary",
  Interview: "accent",
  Offer: "warning",
  Enrolled: "success",
  Rejected: "danger",
  Withdrawn: "neutral",
};

export const CALL_STATUS_TONES: Record<CallStatus, BadgeTone> = {
  answered: "success",
  connected: "primary",
  "no-answer": "warning",
  voicemail: "neutral",
};

export function toInputDateTime(iso?: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromInputDateTime(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

export function formatCurrency(value: number): string {
  return `£${value.toLocaleString("en-GB")}`;
}

export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "—";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}