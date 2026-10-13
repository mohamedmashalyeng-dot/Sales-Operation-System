import { cn } from "@/utils/format";

export default function Logo({ collapsed }: { collapsed?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 overflow-hidden">
      <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-500">
        <span className="font-heading text-sm font-extrabold leading-none text-background-50">
          K
        </span>
        <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-accent-500 text-[9px] font-bold leading-none text-foreground-950 ring-2 ring-background-50">
          C
        </span>
      </span>
      <span className={cn("min-w-0 transition-opacity", collapsed && "hidden")}>
        <span className="block truncate font-heading text-[13px] font-extrabold leading-tight text-foreground-950">
          Kent Business College
        </span>
        <span className="block truncate text-[11px] font-medium leading-tight text-foreground-500">
          Workspace
        </span>
      </span>
    </div>
  );
}