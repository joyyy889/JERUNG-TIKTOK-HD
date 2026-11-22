# JERUNG TIKTOK HD — experimental media-preserving engine

This branch contains an isolated engine prototype. It does not alter the studio-web frontend or connect to a production bot/backend.

## Current processing policy

**Verified stream-copy/remux only.** The engine never silently re-encodes. It maps all input streams, carries metadata and chapters, writes an MP4 with fast-start layout, then verifies the result before publishing it.

1. Probe source streams with FFprobe.
2. Remux with FFmpeg `-map 0 -c copy`.
3. Compare source/output packet SHA-256 hashes and decoded video frame checksums.
4. Validate video codec, resolution, nominal frame rate, duration, pixel format, bit depth/profile, color signalling, audio stream configuration and stream inventory.
5. Publish the temporary output only after every check passes.

If any check fails, processing stops and returns an error. There is no automatic H.264/AAC fallback. This is deliberate: a generic H.264 8-bit fallback can damage HEVC, 10-bit, HDR/HLG/PQ or Dolby Vision sources, change audio, and increase file size. A future encoder path must be codec- and color-aware, opt-in, and separately tested.

## Analysis mode

The analysis command reports codec/profile, dimensions, frame-rate fields, pixel format, bit depth, color primaries/transfer/matrix/range, aspect ratios, audio stream properties, video packet count, keyframe packet indexes, packet-duration variation and timestamp coverage.

```bash
cd video-engine
npm run analyze -- /path/to/input.mp4
```

This packet inspection is diagnostic, not a complete H.264/HEVC reference-dependency or closed-GOP proof. Keyframe flags alone do not prove that arbitrary segments can be independently concatenated.

## Optimize mode

```bash
cd video-engine
npm test
npm run optimize -- /path/to/input.mp4 /path/to/output.mp4
```

Requirements: Node.js 20+, FFmpeg and FFprobe in PATH (or set `FFMPEG_PATH` / `FFPROBE_PATH`).

Environment variables:

| Variable | Default | Purpose |
|---|---:|---|
| `FFMPEG_PATH` | `ffmpeg` | FFmpeg executable |
| `FFPROBE_PATH` | `ffprobe` | FFprobe executable |
| `MAX_INPUT_BYTES` | `157286400` | Maximum input size (150 MiB) |
| `FFMPEG_TIMEOUT_MS` | `900000` | Per-process timeout |

## KilatFrame comparison: evidence vs hypothesis

The ORI/KilatFrame sample comparison previously recorded in the project notes found matching stream-level properties and very similar decoded output, while hundreds of video packet/frame hashes differed and most audio packets matched. This establishes that the output was not a byte-identical remux. It does **not** establish whether KilatFrame uses selective re-encoding, bitstream rewriting, GOP restructuring or another technique.

This prototype therefore implements the safe, reproducible baseline first. It does not claim to clone KilatFrame or guarantee TikTok upload behavior. TikTok may still transcode uploaded media on its servers.

## Deliberately not implemented yet

- Segment-level selective re-encoding or GOP splicing. Arbitrary H.264/HEVC segment joins can break reference frames, SPS/PPS compatibility, DTS/PTS continuity, audio alignment and playback.
- MP4 sample-table manipulation (`stts`, `ctts`, `stsc`, chunk offsets or sample counts). These require a dedicated parser/writer and fixture-based validation.
- HDR10/Dolby Vision metadata rewriting or RPU preservation.
- Website upload/backend integration, storage, queueing or VPS deployment.

## Test coverage and remaining validation

Unit tests cover preservation guards for codec, resolution, FPS, color/bit-depth signalling and audio configuration. Before production use, run real-media fixtures covering H.264, HEVC, VFR, HDR10/HLG, multiple audio tracks and MOV inputs. Compare packet/frame hashes, SSIM/PSNR (for any future encode path), GOP/keyframes, timestamps, audio sync, file size/bitrate and playback on iOS/Android.

No production branch or deployment is changed by this experimental branch.
