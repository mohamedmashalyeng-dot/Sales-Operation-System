import Avatar from "@/components/base/Avatar";
import Badge from "@/components/base/Badge";
import Checkbox from "@/components/base/Checkbox";
import Menu from "@/components/base/Menu";
import { Table, TBody, Td, Th, THead, TableWrap, Tr } from "@/components/base/Table";
import { useWorkspace } from "@/store/WorkspaceProvider";
import type { Lead } from "@/store/types";
import { STAGE_TONES, formatCurrency } from "@/utils/crm";
import { formatDate } from "@/utils/format";

export type LeadSortKey =
  | "name"
  | "programme"
  | "stage"
  | "priority"
  | "owner"
  | "lastContactAt"
  | "value";

interface LeadTableProps {
  leads: Lead[];
  selectedIds: string[];
  onToggleSelect: (id: string) => void;
  onToggleAll: () => void;
  onOpen: (id: string) => void;
  onEdit: (lead: Lead) => void;
  onDelete: (lead: Lead) => void;
  sortKey: LeadSortKey;
  sortDir: "asc" | "desc";
  onSort: (key: LeadSortKey) => void;
}

export default function LeadTable({
  leads,
  selectedIds,
  onToggleSelect,
  onToggleAll,
  onOpen,
  onEdit,
  onDelete,
  sortKey,
  sortDir,
  onSort,
}: LeadTableProps) {
  const { userName } = useWorkspace();

  const allSelected = leads.length > 0 && leads.every((l) => selectedIds.includes(l.id));
  const someSelected = selectedIds.length > 0 && !allSelected;

  const header = (key: LeadSortKey, label: string, className?: string) => {
    const active = sortKey === key;
    return (
      <Th className={className}>
        <button
          type="button"
          onClick={() => onSort(key)}
          className="inline-flex cursor-pointer items-center gap-1 uppercase tracking-wide transition-colors hover:text-foreground-800"
        >
          {label}
          <span className="flex h-3.5 w-3.5 items-center justify-center text-[13px]">
            <i
              className={
                active
                  ? sortDir === "asc"
                    ? "ri-arrow-up-s-line"
                    : "ri-arrow-down-s-line"
                  : "ri-arrow-up-down-line text-foreground-300"
              }
            ></i>
          </span>
        </button>
      </Th>
    );
  };

  return (
    <TableWrap>
      <Table className="min-w-[1080px]">
        <THead>
          <Th className="w-10">
            <Checkbox
              checked={allSelected}
              indeterminate={someSelected}
              onChange={onToggleAll}
            />
          </Th>
          {header("name", "Lead")}
          {header("programme", "Programme")}
          {header("stage", "Stage")}
          {header("owner", "Owner")}
          <Th>Source</Th>
          <Th>Next action</Th>
          {header("value", "Value", "text-right")}
          <Th className="w-12 text-right">Actions</Th>
        </THead>
        <TBody>
          {leads.map((lead) => {
            const selected = selectedIds.includes(lead.id);
            return (
              <Tr key={lead.id} className={selected ? "bg-primary-50/50" : undefined}>
                <Td>
                  <Checkbox checked={selected} onChange={() => onToggleSelect(lead.id)} />
                </Td>
                <Td>
                  <button
                    type="button"
                    onClick={() => onOpen(lead.id)}
                    className="flex cursor-pointer items-center gap-2.5 text-left"
                  >
                    <Avatar name={lead.name} size="sm" />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[13px] font-semibold text-foreground-900 hover:text-primary-600">
                          {lead.name}
                        </span>
                        {lead.priority === "High" ? (
                          <span className="h-1.5 w-1.5 rounded-full bg-red-500" title="High priority" />
                        ) : null}
                        {lead.zohoSynced ? (
                          <span className="flex h-3.5 w-3.5 items-center justify-center text-[12px] text-primary-500" title="Synced with Zoho CRM">
                            <i className="ri-cloud-line"></i>
                          </span>
                        ) : null}
                      </span>
                      <span className="block truncate text-[11px] text-foreground-400">
                        {lead.email}
                      </span>
                    </span>
                  </button>
                </Td>
                <Td>
                  <span className="block max-w-[15rem] truncate text-[13px] font-medium text-foreground-800">
                    {lead.programme}
                  </span>
                  <span className="text-[11px] text-foreground-400">{lead.intake}</span>
                </Td>
                <Td>
                  <Badge tone={STAGE_TONES[lead.stage]}>{lead.stage}</Badge>
                </Td>
                <Td>
                  <span className="text-[13px] text-foreground-700">{userName(lead.ownerId)}</span>
                </Td>
                <Td>
                  <span className="whitespace-nowrap text-[12px] text-foreground-500">
                    {lead.source}
                  </span>
                </Td>
                <Td>
                  <span className="block max-w-[16rem] truncate text-[12px] text-foreground-700">
                    {lead.nextAction}
                  </span>
                  <span className="text-[11px] text-foreground-400">
                    {formatDate(lead.nextActionAt)}
                  </span>
                </Td>
                <Td className="text-right">
                  <span className="text-[13px] font-semibold text-foreground-900">
                    {formatCurrency(lead.value)}
                  </span>
                </Td>
                <Td className="text-right">
                  <Menu
                    trigger={
                      <span className="flex h-8 w-8 items-center justify-center rounded-md text-lg text-foreground-500 hover:bg-background-100 hover:text-foreground-800">
                        <i className="ri-more-2-fill"></i>
                      </span>
                    }
                    items={[
                      { key: "open", label: "Open lead", icon: "ri-eye-line", onSelect: () => onOpen(lead.id) },
                      { key: "edit", label: "Edit lead", icon: "ri-pencil-line", onSelect: () => onEdit(lead) },
                      {
                        key: "delete",
                        label: "Delete lead",
                        icon: "ri-delete-bin-line",
                        tone: "danger",
                        onSelect: () => onDelete(lead),
                      },
                    ]}
                  />
                </Td>
              </Tr>
            );
          })}
        </TBody>
      </Table>
    </TableWrap>
  );
}