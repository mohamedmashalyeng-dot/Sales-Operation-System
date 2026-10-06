'use strict';

const crypto = require('node:crypto');
const zlib = require('node:zlib');
const Perf = require('./perf');

function requestIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket?.remoteAddress || '';
}

function isLocalRequest(req) {
  const host = String(req.headers.host || '').split(':')[0].toLowerCase();
  const address = String(req.socket.remoteAddress || '');
  const hostLocal = ['localhost', '127.0.0.1', '::1'].includes(host);
  const socketLocal = address === '::1' || address === '127.0.0.1' || address.endsWith(':127.0.0.1');
  return hostLocal && socketLocal;
}

function forwardedHeader(req, name, fallback = '') {
  return String(req.headers[name] || fallback).split(',')[0].trim();
}

function requestIsSecure(req) {
  return forwardedHeader(req, 'x-forwarded-proto') === 'https' || req.socket?.encrypted || process.env.NODE_ENV === 'production';
}

function originFor(req) {
  const proto = forwardedHeader(req, 'x-forwarded-proto', requestIsSecure(req) ? 'https' : 'http');
  const host = forwardedHeader(req, 'x-forwarded-host', req.headers.host);
  return `${proto}://${host}`;
}

function statusError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').filter(Boolean).map(item => {
    const index = item.indexOf('=');
    return [decodeURIComponent(item.slice(0, index).trim()), decodeURIComponent(item.slice(index + 1).trim())];
  }));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 20 * 1024 * 1024) reject(statusError(413, 'Request is too large.'));
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        const parsed = JSON.parse(body);
        // Handlers read fields off the body, so null and bare values count as an empty one.
        resolve(parsed !== null && typeof parsed === 'object' ? parsed : {});
      } catch {
        reject(statusError(400, 'Invalid JSON body.'));
      }
    });
  });
}

// List endpoints return tens to hundreds of KB of JSON, which gzip shrinks roughly 8x.
const JSON_GZIP_MIN_BYTES = 8 * 1024;

function sendJson(res, value, status = 200, headers = {}, trace = null) {
  const serializeStarted = performance.now();
  const body = JSON.stringify(value);
  Perf.perfAdd(trace, 'serialize', performance.now() - serializeStarted, { bytes: Buffer.byteLength(body) });
  if (trace) {
    trace.bytes = Buffer.byteLength(body);
    trace.status = status;
    headers = { ...headers, 'Server-Timing': Perf.formatServerTiming(trace) };
  }
  const acceptsGzip = /\bgzip\b/i.test(String(res.req?.headers?.['accept-encoding'] || ''));
  const writeStarted = performance.now();
  if (acceptsGzip && body.length >= JSON_GZIP_MIN_BYTES) {
    Perf.perfAdd(trace, 'response_headers', 0);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding', ...headers });
    res.end(zlib.gzipSync(body));
    Perf.perfAdd(trace, 'response_write', performance.now() - writeStarted, { gzip: true });
    Perf.perfAdd(trace, 'response_end', Math.max(0, performance.now() - trace?.started_at || 0));
    Perf.logPerfTrace(trace);
    return;
  }
  Perf.perfAdd(trace, 'response_headers', 0);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(body);
  Perf.perfAdd(trace, 'response_write', performance.now() - writeStarted, { gzip: false });
  Perf.perfAdd(trace, 'response_end', Math.max(0, performance.now() - trace?.started_at || 0));
  Perf.logPerfTrace(trace);
}

function requestPath(req) {
  try { return new URL(req.url, `http://${req.headers.host}`).pathname; }
  catch { return req.url || ''; }
}

// Sent with every response. HTML pages also get the Content-Security-Policy in serveStatic.
function applySecurityHeaders(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (requestIsSecure(req)) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
}

// Pages run their own script files only. An inline script (offline.html has one) is allowed by
// its hash, taken from the HTML being sent so it always matches. Browsers hash the script text
// with LF line endings, whatever the file on disk uses.
function contentSecurityPolicy(html) {
  const inlineScripts = [...String(html).matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(match => `'sha256-${crypto.createHash('sha256').update(match[1].replace(/\r\n?/g, '\n')).digest('base64')}'`);
  return [
    "default-src 'self'",
    `script-src ${["'self'", ...inlineScripts].join(' ')}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join('; ');
}

// Errors raised on purpose (statusError) and plain messages are shown to the user. Database,
// network and programming errors describe the inside of the server, so the caller gets a
// generic message and the real one goes to the log.
function isInternalError(error) {
  if (!error || error.status) return false;
  if (error instanceof TypeError || error instanceof ReferenceError || error instanceof RangeError || error instanceof SyntaxError) return true;
  return Boolean(error.code || error.errno || error.syscall || error.severity);
}

function publicErrorMessage(error) {
  return isInternalError(error) ? 'Server error. Please try again.' : error?.message || 'Server error.';
}

exports.requestIp = requestIp;
exports.isLocalRequest = isLocalRequest;
exports.requestIsSecure = requestIsSecure;
exports.originFor = originFor;
exports.statusError = statusError;
exports.parseCookies = parseCookies;
exports.readBody = readBody;
exports.sendJson = sendJson;
exports.requestPath = requestPath;
exports.applySecurityHeaders = applySecurityHeaders;
exports.contentSecurityPolicy = contentSecurityPolicy;
exports.isInternalError = isInternalError;
exports.publicErrorMessage = publicErrorMessage;
