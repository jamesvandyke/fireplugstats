# Fireplug Stats

Basketball stat tracker PWA: live scoring, box scores, shot charts, play-by-play, and shareable game summaries.

**Production:** https://fireplugstats-8f7f3.ondigitalocean.app

Deployed on DigitalOcean App Platform from `main` (see `.do/app.yaml`); every push to `main` redeploys.

## Running locally

```sh
npm install
npm start          # http://127.0.0.1:4173
npm run start:lan  # listen on 0.0.0.0 for phones on the same network
```

Saved games and teams are stored in DigitalOcean Spaces. Copy `.env.example` to `.env` and fill in the `DO_SPACES_*` values to enable them; without them those API routes return 503. `node scripts/seed.js` loads sample teams and games into Spaces (`--clear` removes them).
