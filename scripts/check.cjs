'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const files = [];
function scan(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || ['node_modules', 'test-results'].includes(entry.name)) continue;
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) scan(target);
    else if (/\.(js|cjs)$/.test(entry.name)) files.push(target);
  }
}
scan(root);
let errors = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) { console.error(result.stderr || result.error); errors++; }
}
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3 || manifest.description.length > 132) throw new Error('Invalid MV3 metadata');
const references = [manifest.action.default_popup, manifest.background.service_worker,
  ...manifest.content_scripts.flatMap(script => [...script.js, ...script.css]), ...Object.values(manifest.icons)];
for (const file of references) if (!fs.existsSync(path.join(root, file))) { console.error(`Missing manifest file: ${file}`); errors++; }
for (const file of fs.readdirSync(root).filter(name => name.endsWith('.html'))) {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  for (const match of html.matchAll(/(?:src|href)="([^"#?]+\.(?:js|css))"/g)) {
    if (!fs.existsSync(path.join(root, match[1]))) { console.error(`Missing asset ${match[1]} in ${file}`); errors++; }
  }
}
if (errors) process.exitCode = 1;
else console.log(`Checked ${files.length} JavaScript files, MV3 metadata, and local HTML assets.`);
