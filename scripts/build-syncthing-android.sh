#!/bin/sh
set -eu

VERSION="2.1.2"
SOURCE_URL="https://codeload.github.com/syncthing/syncthing/tar.gz/refs/tags/v${VERSION}"
SOURCE_SHA256="cddcd03945de492f5c995f6fcda910fc49c1174a74899a26704aae63aa558c4a"
GO_TOOL="${GO_TOOL:-go1.25.11}"
ANDROID_API="26"
NDK_HOME="${ANDROID_NDK_HOME:-${ANDROID_HOME:?ANDROID_HOME is required}/ndk/28.2.13676358}"
ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
CACHE_DIR="${TMPDIR:-/tmp}/s-light-notes-syncthing-${VERSION}"
ARCHIVE="${CACHE_DIR}/syncthing-v${VERSION}.tar.gz"
SOURCE_DIR="${CACHE_DIR}/syncthing-${VERSION}"
TOOLCHAIN="${NDK_HOME}/toolchains/llvm/prebuilt/darwin-x86_64/bin"

mkdir -p "${CACHE_DIR}"
if [ ! -f "${ARCHIVE}" ]; then
  curl --http1.1 -L --retry 4 -o "${ARCHIVE}" "${SOURCE_URL}"
fi

ACTUAL_SOURCE_SHA="$(shasum -a 256 "${ARCHIVE}" | awk '{print $1}')"
if [ "${ACTUAL_SOURCE_SHA}" != "${SOURCE_SHA256}" ]; then
  echo "Syncthing source checksum mismatch" >&2
  exit 1
fi

if [ ! -d "${SOURCE_DIR}" ]; then
  tar -xzf "${ARCHIVE}" -C "${CACHE_DIR}"
fi

GO_COMMAND="$(command -v "${GO_TOOL}")"

build_target() {
  ABI="$1"
  GOARCH="$2"
  COMPILER="$3"
  OUTPUT_DIR="${ROOT_DIR}/src-tauri/gen/android/app/src/main/jniLibs/${ABI}"
  OUTPUT_FILE="${OUTPUT_DIR}/libsyncthingnative.so"
  mkdir -p "${OUTPUT_DIR}"

  (
    cd "${SOURCE_DIR}"
    env \
      CGO_ENABLED=1 \
      VERSION="v${VERSION}" \
      BUILD_USER="s-light-notes" \
      BUILD_HOST="android-builder" \
      SOURCE_DATE_EPOCH="1782451320" \
      EXTRA_LDFLAGS="-checklinkname=0" \
      "${GO_COMMAND}" run build.go \
        -gocmd "${GO_COMMAND}" \
        -goos android \
        -goarch "${GOARCH}" \
        -cc "${TOOLCHAIN}/${COMPILER}${ANDROID_API}-clang" \
        -no-upgrade \
        -build-out "${OUTPUT_FILE}" \
        build
  )
  chmod 755 "${OUTPUT_FILE}"
  shasum -a 256 "${OUTPUT_FILE}"
}

build_target "arm64-v8a" "arm64" "aarch64-linux-android"
build_target "x86_64" "amd64" "x86_64-linux-android"
