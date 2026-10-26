FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914
WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --omit=optional --no-audit --no-fund
COPY app ./app
COPY tests ./tests
COPY scripts/test-quick.mjs ./scripts/test-quick.mjs
COPY src-tauri/src/desktop/native-shell-recovery.js ./src-tauri/src/desktop/native-shell-recovery.js
COPY src-tauri/Cargo.toml src-tauri/tauri.conf.json src-tauri/tauri.android.conf.json ./src-tauri/
USER node
ENTRYPOINT ["node", "scripts/test-quick.mjs"]
