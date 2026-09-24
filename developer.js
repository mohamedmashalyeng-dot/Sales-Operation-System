'use strict';

const app = document.getElementById('dev-app');
const toastEl = document.getElementById('toast');

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[char]));

function toast(message) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 2600);
}

async function api(path, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let value = {};
  try {
    value = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Server returned ${response.status}. Open the main dashboard and sign in again.`);
  }
  if (!response.ok) {
    const error = new Error(value.error || 'Unable to complete the request.');
    error.status = response.status;
    throw error;
  }
  return value;
}

function shell(config) {
  const users = config.users || [];
  const tempCount = users.filter(user => user.temporary_password).length;
  const adminCount = users.filter(user => ['admin', 'director'].includes(user.role)).length;
  return `
    <header class="dev-topbar">
      <div class="dev-brand">
        <img src="/Kent%20Business%20College%20logo.svg?v=4" alt="">
        <div><b>Developer Dashboard</b><br><span>Kent Business College workspace access</span></div>
      </div>
      <div class="dev-actions">
        <button class="button soft" data-act="refresh">Refresh</button>
        <a class="button" href="/">Back to dashboard</a>
      </div>
    </header>

    <section class="dev-hero">
      <div class="dev-card">
        <p class="eyebrow">Access control</p>
        <h1>Invites, passwords and runtime status.</h1>
        <p>Use this page to invite users and reset temporary passwords without loading the full workspace.</p>
      </div>
      <div class="dev-stat-grid">
        <div class="dev-stat"><span class="dev-muted">Users</span><strong>${users.length}</strong></div>
        <div class="dev-stat"><span class="dev-muted">Admins</span><strong>${adminCount}</strong></div>
        <div class="dev-stat"><span class="dev-muted">Temporary</span><strong>${tempCount}</strong></div>
      </div>
    </section>

    <section class="dev-panel">
      <div class="dev-panel-header">
        <div>
          <h2>Invite user</h2>
          <p class="dev-muted">Temporary passwords stay visible here until the user changes them.</p>
        </div>
      </div>
      <form class="dev-form" id="invite-form">
        <input name="name" placeholder="Full name" required maxlength="120">
        <input name="email" type="email" placeholder="Work email" required maxlength="254">
        <input name="password" placeholder="Temporary password" minlength="8" maxlength="128">
        <select name="role">
          <option value="sales">sales</option>
          <option value="manager">manager</option>
          <option value="admissions">admissions</option>
          <option value="qa">qa</option>
          <option value="director">director</option>
          <option value="admin">admin</option>
        </select>
        <button class="button primary" type="submit">Invite</button>
      </form>
    </section>

    <section class="dev-panel">
      <div class="dev-panel-header">
        <div>
          <h2>Team access</h2>
          <p class="dev-muted">Reset a password if someone forgets it. Leave the prompt blank to generate one.</p>
        </div>
      </div>
      <div class="table-wrap">
        <table class="dev-table">
          <thead><tr><th>User</th><th>Role</th><th>Temporary password</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${users.map(user => `
              <tr>
                <td><strong>${esc(user.name)}</strong><br><code>${esc(user.email)}</code></td>
                <td>${esc(user.role || 'sales')}</td>
                <td><code>${esc(user.temporary_password || 'Changed by user')}</code></td>
                <td>${user.temporary_password ? 'Temporary' : 'Private'}</td>
                <td><button class="button soft" data-act="reset" data-id="${esc(user.id)}">Reset</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>

    <section class="dev-panel">
      <div class="dev-panel-header">
        <div>
          <h2>Runtime</h2>
          <p class="dev-muted">Storage mode: ${esc(config.storage)}</p>
        </div>
      </div>
      <div class="table-wrap">
        <table class="dev-table">
          <thead><tr><th>Key</th><th>Status</th><th>Value</th></tr></thead>
          <tbody>
            ${(config.server || []).map(item => `
              <tr>
                <td><strong>${esc(item.label)}</strong><br><code>${esc(item.key)}</code></td>
                <td>${item.configured ? 'Configured' : 'Missing'}</td>
                <td><code>${esc(item.value || 'Not set')}</code></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

async function load() {
  try {
    app.innerHTML = '<section class="dev-loading"><span class="loading-mark compact"></span></section>';
    const config = await api('/api/developer/config');
    app.innerHTML = shell(config);
  } catch (error) {
    app.innerHTML = `
      <section class="dev-error">
        <h1>Developer dashboard is unavailable.</h1>
        <p>${esc(error.message)}</p>
        <div class="dev-actions">
          <a class="button primary" href="/">Open dashboard login</a>
          <button class="button soft" data-act="refresh">Try again</button>
        </div>
      </section>
    `;
  }
}

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-act]');
  if (!button) return;
  const action = button.dataset.act;
  if (action === 'refresh') return load();
  if (action === 'reset') {
    const password = prompt('New temporary password. Leave empty to generate one.');
    try {
      const result = await api(`/api/users/${encodeURIComponent(button.dataset.id)}/reset-password`, { password: password || '' });
      toast(`Temporary password: ${result.temporary_password}`);
      await load();
    } catch (error) {
      toast(error.message);
    }
  }
});

document.addEventListener('submit', async event => {
  if (event.target.id !== 'invite-form') return;
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.target).entries());
  try {
    const result = await api('/api/users', values);
    event.target.reset();
    toast(`Temporary password: ${result.temporary_password}`);
    await load();
  } catch (error) {
    toast(error.message);
  }
});

load();
