import { EMAIL_LABELS } from "@/config/crm";
import { cn } from "@/utils/format";

interface LabelMultiSelectProps {
  selected: string[];
  onToggle: (labelId: string) => void;
  className?: string;
}

export default function LabelMultiSelect({ selected, onToggle, className }: LabelMultiSelectProps) {
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {EMAIL_LABELS.filter((l) => !l.system).map((label) => {
        const active = selected.includes(label.id);
        return (
          <button
            key={label.id}
            type="button"
            onClick={() => onToggle(label.id)}
            className={cn(
              "cursor-pointer rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors",
              active
                ? "border-primary-300 bg-primary-100 text-primary-700"
                : "border-background-300 bg-background-50 text-foreground-500 hover:border-background-400 hover:text-foreground-700",
            )}
          >
            <span className="inline-flex items-center gap-1">
              {active ? <i className="ri-check-line text-[11px]"></i> : null}
              {label.name}
            </span>
          </button>
        );
      })}
    </div>
  );
}