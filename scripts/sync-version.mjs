import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Use a three-part release version.');
const cargoPath = join(root, 'src-tauri/Cargo.toml');
const cargo = readFileSync(cargoPath, 'utf8').replace(/^(version = ")[^"]+("$)/m, (_, before, after) => before + version + after);
writeFileSync(cargoPath, cargo);
const lockPath = join(root, 'src-tauri/Cargo.lock');
writeFileSync(lockPath, readFileSync(lockPath, 'utf8').replace(/(\[\[package\]\]\nname = "s-light-notes"\nversion = ")[^"]+(")/,
    (_, before, after) => before + version + after));
writeFileSync(join(root, 'app/js/app-info.js'),
    `// Generated from package.json by scripts/sync-version.mjs.\nwindow.AppInfo = Object.freeze({ name: 's-light notes', version: '${version}', icon: 'icons/icon-192.png' });\n`);
