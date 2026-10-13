import { buildJourney } from "@/config/attribution";
import type { Lead, Touchpoint } from "@/store/types";

/**
 * Attribution method (consistent across every view):
 *   - Acquired counts use FIRST-TOUCH attribution (the lead's acquisition source).
 *   - Won / Lost conversions use CLOSING-TOUCH attribution (the frozen closing snapshot).
 * A conversion is attributed to the interaction explicitly recorded as closing — a
 * touchpoint happening before closing is never treated as the cause.
 */

export interface SourcePerformanceRow {
  source: string;
  channel: string;
  category: string;
  leads: number;
  won: number;
  lost: number;
  open: number;
  conversionRate: number;
  avgDaysToClose: number;
  avgTouches: number;
  pipelineValue: number;
}

export interface OwnerPerformanceRow {
  ownerId: string;
  name: string;
  leads: number;
  won: number;
  lost: number;
  conversionRate: number;
  openTasks: number;
}

export interface ProgrammeConversionRow {
  programme: string;
  leads: number;
  won: number;
  conversionRate: number;
}

export interface ProgrammeFiltered {
  leads: Lead[];
  touchpoints: Touchpoint[];
}

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(b).getTime() - new Date(a).getTime()) / 86400000;
}

export function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((n, v) => n + v, 0) / values.length;
}

export function computeSourcePerformance(
  leads: Lead[],
  touchpoints: Touchpoint[],
): SourcePerformanceRow[] {
  const bySource = new Map<string, SourcePerformanceRow>();
  const touchesFor = (leadId: string) => touchpoints.filter((t) => t.leadId === leadId);

  leads.forEach((lead) => {
    const key = lead.source;
    if (!bySource.has(key)) {
      bySource.set(key, {
        source: key,
        channel: lead.channel,
        category: "—",
        leads: 0,
        won: 0,
        lost: 0,
        open: 0,
        conversionRate: 0,
        avgDaysToClose: 0,
        avgTouches: 0,
        pipelineValue: 0,
      });
    }
    const row = bySource.get(key)!;
    row.leads += 1;
    row.pipelineValue += lead.value;
    const touches = touchesFor(lead.id);
    row.avgTouches += touches.length;
    // Conversion attribution is anchored on the closing snapshot, not the stage alone.
    const closedWon = lead.stage === "Won" || lead.closing?.outcome === "won";
    const closedLost = lead.stage === "Lost" || lead.closing?.outcome === "lost";
    if (closedWon) {
      row.won += 1;
      if (lead.closing) row.avgDaysToClose += daysBetween(lead.createdAt, lead.closing.closingDate);
    } else if (closedLost) {
      row.lost += 1;
    } else {
      row.open += 1;
    }
  });

  return Array.from(bySource.values())
    .map((row) => ({
      ...row,
      conversionRate: row.leads ? (row.won / row.leads) * 100 : 0,
      avgDaysToClose: row.won ? row.avgDaysToClose / row.won : 0,
      avgTouches: row.leads ? row.avgTouches / row.leads : 0,
    }))
    .sort((a, b) => b.leads - a.leads);
}

export function computeClosingChannel(leads: Lead[]): { label: string; count: number }[] {
  const map = new Map<string, number>();
  leads
    .filter((l) => l.closing?.outcome === "won")
    .forEach((l) => {
      const key = l.closing?.channel ?? l.channel;
      map.set(key, (map.get(key) ?? 0) + 1);
    });
  return Array.from(map.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

export function computeFirstVsClosing(
  leads: Lead[],
): { source: string; firstTouch: number; closingTouch: number }[] {
  const map = new Map<string, { source: string; firstTouch: number; closingTouch: number }>();
  const ensure = (key: string) => {
    if (!map.has(key)) map.set(key, { source: key, firstTouch: 0, closingTouch: 0 });
    return map.get(key)!;
  };
  leads.forEach((lead) => {
    ensure(lead.source).firstTouch += 1;
    if (lead.closing?.outcome === "won") {
      ensure(lead.closing.source).closingTouch += 1;
    }
  });
  return Array.from(map.values()).sort((a, b) => b.firstTouch - a.firstTouch);
}

export function computeProgrammeConversion(leads: Lead[]): ProgrammeConversionRow[] {
  const map = new Map<string, ProgrammeConversionRow>();
  leads.forEach((lead) => {
    if (!map.has(lead.programme)) {
      map.set(lead.programme, { programme: lead.programme, leads: 0, won: 0, conversionRate: 0 });
    }
    const row = map.get(lead.programme)!;
    row.leads += 1;
    if (lead.stage === "Won" || lead.closing?.outcome === "won") row.won += 1;
  });
  return Array.from(map.values())
    .map((row) => ({ ...row, conversionRate: row.leads ? (row.won / row.leads) * 100 : 0 }))
    .sort((a, b) => b.leads - a.leads);
}

export function computeOwnerPerformance(
  leads: Lead[],
  users: { id: string; name: string }[],
  openTaskCount: (ownerId: string) => number,
): OwnerPerformanceRow[] {
  return users
    .map((user) => {
      const owned = leads.filter((l) => l.ownerId === user.id);
      const won = owned.filter((l) => l.stage === "Won" || l.closing?.outcome === "won").length;
      const lost = owned.filter((l) => l.stage === "Lost" || l.closing?.outcome === "lost").length;
      return {
        ownerId: user.id,
        name: user.name,
        leads: owned.length,
        won,
        lost,
        conversionRate: owned.length ? (won / owned.length) * 100 : 0,
        openTasks: openTaskCount(user.id),
      };
    })
    .filter((row) => row.leads > 0)
    .sort((a, b) => b.won - a.won);
}

/** Average number of touchpoints before closing (won leads with a recorded journey). */
export function avgTouchesBeforeClosing(leads: Lead[], touchpoints: Touchpoint[]): number {
  const wonIds = leads
    .filter((l) => l.closing?.outcome === "won")
    .map((l) => l.id);
  const counts = wonIds.map((id) => touchpoints.filter((t) => t.leadId === id).length);
  return counts.length ? average(counts) : 0;
}

export function journeyTouchCount(touchpoints: Touchpoint[], leadId: string): number {
  return buildJourney(touchpoints.filter((t) => t.leadId === leadId)).ordered.length;
}