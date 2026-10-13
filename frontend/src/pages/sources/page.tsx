import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "@/components/base/Button";
import { Card } from "@/components/base/Card";
import EmptyState from "@/components/base/EmptyState";
import Tabs from "@/components/base/Tabs";
import { usePermissions } from "@/hooks/usePermissions";
import SourcesOverview from "@/pages/sources/components/SourcesOverview";
import ConversionReport from "@/pages/sources/components/ConversionReport";

export default function SourcesPage() {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const [tab, setTab] = useState("sources");

  // Managers and Admins see team-wide figures; Sales and Enrolment see the same
  // reports scoped to the records they own. Everyone with attribution access can
  // open the page.
  const allowed = can("reports.team") || can("attribution.view");
  const teamWide = can("reports.team");

  if (!allowed) {
    return (
      <div className="mx-auto w-full max-w-[900px] px-4 py-10 md:px-6">
        <Card>
          <EmptyState
            icon="ri-lock-2-line"
            title="Attribution reporting is restricted"
            message="Source and conversion reporting is not available for this demo role."
            action={
              <Button variant="outline" onClick={() => navigate("/")}>
                Back to Today
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-5 md:px-6 md:py-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-primary-600">Reporting</p>
          <h1 className="mt-1 font-heading text-2xl font-extrabold text-foreground-950">
            Sources &amp; Attribution
          </h1>
          <p className="mt-1 max-w-3xl text-[13px] text-foreground-500">
            Where leads come from, how marketing and Zoom interactions relate to their journey, and where
            they convert into applications, enrolments and confirmed apprenticeship starts.
            {teamWide
              ? " Showing team-wide figures."
              : " Showing only the records you own."}
          </p>
        </div>
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: "sources", label: "Sources", icon: "ri-flow-chart" },
            { value: "conversion", label: "Conversion & cohorts", icon: "ri-bar-chart-grouped-line" },
          ]}
        />
      </div>

      {tab === "sources" ? <SourcesOverview /> : <ConversionReport />}
    </div>
  );
}