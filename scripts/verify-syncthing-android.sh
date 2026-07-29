#!/bin/sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
NDK_HOME="${ANDROID_NDK_HOME:-${ANDROID_HOME:?ANDROID_HOME is required}/ndk/28.2.13676358}"
READELF="${NDK_HOME}/toolchains/llvm/prebuilt/darwin-x86_64/bin/llvm-readelf"

verify_artifact() {
  ABI="$1"
  EXPECTED_SHA="$2"
  FILE="${ROOT_DIR}/src-tauri/gen/android/app/src/main/jniLibs/${ABI}/libsyncthingnative.so"
  test -x "${FILE}"
  ACTUAL_SHA="$(shasum -a 256 "${FILE}" | awk '{print $1}')"
  test "${ACTUAL_SHA}" = "${EXPECTED_SHA}"
  "${READELF}" -h "${FILE}" | grep -q 'Type:.*DYN'
  "${READELF}" -lW "${FILE}" | awk '/LOAD/ { if ($NF != "0x4000") exit 1; found = 1 } END { if (!found) exit 1 }'
}

verify_artifact "arm64-v8a" "6c531d1ad2a43345843ae71b85fdfdcf35b422282c15435b29d7cadd4e1f61a1"
verify_artifact "x86_64" "c2a24595879781c38edabb1a7897682dc920f6468fbe1491802e7bc033bd026e"
echo "Syncthing Android artifacts verified"
