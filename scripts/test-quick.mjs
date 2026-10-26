import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const defaults = ['native-shell', 'desktop-editing', 'reliability'];
const selected = process.argv.slice(2);
const suites = (selected.length ? selected : defaults).map(name => {
    const file = name.startsWith('tests/') ? name : `tests/${name.replace(/\.test\.mjs$/, '')}.test.mjs`;
    if (!/^tests\/[a-z0-9-]+\.test\.mjs$/.test(file) || !existsSync(file)) {
        throw new Error(`Unknown test suite: ${name}`);
    }
    if (file === 'tests/structure.test.mjs') {
        throw new Error('The complete repository structure check belongs to native CI; this container contains only frontend sources.');
    }
    return file;
});

const started = performance.now();
for (const suite of suites) {
    const result = spawnSync(process.execPath, [suite], { stdio: 'inherit', timeout: 30000 });
    if (result.error || result.status !== 0) {
        console.error(result.error?.message || `Failed: ${suite}`);
        process.exit(1);
    }
}
console.log(`PASS: ${suites.length} selected suites in ${((performance.now() - started) / 1000).toFixed(2)}s`);
