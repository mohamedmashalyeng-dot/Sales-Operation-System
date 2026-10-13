import { useNavigate } from "react-router-dom";
import Badge from "@/components/base/Badge";
import Button from "@/components/base/Button";
import { Card, CardBody, CardHeader } from "@/components/base/Card";
import type { ModuleMeta } from "@/config/modules";

export default function ModulePlaceholder({ module }: { module: ModuleMeta }) {
  const navigate = useNavigate();

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-5 px-4 py-5 md:px-6 md:py-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary-100 text-2xl text-primary-700">
            <i className={module.icon}></i>
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-heading text-2xl font-extrabold text-foreground-950">
                {module.title}
              </h1>
              <Badge tone="accent">{module.phase}</Badge>
            </div>
            <p className="mt-1 max-w-2xl text-[13px] leading-snug text-foreground-500">
              {module.description}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          leftIcon={<i className="ri-arrow-left-line"></i>}
          onClick={() => navigate("/")}
        >
          Back to Today
        </Button>
      </div>

      <Card>
        <CardHeader
          icon="ri-error-warning-line"
          iconTone="accent"
          title="Scheduled for a later phase"
          subtitle="This module is part of the build roadmap and is not implemented yet."
        />
        <CardBody>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <h3 className="font-heading text-[13px] font-bold text-foreground-900">
                Planned capabilities
              </h3>
              <ul className="mt-3 space-y-2">
                {module.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-[13px] text-foreground-600">
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-base text-primary-500">
                      <i className="ri-checkbox-circle-line"></i>
                    </span>
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
            <div className="space-y-3">
              {module.integration ? (
                <div className="rounded-lg border border-background-200 bg-background-100 p-4">
                  <div className="flex items-center gap-2">
                    <span className="flex h-4 w-4 items-center justify-center text-base text-foreground-500">
                      <i className="ri-plug-line"></i>
                    </span>
                    <span className="text-[12px] font-bold uppercase tracking-wide text-foreground-500">
                      Integration
                    </span>
                  </div>
                  <p className="mt-2 text-[13px] font-semibold text-foreground-900">
                    {module.integration}
                  </p>
                  <p className="mt-1 text-[12px] leading-snug text-foreground-500">
                    Not connected. When this module is built, records will come from the production
                    backend with documented API integration points.
                  </p>
                </div>
              ) : null}
              <div className="rounded-lg border border-dashed border-background-300 bg-background-50 p-4">
                <div className="flex items-center gap-2">
                  <span className="flex h-4 w-4 items-center justify-center text-base text-foreground-500">
                    <i className="ri-code-s-slash-line"></i>
                  </span>
                  <span className="text-[12px] font-bold uppercase tracking-wide text-foreground-500">
                    Developer handoff
                  </span>
                </div>
                <p className="mt-2 text-[12px] leading-snug text-foreground-500">
                  Every data-driven screen will ship with an API integration specification, shared
                  design tokens and preserved authentication, permissions and API contracts.
                </p>
              </div>
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}