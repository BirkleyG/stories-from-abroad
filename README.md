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
PUBLIC_FIREBASE_API_KEY=AIzaSyBCqnYFg7zLCvEbHUl4Fu37gPh5pxdobYA
PUBLIC_FIREBASE_AUTH_DOMAIN=stories-from-abroad.firebaseapp.com
PUBLIC_FIREBASE_PROJECT_ID=stories-from-abroad
PUBLIC_FIREBASE_STORAGE_BUCKET=stories-from-abroad.firebasestorage.app
PUBLIC_FIREBASE_MESSAGING_SENDER_ID=484837903165
PUBLIC_FIREBASE_APP_ID=1:484837903165:web:2e078798c7ed7eec191354
PUBLIC_FIREBASE_FUNCTIONS_REGION=us-central1
```

### Firestore collections

The site expects these collections and fields:

- Admin-only authoring collections:
  - `admin_faces`
  - `admin_papers`
  - `admin_dispatches`
  - `media_assets`
  - each admin document may include a `versions` subcollection

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
- `/admin` uses Firebase email-link auth plus an `admin: true` custom claim.
- Comment writes are rate-limited to **3 comments / 60 seconds** via `comment_throttles/{uid}` rule validation.
- Reactions stay anonymous and write to `anon_reactions` subdocuments only.
- Firestore security is defined in `firestore.rules`.
- This project is configured for Firebase email-link auth. Authorized domains should include `localhost`, `127.0.0.1`, `stories-from-abroad.firebaseapp.com`, `stories-from-abroad.web.app`, and `birkleyg.github.io`.

### Rules deploy

```
firebase deploy --only firestore:rules,firestore:indexes
```

## GitHub Pages deploy

This repo includes a GitHub Actions workflow at `.github/workflows/deploy.yml`.

The workflow now carries the public Firebase web config directly, so no GitHub secrets are required for the site build.

1. Push to `main` to trigger deployment.
2. GitHub Pages will publish to `https://birkleyg.github.io/stories-from-abroad/`.

## Admin backend deploy

The public site remains a static Astro build on GitHub Pages. Admin publishing, scheduling, and admin-claim workflows run through Firebase Functions.

1. Install the Functions dependencies:

```bash
cd functions
npm install
cd ..
```

2. Set the bootstrap admin email list for the first sign-in.
Use Firebase Functions parameterized config. Either let `firebase deploy` prompt you for `ADMIN_BOOTSTRAP_EMAILS`, or create the per-project env file manually:

```bash
functions/.env.<your-project-id>

ADMIN_BOOTSTRAP_EMAILS=you@example.com
```

3. Deploy Firestore rules, Storage rules, and Functions:

```bash
firebase deploy --only firestore:rules,firestore:indexes,storage,functions
```

4. If Firebase Storage has not been initialized yet, first open `https://console.firebase.google.com/project/stories-from-abroad/storage` and click `Get started`. This is the one remaining manual step because the bucket region choice is permanent.
5. Open `/admin`, request an email sign-in link, then use the `Claim admin access` button once the signed-in email matches the bootstrap allowlist.

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
