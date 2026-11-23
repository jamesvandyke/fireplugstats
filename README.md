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

## Voice input

On the Track tab, hold the mic button and say plays such as "score white 32", "miss black 4 rebound white 17", "foul gold 23", "timeout white", "ref timeout" or "start clock". Teams are named by jersey color (matched to the closest team color), team name, home/away, or extra words set in Settings. Called shots wait in line for a tap on the court. The parser lives in `voice.mjs` and the hold-to-talk wrapper in `speech.mjs`; add `?voice=text` to the URL for a box to type commands instead (`?voice=off` hides it). See `docs/voice-input-plan.md`.

A Voice / Touch switch at the top of the Track tab picks how plays are entered, remembered per phone (Voice by default where speech works). Voice mode shows the last few phrases it heard, each with its own Undo, brings up the court only for called shots, and keeps the player grid one tap away. Touch mode is the player grid with no mic.

