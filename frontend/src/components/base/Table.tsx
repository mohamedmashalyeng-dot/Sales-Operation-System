import type { ReactNode, ThHTMLAttributes } from "react";
import { cn } from "@/utils/format";

export function TableWrap({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("kbc-scroll w-full overflow-x-auto", className)}>{children}</div>;
}

export function Table({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <table className={cn("w-full min-w-[720px] border-collapse text-left text-sm", className)}>
      {children}
    </table>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="border-b border-background-200 bg-background-100/60">
      <tr>{children}</tr>
    </thead>
  );
}

interface ThProps extends ThHTMLAttributes<HTMLTableCellElement> {
  children?: ReactNode;
}

export function Th({ className, children, ...rest }: ThProps) {
  return (
    <th
      scope="col"
      className={cn(
        "whitespace-nowrap px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide text-foreground-500",
        className,
      )}
      {...rest}
    >
      {children}
    </th>
  );
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-background-200">{children}</tbody>;
}

export function Tr({
  className,
  children,
  onClick,
}: {
  className?: string;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <tr
      onClick={onClick}
      className={cn(
        "transition-colors",
        onClick && "cursor-pointer",
        "hover:bg-background-100/70",
        className,
      )}
    >
      {children}
    </tr>
  );
}

export function Td({ className, children }: { className?: string; children: ReactNode }) {
  return <td className={cn("px-4 py-3 align-middle text-[13px] text-foreground-700", className)}>{children}</td>;
}