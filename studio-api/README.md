# JERUNG STUDIO API

Separate Node.js/FFmpeg processing service for Project 3. It does not share Project 1 or Project 2 databases, WhatsApp sessions, folders, ports, or processes.

## Requirements

- Ubuntu VPS
- Node.js 20+
- MySQL 8+ (dedicated database and user for Project 3)
- FFmpeg and FFprobe available on PATH (or set FFMPEG_PATH / FFPROBE_PATH)
- A private reverse-proxy route and HTTPS before public use

## MySQL setup

Create a dedicated database and restricted application user. Run these statements as a MySQL administrator, replacing the password with a strong unique secret:

```sql
CREATE DATABASE jerung_studio
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER 'jerung_studio_user'@'127.0.0.1'
  IDENTIFIED BY 'REPLACE_WITH_A_STRONG_PASSWORD';

GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, INDEX
  ON jerung_studio.* TO 'jerung_studio_user'@'127.0.0.1';

FLUSH PRIVILEGES;
```

The API creates its `jobs` table automatically at startup. Keep this database separate from Project 2's existing database and credentials.

## Local setup

```bash
cd studio-api
npm install
cp .env.example .env
```

Set DB_HOST, DB_PORT, DB_NAME, DB_USER, and DB_PASSWORD in `.env`. Also set a random API_KEY of at least 32 characters and adjust CORS_ORIGIN. Keep `.env` out of Git. Then:

```bash
npm start
```

The default bind address is 127.0.0.1 and port is 4317. Do not expose this service directly to the public internet; put it behind an HTTPS reverse proxy. Keep API_KEY secret. The current API is a private integration foundation, not a finished multi-user authentication system.

## API

- `GET /health` — health check, including MySQL connectivity.
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

Metadata is recorded before and after processing. Metadata that a codec/container cannot preserve may change during re-encoding. TikTok may still transcode uploaded videos; this pipeline cannot guarantee zero compression.

## Storage

Video uploads and outputs remain on disk under UPLOAD_DIR and OUTPUT_DIR. MySQL stores job records, statuses, metadata, errors, timestamps, and file paths; it does not store the video binaries. Back up the MySQL database and video storage separately. Do not place either inside Project 2 directories.

## Deployment notes

Use a dedicated PM2 process name (for example `jerung-studio-api`), dedicated environment file, dedicated data directories, and dedicated reverse-proxy location/subdomain. Do not reuse Project 2 ports, database credentials/tables, WhatsApp auth/session directories, or process names. Confirm the VPS's existing MySQL service, port map, and reverse-proxy configuration before deployment.
