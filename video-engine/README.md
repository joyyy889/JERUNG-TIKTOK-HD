# JERUNG TIKTOK HD — RTX Fury-style video engine

This is an isolated Node.js video-engine module added to the repository. It does not change the existing `studio-web` frontend. The current repository did not contain the WhatsApp bot/backend entry point, so this module is exposed as a CLI and is ready to be called by the VPS bot when that backend source is added.

## What it does

1. **Probe first:** reads codec, resolution, frame rate, duration and audio streams with FFprobe.
2. **Original / stream-copy path:** remuxes MP4/MOV to MP4 using FFmpeg `-c copy` and `-movflags +faststart`. It does not invoke a video encoder.
3. **Integrity checks:** compares FFprobe packet SHA-256 hashes and decoded `framemd5` checksums before accepting the stream-copy output.
4. **Property checks:** rejects output if resolution, frame rate, duration or the presence of audio changes unexpectedly.
5. **One fallback only:** if remux or integrity verification fails, it performs one H.264 fallback encode, with no scaling and passthrough frame timing. AAC audio is used in this fallback.
6. **Optional NVIDIA path:** set `JERUNG_USE_NVENC=1` to use `h264_nvenc` only when the installed FFmpeg build exposes that encoder. Otherwise it uses `libx264`.

## Requirements

- Node.js 20+
- FFmpeg and FFprobe installed on the VPS and available in PATH
- For NVIDIA encoding: compatible NVIDIA GPU, driver and FFmpeg build with `h264_nvenc`

## Run

```bash
cd video-engine
npm test
npm run optimize -- /path/to/input.mp4 /path/to/output.mp4
```

Environment variables:

| Variable | Default | Purpose |
|---|---:|---|
| `FFMPEG_PATH` | `ffmpeg` | FFmpeg executable |
| `FFPROBE_PATH` | `ffprobe` | FFprobe executable |
| `MAX_INPUT_BYTES` | `157286400` | Maximum input size (150 MiB) |
| `FFMPEG_TIMEOUT_MS` | `900000` | Per-process timeout |
| `JERUNG_USE_NVENC` | `0` | Enable NVENC for the fallback encode |

## Important limits — what “RTX Fury-style” means here

This implements the reproducible, low-risk part of the researched workflow: container remuxing, fast-start layout, stream preservation, metadata carry-over and integrity verification. It does **not** promise to bypass TikTok's server-side transcoding; no reliable public evidence proves any optimizer can guarantee that.

The research also discussed editing MP4 sample tables (`stts`, `ctts`, `stsc`), changing brands/handler fields and adding “ghost”/inflated sample entries. These are not automatically applied here. They can invalidate chunk offsets, timestamps, sample counts or playback, and the research did not establish that they improve TikTok's output. They should only be added after a separate fixture-based MP4 box parser/writer and device playback tests exist.

The fallback is intentionally a last resort and does not upscale, downscale or force a new nominal frame rate. Re-encoded output cannot have identical packet/frame hashes by definition, so its report clearly labels those checks as not applicable.
