/**
 * Packages dist/ into a signed .wgt with the Tizen Studio CLI.
 *
 *   npm run package
 *
 * TIZEN_CLI      path to the tizen CLI (default ~/tizen-studio/tools/ide/bin/tizen)
 * TIZEN_PROFILE  certificate profile in Tizen Studio's Certificate Manager
 *                (default StreamlyTV)
 *
 * Output: release/StreamlyTV-React-<version>.wgt
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dist = path.join(root, 'dist');
const cli = process.env.TIZEN_CLI || path.join(os.homedir(), 'tizen-studio/tools/ide/bin/tizen');
const profile = process.env.TIZEN_PROFILE || 'StreamlyTV';

if (!fs.existsSync(path.join(dist, 'config.xml'))) {
  console.error('dist/config.xml missing — run "npm run build" first.');
  process.exit(1);
}

const version = /<widget[^>]*\sversion="([^"]+)"/.exec(fs.readFileSync(path.join(dist, 'config.xml'), 'utf8'))[1];

// Leftovers from a previous packaging run must not end up in the package
fs.readdirSync(dist).filter((f) => f.endsWith('.wgt') || f.endsWith('signature1.xml') || f === 'author-signature.xml')
  .forEach((f) => fs.rmSync(path.join(dist, f)));

console.log('Packaging with profile "' + profile + '"...');
execFileSync(cli, ['package', '-t', 'wgt', '-s', profile, '--', dist], { stdio: 'inherit' });

const built = fs.readdirSync(dist).find((f) => f.endsWith('.wgt'));
if (!built) {
  console.error('No .wgt produced.');
  process.exit(1);
}
const outDir = path.join(root, 'release');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'StreamlyTV-React-' + version + '.wgt');
fs.renameSync(path.join(dist, built), out);
console.log('\nCreated ' + path.relative(root, out) + ' (' + Math.round(fs.statSync(out).size / 1024) + ' KB)');
