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
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
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
const READDY_BUILD_DIR = path.resolve(Config.ROOT, process.env.KBC_READDY_OUT_DIR || path.join('frontend', 'out'));
const KBC_UI_MODE = String(process.env.KBC_UI || 'readdy').toLowerCase();
const READDY_UI_ENABLED = KBC_UI_MODE !== 'legacy';
const READDY_STATIC_EXTENSIONS = new Set(['.html', '.js', '.css', '.json', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.woff', '.woff2']);

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

// Whether a browser or the CDN may reuse a static file without asking the server again.
// - A script or stylesheet asked for with ?v=<build> has a new URL for every build, so that
//   exact URL may be reused for a week. The CDN already did this for stylesheets; scripts had
//   no cache header at all and were downloaded from this server on every page load.
// - Images and fonts: a week, as the CDN already gave them.
// - Pages, the service worker, the manifest and anything asked for without ?v=: "no-cache".
//   They are how a new build is discovered, so they are checked with the server every time
//   (a short 304 answer when unchanged).
// A script or stylesheet that changes therefore needs a new build id, or browsers and the CDN
// keep the old file for up to a week.
function staticCacheControl(name, ext, versioned) {
  if (PUBLIC_ASSET_EXTENSIONS.has(ext)) return 'public, max-age=604800';
  if ((ext === '.js' || ext === '.css') && versioned && name !== 'sw.js') return 'public, max-age=604800';
  return 'no-cache';
}

function readdyBuildAvailable() {
  if (!READDY_UI_ENABLED) return false;
  const rootPath = path.resolve(Config.ROOT);
  if (READDY_BUILD_DIR !== rootPath && !READDY_BUILD_DIR.startsWith(`${rootPath}${path.sep}`)) return false;
  return fs.existsSync(path.join(READDY_BUILD_DIR, 'index.html'));
}

function readdyStaticFile(pathname) {
  let decoded = '';
  try {
    decoded = decodeURIComponent(String(pathname || ''));
  } catch {
    return null;
  }
  if (!decoded || decoded === '/') return 'index.html';
  if (!decoded.startsWith('/')) return null;
  const clean = decoded.slice(1);
  const segments = clean.split('/');
  if (segments.some(segment => !segment || segment.startsWith('.') || segment.includes('\\'))) return null;
  const ext = path.extname(clean).toLowerCase();
  if (ext) return READDY_STATIC_EXTENSIONS.has(ext) ? clean : null;
  return 'index.html';
}

function readdyCacheControl(name, ext) {
  if (name === 'index.html' || ext === '.html') return 'no-cache';
  return 'public, max-age=604800';
}

// An If-None-Match header may list several tags and may mark them weak (W/).
function etagMatches(header, etag) {
  if (!header) return false;
  const wanted = etag.replace(/^W\//, '');
  return String(header).split(',').some(item => item.trim() === '*' || item.trim().replace(/^W\//, '') === wanted);
}

function serveStatic(req, res) {
  Http.applySecurityHeaders(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') return Http.sendJson(res, { error: 'Not found.' }, 404);
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (readdyBuildAvailable()) return serveReaddyStatic(req, res, url);
  const name = publicStaticFile(url.pathname);
  if (!name) return Http.sendJson(res, { error: 'Not found.' }, 404);
  const filePath = path.resolve(Config.ROOT, name);
  const rootPath = path.resolve(Config.ROOT);
  if (filePath !== rootPath && !filePath.startsWith(`${rootPath}${path.sep}`)) return Http.sendJson(res, { error: 'Not found.' }, 404);
  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) return Http.sendJson(res, { error: 'Not found.' }, 404);
    const ext = path.extname(filePath).toLowerCase();
    const etag = `W/"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`;
    const headers = {
      'Content-Type': mime[ext] || 'application/octet-stream',
      'Cache-Control': staticCacheControl(name, ext, url.searchParams.has('v')),
      ETag: etag,
      'Last-Modified': stats.mtime.toUTCString()
    };
    if (etagMatches(req.headers['if-none-match'], etag)) {
      res.writeHead(304, headers);
      return res.end();
    }
    fs.readFile(filePath, (error, content) => {
      if (error) return Http.sendJson(res, { error: 'Not found.' }, 404);
      if (ext === '.html') headers['Content-Security-Policy'] = Http.contentSecurityPolicy(content.toString('utf8'));
      res.writeHead(200, headers);
      res.end(content);
    });
  });
}

function serveReaddyStatic(req, res, url) {
  const name = readdyStaticFile(url.pathname);
  if (!name) return Http.sendJson(res, { error: 'Not found.' }, 404);
  let filePath = path.resolve(READDY_BUILD_DIR, name);
  if (filePath !== READDY_BUILD_DIR && !filePath.startsWith(`${READDY_BUILD_DIR}${path.sep}`)) return Http.sendJson(res, { error: 'Not found.' }, 404);
  if (!fs.existsSync(filePath) && !path.extname(name)) filePath = path.join(READDY_BUILD_DIR, 'index.html');
  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      if (path.extname(name)) return Http.sendJson(res, { error: 'Not found.' }, 404);
      filePath = path.join(READDY_BUILD_DIR, 'index.html');
      try {
        stats = fs.statSync(filePath);
      } catch {
        return Http.sendJson(res, { error: 'Not found.' }, 404);
      }
    }
    const ext = path.extname(filePath).toLowerCase();
    const etag = `W/"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`;
    const headers = {
      'Content-Type': mime[ext] || 'application/octet-stream',
      'Cache-Control': readdyCacheControl(path.relative(READDY_BUILD_DIR, filePath), ext),
      ETag: etag,
      'Last-Modified': stats.mtime.toUTCString()
    };
    if (etagMatches(req.headers['if-none-match'], etag)) {
      res.writeHead(304, headers);
      return res.end();
    }
    fs.readFile(filePath, (error, content) => {
      if (error) return Http.sendJson(res, { error: 'Not found.' }, 404);
      if (ext === '.html') headers['Content-Security-Policy'] = Http.contentSecurityPolicy(content.toString('utf8'));
      res.writeHead(200, headers);
      res.end(content);
    });
  });
}

exports.mime = mime;
exports.publicStaticFile = publicStaticFile;
exports.readdyStaticFile = readdyStaticFile;
exports.serveStatic = serveStatic;
