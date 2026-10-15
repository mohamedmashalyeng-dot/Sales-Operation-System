'use strict';
const crypto = require('node:crypto');

// JSON/Mongo equivalent of the PostgreSQL stage-history trigger. History is kept
// outside lead payloads; list responses never carry the complete journal.
function syncLocal(db) {
  db.meta ||= {};
  const history = db.meta.leadStageHistory ||= [];
  const latest = new Map(history.map(row => [String(row.lead_id), row]));
  for (const lead of db.leads || []) {
    const previous = latest.get(String(lead.id));
    if (!lead.stage || previous?.to_stage === lead.stage) continue;
    const context = db.__stage_context?.[lead.id] || {};
    const application = (db.applications || []).some(app => app.lead_id === lead.id);
    history.push({ id: `SH-${crypto.randomUUID()}`, lead_id: lead.id,
      from_stage: previous?.to_stage || null, to_stage: lead.stage,
      source: context.source || (application ? 'application' : 'system_rule'),
      call_id: context.call_id || null, reason: context.reason || (previous ? 'KBC record updated' : 'First observed stage (baseline)'),
      suggested_by: context.suggested_by || null, approved_by: context.approved_by || null,
      created_at: new Date().toISOString() });
  }
  delete db.__stage_context;
}
exports.syncLocal = syncLocal;
