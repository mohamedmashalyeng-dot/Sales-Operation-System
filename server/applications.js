'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Config = require('./config');
const State = require('./state');
const Util = require('./util');
const Http = require('./http');
const Perf = require('./perf');
const Storage = require('./storage');
const Audit = require('./audit');
const Leads = require('./leads');
const Tasks = require('./tasks');
const StaticFiles = require('./static-files');

const jsonValue = value => JSON.stringify(value ?? null);

function publicApplication(app) {
  return {
    ...app,
    requirements: (app.requirements || []).map(req => ({
      ...req,
      latest: req.latest ? { ...req.latest, content_base64: undefined } : null
    }))
  };
}

function loadApplicationList(db) {
  const enrolledLeadIds = new Set((db.leads || [])
    .filter(lead => lead?.id && !lead.deleted_at && isEnrolledStage(lead.stage))
    .map(lead => String(lead.id)));
  return (db.applications || [])
    .filter(app => enrolledLeadIds.has(String(app.lead_id || '')))
    .slice()
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    .map(publicApplication);
}

async function loadApplicationListDb(options = {}, trace = null) {
  await Perf.perfPhase(trace, 'applications_storage', () => Storage.ensureStorage());
  const safeLimit = Math.max(1, Math.min(Number(options.limit || 50), 100));
  const safeOffset = Math.max(0, Number(options.offset || 0));
  const cursor = Util.decodePageCursor(options.cursor, 'application cursor');
  const includeTotal = !options.cursor && ['1', 'true'].includes(String(options.include_total || '').toLowerCase());
  const filters = {
    status: String(options.status || '').trim(),
    programme: String(options.programme || options.programme_id || '').trim(),
    intake: String(options.intake || options.intake_id || '').trim(),
    owner: String(options.owner || options.owner_id || '').trim(),
    source: String(options.source || '').trim(),
    search: String(options.search || '').trim().slice(0, 200),
    createdFrom: Tasks.parseOptionalIsoDate(options.created_from, 'created_from'),
    createdTo: Tasks.parseOptionalIsoDate(options.created_to, 'created_to')
  };
  if (!options.cursor) await runEnrolledLeadApplicationBackfill();
  if (State.postgresPool) {
    const values = [];
    const conditions = [
      `${Leads.activeLeadCondition('l')} and lower(coalesce(l.stage, l.data->>'stage', '')) = 'enrolled'`
    ];
    const bind = value => { values.push(value); return `$${values.length}`; };
    if (filters.status) conditions.push(`a.status = ${bind(filters.status)}`);
    if (filters.programme) conditions.push(`(a.programme = ${bind(filters.programme)} or a.data->>'programme_id' = $${values.length})`);
    if (filters.intake) conditions.push(`(a.intake = ${bind(filters.intake)} or a.data->>'intake_id' = $${values.length})`);
    if (filters.owner) conditions.push(`(l.owner_id = ${bind(filters.owner)} or a.manager = $${values.length} or a.data->>'owner_id' = $${values.length})`);
    if (filters.source) {
      const sourceParam = bind(filters.source);
      conditions.push(`(l.source_first_touch = ${sourceParam} or l.source_lead_capture = ${sourceParam} or a.data->>'source' = ${sourceParam})`);
    }
    if (filters.createdFrom) conditions.push(`a.created_at >= ${bind(filters.createdFrom)}::timestamptz`);
    if (filters.createdTo) conditions.push(`a.created_at < ${bind(filters.createdTo)}::timestamptz`);
    if (filters.search) {
      const term = bind(`%${Tasks.escapeSqlLike(filters.search)}%`);
      conditions.push(`(
        a.first_name ilike ${term} or a.last_name ilike ${term} or a.programme ilike ${term} or a.status ilike ${term}
        or l.email ilike ${term} or l.first_name ilike ${term} or l.last_name ilike ${term}
      )`);
    }
    if (cursor?.id) {
      if (cursor.created_at) {
        const createdParam = bind(cursor.created_at);
        const idParam = bind(String(cursor.id || ''));
        conditions.push(`(a.created_at < ${createdParam}::timestamptz or (a.created_at = ${createdParam}::timestamptz and a.id < ${idParam}) or a.created_at is null)`);
      } else {
        conditions.push(`(a.created_at is null and a.id < ${bind(String(cursor.id || ''))})`);
      }
    }
    const whereSql = conditions.length ? `where ${conditions.join(' and ')}` : '';
    const listValues = cursor ? [...values, safeLimit + 1] : [...values, safeLimit + 1, safeOffset];
    const [result, total] = await Promise.all([
      Storage.timedPostgresQuery(trace, 'applications_page',
        `select a.data, a.created_at
         from app_applications a
         left join app_leads l on l.id = a.lead_id
         ${whereSql}
         order by a.created_at desc nulls last, a.id desc
         limit $${cursor ? listValues.length : listValues.length - 1}${cursor ? '' : ` offset $${listValues.length}`}`,
        listValues
      ),
      includeTotal ? Storage.timedPostgresQuery(trace, 'applications_count', `select count(*)::int as count from app_applications a left join app_leads l on l.id = a.lead_id ${whereSql}`, values) : Promise.resolve(null)
    ]);
    return Perf.perfPhase(trace, 'mapping', async () => {
      const pageRows = result.rows.slice(0, safeLimit);
      const applications = pageRows.map(item => publicApplication(item.data));
      const count = total ? Number(total.rows[0]?.count || 0) : null;
      const last = pageRows[pageRows.length - 1];
      const nextCursor = result.rows.length > safeLimit && last?.data?.id ? Util.encodePageCursor({ created_at: last.created_at || last.data.created_at || null, id: last.data.id }) : '';
      return {
        applications,
        total: count,
        offset: safeOffset,
        limit: safeLimit,
        loaded: safeOffset + applications.length,
        has_more: Boolean(nextCursor),
        hasMore: Boolean(nextCursor),
        next_cursor: nextCursor,
        nextCursor,
        next_offset: safeOffset + applications.length
      };
    });
  }
  const all = loadApplicationList(await Storage.loadDb());
  const filtered = all
    .filter(app => !filters.status || String(app.status || '') === filters.status)
    .filter(app => !filters.programme || String(app.programme || app.programme_id || '') === filters.programme)
    .filter(app => !filters.intake || String(app.intake || app.intake_id || '') === filters.intake)
    .filter(app => !filters.owner || String(app.owner_id || app.manager || '') === filters.owner)
    .filter(app => !filters.source || String(app.source || '') === filters.source)
    .filter(app => !filters.createdFrom || new Date(app.created_at || 0) >= new Date(filters.createdFrom))
    .filter(app => !filters.createdTo || new Date(app.created_at || 0) < new Date(filters.createdTo))
    .filter(app => !filters.search || JSON.stringify(app).toLowerCase().includes(filters.search.toLowerCase()));
  const cursorIndex = cursor?.id ? filtered.findIndex(app => app.id === cursor.id) + 1 : safeOffset;
  const start = Math.max(0, cursorIndex || 0);
  const applications = filtered.slice(start, start + safeLimit);
  const nextCursor = start + applications.length < filtered.length ? Util.encodePageCursor({ created_at: applications[applications.length - 1]?.created_at || null, id: applications[applications.length - 1]?.id || '' }) : '';
  return {
    applications,
    total: filtered.length,
    offset: start,
    limit: safeLimit,
    loaded: start + applications.length,
    has_more: Boolean(nextCursor),
    hasMore: Boolean(nextCursor),
    next_cursor: nextCursor,
    nextCursor,
    next_offset: start + applications.length
  };
}

const APPLICATION_DOCUMENT_TEMPLATES = [
  ['training_plan', 'Training Plan', 'TrainingPlan-Training Plan v3 (5).pdf', 'assets/documents/TrainingPlan-Training Plan v3 (5).pdf'],
  ['onboarding_ilr', 'OnBoarding ILR', 'OnBoarding-ILR (3).pdf', 'assets/documents/OnBoarding-ILR (3).pdf'],
  ['employer_agreement', 'Employer Agreement Form', 'EmployerAgreementForm - Generic.pdf', 'assets/documents/EmployerAgreementForm - Generic.pdf'],
  ['written_agreement', 'Apprenticeship Written Agreement', 'Apprenticeship-WrittenAgreement V1.1 (2).pdf', 'assets/documents/Apprenticeship-WrittenAgreement V1.1 (2).pdf'],
  ['apprenticeship_agreement', 'Apprenticeship Agreement', 'ApprenticeshipAgreement-Apprenticeship Agreement v5 (3).pdf', 'assets/documents/ApprenticeshipAgreement-Apprenticeship Agreement v5 (3).pdf']
];

async function seedDocumentTemplatesFromDisk() {
  if (!State.postgresPool) return;
  for (const [key, title, filename, assetPath] of APPLICATION_DOCUMENT_TEMPLATES) {
    const filePath = path.join(Config.ROOT, assetPath || filename);
    let content = null;
    try {
      content = await fs.promises.readFile(filePath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      continue;
    }
    await State.postgresPool.query(
      `insert into app_document_templates (key, title, filename, content_type, content, updated_at)
       values ($1, $2, $3, $4, $5, now())
       on conflict (key) do update set
         title = excluded.title,
         filename = excluded.filename,
         content_type = excluded.content_type,
         content = excluded.content,
         updated_at = now()`,
      [key, title, filename, 'application/pdf', content]
    );
  }
}

function applicationRequirements(appId, files = [], options = {}) {
  const byKey = new Map((Array.isArray(files) ? files : []).map(file => [String(file.key || ''), file]));
  return APPLICATION_DOCUMENT_TEMPLATES.map(([key, title], index) => {
    const file = byKey.get(key);
    return {
      id: `R-${appId}-${index + 1}`,
      key,
      title,
      latest: file?.content_base64 ? {
        id: `ER-${appId}-${index + 1}-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
        filename: String(file.filename || title),
        version: 1,
        status: options.verified ? 'Verified' : 'Pending',
        reviewer: options.verified ? options.reviewer || null : null,
        reviewed_at: options.verified ? new Date().toISOString() : null,
        content_base64: file.content_base64
      } : null
    };
  });
}

function applicationLearnerFromBody(body) {
  if (!body.already_enrolled) return null;
  return {
    external_reference: body.learner_reference || body.external_reference || 'Already enrolled',
    enrolled_at: body.enrolled_at || new Date().toISOString(),
    note: body.enrolment_note || 'Added as an existing enrolled learner.'
  };
}

function isEnrolledStage(stage) {
  return String(stage || '').trim().toLowerCase() === 'enrolled';
}

function automaticEnrolledLearner(lead, now = new Date().toISOString()) {
  return {
    external_reference: lead.learner_reference || lead.external_reference || `AUTO-${lead.id}`,
    enrolled_at: lead.enrolled_at || now,
    note: 'Application created automatically because the lead is enrolled.'
  };
}

function automaticApplicationFromLead(appId, lead, user, now = new Date().toISOString()) {
  const learner = automaticEnrolledLearner(lead, now);
  return {
    id: appId,
    lead_id: lead.id,
    first_name: lead.first_name,
    last_name: lead.last_name,
    programme: lead.programme,
    intake: lead.intake || 'Next intake',
    status: 'Enrolled',
    manager: user?.name || lead.owner || 'System',
    member: lead.first_name,
    created_at: now,
    contract: { status: 'Verified', note: 'Lead was already enrolled; application was created automatically.' },
    requirements: applicationRequirements(appId, [], { verified: true, reviewer: user?.name || 'System' }),
    learner
  };
}

const automaticApplicationFromEnrolledLead = automaticApplicationFromLead;

async function ensureApplicationForLeadFastDb(client, lead, user, options = {}) {
  if (!Config.AUTO_CREATE_APPLICATIONS_FOR_ENROLLED_LEADS || !lead?.id || !isEnrolledStage(lead.stage)) return null;
  await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`auto-application:${lead.id}`]);
  const existing = await client.query(`select data from app_applications where lead_id = $1 limit 1`, [lead.id]);
  if (existing.rows[0]) return null;
  const now = options.now || new Date().toISOString();
  const appId = await Storage.nextPostgresId(client, 'app_applications', 'A');
  const app = automaticApplicationFromLead(appId, lead, user, now);
  await client.query(
    `insert into app_applications (id, lead_id, first_name, last_name, programme, intake, status, manager, member, created_at, contract, requirements, learner, data)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb)`,
    [app.id, app.lead_id, app.first_name, app.last_name, app.programme, app.intake, app.status, app.manager, app.member, app.created_at, jsonValue(app.contract), jsonValue(app.requirements), jsonValue(app.learner), jsonValue(app)]
  );
  const snapshot = { first_touch: lead.source_first_touch, lead_capture: lead.source_lead_capture, conversion_source: lead.source_lead_capture };
  const attribution = { ...lead, programme: app.programme, snapshot };
  await client.query(
    `insert into app_attribution (lead_id, email, programme, data) values ($1, $2, $3, $4::jsonb)`,
    [lead.id, lead.email, app.programme, jsonValue(attribution)]
  );
  await Audit.appendAuditFast(client, user || { name: 'System' }, options.auditAction || 'Application auto-created for lead', 'lead', lead.id, app.id);
  return { application: app, attribution };
}

const ensureApplicationForEnrolledLeadFastDb = ensureApplicationForLeadFastDb;

async function createApplicationFastDb(body, user) {
  if (!State.postgresPool) return null;
  await Storage.ensureStorage();
  const client = await State.postgresPool.connect();
  try {
    await client.query('begin');
    const leadResult = await client.query(`select data from app_leads where id = $1 for update`, [body.lead_id]);
    const lead = leadResult.rows[0]?.data;
    if (!lead) throw Http.statusError(404, 'Lead not found.');
    const intakeResult = body.intake_id
      ? await client.query(`select data from app_intakes where id = $1 limit 1`, [body.intake_id])
      : { rows: [] };
    const intake = intakeResult.rows[0]?.data || null;
    const now = new Date().toISOString();
    const appId = await Storage.nextPostgresId(client, 'app_applications', 'A');
    const learner = applicationLearnerFromBody(body);
    const alreadyEnrolled = Boolean(learner);
    const documentsNeedSignature = Boolean(body.documents_need_signature);
    const evidenceVerified = alreadyEnrolled && !documentsNeedSignature;
    const app = {
      id: appId,
      lead_id: lead.id,
      first_name: lead.first_name,
      last_name: lead.last_name,
      programme: lead.programme,
      intake: intake?.name || 'Next intake',
      status: alreadyEnrolled ? 'Enrolled' : 'In review',
      manager: user.name,
      member: lead.first_name,
      created_at: now,
      contract: evidenceVerified ? { status: 'Verified', note: 'Existing enrolled learner documents uploaded.' } : { status: 'Draft', note: documentsNeedSignature ? 'Documents uploaded for learner signature.' : undefined },
      requirements: applicationRequirements(appId, body.evidence_files, { verified: evidenceVerified, reviewer: user.name }),
      learner
    };
    lead.stage = alreadyEnrolled ? 'Enrolled' : 'Application Submitted';
    await client.query(
      `update app_leads set stage = $2, data = $3::jsonb where id = $1`,
      [lead.id, lead.stage, jsonValue(lead)]
    );
    await client.query(
      `insert into app_applications (id, lead_id, first_name, last_name, programme, intake, status, manager, member, created_at, contract, requirements, learner, data)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb)`,
      [app.id, app.lead_id, app.first_name, app.last_name, app.programme, app.intake, app.status, app.manager, app.member, app.created_at, jsonValue(app.contract), jsonValue(app.requirements), jsonValue(app.learner), jsonValue(app)]
    );
    let attribution = null;
    if (alreadyEnrolled) {
      const snapshot = { first_touch: lead.source_first_touch, lead_capture: lead.source_lead_capture, conversion_source: lead.source_lead_capture };
      attribution = { ...lead, programme: app.programme, snapshot };
      await client.query(
        `insert into app_attribution (lead_id, email, programme, data) values ($1, $2, $3, $4::jsonb)`,
        [lead.id, lead.email, app.programme, jsonValue(attribution)]
      );
    }
    const audit = {
      id: `AU-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      occurred_at: now,
      actor: user.name,
      action: alreadyEnrolled ? 'Existing learner enrolled' : 'Application started',
      entity: 'lead',
      entity_id: lead.id
    };
    await client.query(
      `insert into app_audit (id, occurred_at, actor, action, entity, entity_id, data)
       values ($1, $2::timestamptz, $3, $4, $5, $6, $7::jsonb)`,
      [audit.id, audit.occurred_at, audit.actor, audit.action, audit.entity, audit.entity_id, jsonValue(audit)]
    );
    await client.query('commit');
    State.dbCache = null;
    return { ok: true, application: publicApplication(app), lead, attribution };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function uploadEvidenceFastDb(id, body) {
  if (!State.postgresPool) return null;
  await Storage.ensureStorage();
  const client = await State.postgresPool.connect();
  try {
    await client.query('begin');
    const result = await client.query(`select data from app_applications where id = $1 for update`, [id]);
    const app = result.rows[0]?.data;
    if (!app) throw Http.statusError(404, 'Application not found.');
    const req = (app.requirements || []).find(item => item.id === body.requirement_id);
    if (!req) throw Http.statusError(404, 'Requirement not found.');
    req.latest = {
      id: `ER-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      filename: body.filename,
      version: (req.latest?.version || 0) + 1,
      status: 'Pending',
      reviewer: null,
      content_base64: body.content_base64
    };
    if (!app.learner) app.status = 'In review';
    await client.query(
      `update app_applications set status = $2, requirements = $3::jsonb, data = $4::jsonb where id = $1`,
      [app.id, app.status, jsonValue(app.requirements || []), jsonValue(app)]
    );
    await client.query('commit');
    State.dbCache = null;
    return { ok: true, application: publicApplication(app) };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function sendEvidenceFileFastDb(id, res) {
  if (!State.postgresPool) return false;
  await Storage.ensureStorage();
  const result = await State.postgresPool.query(
    `select data from app_applications
     where jsonb_path_exists(requirements, '$[*].latest ? (@.id == $evidence_id)', jsonb_build_object('evidence_id', $1::text))
     limit 1`,
    [id]
  );
  const app = result.rows[0]?.data;
  const req = (app?.requirements || []).find(item => item.latest?.id === id);
  if (!req?.latest?.content_base64) throw Http.statusError(404, 'Evidence not found.');
  const filename = String(req.latest.filename || 'evidence-file').replace(/[\r\n"]/g, '_');
  const content = Buffer.from(req.latest.content_base64 || '', 'base64');
  res.writeHead(200, {
    'Content-Type': StaticFiles.mime[path.extname(filename).toLowerCase()] || 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${filename}"`
  });
  res.end(content);
  return true;
}

async function sendDocumentTemplateFile(key, res) {
  const template = APPLICATION_DOCUMENT_TEMPLATES.find(([itemKey]) => itemKey === key);
  if (!template) throw Http.statusError(404, 'Document template not found.');
  await Storage.ensureStorage();
  if (State.postgresPool) {
    const result = await State.postgresPool.query(
      `select title, filename, content_type, content from app_document_templates where key = $1 limit 1`,
      [key]
    );
    const row = result.rows[0];
    if (!row) throw Http.statusError(404, 'Document template not found.');
    const filename = String(row.filename || template[2]).replace(/[\r\n"]/g, '_');
    res.writeHead(200, {
      'Content-Type': row.content_type || 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, max-age=300'
    });
    res.end(row.content);
    return true;
  }
  const filename = template[2];
  const filePath = path.resolve(Config.ROOT, template[3] || filename);
  const rootPath = path.resolve(Config.ROOT);
  if (filePath !== rootPath && !filePath.startsWith(`${rootPath}${path.sep}`)) throw Http.statusError(404, 'Document template not found.');
  const content = await fs.promises.readFile(filePath).catch(() => null);
  if (!content) throw Http.statusError(404, 'Document template not found.');
  res.writeHead(200, {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${filename.replace(/[\r\n"]/g, '_')}"`,
    'Cache-Control': 'private, max-age=300'
  });
  res.end(content);
  return true;
}

async function reviewEvidenceFastDb(id, body, user) {
  if (!State.postgresPool) return null;
  await Storage.ensureStorage();
  const client = await State.postgresPool.connect();
  try {
    await client.query('begin');
    const result = await client.query(
      `select data from app_applications
       where jsonb_path_exists(requirements, '$[*].latest ? (@.id == $evidence_id)', jsonb_build_object('evidence_id', $1::text))
       limit 1 for update`,
      [id]
    );
    const app = result.rows[0]?.data;
    if (!app) throw Http.statusError(404, 'Evidence not found.');
    const req = (app.requirements || []).find(item => item.latest?.id === id);
    if (!req?.latest) throw Http.statusError(404, 'Evidence not found.');
    req.latest.status = body.status;
    req.latest.reviewer = user.name;
    req.latest.review_note = body.note;
    await client.query(
      `update app_applications set requirements = $2::jsonb, data = $3::jsonb where id = $1`,
      [app.id, jsonValue(app.requirements || []), jsonValue(app)]
    );
    await client.query('commit');
    State.dbCache = null;
    return { ok: true, application: publicApplication(app), evidence: { ...req.latest, content_base64: undefined } };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function reviewApplicationFastDb(id, body, user) {
  if (!State.postgresPool) return null;
  await Storage.ensureStorage();
  const client = await State.postgresPool.connect();
  try {
    await client.query('begin');
    const appResult = await client.query(`select data from app_applications where id = $1 for update`, [id]);
    const app = appResult.rows[0]?.data;
    if (!app) throw Http.statusError(404, 'Application not found.');
    const leadResult = await client.query(`select data from app_leads where id = $1 for update`, [app.lead_id]);
    const lead = leadResult.rows[0]?.data;
    if (!lead) throw Http.statusError(404, 'Lead not found.');
    app.status = body.status;
    lead.stage = body.status === 'Eligible' ? 'Ready for Enrolment' : 'Not Eligible';
    await client.query(`update app_applications set status = $2, data = $3::jsonb where id = $1`, [app.id, app.status, jsonValue(app)]);
    await client.query(`update app_leads set stage = $2, data = $3::jsonb where id = $1`, [lead.id, lead.stage, jsonValue(lead)]);
    await Audit.appendAuditFast(client, user, 'Eligibility decision', 'lead', lead.id, body.status);
    await client.query('commit');
    State.dbCache = null;
    return { ok: true, application: publicApplication(app), lead };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function enrolApplicationFastDb(id, body, user) {
  if (!State.postgresPool) return null;
  await Storage.ensureStorage();
  const client = await State.postgresPool.connect();
  try {
    await client.query('begin');
    const appResult = await client.query(`select data from app_applications where id = $1 for update`, [id]);
    const app = appResult.rows[0]?.data;
    if (!app) throw Http.statusError(404, 'Application not found.');
    const leadResult = await client.query(`select data from app_leads where id = $1 for update`, [app.lead_id]);
    const lead = leadResult.rows[0]?.data;
    if (!lead) throw Http.statusError(404, 'Lead not found.');
    app.status = 'Enrolled';
    app.learner = { external_reference: body.external_reference, enrolled_at: new Date().toISOString(), note: body.note };
    lead.stage = 'Enrolled';
    const snapshot = { first_touch: lead.source_first_touch, lead_capture: lead.source_lead_capture, conversion_source: lead.source_lead_capture };
    const attribution = { ...lead, programme: app.programme, snapshot };
    await client.query(`update app_applications set status = $2, learner = $3::jsonb, data = $4::jsonb where id = $1`, [app.id, app.status, jsonValue(app.learner), jsonValue(app)]);
    await client.query(`update app_leads set stage = $2, data = $3::jsonb where id = $1`, [lead.id, lead.stage, jsonValue(lead)]);
    await client.query(
      `insert into app_attribution (lead_id, email, programme, data) values ($1, $2, $3, $4::jsonb)`,
      [lead.id, lead.email, app.programme, jsonValue(attribution)]
    );
    await Audit.appendAuditFast(client, user, 'Learner enrolled', 'lead', lead.id, body.external_reference);
    await client.query('commit');
    State.dbCache = null;
    return { ok: true, application: publicApplication(app), lead, attribution };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function deleteApplicationFastDb(id, user) {
  if (!State.postgresPool) return null;
  await Storage.ensureStorage();
  const client = await State.postgresPool.connect();
  try {
    await client.query('begin');
    const result = await client.query(`select data from app_applications where id = $1 for update`, [id]);
    const app = result.rows[0]?.data;
    if (!app) throw Http.statusError(404, 'Application not found.');
    let lead = null;
    if (app.lead_id) {
      const leadResult = await client.query(`select data from app_leads where id = $1 for update`, [app.lead_id]);
      lead = leadResult.rows[0]?.data || null;
      if (lead && ['Application Submitted', 'Eligibility', 'Ready for Enrolment', 'Not Eligible', 'Enrolled'].includes(lead.stage)) {
        lead.stage = 'Qualified';
        await client.query(`update app_leads set stage = $2, data = $3::jsonb where id = $1`, [lead.id, lead.stage, jsonValue(lead)]);
      }
    }
    await client.query(`delete from app_attribution where lead_id = $1 and programme = $2`, [app.lead_id, app.programme]);
    await client.query(`delete from app_applications where id = $1`, [id]);
    await Audit.appendAuditFast(client, user, 'Application deleted', 'lead', app.lead_id || id, app.programme);
    await client.query('commit');
    State.dbCache = null;
    return { ok: true, deleted: { applications: [id] }, lead };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function deleteEvidenceFastDb(id, user) {
  if (!State.postgresPool) return null;
  await Storage.ensureStorage();
  const client = await State.postgresPool.connect();
  try {
    await client.query('begin');
    const result = await client.query(
      `select data from app_applications
       where jsonb_path_exists(requirements, '$[*].latest ? (@.id == $evidence_id)', jsonb_build_object('evidence_id', $1::text))
       limit 1 for update`,
      [id]
    );
    const app = result.rows[0]?.data;
    if (!app) throw Http.statusError(404, 'Evidence not found.');
    const req = (app.requirements || []).find(item => item.latest?.id === id);
    if (!req?.latest) throw Http.statusError(404, 'Evidence not found.');
    const filename = req.latest.filename;
    req.latest = null;
    app.status = (app.requirements || []).some(item => item.latest?.status === 'Pending') ? 'In review' : app.status;
    await client.query(
      `update app_applications set status = $2, requirements = $3::jsonb, data = $4::jsonb where id = $1`,
      [app.id, app.status, jsonValue(app.requirements || []), jsonValue(app)]
    );
    await Audit.appendAuditFast(client, user, 'Evidence deleted', 'application', app.id, filename);
    await client.query('commit');
    State.dbCache = null;
    return { ok: true, application: publicApplication(app), deleted: { evidence: [id] } };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

let leadApplicationBackfillRunning = false;

async function runEnrolledLeadApplicationBackfill() {
  if (!Config.ENROLLED_LEAD_APPLICATION_BACKFILL_ENABLED || leadApplicationBackfillRunning) return;
  leadApplicationBackfillRunning = true;
  let created = 0;
  try {
    await Storage.ensureStorage();
    if (!State.postgresPool || !Storage.usesPostgresStorage()) {
      const db = await Storage.loadDb();
      db.applications ||= [];
      db.leads ||= [];
      db.audit ||= [];
      const leadById = new Map(db.leads.map(lead => [String(lead.id), lead]));
      const beforeCleanup = db.applications.length;
      db.applications = db.applications.filter(app => {
        const lead = leadById.get(String(app.lead_id));
        const autoDraft = app?.contract?.note === 'Application created automatically from lead.' && !app?.learner;
        return !(autoDraft && lead && !isEnrolledStage(lead.stage));
      });
      const missingLeads = db.leads
        .filter(lead => lead?.id && !lead.deleted_at && isEnrolledStage(lead.stage))
        .filter(lead => !db.applications.some(app => String(app.lead_id) === String(lead.id)))
        .slice(0, Config.ENROLLED_LEAD_APPLICATION_BACKFILL_LIMIT);
      for (const lead of missingLeads) {
        const appId = Util.nextId('A', [db.applications]);
        const app = automaticApplicationFromLead(appId, lead, { name: 'System' });
        db.applications.push(app);
        db.attribution ||= [];
        db.attribution.unshift({ ...lead, programme: app.programme, snapshot: { first_touch: lead.source_first_touch, lead_capture: lead.source_lead_capture, conversion_source: lead.source_lead_capture } });
        Audit.addAudit(db, { name: 'System' }, 'Application auto-created during lead backfill', 'lead', lead.id, app.id);
        created += 1;
      }
      if (created || beforeCleanup !== db.applications.length) {
        await Storage.saveDb(db);
        console.log(`Lead application backfill created ${created} local application(s).`);
      }
      return created;
    }
    const cleanup = await State.postgresPool.query(
      `delete from app_applications a
       using app_leads l
       where a.lead_id = l.id
         and a.data->'contract'->>'note' = 'Application created automatically from lead.'
         and coalesce(a.data->'learner', 'null'::jsonb) = 'null'::jsonb
         and lower(coalesce(l.stage, l.data->>'stage', '')) <> 'enrolled'`
    );
    if (cleanup.rowCount) {
      State.dbCache = null;
      console.log(`Lead application backfill removed ${cleanup.rowCount} non-enrolled auto-created application(s).`);
    }
    const result = await State.postgresPool.query(
      `select l.id
       from app_leads l
       where ${Leads.activeLeadCondition('l')}
         and lower(coalesce(l.stage, l.data->>'stage', '')) = 'enrolled'
         and not exists (select 1 from app_applications a where a.lead_id = l.id)
       order by l.created_at nulls last, l.id
       limit $1`,
      [Config.ENROLLED_LEAD_APPLICATION_BACKFILL_LIMIT]
    );
    for (const row of result.rows) {
      const client = await State.postgresPool.connect();
      try {
        await client.query('begin');
        const leadResult = await client.query(`select data from app_leads where id = $1 for update`, [row.id]);
        const lead = leadResult.rows[0]?.data;
        const auto = await ensureApplicationForLeadFastDb(client, lead, { name: 'System' }, {
          auditAction: 'Application auto-created during lead backfill'
        });
        if (auto) created += 1;
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        console.error(`Lead application backfill failed for ${row.id}: ${error.message || error}`);
      } finally {
        client.release();
      }
    }
    if (created) {
      State.dbCache = null;
      console.log(`Lead application backfill created ${created} application(s).`);
    } else if (result.rows.length) {
      console.log('Lead application backfill found no missing applications after locking leads.');
    } else {
      console.log('Lead application backfill found no leads missing applications.');
    }
  } catch (error) {
    console.error(`Lead application backfill failed: ${error.message || error}`);
  } finally {
    leadApplicationBackfillRunning = false;
  }
  return created;
}

exports.jsonValue = jsonValue;
exports.publicApplication = publicApplication;
exports.loadApplicationListDb = loadApplicationListDb;
exports.seedDocumentTemplatesFromDisk = seedDocumentTemplatesFromDisk;
exports.applicationRequirements = applicationRequirements;
exports.applicationLearnerFromBody = applicationLearnerFromBody;
exports.isEnrolledStage = isEnrolledStage;
exports.automaticApplicationFromLead = automaticApplicationFromLead;
exports.ensureApplicationForLeadFastDb = ensureApplicationForLeadFastDb;
exports.createApplicationFastDb = createApplicationFastDb;
exports.uploadEvidenceFastDb = uploadEvidenceFastDb;
exports.sendEvidenceFileFastDb = sendEvidenceFileFastDb;
exports.sendDocumentTemplateFile = sendDocumentTemplateFile;
exports.reviewEvidenceFastDb = reviewEvidenceFastDb;
exports.reviewApplicationFastDb = reviewApplicationFastDb;
exports.enrolApplicationFastDb = enrolApplicationFastDb;
exports.deleteApplicationFastDb = deleteApplicationFastDb;
exports.deleteEvidenceFastDb = deleteEvidenceFastDb;
exports.runEnrolledLeadApplicationBackfill = runEnrolledLeadApplicationBackfill;
