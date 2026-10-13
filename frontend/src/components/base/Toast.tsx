import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/utils/format";

type ToastTone = "success" | "error" | "info";

interface ToastItem {
  id: number;
  title: string;
  message?: string;
  tone: ToastTone;
}

interface ToastContextValue {
  toast: (input: { title: string; message?: string; tone?: ToastTone }) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_STYLES: Record<ToastTone, { icon: string; wrap: string }> = {
  success: { icon: "ri-checkbox-circle-fill text-green-500", wrap: "border-green-200" },
  error: { icon: "ri-error-warning-fill text-red-500", wrap: "border-red-200" },
  info: { icon: "ri-information-fill text-primary-500", wrap: "border-background-200" },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const remove = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    ({ title, message, tone = "info" }: { title: string; message?: string; tone?: ToastTone }) => {
      const id = Date.now() + Math.random();
      setToasts((list) => [...list, { id, title, message, tone }]);
      window.setTimeout(() => remove(id), 4200);
    },
    [remove],
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[100] flex w-[22rem] max-w-[calc(100vw-2.5rem)] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto flex items-start gap-3 rounded-lg border bg-background-50 px-4 py-3 shadow-kbc-lg animate-slide-up",
              TONE_STYLES[t.tone].wrap,
            )}
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center text-lg">
              <i className={TONE_STYLES[t.tone].icon}></i>
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-foreground-900">{t.title}</p>
              {t.message ? (
                <p className="mt-0.5 text-xs text-foreground-500">{t.message}</p>
              ) : null}
            </div>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => remove(t.id)}
              className="flex h-5 w-5 cursor-pointer items-center justify-center text-base text-foreground-400 hover:text-foreground-700"
            >
              <i className="ri-close-line"></i>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return { toast: () => undefined };
  }
  return ctx;
}