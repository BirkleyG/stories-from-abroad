# Birkley — Personal Site

Built with [Astro](https://astro.build). Black/white base with pink, blue, and orange accents.

## Setup

```bash
npm install
npm run dev       # localhost:4321
npm run build     # production build
```

## Project Structure

```
src/
├── layouts/
│   └── Layout.astro          ← Shared nav + shell (all pages use this)
├── pages/
│   ├── about.astro            ← About page
│   ├── photography/
│   │   ├── index.astro        ← Photography home (parallax featured + shoots grid)
│   │   └── [slug].astro       ← Individual shoot gallery (to be built)
│   └── writing/
│       └── index.astro        ← Writing index (to be built)
└── styles/
    └── global.css             ← Design tokens, nav, shared utilities
```

## Design Tokens

| Token   | Value     | Use              |
|---------|-----------|------------------|
| `--k`   | `#080808` | Background black |
| `--w`   | `#F0EFEB` | Off-white text   |
| `--pk`  | `#FF2D78` | Pink accent      |
| `--bl`  | `#1478FF` | Blue accent      |
| `--or`  | `#FF6500` | Orange accent    |

## Adding Real Photos

Replace `demo:` URLs in `photography/index.astro` with your actual image paths:
- Drop full-size images in `public/photos/featured/`
- Drop shoot covers in `public/photos/covers/`
- Astro serves everything in `public/` at the root automatically

## Next Pages to Build

- `src/pages/photography/[slug].astro` — individual shoot gallery + lightbox
- `src/pages/writing/index.astro` — essays and research index
- `src/pages/index.astro` — site home / landing page
