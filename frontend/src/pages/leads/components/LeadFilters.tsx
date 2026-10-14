import Button from "@/components/base/Button";
import SearchInput from "@/components/base/SearchInput";
import Select from "@/components/base/Select";
import { useWorkspace } from "@/store/WorkspaceProvider";
import { cn } from "@/utils/format";
import {
  leadPriorityOptions,
  leadProgrammeOptions,
  leadSourceOptions,
  leadStageOptions,
  ownerOptions,
} from "@/utils/filterOptions";

export interface LeadFilterState {
  search: string;
  stage: string;
  programme: string;
  owner: string;
  source: string;
  priority: string;
  /** Only leads whose OWN recorded original acquisition provider is Apollo.io. */
  apolloOnly: boolean;
  /** Only leads with a linked Eventbrite campaign invitation (recipient activity). */
  eventbriteInvited: boolean;
  /** Acquisition-date range (uses the lead's ORIGINAL acquisition date). */
  acquisitionFrom: string;
  acquisitionTo: string;
}

export const DEFAULT_LEAD_FILTERS: LeadFilterState = {
  search: "",
  stage: "all",
  programme: "all",
  owner: "all",
  source: "all",
  priority: "all",
  apolloOnly: false,
  eventbriteInvited: false,
  acquisitionFrom: "",
  acquisitionTo: "",
};

interface LeadFiltersProps {
  filters: LeadFilterState;
  onChange: (next: LeadFilterState) => void;
}

export default function LeadFilters({ filters, onChange }: LeadFiltersProps) {
  const { state } = useWorkspace();

  const update = (patch: Partial<LeadFilterState>) => onChange({ ...filters, ...patch });

  const activeCount = [
    filters.stage !== "all",
    filters.programme !== "all",
    filters.owner !== "all",
    filters.source !== "all",
    filters.priority !== "all",
    filters.apolloOnly,
    filters.eventbriteInvited,
    Boolean(filters.acquisitionFrom),
    Boolean(filters.acquisitionTo),
  ].filter(Boolean).length;

  const owners = [
    { value: "all", label: "All owners" },
    { value: "unassigned", label: "Unassigned" },
    ...ownerOptions(state).slice(1),
  ];
  const stages = leadStageOptions(state);
  const programmes = leadProgrammeOptions(state);
  const sources = leadSourceOptions(state);
  const priorities = leadPriorityOptions(state);

  return (
    <div className="rounded-lg border border-background-200 bg-background-50 p-3 md:p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground-400">
          Quick filters
        </span>
        <button
          type="button"
          aria-pressed={filters.apolloOnly}
          onClick={() => update({ apolloOnly: !filters.apolloOnly })}
          className={cn(
            "inline-flex h-8 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[12px] font-semibold transition-colors",
            filters.apolloOnly
              ? "border-primary-400 bg-primary-500 text-background-50"
              : "border-background-300 bg-background-50 text-foreground-600 hover:bg-background-100",
          )}
          title="Leads whose own recorded original acquisition provider is Apollo.io — not Eventbrite recipients or Zoho exports"
        >
          <i className="ri-radar-line"></i> Apollo.io — Original Source
        </button>
        <button
          type="button"
          aria-pressed={filters.eventbriteInvited}
          onClick={() => update({ eventbriteInvited: !filters.eventbriteInvited })}
          className={cn(
            "inline-flex h-8 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[12px] font-semibold transition-colors",
            filters.eventbriteInvited
              ? "border-accent-400 bg-accent-500 text-background-50"
              : "border-background-300 bg-background-50 text-foreground-600 hover:bg-background-100",
          )}
          title="Leads with a linked Eventbrite campaign invitation — filtered by recipient activity, not by original source"
        >
          <i className="ri-mail-send-line"></i> Invited through Eventbrite
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-2.5">
        <div className="min-w-[9rem] flex-1 sm:flex-none">
          <Select
            label="Stage"
            size="sm"
            className="w-full sm:w-[10rem]"
            value={filters.stage}
            onChange={(v) => update({ stage: v })}
            options={stages}
          />
        </div>
        <div className="min-w-[9rem] flex-1 sm:flex-none">
          <Select
            label="Programme"
            size="sm"
            className="w-full sm:w-[13rem]"
            value={filters.programme}
            onChange={(v) => update({ programme: v })}
            options={programmes}
          />
        </div>
        <div className="min-w-[9rem] flex-1 sm:flex-none">
          <Select
            label="Owner"
            size="sm"
            className="w-full sm:w-[11rem]"
            value={filters.owner}
            onChange={(v) => update({ owner: v })}
            options={owners}
          />
        </div>
        <div className="min-w-[9rem] flex-1 sm:flex-none">
          <Select
            label="Source"
            size="sm"
            className="w-full sm:w-[11rem]"
            value={filters.source}
            onChange={(v) => update({ source: v })}
            options={sources}
          />
        </div>
        <div className="min-w-[9rem] flex-1 sm:flex-none">
          <Select
            label="Priority"
            size="sm"
            className="w-full sm:w-[10rem]"
            value={filters.priority}
            onChange={(v) => update({ priority: v })}
            options={priorities}
          />
        </div>
        <div className="flex-1 basis-full lg:basis-auto lg:min-w-[14rem]">
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-500">
            Search
          </label>
          <SearchInput
            value={filters.search}
            onChange={(v) => update({ search: v })}
            placeholder="Search name, email, programme…"
          />
        </div>
        <div className="min-w-[9rem] flex-1 sm:flex-none">
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-500">
            Acquired from
          </label>
          <input
            type="date"
            value={filters.acquisitionFrom}
            max={filters.acquisitionTo || undefined}
            onChange={(e) => update({ acquisitionFrom: e.target.value })}
            title="Filter by the lead's original acquisition date"
            className="h-8 w-full rounded-md border border-background-300 bg-background-50 px-3 text-[13px] text-foreground-900 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200 sm:w-[10.5rem]"
          />
        </div>
        <div className="min-w-[9rem] flex-1 sm:flex-none">
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-500">
            Acquired to
          </label>
          <input
            type="date"
            value={filters.acquisitionTo}
            min={filters.acquisitionFrom || undefined}
            onChange={(e) => update({ acquisitionTo: e.target.value })}
            title="Filter by the lead's original acquisition date"
            className="h-8 w-full rounded-md border border-background-300 bg-background-50 px-3 text-[13px] text-foreground-900 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200 sm:w-[10.5rem]"
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0"
          leftIcon={<i className="ri-refresh-line"></i>}
          onClick={() => onChange({ ...DEFAULT_LEAD_FILTERS })}
          disabled={activeCount === 0 && !filters.search}
        >
          Reset{activeCount > 0 ? ` (${activeCount})` : ""}
        </Button>
      </div>
    </div>
  );
}
