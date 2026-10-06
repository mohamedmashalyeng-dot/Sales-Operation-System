'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Config = require('./config');
const Http = require('./http');

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.pdf': 'application/pdf',
  '.ico': 'image/x-icon'
};

// Only browser assets that live in the web root are public.
// Secrets and internal files (.env, .env.hostinger), data/scripts/sql/src/dist folders,
// deploy snapshots, backups and archives are never served, even though they sit next to
// the frontend files on disk.
const PUBLIC_STATIC_EXTENSIONS = new Set(['.html', '.js', '.css', '.webmanifest', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.woff', '.woff2']);
const PUBLIC_STATIC_BLOCKED_NAMES = new Set(['server.js']);
const PUBLIC_STATIC_DEFAULT_FILE = 'index.html';
const PUBLIC_ASSET_EXTENSIONS = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.woff', '.woff2']);
const PUBLIC_ASSET_PREFIX = 'assets/images/';

function publicStaticFile(pathname) {
  let decoded = '';
  try {
    decoded = decodeURIComponent(String(pathname || ''));
  } catch {
    return null;
  }
  if (!decoded || decoded === '/') return PUBLIC_STATIC_DEFAULT_FILE;
  if (!decoded.startsWith('/')) return null;
  const segments = decoded.slice(1).split('/');
  if (segments.length > 1) {
    const assetName = segments.join('/');
    if (assetName.startsWith(PUBLIC_ASSET_PREFIX) && !segments.some(segment => !segment || segment.startsWith('.') || segment.includes('\\'))) {
      const ext = path.extname(assetName).toLowerCase();
      return PUBLIC_ASSET_EXTENSIONS.has(ext) ? assetName : null;
    }
    return null;
  }
  const name = segments[0];
  if (!name || name.startsWith('.') || PUBLIC_STATIC_BLOCKED_NAMES.has(name.toLowerCase())) return null;
  const ext = path.extname(name).toLowerCase();
  if (!PUBLIC_STATIC_EXTENSIONS.has(ext)) return null;
  return name;
}

function serveStatic(req, res) {
  Http.applySecurityHeaders(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') return Http.sendJson(res, { error: 'Not found.' }, 404);
  const url = new URL(req.url, `http://${req.headers.host}`);
  const name = publicStaticFile(url.pathname);
  if (!name) return Http.sendJson(res, { error: 'Not found.' }, 404);
  const filePath = path.resolve(Config.ROOT, name);
  const rootPath = path.resolve(Config.ROOT);
  if (filePath !== rootPath && !filePath.startsWith(`${rootPath}${path.sep}`)) return Http.sendJson(res, { error: 'Not found.' }, 404);
  fs.readFile(filePath, (error, content) => {
    if (error) return Http.sendJson(res, { error: 'Not found.' }, 404);
    const ext = path.extname(filePath).toLowerCase();
    const headers = { 'Content-Type': mime[ext] || 'application/octet-stream' };
    if (ext === '.html') headers['Content-Security-Policy'] = Http.contentSecurityPolicy(content.toString('utf8'));
    res.writeHead(200, headers);
    res.end(content);
  });
}

exports.mime = mime;
exports.publicStaticFile = publicStaticFile;
exports.serveStatic = serveStatic;
