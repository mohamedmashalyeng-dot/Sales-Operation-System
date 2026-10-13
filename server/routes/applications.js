'use strict';

const State = require('../state');
const Util = require('../util');
const Http = require('../http');
const Storage = require('../storage');
const Auth = require('../auth');
const Audit = require('../audit');
const Leads = require('../leads');
const Applications = require('../applications');
const Authorization = require('../authorization');
const NOT_HANDLED = require('./not-handled');

async function verifyContractFastDb(id, body) {
  if (!State.postgresPool) return null;
  await Storage.ensureStorage();
  const client = await State.postgresPool.connect();
  try {
    await client.query('begin');
    const result = await client.query(`select data from app_applications where id = $1 for update`, [id]);
    const app = result.rows[0]?.data;
    if (!app) throw Http.statusError(404, 'Application not found.');
    app.contract = {
      status: 'Verified',
      signatory: body.signatory,
      signed_at: body.signed_at,
      note: body.note,
      consistency_confirmed: body.consistency_confirmed
    };
    await client.query(
      `update app_applications set contract = $2::jsonb, data = $3::jsonb where id = $1`,
      [app.id, Applications.jsonValue(app.contract), Applications.jsonValue(app)]
    );
    await client.query('commit');
    State.dbCache = null;
    return { ok: true, application: Applications.publicApplication(app) };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

function appFor(db, id) {
  const app = db.applications.find(item => item.id === id);
  if (!app) throw Http.statusError(404, 'Application not found.');
  return app;
}

// Applications routes that read and write the database directly.
async function applicationsRoutes(ctx) {
  const { route, method, res, trace, body, req, url } = ctx;
  let lightweightMatch = null;
  if (route === '/api/admissions/pipeline' && method === 'GET') {
    const user = await Auth.currentSessionUser(req, trace);
    return Http.sendJson(res, await Applications.loadAdmissionsPipelineDb({
      stage: url.searchParams.get('stage'),
      status: url.searchParams.get('status'),
      programme: url.searchParams.get('programme'),
      programme_id: url.searchParams.get('programme_id'),
      intake: url.searchParams.get('intake'),
      intake_id: url.searchParams.get('intake_id'),
      owner: Authorization.ownerFilter(user, url.searchParams.get('owner')),
      owner_id: Authorization.ownerFilter(user, url.searchParams.get('owner_id')),
      source: url.searchParams.get('source'),
      created_from: url.searchParams.get('created_from'),
      created_to: url.searchParams.get('created_to'),
      updated_from: url.searchParams.get('updated_from'),
      updated_to: url.searchParams.get('updated_to'),
      search: url.searchParams.get('search')
    }, trace), 200, {}, trace);
  }
  lightweightMatch = route.match(/^\/api\/admissions\/stage\/([^/]+)$/);
  if (lightweightMatch && method === 'GET') {
    const user = await Auth.currentSessionUser(req, trace);
    return Http.sendJson(res, await Applications.loadAdmissionsStageDb(decodeURIComponent(lightweightMatch[1]), {
      limit: url.searchParams.get('limit'),
      offset: url.searchParams.get('offset'),
      status: url.searchParams.get('status'),
      programme: url.searchParams.get('programme'),
      programme_id: url.searchParams.get('programme_id'),
      intake: url.searchParams.get('intake'),
      intake_id: url.searchParams.get('intake_id'),
      owner: Authorization.ownerFilter(user, url.searchParams.get('owner')),
      owner_id: Authorization.ownerFilter(user, url.searchParams.get('owner_id')),
      source: url.searchParams.get('source'),
      created_from: url.searchParams.get('created_from'),
      created_to: url.searchParams.get('created_to'),
      updated_from: url.searchParams.get('updated_from'),
      updated_to: url.searchParams.get('updated_to'),
      search: url.searchParams.get('search')
    }, trace), 200, {}, trace);
  }
  if (route === '/api/applications' && method === 'GET') {
    const user = await Auth.currentSessionUser(req, trace);
    return Http.sendJson(res, await Applications.loadApplicationListDb({
      limit: url.searchParams.get('limit'),
      offset: url.searchParams.get('offset'),
      cursor: url.searchParams.get('cursor'),
      status: url.searchParams.get('status'),
      programme: url.searchParams.get('programme'),
      programme_id: url.searchParams.get('programme_id'),
      intake: url.searchParams.get('intake'),
      intake_id: url.searchParams.get('intake_id'),
      owner: Authorization.ownerFilter(user, url.searchParams.get('owner')),
      owner_id: Authorization.ownerFilter(user, url.searchParams.get('owner_id')),
      source: url.searchParams.get('source'),
      created_from: url.searchParams.get('created_from'),
      created_to: url.searchParams.get('created_to'),
      search: url.searchParams.get('search'),
      include_total: url.searchParams.get('include_total')
    }, trace), 200, {}, trace);
  }
  if (route === '/api/applications' && method === 'POST' && State.postgresPool) {
    const user = await Auth.currentSessionUser(req);
    Authorization.rejectProtectedFields(body);
    await Authorization.requireRecord(user, 'lead', body.lead_id);
    return Http.sendJson(res, await Applications.createApplicationFastDb(body, user), 201);
  }
  lightweightMatch = route.match(/^\/api\/applications\/([^/]+)\/evidence$/);
  if (lightweightMatch && method === 'POST' && State.postgresPool) {
    const user = await Auth.currentSessionUser(req);
    await Authorization.requireRecord(user, 'application', lightweightMatch[1]);
    return Http.sendJson(res, await Applications.uploadEvidenceFastDb(lightweightMatch[1], body), 201);
  }
  lightweightMatch = route.match(/^\/api\/evidence\/([^/]+)\/review$/);
  if (lightweightMatch && method === 'POST' && State.postgresPool) {
    const user = await Auth.currentSessionUser(req);
    Authorization.requireTeam(user);
    return Http.sendJson(res, await Applications.reviewEvidenceFastDb(lightweightMatch[1], body, user));
  }
  lightweightMatch = route.match(/^\/api\/evidence\/([^/]+)$/);
  if (lightweightMatch && method === 'DELETE' && State.postgresPool) {
    const user = await Auth.currentSessionUser(req);
    await Authorization.requireRecord(user, 'evidence', lightweightMatch[1]);
    if (!Auth.permissionsForUser(user).review && !Auth.permissionsForUser(user).sales) throw Http.statusError(403, 'You do not have permission to delete evidence.');
    return Http.sendJson(res, await Applications.deleteEvidenceFastDb(lightweightMatch[1], user));
  }
  lightweightMatch = route.match(/^\/api\/evidence\/([^/]+)\/file$/);
  if (lightweightMatch && method === 'GET' && State.postgresPool) {
    const user = await Auth.currentSessionUser(req);
    await Authorization.requireRecord(user, 'evidence', lightweightMatch[1]);
    return Applications.sendEvidenceFileFastDb(lightweightMatch[1], res);
  }
  lightweightMatch = route.match(/^\/api\/document-templates\/([^/]+)\/file$/);
  if (lightweightMatch && method === 'GET') {
    await Auth.currentSessionUser(req);
    return Applications.sendDocumentTemplateFile(decodeURIComponent(lightweightMatch[1]), res);
  }
  lightweightMatch = route.match(/^\/api\/applications\/([^/]+)\/review$/);
  if (lightweightMatch && method === 'POST' && State.postgresPool) {
    const user = await Auth.currentSessionUser(req);
    Authorization.requireTeam(user);
    return Http.sendJson(res, await Applications.reviewApplicationFastDb(lightweightMatch[1], body, user));
  }
  lightweightMatch = route.match(/^\/api\/applications\/([^/]+)\/contract$/);
  if (lightweightMatch && method === 'POST' && State.postgresPool) {
    const user = await Auth.currentSessionUser(req);
    Authorization.requireTeam(user);
    return Http.sendJson(res, await verifyContractFastDb(lightweightMatch[1], body));
  }
  lightweightMatch = route.match(/^\/api\/applications\/([^/]+)\/enrol$/);
  if (lightweightMatch && method === 'POST' && State.postgresPool) {
    const user = await Auth.currentSessionUser(req);
    Authorization.requireTeam(user);
    return Http.sendJson(res, await Applications.enrolApplicationFastDb(lightweightMatch[1], body, user));
  }
  lightweightMatch = route.match(/^\/api\/applications\/([^/]+)\/status$/);
  if (lightweightMatch && method === 'PATCH' && State.postgresPool) {
    const user = await Auth.currentSessionUser(req);
    await Authorization.requireRecord(user, 'application', lightweightMatch[1]);
    if (!Auth.permissionsForUser(user).review && !Auth.permissionsForUser(user).sales) throw Http.statusError(403, 'You do not have permission to update application status.');
    return Http.sendJson(res, await Applications.transitionApplicationStatusFastDb(lightweightMatch[1], body, user));
  }
  lightweightMatch = route.match(/^\/api\/applications\/([^/]+)$/);
  if (lightweightMatch && method === 'GET') {
    const user = await Auth.currentSessionUser(req, trace);
    await Authorization.requireRecord(user, 'application', lightweightMatch[1]);
    return Http.sendJson(res, await Applications.loadApplicationDetailDb(lightweightMatch[1], user, trace), 200, {}, trace);
  }
  lightweightMatch = route.match(/^\/api\/applications\/([^/]+)$/);
  if (lightweightMatch && method === 'DELETE' && State.postgresPool) {
    const user = await Auth.currentSessionUser(req);
    Authorization.requireTeam(user);
    if (!Auth.permissionsForUser(user).review && !Auth.permissionsForUser(user).sales) throw Http.statusError(403, 'You do not have permission to delete applications.');
    return Http.sendJson(res, await Applications.deleteApplicationFastDb(lightweightMatch[1], user));
  }
  return NOT_HANDLED;
}

// Applications routes that work on the fully loaded workspace (db).
async function applicationsWorkspaceRoutes(ctx) {
  const { route, method, res, body, db, user } = ctx;
  let match = null;
  if (route === '/api/applications' && method === 'POST') {
    Authorization.rejectProtectedFields(body);
    await Authorization.requireRecord(user, 'lead', body.lead_id, db);
    const lead = Leads.leadFor(db, body.lead_id);
    const intake = db.intakes.find(item => item.id === body.intake_id);
    const alreadyEnrolled = Boolean(body.already_enrolled);
    const learner = Applications.applicationLearnerFromBody(body);
    const appId = Util.nextId('A', [db.applications]);
    lead.stage = alreadyEnrolled ? 'Enrolled' : 'Application Submitted';
    const documentsNeedSignature = Boolean(body.documents_need_signature);
    const evidenceVerified = alreadyEnrolled && !documentsNeedSignature;
    const app = { id: appId, lead_id: lead.id, first_name: lead.first_name, last_name: lead.last_name, programme: lead.programme, intake: intake?.name || 'Next intake', status: alreadyEnrolled ? 'Enrolled' : 'In review', manager: user.name, member: lead.first_name, created_at: new Date().toISOString(), contract: evidenceVerified ? { status: 'Verified', note: 'Existing enrolled learner documents uploaded.' } : { status: 'Draft', note: documentsNeedSignature ? 'Documents uploaded for learner signature.' : undefined }, requirements: Applications.applicationRequirements(appId, body.evidence_files, { verified: evidenceVerified, reviewer: user.name }), learner };
    db.applications.push(app);
    let attribution = null;
    if (alreadyEnrolled) {
      attribution = { ...lead, programme: app.programme, snapshot: { first_touch: lead.source_first_touch, lead_capture: lead.source_lead_capture, conversion_source: lead.source_lead_capture } };
      db.attribution.unshift(attribution);
    }
    Audit.addAudit(db, user, alreadyEnrolled ? 'Existing learner enrolled' : 'Application started', 'lead', lead.id);
    await Storage.saveDb(db);
    return Http.sendJson(res, { ok: true, application: Applications.publicApplication(app), lead, attribution }, 201);
  }

  match = route.match(/^\/api\/applications\/([^/]+)\/evidence$/);
  if (match && method === 'POST') {
    await Authorization.requireRecord(user, 'application', match[1], db);
    const app = appFor(db, match[1]);
    const req = app.requirements.find(item => item.id === body.requirement_id);
    if (!req) throw Http.statusError(404, 'Requirement not found.');
    req.latest = { id: Util.nextId('ER', [db.applications.flatMap(a => a.requirements.map(r => r.latest).filter(Boolean))]), filename: body.filename, version: (req.latest?.version || 0) + 1, status: 'Pending', reviewer: null, content_base64: body.content_base64 };
    if (!app.learner) app.status = 'In review';
    await Storage.saveDb(db);
    return Http.sendJson(res, { ok: true }, 201);
  }

  match = route.match(/^\/api\/evidence\/([^/]+)\/file$/);
  if (match && method === 'GET') {
    await Authorization.requireRecord(user, 'evidence', match[1], db);
    const req = db.applications.flatMap(app => app.requirements).find(item => item.latest?.id === match[1]);
    if (!req?.latest) throw Http.statusError(404, 'Evidence not found.');
    const content = Buffer.from(req.latest.content_base64 || '', 'base64');
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${req.latest.filename}"` });
    return res.end(content);
  }

  match = route.match(/^\/api\/evidence\/([^/]+)\/review$/);
  if (match && method === 'POST') {
    Authorization.requireTeam(user);
    const req = db.applications.flatMap(app => app.requirements).find(item => item.latest?.id === match[1]);
    if (!req?.latest) throw Http.statusError(404, 'Evidence not found.');
    req.latest.status = body.status;
    req.latest.reviewer = user.name;
    req.latest.review_note = body.note;
    await Storage.saveDb(db);
    return Http.sendJson(res, { ok: true });
  }

  match = route.match(/^\/api\/applications\/([^/]+)\/review$/);
  if (match && method === 'POST') {
    Authorization.requireTeam(user);
    const app = appFor(db, match[1]);
    const lead = Leads.leadFor(db, app.lead_id);
    app.status = body.status;
    lead.stage = body.status === 'Eligible' ? 'Ready for Enrolment' : 'Not Eligible';
    Audit.addAudit(db, user, 'Eligibility decision', 'lead', lead.id, body.status);
    await Storage.saveDb(db);
    return Http.sendJson(res, { ok: true });
  }

  match = route.match(/^\/api\/applications\/([^/]+)\/contract$/);
  if (match && method === 'POST') {
    Authorization.requireTeam(user);
    const app = appFor(db, match[1]);
    app.contract = { status: 'Verified', signatory: body.signatory, signed_at: body.signed_at, note: body.note, consistency_confirmed: body.consistency_confirmed };
    await Storage.saveDb(db);
    return Http.sendJson(res, { ok: true });
  }

  match = route.match(/^\/api\/applications\/([^/]+)\/enrol$/);
  if (match && method === 'POST') {
    Authorization.requireTeam(user);
    const app = appFor(db, match[1]);
    const lead = Leads.leadFor(db, app.lead_id);
    app.status = 'Enrolled';
    app.learner = { external_reference: body.external_reference, enrolled_at: new Date().toISOString(), note: body.note };
    lead.stage = 'Enrolled';
    db.attribution.unshift({ ...lead, programme: app.programme, snapshot: { first_touch: lead.source_first_touch, lead_capture: lead.source_lead_capture, conversion_source: lead.source_lead_capture } });
    Audit.addAudit(db, user, 'Learner enrolled', 'lead', lead.id, body.external_reference);
    await Storage.saveDb(db);
    return Http.sendJson(res, { ok: true });
  }
  return NOT_HANDLED;
}

exports.applicationsRoutes = applicationsRoutes;
exports.applicationsWorkspaceRoutes = applicationsWorkspaceRoutes;
