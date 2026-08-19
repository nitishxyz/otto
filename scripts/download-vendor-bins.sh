#!/usr/bin/env bash
set -euo pipefail

WHISPER_CPP_VERSION="v1.8.5"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR_BIN="$ROOT/vendor/bin"
REQUESTED_PLATFORMS=("$@")

PLATFORMS=(
  "darwin-arm64:aarch64-apple-darwin"
  "darwin-x64:x86_64-apple-darwin"
  "linux-x64:x86_64-unknown-linux-musl"
  "linux-arm64:aarch64-unknown-linux-gnu"
  "windows-x64:x86_64-pc-windows-msvc"
)

platform_requested() {
  local platform="$1"
  if [[ ${#REQUESTED_PLATFORMS[@]} -eq 0 ]]; then
    return 0
  fi

  for requested in "${REQUESTED_PLATFORMS[@]}"; do
    if [[ "$requested" == "$platform" ]]; then
      return 0
    fi
  done

  return 1
}

echo "=== Downloading vendor binaries ==="
echo "whisper.cpp ${WHISPER_CPP_VERSION}"
if [[ ${#REQUESTED_PLATFORMS[@]} -gt 0 ]]; then
  echo "platforms ${REQUESTED_PLATFORMS[*]}"
fi
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
  local cpu_args=(-DGGML_NATIVE=OFF)
  if [[ "$platform" == "linux-arm64" ]]; then
    cpu_args+=(-DGGML_CPU_ARM_ARCH=armv8-a)
  fi
  cmake -S "$src_dir" -B "$tmp_dir/build" \
    -DCMAKE_BUILD_TYPE=Release \
    -DBUILD_SHARED_LIBS=OFF \
    "${cpu_args[@]}" \
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

echo "=== Preparing whisper.cpp CLI ==="
HOST_PLATFORM="$(detect_host_platform)"

for entry in "${PLATFORMS[@]}"; do
  PLATFORM="${entry%%:*}"

  if ! platform_requested "$PLATFORM"; then
    continue
  fi

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
