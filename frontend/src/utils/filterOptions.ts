import type { SelectOption } from "@/components/base/Select";
import type { WorkspaceState } from "@/store/types";

type ValueGetter<T> = (item: T) => string | null | undefined;

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

export function uniqueOptions<T>(
  rows: T[],
  getValue: ValueGetter<T>,
  first: SelectOption,
): SelectOption[] {
  const values = Array.from(
    new Set(rows.map(getValue).map(clean).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b));
  return [first, ...values.map((value) => ({ value, label: value }))];
}

export function ownerOptions(state: WorkspaceState, first: SelectOption = { value: "all", label: "All owners" }): SelectOption[] {
  return [
    first,
    ...state.users
      .filter((user) => clean(user.id) && clean(user.name))
      .map((user) => ({ value: user.id, label: user.name })),
  ];
}

export function leadProgrammeOptions(state: WorkspaceState, first: SelectOption = { value: "all", label: "All programmes" }): SelectOption[] {
  return uniqueOptions(state.leads, (lead) => lead.programme, first);
}

export function leadIntakeOptions(state: WorkspaceState, first: SelectOption = { value: "all", label: "All intakes" }): SelectOption[] {
  return uniqueOptions(state.leads, (lead) => lead.intake, first);
}

export function leadSourceOptions(state: WorkspaceState, first: SelectOption = { value: "all", label: "All sources" }): SelectOption[] {
  return uniqueOptions(state.leads, (lead) => lead.source, first);
}

export function leadStageOptions(state: WorkspaceState, first: SelectOption = { value: "all", label: "All stages" }): SelectOption[] {
  return uniqueOptions(state.leads, (lead) => lead.stage, first);
}

export function leadPriorityOptions(state: WorkspaceState, first: SelectOption = { value: "all", label: "All priorities" }): SelectOption[] {
  return uniqueOptions(state.leads, (lead) => lead.priority, first);
}

export function applicationProgrammeOptions(state: WorkspaceState, first: SelectOption = { value: "all", label: "All programmes" }): SelectOption[] {
  return uniqueOptions(state.applications, (application) => application.programme, first);
}

export function applicationIntakeOptions(state: WorkspaceState, first: SelectOption = { value: "all", label: "All intakes" }): SelectOption[] {
  return uniqueOptions(state.applications, (application) => application.intake, first);
}

export function applicationStatusOptions(state: WorkspaceState, first: SelectOption = { value: "all", label: "All statuses" }): SelectOption[] {
  return uniqueOptions(state.applications, (application) => application.status, first);
}

export function eventSourceOptions(state: WorkspaceState, first: SelectOption = { value: "all", label: "All sources" }): SelectOption[] {
  return uniqueOptions(state.events, (event) => event.source, first);
}

export function taskPriorityOptions(state: WorkspaceState, first: SelectOption = { value: "all", label: "All priorities" }): SelectOption[] {
  return uniqueOptions(state.tasks, (task) => task.priority, first);
}

export function taskSourceOptions(state: WorkspaceState, first: SelectOption = { value: "all", label: "All sources" }): SelectOption[] {
  return uniqueOptions(state.tasks, (task) => task.source, first);
}
