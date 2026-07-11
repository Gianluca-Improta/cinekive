#!/usr/bin/env bash
# Build macOS native engine pack for Cinekive desktop (CI + local).
# Usage: ./scripts/build-engine-pack-mac.sh [arm64|x64]
set -euo pipefail

ARCH="${1:-$(uname -m)}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_ROOT="$ROOT/dist/engine-staging-mac-$ARCH"
ENGINE="$OUT_ROOT/engine"
ZIP_OUT="$ROOT/dist/engine-mac-${ARCH}.zip"
QDRANT_VER="v1.13.2"
NODE_VER="v20.18.0"

echo "Building engine-mac-${ARCH} pack"

rm -rf "$OUT_ROOT"
mkdir -p "$ENGINE"

command -v python3 >/dev/null || { echo "Missing python3"; exit 1; }
command -v node >/dev/null || { echo "Missing node"; exit 1; }
command -v npm >/dev/null || { echo "Missing npm"; exit 1; }

if [[ "$ARCH" == "arm64" ]]; then
  QPKG="qdrant-aarch64-apple-darwin"
  NODE_PKG="node-${NODE_VER}-darwin-arm64"
elif [[ "$ARCH" == "x64" || "$ARCH" == "x86_64" ]]; then
  ARCH="x64"
  QPKG="qdrant-x86_64-apple-darwin"
  NODE_PKG="node-${NODE_VER}-darwin-x64"
else
  echo "Unsupported arch: $ARCH"
  exit 1
fi

# --- Qdrant ---
QDIR="$ENGINE/qdrant"
mkdir -p "$QDIR"
if [[ ! -x "$QDIR/qdrant" ]]; then
  echo "Downloading Qdrant $QDRANT_VER ($QPKG)…"
  tmp="$(mktemp -d)"
  curl -fsSL "https://github.com/qdrant/qdrant/releases/download/${QDRANT_VER}/${QPKG}.tar.gz" -o "$tmp/qdrant.tgz"
  tar -xzf "$tmp/qdrant.tgz" -C "$QDIR"
  find "$QDIR" -name qdrant -type f -exec chmod +x {} \;
  if [[ ! -x "$QDIR/qdrant" ]]; then
    qbin="$(find "$QDIR" -name qdrant -type f | head -1)"
    [[ -n "$qbin" ]] && cp "$qbin" "$QDIR/qdrant" && chmod +x "$QDIR/qdrant"
  fi
  rm -rf "$tmp"
fi

# --- Portable Node ---
NODEDIR="$ENGINE/node"
mkdir -p "$NODEDIR"
if [[ ! -x "$NODEDIR/node" ]]; then
  echo "Downloading Node.js $NODE_VER ($ARCH)…"
  tmp="$(mktemp -d)"
  curl -fsSL "https://nodejs.org/dist/${NODE_VER}/${NODE_PKG}.tar.gz" -o "$tmp/node.tgz"
  tar -xzf "$tmp/node.tgz" -C "$tmp"
  cp "$tmp/$NODE_PKG/bin/node" "$NODEDIR/node"
  chmod +x "$NODEDIR/node"
  rm -rf "$tmp"
fi

# --- ffmpeg (evermeet static build) ---
FFDIR="$ENGINE/ffmpeg/bin"
mkdir -p "$FFDIR"
if [[ ! -x "$FFDIR/ffmpeg" ]]; then
  echo "Downloading ffmpeg…"
  curl -fsSL "https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip" -o "$FFDIR/ffmpeg.zip"
  unzip -o -q "$FFDIR/ffmpeg.zip" -d "$FFDIR"
  chmod +x "$FFDIR/ffmpeg"
  rm -f "$FFDIR/ffmpeg.zip"
fi

# --- Python venv + API ---
PY="$ENGINE/python"
echo "Creating Python venv (torch CPU)…"
python3 -m venv "$PY"
"$PY/bin/pip" install --upgrade pip
"$PY/bin/pip" install --index-url https://download.pytorch.org/whl/cpu torch torchvision
"$PY/bin/pip" install -e "$ROOT/apps/api"
"$PY/bin/pip" install -U "yt-dlp>=2024.8.0" "curl_cffi>=0.7.0"

# --- Next standalone ---
WEBOUT="$ENGINE/web"
echo "Building Next.js standalone…"
pushd "$ROOT/apps/web" >/dev/null
npm install --legacy-peer-deps
NEXT_PUBLIC_API_URL=http://localhost:8000 npm run build
rm -rf "$WEBOUT"
cp -R .next/standalone "$WEBOUT"
server="$(find "$WEBOUT" -name server.js -type f | head -1)"
if [[ -n "$server" && "$server" != "$WEBOUT/server.js" ]]; then
  cp "$server" "$WEBOUT/server.js"
fi
mkdir -p "$WEBOUT/.next/static"
cp -R .next/static "$WEBOUT/.next/"
popd >/dev/null

VERSION="$(node -p "require('$ROOT/apps/desktop/package.json').version")"
echo -n "$VERSION" > "$ENGINE/version.txt"

echo "Creating zip: $ZIP_OUT"
mkdir -p "$(dirname "$ZIP_OUT")"
rm -f "$ZIP_OUT"
(cd "$OUT_ROOT" && zip -r -q "$ZIP_OUT" engine)
echo "Done: $ZIP_OUT"
