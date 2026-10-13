import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/utils/format";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "accent"
  | "outline"
  | "ghost"
  | "danger"
  | "subtle";

export type ButtonSize = "xs" | "sm" | "md" | "lg" | "icon" | "icon-sm";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary-500 text-background-50 hover:bg-primary-600 focus-visible:ring-primary-300",
  secondary:
    "bg-secondary-100 text-secondary-900 hover:bg-secondary-200 focus-visible:ring-secondary-300",
  accent: "bg-accent-500 text-foreground-950 hover:bg-accent-400 focus-visible:ring-accent-300",
  outline:
    "border border-background-300 bg-background-50 text-foreground-800 hover:bg-background-100 hover:border-background-400 focus-visible:ring-primary-300",
  ghost: "text-foreground-700 hover:bg-background-200 focus-visible:ring-primary-300",
  danger: "bg-red-500 text-white hover:bg-red-600 focus-visible:ring-red-300",
  subtle: "bg-primary-50 text-primary-700 hover:bg-primary-100 focus-visible:ring-primary-300",
};

const SIZES: Record<ButtonSize, string> = {
  xs: "h-7 gap-1 rounded-md px-2.5 text-xs",
  sm: "h-8 gap-1.5 rounded-md px-3 text-[13px]",
  md: "h-9 gap-2 rounded-md px-3.5 text-sm",
  lg: "h-11 gap-2 rounded-lg px-5 text-sm",
  icon: "h-9 w-9 rounded-md",
  "icon-sm": "h-8 w-8 rounded-md",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
}

export default function Button({
  variant = "primary",
  size = "md",
  leftIcon,
  rightIcon,
  fullWidth,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex cursor-pointer items-center justify-center whitespace-nowrap font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        fullWidth && "w-full",
        className,
      )}
      {...rest}
    >
      {leftIcon ? (
        <span className="flex h-4 w-4 items-center justify-center text-base leading-none">
          {leftIcon}
        </span>
      ) : null}
      {children}
      {rightIcon ? (
        <span className="flex h-4 w-4 items-center justify-center text-base leading-none">
          {rightIcon}
        </span>
      ) : null}
    </button>
  );
}