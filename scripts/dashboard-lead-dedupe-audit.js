const fs = require('fs');

const server = fs.readFileSync('server.js', 'utf8');
const app = fs.readFileSync('app.js', 'utf8');

function assert(condition, message) {
  if (!condition) {
    console.error(`Dashboard lead dedupe audit failed: ${message}`);
    process.exit(1);
  }
}

const summaryStart = server.indexOf('async function loadDashboardSummaryDb()');
const cockpitStart = server.indexOf('async function loadDashboardCockpitSummaryDb');
const pipelineStart = server.indexOf('async function loadDashboardPipelineDb');
const sourceStart = server.indexOf('async function loadDashboardSourcePerformanceDb');

assert(server.includes('function dashboardLeadIdentitySql'), 'missing dashboard lead identity helper');
assert(server.includes("data->>'zoho_record_id'"), 'identity helper must include Zoho record id');
assert(server.includes("data->>'crm_lead_id'"), 'identity helper must include CRM lead id');
assert(server.includes('function uniqueLeadsByIdentity'), 'local dashboard fallback must dedupe leads');

assert(summaryStart !== -1, 'missing dashboard summary loader');
assert(server.slice(summaryStart, cockpitStart).includes('dashboardDistinctLeadRowsSql()'), 'summary totals must use distinct lead rows');
assert(server.slice(cockpitStart, pipelineStart).includes("count(distinct ${dashboardLeadIdentitySql('l')})"), 'dashboard KPIs must count distinct lead identities');
assert(server.slice(pipelineStart, sourceStart).includes("count(distinct ${dashboardLeadIdentitySql('l')})"), 'pipeline widget must count distinct lead identities');
assert(server.slice(sourceStart, server.indexOf('function dashboardIntegrationRow', sourceStart)).includes("count(distinct ${dashboardLeadIdentitySql('l')})"), 'source widget must count distinct lead identities');

assert(app.includes('function uniqueClientLeads'), 'client fallback must expose lead dedupe helper');
assert(app.includes('uniqueLeads=uniqueClientLeads(d.leads)'), 'client derived stats must use unique leads');
assert(app.includes('leadsTotal:d?num(d.leads?.total'), 'dashboard total must prefer database aggregate');

console.log('Dashboard lead dedupe audit passed.');
