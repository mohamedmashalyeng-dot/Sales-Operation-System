import Button from "@/components/base/Button";
import SearchInput from "@/components/base/SearchInput";
import Select, { type SelectOption } from "@/components/base/Select";

export const DATE_FILTERS = [
  { value: "next-7", label: "Next 7 days" },
  { value: "next-30", label: "Next 30 days" },
  { value: "next-90", label: "Next 90 days" },
  { value: "all-upcoming", label: "All upcoming" },
  { value: "past", label: "Past events" },
  { value: "all-time", label: "All time" },
];

interface EventFiltersProps {
  dateFilter: string;
  onDateFilter: (value: string) => void;
  source: string;
  onSource: (value: string) => void;
  sourceOptions: SelectOption[];
  search: string;
  onSearch: (value: string) => void;
}

export default function EventFilters({
  dateFilter,
  onDateFilter,
  source,
  onSource,
  sourceOptions,
  search,
  onSearch,
}: EventFiltersProps) {
  const reset = () => {
    onDateFilter("all-time");
    onSource("all");
    onSearch("");
  };
  const active = dateFilter !== "all-time" || source !== "all" || Boolean(search);

  return (
    <div className="rounded-lg border border-background-200 bg-background-50 p-3 md:p-4">
      <div className="flex flex-wrap items-end gap-2.5">
        <div className="min-w-[9rem] flex-1 sm:flex-none">
          <Select
            label="Date range"
            size="sm"
            className="w-full sm:w-[12rem]"
            value={dateFilter}
            onChange={onDateFilter}
            options={DATE_FILTERS}
          />
        </div>
        <div className="min-w-[9rem] flex-1 sm:flex-none">
          <Select
            label="Source"
            size="sm"
            className="w-full sm:w-[11rem]"
            value={source}
            onChange={onSource}
            options={sourceOptions}
          />
        </div>
        <div className="flex-1 basis-full lg:basis-auto lg:min-w-[14rem]">
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-500">
            Search
          </label>
          <SearchInput value={search} onChange={onSearch} placeholder="Search event name or location…" />
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0"
          leftIcon={<i className="ri-refresh-line"></i>}
          onClick={reset}
          disabled={!active}
        >
          Reset
        </Button>
      </div>
    </div>
  );
}
