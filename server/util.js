'use strict';

const Http = require('./http');

function fullName(item) {
  return `${item.first_name} ${item.last_name}`;
}

function nextId(prefix, groups) {
  const values = groups.flat().filter(Boolean);
  const max = values.reduce((highest, item) => {
    const id = typeof item === 'string' ? item : item.id;
    const match = String(id || '').match(new RegExp(`^${prefix}-(\\d+)$`));
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
  return `${prefix}-${max + 1}`;
}

function encodePageCursor(value) {
  if (!value || typeof value !== 'object') return '';
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decodePageCursor(cursor, label = 'cursor') {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
    return value && typeof value === 'object' ? value : null;
  } catch {
    throw Http.statusError(400, `Invalid ${label}.`);
  }
}

// How many requests went out to each provider; fetchJson counts them.
const externalFetchCounters = { gmail: 0, google: 0, zoho: 0, zoom: 0, eventbrite: 0, meta: 0, apollo: 0 };

async function fetchJson(url, options = {}) {
  const urlText = String(url || '');
  if (/gmail\.googleapis\.com|oauth2\.googleapis\.com/i.test(urlText)) externalFetchCounters.gmail += 1;
  if (/googleapis\.com|google\.com/i.test(urlText)) externalFetchCounters.google += 1;
  if (/zoho/i.test(urlText)) externalFetchCounters.zoho += 1;
  if (/zoom\.us/i.test(urlText)) externalFetchCounters.zoom += 1;
  if (/eventbrite/i.test(urlText)) externalFetchCounters.eventbrite += 1;
  if (/graph\.facebook\.com/i.test(urlText)) externalFetchCounters.meta += 1;
  if (/apollo/i.test(urlText)) externalFetchCounters.apollo += 1;
  const timeoutMs = Number(options.timeoutMs || 20000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, { ...options, signal: options.signal || controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') throw Http.statusError(504, 'Provider request timed out.');
    throw Http.statusError(502, error.message || 'Provider request failed.');
  } finally {
    clearTimeout(timeout);
  }
  const text = await response.text();
  let value = {};
  try {
    value = text ? JSON.parse(text) : {};
  } catch {
    value = { raw: text };
  }
  if (!response.ok) {
    const providerMessage = value.error_description || value.error?.message || value.message || value.reason || value.error || value.raw || 'Provider request failed.';
    const providerCode = value.code || value.error_code || value.errorCode || '';
    throw Http.statusError(response.status >= 500 ? 502 : response.status, providerCode ? `${providerMessage} (${providerCode})` : providerMessage);
  }
  return value;
}

function nameParts(name, email) {
  const cleaned = (name || email.split('@')[0] || 'Unknown sender').trim();
  const parts = cleaned.split(/\s+/);
  return { first_name: parts[0] || 'Unknown', last_name: parts.slice(1).join(' ') || 'Sender' };
}

exports.fullName = fullName;
exports.nextId = nextId;
exports.encodePageCursor = encodePageCursor;
exports.decodePageCursor = decodePageCursor;
exports.externalFetchCounters = externalFetchCounters;
exports.fetchJson = fetchJson;
exports.nameParts = nameParts;
