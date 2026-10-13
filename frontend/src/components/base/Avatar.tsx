import { avatarTone, cn, initials } from "@/utils/format";

export interface AvatarProps {
  name: string;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}

const SIZES = {
  xs: "h-6 w-6 text-[10px]",
  sm: "h-7 w-7 text-[11px]",
  md: "h-9 w-9 text-xs",
  lg: "h-11 w-11 text-sm",
};

export default function Avatar({ name, size = "sm", className }: AvatarProps) {
  return (
    <span
      title={name}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-heading font-bold",
        avatarTone(name),
        SIZES[size],
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}