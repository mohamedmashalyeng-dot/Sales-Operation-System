import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/utils/format";

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  widthClass?: string;
}

export default function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  widthClass = "max-w-md",
}: DrawerProps) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[80]">
      <div
        className="absolute inset-0 bg-foreground-950/30 animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      ></div>
      <aside
        role="dialog"
        aria-modal="true"
        className={cn(
          "absolute inset-y-0 right-0 flex w-full flex-col border-l border-background-200 bg-background-50 shadow-kbc-lg animate-slide-in-right",
          widthClass,
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-background-200 px-5 py-4">
          <div>
            <h2 className="font-heading text-base font-bold text-foreground-900">{title}</h2>
            {subtitle ? (
              <p className="mt-0.5 text-[13px] text-foreground-500">{subtitle}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-lg text-foreground-500 hover:bg-background-100 hover:text-foreground-800"
          >
            <i className="ri-close-line"></i>
          </button>
        </header>
        <div className="kbc-scroll flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <footer className="flex items-center justify-end gap-2 border-t border-background-200 px-5 py-4">
            {footer}
          </footer>
        ) : null}
      </aside>
    </div>,
    document.body,
  );
}