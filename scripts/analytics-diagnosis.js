'use strict';

process.env.KBC_SKIP_AUTOMATION_RESUME = '1';
process.env.KBC_SKIP_ZOHO_RESUME = '1';
process.env.KBC_SKIP_GMAIL_AUTOSYNC = '1';
process.env.KBC_SKIP_EVENTBRITE_AUTOSYNC = '1';
process.env.KBC_SKIP_ZOOM_AUTOSYNC = '1';

const Analytics = require('../server/analytics');

async function main() {
  const user = { id: 'diagnostic-admin', role: 'developer', permissions: { developer: true, admin: true, review: true, sales: true } };
  const url = new URL('http://local/api/analytics/overview?preset=30d');
  const result = await Analytics.diagnose(url, user);
  console.log(JSON.stringify(result, null, 2));
}

main().then(() => process.exit(0)).catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
