import { cn } from "@/utils/format";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn("animate-pulse rounded-md bg-background-200", className)}></div>
  );
}

export function SkeletonCard() {
  return (
    <div className="rounded-lg border border-background-200 bg-background-50 p-5">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-4 h-8 w-32" />
      <Skeleton className="mt-3 h-3 w-40" />
    </div>
  );
}

export default Skeleton;