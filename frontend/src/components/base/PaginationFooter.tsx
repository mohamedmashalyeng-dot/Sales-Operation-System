import Pagination from "@/components/base/Pagination";
import { cn } from "@/utils/format";

interface PaginationFooterProps {
  currentPage: number;
  pageCount: number;
  total: number;
  itemLabel: string;
  onPageChange: (page: number) => void;
  position?: "top" | "bottom";
}

export default function PaginationFooter({
  currentPage,
  pageCount,
  total,
  itemLabel,
  onPageChange,
  position = "bottom",
}: PaginationFooterProps) {
  if (pageCount <= 1) return null;

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 px-4 py-3",
        position === "top" ? "border-b border-background-200" : "border-t border-background-200",
      )}
    >
      <span className="text-[12px] text-foreground-500">
        Page {currentPage} of {pageCount} - {total} {itemLabel}
      </span>
      <Pagination page={currentPage} pageCount={pageCount} onPageChange={onPageChange} />
    </div>
  );
}
