#!/usr/bin/env bash
# Install Godot (headless-capable editor binary) plus its Linux and Web export
# templates in a cloud session where godotengine.org and GitHub release
# downloads are blocked but Docker Hub is reachable. Copies the files out of the
# barichello/godot-ci image without running it. Safe to run twice.
set -euo pipefail

VERSION=4.7.2.stable
IMAGE=barichello/godot-ci:4.7.2
TEMPLATES="$HOME/.local/share/godot/export_templates/$VERSION"

if command -v godot >/dev/null && godot --version 2>/dev/null | grep -q "^${VERSION}" \
   && [ -f "$TEMPLATES/web_nothreads_release.zip" ]; then
  echo "Godot $VERSION already installed"; exit 0
fi

if ! docker info >/dev/null 2>&1; then
  (dockerd >/var/log/dockerd.log 2>&1 &)
  for _ in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done
fi

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"; docker image rm -f "$IMAGE" >/dev/null 2>&1 || true' EXIT
docker pull -q "$IMAGE"
docker image save "$IMAGE" -o "$WORK/image.tar"
mkdir "$WORK/x" && tar -xf "$WORK/image.tar" -C "$WORK/x"

T="root/.local/share/godot/export_templates/$VERSION"
for layer in "$WORK"/x/blobs/sha256/*; do
  if tar -tzf "$layer" 2>/dev/null | grep -qx "usr/local/bin/godot"; then
    mkdir -p "$TEMPLATES"
    tar -xzf "$layer" -C "$WORK" usr/local/bin/godot \
      "$T/web_nothreads_release.zip" "$T/web_nothreads_debug.zip" \
      "$T/linux_release.x86_64" "$T/linux_debug.x86_64"
    install -m 755 "$WORK/usr/local/bin/godot" /usr/local/bin/godot
    cp "$WORK/$T"/* "$TEMPLATES/"
    godot --version
    exit 0
  fi
done
echo "godot binary not found in $IMAGE" >&2; exit 1
