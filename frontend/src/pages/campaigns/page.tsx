import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Badge from "@/components/base/Badge";
import Button from "@/components/base/Button";
import { Card, CardBody, CardHeader } from "@/components/base/Card";
import EmptyState from "@/components/base/EmptyState";
import MetricCard from "@/components/base/MetricCard";
import PaginationFooter from "@/components/base/PaginationFooter";
import SearchInput from "@/components/base/SearchInput";
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from "@/components/base/Table";
import { useToast } from "@/components/base/Toast";
import { CAMPAIGN_STAGE_TONES, CAMPAIGN_TYPE_ICONS } from "@/config/marketing";
import CampaignDetailDrawer from "@/pages/campaigns/components/CampaignDetailDrawer";
import CampaignFormModal from "@/pages/campaigns/components/CampaignFormModal";
import { usePermissions } from "@/hooks/usePermissions";
import { campaignStats, type CampaignInput } from "@/store/actions/marketing";
import { useWorkspace } from "@/store/WorkspaceProvider";
import { formatDateTime, relativeTime } from "@/utils/format";

const PER_PAGE = 50;

export default function CampaignsPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { state, createCampaign, userName } = useWorkspace();
  const { can, currentUserId } = usePermissions();

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const canView = can("campaigns.view");
  const canManage = can("campaigns.manage");

  const campaigns = useMemo(() => {
    const q = search.trim().toLowerCase();
    return state.campaigns
      .filter((c) => (q ? `${c.name} ${c.platform} ${c.crmSystem} ${c.acquisitionProvider}`.toLowerCase().includes(q) : true))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [state.campaigns, search]);

  const totals = useMemo(() => {
    const stats = state.campaigns.map(campaignStats);
    return {
      campaigns: state.campaigns.length,
      recipients: stats.reduce((n, s) => n + s.total, 0),
      invited: stats.reduce((n, s) => n + s.invited + s.registered + s.attended, 0),
      registered: stats.reduce((n, s) => n + s.registered, 0),
      attended: stats.reduce((n, s) => n + s.attended, 0),
    };
  }, [state.campaigns]);

  const selected = state.campaigns.find((c) => c.id === selectedId) ?? null;
  const pageCount = Math.max(1, Math.ceil(campaigns.length / PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  const pagedCampaigns = campaigns.slice((currentPage - 1) * PER_PAGE, currentPage * PER_PAGE);

  if (!canView) {
    return (
      <div className="mx-auto w-full max-w-[900px] px-4 py-10 md:px-6">
        <Card>
          <EmptyState
            icon="ri-lock-2-line"
            title="Campaigns not available for your role"
            message="Switch demo role to access Eventbrite campaign management."
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

  const handleCreate = (input: CampaignInput) => {
    const created = createCampaign({ ...input, ownerId: currentUserId });
    setSelectedId(created.id);
    toast({ title: "Campaign created", message: `${created.name} · Draft`, tone: "success" });
  };

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-5 md:px-6 md:py-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-primary-600">
            Outreach &amp; Eventbrite
          </p>
          <h1 className="mt-1 font-heading text-2xl font-extrabold text-foreground-950">Campaigns</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-foreground-500">
            Import a Zoho CRM email audience, upload it to Eventbrite and send a fictional invitation. The
            original acquisition source is never overwritten, and being in an audience is not the same as
            registering or attending.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="warning" icon="ri-error-warning-line">
            Demonstration data only — no email is sent
          </Badge>
          {canManage ? (
            <Button leftIcon={<i className="ri-add-line"></i>} onClick={() => setCreateOpen(true)}>
              Create campaign
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <MetricCard label="Campaigns" value={totals.campaigns} icon="ri-megaphone-line" tone="primary" />
        <MetricCard label="Audience contacts" value={totals.recipients} icon="ri-group-line" tone="secondary" />
        <MetricCard label="Invitations sent" value={totals.invited} icon="ri-send-plane-line" tone="accent" />
        <MetricCard label="Registrations" value={totals.registered} icon="ri-user-add-line" tone="primary" />
        <MetricCard label="Attended" value={totals.attended} icon="ri-user-star-line" tone="success" />
      </div>

      <Card>
        <CardHeader
          icon="ri-list-check-2"
          title="Event campaigns"
          subtitle={`${campaigns.length} campaigns`}
          action={
            <div className="w-full sm:w-64">
              <SearchInput
                value={search}
                onChange={(value) => {
                  setSearch(value);
                  setPage(1);
                }}
                placeholder="Search campaigns…"
              />
            </div>
          }
        />
        <PaginationFooter
          position="top"
          currentPage={currentPage}
          pageCount={pageCount}
          total={campaigns.length}
          itemLabel="campaigns"
          onPageChange={setPage}
        />
        {campaigns.length === 0 ? (
          <EmptyState
            icon="ri-megaphone-line"
            title="No campaigns yet"
            message="Create an event campaign to manage an Eventbrite email audience."
            action={canManage ? <Button onClick={() => setCreateOpen(true)}>Create campaign</Button> : undefined}
          />
        ) : (
          <TableWrap>
            <Table className="min-w-[960px]">
              <THead>
                <Th>Campaign</Th>
                <Th>Type</Th>
                <Th>Platform / CRM</Th>
                <Th>Provider</Th>
                <Th>Recipients</Th>
                <Th>Registered</Th>
                <Th>Stage</Th>
                <Th>Updated</Th>
                <Th className="text-right">Actions</Th>
              </THead>
              <TBody>
                {pagedCampaigns.map((c) => {
                  const stats = campaignStats(c);
                  return (
                    <Tr key={c.id}>
                      <Td>
                        <button type="button" onClick={() => setSelectedId(c.id)} className="cursor-pointer text-left">
                          <span className="block text-[13px] font-semibold text-foreground-900 hover:text-primary-600">
                            {c.name}
                          </span>
                          <span className="block text-[11px] text-foreground-400">{c.id}</span>
                        </button>
                      </Td>
                      <Td>
                        <Badge tone="neutral" icon={CAMPAIGN_TYPE_ICONS[c.type]}>
                          {c.type}
                        </Badge>
                      </Td>
                      <Td>
                        <span className="text-[12px] text-foreground-600">{c.platform}</span>
                        <span className="block text-[11px] text-foreground-400">{c.crmSystem}</span>
                      </Td>
                      <Td>
                        <span className="text-[12px] text-foreground-600">{c.acquisitionProvider}</span>
                      </Td>
                      <Td>
                        <span className="text-[12px] text-foreground-700">
                          {stats.valid} valid
                          {stats.duplicates ? ` · ${stats.duplicates} dupes` : ""}
                        </span>
                      </Td>
                      <Td>{stats.registered}</Td>
                      <Td>
                        <Badge tone={CAMPAIGN_STAGE_TONES[c.stage]} dot>
                          {c.stage}
                        </Badge>
                      </Td>
                      <Td>
                        <span className="text-[12px] text-foreground-500" title={formatDateTime(c.updatedAt)}>
                          {relativeTime(c.updatedAt)}
                        </span>
                      </Td>
                      <Td>
                        <div className="flex items-center justify-end gap-1.5">
                          <Button variant="outline" size="sm" onClick={() => setSelectedId(c.id)}>
                            Open
                          </Button>
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          </TableWrap>
        )}
        <PaginationFooter
          currentPage={currentPage}
          pageCount={pageCount}
          total={campaigns.length}
          itemLabel="campaigns"
          onPageChange={setPage}
        />
      </Card>

      <Card>
        <CardBody className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <LayerNote
            icon={CAMPAIGN_TYPE_ICONS["Email invitation"]}
            title="Audience import"
            text="Contacts exported from Zoho CRM are uploaded into Eventbrite. Duplicates and invalid addresses are flagged before sending."
          />
          <LayerNote
            icon="ri-vidicon-line"
            title="Zoom information session"
            text="Each event may link to a Zoom meeting. Attendance is optional and is recorded separately from registration."
          />
          <LayerNote
            icon="ri-phone-line"
            title="Zoom Phone follow-up"
            text="Sales can call prospects on Zoom Phone. Only calls with an explicit recording or transcript show one."
          />
        </CardBody>
      </Card>

      <CampaignFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={handleCreate}
        events={state.events.map((e) => ({ id: e.id, name: e.name }))}
      />

      <CampaignDetailDrawer campaign={selected} onClose={() => setSelectedId(null)} canManage={canManage} />
    </div>
  );
}

function LayerNote({ icon, title, text }: { icon: string; title: string; text: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-background-200 bg-background-50 p-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary-100 text-lg text-secondary-900">
        <i className={icon}></i>
      </span>
      <div>
        <p className="text-[13px] font-semibold text-foreground-900">{title}</p>
        <p className="mt-0.5 text-[11px] leading-snug text-foreground-500">{text}</p>
      </div>
    </div>
  );
}
