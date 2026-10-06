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

function withoutModulePrefixes(source, root) {
  const namespaces = serverFiles(root).map(file => path.basename(file, '.js').split('-').map(part => part[0].toUpperCase() + part.slice(1)).join(''));
  return source.replace(new RegExp(`\\b(?:${namespaces.join('|')})\\.`, 'g'), '');
}

function readServerSource(root = PROJECT_ROOT) {
  return withoutModulePrefixes(serverFiles(root).map(file => fs.readFileSync(file, 'utf8')).join('\n'), root);
}

// The text of the route groups that handleApi tries before it loads the whole workspace
// (OPEN_ROUTES and DIRECT_ROUTES in server/routes/index.js). A route found here answers
// without the legacy loadDb.
function directRouteSource(root = PROJECT_ROOT) {
  const routesDir = path.join(root, 'server', 'routes');
  const index = fs.readFileSync(path.join(routesDir, 'index.js'), 'utf8');
  const directAt = index.indexOf('tryRoutes(DIRECT_ROUTES, ctx)');
  const loadDbAt = index.indexOf('Storage.loadDb()');
  if (directAt === -1 || loadDbAt === -1 || directAt > loadDbAt) throw new Error('handleApi should try DIRECT_ROUTES before Storage.loadDb().');
  const groupFiles = fs.readdirSync(routesDir).filter(name => name.endsWith('.js') && name !== 'index.js').map(name => fs.readFileSync(path.join(routesDir, name), 'utf8'));
  const parts = [];
  for (const list of ['OPEN_ROUTES', 'DIRECT_ROUTES']) {
    const declared = new RegExp(`const ${list} = \\[([^\\]]*)\\]`).exec(index);
    if (!declared) throw new Error(`${list} is missing from server/routes/index.js.`);
    for (const name of declared[1].split(',').map(item => item.trim().split('.').pop()).filter(Boolean)) {
      const source = groupFiles.find(text => text.includes(`async function ${name}(ctx) {`));
      if (!source) throw new Error(`Route group ${name} was not found in server/routes.`);
      const start = source.indexOf(`async function ${name}(ctx) {`);
      const end = source.indexOf('\n}', start);
      parts.push(source.slice(start, end + 2));
    }
  }
  return withoutModulePrefixes(parts.join('\n'), root);
}

module.exports = { readServerSource, directRouteSource, serverFiles };
