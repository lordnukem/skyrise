#!/usr/bin/env bash
# Copy the app icon and menu logo from the JS build (../assets) into this project. Godot can
# only load files under res://, and a copy survives checkouts that do not keep symlinks.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf assets/art
mkdir -p assets/art
# The pixel build draws everything from assets/pixel (tools/pixelart/build.py); it needs
# only the app icon and the menu logo from the JS art.
cp ../assets/art/app-icon-512.png ../assets/art/logo-skyrise.png ../assets/art/LICENSE.md assets/art/
echo "synced $(ls assets/art | wc -l) art files"
