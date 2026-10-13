import type { FutureIntakeRecord, Lead } from "@/store/types";

export interface IntakeRow {
  record: FutureIntakeRecord;
  lead?: Lead;
}

export interface IntakeFilterValues {
  search: string;
  programme: string;
  owner: string;
  reason: string;
  due: "all" | "overdue" | "upcoming";
}

export const DEFAULT_INTAKE_FILTERS: IntakeFilterValues = {
  search: "",
  programme: "all",
  owner: "all",
  reason: "all",
  due: "all",
};