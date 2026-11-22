# Railway GOP Test Website

This branch adds a temporary browser-based test interface for the experimental GOP engine.

## Deploy on Railway

1. Create a new Railway project and deploy this GitHub repository.
2. Set the service Root Directory to `/video-engine`.
3. Use the Node.js buildpack. Railway installs dependencies from `package.json`.
4. Set these Variables:
   - `APP_ACCESS_KEY`: a long random secret used by the test website.
   - `MAX_INPUT_BYTES`: `157286400` (150 MiB).
   - `MAX_CONCURRENT_JOBS`: `1` initially.
   - `OUTPUT_RETENTION_MINUTES`: `30`.
   - `FFMPEG_TIMEOUT_MS`: `900000`.
5. Ensure the runtime image provides both `ffmpeg` and `ffprobe` on PATH. If the Railway builder image does not include them, use a Dockerfile based on a Node 20 Debian image and install FFmpeg from apt.
6. Generate a Railway public domain and open the site.

## Test flow

- Enter the access key and upload an MP4/MOV.
- The server runs FFprobe on the original file.
- The existing experimental H.264 GOP engine re-encodes video and stream-copies audio.
- FFprobe validates the output before it is made available for download.
- Input/output files are stored temporarily on Railway's ephemeral filesystem and deleted after the configured retention period.

## Limitations

This is a test harness, not production hosting. One job is allowed at a time by default. Files are not persisted across redeploys/restarts. The current engine rejects HEVC, HDR PQ/HLG, 10-bit, non-yuv420p, subtitle/data/attachment streams, and unsupported frame-rate inputs. A successful unit-test run does not replace real-video and Android/iOS playback tests.
