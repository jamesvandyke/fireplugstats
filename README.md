# Fireplug Stats

Basketball stat tracker PWA: live scoring, box scores, shot charts, play-by-play, and shareable game summaries.

**Production:** https://fireplugstats-8f7f3.ondigitalocean.app

Deployed on DigitalOcean App Platform from `main` (see `.do/app.yaml`); every push to `main` redeploys.

## Running locally

```sh
npm install
npm start          # http://127.0.0.1:4173
npm run start:lan  # listen on 0.0.0.0 for phones on the same network
npm test           # API tests, using in-memory storage instead of Spaces
```

Saved games, teams and snapshots of live games (`live/<id>.json`, so live links survive restarts and redeploys) are stored in DigitalOcean Spaces. Set the `DO_SPACES_*` variables from `.env.example` to enable them; without them the saved-game and team API routes return 503 and live games are kept in memory only. The server reads only real environment variables, so either export them or copy `.env.example` to `.env` and start with `node --env-file=.env server.js` (Node 20.6+). `node scripts/seed.js` reads `.env` itself and loads sample teams and games into Spaces (`--clear` removes them).
