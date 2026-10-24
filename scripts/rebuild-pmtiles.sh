#!/usr/bin/env bash
set -Eeuo pipefail
# Development-only vendor rebuild. Never downloads data or runs in the browser.
: "${VENDOR_BUILD_DIR:?Set a new temporary directory for the pinned build tools}"
if [[ -e "$VENDOR_BUILD_DIR" ]]; then echo 'Use a new temporary directory' >&2; exit 1; fi
npm install --prefix "$VENDOR_BUILD_DIR" --no-save --no-package-lock pmtiles@4.5.0 fflate@0.8.3 esbuild@0.25.12
npm ls --prefix "$VENDOR_BUILD_DIR" pmtiles fflate esbuild
"$VENDOR_BUILD_DIR/node_modules/.bin/esbuild" "$VENDOR_BUILD_DIR/node_modules/pmtiles/dist/esm/index.js" --bundle --minify --format=esm --target=es2020 --outfile=assets/vendor/pmtiles.mjs
cp "$VENDOR_BUILD_DIR/node_modules/fflate/LICENSE" assets/vendor/fflate-license.txt
