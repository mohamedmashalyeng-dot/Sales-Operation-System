import Button from "@/components/base/Button";
import SearchInput from "@/components/base/SearchInput";
import Select, { type SelectOption } from "@/components/base/Select";
import { INTAKES, LEAD_SOURCES } from "@/config/crm";

export interface TodayFilterState {
  range: string;
  programme: string;
  intake: string;
  owner: string;
  source: string;
  search: string;
}

export const DEFAULT_FILTERS: TodayFilterState = {
  range: "7d",
  programme: "all",
  intake: "all",
  owner: "all",
  source: "all",
  search: "",
};

export const RANGE_OPTIONS: SelectOption[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "quarter", label: "This quarter" },
];

export const INTAKE_OPTIONS: SelectOption[] = [
  { value: "all", label: "All intakes" },
  ...INTAKES.map((i) => ({ value: i, label: i })),
];

export const SOURCE_OPTIONS: SelectOption[] = [
  { value: "all", label: "All sources" },
  ...LEAD_SOURCES.map((s) => ({ value: s, label: s })),
];

interface TodayFiltersProps {
  filters: TodayFilterState;
  onChange: (next: TodayFilterState) => void;
  programmeOptions: SelectOption[];
  ownerOptions: SelectOption[];
}

export default function TodayFilters({
  filters,
  onChange,
  programmeOptions,
  ownerOptions,
}: TodayFiltersProps) {
  const activeCount = [
    filters.programme !== "all",
    filters.intake !== "all",
    filters.owner !== "all",
    filters.source !== "all",
  ].filter(Boolean).length;

  const update = (patch: Partial<TodayFilterState>) => onChange({ ...filters, ...patch });

  return (
    <div className="rounded-lg border border-background-200 bg-background-50 p-3 md:p-4">
      <div className="flex flex-wrap items-end gap-2.5">
        <div className="min-w-[9rem] flex-1 sm:flex-none">
          <Select
            label="Date range"
            size="sm"
            className="w-full sm:w-[10rem]"
            value={filters.range}
            onChange={(v) => update({ range: v })}
            options={RANGE_OPTIONS}
          />
        </div>
        <div className="min-w-[9rem] flex-1 sm:flex-none">
          <Select
            label="Programme"
            size="sm"
            className="w-full sm:w-[13rem]"
            value={filters.programme}
            onChange={(v) => update({ programme: v })}
            options={programmeOptions}
          />
        </div>
        <div className="min-w-[9rem] flex-1 sm:flex-none">
          <Select
            label="Intake"
            size="sm"
            className="w-full sm:w-[11rem]"
            value={filters.intake}
            onChange={(v) => update({ intake: v })}
            options={INTAKE_OPTIONS}
          />
        </div>
        <div className="min-w-[9rem] flex-1 sm:flex-none">
          <Select
            label="Owner"
            size="sm"
            className="w-full sm:w-[11rem]"
            value={filters.owner}
            onChange={(v) => update({ owner: v })}
            options={ownerOptions}
          />
        </div>
        <div className="min-w-[9rem] flex-1 sm:flex-none">
          <Select
            label="Lead source"
            size="sm"
            className="w-full sm:w-[12rem]"
            value={filters.source}
            onChange={(v) => update({ source: v })}
            options={SOURCE_OPTIONS}
          />
        </div>
        <div className="flex-1 basis-full lg:basis-auto lg:min-w-[14rem]">
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-500">
            Search
          </label>
          <SearchInput
            value={filters.search}
            onChange={(v) => update({ search: v })}
            placeholder="Search leads, tasks, activity…"
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0"
          leftIcon={<i className="ri-refresh-line"></i>}
          onClick={() => onChange({ ...DEFAULT_FILTERS })}
          disabled={activeCount === 0 && !filters.search}
        >
          Reset{activeCount > 0 ? ` (${activeCount})` : ""}
        </Button>
      </div>
    </div>
  );
}