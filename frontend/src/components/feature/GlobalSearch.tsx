import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { ALL_NAV_ITEMS } from "@/config/navigation";
import { roleNavVisible } from "@/config/permissions";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/store/WorkspaceProvider";
import { cn } from "@/utils/format";

interface GlobalSearchProps {
  open: boolean;
  onClose: () => void;
}

interface SearchEntry {
  id: string;
  title: string;
  subtitle: string;
  path: string;
  icon: string;
  category: string;
}

function useSearchIndex(): SearchEntry[] {
  const { state } = useWorkspace();
  const { role, canSeeOwner } = usePermissions();

  return useMemo(() => {
    const entries: SearchEntry[] = [];
    const navAllows = (key: string) => roleNavVisible(role.id, key);

    if (navAllows("leads")) {
      state.leads.filter((l) => canSeeOwner(l.ownerId)).forEach((lead) => {
        entries.push({
          id: `lead-${lead.id}`,
          title: lead.name,
          subtitle: `${lead.programme} · ${lead.stage}`,
          path: `/leads/${lead.id}`,
          icon: "ri-contacts-book-2-line",
          category: "Lead",
        });
      });
    }

    if (navAllows("applications")) {
      state.applications.filter((a) => canSeeOwner(a.ownerId)).forEach((app) => {
        entries.push({
          id: `app-${app.id}`,
          title: app.applicantName,
          subtitle: `${app.programme} · ${app.status}`,
          path: `/applications/${app.id}`,
          icon: "ri-file-list-3-line",
          category: "Application",
        });
      });
    }

    if (navAllows("events")) {
      state.events.forEach((event) => {
        entries.push({
          id: `event-${event.id}`,
          title: event.name,
          subtitle: `${event.source} · ${event.registrations.length} registrations`,
          path: `/events/${event.id}`,
          icon: "ri-calendar-event-line",
          category: "Event",
        });
      });
    }

    if (navAllows("inbox")) {
      state.threads.filter((t) => !t.trashed).forEach((thread) => {
        entries.push({
          id: `thread-${thread.id}`,
          title: thread.subject,
          subtitle: `${thread.senderName} · ${thread.senderEmail}`,
          path: `/inbox/${encodeURIComponent(thread.id)}`,
          icon: "ri-inbox-archive-line",
          category: "Email",
        });
      });
    }

    ALL_NAV_ITEMS.filter((item) => navAllows(item.key)).forEach((item) => {
      entries.push({
        id: `nav-${item.key}`,
        title: item.label,
        subtitle: "Go to module",
        path: item.path,
        icon: item.icon,
        category: "Page",
      });
    });

    return entries;
  }, [state, role.id, canSeeOwner]);
}

export default function GlobalSearch({ open, onClose }: GlobalSearchProps) {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const index = useSearchIndex();

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const normalized = query.trim().toLowerCase();
  const results = normalized
    ? index
        .filter(
          (entry) =>
            entry.title.toLowerCase().includes(normalized) ||
            entry.subtitle.toLowerCase().includes(normalized) ||
            entry.category.toLowerCase().includes(normalized),
        )
        .slice(0, 12)
    : index.slice(0, 7);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-start justify-center p-4 pt-[12vh]">
      <div
        className="absolute inset-0 bg-foreground-950/30 animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      ></div>
      <div className="relative z-10 w-full max-w-2xl overflow-hidden rounded-lg border border-background-200 bg-background-50 shadow-kbc-lg animate-scale-in">
        <div className="flex h-14 items-center gap-3 border-b border-background-200 px-4">
          <span className="flex h-5 w-5 items-center justify-center text-xl text-foreground-400">
            <i className="ri-search-line"></i>
          </span>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search leads, applications, events, emails and pages…"
            className="h-full flex-1 bg-transparent text-sm text-foreground-900 placeholder:text-foreground-400 focus:outline-none"
          />
          <span className="rounded border border-background-300 bg-background-100 px-1.5 py-0.5 text-[10px] font-semibold text-foreground-500">
            ESC
          </span>
        </div>
        <div className="kbc-scroll max-h-[26rem] overflow-y-auto p-2">
          <p className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-foreground-400">
            {normalized ? "Results" : "Suggested"}
          </p>
          {results.length === 0 ? (
            <p className="px-2.5 py-6 text-center text-[13px] text-foreground-500">
              No matches for “{query}”.
            </p>
          ) : (
            results.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => {
                  navigate(entry.path);
                  onClose();
                }}
                className="flex w-full cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-background-100"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-background-200 text-base text-foreground-600">
                  <i className={entry.icon}></i>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-foreground-900">
                    {entry.title}
                  </span>
                  <span className="block truncate text-[11px] text-foreground-500">
                    {entry.subtitle}
                  </span>
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                    "bg-secondary-100 text-secondary-900",
                  )}
                >
                  {entry.category}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
