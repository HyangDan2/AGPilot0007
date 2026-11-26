#!/usr/bin/env bash
# Downloads the Q03 RAW PoC samples into testdata/ (git-ignored).
# Source: raw.pixls.us sample corpus (CC0). Sizes below are what the PoC measured.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p testdata/{cr2,cr3,nef,arw,raf,orf,dng}

fetch() { # url dest
  if [ -s "$2" ]; then echo "have $2"; return; fi
  echo "fetch $2"
  curl -fsSL --retry 3 -o "$2.part" "$1"
  mv "$2.part" "$2"
}

fetch "https://raw.pixls.us/data/Canon/Canon%20EOS%20R6%20Mark%20III/IMG_4243.CR3" cr3/IMG_4243.CR3
fetch "https://raw.pixls.us/data/Canon/EOS%201000D/IMG_9406.CR2" cr2/IMG_9406.CR2
fetch "https://raw.pixls.us/data/Fujifilm/X-T4/DSCF0268.RAF" raf/DSCF0268.RAF
fetch "https://raw.pixls.us/data/Nikon/Z%206/DSC_0757.NEF" nef/DSC_0757.NEF
fetch "https://raw.pixls.us/data/Sony/ILCE-7M3/_DSC0009.ARW" arw/_DSC0009.ARW
fetch "https://raw.pixls.us/data/Olympus/E-M10/P3180165.ORF" orf/P3180165.ORF
fetch "https://raw.pixls.us/data/Ricoh/GR%20III/R0000357.DNG" dng/R0000357.DNG

# Non-RAW control input for the honesty probe (must be rejected by the decoder)
ffmpeg -y -hide_banner -loglevel error -f lavfi -i "testsrc2=size=640x480:duration=1" -frames:v 1 testdata/notraw.jpg

ls -la testdata/*/
