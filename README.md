# Nails by Alynna

The studio's own booking app for **Nails by Alynna**, a nail salon in Chișinău: clients book, move and cancel their visits, collect loyalty stamps and get reminders; the team runs the day from the same app. It installs on a phone's Home Screen like a native app (PWA), in Romanian, Russian and English.

- **Clients**: services and prices, booking in a few taps (services → master → time → confirm), upcoming and past visits, reschedule and cancel within the studio's rules, add to calendar, loyalty card with a QR code (the 4th visit −15%, the 8th −30% by default), profile, devices, data export and account deletion, notifications (email and push reminders before a visit).
- **Staff** (`/admin`, roles `admin` and `administrator`): today's schedule and requests to confirm, calendar, bookings with every status change and rescheduling, new bookings for walk-ins with a QR invite to the app, clients, loyalty card scanner, price list (managed defaults, edits kept across updates), team hours and time off, studio settings, roles and the activity log (owner only).
- **Sign-in**: email and password with email verification codes, Google, and a read-only client demo (`demo` / `demo`).

## Stack

| Part | Tech |
| --- | --- |
| Frontend | React 19, Vite, TypeScript, Tailwind CSS v4, TanStack Query, React Router 7 (data router), i18next, vite-plugin-pwa |
| Backend | Hono on Node.js 22 (host.md) or Cloudflare Workers, MongoDB 7 driver, zod, jose (JWT in httpOnly cookies) |
| Hosting | Cloudflare Worker serves the app and proxies `/api` to the API; the API runs on host.md (Plesk, Passenger); MongoDB Atlas |

```
frontend/   the PWA (src/pages client screens, src/admin staff screens, worker/ Cloudflare Worker)
backend/    the API (src/modules/* routes and services, src/db types and indexes, test/ vitest)
scripts/    deploy.mjs: one command to build, upload and verify
```

## Getting started

Requirements: Node.js 22+, Yarn 1, and MongoDB (Docker, Homebrew or an Atlas cluster).

```bash
yarn setup                      # install root, backend and frontend
yarn db:up                      # local MongoDB in Docker (optional)
cp backend/.env.template backend/.env   # then fill in the values it asks for
yarn seed                       # price list, team and settings (add --demo for sample data)
yarn dev                        # API on :8787, app on http://localhost:5180
```

To try the app on a phone on the same Wi-Fi, run `yarn --cwd frontend dev:lan` and open the "Network" address it prints. The dev server behaves like the installed app: "Add to Home Screen" works, and an app resumed after code changes offers **Update**.

## Checks

```bash
yarn check        # typecheck, lint, tests and production builds, both apps
```

Backend tests run against a throwaway MongoDB database (`vitest`); frontend tests cover components, flows and every staff screen against realistic data.

## Configuration

Every setting is documented in the templates, never in code:

- `backend/.env.template` (development) and `backend/.env.production.template` (production): database, JWT secret, app URL, Google sign-in, email (EmailJS or Resend), web push keys, demo accounts.
- `.env.deploy.template`: host.md FTP account and the API origin the Worker proxies to.

The real files (`backend/.env`, `backend/.env.production`, `.env.deploy`) are git-ignored and must never be committed.

## Deploying

```bash
yarn deploy            # API to host.md, then the web app to Cloudflare, then live checks
yarn deploy web        # only the web app (Cloudflare Worker: assets + /api proxy)
yarn deploy api        # only the API (Node bundle over FTPS, then a restart)
yarn deploy verify     # only the live checks (also: yarn deploy:verify)
```

Add `--dry-run` to build and check without uploading. The API refuses to start in production with placeholder settings; `yarn --cwd backend check-env` shows what is missing.

## iPhone notes

- Added to the Home Screen, the app opens full screen at its own start page and signs in separately from Safari (iOS keeps their storage apart).
- Swiping from the left edge goes back, as in Safari; the app skips its own page fade when iOS animates the swipe.
- Push notifications work only in the Home Screen app (iOS 16.4+); email reminders work everywhere.
- Files (calendar events, data export) open in iOS's own sheets, so the installed app never gets stuck on a file.

## License

MIT
