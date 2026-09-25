# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

User-specified: two directories, `frontend/` (React + Vite + TypeScript, Yarn) and `backend/` (Node.js API, MongoDB). The frontend is deployed to Cloudflare with Wrangler; the backend runs on host.md (Plesk, Node.js).
Delegated details: Hono API bundled to a single Node.js file for Plesk/Passenger (it can also run on Cloudflare Workers with a Durable Object), MongoDB Atlas as the database, the Cloudflare Worker proxies `/api/*` to the backend so the app stays same-origin, Tailwind CSS v4 design tokens, react-i18next, TanStack Query, vite-plugin-pwa. Icons: MUI free icons, Rounded variant (user-specified).

## Users

- **Clients and future clients** of one nail studio in Chișinău. Almost always on a phone, often arriving from Instagram or a shared link, sometimes installing the app to the home screen. They want to see services and prices, book a time, and manage their appointments without messaging back and forth. Languages: Romanian, Russian, English.
- **Admin** (studio staff / master): runs the day. Checks today's appointments, confirms, marks completed or no-show, books clients who call, blocks time off. Mostly on a phone between clients, sometimes on a laptop.
- **Administrator** (owner): everything an admin does, plus services and prices, team, working hours, user roles and studio settings.

## Product Purpose

A brand-owned booking app for a single nail studio. Clients book in a few taps and manage appointments and their profile; the studio runs its calendar, clients and services in the same app. Success: clients book on their own instead of in DMs, the day's schedule is always accurate, and the app feels like the studio rather than a marketplace.

## Positioning

Marketplaces (Fresha, Booksy, Treatwell) put the studio next to competitors and inside someone else's brand. This is the studio's own app: no other salons, no marketplace clutter, the Nails by Alynna brand on every screen, installable to the home screen like a native app.

## Operating Context

- Mobile-first web app that installs as a PWA; `/app` explains installation on Android (install prompt) and iOS (Share → Add to Home Screen) and the app runs in standalone mode.
- Desktop is fully responsive for both clients and the admin dashboard, but phones are the primary device for every role.
- URLs: Romanian is the default language without a prefix (`/login`), Russian and English are prefixed (`/ru/login`, `/en/login`); `/` and `/ro/…` redirect to the unprefixed Romanian routes.
- On every cold start the app shows the brand splash for about 2–3 seconds (Figma "App Prototype _Start").
- Deploys go through a script that ships new images, app info and translation JSON so installed apps update.

## Capabilities and Constraints

- Roles: `client`, `admin`, `administrator`. Every user has name and surname.
- Auth: sign up and log in with email + password, or continue with Google. "Remember me" keeps a user signed in for up to a year; forms work with password managers. JWT-based sessions, hardened for security.
- Booking flow: choose services → (choose master, only when the studio has more than one) → date and time → confirm. Instant confirmation by default; the administrator can switch the studio to "requires approval".
- Team: one master today (Alina). The UI and flow stay single-master until an admin adds more masters, then master choice appears automatically.
- Clients: appointments (upcoming/past, reschedule, cancel within the policy), profile (details, language, password, sign out, delete account).
- Admin code must never load for clients, and the installed app's offline cache excludes the admin dashboard.
- Currency MDL; studio timezone Europe/Chisinau.
- Undecided / to be supplied by the studio: real address, phone, Instagram handle, final service list and prices, photos of work. Seeded values are placeholders editable in the admin settings.

## Brand Commitments

- Name: **Nails by Alynna**. Logo (supplied, `frontend/brand/logo.svg`): hot-pink `#FD2578` "nails" wordmark with a polish brush and drop, "by alynna", "— NAIL SALON —". Repository name `nails-by-alynna`.
- Tagline from the Figma prototype: "Your nails. Your rules." with "Consider this your personal space for beautiful nails and bold ideas."
- Colors supplied by the user: primary `#F0AEF0`, secondary `#FDE7FC`, text `#252726`, cyan light `#EDFDFE`, cyan `#3DBFCC`, orange light `#FFF6E9`, orange `#FD9B1D`; more colors may be derived from these.
- Figma prototype screens to follow: Start (splash on the soft pink field with the logo), Select login (logo, tagline, "Login With Email", "Continue with Google", sign-up footer), Email login, Home with a floating tab menu (to be made better).
- User moodboard, to be followed in spirit, not copied: soft pastel tiles, large tightly-set bold headlines, letter-spaced small caps labels, black pill primary buttons, floating pill bottom navigation.
- Icons: MUI free icons, Rounded variant.

## Evidence on Hand

- Figma prototype as a screenshot (4 screens). The Figma file itself is not readable by tools (no Dev Mode access yet).
- Official logo SVG supplied by the studio (`frontend/brand/logo.svg`); favicon, app icons and iOS launch screens are generated from it on every build.
- No photos of real work, reviews, testimonials, real prices or address yet. Nothing of that kind may be invented as fact; demo content is labeled and editable.

## Product Principles

1. Book in under a minute from the home screen, one hand, one thumb.
2. The studio's brand, never a marketplace: no clutter, no competitors, no upsell noise.
3. Fast and installable on a mid-range phone; admin weight never slows clients down.
4. Secure by default: client data and sessions are protected, staff powers are scoped by role.
5. Grows with the studio: one master today, a team tomorrow, without a redesign.

## Accessibility & Inclusion

- Trilingual (ro/ru/en): fonts must cover Romanian diacritics (ș, ț, ă, â, î) and Cyrillic; layouts must survive longer Russian strings.
- Text meets WCAG 2.2 AA contrast; the light brand pinks are used as fields and accents, not as small text on white.
- Touch targets at least 44px, visible focus states, reduced motion respected (splash and transitions included).
