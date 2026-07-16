#!/usr/bin/env bash

set -euo pipefail

SDK_PATH="/opt/pocketbook-sdk/SDK-A13"
TOOLCHAIN_FILE="${SDK_PATH}/usr/share/buildroot/toolchainfile.cmake"
BUILD_DIR="/project/build"

echo "Using SDK: ${SDK_PATH}"
echo "Using toolchain: ${TOOLCHAIN_FILE}"

if [[ ! -f "${TOOLCHAIN_FILE}" ]]; then
    echo "ERROR: Toolchain file not found."
    exit 1
fi

rm -rf "${BUILD_DIR}"
mkdir -p "${BUILD_DIR}"
cd "${BUILD_DIR}"

cmake \
    -G "Unix Makefiles" \
    -DCMAKE_TOOLCHAIN_FILE="${TOOLCHAIN_FILE}" \
    -DCMAKE_BUILD_TYPE=Release \
    ..

cmake --build . --parallel 2

echo
echo "Generated files:"
ls -lh

echo
file PB641Frame.app

echo
echo "Build complete:"
echo "${BUILD_DIR}/PB641Frame.app"
