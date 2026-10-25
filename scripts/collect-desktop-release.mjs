import { readdir, readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { join, basename, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const source = resolve(process.argv[2] || 'src-tauri/target/release/bundle');
const destination = resolve(process.argv[3] || 'release/desktop');
if (destination === source || destination.startsWith(source + '/')) throw new Error('Output must be outside the build bundle.');
async function collect(directory) {
    const files = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory() && !entry.name.endsWith('.app')) files.push(...await collect(path));
        else if (entry.isFile() && /\.(dmg|exe|deb|AppImage)$/.test(entry.name)) files.push(path);
    }
    return files;
}
const files = await collect(source);
if (!files.length) throw new Error('No desktop installers found.');
await mkdir(destination, { recursive: true });
const hashes = [];
for (const file of files.sort()) {
    const output = join(destination, basename(file));
    // Refuse replacement; a version must never silently acquire a different installer.
    await copyFile(file, output, 1);
    const inputHash = createHash('sha256').update(await readFile(file)).digest('hex');
    const outputHash = createHash('sha256').update(await readFile(output)).digest('hex');
    if (inputHash !== outputHash) throw new Error('Installer copy failed checksum verification');
    hashes.push(`${outputHash}  ${basename(file)}`);
}
await writeFile(join(destination, 'SHA256SUMS'), hashes.join('\n') + '\n');
console.log(`Collected ${files.length} verified installer(s) in ${destination}`);
