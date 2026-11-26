#!/usr/bin/env bash
# Synthesizes the Q03 video PoC fixtures (git-ignored: testdata/).
# Requires ffmpeg with libx264/libx265/libvpx-vp9/libsvtav1/libopus (tested with 7.1.1).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p testdata/video

# H.264 High + AAC-LC, 1280x720@30, 6 s
ffmpeg -y -hide_banner -loglevel error \
  -f lavfi -i "testsrc2=size=1280x720:rate=30:duration=6" \
  -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=6" \
  -f lavfi -i "sine=frequency=660:sample_rate=48000:duration=6" \
  -filter_complex "[1:a][2:a]amerge=inputs=2[a]" -map 0:v -map "[a]" \
  -c:v libx264 -profile:v high -pix_fmt yuv420p -g 60 -b:v 4M \
  -c:a aac -b:a 128k -movflags +faststart \
  testdata/video/h264_aac_720p_6s.mp4

# VP9 + Opus, 1280x720@30, 6 s
ffmpeg -y -hide_banner -loglevel error \
  -f lavfi -i "testsrc2=size=1280x720:rate=30:duration=6" \
  -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=6" \
  -f lavfi -i "sine=frequency=660:sample_rate=48000:duration=6" \
  -filter_complex "[1:a][2:a]amerge=inputs=2[a]" -map 0:v -map "[a]" \
  -c:v libvpx-vp9 -b:v 2M -g 60 -row-mt 1 -cpu-used 4 \
  -c:a libopus -b:a 96k \
  testdata/video/vp9_opus_720p_6s.webm

# H.264 High + AAC-LC, 1920x1080@30, 10 s (memory/throughput scaling)
ffmpeg -y -hide_banner -loglevel error \
  -f lavfi -i "testsrc2=size=1920x1080:rate=30:duration=10" \
  -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=10" \
  -f lavfi -i "sine=frequency=660:sample_rate=48000:duration=10" \
  -filter_complex "[1:a][2:a]amerge=inputs=2[a]" -map 0:v -map "[a]" \
  -c:v libx264 -profile:v high -pix_fmt yuv420p -g 60 -b:v 8M \
  -c:a aac -b:a 128k -movflags +faststart \
  testdata/video/h264_aac_1080p_10s.mp4

# HEVC + AAC, 640x360@30, 3 s (capability-detection probe only)
ffmpeg -y -hide_banner -loglevel error \
  -f lavfi -i "testsrc2=size=640x360:rate=30:duration=3" \
  -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=3" \
  -map 0:v -map 1:a -c:v libx265 -pix_fmt yuv420p -tag:v hvc1 -b:v 1M \
  -c:a aac -b:a 96k testdata/video/hevc_aac_360p_3s.mp4

# AV1 (SVT-AV1) + Opus, 640x360@30, 4 s
ffmpeg -y -hide_banner -loglevel error \
  -f lavfi -i "testsrc2=size=640x360:rate=30:duration=4" \
  -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=4" \
  -map 0:v -map 1:a -c:v libsvtav1 -preset 10 -crf 42 \
  -c:a libopus -b:a 64k testdata/video/av1_opus_360p_4s.webm

ls -la testdata/video
