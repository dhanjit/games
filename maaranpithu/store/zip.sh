#!/usr/bin/env bash
# Build the itch.io upload: the playable folder only, no harness, no notes.
set -euo pipefail
cd "$(dirname "$0")/.."
out="$(pwd)/store/maaranpithu-itch.zip"
rm -f "$out"
zip -qr "$out" index.html style.css game.js rules.js audio.js sw.js manifest.webmanifest icons
echo "built $out"
