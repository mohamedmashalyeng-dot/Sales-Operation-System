import type { RouteObject } from "react-router-dom";
import AppShell from "@/components/feature/AppShell";
import ModuleGuard from "@/components/feature/ModuleGuard";
import { PENDING_MODULES } from "@/config/modules";
import NotFound from "@/pages/NotFound";
import ModulePlaceholder from "@/pages/placeholder/PagePlaceholder";
import Today from "@/pages/today/page";
import LeadsPage from "@/pages/leads/page";
import LeadDetailPage from "@/pages/leads/detail/page";
import InboxPage from "@/pages/inbox/page";
import ThreadDetailPage from "@/pages/inbox/detail/page";
import PlannerPage from "@/pages/planner/page";
import ApplicationsPage from "@/pages/applications/page";
import ApplicationDetailPage from "@/pages/applications/detail/page";
import EventsPage from "@/pages/events/page";
import EventDetailPage from "@/pages/events/detail/page";
import CampaignsPage from "@/pages/campaigns/page";
import ZoomPage from "@/pages/zoom/page";
import ZoomCallDetailPage from "@/pages/zoom/calls/detail/page";
import ZohoPage from "@/pages/zoho/page";
import SourcesPage from "@/pages/sources/page";
import FutureIntakePage from "@/pages/future-intake/page";
import CommercialPage from "@/pages/commercial/page";
import EmployersPage from "@/pages/employers/page";
import EmployerDetailPage from "@/pages/employers/detail/page";
import ApprenticeshipReportsPage from "@/pages/apprenticeship-reports/page";
import ScenariosPage from "@/pages/scenarios/page";
import AdminPage from "@/pages/admin/page";
import AuditPage from "@/pages/audit/page";
import DeveloperPage from "@/pages/developer/page";
import SettingsPage from "@/pages/settings/page";

const IMPLEMENTED_KEYS = [
  "leads",
  "inbox",
  "planner",
  "applications",
  "events",
  "zoom",
  "zoho",
  "settings",
  "admin",
  "developer",
  "audit",
];

const moduleRoutes: RouteObject[] = PENDING_MODULES.filter(
  (module) => !IMPLEMENTED_KEYS.includes(module.key),
).flatMap((module) => [
  {
    path: module.path,
    element: <ModulePlaceholder module={module} />,
  },
  {
    path: `${module.path}/:id`,
    element: <ModulePlaceholder module={module} />,
  },
]);

const routes: RouteObject[] = [
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <Today /> },
      { path: "leads", element: <LeadsPage /> },
      { path: "leads/:id", element: <LeadDetailPage /> },
      { path: "inbox", element: <InboxPage /> },
      { path: "inbox/:id", element: <ThreadDetailPage /> },
      { path: "planner", element: <PlannerPage /> },
      { path: "applications", element: <ApplicationsPage /> },
      { path: "applications/:id", element: <ApplicationDetailPage /> },
      { path: "events", element: <EventsPage /> },
      { path: "events/:id", element: <EventDetailPage /> },
      { path: "campaigns", element: <CampaignsPage /> },
      {
        path: "zoom",
        element: (
          <ModuleGuard navKey="zoom">
            <ZoomPage />
          </ModuleGuard>
        ),
      },
      {
        path: "zoom/calls/:id",
        element: (
          <ModuleGuard navKey="zoom">
            <ZoomCallDetailPage />
          </ModuleGuard>
        ),
      },
      { path: "zoho", element: <ZohoPage /> },
      {
        path: "future-intake",
        element: (
          <ModuleGuard navKey="future-intake">
            <FutureIntakePage />
          </ModuleGuard>
        ),
      },
      {
        path: "commercial",
        element: (
          <ModuleGuard navKey="commercial">
            <CommercialPage />
          </ModuleGuard>
        ),
      },
      {
        path: "employers",
        element: (
          <ModuleGuard navKey="employers">
            <EmployersPage />
          </ModuleGuard>
        ),
      },
      {
        path: "employers/:id",
        element: (
          <ModuleGuard navKey="employers">
            <EmployerDetailPage />
          </ModuleGuard>
        ),
      },
      {
        path: "sources",
        element: (
          <ModuleGuard navKey="attribution">
            <SourcesPage />
          </ModuleGuard>
        ),
      },
      {
        path: "apprenticeship-reports",
        element: (
          <ModuleGuard navKey="apprenticeship-reports">
            <ApprenticeshipReportsPage />
          </ModuleGuard>
        ),
      },
      {
        path: "scenarios",
        element: (
          <ModuleGuard navKey="scenarios">
            <ScenariosPage />
          </ModuleGuard>
        ),
      },
      {
        path: "admin",
        element: (
          <ModuleGuard navKey="admin">
            <AdminPage />
          </ModuleGuard>
        ),
      },
      {
        path: "audit",
        element: (
          <ModuleGuard navKey="audit">
            <AuditPage />
          </ModuleGuard>
        ),
      },
      {
        path: "developer",
        element: (
          <ModuleGuard navKey="developer">
            <DeveloperPage />
          </ModuleGuard>
        ),
      },
      { path: "settings", element: <SettingsPage /> },
      ...moduleRoutes,
    ],
  },
  {
    path: "*",
    element: <NotFound />,
  },
];

export default routes;
