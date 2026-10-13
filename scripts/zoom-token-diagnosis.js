'use strict';

process.env.NEST_COMPAT_MODE = 'true';
process.env.BACKGROUND_JOBS_ENABLED = 'false';

const Zoom = require('../server/integrations/zoom');

async function tokenStatus(account) {
  const basic = Buffer.from(`${account.clientId}:${account.clientSecret}`).toString('base64');
  const response = await fetch('https://zoom.us/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'account_credentials',
      account_id: account.accountId,
    }),
  });
  const text = await response.text();
  let body = {};
  try {
    body = JSON.parse(text);
  } catch {
    body = { message: text.slice(0, 200) };
  }
  return {
    label: account.label,
    ok: response.ok && Boolean(body.access_token),
    status: response.status,
    error: body.reason || body.error || body.message || null,
    token: body.access_token || null,
  };
}

(async () => {
  const accounts = Zoom.zoomAccounts();
  const results = [];
  for (const account of accounts) {
    try {
      const result = await tokenStatus(account);
      if (result.token) {
        const usersResponse = await fetch('https://api.zoom.us/v2/users?page_size=1&status=active', {
          headers: { Authorization: `Bearer ${result.token}` },
        });
        const usersBody = await usersResponse.json().catch(() => ({}));
        const user = (usersBody.users || [])[0] || {};
        result.users = {
          ok: usersResponse.ok,
          status: usersResponse.status,
          total: usersBody.total_records || usersBody.users?.length || 0,
          first_user: user.email || user.id || null,
        };
        if (user.id || user.email) {
          const meetingsResponse = await fetch(`https://api.zoom.us/v2/users/${encodeURIComponent(user.id || user.email)}/meetings?type=upcoming&page_size=1`, {
            headers: { Authorization: `Bearer ${result.token}` },
          });
          const meetingsBody = await meetingsResponse.json().catch(() => ({}));
          result.meetings = {
            ok: meetingsResponse.ok,
            status: meetingsResponse.status,
            count: meetingsBody.meetings?.length || 0,
            error: meetingsBody.reason || meetingsBody.message || meetingsBody.error || null,
          };
        }
      }
      delete result.token;
      results.push(result);
    } catch (error) {
      results.push({
        label: account.label,
        ok: false,
        status: 0,
        error: error.message || String(error),
      });
    }
  }
  console.log(JSON.stringify({ accounts: results }, null, 2));
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
