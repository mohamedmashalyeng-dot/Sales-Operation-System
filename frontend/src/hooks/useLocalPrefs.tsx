import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const PREFS_KEY = "kbc-preferences-v1";

export type Density = "compact" | "comfortable" | "spacious";

export interface NotificationPrefs {
  email: boolean;
  inApp: boolean;
  overdueReminders: boolean;
  dailyDigest: boolean;
}

export interface DisplayPrefs {
  density: Density;
  defaultLanding: string;
  showBadges: boolean;
}

export interface Preferences {
  notifications: NotificationPrefs;
  display: DisplayPrefs;
}

export const DEFAULT_PREFERENCES: Preferences = {
  notifications: {
    email: true,
    inApp: true,
    overdueReminders: true,
    dailyDigest: false,
  },
  display: {
    density: "comfortable",
    defaultLanding: "today",
    showBadges: true,
  },
};

export const LANDING_OPTIONS = [
  { value: "today", label: "Today", path: "/" },
  { value: "leads", label: "Leads", path: "/leads" },
  { value: "inbox", label: "Inbox", path: "/inbox" },
  { value: "planner", label: "Planner", path: "/planner" },
  { value: "applications", label: "Applications", path: "/applications" },
  { value: "sources", label: "Sources & Attribution", path: "/sources" },
];

export function pathForLanding(landing: string): string {
  return LANDING_OPTIONS.find((o) => o.value === landing)?.path ?? "/";
}

interface PreferencesContextValue {
  prefs: Preferences;
  updateNotifications: (patch: Partial<NotificationPrefs>) => void;
  updateDisplay: (patch: Partial<DisplayPrefs>) => void;
  reset: () => void;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

function load(): Preferences {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Preferences>;
      return {
        notifications: { ...DEFAULT_PREFERENCES.notifications, ...parsed.notifications },
        display: { ...DEFAULT_PREFERENCES.display, ...parsed.display },
      };
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_PREFERENCES;
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Preferences>(load);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* ignore */
    }
  }, [prefs]);

  useEffect(() => {
    document.documentElement.setAttribute("data-density", prefs.display.density);
  }, [prefs.display.density]);

  const updateNotifications = useCallback((patch: Partial<NotificationPrefs>) => {
    setPrefs((prev) => ({ ...prev, notifications: { ...prev.notifications, ...patch } }));
  }, []);

  const updateDisplay = useCallback((patch: Partial<DisplayPrefs>) => {
    setPrefs((prev) => ({ ...prev, display: { ...prev.display, ...patch } }));
  }, []);

  const reset = useCallback(() => setPrefs(DEFAULT_PREFERENCES), []);

  const value = useMemo<PreferencesContextValue>(
    () => ({ prefs, updateNotifications, updateDisplay, reset }),
    [prefs, updateNotifications, updateDisplay, reset],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error("usePreferences must be used within PreferencesProvider");
  return ctx;
}