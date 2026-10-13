'use strict';

const Http = require('../http');
const Auth = require('../auth');
const Notifications = require('../notifications');
const NOT_HANDLED = require('./not-handled');

async function notificationsRoutes(ctx) {
  const { route, method, res, req, url, body } = ctx;
  let match = null;
  if (route === '/api/notifications' && method === 'GET') {
    const user = await Auth.currentSessionUser(req);
    return Http.sendJson(res, await Notifications.list(user, {
      limit: url.searchParams.get('limit'),
      cursor: url.searchParams.get('cursor'),
      filter: url.searchParams.get('filter')
    }));
  }
  if (route === '/api/notifications/unread-count' && method === 'GET') {
    const user = await Auth.currentSessionUser(req);
    return Http.sendJson(res, await Notifications.unreadCount(user));
  }
  match = route.match(/^\/api\/notifications\/([^/]+)\/read$/);
  if (match && method === 'PATCH') {
    const user = await Auth.currentSessionUser(req);
    return Http.sendJson(res, await Notifications.setRead(user, decodeURIComponent(match[1]), body.read !== false));
  }
  if (route === '/api/notifications/read-all' && method === 'POST') {
    const user = await Auth.currentSessionUser(req);
    return Http.sendJson(res, await Notifications.markAllRead(user));
  }
  return NOT_HANDLED;
}

exports.notificationsRoutes = notificationsRoutes;
