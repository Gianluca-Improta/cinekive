#!/usr/bin/env bash
# Build macOS native engine pack for Cinekive desktop (CI + local).
# Usage: ./scripts/build-engine-pack-mac.sh [arm64|x64]
#
# Uses python-build-standalone (relocatable) — NOT `python3 -m venv`, which
# hardcodes the CI runner path and breaks on user machines.
set -euo pipefail

ARCH="${1:-$(uname -m)}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_ROOT="$ROOT/dist/engine-staging-mac-$ARCH"
ENGINE="$OUT_ROOT/engine"
ZIP_OUT="$ROOT/dist/engine-mac-${ARCH}.zip"
QDRANT_VER="v1.13.2"
NODE_VER="v20.18.0"
PY_TAG="20251202"
PY_VER="3.11.14"

echo "Building engine-mac-${ARCH} pack"

rm -rf "$OUT_ROOT"
mkdir -p "$ENGINE"

command -v node >/dev/null || { echo "Missing node"; exit 1; }
command -v npm >/dev/null || { echo "Missing npm"; exit 1; }
command -v curl >/dev/null || { echo "Missing curl"; exit 1; }
command -v tar >/dev/null || { echo "Missing tar"; exit 1; }

if [[ "$ARCH" == "arm64" ]]; then
  QPKG="qdrant-aarch64-apple-darwin"
  NODE_PKG="node-${NODE_VER}-darwin-arm64"
  PY_TRIPLE="aarch64-apple-darwin"
elif [[ "$ARCH" == "x64" || "$ARCH" == "x86_64" ]]; then
  ARCH="x64"
  QPKG="qdrant-x86_64-apple-darwin"
  NODE_PKG="node-${NODE_VER}-darwin-x64"
  PY_TRIPLE="x86_64-apple-darwin"
else
  echo "Unsupported arch: $ARCH"
  exit 1
fi

PY_URL="https://github.com/astral-sh/python-build-standalone/releases/download/${PY_TAG}/cpython-${PY_VER}+${PY_TAG}-${PY_TRIPLE}-install_only_stripped.tar.gz"

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

# --- Relocatable Python (NOT a host venv) ---
PY="$ENGINE/python"
echo "Downloading relocatable Python $PY_VER ($PY_TRIPLE)…"
tmp="$(mktemp -d)"
curl -fsSL "$PY_URL" -o "$tmp/python.tgz"
tar -xzf "$tmp/python.tgz" -C "$tmp"
if [[ -x "$tmp/python/bin/python3" ]]; then
  mv "$tmp/python" "$PY"
else
  src="$(find "$tmp" -maxdepth 2 -type d -name python | head -1)"
  mv "$src" "$PY"
fi
rm -rf "$tmp"

PY_BIN="$PY/bin/python3"
[[ -x "$PY_BIN" ]] || PY_BIN="$PY/bin/python"
[[ -x "$PY_BIN" ]] || { echo "python missing after extract"; exit 1; }
chmod -R u+w "$PY" || true

"$PY_BIN" -c "import sys; print(sys.executable); assert 'hostedtoolcache' not in sys.executable.lower() and '/Users/runner' not in sys.executable"

echo "Installing API deps into relocatable Python (torch CPU)…"
"$PY_BIN" -m ensurepip --upgrade
"$PY_BIN" -m pip install --upgrade pip
"$PY_BIN" -m pip install --index-url https://download.pytorch.org/whl/cpu torch torchvision
# Non-editable install so site-packages does not point at the CI checkout path
"$PY_BIN" -m pip install "$ROOT/apps/api"
"$PY_BIN" -m pip install -U "yt-dlp>=2024.8.0" "curl_cffi>=0.7.0"

"$PY_BIN" -c "import uvicorn, cinearchive; print('ok', cinearchive.__file__)"

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
printf '%s' "$VERSION" > "$ENGINE/version.txt"

echo "Creating zip: $ZIP_OUT"
mkdir -p "$(dirname "$ZIP_OUT")"
rm -f "$ZIP_OUT"
(
  cd "$OUT_ROOT"
  zip -r "$ZIP_OUT" engine
)
echo "Done: $ZIP_OUT"
