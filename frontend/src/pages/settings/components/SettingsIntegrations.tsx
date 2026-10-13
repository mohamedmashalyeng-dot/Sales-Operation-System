import Badge from "@/components/base/Badge";
import Button from "@/components/base/Button";
import { Card, CardBody, CardHeader } from "@/components/base/Card";
import { useWorkspace } from "@/store/WorkspaceProvider";
import { cn } from "@/utils/format";
import {
  buildIntegrationStatuses,
  integrationSummaryText,
  withIntegrationReauthorization,
} from "@/utils/integrations";

export default function SettingsIntegrations() {
  const { state, backendLoadedAt, integrationOverview } = useWorkspace();
  const integrations = buildIntegrationStatuses(state, backendLoadedAt, integrationOverview);

  return (
    <Card>
      <CardHeader
        icon="ri-plug-line"
        iconTone="secondary"
        title="Integration status"
        subtitle={integrationSummaryText(integrations)}
      />
      <CardBody className="space-y-2.5">
        {integrations.map((integration) => (
          <div
            key={integration.key}
            className="flex items-start gap-3 rounded-lg border border-background-200 bg-background-50 p-3.5"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-background-200 text-lg text-foreground-600">
              <i className={integration.icon}></i>
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-semibold text-foreground-900">
                  {integration.label}
                </span>
                <Badge tone={integration.tone} dot>
                  {integration.badge}
                </Badge>
              </div>
              <p className="mt-0.5 text-[12px] leading-snug text-foreground-500">
                {integration.detail}
              </p>
            </div>
            <span
              className={cn(
                "hidden shrink-0 self-center rounded-md border border-background-300 px-2.5 py-1 text-[11px] font-semibold text-foreground-400 sm:block",
              )}
            >
              {integration.sourceLabel}
            </span>
            {integration.reconnectUrl ? (
              <Button
                variant={integration.needsReconnect ? "primary" : "outline"}
                size="sm"
                leftIcon={<i className="ri-link-m"></i>}
                onClick={() => {
                  window.location.href = withIntegrationReauthorization(integration.reconnectUrl);
                }}
              >
                {integration.needsReconnect ? "Reconnect" : "Connect"}
              </Button>
            ) : null}
          </div>
        ))}
        <p className="rounded-md border border-dashed border-background-300 bg-background-50 px-3 py-2.5 text-[11px] leading-snug text-foreground-500">
          {backendLoadedAt
            ? "This panel is reflecting the records and integration overview pulled from the backend."
            : "The backend is not currently hydrating this session, so these statuses use local workspace state only."}
        </p>
      </CardBody>
    </Card>
  );
}
