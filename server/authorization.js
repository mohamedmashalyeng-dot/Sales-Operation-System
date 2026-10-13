'use strict';

const State = require('./state');
const Http = require('./http');
const Storage = require('./storage');
const Auth = require('./auth');

// Who may reach which records. This is the one place for the policy; a route only says what it
// is about to do (requireTeam, requireRecord, ownerFilter ...).
//
// Roles come from Auth.permissionsForUser:
// - Developer and Monitor work on the whole team's records.
// - A Member works on their own: the leads they own and what belongs to those leads (tasks,
//   applications and their evidence, emails, calls, notes), plus the tasks assigned to them.
// The dashboard widgets, the dashboard search and the activity feed already followed this
// rule; the list, detail and write routes did not check anything beyond being signed in.
function isTeam(user) {
  const permissions = Auth.permissionsForUser(user);
  return Boolean(permissions.review || permissions.admin || permissions.developer);
}

function forbidden(message = 'You do not have permission to do this.') {
  return Http.statusError(403, message);
}

// For work that is not tied to one owner: integrations and their syncs, imports, review
// decisions, deleting leads and applications, audit and organisation-wide reports.
function requireTeam(user, message) {
  if (!isTeam(user)) throw forbidden(message);
}

// The owner filter a list is held to. Team users keep the filter they asked for (or none);
// a Member always gets their own id, whatever the request says.
function ownerFilter(user, requested) {
  return isTeam(user) ? requested : user.id;
}

// The owner a new or changed record may get. A Member can only keep records for themselves.
function ownerForWrite(user, requested) {
  if (isTeam(user)) return requested;
  const asked = requested === undefined || requested === null ? '' : String(requested);
  if (asked && asked !== String(user.id)) throw forbidden('You cannot assign records to another user.');
  return user.id;
}

// Creating a lead for an email that already is a lead updates that lead instead. A Member may
// only do that to a lead of their own.
function requireOwnDuplicate(user, existingLead) {
  if (existingLead && !isTeam(user) && String(existingLead.owner_id || '') !== String(user.id)) throw forbidden('This contact already belongs to another user.');
}

// Fields no request may set through a lead, task, application or email route. The handlers pick
// the fields they store one by one, so these were ignored before; a request that carries one is
// now refused, which makes an attempt visible instead of silent.
const PROTECTED_FIELDS = ['deleted_at', 'deleted_by', 'created_by', 'role', 'permissions', 'password_hash', 'zoho_record_id', 'crm_id'];

function rejectProtectedFields(body) {
  const found = PROTECTED_FIELDS.filter(key => body && Object.prototype.hasOwnProperty.call(body, key));
  if (found.length) throw Http.statusError(400, `These fields cannot be set here: ${found.join(', ')}.`);
}

// One short query per kind of record: does this user own it, directly or through its lead?
const OWNED_RECORD_SQL = {
  lead: `select 1 from app_leads where id = $1 and owner_id = $2 limit 1`,
  task: `select 1 from app_tasks t left join app_leads l on l.id = t.lead_id
         where t.id = $1 and (t.owner_id = $2 or l.owner_id = $2) limit 1`,
  application: `select 1 from app_applications a join app_leads l on l.id = a.lead_id
                where a.id = $1 and l.owner_id = $2 limit 1`,
  email: `select 1 from app_emails e join app_leads l on l.id = e.lead_id
          where e.id = $1 and l.owner_id = $2 limit 1`,
  attendee: `select 1
             from app_events e
             cross join lateral jsonb_array_elements(case when jsonb_typeof(e.attendees) = 'array' then e.attendees else '[]'::jsonb end) a(attendee)
             join app_leads l on l.id = a.attendee->>'lead_id'
             where a.attendee->>'id' = $1 and l.owner_id = $2 limit 1`,
  evidence: `select 1 from app_applications a join app_leads l on l.id = a.lead_id
             where jsonb_path_exists(a.requirements, '$[*].latest ? (@.id == $evidence_id)', jsonb_build_object('evidence_id', $1::text))
               and l.owner_id = $2 limit 1`
};

// The same question against a loaded workspace (the local JSON file, MongoDB, and the routes
// that still work on the whole workspace).
function ownsInWorkspace(db, entity, id, userId) {
  const owner = leadId => String((db.leads || []).find(lead => String(lead.id) === String(leadId))?.owner_id || '');
  const mine = String(userId);
  if (entity === 'lead') return owner(id) === mine;
  if (entity === 'task') {
    const task = (db.tasks || []).find(item => String(item.id) === id);
    return Boolean(task) && (String(task.owner_id || '') === mine || owner(task.lead_id) === mine);
  }
  if (entity === 'application') {
    const application = (db.applications || []).find(item => String(item.id) === id);
    return Boolean(application) && owner(application.lead_id) === mine;
  }
  if (entity === 'email') {
    const email = (db.emails || []).find(item => String(item.id) === id);
    return Boolean(email) && owner(email.lead_id) === mine;
  }
  if (entity === 'attendee') {
    const attendee = (db.events || []).flatMap(event => event.attendees || []).find(item => String(item.id) === id);
    return Boolean(attendee?.lead_id) && owner(attendee.lead_id) === mine;
  }
  if (entity === 'evidence') {
    const application = (db.applications || []).find(item => (item.requirements || []).some(requirement => requirement.latest?.id === id));
    return Boolean(application) && owner(application.lead_id) === mine;
  }
  return false;
}

// Called before a route reads or changes one record. Team users pass straight through (they
// reach every record, and a missing one is the handler's 404), so this adds no database work
// for them. A Member costs one short query, and gets the same 403 for a record that belongs to
// someone else and for an id that does not exist: the answer does not reveal which ids are in use.
async function requireRecord(user, entity, id, db = null) {
  if (isTeam(user)) return;
  const recordId = id === undefined || id === null ? '' : String(id);
  let allowed = false;
  if (recordId && OWNED_RECORD_SQL[entity]) {
    if (db) allowed = ownsInWorkspace(db, entity, recordId, user.id);
    else if (State.postgresPool && Storage.usesPostgresStorage()) {
      await Storage.ensureStorage();
      allowed = Boolean((await State.postgresPool.query(OWNED_RECORD_SQL[entity], [recordId, user.id])).rows[0]);
    } else allowed = ownsInWorkspace(await Storage.loadDb(), entity, recordId, user.id);
  }
  if (!allowed) throw forbidden('You do not have access to this record.');
}

exports.isTeam = isTeam;
exports.requireTeam = requireTeam;
exports.ownerFilter = ownerFilter;
exports.ownerForWrite = ownerForWrite;
exports.requireOwnDuplicate = requireOwnDuplicate;
exports.rejectProtectedFields = rejectProtectedFields;
exports.requireRecord = requireRecord;
exports.PROTECTED_FIELDS = PROTECTED_FIELDS;
