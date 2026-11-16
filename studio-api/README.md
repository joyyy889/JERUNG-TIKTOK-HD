# JERUNG STUDIO API

Separate Node.js/FFmpeg processing service for Project 3. It does not share Project 1 or Project 2 databases, WhatsApp sessions, folders, ports, or processes.

## Requirements

- Ubuntu VPS
- Node.js 20+
- FFmpeg and FFprobe available on PATH (or set FFMPEG_PATH / FFPROBE_PATH)
- A private reverse-proxy route and HTTPS before public use

## Local setup

```bash
cd studio-api
npm install
cp .env.example .env
```

Set a random API_KEY of at least 32 characters and adjust CORS_ORIGIN. Keep .env out of Git. Then:

```bash
npm start
```

The default bind address is 127.0.0.1 and port is 4317. Do not expose this service directly to the public internet; put it behind an HTTPS reverse proxy. Keep API_KEY secret. The current API is a private integration foundation, not a finished multi-user authentication system.

## API

- `GET /health` — health check, no secret required.
- `POST /api/videos` — authenticated multipart upload; field name `video`. Returns HTTP 202 with a job ID.
- `GET /api/jobs/:id` — authenticated processing status and input/output metadata.
- `GET /api/videos` — authenticated list of completed videos.
- `GET /api/videos/:id/download` — authenticated MP4 download.

Send the secret in the `X-API-Key` header. Default maximum upload size is 500 MB. Processing concurrency defaults to one job to protect the VPS.

## Processing policy

1. FFprobe inspects the actual file streams and metadata; extension/MIME alone is not trusted.
2. Compatible MP4 + H.264/H.265 + supported audio uses strict pass-through (byte-for-byte copy).
3. H.264/H.265 in another container uses remux to MP4 with video stream copy.
4. Incompatible audio is converted to AAC while keeping compatible H.264/H.265 video stream-copy where possible.
5. Other video codecs are converted to H.264.
6. If a remux fails, one fallback encode is attempted: H.264 stays H.264; HEVC stays HEVC; other codecs target H.264.
7. FFprobe verifies the final MP4 container and H.264/H.265 video codec before the job is marked completed.

Metadata is recorded before and after processing. Metadata that a codec/container cannot preserve may change during re-encoding. TikTok may still transcode uploaded videos; this pipeline cannot guarantee zero compression on TikTok.

## Storage

Uploads, outputs, and SQLite metadata are stored under DATA_DIR (default `./data`). This folder is intentionally ignored by Git. Back it up separately and do not place it inside Project 2 directories.

## Deployment notes

Use a dedicated PM2 process name (for example `jerung-studio-api`), dedicated environment file, dedicated data directory, and dedicated reverse-proxy location/subdomain. Do not reuse Project 2 ports, DB files, WhatsApp auth/session directories, or process names. Confirm the VPS's existing port map and reverse-proxy configuration before deployment.