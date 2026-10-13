'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const routes = fs.readFileSync(path.join(root, 'server', 'routes', 'zoom.js'), 'utf8');

const directRouteStart = routes.indexOf('async function zoomRoutes(ctx) {');
const workspaceRouteStart = routes.indexOf('async function zoomWorkspaceRoutes(ctx) {');
assert(directRouteStart >= 0, 'direct Zoom routes are missing');
assert(workspaceRouteStart > directRouteStart, 'workspace Zoom routes should follow direct Zoom routes');

const directRoutes = routes.slice(directRouteStart, workspaceRouteStart);
assert.match(directRoutes, /const\s+\{[^}]*\bbody\b[^}]*\}\s*=\s*ctx;/, 'direct Zoom sync routes must read the parsed request body');
assert.match(directRoutes, /body\.max_meetings/, 'Zoom meeting sync should honour max_meetings from the request body');
assert.match(directRoutes, /body\.max_calls/, 'Zoom call sync should honour max_calls from the request body');

console.log('Zoom sync route tests passed.');
