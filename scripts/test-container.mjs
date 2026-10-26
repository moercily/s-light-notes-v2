import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const context = process.env.SLIGHT_DOCKER_CONTEXT || 'colima-slight-qa';
const image = 's-light-notes-tests:local';
const container = `slight-tests-${randomUUID()}`;
const docker = args => {
    const result = spawnSync('docker', ['--context', context, ...args], {
        cwd: root, stdio: 'inherit', timeout: 300000,
    });
    if (result.error || result.status !== 0) {
        throw new Error(result.error?.message || `docker ${args[0]} failed (${result.status})`);
    }
};

try {
    docker(['build', '-f', 'tests/container/Dockerfile', '-t', image, '.']);
    docker(['run', '--name', container, '--rm', '--init', '--network=none', '--read-only', '--cpus=2', '--memory=512m',
        '--pids-limit=64', '--cap-drop=ALL', '--security-opt=no-new-privileges',
        '--tmpfs=/tmp:rw,nosuid,size=64m', image, ...process.argv.slice(2)]);
} catch (error) {
    console.error(error.message);
    console.error('Start the isolated headless runtime as documented in docs/HEADLESS_TESTING.md.');
    process.exitCode = 1;
} finally {
    // A timed-out Docker client can leave its container running. Remove only our unique test container.
    spawnSync('docker', ['--context', context, 'rm', '-f', container], { stdio: 'ignore', timeout: 10000 });
}
