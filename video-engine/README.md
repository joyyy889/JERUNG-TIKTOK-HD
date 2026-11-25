# JERUNG TIKTOK HD — video engine

This isolated Node.js video engine does not modify the existing `studio-web` frontend.

## Processing modes

The engine supports two modes, selected using `JERUNG_ENCODE_MODE`:

- `remux-first` (default): preserves the compressed video bitstream using stream-copy/remux. If integrity verification fails, one adaptive x264 fallback is attempted.
- `adaptive`: deliberately re-encodes every input with libx264. This rebuilds the I/P/B frame decisions and GOP layout using per-input settings.

## Adaptive encoding

In adaptive mode, FFprobe metadata is used to choose a conservative starting CRF and GOP ceiling. The current heuristic considers resolution, nominal frame rate and approximate bits-per-pixel-per-frame. It is a bounded starting-point heuristic, not a claim that the mathematically optimal CRF can be known from metadata alone.

The encoder configures:

- libx264 with CRF selected per input (default range 16–22)
- B-frames enabled (3)
- GOP maximum based on input frame rate (approximately two seconds)
- minimum keyframe interval based on input frame rate (approximately half a second)
- scene-cut keyframe decisions enabled
- closed GOP
- source resolution and frame timing retained (no scaling, `-fps_mode passthrough`)
- audio stream-copy in the adaptive path

Override CRF using `JERUNG_CRF` (0–51), or preset using `JERUNG_X264_PRESET`. CRF is a quality target, not a file-size cap: output may be larger than the source. Lower CRF means higher quality and generally larger files.

## Requirements

- Node.js 20+
- FFmpeg and FFprobe installed and available in PATH
- FFmpeg build with libx264 for adaptive mode

## Run

```bash
cd video-engine
npm test

# Existing integrity-first behavior
npm run optimize -- /path/to/input.mp4 /path/to/output.mp4

# Force re-encode and rebuild frame/GOP structure
JERUNG_ENCODE_MODE=adaptive npm run optimize -- /path/to/input.mp4 /path/to/output.mp4
```

Environment variables:

| Variable | Default | Purpose |
|---|---:|---|
| `FFMPEG_PATH` | `ffmpeg` | FFmpeg executable |
| `FFPROBE_PATH` | `ffprobe` | FFprobe executable |
| `MAX_INPUT_BYTES` | `157286400` | Maximum input size (150 MiB) |
| `FFMPEG_TIMEOUT_MS` | `900000` | Per-process timeout |
| `JERUNG_ENCODE_MODE` | `remux-first` | `remux-first` or `adaptive` |
| `JERUNG_CRF` | auto | Optional manual x264 CRF override, 0–51 |
| `JERUNG_X264_PRESET` | `medium` | x264 speed/compression preset |

## Important limits

Re-encoding necessarily changes compressed frame data and may alter visual details. The engine validates resolution, frame rate, duration and audio presence, but these checks do not prove perceptual equivalence. Run visual quality metrics and device playback tests on representative source clips before enabling adaptive mode in production.

This does not guarantee bypassing TikTok's server-side transcoding. No such guarantee is made.
