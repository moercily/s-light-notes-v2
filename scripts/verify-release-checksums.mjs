import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';

const root = resolve(process.argv[2]);
const sums = await readFile(join(root, 'SHA256SUMS'), 'utf8');
const verified = new Set();
for (const line of sums.trim().split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    if (!match || !/^[^/\\]+$/.test(match[2]) || ['.', '..'].includes(match[2]) || verified.has(match[2])) {
        throw new Error('Invalid release checksum entry');
    }
    const digest = createHash('sha256').update(await readFile(join(root, match[2]))).digest('hex');
    if (digest !== match[1]) throw new Error('Checksum mismatch: ' + match[2]);
    verified.add(match[2]);
}
for (const name of await readdir(root)) {
    if (/\.(exe|deb|AppImage|dmg)$/.test(name) && !verified.has(name)) throw new Error('Unlisted installer: ' + name);
}
if (!verified.size) throw new Error('No verified installers');
console.log(`Verified ${verified.size} release artifacts before native acceptance`);
