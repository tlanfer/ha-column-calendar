// Copies dist/column-calendar-card.js into Home Assistant's www folder.
// Target comes from HA_WWW_DIR in the git-ignored .env (see .env.example).
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const envFile = join(root, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const target = process.env.HA_WWW_DIR;
if (!target) {
  console.error('HA_WWW_DIR is not set. Create .env (see .env.example).');
  process.exit(1);
}
const file = 'column-calendar-card.js';
const source = join(root, 'dist', file);
if (!existsSync(source)) {
  console.error(`${source} not found. Run "npm run build" first.`);
  process.exit(1);
}
mkdirSync(target, { recursive: true });
copyFileSync(source, join(target, file));
console.log(`Deployed ${file} -> ${target}`);

// /config/www/<sub> is served as /local/<sub>.
const sub =
  target
    .replace(/\\/g, '/')
    .match(/\/www(\/.*)?\/?$/)?.[1]
    ?.replace(/\/$/, '') ?? '';
const url = `/local${sub}/${file}?v=${Date.now()}`;
console.log(
  `\nDashboard resource (JavaScript module), bump ?v= to bust the browser cache:\n  ${url}\n` +
    'Settings -> Dashboards -> ⋮ -> Resources, then hard-reload the browser.',
);
