'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const outIndex = path.join(root, 'frontend', 'out', 'index.html');
const outAssets = path.join(root, 'frontend', 'out', 'assets');
const rootIndex = path.join(root, 'index.html');

if (!fs.existsSync(outIndex)) {
  throw new Error(`Frontend build index is missing: ${outIndex}. Run npm run ui:build first.`);
}

let html = fs.readFileSync(outIndex, 'utf8');

for (const name of fs.readdirSync(outAssets)) {
  if (!name.endsWith('.css')) continue;
  const cssPath = path.join(outAssets, name);
  const css = fs.readFileSync(cssPath, 'utf8');
  const fixedCss = css.replace(/url\(\/assets\/(remixicon-[^)]+)\)/g, 'url(./$1)');
  if (fixedCss !== css) fs.writeFileSync(cssPath, fixedCss);
}

// The Node app serves frontend/out at the domain root. This root index is only
// a static-hosting fallback, so it must point at the generated files in place.
html = html
  .replace(/(src|href)="\/assets\/(index-[^"]+\.(?:js|css))"/g, '$1="frontend/out/assets/$2"')
  .replace(/href="\/assets\/images\//g, 'href="assets/images/');

fs.writeFileSync(rootIndex, html);
console.log(`Synced ${path.relative(root, rootIndex)} from ${path.relative(root, outIndex)}.`);
