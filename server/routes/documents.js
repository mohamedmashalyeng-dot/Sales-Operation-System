'use strict';

const Http = require('../http');
const Auth = require('../auth');
const Documents = require('../documents');
const NOT_HANDLED = require('./not-handled');

async function documentsRoutes(ctx) {
  const { route, method, res, req, url } = ctx;
  let match = null;
  if (route === '/api/documents' && method === 'GET') {
    const user = await Auth.currentSessionUser(req);
    return Http.sendJson(res, await Documents.list(user, {
      limit: url.searchParams.get('limit'),
      cursor: url.searchParams.get('cursor'),
      entity_type: url.searchParams.get('entity_type'),
      lead_id: url.searchParams.get('lead_id'),
      application_id: url.searchParams.get('application_id'),
      programme_id: url.searchParams.get('programme_id'),
      owner_id: url.searchParams.get('owner_id'),
      file_type: url.searchParams.get('file_type'),
      uploaded_from: url.searchParams.get('uploaded_from'),
      uploaded_to: url.searchParams.get('uploaded_to'),
      search: url.searchParams.get('search')
    }));
  }
  match = route.match(/^\/api\/documents\/([^/]+)\/download$/);
  if (match && method === 'GET') {
    const user = await Auth.currentSessionUser(req);
    return Documents.download(user, decodeURIComponent(match[1]), res);
  }
  return NOT_HANDLED;
}

exports.documentsRoutes = documentsRoutes;
