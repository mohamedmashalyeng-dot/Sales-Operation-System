import { cn } from "@/utils/format";

export interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export default function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  className,
}: SearchInputProps) {
  return (
    <div
      className={cn(
        "flex h-9 items-center gap-2 rounded-md border border-background-300 bg-background-50 px-3 transition-colors focus-within:border-primary-400 focus-within:ring-2 focus-within:ring-primary-200",
        className,
      )}
    >
      <span className="flex h-4 w-4 items-center justify-center text-base text-foreground-400">
        <i className="ri-search-line"></i>
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-full w-full bg-transparent text-sm text-foreground-900 placeholder:text-foreground-400 focus:outline-none"
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange("")}
          className="flex h-4 w-4 cursor-pointer items-center justify-center text-base text-foreground-400 hover:text-foreground-700"
        >
          <i className="ri-close-circle-fill"></i>
        </button>
      ) : null}
    </div>
  );
}