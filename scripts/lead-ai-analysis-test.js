'use strict';

// Isolated public API checks: no .env, live provider calls, database reads or writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../server/lead-ai-analysis.js'), 'utf8');
const questions = ['eq-residency', 'eq-immigration', 'eq-other-funding', 'eq-employment-type',
  'eq-paid-hours', 'eq-employer-england', 'eq-hours-england'];
const quote = 'I work for Example Ltd and I am interested in an apprenticeship.';
const user = { id: 'test-reviewer' };
const lead = extra => ({ id: 'test-lead', name: 'Alex', stage: 'New lead', ...extra });
const incoming = (body = quote, extra = {}) => ({ lead_id: 'test-lead', direction: 'inbound', body, ...extra });
const modelResult = extra => ({ contact_type: 'learner', funding_status: 'Information Required', confidence: 0.9,
  commercial_recommended: false, referral_reason: '', suggested_programme: 'CMI Level 6 - Commercial',
  summary: 'The contact is interested in an apprenticeship; screening information is incomplete.',
  reasons: ['The sender states their own interest.'], missing_information: ['Complete the screening checklist.'],
  evidence: [quote], screening_checks: [], ...extra });
const checklist = () => ({ responses: questions.map(questionId => ({ questionId,
  answer: questionId === 'eq-other-funding' ? 'No' : 'Yes', evidence: 'Verified', notes: '',
  ...(questionId === 'eq-paid-hours' ? { weeklyHours: 37.5 } : {}) })) });

function harness({ result, payload, httpError, archived = false, postgres = false } = {}) {
  let saves = 0;
  let audits = 0;
  let captured;
  const queries = [];
  const client = { query: async (sql, args) => {
    queries.push({ sql, args });
    if (/select data from app_leads/.test(sql)) return { rows: [{ data: db.leads[0] }] };
    return { rows: [] };
  }, release() {} };
  const state = postgres ? { postgresPool: {
    query: async sql => {
      if (/app_leads/.test(sql)) return { rows: [{ data: db.leads[0] }] };
      if (/app_emails/.test(sql)) return { rows: db.emails.map(data => ({ data })) };
      return { rows: [] };
    }, connect: async () => client
  }, dbCache: {} } : {};
  const stubs = {
    './state': state,
    './storage': { ensureStorage: async () => {}, saveDb: async () => { saves++; } },
    './audit': { addAudit: () => { audits++; }, appendAuditFast: async () => { audits++; } },
    './applications': { jsonValue: JSON.stringify }
  };
  const sandbox = {
    require: name => { assert(Object.hasOwn(stubs, name), `Unexpected dependency: ${name}`); return stubs[name]; },
    process: { env: result || payload || httpError || archived ? { OPENAI_API_KEY: 'test-only-key' } : {} },
    exports: {},
    fetch: async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      captured = JSON.parse(options.body);
      return { ok: !httpError && !archived, status: archived ? 403 : httpError ? 503 : 200,
        json: async () => archived ? { error: { message: 'Project is archived' } }
          : httpError ? { error: { message: httpError } }
            : payload || { status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(result) }] }] } };
    }
  };
  vm.runInNewContext(source, sandbox, { filename: 'lead-ai-analysis.js' });
  const db = { leads: [lead()], emails: [], audit: [] };
  return { db, queries, state,
    run: async (options = { apply: false }) => postgres
      ? sandbox.exports.analyseLeadFastDb('test-lead', user, options)
      : sandbox.exports.analyseLeadWorkspace(db, 'test-lead', user, options),
    get saves() { return saves; }, get audits() { return audits; }, get request() { return captured; }
  };
}

async function main() {
  let passed = 0;
  const check = async (name, fn) => { await fn(); passed++; console.log(`PASS ${name}`); };

  for (const name of ['Chris', 'Shreya', 'HR Training Ltd']) {
    await check(`names do not classify contacts: ${name}`, async () => {
      const h = harness(); h.db.leads[0].name = name;
      const { analysis } = await h.run();
      assert.equal(analysis.contact_type, 'unknown');
      assert.equal(analysis.confidence, 0);
      assert.equal(analysis.funding_status, 'Information Required');
      assert.equal(h.saves, 0);
    });
  }
  for (const body of ['I am not unemployed. I work for a company.', 'I work less than 16 hours.',
    'I am self-employed.', 'I have a visa.', 'I work full time, 37.5 hours and have right to work.']) {
    await check(`fallback abstains from final decisions: ${body}`, async () => {
      const h = harness(); h.db.emails = [incoming(body)];
      const { analysis } = await h.run();
      assert.equal(analysis.funding_status, 'Review Required');
      assert.equal(analysis.commercial_recommended, false);
      assert.equal(analysis.confidence, 0);
    });
  }
  await check('outgoing guidance is not a fact about the contact', async () => {
    const h = harness(); h.db.emails = [incoming('Our employees may be unemployed or outside England.', { direction: 'outbound' })];
    const { analysis } = await h.run();
    assert.equal(analysis.contact_type, 'unknown');
    assert.equal(analysis.funding_status, 'Information Required');
  });
  await check('unknown message direction cannot identify the sender', async () => {
    const h = harness(); h.db.emails = [incoming(quote, { direction: '' })];
    assert.equal((await h.run()).analysis.contact_type, 'unknown');
  });
  await check('prior AI conclusions and audit entries are excluded', async () => {
    const h = harness({ result: modelResult() });
    h.db.leads[0].eligibility = { status: 'Not Eligible for Funding', aiRecommendation: { summary: 'unemployed' } };
    h.db.audit = [{ entity: 'lead', entity_id: 'test-lead', action: 'AI lead analysis recorded', summary: 'Not eligible for funding' }];
    await h.run();
    const context = JSON.parse(h.request.input[1].content[0].text.split('\n\n')[1]);
    assert.equal(context.lead.current_eligibility.aiRecommendation, undefined);
    assert.equal(context.lead.current_eligibility.status, undefined);
    assert.equal(context.timeline.length, 0);
  });
  await check('newest messages selected without changing stored order; body beats preview', async () => {
    const h = harness({ result: modelResult() });
    h.db.emails = Array.from({ length: 10 }, (_, i) => incoming(`message-${i}`, {
      received_at: `2026-10-${String(i + 1).padStart(2, '0')}T10:00:00Z`, snippet: 'short preview'
    }));
    await h.run();
    const context = JSON.parse(h.request.input[1].content[0].text.split('\n\n')[1]);
    assert.equal(context.emails.length, 8);
    assert.equal(context.emails[0].snippet, 'message-9');
    assert.equal(h.db.emails[0].body, 'message-0');
    assert.equal(h.request.text.format.strict, true);
  });
  await check('quoted replies are excluded', async () => {
    const h = harness(); h.db.emails = [incoming('Thank you.\n> Our employees need funding.\nOn Monday, HR wrote:\nI am interested in my apprenticeship.')];
    assert.equal((await h.run()).analysis.contact_type, 'unknown');
  });
  await check('grounded classification survives normalization', async () => {
    const h = harness({ result: modelResult() }); h.db.emails = [incoming()];
    const { analysis } = await h.run();
    assert.equal(analysis.contact_type, 'learner');
    assert.equal(analysis.evidence[0], quote);
    assert.equal(analysis.confidence, 0.9);
  });
  for (const evidence of [[], ['An invented supporting quote.']]) {
    await check(`unsupported evidence cannot support classification: ${JSON.stringify(evidence)}`, async () => {
      const h = harness({ result: modelResult({ evidence, funding_status: 'Provisionally Eligible', missing_information: [] }) });
      h.db.emails = [incoming()];
      const { analysis } = await h.run();
      assert.equal(analysis.contact_type, 'unknown');
      assert.equal(analysis.funding_status, 'Information Required');
      assert.equal(analysis.confidence, 0);
      assert(analysis.missing_information.length);
    });
  }
  await check('outgoing quotes cannot support model classification', async () => {
    const h = harness({ result: modelResult() }); h.db.emails = [incoming(quote, { direction: 'outbound' })];
    assert.equal((await h.run()).analysis.contact_type, 'unknown');
  });
  for (const confidence of [0, 0.4]) {
    await check(`low confidence remains low: ${confidence}`, async () => {
      const h = harness({ result: modelResult({ confidence }) }); h.db.emails = [incoming()];
      const { analysis } = await h.run();
      assert.equal(analysis.confidence, confidence);
      assert.equal(analysis.contact_type, 'unknown');
    });
  }
  await check('one positive message cannot establish provisional eligibility', async () => {
    const h = harness({ result: modelResult({ funding_status: 'Provisionally Eligible', missing_information: [] }) });
    h.db.emails = [incoming()];
    assert.equal((await h.run()).analysis.funding_status, 'Review Required');
  });
  await check('complete verified checklist permits grounded provisional screening', async () => {
    const h = harness({ result: modelResult({ funding_status: 'Provisionally Eligible', missing_information: [] }) });
    h.db.emails = [incoming()]; h.db.leads[0].eligibility = checklist();
    assert.equal((await h.run()).analysis.funding_status, 'Provisionally Eligible');
    const context = JSON.parse(h.request.input[1].content[0].text.split('\n\n')[1]);
    assert.equal(context.lead.current_eligibility.responses.find(item => item.questionId === 'eq-paid-hours').weeklyHours, 37.5);
  });
  const facts = ['I have lived in the UK for the past three years.', 'I have permission to work in the UK.',
    'I am not undertaking any other government-funded training.', 'I am employed by Example Ltd as an employee.',
    'I work 37.5 paid hours each week in England.', 'My employer is based in England and has an Apprenticeship Service account.',
    'All my working hours take place in England.'];
  const checks = () => questions.map((question_id, index) => ({ question_id, assessment: 'met', evidence: [facts[index]] }));
  await check('complete direct evidence permits provisional screening without manual checklist', async () => {
    const h = harness({ result: modelResult({ funding_status: 'Provisionally Eligible', missing_information: [], screening_checks: checks() }) });
    h.db.emails = [incoming([quote, ...facts].join('\n'))];
    const { analysis } = await h.run({ apply: true });
    assert.equal(analysis.funding_status, 'Provisionally Eligible');
    assert.equal(h.db.leads[0].eligibility.aiRecommendation.screening_checks.length, 7);
    assert.equal(h.db.leads[0].eligibility.decision, undefined);
  });
  for (const transform of [rows => rows.slice(1), rows => [...rows, rows[0]],
    rows => rows.map((row, index) => index ? row : { ...row, assessment: 'unknown', evidence: [] }),
    rows => rows.map((row, index) => index ? row : { ...row, evidence: ['Invented evidence not supplied by the contact.'] })]) {
    await check('incomplete, duplicate or unsupported criterion prevents positive recommendation', async () => {
      const h = harness({ result: modelResult({ funding_status: 'Provisionally Eligible', missing_information: [], screening_checks: transform(checks()) }) });
      h.db.emails = [incoming([quote, ...facts].join('\n'))];
      assert.equal((await h.run()).analysis.funding_status, 'Review Required');
    });
  }
  const negativeQuote = 'My current government-funded training conflicts with this apprenticeship.';
  const negativeResult = () => modelResult({ funding_status: 'Not Eligible for Funding', missing_information: [],
    reasons: ['Conflicting government-funded training is explicitly reported.'], evidence: [negativeQuote],
    screening_checks: [{ question_id: 'eq-other-funding', assessment: 'not_met', evidence: [negativeQuote] }] });
  await check('supported negative recommendation is visible without becoming a verified rejection', async () => {
    const h = harness({ result: negativeResult() }); h.db.emails = [incoming(negativeQuote)];
    const result = await h.run({ apply: true });
    assert.equal(result.analysis.funding_status, 'Not Eligible for Funding');
    assert.equal(result.lead.eligibility.aiRecommendation.status, 'Not Eligible for Funding');
    assert.equal(result.lead.eligibility.decision, undefined);
    assert.equal(result.lead.stage, 'New lead');
    assert.equal(result.commercial_created, false);
  });
  for (const extra of [{ confidence: 0.7 }, { reasons: [] }, { missing_information: ['Clarify the possible funding exception.'] },
    { screening_checks: [] }, { screening_checks: [{ question_id: 'eq-other-funding', assessment: 'not_met', evidence: ['An invented quote that was not supplied.'] }] }]) {
    await check('uncertain or unsupported negative recommendation requires review', async () => {
      const h = harness({ result: { ...negativeResult(), ...extra } }); h.db.emails = [incoming(negativeQuote)];
      assert.equal((await h.run()).analysis.funding_status, 'Review Required');
    });
  }
  for (const weeklyHours of [undefined, 0, 16, 29, '37.5']) {
    await check(`missing or reduced weekly hours require review: ${weeklyHours}`, async () => {
      const h = harness({ result: modelResult({ funding_status: 'Provisionally Eligible', missing_information: [] }) });
      h.db.emails = [incoming()]; h.db.leads[0].eligibility = checklist();
      h.db.leads[0].eligibility.responses.find(item => item.questionId === 'eq-paid-hours').weeklyHours = weeklyHours;
      assert.equal((await h.run()).analysis.funding_status, 'Review Required');
    });
  }
  for (const change of [h => { h.db.leads[0].eligibility.responses[0].evidence = 'Received'; },
    h => { h.db.leads[0].eligibility.responses[0].answer = 'Needs Review'; }]) {
    await check('unverified or unresolved checklist requires review', async () => {
      const h = harness({ result: modelResult({ funding_status: 'Provisionally Eligible', missing_information: [] }) });
      h.db.emails = [incoming()]; h.db.leads[0].eligibility = checklist(); change(h);
      assert.equal((await h.run()).analysis.funding_status, 'Review Required');
    });
  }
  await check('outstanding model questions require review even with verified checklist', async () => {
    const h = harness({ result: modelResult({ funding_status: 'Provisionally Eligible' }) });
    h.db.emails = [incoming()]; h.db.leads[0].eligibility = checklist();
    assert.equal((await h.run()).analysis.funding_status, 'Review Required');
  });
  for (const decision of ['Verified Eligible', 'Not Eligible for Funding']) {
    await check(`human decision is preserved: ${decision}`, async () => {
      const h = harness(); h.db.leads[0].eligibility = { ...checklist(), decision, status: decision };
      await h.run({ apply: true });
      assert.equal(h.db.leads[0].eligibility.status, decision);
      assert.equal(h.db.leads[0].eligibility.decision, decision);
      assert.equal(h.db.leads[0].stage, 'New lead');
      assert.equal(h.saves, 1); assert.equal(h.audits, 1);
      assert.equal(h.db.commercialOpportunities, undefined);
    });
  }
  await check('archived provider uses conservative fallback', async () => {
    const h = harness({ archived: true }); h.db.emails = [incoming('I am unemployed.')];
    const { analysis } = await h.run();
    assert.equal(analysis.source, 'heuristic');
    assert.equal(analysis.funding_status, 'Review Required');
    assert.match(analysis.provider_warning, /archived/);
  });
  for (const result of [{}, modelResult({ confidence: '0.9' }), modelResult({ confidence: null }),
    modelResult({ confidence: 2 }), modelResult({ reasons: [42] }), modelResult({ funding_status: 'Verified Eligible' }),
    modelResult({ screening_checks: [{ question_id: 'invented', assessment: 'met', evidence: [quote] }] }),
    modelResult({ suggested_programme: 'Invented course' })]) {
    await check(`invalid model result cannot persist: ${JSON.stringify(result)}`, async () => {
      const h = harness({ result });
      await assert.rejects(h.run({ apply: true }), /invalid/i);
      assert.equal(h.saves, 0); assert.equal(h.audits, 0);
      assert.equal(h.db.leads[0].ai_analysis, undefined);
    });
  }
  for (const payload of [{ status: 'incomplete', output_text: JSON.stringify(modelResult()) },
    { status: 'completed', output: [{ content: [{ type: 'refusal', refusal: 'Cannot classify' }] }] }]) {
    await check('incomplete and refused output cannot persist', async () => {
      const h = harness({ payload }); await assert.rejects(h.run({ apply: true })); assert.equal(h.saves, 0);
    });
  }
  await check('provider failure cannot persist', async () => {
    const h = harness({ httpError: 'Provider unavailable' });
    await assert.rejects(h.run({ apply: true }), /Provider unavailable/); assert.equal(h.saves, 0);
  });
  await check('Postgres preview does not start a transaction', async () => {
    const h = harness({ postgres: true }); const result = await h.run();
    assert.equal(result.applied, false); assert.equal(h.queries.length, 0);
  });
  await check('Postgres apply preserves decisions and commits the analysis', async () => {
    const h = harness({ postgres: true }); h.db.leads[0].eligibility = { decision: 'Verified Eligible', responses: [] };
    const result = await h.run({ apply: true });
    assert.equal(result.lead.eligibility.status, 'Verified Eligible');
    assert.equal(h.queries[0].sql, 'begin');
    assert.equal(h.queries.at(-1).sql, 'commit');
    assert.equal(h.audits, 1); assert.equal(h.state.dbCache, null);
    assert.equal(h.queries.some(({ sql }) => /app_workspace/.test(sql)), false);
  });
  console.log(`${passed} isolated lead AI regression checks passed. These are behavioral checks, not a measured model accuracy score.`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
