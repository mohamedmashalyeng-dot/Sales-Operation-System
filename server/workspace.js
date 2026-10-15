'use strict';

const Config = require('./config');
const Util = require('./util');
const Auth = require('./auth');
const Audit = require('./audit');
const Programmes = require('./programmes');
const Leads = require('./leads');
const Emails = require('./emails');
const Events = require('./events');
const Bootstrap = require('./bootstrap');
const Gmail = require('./integrations/gmail');
const Eventbrite = require('./integrations/eventbrite');
const Zoom = require('./integrations/zoom');
const Meta = require('./integrations/meta');
const Apollo = require('./integrations/apollo');
const Zoho = require('./integrations/zoho');
const CallNextAction = require('./call-next-action');

const DEFAULT_STAGES = ['New lead', 'Qualified', 'Application Submitted', 'Eligibility', 'Ready for Enrolment', 'Enrolled', 'Not Eligible', 'Lost'];
const DEFAULT_SOURCES = ['Website', 'Referral', 'Event', 'Meta', 'LinkedIn', 'Cold outreach'];

function seedDatabase() {
  const users = Auth.initialUsers();
  return recalculate({
    demo: false,
    users,
    programmes: Config.PROGRAMME_CATALOG.map(item => ({ ...item })),
    stages: DEFAULT_STAGES.slice(),
    sources: DEFAULT_SOURCES.slice(),
    leads: [],
    tasks: [],
    emails: [],
    applications: [],
    events: [],
    commercialOpportunities: [],
    integrations: [
      { name: 'Gmail', status: 'Not connected', detail: 'Connect Gmail after the backend mailbox adapter is configured.' },
      { name: 'Eventbrite', status: 'Not connected', detail: 'Event data is stored locally until provider sync is enabled.' }
    ],
    intakes: [],
    audit: [],
    attribution: []
  });
}
function workspaceMetaState(db = {}) {
  return {
    ...(db.meta || {}),
    apollo: db.apollo || db.meta?.apollo || { imported_person_ids: [] },
    zoom: db.zoom || db.meta?.zoom || { imported_meeting_ids: [] },
    zoho: db.zoho || db.meta?.zoho || { imported_record_ids: [] },
    commercialOpportunities: db.commercialOpportunities || db.meta?.commercialOpportunities || [],
    employers: db.employers || db.meta?.employers || [],
    employerAgreements: db.employerAgreements || db.meta?.employerAgreements || [],
    dasRecords: db.dasRecords || db.meta?.dasRecords || []
  };
}

function reconcileImportedData(db, user, options = {}) {
  db.leads ||= [];
  db.emails ||= [];
  db.events ||= [];
  db.zoom ||= {};
  db.zoom.calls ||= [];
  const existingLeadIds = Leads.validLeadIdSet(db);
  const summary = { leads_created: 0, leads_updated: 0, emails_linked: 0, attendees_linked: 0, calls_linked: 0, unlinked_attendees: 0, unlinked_calls: 0 };

  for (const email of db.emails || []) {
    const beforeLeadId = email.lead_id;
    const beforeCount = db.leads.length;
    const lead = Emails.ensureLeadForEmailSender(db, user, email);
    if (!lead) continue;
    if (db.leads.length > beforeCount) summary.leads_created += 1;
    if (!beforeLeadId && email.lead_id) summary.emails_linked += 1;
  }

  for (const event of db.events || []) {
    for (const attendee of event.attendees || []) {
      if (attendee.lead_id && existingLeadIds.has(attendee.lead_id)) {
        const lead = db.leads.find(item => item.id === attendee.lead_id);
        Leads.addLeadSource(lead, Events.eventSourceName(event, attendee), {
          provider_id: attendee.eventbrite_attendee_id || attendee.zoom_participant_id || attendee.id || event.id || '',
          captured_at: attendee.created_at || attendee.attended_at || event.start_at
        });
        continue;
      }
      const contactLead = Leads.leadByContact(db, attendee);
      if (contactLead) {
        attendee.lead_id = contactLead.id;
        Leads.addLeadSource(contactLead, Events.eventSourceName(event, attendee), {
          provider_id: attendee.eventbrite_attendee_id || attendee.zoom_participant_id || attendee.id || event.id || '',
          captured_at: attendee.created_at || attendee.attended_at || event.start_at
        });
        summary.attendees_linked += 1;
        continue;
      }
      const canCreateLead = Emails.normalizeEmail(attendee.email) || attendee.phone || attendee.first_name || attendee.last_name || attendee.name;
      if (!canCreateLead) {
        summary.unlinked_attendees += 1;
        continue;
      }
      const beforeCount = db.leads.length;
      const result = Leads.ensureLeadRecord(db, user, Events.leadInputFromAttendee(db, event, attendee), {
        taskTitle: `Follow up after ${event.name || Events.eventSourceName(event, attendee)}`,
        taskKind: 'Follow-up'
      });
      if (result.lead) {
        attendee.lead_id = result.lead.id;
        attendee.first_name ||= result.lead.first_name;
        attendee.last_name ||= result.lead.last_name;
        attendee.email ||= result.lead.email;
        attendee.phone ||= result.lead.phone;
        if (db.leads.length > beforeCount) summary.leads_created += 1;
        else summary.leads_updated += 1;
        summary.attendees_linked += 1;
      } else {
        summary.unlinked_attendees += 1;
      }
    }
  }

  for (const [index, storedCall] of (db.zoom.calls || []).entries()) {
    const call = Zoom.hydrateZoomStoredCall(db, storedCall);
    db.zoom.calls[index] = call;
    if (call.lead_id && existingLeadIds.has(call.lead_id)) continue;
    const match = Zoom.zoomCallLeadMatch(db, call);
    const lead = match.lead || Leads.leadByContact(db, { phone: call.caller_number }) || Leads.leadByContact(db, { phone: call.callee_number });
    if (lead) {
      call.lead_id = lead.id;
      call.lead_name = Util.fullName(lead);
      call.matched_side ||= match.side || (Zoom.samePhone(lead.phone, call.caller_number) ? 'caller' : Zoom.samePhone(lead.phone, call.callee_number) ? 'callee' : '');
      call.matched_number ||= match.number || call.caller_number || call.callee_number || '';
      call.matched_source ||= 'CRM lead phone';
      Leads.addLeadSource(lead, 'Zoom Call', {
        provider_id: call.zoom_call_history_uuid || call.zoom_call_id || call.id || '',
        captured_at: call.started_at,
        phone: call.matched_number || '',
        direction: call.direction || '',
        matched_side: call.matched_side || '',
        account: call.zoom_account_label || call.zoom_account_id || '',
        owner: call.owner_name || ''
      });
      summary.calls_linked += 1;
    } else {
      summary.unlinked_calls += 1;
    }
  }

  const deduped = Leads.dedupeLeadRecords(db, user);
  summary.leads_merged = deduped.merged;
  summary.ids_migrated = deduped.migrated;
  const changed = summary.leads_created || summary.emails_linked || summary.attendees_linked || summary.calls_linked || summary.leads_merged || summary.ids_migrated;
  if (options.audit !== false && changed) {
    Audit.addAudit(db, user, 'Imported data reconciled', 'integration', 'all', `${summary.leads_created} leads created, ${summary.emails_linked} emails linked, ${summary.attendees_linked} attendees linked, ${summary.calls_linked} calls linked`);
  }
  return summary;
}

function recalculate(db) {
  db.users ||= Auth.initialUsers();
  // Temporary passwords are no longer stored as plain text: drop the ones older versions saved.
  for (const user of db.users) delete user.temporary_password;
  db.owners = db.users.map(Auth.publicUser);
  Programmes.ensureProgrammeCatalog(db);
  db.sources ||= seedDatabase().sources;
  db.leads ||= [];
  db.tasks ||= [];
  db.emails ||= [];
  db.applications ||= [];
  db.events ||= [];
  db.audit ||= [];
  db.attribution ||= [];
  db.commercialOpportunities ||= db.meta?.commercialOpportunities || [];
  db.gmail ||= { connected: false, imported_message_ids: [] };
  db.eventbrite ||= { connected: false, imported_event_ids: [], imported_attendee_ids: [] };
  db.meta ||= { imported_lead_ids: [], imported_form_ids: [] };
  db.apollo ||= { imported_person_ids: [] };
  db.zoho ||= db.meta.zoho || { imported_record_ids: [] };
  db.zoom ||= db.meta.zoom || { imported_meeting_ids: [] };
  db.meta.apollo = db.apollo;
  db.meta.zoho = db.zoho;
  db.meta.zoom = db.zoom;
  db.meta.commercialOpportunities = db.commercialOpportunities;
  if (!db.sources.includes('Meta')) db.sources.push('Meta');
  if (!db.sources.includes('Email')) db.sources.push('Email');
  if (!db.sources.includes('Apollo')) db.sources.push('Apollo');
  if (!db.sources.includes('Zoho CRM')) db.sources.push('Zoho CRM');
  const programmeById = new Map(db.programmes.map(item => [item.id, item]));
  const ownerById = new Map(db.users.map(item => [item.id, item]));
  const leadById = new Map(db.leads.map(lead => [lead.id, lead]));
  const openTaskByLead = new Map();
  const taskById = new Map(db.tasks.map(task => [task.id, task]));
  const openCallTaskByLead = new Map();
  for (const task of db.tasks) {
    if (task.status !== 'Open' || !task.lead_id) continue;
    const current = openTaskByLead.get(task.lead_id);
    if (!current || new Date(task.due_at || 0) < new Date(current.due_at || 0)) openTaskByLead.set(task.lead_id, task);
    if (task.source === 'call_analysis') {
      const callTask = openCallTaskByLead.get(task.lead_id);
      if (!callTask || new Date(task.due_at || 0) < new Date(callTask.due_at || 0)) openCallTaskByLead.set(task.lead_id, task);
    }
  }
  db.leads.forEach(lead => {
    const programme = programmeById.get(lead.programme_id);
    const owner = ownerById.get(lead.owner_id) || db.users[0];
    lead.full_name = Util.fullName(lead);
    lead.programme = programme?.name || lead.programme;
    lead.level = programme?.level || lead.level;
    lead.owner = owner?.name || lead.owner;
    const open = openTaskByLead.get(lead.id);
    if (lead.next_action_source === 'call_analysis') CallNextAction.update(lead, taskById.get(lead.next_action_task_id), openCallTaskByLead.get(lead.id));
    else lead.next_action_at = open?.due_at || null;
  });
  db.tasks.forEach(task => {
    const lead = leadById.get(task.lead_id);
    if (lead) {
      task.first_name = lead.first_name;
      task.last_name = lead.last_name;
    }
  });
  const inactiveStages = new Set(['Enrolled', 'Lost', 'Not Eligible']);
  const sourceStats = new Map();
  let active = 0;
  for (const lead of Leads.uniqueLeadsByIdentity(db.leads)) {
    if (!inactiveStages.has(lead.stage)) active += 1;
    const source = lead.source_first_touch;
    if (!source) continue;
    const row = sourceStats.get(source) || { source, leads: 0, enrolled: 0 };
    row.leads += 1;
    if (lead.stage === 'Enrolled') row.enrolled += 1;
    sourceStats.set(source, row);
    for (const item of lead.source_history || []) {
      if (item.source && !db.sources.includes(item.source)) db.sources.push(item.source);
    }
  }
  db.stats = {
    active,
    applications: db.applications.length,
    enrolled: db.applications.filter(app => app.learner).length,
    overdue: db.tasks.filter(task => task.status === 'Open' && new Date(task.due_at) < new Date()).length,
    unanswered: db.emails.filter(email => Emails.emailNeedsResponse(db, email)).length
  };
  db.source_counts = [...new Set([...db.sources, ...sourceStats.keys()])]
    .map(source => sourceStats.get(source) || { source, leads: 0, enrolled: 0 })
    .filter(row => row.leads || row.enrolled);
  db.integrations = integrationStatuses(db);
  return db;
}

// Connection status per provider, from configuration and the stored integration state.
function integrationStatuses(db) {
  db.gmail ||= {};
  db.eventbrite ||= {};
  db.zoho ||= {};
  const gmailReady = Gmail.gmailConfigured();
  const gmailNeedsReconnect = Boolean(db.gmail.reconnect_required || db.gmail.last_error);
  const gmailStatus = db.gmail.connected && !gmailNeedsReconnect ? 'Connected' : gmailReady ? 'Ready to connect' : 'Needs credentials';
  const gmailDetail = gmailNeedsReconnect ? 'Gmail access expired. Reconnect the mailbox from Settings.' : db.gmail.connected ? `Mailbox sync connected${db.gmail.email ? ` for ${db.gmail.email}` : ''}.` : gmailReady ? 'OAuth credentials are configured. Connect a mailbox from Settings.' : 'Add Gmail OAuth credentials to enable mailbox sync.';
  const eventbriteReady = Eventbrite.eventbriteConfigured();
  const eventbriteTokenReady = Eventbrite.eventbritePrivateTokenConfigured();
  const eventbriteConnected = db.eventbrite.connected || eventbriteTokenReady;
  const eventbriteStatus = eventbriteConnected ? 'Connected' : eventbriteReady ? 'Ready to connect' : 'Needs credentials';
  const eventbriteDetail = eventbriteConnected ? `Eventbrite sync connected${db.eventbrite.name ? ` for ${db.eventbrite.name}` : eventbriteTokenReady ? ' by private token' : ''}.` : eventbriteReady ? 'OAuth credentials are configured. Connect Eventbrite from Settings.' : 'Add Eventbrite credentials to enable event sync.';
  const metaReady = Meta.metaConfigured();
  const metaStatus = metaReady ? 'Connected' : 'Needs credentials';
  const metaDetail = metaReady ? `Meta Lead Ads sync is configured for the configured page.` : 'Add Meta Lead Ads credentials to enable lead sync.';
  const apolloReady = Apollo.apolloConfigured();
  const apolloStatus = apolloReady ? 'Connected' : 'Needs credentials';
  const apolloDetail = apolloReady ? 'Apollo people search is configured.' : 'Add Apollo credentials to enable prospect sync.';
  const zohoStatusState = Zoho.zohoConnectionDiagnostics({ headers: {}, socket: {} }, db);
  const zohoReady = zohoStatusState.configured;
  const zohoConnected = zohoStatusState.connected;
  const zohoStatus = zohoConnected ? 'Connected' : zohoStatusState.reauthorizationRequired ? 'Reconnect required' : zohoReady ? 'Ready to connect' : 'Needs credentials';
  const zohoDetail = zohoConnected ? `Zoho CRM sync connected${db.zoho.email ? ` for ${db.zoho.email}` : ''}.` : zohoStatusState.reauthorizationRequired ? 'Zoho authorization is not durable. Reconnect Zoho and approve offline access.' : zohoReady ? 'OAuth credentials are configured. Connect Zoho CRM from Settings.' : 'Add Zoho CRM OAuth credentials to enable module sync.';
  const zoomReady = Zoom.zoomConfigured();
  const zoomStatus = zoomReady ? 'Connected' : 'Needs credentials';
  const zoomAccountCount = Zoom.zoomAccounts().length;
  const zoomDetail = zoomReady ? `Zoom meetings sync is configured for ${Zoom.zoomSyncAllUsers() ? 'all users' : 'the configured user'} across ${zoomAccountCount} account${zoomAccountCount === 1 ? '' : 's'}.` : 'Add Zoom credentials to enable meeting sync.';
  return [
    { name: 'Gmail', status: gmailStatus, detail: gmailDetail },
    { name: 'Eventbrite', status: eventbriteStatus, detail: eventbriteDetail },
    { name: 'Zoom', status: zoomStatus, detail: zoomDetail },
    { name: 'Meta', status: metaStatus, detail: metaDetail },
    { name: 'Apollo', status: apolloStatus, detail: apolloDetail },
    { name: 'Zoho CRM', status: zohoStatus, detail: zohoDetail }
  ];
}

// Credential fields that must never reach a browser payload.
const INTEGRATION_SECRET_FIELDS = ['access_token', 'refresh_token', 'id_token', 'client_secret', 'private_token', 'api_key', 'token', 'password', 'password_hash', 'temporary_password', 'database_url', 'session_secret'];
const INTEGRATION_SECRET_FIELD_SET = new Set(INTEGRATION_SECRET_FIELDS);

function withoutIntegrationSecrets(state) {
  if (!state || typeof state !== 'object') return state;
  if (Array.isArray(state)) return state.map(item => withoutIntegrationSecrets(item));
  const safe = {};
  for (const [key, value] of Object.entries(state)) {
    if (INTEGRATION_SECRET_FIELD_SET.has(String(key).toLowerCase())) continue;
    safe[key] = withoutIntegrationSecrets(value);
  }
  return safe;
}

function slimIntegrationState(name, state) {
  const safe = withoutIntegrationSecrets(state && typeof state === 'object' ? { ...state } : {});
  for (const key of Bootstrap.BOOTSTRAP_STATE_DROP[name] || []) delete safe[key];
  return safe;
}

exports.DEFAULT_STAGES = DEFAULT_STAGES;
exports.DEFAULT_SOURCES = DEFAULT_SOURCES;
exports.seedDatabase = seedDatabase;
exports.workspaceMetaState = workspaceMetaState;
exports.reconcileImportedData = reconcileImportedData;
exports.recalculate = recalculate;
exports.integrationStatuses = integrationStatuses;
exports.withoutIntegrationSecrets = withoutIntegrationSecrets;
exports.slimIntegrationState = slimIntegrationState;
