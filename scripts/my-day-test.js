'use strict';

const assert = require('node:assert/strict');
const Dashboard = require('../server/dashboard');

const todayStart = '2026-10-12T00:00:00.000Z';
const tomorrowStart = '2026-10-13T00:00:00.000Z';
const userA = { id: 'U-A', name: 'Sales A', role: 'sales' };
const userB = { id: 'U-B', name: 'Sales B', role: 'sales' };

const leadA = {
  id: 'L-A',
  first_name: 'Ahmed',
  last_name: 'Mohamed',
  email: 'ahmed@example.com',
  programme: 'Marketing Executive',
  owner_id: userA.id,
  owner: userA.name,
  stage: 'Qualified',
  priority: 'P1',
  created_at: '2026-09-01T09:00:00.000Z',
  next_action_at: '2026-10-11T09:00:00.000Z'
};
const leadA2 = {
  id: 'L-A2',
  first_name: 'Sarah',
  last_name: 'Jones',
  email: 'sarah@example.com',
  programme: 'Project Management',
  owner_id: userA.id,
  owner: userA.name,
  stage: 'New lead',
  priority: 'P2',
  created_at: '2026-10-11T09:00:00.000Z'
};
const leadB = {
  id: 'L-B',
  first_name: 'Other',
  last_name: 'Owner',
  email: 'other@example.com',
  programme: 'Hidden',
  owner_id: userB.id,
  owner: userB.name,
  stage: 'Qualified',
  priority: 'P0',
  created_at: '2026-09-01T09:00:00.000Z',
  next_action_at: '2026-10-11T09:00:00.000Z'
};

const db = {
  gmail: { email: 'team@kentbusinesscollege.org' },
  leads: [leadA, leadA2, leadB],
  tasks: [
    { id: 'T-A-OLD', title: 'Call Ahmed', lead_id: 'L-A', status: 'Open', kind: 'Call', owner_id: userA.id, due_at: '2026-10-10T09:00:00.000Z', priority: 'P1' },
    { id: 'T-A-TODAY', title: 'Complete employer follow-up', lead_id: 'L-A2', status: 'Open', kind: 'Follow-up', owner_id: userA.id, due_at: '2026-10-12T11:00:00.000Z', priority: 'P2' },
    { id: 'T-B-OLD', title: 'Hidden task', lead_id: 'L-B', status: 'Open', kind: 'Call', owner_id: userB.id, due_at: '2026-10-10T09:00:00.000Z', priority: 'P0' }
  ],
  emails: [
    { id: 'E-A', lead_id: 'L-A', first_name: 'Ahmed', last_name: 'Mohamed', email: 'ahmed@example.com', subject: 'Question', direction: 'inbound', received_at: '2026-10-11T09:00:00.000Z', due_at: '2026-10-13T09:00:00.000Z', response_at: null, gmail_labels: ['UNREAD'], gmail_label_names: ['Unread'] },
    { id: 'E-B', lead_id: 'L-B', first_name: 'Other', last_name: 'Owner', email: 'other@example.com', subject: 'Hidden', direction: 'inbound', received_at: '2026-10-11T09:00:00.000Z', due_at: '2026-10-13T09:00:00.000Z', response_at: null, gmail_labels: ['UNREAD'], gmail_label_names: ['Unread'] }
  ],
  applications: [
    { id: 'A-A', lead_id: 'L-A2', first_name: 'Sarah', last_name: 'Jones', programme: 'Project Management', status: 'In review', created_at: '2026-10-10T09:00:00.000Z', requirements: [{ id: 'R-1', latest: { status: 'Pending' } }] },
    { id: 'A-B', lead_id: 'L-B', first_name: 'Other', last_name: 'Owner', programme: 'Hidden', status: 'In review', created_at: '2026-10-10T09:00:00.000Z', requirements: [{ id: 'R-2', latest: { status: 'Pending' } }] }
  ],
  events: [
    { id: 'EV-A', name: 'Zoom intro', start_at: '2026-10-12T14:00:00.000Z', location: 'Zoom', attendees: [{ id: 'AT-A', lead_id: 'L-A' }] },
    { id: 'EV-B', name: 'Hidden Zoom', start_at: '2026-10-12T15:00:00.000Z', location: 'Zoom', attendees: [{ id: 'AT-B', lead_id: 'L-B' }] }
  ]
};

const payload = Dashboard.loadDashboardMyDayLocal(db, userA, { todayStart, tomorrowStart, provided: true });

assert.equal(payload.scope.owner_id, userA.id, 'My Day is scoped to the signed-in user');
assert.equal(payload.summary.overdue_tasks, 1, 'counts only Sales A overdue tasks');
assert.equal(payload.summary.tasks_due_today, 1, 'counts Sales A tasks due today');
assert.equal(payload.summary.unanswered_emails, 1, 'counts only Sales A unanswered emails');
assert.equal(payload.summary.applications_needing_action, 1, 'counts only Sales A applications needing action');
assert.equal(payload.summary.meetings_today, 1, 'counts only Sales A meetings today');
assert.equal(payload.summary.at_risk_leads, 1, 'counts at-risk owned leads');
assert(payload.priority_actions.length <= 20, 'priority action list is bounded');
assert.equal(new Set(payload.priority_actions.map(action => `${action.type}:${action.entity_id}`)).size, payload.priority_actions.length, 'no duplicate action ids');
assert.equal(payload.priority_actions[0].type, 'overdue_task', 'sorting is deterministic and puts very overdue work first');
assert(!JSON.stringify(payload).includes('L-B'), 'Sales A payload does not include Sales B records');
for (const action of payload.priority_actions) {
  assert(action.route && /^(leads\/|planner|inbox|applications|zoom)/.test(action.route), `valid route for ${action.type}`);
}

const empty = Dashboard.loadDashboardMyDayLocal({ ...db, leads: [], tasks: [], emails: [], applications: [], events: [] }, userA, { todayStart, tomorrowStart, provided: true });
assert.equal(empty.empty, true, 'empty state is explicit');
assert.deepEqual(empty.priority_actions, [], 'empty state has no actions');

console.log(`My Day tests passed (${payload.priority_actions.length} actions, ${Object.values(payload.summary).reduce((sum, value) => sum + Number(value || 0), 0)} summary signals).`);
