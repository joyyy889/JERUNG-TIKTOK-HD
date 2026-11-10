# JERUNG STUDIO

A separate creator-style video workspace inside the JERUNG-TIKTOK-HD repository. This folder does not modify the existing WhatsApp bot or MP4 test engine.

## Phase 1
Responsive dark-premium dashboard, local file selection and metadata preview only. No cloud upload or authentication is active yet.

## Planned stack
- React + Vite
- Cloudflare Pages (frontend)
- Cloudflare Workers (API)
- Cloudflare R2 (private video storage)
- Cloudflare D1 (metadata and users)

## Run locally
```bash
cd studio-web
npm install
npm run dev
```

## Security
Never commit API tokens, R2 credentials, signing secrets, or user credentials. Real upload and role-based access will be implemented in later phases.
