#!/usr/bin/env bash
# Experimental native engine setup (macOS / Linux dev). Docker remains default on these platforms.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="${CINEKIVE_DATA:-$HOME/.cinekive/data}"
ENGINE="$DATA/engine"

echo "Native engine setup (experimental)"
echo "Target: $ENGINE"

for c in python3 node npm ffmpeg; do
  command -v "$c" >/dev/null || { echo "Missing: $c"; exit 1; }
done

mkdir -p "$ENGINE"/{qdrant,web,logs}
mkdir -p "$DATA"/{qdrant,db,models,artifacts,videos,library}

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
QDRANT_VER="v1.13.2"

if [[ "$OS" == "darwin" ]]; then
  [[ "$ARCH" == "arm64" ]] && QPKG="qdrant-aarch64-apple-darwin" || QPKG="qdrant-x86_64-apple-darwin"
else
  QPKG="qdrant-x86_64-unknown-linux-gnu"
fi

QBIN="$ENGINE/qdrant/qdrant"
if [[ ! -x "$QBIN" ]]; then
  echo "Downloading Qdrant…"
  tmp="$(mktemp -d)"
  curl -fsSL "https://github.com/qdrant/qdrant/releases/download/$QDRANT_VER/${QPKG}.tar.gz" -o "$tmp/qdrant.tgz"
  tar -xzf "$tmp/qdrant.tgz" -C "$ENGINE/qdrant"
  chmod +x "$ENGINE/qdrant/qdrant" 2>/dev/null || true
  find "$ENGINE/qdrant" -name qdrant -type f -exec chmod +x {} \;
fi

PY="$ENGINE/python"
if [[ ! -x "$PY/bin/python" ]]; then
  echo "Creating Python venv…"
  python3 -m venv "$PY"
  "$PY/bin/pip" install --upgrade pip
  "$PY/bin/pip" install torch torchvision --index-url https://download.pytorch.org/whl/cpu
  "$PY/bin/pip" install -e "$ROOT/apps/api"
  "$PY/bin/pip" install -U "yt-dlp>=2024.8.0" "curl_cffi>=0.7.0"
fi

echo "Building Next.js standalone…"
pushd "$ROOT/apps/web" >/dev/null
npm install --legacy-peer-deps
NEXT_PUBLIC_API_URL=http://localhost:8000 npm run build
rm -rf "$ENGINE/web"
cp -R .next/standalone "$ENGINE/web"
mkdir -p "$ENGINE/web/.next/static"
cp -R .next/static "$ENGINE/web/.next/"
popd >/dev/null

echo "0.4.0-dev" > "$ENGINE/version.txt"
echo "Native engine ready at $ENGINE"
echo "Set engineMode to native in config.json"
