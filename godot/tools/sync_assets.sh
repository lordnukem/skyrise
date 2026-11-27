#!/usr/bin/env bash
# Copy the shared art and audio from the JS build (../assets) into this project. Godot can
# only load files under res://, and a copy survives checkouts that do not keep symlinks.
# assets/fonts (DejaVu Sans, for the ★ ✓ ♛ symbols) lives only here and is left alone.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf assets/art assets/audio
mkdir -p assets/art assets/audio
cp ../assets/art/*.png ../assets/art/LICENSE.md assets/art/
cp ../assets/audio/*.mp3 ../assets/audio/LICENSE.md assets/audio/
echo "synced $(ls assets/art | wc -l) art and $(ls assets/audio | wc -l) audio files"
