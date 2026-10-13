import { useState } from "react";
import Badge from "@/components/base/Badge";
import PaginationFooter from "@/components/base/PaginationFooter";
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from "@/components/base/Table";
import type { SourcePerformanceRow } from "@/utils/attribution";

export type SourceSortKey =
  | "source"
  | "leads"
  | "won"
  | "lost"
  | "conversionRate"
  | "avgDaysToClose"
  | "avgTouches";

interface SourcePerformanceTableProps {
  rows: SourcePerformanceRow[];
  sortKey: SourceSortKey;
  sortDir: "asc" | "desc";
  onSort: (key: SourceSortKey) => void;
  onDrill: (source: string) => void;
}

const COLUMNS: { key: SourceSortKey; label: string; align?: "right" }[] = [
  { key: "source", label: "Source" },
  { key: "leads", label: "Leads", align: "right" },
  { key: "won", label: "Won", align: "right" },
  { key: "lost", label: "Lost", align: "right" },
  { key: "conversionRate", label: "Conv. rate", align: "right" },
  { key: "avgDaysToClose", label: "Avg days to close", align: "right" },
  { key: "avgTouches", label: "Avg touches", align: "right" },
];

const PER_PAGE = 50;

export default function SourcePerformanceTable({
  rows,
  sortKey,
  sortDir,
  onSort,
  onDrill,
}: SourcePerformanceTableProps) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  const pagedRows = rows.slice((currentPage - 1) * PER_PAGE, currentPage * PER_PAGE);

  const handleSort = (key: SourceSortKey) => {
    setPage(1);
    onSort(key);
  };

  return (
    <>
      <PaginationFooter
        position="top"
        currentPage={currentPage}
        pageCount={pageCount}
        total={rows.length}
        itemLabel="sources"
        onPageChange={setPage}
      />
      <TableWrap>
        <Table>
          <THead>
            {COLUMNS.map((col) => (
              <Th key={col.key} className={col.align === "right" ? "text-right" : undefined}>
                <button
                  type="button"
                  onClick={() => handleSort(col.key)}
                  className={`inline-flex cursor-pointer items-center gap-1 hover:text-foreground-800 ${
                    col.align === "right" ? "flex-row-reverse" : ""
                  }`}
                >
                  {col.label}
                  {sortKey === col.key ? (
                    <i className={sortDir === "asc" ? "ri-arrow-up-s-line" : "ri-arrow-down-s-line"}></i>
                  ) : null}
                </button>
              </Th>
            ))}
          </THead>
          <TBody>
            {pagedRows.map((row) => (
              <Tr key={row.source} onClick={() => onDrill(row.source)}>
                <Td>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground-900">{row.source}</span>
                    <Badge tone="neutral">{row.channel}</Badge>
                  </div>
                </Td>
                <Td className="text-right font-semibold">{row.leads}</Td>
                <Td className="text-right text-green-700">{row.won}</Td>
                <Td className="text-right text-red-600">{row.lost}</Td>
                <Td className="text-right font-semibold">{row.conversionRate.toFixed(1)}%</Td>
                <Td className="text-right">
                  {row.avgDaysToClose ? `${row.avgDaysToClose.toFixed(1)}d` : "--"}
                </Td>
                <Td className="text-right">{row.avgTouches.toFixed(1)}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </TableWrap>
      <PaginationFooter
        currentPage={currentPage}
        pageCount={pageCount}
        total={rows.length}
        itemLabel="sources"
        onPageChange={setPage}
      />
    </>
  );
}
