# JERUNG TIKTOK HD

WhatsApp bot project for preparing video files for TikTok Studio upload.

## MP4 copy-only test engine

The first test stage is deliberately separate from the WhatsApp bot. It creates two safe reference remuxes using stream copy (no video/audio re-encoding) and reports MP4 sample-table metadata, including `stts` and `stsc`.

```bash
npm install
npm run test:mp4 -- ./input.mp4 ./mp4-test-output
```

Outputs:
- `output-1-copy-reference.mp4`: copy-only MP4 reference.
- `output-2-copy-faststart-reference.mp4`: copy-only MP4 with the `moov` metadata moved for fast-start playback.
- `mp4-test-report.json`: stream metadata, duration, top-level boxes, and `stts`/`stsc` entry counts.

These are valid reference MP4s, not the final requested special outputs. The engine does not corrupt sample tables, falsify duration, or claim to make a file playable only by Google Drive. A media file cannot be guaranteed to play exclusively in Google Drive; playback depends on the receiving service's transcoding and player behavior. Keep MP4 sample tables internally consistent and validate each output before delivery.

## Runtime

- Node.js 20+
- FFmpeg and FFprobe available on PATH, or configure `FFMPEG_PATH` and `FFPROBE_PATH`.
