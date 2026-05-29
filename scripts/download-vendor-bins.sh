#!/usr/bin/env bash
set -euo pipefail

RIPGREP_VERSION="14.1.1"
WHISPER_CPP_VERSION="v1.8.5"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR_BIN="$ROOT/vendor/bin"

PLATFORMS=(
  "darwin-arm64:aarch64-apple-darwin"
  "darwin-x64:x86_64-apple-darwin"
  "linux-x64:x86_64-unknown-linux-musl"
  "linux-arm64:aarch64-unknown-linux-gnu"
  "windows-x64:x86_64-pc-windows-msvc"
)

echo "=== Downloading vendor binaries ==="
echo "ripgrep v${RIPGREP_VERSION}"
echo "whisper.cpp ${WHISPER_CPP_VERSION}"
echo ""

detect_host_platform() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"
  case "$os:$arch" in
    Darwin:arm64) echo "darwin-arm64" ;;
    Darwin:x86_64) echo "darwin-x64" ;;
    Linux:x86_64) echo "linux-x64" ;;
    Linux:aarch64|Linux:arm64) echo "linux-arm64" ;;
    MINGW*:x86_64|MSYS*:x86_64|CYGWIN*:x86_64) echo "windows-x64" ;;
    *) echo "" ;;
  esac
}

build_host_whisper_cli() {
  local platform="$1"
  local dest="$2"

  if ! command -v cmake >/dev/null 2>&1; then
    echo "  ! $platform/whisper-cli skipped (cmake not found)"
    return 1
  fi

  local tmp_dir
  tmp_dir=$(mktemp -d)
  trap "rm -rf $tmp_dir" RETURN

  echo "  ↓ $platform/whisper-cli (building from source) ..."
  curl -fsSL "https://github.com/ggml-org/whisper.cpp/archive/refs/tags/${WHISPER_CPP_VERSION}.tar.gz" \
    | tar -xz -C "$tmp_dir"

  local src_dir="$tmp_dir/whisper.cpp-${WHISPER_CPP_VERSION#v}"
  cmake -S "$src_dir" -B "$tmp_dir/build" \
    -DCMAKE_BUILD_TYPE=Release \
    -DBUILD_SHARED_LIBS=OFF \
    -DWHISPER_BUILD_TESTS=OFF \
    -DWHISPER_BUILD_EXAMPLES=ON \
    -DWHISPER_BUILD_SERVER=OFF \
    >/dev/null
  cmake --build "$tmp_dir/build" --config Release --target whisper-cli -j 4 >/dev/null

  local built="$tmp_dir/build/bin/whisper-cli"
  if [[ ! -f "$built" && -f "$tmp_dir/build/bin/Release/whisper-cli.exe" ]]; then
    built="$tmp_dir/build/bin/Release/whisper-cli.exe"
  fi
  if [[ ! -f "$built" ]]; then
    echo "  ! $platform/whisper-cli build did not produce binary"
    return 1
  fi

  cp "$built" "$dest"
  chmod +x "$dest"
  echo "    ✓ done ($(du -h "$dest" | cut -f1))"
}

for entry in "${PLATFORMS[@]}"; do
  PLATFORM="${entry%%:*}"
  RG_TARGET="${entry##*:}"

  DIR="$VENDOR_BIN/$PLATFORM"
  mkdir -p "$DIR"

  RG_BIN="$DIR/rg"
  EXT="tar.gz"
  if [[ "$PLATFORM" == windows-* ]]; then
    RG_BIN="$DIR/rg.exe"
    EXT="zip"
  fi

  if [[ -f "$RG_BIN" ]]; then
    echo "  ✓ $PLATFORM/rg (exists)"
    continue
  fi

  echo "  ↓ $PLATFORM/rg ..."
  RG_ARCHIVE="ripgrep-${RIPGREP_VERSION}-${RG_TARGET}"
  URL="https://github.com/BurntSushi/ripgrep/releases/download/${RIPGREP_VERSION}/${RG_ARCHIVE}.${EXT}"

  TMP_DIR=$(mktemp -d)
  trap "rm -rf $TMP_DIR" EXIT

  if [[ "$EXT" == "zip" ]]; then
    curl -fsSL "$URL" -o "$TMP_DIR/rg.zip"
    unzip -q "$TMP_DIR/rg.zip" -d "$TMP_DIR"
    cp "$TMP_DIR/${RG_ARCHIVE}/rg.exe" "$RG_BIN"
  else
    curl -fsSL "$URL" | tar -xz -C "$TMP_DIR"
    cp "$TMP_DIR/${RG_ARCHIVE}/rg" "$RG_BIN"
  fi

  chmod +x "$RG_BIN"
  echo "    ✓ done ($(du -h "$RG_BIN" | cut -f1))"
done

echo ""
echo "=== Preparing whisper.cpp CLI ==="
HOST_PLATFORM="$(detect_host_platform)"

for entry in "${PLATFORMS[@]}"; do
  PLATFORM="${entry%%:*}"
  DIR="$VENDOR_BIN/$PLATFORM"
  mkdir -p "$DIR"

  WHISPER_BIN="$DIR/whisper-cli"
  if [[ "$PLATFORM" == windows-* ]]; then
    WHISPER_BIN="$DIR/whisper-cli.exe"
  fi

  if [[ -f "$WHISPER_BIN" ]]; then
    echo "  ✓ $PLATFORM/$(basename "$WHISPER_BIN") (exists)"
    continue
  fi

  if [[ "$PLATFORM" == "$HOST_PLATFORM" ]]; then
    build_host_whisper_cli "$PLATFORM" "$WHISPER_BIN" || true
  else
    echo "  ! $PLATFORM/$(basename "$WHISPER_BIN") skipped (cross-build not available)"
  fi
done

echo ""
echo "=== All vendor binaries downloaded ==="
echo "Location: $VENDOR_BIN"
ls -la "$VENDOR_BIN"/*/
