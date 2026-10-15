'use strict';

const crypto = require('node:crypto');
const Config = require('../config');
const State = require('../state');
const Http = require('../http');
const Storage = require('../storage');
const Auth = require('../auth');
const Emails = require('../emails');
const NOT_HANDLED = require('./not-handled');

// Account routes answered before the sign-in check.
async function accountOpenRoutes(ctx) {
  const { route } = ctx;
  if (route === '/api/signup') throw Http.statusError(404, 'Sign up is disabled. Ask the developer to invite your account.');
  return NOT_HANDLED;
}

// Account routes that read and write the database directly.
async function accountRoutes(ctx) {
  const { route, method, res, body, req } = ctx;
  let lightweightMatch = null;
  if (route === '/api/login' && method === 'POST') {
    const email = Emails.normalizeEmail(body.email);
    const password = String(body.password || '');
    if (!email || !password) throw Http.statusError(400, 'Email and password are required.');
    const loginLimits = Auth.loginThrottleLimits(req, email);
    Auth.assertAuthThrottle(loginLimits);
    const publishedDefault = password === Auth.LEGACY_DEFAULT_ADMIN_PASSWORD;
    let user = publishedDefault ? null : await Auth.findLoginUser(email);
    let passwordValid = Boolean(user && Auth.verifyPassword(password, user.password_hash));
    if (!publishedDefault && !passwordValid) {
      user = await Auth.forceConfiguredDeveloperLogin(email, password);
      passwordValid = Boolean(user && Auth.verifyPassword(password, user.password_hash));
    }
    if (!user || !passwordValid) {
      Auth.recordAuthThrottle(loginLimits);
      if (Auth.isDeveloperEmail(email) && !Auth.developerPasswordConfigured()) {
        throw Http.statusError(500, 'Developer password is not configured on this deployment. Add DEV_PANEL_PASSWORD and redeploy.');
      }
      throw Http.statusError(401, 'Email or password is incorrect.');
    }
    Auth.authThrottle.delete(loginLimits[0][0]);
    if (!['admin','manager','sales','enrolment'].includes(Auth.canonicalWorkspaceRole(user.role))) throw Http.statusError(403, 'Your account has no active workspace role. Contact your workspace administrator.');
    // A successful account switch revokes this browser's previous session. A
    // failed password never signs out the account that was already signed in.
    const previousSid = Http.parseCookies(req).sid;
    const sid = await Auth.createSession(user);
    if (previousSid) await Auth.deleteSession(previousSid);
    Http.sendJson(res, { ok: true, user: Auth.publicUser(user) }, 200, { 'Set-Cookie': Auth.sessionCookie(req, sid) });
    Auth.recordPostgresLogin(user, req).catch(error => console.error(`Login audit failed: ${error.message || error}`));
    return;
  }
  if (route === '/api/users' && method === 'POST') {
    const user = await Auth.currentSessionUser(req);
    Auth.requireDeveloperAccess(req, user);
    return Http.sendJson(res, await Auth.createWorkspaceUser(body, user), 201);
  }
  lightweightMatch = route.match(/^\/api\/users\/([^/]+)\/reset-password$/);
  if (lightweightMatch && method === 'POST') {
    const user = await Auth.currentSessionUser(req);
    Auth.requireDeveloperAccess(req, user);
    return Http.sendJson(res, await Auth.resetWorkspaceUserPassword(lightweightMatch[1], body, user));
  }
  lightweightMatch = route.match(/^\/api\/users\/([^/]+)\/role$/);
  if (lightweightMatch && method === 'PATCH') {
    const user = await Auth.currentSessionUser(req);
    Auth.requireDeveloperAccess(req, user);
    return Http.sendJson(res, await Auth.updateWorkspaceUserRole(lightweightMatch[1], body, user));
  }
  lightweightMatch = route.match(/^\/api\/users\/([^/]+)$/);
  if (lightweightMatch && method === 'DELETE') {
    const user = await Auth.currentSessionUser(req);
    Auth.requireDeveloperAccess(req, user);
    return Http.sendJson(res, await Auth.deleteWorkspaceUser(lightweightMatch[1], user));
  }
  if (route === '/api/password/reset' && method === 'POST') {
    const resetLimits = [[`reset-address:${Http.requestIp(req)}`, Auth.PASSWORD_RESET_ATTEMPTS_PER_ADDRESS]];
    Auth.assertAuthThrottle(resetLimits);
    Auth.recordAuthThrottle(resetLimits);
    return Http.sendJson(res, await Auth.resetPasswordWithTokenFastDb(body));
  }
  if (route === '/api/logout' && method === 'POST') {
    await Auth.currentSessionUser(req);
    const sid = Http.parseCookies(req).sid;
    await Auth.deleteSession(sid);
    return Http.sendJson(res, { ok: true }, 200, { 'Set-Cookie': Auth.sessionCookie(req, '', 0) });
  }
  if (route === '/api/password' && method === 'POST') {
    const user = await Auth.currentSessionUser(req);
    return Http.sendJson(res, await Auth.changeOwnPassword(user, body), 200, { 'Set-Cookie': Auth.sessionCookie(req, '', 0) });
  }
  if (route === '/api/password/forgot' && method === 'POST') {
    // Checked here, before the full workspace load that the handler below needs.
    const forgotLimits = [
      [`forgot-address:${Http.requestIp(req)}`, Auth.PASSWORD_FORGOT_REQUESTS_PER_ADDRESS],
      [`forgot-email:${Emails.normalizeEmail(body.email)}`, Auth.PASSWORD_FORGOT_REQUESTS_PER_EMAIL]
    ];
    Auth.assertAuthThrottle(forgotLimits);
    Auth.recordAuthThrottle(forgotLimits);
  }
  return NOT_HANDLED;
}

// Account routes on the loaded workspace that need no session.
async function accountPublicWorkspaceRoutes(ctx) {
  const { route, method, res, body, req, db } = ctx;
  if (route === '/api/password/forgot' && method === 'POST') {
    if (!State.postgresPool) throw Http.statusError(500, 'Password reset requires Neon/PostgreSQL storage.');
    const email = Emails.normalizeEmail(body.email);
    if (!email) throw Http.statusError(400, 'Email is required.');
    const user = db.users.find(item => Emails.normalizeEmail(item.email) === email);
    if (user) {
      const resetsTable = Storage.sqlIdentifier(Config.POSTGRES_PASSWORD_RESETS_TABLE, 'app_password_resets');
      const token = crypto.randomBytes(32).toString('base64url');
      await State.postgresPool.query(
        `insert into ${resetsTable} (user_id, email, token_hash, expires_at) values ($1, $2, $3, now() + interval '30 minutes')`,
        [user.id, email, Auth.tokenHash(token)]
      );
      try {
        await Auth.sendPasswordResetMail(db, req, user, token);
      } catch (error) {
        console.error(`Password reset email failed for ${email}: ${error.message}`);
        if (!Http.isLocalRequest(req)) throw error;
        return Http.sendJson(res, {
          ok: true,
          message: 'Email delivery is not configured. Opening a local reset link instead.',
          reset_url: Auth.resetUrl(req, token),
          delivery_error: error.message
        });
      }
    }
    return Http.sendJson(res, { ok: true, message: 'If this email is registered, a reset link has been sent.' });
  }
  return NOT_HANDLED;
}

exports.accountOpenRoutes = accountOpenRoutes;
exports.accountRoutes = accountRoutes;
exports.accountPublicWorkspaceRoutes = accountPublicWorkspaceRoutes;
