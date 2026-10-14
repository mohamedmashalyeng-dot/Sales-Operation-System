'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const frontend = path.join(root, 'frontend');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const uiPkg = JSON.parse(fs.readFileSync(path.join(frontend, 'package.json'), 'utf8'));
const indexHtml = fs.readFileSync(path.join(frontend, 'index.html'), 'utf8');
const main = fs.readFileSync(path.join(frontend, 'src', 'main.tsx'), 'utf8');
const provider = fs.readFileSync(path.join(frontend, 'src', 'store', 'WorkspaceProvider.tsx'), 'utf8');
const backendSync = fs.readFileSync(path.join(frontend, 'src', 'store', 'backendSync.ts'), 'utf8');
const staticFiles = fs.readFileSync(path.join(root, 'server', 'static-files.js'), 'utf8');
const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');

for (const required of [
  'src/App.tsx',
  'src/store/backendSync.ts',
  'src/components/feature/AppShell.tsx',
  'src/components/feature/Sidebar.tsx',
  'src/components/feature/Topbar.tsx',
  'src/pages/today/page.tsx',
  'src/pages/leads/page.tsx',
  'src/pages/applications/page.tsx',
  'src/pages/audit/page.tsx',
  'tailwind.config.ts',
  'vite.config.ts'
]) {
  assert(fs.existsSync(path.join(frontend, required)), `Missing Readdy UI file: ${required}`);
}

assert(pkg.scripts['ui:install'], 'Root ui:install script missing');
assert(pkg.scripts['ui:build'], 'Root ui:build script missing');
assert(pkg.scripts['ui:dev'], 'Root ui:dev script missing');
assert(pkg.scripts['start:readdy'], 'Root start:readdy script missing');
assert(pkg.scripts['test:readdy-ui'], 'Root test:readdy-ui script missing');
assert(pkg.scripts['test:frontend'] === 'npm run test:readdy-ui', 'Root test:frontend should point at the Readdy UI audit');
assert(!pkg.scripts['start:legacy'], 'Root start:legacy script should not remain after legacy frontend removal');

for (const forbidden of ['firebase', '@supabase/supabase-js', '@stripe/react-stripe-js']) {
  assert(!uiPkg.dependencies?.[forbidden], `${forbidden} should not be carried into the Readdy migration shell`);
}
assert(uiPkg.dependencies?.remixicon, 'Remix Icon should be served from a frontend dependency, not a CDN');
assert(!/cdnjs\.cloudflare\.com/i.test(indexHtml), 'Readdy index.html should not depend on CDN stylesheets');
assert(main.includes("remixicon/fonts/remixicon.css"), 'Readdy main.tsx should import local Remix Icon CSS');

assert(!staticFiles.includes('KBC_UI_MODE'), 'Static server should not keep a legacy UI opt-out');
assert(staticFiles.includes('Readdy frontend build is missing'), 'Static server should fail clearly when the Readdy build is missing');
assert(staticFiles.includes('frontend') && staticFiles.includes('out'), 'Static server must point at frontend/out for the Readdy build');
assert(gitignore.includes('frontend/node_modules/') && gitignore.includes('frontend/out/'), 'Frontend build artifacts should be ignored');
assert(provider.includes('loadBackendWorkspace'), 'WorkspaceProvider should hydrate the Readdy UI from backend APIs');
assert(provider.includes('backendLoadedAt'), 'WorkspaceProvider should expose backend load state to UI components');
assert(backendSync.includes('integrationStatuses') && backendSync.includes('bootstrap.integrations'), 'backendSync should map integration status from bootstrap data');
for (const route of ['/api/bootstrap', '/api/leads', '/api/tasks', '/api/applications']) {
  assert(backendSync.includes(route), `backendSync should request ${route}`);
}
assert(backendSync.includes('credentials: "include"'), 'backendSync should send existing backend session cookies');
assert(backendSync.includes('AUTH_REQUIRED'), 'backendSync should fall back cleanly when no backend session exists');

console.log('Readdy UI migration shell audit passed.');
