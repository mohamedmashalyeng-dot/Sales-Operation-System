import { useNavigate } from "react-router-dom";
import MetricCard from "@/components/base/MetricCard";
import type { Kpi } from "@/pages/today/types";

export default function KpiGrid({ kpis }: { kpis: Kpi[] }) {
  const navigate = useNavigate();
  return (
    <section aria-label="KPI summary">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-heading text-sm font-bold text-foreground-900">KPI summary</h2>
        <span className="text-[11px] font-medium text-foreground-400">
          Click any metric to open the filtered list
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <MetricCard
            key={kpi.id}
            label={kpi.label}
            value={kpi.value}
            hint={kpi.hint}
            icon={kpi.icon}
            tone={kpi.tone}
            onClick={() => navigate(kpi.route)}
          />
        ))}
      </div>
    </section>
  );
}