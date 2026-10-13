import Button from "@/components/base/Button";
import SearchInput from "@/components/base/SearchInput";
import Select from "@/components/base/Select";
import { APPLICATION_STATUSES, INTAKES, PROGRAMMES } from "@/config/crm";
import { useWorkspace } from "@/store/WorkspaceProvider";

export interface ApplicationFilterState {
  search: string;
  status: string;
  programme: string;
  intake: string;
  owner: string;
}

export const DEFAULT_APPLICATION_FILTERS: ApplicationFilterState = {
  search: "",
  status: "all",
  programme: "all",
  intake: "all",
  owner: "all",
};

interface ApplicationFiltersProps {
  filters: ApplicationFilterState;
  onChange: (next: ApplicationFilterState) => void;
  ownerOptions: { value: string; label: string }[];
}

export default function ApplicationFilters({
  filters,
  onChange,
  ownerOptions,
}: ApplicationFiltersProps) {
  const { state } = useWorkspace();
  const update = (patch: Partial<ApplicationFilterState>) => onChange({ ...filters, ...patch });

  const activeCount = [
    filters.status !== "all",
    filters.programme !== "all",
    filters.intake !== "all",
    filters.owner !== "all",
  ].filter(Boolean).length;

  return (
    <div className="rounded-lg border border-background-200 bg-background-50 p-3 md:p-4">
      <div className="flex flex-wrap items-end gap-2.5">
        <div className="min-w-[9rem] flex-1 sm:flex-none">
          <Select
            label="Status"
            size="sm"
            className="w-full sm:w-[11rem]"
            value={filters.status}
            onChange={(v) => update({ status: v })}
            options={[
              { value: "all", label: "All statuses" },
              ...APPLICATION_STATUSES.map((s) => ({ value: s, label: s })),
            ]}
          />
        </div>
        <div className="min-w-[9rem] flex-1 sm:flex-none">
          <Select
            label="Programme"
            size="sm"
            className="w-full sm:w-[13rem]"
            value={filters.programme}
            onChange={(v) => update({ programme: v })}
            options={[
              { value: "all", label: "All programmes" },
              ...PROGRAMMES.map((p) => ({ value: p, label: p })),
            ]}
          />
        </div>
        <div className="min-w-[9rem] flex-1 sm:flex-none">
          <Select
            label="Intake"
            size="sm"
            className="w-full sm:w-[11rem]"
            value={filters.intake}
            onChange={(v) => update({ intake: v })}
            options={[{ value: "all", label: "All intakes" }, ...INTAKES.map((i) => ({ value: i, label: i }))]}
          />
        </div>
        <div className="min-w-[9rem] flex-1 sm:flex-none">
          <Select
            label="Owner"
            size="sm"
            className="w-full sm:w-[12rem]"
            value={filters.owner}
            onChange={(v) => update({ owner: v })}
            options={ownerOptions}
          />
        </div>
        <div className="flex-1 basis-full lg:basis-auto lg:min-w-[14rem]">
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-500">
            Search
          </label>
          <SearchInput
            value={filters.search}
            onChange={(v) => update({ search: v })}
            placeholder="Search applicant, email, reference…"
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0"
          leftIcon={<i className="ri-refresh-line"></i>}
          onClick={() => onChange({ ...DEFAULT_APPLICATION_FILTERS })}
          disabled={activeCount === 0 && !filters.search}
        >
          Reset{activeCount > 0 ? ` (${activeCount})` : ""}
        </Button>
      </div>
      <p className="mt-2 text-[11px] text-foreground-400">
        {state.applications.length} applications in the shared demonstration dataset
      </p>
    </div>
  );
}