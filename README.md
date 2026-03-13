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

- `photography`
  - `title` (string)
  - `location` (string)
  - `date` (string)
  - `image` (string URL, optional)
  - `color` (string CSS gradient, optional)

- `travel`
  - `month` (string, e.g. "Nov")
  - `year` (number)
  - `location` (string)
  - `title` (string)
  - `excerpt` (string)
  - `image` (string URL, optional)
  - `hasPhoto` (boolean)

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

### Sample rules (public read)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read: if true;
      allow write: if false;
    }
  }
}
```

## GitHub Pages deploy

This repo includes a GitHub Actions workflow at `.github/workflows/deploy.yml`.

1. In GitHub, set repository variables:
   - `ASTRO_BASE` to `/stories-from-abroad/`
   - `SITE_URL` to `https://BirkleyG.github.io/stories-from-abroad/`
2. Add repository secrets for each `PUBLIC_FIREBASE_*` value.
3. Push to `main` to trigger deployment.

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
