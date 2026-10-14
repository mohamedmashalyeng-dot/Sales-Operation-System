import Select from "@/components/base/Select";
import SearchInput from "@/components/base/SearchInput";
import { useWorkspace } from "@/store/WorkspaceProvider";
import { leadProgrammeOptions, ownerOptions } from "@/utils/filterOptions";

export interface SourceFilterState {
  range: string;
  programme: string;
  owner: string;
  search: string;
}

export const DEFAULT_SOURCE_FILTERS: SourceFilterState = {
  range: "all",
  programme: "all",
  owner: "all",
  search: "",
};

interface SourceFiltersProps {
  filters: SourceFilterState;
  onChange: (next: SourceFilterState) => void;
}

export default function SourceFilters({ filters, onChange }: SourceFiltersProps) {
  const { state } = useWorkspace();
  const set = (patch: Partial<SourceFilterState>) => onChange({ ...filters, ...patch });
  const programmes = leadProgrammeOptions(state);
  const owners = ownerOptions(state);

  return (
    <div className="rounded-lg border border-background-200 bg-background-50 p-3">
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <Select
          value={filters.range}
          onChange={(v) => set({ range: v })}
          options={[
            { value: "all", label: "All time" },
            { value: "7", label: "Last 7 days" },
            { value: "30", label: "Last 30 days" },
            { value: "90", label: "Last 90 days" },
          ]}
        />
        <Select
          value={filters.programme}
          onChange={(v) => set({ programme: v })}
          options={programmes}
        />
        <Select
          value={filters.owner}
          onChange={(v) => set({ owner: v })}
          options={owners}
        />
        <SearchInput
          value={filters.search}
          onChange={(v) => set({ search: v })}
          placeholder="Search source or campaign…"
        />
      </div>
    </div>
  );
}
