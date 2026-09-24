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

function setBusy(control, busy, label = '') {
  if (!control) return;
  if (busy) {
    control.dataset.originalText ||= control.textContent;
    control.disabled = true;
    if (label) control.textContent = label;
    return;
  }
  control.disabled = false;
  if (control.dataset.originalText) control.textContent = control.dataset.originalText;
  delete control.dataset.originalText;
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

const ROLE_OPTIONS = [
  ['member', 'Member'],
  ['monitor', 'Monitor'],
  ['developer', 'Developer']
];
const ASSIGNABLE_ROLE_OPTIONS = ROLE_OPTIONS.filter(([value]) => value !== 'developer');

function roleKey(user) {
  const role = String(user.role_key || user.role || 'member').toLowerCase();
  if (['developer', 'admin', 'director'].includes(role)) return 'developer';
  if (['monitor', 'minitor', 'manager', 'admissions', 'qa'].includes(role)) return 'monitor';
  return 'member';
}

function roleLabel(user) {
  return user.role_label || ROLE_OPTIONS.find(([value]) => value === roleKey(user))?.[1] || 'Member';
}

function roleBadge(user) {
  const key = roleKey(user);
  return `<span class="dev-pill role-${esc(key)}">${esc(roleLabel(user))}</span>`;
}

function statusBadge(text, kind = '') {
  return `<span class="dev-pill ${kind ? `status-${esc(kind)}` : ''}">${esc(text)}</span>`;
}

function roleSelect(user) {
  const selected = roleKey(user);
  const options = user.is_configured_developer ? ROLE_OPTIONS : ASSIGNABLE_ROLE_OPTIONS;
  return `<select class="dev-role-control" data-act="role" data-id="${esc(user.id)}" data-previous="${esc(selected)}" aria-label="Role for ${esc(user.name)}" ${user.is_configured_developer ? 'disabled' : ''}>
    ${options.map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join('')}
  </select>`;
}

function userActions(user) {
  if (user.is_configured_developer) return statusBadge('Protected', 'locked');
  return `<div class="dev-row-actions">
    <button class="button soft" data-act="reset" data-id="${esc(user.id)}">Reset</button>
    <button class="button soft" data-act="delete" data-id="${esc(user.id)}" data-name="${esc(user.name)}">Delete</button>
  </div>`;
}

function field(name, label, attrs = '') {
  return `<label class="dev-field"><span>${esc(label)}</span><input name="${esc(name)}" ${attrs}></label>`;
}

function runtimeStatus(item) {
  return statusBadge(item.configured ? 'Configured' : 'Missing', item.configured ? 'ok' : 'warn');
}

function shell(config) {
  const users = config.users || [];
  const tempCount = users.filter(user => user.temporary_password).length;
  const developerCount = users.filter(user => roleKey(user) === 'developer').length;
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
      <div class="dev-card dev-hero-card">
        <p class="eyebrow">Access control</p>
        <h1>Invites, roles and runtime status.</h1>
        <p>Manage workspace access, reset temporary passwords and confirm deployment configuration from one focused panel.</p>
        <div class="dev-hero-meta">
          ${statusBadge(`Storage: ${config.storage || 'unknown'}`, 'ok')}
          ${statusBadge(config.local_only ? 'Local access' : 'Configured developer', 'locked')}
        </div>
      </div>
      <div class="dev-stat-grid">
        <div class="dev-stat"><span class="dev-muted">Users</span><strong>${users.length}</strong><small>Total accounts</small></div>
        <div class="dev-stat"><span class="dev-muted">Developers</span><strong>${developerCount}</strong><small>Protected access</small></div>
        <div class="dev-stat"><span class="dev-muted">Temporary</span><strong>${tempCount}</strong><small>Password visible</small></div>
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
        ${field('name', 'Full name', 'placeholder="Full name" required maxlength="120"')}
        ${field('email', 'Work email', 'type="email" placeholder="name@company.com" required maxlength="254"')}
        ${field('password', 'Temporary password', 'placeholder="Leave blank to generate" minlength="8" maxlength="128"')}
        <label class="dev-field"><span>Role</span><select name="role">
          ${ASSIGNABLE_ROLE_OPTIONS.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}
        </select></label>
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
            ${users.length ? users.map(user => `
              <tr>
                <td><div class="dev-user-cell"><span class="dev-avatar">${esc((user.name || user.email || '?').slice(0, 1).toUpperCase())}</span><div><strong>${esc(user.name)}</strong><code>${esc(user.email)}</code></div></div></td>
                <td><div class="dev-role-stack">${roleSelect(user)}</div></td>
                <td><code class="dev-secret">${esc(user.temporary_password || 'Changed by user')}</code></td>
                <td>${user.temporary_password ? statusBadge('Temporary', 'warn') : statusBadge('Private', 'ok')}</td>
                <td>${userActions(user)}</td>
              </tr>
            `).join('') : '<tr><td colspan="5"><div class="dev-empty">No users have been invited yet.</div></td></tr>'}
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
                <td>${runtimeStatus(item)}</td>
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
  if (action === 'refresh') {
    setBusy(button, true, 'Refreshing...');
    await load();
    return;
  }
  if (action === 'delete') {
    if (!confirm(`Delete ${button.dataset.name || 'this user'}?`)) return;
    try {
      setBusy(button, true, 'Deleting...');
      await api(`/api/users/${encodeURIComponent(button.dataset.id)}`, {}, 'DELETE');
      toast('User deleted.');
      await load();
    } catch (error) {
      toast(error.message);
    } finally {
      setBusy(button, false);
    }
  }
  if (action === 'reset') {
    const password = prompt('New temporary password. Leave empty to generate one.');
    try {
      setBusy(button, true, 'Resetting...');
      const result = await api(`/api/users/${encodeURIComponent(button.dataset.id)}/reset-password`, { password: password || '' });
      toast(`Temporary password: ${result.temporary_password}`);
      await load();
    } catch (error) {
      toast(error.message);
    } finally {
      setBusy(button, false);
    }
  }
});

document.addEventListener('change', async event => {
  const input = event.target.closest('[data-act="role"]');
  if (!input) return;
  const previous = input.dataset.previous || input.value;
  input.disabled = true;
  try {
    await api(`/api/users/${encodeURIComponent(input.dataset.id)}/role`, { role: input.value }, 'PATCH');
    toast('Role updated.');
    await load();
  } catch (error) {
    input.value = previous;
    toast(error.message);
    await load();
  } finally {
    input.disabled = false;
  }
});

document.addEventListener('submit', async event => {
  if (event.target.id !== 'invite-form') return;
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.target).entries());
  const button = event.target.querySelector('[type="submit"]');
  try {
    setBusy(button, true, 'Inviting...');
    const result = await api('/api/users', values);
    event.target.reset();
    toast(`Temporary password: ${result.temporary_password}`);
    await load();
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(button, false);
  }
});

load();
