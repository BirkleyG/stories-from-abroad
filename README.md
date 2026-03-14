# Stories From Abroad

Astro site for a splash page plus four sections:
- Selected Papers & Op-Eds
- Photography
- Travel Stories
- Faces of the World

## Local setup

```bash
npm install
npm run dev
```

## Firestore configuration

Create a Firebase project, enable Firestore, then copy the Web App config values into a local `.env` file.

```
PUBLIC_FIREBASE_API_KEY=
PUBLIC_FIREBASE_AUTH_DOMAIN=
PUBLIC_FIREBASE_PROJECT_ID=
PUBLIC_FIREBASE_STORAGE_BUCKET=
PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
PUBLIC_FIREBASE_APP_ID=
```

### Firestore collections

The site expects these collections and fields:

- `papers`
  - `title` (string)
  - `category` (string)
  - `year` (number)
  - `date` (string)
  - `keywords` (array of strings)
  - `readTime` (string)
  - `type` (string)
  - `featured` (boolean)
  - `summary` (string)

- `scrap_sheet_posts`
  - `category` (string)
  - `location` (string)
  - `date` (timestamp or string)
  - `time` (string)
  - `title` (string)
  - `preview` (string)
  - `full` (string)
  - `photos` (array of `{ url, caption }`, optional)
  - `pinned` (boolean, optional)

- `scrap_sheet_quotes`
  - `text` (string)
  - `postId` (string or number)

- `subscribers/{uid}`
  - `email` (string, must match authenticated user email)
  - `emailLower` (string)
  - `name` (string)
  - `status` (`"active"`)
  - `preferences` (array of strings)
  - `source` (string)
  - `createdAt` / `updatedAt` (server timestamps)

- `comment_throttles/{uid}`
  - `uid` (string, matches auth uid)
  - `windowStart` (timestamp)
  - `count` (number, max 3 inside rolling 60s window)
  - `updatedAt` (server timestamp)

- `scrap_sheet_posts/{postId}/comments/{commentId}`
  - `authorUid` (string)
  - `authorName` (string)
  - `text` (string)
  - `createdAt` (server timestamp)

- `scrap_sheet_posts/{postId}/anon_reactions/{anonId}`
  - `reactions` (map of quick reactions to booleans)
  - `updatedAt` (server timestamp)

- `faces`
  - `slug` (string, optional)
  - `name` (string)
  - `age` (number, optional)
  - `religion` (string, optional)
  - `occupation` (string, optional)
  - `city` (string)
  - `country` (string)
  - `date` (string in `YYYY-MM-DD`, or `year` number)
  - `lngLat` (array `[lng, lat]`)
  - `pic` (number seed or image URL string, optional)
  - `descriptor` (string, optional)
  - `excerpt` (string, optional)
  - `article` (array of blocks, optional)
    - paragraph block: `{ "type": "para", "text": "..." }`
    - quote block: `{ "type": "pull", "text": "..." }`
    - Q&A block: `{ "type": "qa", "q": "...", "a": "..." }`
    - photo block: `{ "type": "photo", "id": "p1" }`
  - Back-compat fields (`location`, `note`, `image`) are normalized when present.

If Firestore is not configured or not reachable, the site renders the fallback content from `src/lib/fallbackData.ts`.

### Authentication + comment gate

- Travel comments require Firebase email-link auth and an active `subscribers/{uid}` record.
- Comment writes are rate-limited to **3 comments / 60 seconds** via `comment_throttles/{uid}` rule validation.
- Reactions stay anonymous and write to `anon_reactions` subdocuments only.
- Firestore security is defined in `firestore.rules`.
- Enable the Email/Password provider with **Email link (passwordless sign-in)** in Firebase Auth, and add your site domains to Authorized domains.

### Rules deploy

```
firebase deploy --only firestore:rules,firestore:indexes
```

## GitHub Pages deploy

This repo includes a GitHub Actions workflow at `.github/workflows/deploy.yml`.

1. In GitHub, set repository variables:
   - `ASTRO_BASE` to `/stories-from-abroad/`
   - `SITE_URL` to `https://BirkleyG.github.io/stories-from-abroad/`
2. Add repository secrets for each `PUBLIC_FIREBASE_*` value.
3. Push to `main` to trigger deployment.

## Security debt (deferred major upgrades)

`npm audit --omit=dev` currently reports advisories that require major-version upgrades:

- `astro` -> `6.x` (breaking)
- `firebase` -> `12.x` (breaking)

These are intentionally deferred for a dedicated migration pass.

## Project structure

```
src/
  layouts/
    BaseLayout.astro
  lib/
    firebaseClient.ts
    fallbackData.ts
  pages/
    index.astro
    selected-papers.astro
    photography.astro
    travel-stories.astro
    faces-of-the-world.astro
  styles/
    global.css
```
