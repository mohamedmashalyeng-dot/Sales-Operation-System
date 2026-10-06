'use strict';

// The server code lives in server.js and server/**. Audits that inspect the source read it
// through here as one text. Module prefixes (Storage., State., ...) are removed, so a pattern
// matches a call whichever module the function sits in.
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..', '..');

function serverFiles(root = PROJECT_ROOT) {
  const files = [];
  (function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) files.push(full);
    }
  })(path.join(root, 'server'));
  return [...files, path.join(root, 'server.js')];
}

function readServerSource(root = PROJECT_ROOT) {
  const files = serverFiles(root);
  const namespaces = files.map(file => path.basename(file, '.js').split('-').map(part => part[0].toUpperCase() + part.slice(1)).join(''));
  const prefix = new RegExp(`\\b(?:${namespaces.join('|')})\\.`, 'g');
  return files.map(file => fs.readFileSync(file, 'utf8')).join('\n').replace(prefix, '');
}

module.exports = { readServerSource, serverFiles };
