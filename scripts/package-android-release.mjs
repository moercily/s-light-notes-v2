import { createHash } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(
  readFileSync(join(projectRoot, 'package.json'), 'utf8'),
);
const version = packageJson.version;
const androidBuildRoot = join(
  projectRoot,
  'src-tauri',
  'gen',
  'android',
  'app',
  'build',
  'outputs',
);
const releaseDirectory = join(projectRoot, 'release', 'android', version);

const artifacts = [
  {
    source: join(
      androidBuildRoot,
      'apk',
      'arm64',
      'release',
      'app-arm64-release.apk',
    ),
    name: `s-light-notes-${version}-arm64-v8a.apk`,
  },
  {
    source: join(
      androidBuildRoot,
      'apk',
      'x86_64',
      'release',
      'app-x86_64-release.apk',
    ),
    name: `s-light-notes-${version}-x86_64.apk`,
  },
  {
    source: join(
      androidBuildRoot,
      'bundle',
      'universalRelease',
      'app-universal-release.aab',
    ),
    name: `s-light-notes-${version}-universal.aab`,
  },
];

rmSync(releaseDirectory, { recursive: true, force: true });
mkdirSync(releaseDirectory, { recursive: true });

const manifest = artifacts.map(({ source, name }) => {
  const destination = join(releaseDirectory, name);
  copyFileSync(source, destination);
  const contents = readFileSync(destination);
  return {
    file: name,
    bytes: statSync(destination).size,
    sha256: createHash('sha256').update(contents).digest('hex'),
  };
});

const checksums = manifest
  .map(({ file, sha256 }) => `${sha256}  ${file}`)
  .join('\n');

writeFileSync(join(releaseDirectory, 'SHA256SUMS'), `${checksums}\n`);
writeFileSync(
  join(releaseDirectory, 'release-manifest.json'),
  `${JSON.stringify(
    {
      product: packageJson.name,
      version,
      generatedAt: new Date().toISOString(),
      artifacts: manifest,
    },
    null,
    2,
  )}\n`,
);

console.log(`Collected ${manifest.length} signed artifacts in ${releaseDirectory}`);
