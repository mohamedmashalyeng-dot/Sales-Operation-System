import { cn } from "@/utils/format";

export interface PaginationProps {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  className?: string;
}

export default function Pagination({ page, pageCount, onPageChange, className }: PaginationProps) {
  if (pageCount <= 1) return null;

  const jumpBack = Math.max(1, page - 10);
  const jumpForward = Math.min(pageCount, page + 10);
  const pages: number[] = [];
  const start = Math.max(1, Math.min(page - 1, pageCount - 2));
  for (let i = start; i <= Math.min(pageCount, start + 2); i += 1) {
    pages.push(i);
  }

  return (
    <nav className={cn("flex items-center gap-1", className)} aria-label="Pagination">
      <button
        type="button"
        disabled={page === 1}
        onClick={() => onPageChange(jumpBack)}
        className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-background-300 text-foreground-600 transition-colors hover:bg-background-100 disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Go back 10 pages"
        title="Back 10 pages"
      >
        <i className="ri-arrow-left-double-line"></i>
      </button>
      <button
        type="button"
        disabled={page === 1}
        onClick={() => onPageChange(page - 1)}
        className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-background-300 text-foreground-600 transition-colors hover:bg-background-100 disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Previous page"
      >
        <i className="ri-arrow-left-s-line"></i>
      </button>
      {pages.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onPageChange(p)}
          className={cn(
            "h-8 min-w-8 cursor-pointer rounded-md border px-2 text-[13px] font-semibold transition-colors",
            p === page
              ? "border-primary-500 bg-primary-500 text-background-50"
              : "border-background-300 text-foreground-600 hover:bg-background-100",
          )}
        >
          {p}
        </button>
      ))}
      <button
        type="button"
        disabled={page === pageCount}
        onClick={() => onPageChange(page + 1)}
        className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-background-300 text-foreground-600 transition-colors hover:bg-background-100 disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Next page"
      >
        <i className="ri-arrow-right-s-line"></i>
      </button>
      <button
        type="button"
        disabled={page === pageCount}
        onClick={() => onPageChange(jumpForward)}
        className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-background-300 text-foreground-600 transition-colors hover:bg-background-100 disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Go forward 10 pages"
        title="Forward 10 pages"
      >
        <i className="ri-arrow-right-double-line"></i>
      </button>
    </nav>
  );
}
