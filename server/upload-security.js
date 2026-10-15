'use strict';

const path = require('node:path');
const Http = require('./http');

const MAX_EVIDENCE_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_UPLOAD_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/zip',
  'application/x-zip-compressed',
  'multipart/x-zip'
]);
const ALLOWED_UPLOAD_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.zip']);
const EXECUTABLE_EXTENSIONS = new Set(['.exe', '.bat', '.cmd', '.com', '.scr', '.ps1', '.js', '.vbs', '.msi', '.jar', '.sh']);

function safeFileName(name = '') {
  const clean = String(name || 'document')
    .replace(/[\r\n"]/g, '_')
    .replace(/[\\/]+/g, '_')
    .slice(0, 180)
    .trim();
  return clean || 'document';
}

function fileType(filename = '') {
  const ext = path.extname(String(filename || '')).toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (['.png', '.jpg', '.jpeg'].includes(ext)) return 'image';
  if (ext === '.zip') return 'zip';
  return ext ? ext.slice(1) : 'unknown';
}

function uploadSecurityReview(filename = '', contentType = '') {
  const clean = safeFileName(filename);
  const ext = path.extname(clean).toLowerCase();
  return {
    filename: clean,
    file_type: fileType(clean),
    allowed_type: !contentType || ALLOWED_UPLOAD_TYPES.has(String(contentType).toLowerCase()),
    allowed_extension: ALLOWED_UPLOAD_EXTENSIONS.has(ext),
    executable_blocked: EXECUTABLE_EXTENSIONS.has(ext),
    path_traversal_blocked: clean !== filename,
    content_disposition: 'attachment'
  };
}

function normalizeBase64(value) {
  const raw = String(value || '').trim().replace(/^data:[^,]*,/i, '').replace(/\s+/g, '');
  if (!raw) throw Http.statusError(400, 'Choose a file before uploading.');
  if (raw.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) {
    throw Http.statusError(400, 'Uploaded file content is not valid.');
  }
  const buffer = Buffer.from(raw, 'base64');
  if (!buffer.length) throw Http.statusError(400, 'Uploaded file content is empty.');
  if (buffer.length > MAX_EVIDENCE_UPLOAD_BYTES) {
    throw Http.statusError(413, `Choose a document no larger than ${MAX_EVIDENCE_UPLOAD_BYTES / 1024 / 1024} MB.`);
  }
  return buffer;
}

function hasZipSignature(buffer) {
  return buffer.length >= 4
    && buffer[0] === 0x50
    && buffer[1] === 0x4b
    && (
      (buffer[2] === 0x03 && buffer[3] === 0x04)
      || (buffer[2] === 0x05 && buffer[3] === 0x06)
      || (buffer[2] === 0x07 && buffer[3] === 0x08)
    );
}

function matchesSignature(ext, buffer) {
  if (ext === '.pdf') return buffer.slice(0, 5).toString('ascii') === '%PDF-';
  if (ext === '.png') return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (ext === '.jpg' || ext === '.jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (ext === '.zip') return hasZipSignature(buffer);
  return false;
}

function validateEvidenceUpload(body = {}) {
  const filename = safeFileName(body.filename || 'document');
  const ext = path.extname(filename).toLowerCase();
  const contentType = String(body.content_type || body.contentType || '').toLowerCase();
  const review = uploadSecurityReview(filename, contentType);
  if (review.executable_blocked || !review.allowed_extension) {
    throw Http.statusError(400, 'Only PDF, PNG, JPEG or ZIP evidence files can be uploaded.');
  }
  if (contentType && !review.allowed_type) {
    throw Http.statusError(400, 'Only PDF, PNG, JPEG or ZIP evidence files can be uploaded.');
  }
  const content = normalizeBase64(body.content_base64);
  if (!matchesSignature(ext, content)) {
    throw Http.statusError(400, 'The uploaded file does not match its file type.');
  }
  return {
    filename,
    file_type: fileType(filename),
    content_type: contentType || (ext === '.zip' ? 'application/zip' : ext === '.pdf' ? 'application/pdf' : ext === '.png' ? 'image/png' : 'image/jpeg'),
    content_base64: content.toString('base64'),
    size: content.length
  };
}

exports.MAX_EVIDENCE_UPLOAD_BYTES = MAX_EVIDENCE_UPLOAD_BYTES;
exports.ALLOWED_UPLOAD_TYPES = ALLOWED_UPLOAD_TYPES;
exports.EXECUTABLE_EXTENSIONS = EXECUTABLE_EXTENSIONS;
exports.safeFileName = safeFileName;
exports.fileType = fileType;
exports.uploadSecurityReview = uploadSecurityReview;
exports.validateEvidenceUpload = validateEvidenceUpload;
