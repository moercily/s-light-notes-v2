import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const androidRoot = join(projectRoot, 'src-tauri', 'gen', 'android');
const signingDirectory = join(androidRoot, 'signing');
const keystorePath = join(signingDirectory, 's-light-notes-release.p12');
const propertiesPath = join(androidRoot, 'keystore.properties');
const keyAlias = 's-light-notes';

if (existsSync(keystorePath) || existsSync(propertiesPath)) {
    console.error(
        'Android signing material already exists. Refusing to replace the release identity.',
    );
    process.exit(1);
}

const password = randomBytes(36).toString('base64url');
mkdirSync(signingDirectory, { recursive: true, mode: 0o700 });

const keytool = spawnSync(
    'keytool',
    [
        '-genkeypair',
        '-keystore',
        keystorePath,
        '-storetype',
        'PKCS12',
        '-storepass:env',
        'SLIGHT_ANDROID_SIGNING_PASSWORD',
        '-keypass:env',
        'SLIGHT_ANDROID_SIGNING_PASSWORD',
        '-alias',
        keyAlias,
        '-keyalg',
        'RSA',
        '-keysize',
        '4096',
        '-validity',
        '10000',
        '-dname',
        'CN=s-light notes, OU=Mobile, O=s-light notes, L=Shanghai, ST=Shanghai, C=CN',
    ],
    {
        encoding: 'utf8',
        env: {
            ...process.env,
            SLIGHT_ANDROID_SIGNING_PASSWORD: password,
        },
    },
);

if (keytool.status !== 0) {
    console.error(keytool.stderr || keytool.stdout || 'keytool failed');
    process.exit(keytool.status ?? 1);
}

const properties = [
    'storeFile=signing/s-light-notes-release.p12',
    `storePassword=${password}`,
    `keyAlias=${keyAlias}`,
    `keyPassword=${password}`,
    '',
].join('\n');

writeFileSync(propertiesPath, properties, { encoding: 'utf8', mode: 0o600 });
chmodSync(keystorePath, 0o600);
chmodSync(propertiesPath, 0o600);

console.log(`Created Android release keystore: ${keystorePath}`);
console.log(`Created local signing properties: ${propertiesPath}`);
console.log('Back up both files securely. Losing this key prevents signed upgrades.');
