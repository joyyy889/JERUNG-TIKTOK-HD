# JERUNG STUDIO API

Separate Node.js/FFmpeg processing service for Project 3. It does not share Project 1 or Project 2 databases, WhatsApp sessions, folders, ports, or processes.

## Requirements

- Ubuntu VPS
- Node.js 20+
- MySQL 8+ (dedicated database and user for Project 3)
- FFmpeg and FFprobe available on PATH
- HTTPS reverse proxy before public use

## MySQL setup

Create a dedicated database and restricted application user. Run as a MySQL administrator, replacing the password with a strong unique secret:

```sql
CREATE DATABASE jerung_studio CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'jerung_studio_user'@'127.0.0.1' IDENTIFIED BY 'REPLACE_WITH_A_STRONG_PASSWORD';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, INDEX, ALTER
  ON jerung_studio.* TO 'jerung_studio_user'@'127.0.0.1';
FLUSH PRIVILEGES;
```

The API creates the `users` and `jobs` tables. The MySQL session store creates its `sessions` table. The application user needs the listed permissions for startup migrations and session storage. Keep this database separate from Project 2.

## Google OAuth setup

1. Create a Google OAuth 2.0 Web application client.
2. Configure the Google consent screen as External. While the app is in Testing, add each tester under Audience > Test users. For general public access, complete Google's publishing/verification requirements as applicable.
3. On the Google OAuth client, add the frontend origin to Authorized JavaScript origins, for example `https://studio.example.com`.
4. Add the exact backend callback URL to Authorized redirect URIs, for example `https://api.example.com/auth/google/callback`.
5. Put the client ID and new client secret only in the API server environment. Never put the secret in Vite/frontend variables or Git.
6. Set `GOOGLE_CALLBACK_URL`, `FRONTEND_URL`, and `CORS_ORIGIN` to the deployed HTTPS addresses. Use `SESSION_COOKIE_SAME_SITE=none` only if frontend and API are genuinely cross-site; it requires HTTPS. Same-site subdomains can generally use `lax`.

Google login is open to any Google account permitted by the OAuth consent screen. The API requires a verified Google email. First login creates a user row automatically.

## Environment and local setup

```bash
cd studio-api
npm install
cp .env.example .env
npm start
```

Generate a long random `SESSION_SECRET`; never commit `.env`. The default API bind address is 127.0.0.1 and port is 4317. Put the service behind an HTTPS reverse proxy; do not expose it directly.

## Authentication endpoints

- `GET /auth/google` — start Google sign-in.
- `GET /auth/google/callback` — Google OAuth callback; creates/signs in the user and redirects to the frontend.
- `GET /auth/me` — current session user.
- `POST /auth/logout` — destroy the current session.

Sessions are stored in the Project 3 MySQL database and use an HttpOnly cookie. Google OAuth state is handled by Passport. User-facing API endpoints require an authenticated session; no API key is exposed in the browser.

## Video API

- `POST /api/videos` — authenticated multipart upload; field name `video`.
- `GET /api/jobs/:id` — authenticated job status, scoped to its owner.
- `GET /api/videos` — authenticated list of the current user's last 100 completed videos.
- `GET /api/videos/:id/download` — authenticated download, scoped to its owner.
- `GET /health` — MySQL health check.

Uploads are associated with the signed-in user's ID. A user cannot read or download another user's jobs. Existing jobs from before this migration retain a NULL owner and are not exposed through user-scoped endpoints.

## Processing policy

1. FFprobe inspects actual streams and metadata.
2. Compatible MP4 + H.264/H.265 + supported audio uses strict pass-through.
3. H.264/H.265 in another container is remuxed to MP4.
4. Incompatible audio is converted to AAC while compatible video is stream-copied where possible.
5. Other video codecs are converted to H.264.
6. If remux fails, one fallback encode is attempted.
7. FFprobe verifies the final MP4 container and H.264/H.265 video codec.

TikTok may still transcode uploaded videos; this pipeline cannot guarantee zero compression.

## Storage and deployment

Video files remain on disk; MySQL stores user records, sessions, job metadata, statuses, errors, and paths. Back up the database and video storage separately. Use a dedicated PM2 process, env file, data directories, and reverse-proxy route. Deployment is not performed by this repository change.
