# GOP Re-encode Engine (experimental)

The `gop` command creates a new H.264 bitstream and GOP structure. It is separate from the existing verified stream-copy/remux command.

```bash
npm run gop -- input.mp4 output.mp4
```

## Processing flow

1. FFprobe inspects source codec, dimensions, FPS, duration, pixel format, color transfer and audio streams.
2. The current safe profile accepts one H.264, 8-bit, SDR, yuv420p video stream. HDR PQ/HLG, 10-bit, HEVC, subtitle/data/attachment streams and ambiguous frame rates are rejected before encoding.
3. FFmpeg/libx264 re-encodes video with a 2-second maximum GOP, adaptive scene-change keyframes, 3 B-frames, closed GOP, CRF 18 and medium preset.
4. Source audio is stream-copied; it is not re-encoded.
5. FFprobe validates resolution, FPS, duration, decoded frame count, pixel format and audio configuration.
6. The output is atomically published only after validation. Temporary files are removed on failure.

## Initial GOP settings

| Setting | Default |
|---|---:|
| Encoder | libx264 |
| CRF | 18 |
| Preset | medium |
| GOP max interval | 2 seconds |
| B-frames | 3 |
| Scene-cut detection | enabled |
| Open GOP | disabled |
| Audio | stream copy |
| Output | MP4 |

The values are an initial controllable profile, not confirmed KilatFrame internals. The ORI/KilatFrame sample comparison did not establish KilatFrame's exact encoder, GOP length, B-frame count, or rate-control settings.

## Important limitations

- Re-encoding changes encoded video data and may change visual quality and file size. CRF 18 is a quality-oriented starting point, not a guarantee that output will be smaller.
- This first profile deliberately rejects HDR, 10-bit, HEVC, and non-yuv420p sources rather than silently damaging them. A separate codec/color-aware profile is required before supporting those inputs.
- The engine preserves the decoded frame count and nominal FPS, but source VFR timing should be validated with real fixtures before production use.
- No claim is made that this reproduces KilatFrame exactly or bypasses TikTok's server-side transcoding.
- Real-media testing on iOS, Android and TikTok upload is still required.
