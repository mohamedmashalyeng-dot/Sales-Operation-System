'use strict';
// Display groups reuse persisted KBC stages. Outcomes never become process steps.
const GROUPS = [
  { key: 'new', label: 'New Lead', values: ['New lead', 'New Lead', 'Attempted Contact'] },
  { key: 'contacted', label: 'Contacted', values: ['Contacted'] },
  { key: 'qualified', label: 'Qualified', values: ['Qualified'] },
  { key: 'interested', label: 'Interested', values: ['Interested'] },
  { key: 'application', label: 'Application', values: ['Application Submitted', 'Eligibility', 'Ready for Enrolment', 'Offer Sent'] },
  { key: 'signed', label: 'Signed', values: ['Signed'] },
  { key: 'enrolled', label: 'Enrolled', values: ['Enrolled'] }
];
const groupFor = stage => GROUPS.find(group => group.values.includes(stage));
const OUTCOMES = { 'Callback Required': 'Callback Required', 'Follow-up': 'Follow-up Required', 'Not Interested': 'Not Interested',
  'On Hold': 'On Hold', Lost: 'Lost', 'Wrong Number': 'Wrong Number', Duplicate: 'Duplicate', 'Not Eligible': 'Not Eligible' };
function present(currentStage, rows) {
  // Local history is append-only; preserve insertion order for equal millisecond dates.
  const ordered = rows.slice().reverse().sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const current = groupFor(currentStage) || ordered.map(row => groupFor(row.to_stage)).find(Boolean);
  return { journey_current_key: current?.key || null, journey_current_stage: current?.label || null,
    journey_closed: ['Lost', 'Not Interested', 'Not Eligible', 'Duplicate'].includes(currentStage),
    legacy_stage_outcome: OUTCOMES[currentStage] || null,
    journey_milestones: GROUPS.map(group => ({ key: group.key, label: group.label,
      transition: ordered.slice().reverse().find(row => group.values.includes(row.to_stage)) || null })) };
}
exports.GROUPS = GROUPS; exports.groupFor = groupFor; exports.present = present;
