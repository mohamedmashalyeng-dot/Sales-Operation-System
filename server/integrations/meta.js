'use strict';

const Util = require('../util');
const Http = require('../http');
const Storage = require('../storage');
const Workspace = require('../workspace');
const Audit = require('../audit');
const Programmes = require('../programmes');
const Leads = require('../leads');

function metaConfigured() {
  return Boolean(
    process.env.META_ACCESS_TOKEN &&
    process.env.META_PAGE_ID &&
    !process.env.META_ACCESS_TOKEN.includes('your-meta') &&
    !process.env.META_PAGE_ID.includes('your-facebook') &&
    !process.env.META_ACCESS_TOKEN.includes('replace-with') &&
    !process.env.META_PAGE_ID.includes('replace-with')
  );
}

function metaGraphVersion() {
  return process.env.META_GRAPH_VERSION || 'v22.0';
}

function metaUrl(pathname, params = {}) {
  const query = new URLSearchParams(params);
  return `https://graph.facebook.com/${metaGraphVersion()}/${pathname.replace(/^\/+/, '')}?${query}`;
}

function metaFieldMap(lead) {
  const fields = {};
  for (const field of lead.field_data || []) {
    const key = String(field.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    fields[key] = Array.isArray(field.values) ? field.values.join(', ') : String(field.values || '');
  }
  return fields;
}

function metaPick(fields, names, fallback = '') {
  for (const name of names) {
    if (fields[name]) return fields[name];
  }
  return fallback;
}

function programmeForMetaLead(db, fields) {
  return Programmes.programmeForText(db, Object.values(fields).join(' '));
}

function createOrUpdateMetaLead(db, user, lead, form) {
  const fields = metaFieldMap(lead);
  const email = metaPick(fields, ['email', 'email_address', 'work_email']).toLowerCase();
  const phone = metaPick(fields, ['phone_number', 'phone', 'mobile_number', 'mobile']);
  const full = metaPick(fields, ['full_name', 'name'], '').trim();
  const first = metaPick(fields, ['first_name'], full.split(/\s+/)[0] || 'Meta');
  const last = metaPick(fields, ['last_name'], full.split(/\s+/).slice(1).join(' ') || 'Lead');
  const programme = programmeForMetaLead(db, fields);
  const result = Leads.ensureLeadRecord(db, user, {
    first_name: first,
    last_name: last,
    programme_id: programme.id,
    email: email || `${lead.id}@meta.local`,
    employer: metaPick(fields, ['company_name', 'company', 'employer']),
    phone,
    city: metaPick(fields, ['city', 'location', 'postcode']),
    stage: 'New lead',
    priority: 'P2',
    source_first_touch: 'Meta',
    source_lead_capture: 'Meta',
    contact_permission: 'Granted',
    created_at: lead.created_time || new Date().toISOString(),
    meta_lead_id: lead.id,
    meta_form_id: form.id,
    meta_form_name: form.name || ''
  }, {
    taskTitle: `Follow up Meta lead from ${form.name || 'Lead Ads'}`,
    taskKind: 'Follow-up'
  });
  return result;
}

async function importMetaLeads(db, user, maxLeads = 50) {
  if (!metaConfigured()) throw Http.statusError(400, 'Meta credentials are not configured.');
  const auth = { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` };
  const formIds = String(process.env.META_FORM_IDS || '').split(',').map(item => item.trim()).filter(Boolean);
  let forms = formIds.map(id => ({ id, name: `Meta form ${id}` }));
  if (!forms.length) {
    const formList = await Util.fetchJson(metaUrl(`/${process.env.META_PAGE_ID}/leadgen_forms`, { fields: 'id,name,status', limit: '100' }), { headers: auth });
    forms = formList.data || [];
  }
  let imported = 0;
  let scanned = 0;
  for (const form of forms) {
    if (scanned >= maxLeads) break;
    const limit = String(Math.max(1, Math.min(100, maxLeads - scanned)));
    const list = await Util.fetchJson(metaUrl(`/${form.id}/leads`, { fields: 'id,created_time,field_data,ad_name,form_id,platform', limit }), { headers: auth });
    for (const lead of list.data || []) {
      scanned += 1;
      if ((db.meta.imported_lead_ids || []).includes(lead.id)) continue;
      const result = createOrUpdateMetaLead(db, user, lead, form);
      db.meta.imported_lead_ids = [...(db.meta.imported_lead_ids || []), lead.id];
      if (result.created) imported += 1;
    }
    if (!(db.meta.imported_form_ids || []).includes(form.id)) db.meta.imported_form_ids = [...(db.meta.imported_form_ids || []), form.id];
  }
  db.meta.last_sync_at = new Date().toISOString();
  const reconciliation = Workspace.reconcileImportedData(db, user);
  Audit.addAudit(db, user, 'Meta leads synced', 'integration', 'Meta', `${imported} new leads from ${forms.length} forms`);
  await Storage.saveDb(db);
  return { imported, scanned, forms: forms.length, reconciliation, last_sync_at: db.meta.last_sync_at };
}

exports.metaConfigured = metaConfigured;
exports.importMetaLeads = importMetaLeads;
