#!/usr/bin/env bash
# Downloads the Q03 RAW PoC samples (raw.pixls.us sample corpus, CC0) and verifies
# them against scripts/raw-samples.sha256.
#
# The canonical download path is /download/data/... ("/data/..." only 301-redirects
# there and dropped the path in some mirrors/tools, which was the IMG-03 defect).
#
# Usage:
#   scripts/fetch-raw-samples.sh                 # fetch into testdata/ and verify
#   scripts/fetch-raw-samples.sh --verify-only   # verify existing files only
#   Q03_TESTDATA=/tmp/fresh scripts/fetch-raw-samples.sh   # fresh-environment check
set -euo pipefail
cd "$(dirname "$0")/.."

TARGET_DIR="${Q03_TESTDATA:-testdata}"
MANIFEST="$(pwd)/scripts/raw-samples.sha256"
MODE="${1:-fetch}"
BASE="https://raw.pixls.us/download/data"

samples() {
  echo "Canon/Canon%20EOS%20R6%20Mark%20III/IMG_4243.CR3|cr3/IMG_4243.CR3"
  echo "Canon/EOS%201000D/IMG_9406.CR2|cr2/IMG_9406.CR2"
  echo "Fujifilm/X-T4/DSCF0268.RAF|raf/DSCF0268.RAF"
  echo "Nikon/Z%206/DSC_0757.NEF|nef/DSC_0757.NEF"
  echo "Sony/ILCE-7M3/_DSC0009.ARW|arw/_DSC0009.ARW"
  echo "Olympus/E-M10/P3180165.ORF|orf/P3180165.ORF"
  echo "Ricoh/GR%20III/R0000357.DNG|dng/R0000357.DNG"
}

verify() {
  echo "verify $TARGET_DIR against scripts/raw-samples.sha256"
  (cd "$TARGET_DIR" && shasum -a 256 -c "$MANIFEST")
}

mkdir -p "$TARGET_DIR"
if [ "$MODE" != "--verify-only" ]; then
  while IFS='|' read -r rel dest; do
    mkdir -p "$TARGET_DIR/$(dirname "$dest")"
    if [ -s "$TARGET_DIR/$dest" ]; then echo "have $dest"; continue; fi
    echo "fetch $dest"
    curl -fsSL --retry 3 -o "$TARGET_DIR/$dest.part" "$BASE/$rel"
    mv "$TARGET_DIR/$dest.part" "$TARGET_DIR/$dest"
  done < <(samples)
fi
verify

if [ "$MODE" != "--verify-only" ]; then
  # Non-RAW control input for the honesty probe (must be rejected by the decoder)
  ffmpeg -y -hide_banner -loglevel error -f lavfi -i "testsrc2=size=640x480:duration=1" -frames:v 1 "$TARGET_DIR/notraw.jpg"
fi

ls -la "$TARGET_DIR"/*
