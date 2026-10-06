'use strict';

const crypto = require('node:crypto');
const State = require('./state');
const Storage = require('./storage');
const Applications = require('./applications');

function importAuditRows(db) {
  return (db.audit || []).map(item => ({
    id: item.id,
    occurred_at: item.occurred_at || null,
    actor: item.actor || null,
    action: item.action || null,
    entity: item.entity || null,
    entity_id: item.entity_id || null,
    data: item
  }));
}

function loadAuditList(db, limit = 100) {
  return (db.audit || [])
    .slice()
    .sort((a, b) => new Date(b.occurred_at || 0) - new Date(a.occurred_at || 0))
    .slice(0, Math.max(1, Math.min(Number(limit || 100), 250)));
}

function loadAttributionList(db, limit = 100) {
  return (db.attribution || [])
    .slice()
    .sort((a, b) => new Date(b.learner?.enrolled_at || b.created_at || 0) - new Date(a.learner?.enrolled_at || a.created_at || 0))
    .slice(0, Math.max(1, Math.min(Number(limit || 100), 250)));
}

async function appendAuditFast(client, user, action, entity, entityId, detail = '') {
  const audit = {
    id: `AU-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    occurred_at: new Date().toISOString(),
    actor: user.name,
    action: detail ? `${action}: ${detail}` : action,
    entity,
    entity_id: entityId
  };
  await client.query(
    `insert into app_audit (id, occurred_at, actor, action, entity, entity_id, data)
     values ($1, $2::timestamptz, $3, $4, $5, $6, $7::jsonb)`,
    [audit.id, audit.occurred_at, audit.actor, audit.action, audit.entity, audit.entity_id, Applications.jsonValue(audit)]
  );
  return audit;
}

async function loadAuditListDb(limit = 100) {
  await Storage.ensureStorage();
  const safeLimit = Math.max(1, Math.min(Number(limit || 100), 250));
  if (State.postgresPool) {
    const result = await State.postgresPool.query(`select data from app_audit order by occurred_at desc nulls last, id limit $1`, [safeLimit]);
    return result.rows.map(item => item.data);
  }
  return loadAuditList(await Storage.loadDb(), safeLimit);
}

async function loadAttributionListDb(limit = 100) {
  await Storage.ensureStorage();
  const safeLimit = Math.max(1, Math.min(Number(limit || 100), 250));
  if (State.postgresPool) {
    const result = await State.postgresPool.query(`select data from app_attribution order by id desc limit $1`, [safeLimit]);
    return result.rows.map(item => item.data);
  }
  return loadAttributionList(await Storage.loadDb(), safeLimit);
}

function addAudit(db, user, action, entity, entity_id, detail = '') {
  db.audit.unshift({
    id: `AU-${Date.now()}-${db.audit.length}`,
    occurred_at: new Date().toISOString(),
    actor: user.name,
    action: detail ? `${action}: ${detail}` : action,
    entity,
    entity_id
  });
}

exports.importAuditRows = importAuditRows;
exports.loadAuditList = loadAuditList;
exports.appendAuditFast = appendAuditFast;
exports.loadAuditListDb = loadAuditListDb;
exports.loadAttributionListDb = loadAttributionListDb;
exports.addAudit = addAudit;
