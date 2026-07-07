#!/usr/bin/env node
/**
 * Seed / unseed sample data for testing.
 *
 * Usage:
 *   node scripts/seed.js          — load 4 sample teams + 3 completed games
 *   node scripts/seed.js --clear  — remove everything this script created
 *
 * Reads credentials from .env. Does NOT require the server to be running.
 */

const { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

// Load .env
const envPath = path.join(__dirname, "../.env");
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf8").split("\n").forEach((line) => {
    const [k, ...v] = line.split("=");
    if (k && v.length && !process.env[k]) process.env[k] = v.join("=").trim();
  });
}

const BUCKET = process.env.DO_SPACES_BUCKET;
if (!BUCKET || !process.env.DO_SPACES_KEY) {
  console.error("Missing DO Spaces credentials. Copy .env.example to .env and fill in the values.");
  process.exit(1);
}

const s3 = new S3Client({
  endpoint: process.env.DO_SPACES_ENDPOINT,
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.DO_SPACES_KEY,
    secretAccessKey: process.env.DO_SPACES_SECRET,
  },
  forcePathStyle: false,
});

const IDS_FILE = path.join(__dirname, ".seed-ids.json");
function loadIds() {
  try { return JSON.parse(fs.readFileSync(IDS_FILE, "utf8")); } catch { return { teams: [], games: [] }; }
}
function saveIds(ids) { fs.writeFileSync(IDS_FILE, JSON.stringify(ids, null, 2)); }
function newId() { return crypto.randomBytes(7).toString("hex"); }

async function s3Get(key) {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const chunks = [];
  for await (const chunk of res.Body) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
async function s3Put(key, payload) {
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: JSON.stringify(payload), ContentType: "application/json" }));
}
async function s3Del(key) { await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key })); }
async function getIndex(prefix) { try { return await s3Get(`${prefix}/index.json`); } catch { return []; } }

// ─── Sample teams ─────────────────────────────────────────────────────────────

const SAMPLE_TEAMS = [
  {
    name: "Hornets",
    color: "#0f766e",
    roster: [
      { number: 1,  name: "Marcus Hill" },
      { number: 3,  name: "DeShawn Ford" },
      { number: 5,  name: "Jaylen Cruz" },
      { number: 10, name: "Tyler Reeves" },
      { number: 12, name: "Antoine Brooks" },
      { number: 21, name: "Kevin Nash" },
      { number: 23, name: "Isaiah Grant" },
      { number: 33, name: "Malik Thomas" },
    ],
  },
  {
    name: "Eagles",
    color: "#7c3aed",
    roster: [
      { number: 2,  name: "Chris Owens" },
      { number: 4,  name: "Jordan Bell" },
      { number: 7,  name: "Dante Rivera" },
      { number: 11, name: "Elijah Moore" },
      { number: 14, name: "Quincy Adams" },
      { number: 20, name: "Terrell Hayes" },
      { number: 24, name: "Brandon Simms" },
      { number: 32, name: "Darius Cole" },
    ],
  },
  {
    name: "Wolves",
    color: "#1d4ed8",
    roster: [
      { number: 0,  name: "Andre Price" },
      { number: 6,  name: "Cameron Ross" },
      { number: 8,  name: "Kendall Wright" },
      { number: 13, name: "Jalen Scott" },
      { number: 15, name: "Dominic Banks" },
      { number: 22, name: "Trevon Miles" },
      { number: 25, name: "Ronnie Carter" },
      { number: 34, name: "Marquise Webb" },
    ],
  },
  {
    name: "Hawks",
    color: "#b91c1c",
    roster: [
      { number: 3,  name: "Damon Fletcher" },
      { number: 9,  name: "Lorenzo King" },
      { number: 11, name: "Stevie Durant" },
      { number: 16, name: "Marcus Tate" },
      { number: 19, name: "Byron James" },
      { number: 23, name: "Corey Lynch" },
      { number: 30, name: "Phillip Reed" },
      { number: 35, name: "Nathan Powell" },
    ],
  },
];

// ─── Game event generator ─────────────────────────────────────────────────────

// Coordinates are percentages (0-100), matching how app.js records shot locations:
// x = (clientX - rect.left) / rect.width * 100. Court SVG viewBox is "0 0 50 47",
// so pct = (svgCoord / dimension) * 100.
const ZONES = [
  { zone: "At Rim",         points: 2, x: 50.0, y: 90.4 },
  { zone: "Paint",          points: 2, x: 45.0, y: 76.6 },
  { zone: "Left Midrange",  points: 2, x: 25.0, y: 63.8 },
  { zone: "Right Midrange", points: 2, x: 75.0, y: 63.8 },
  { zone: "Midrange",       points: 2, x: 51.0, y: 58.5 },
  { zone: "Left Wing 3",    points: 3, x: 16.0, y: 46.8 },
  { zone: "Right Wing 3",   points: 3, x: 82.0, y: 46.8 },
  { zone: "Top 3",          points: 3, x: 50.0, y: 20.2 },
  { zone: "Left Corner 3",  points: 3, x: 12.0, y: 94.7 },
  { zone: "Right Corner 3", points: 3, x: 88.0, y: 94.7 },
];

// Weighted zone selection: rim and paint more likely than corner 3s
const ZONE_WEIGHTS = [18, 16, 7, 7, 8, 8, 8, 8, 4, 4];

function pickZone(rng) {
  const total = ZONE_WEIGHTS.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < ZONES.length; i++) {
    r -= ZONE_WEIGHTS[i];
    if (r <= 0) return ZONES[i];
  }
  return ZONES[0];
}

function pick(arr, rng) { return arr[Math.floor(rng() * arr.length)]; }

/**
 * Deterministic seeded RNG (mulberry32) so games are reproducible.
 */
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build a realistic 4-quarter game between two teams.
 * homeRoster / awayRoster: arrays of {number, name}
 * rngSeed: integer — different seeds produce different scoring patterns
 * homeFgPct / awayFgPct: rough field goal make rates
 */
function buildGameEvents(homeRoster, awayRoster, { rngSeed = 1, homeFgPct = 0.46, awayFgPct = 0.43 } = {}) {
  const rng = makeRng(rngSeed);
  const uid = () => crypto.randomUUID();
  const events = [];

  const clockStr = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = String(seconds % 60).padStart(2, "0");
    return `${m}:${s}`;
  };

  // Each quarter: ~32-38 possessions total (16-19 per team)
  for (let period = 1; period <= 4; period++) {
    const periodSeconds = 8 * 60;
    // Spread possessions evenly, alternating teams, with jitter
    const homePoss = 16 + Math.floor(rng() * 4);
    const awayPoss = 16 + Math.floor(rng() * 4);
    const totalPoss = homePoss + awayPoss;

    // Generate possession times spread across the period
    const times = Array.from({ length: totalPoss }, (_, i) =>
      Math.max(1, Math.round(periodSeconds - (i / totalPoss) * periodSeconds - rng() * 15))
    ).sort((a, b) => b - a);

    let homeCount = homePoss;
    let awayCount = awayPoss;

    for (const t of times) {
      // Alternate roughly, with some randomness
      const isHome = homeCount > awayCount
        ? true
        : awayCount > homeCount
        ? false
        : rng() > 0.5;

      if (isHome && homeCount > 0) { homeCount--; } else if (!isHome && awayCount > 0) { awayCount--; } else { continue; }

      const team = isHome ? "Hornets" : "Opponent";
      const roster = isHome ? homeRoster : awayRoster;
      const fgPct = isHome ? homeFgPct : awayFgPct;
      const player = pick(roster, rng).number;
      const time = clockStr(t);

      // ~8% chance of foul leading to free throws
      if (rng() < 0.08) {
        const ftCount = rng() < 0.7 ? 2 : 1;
        const fouledBy = pick(isHome ? awayRoster : homeRoster, rng).number;
        events.push({ id: uid(), period, periodMode: "quarters", time, team: isHome ? "Opponent" : "Hornets", player: fouledBy, action: "foul" });
        for (let f = 0; f < ftCount; f++) {
          const made = rng() < 0.72;
          events.push({ id: uid(), period, periodMode: "quarters", time, team, player, action: "shot", made, shotType: "freeThrow", points: 1 });
        }
        continue;
      }

      // ~6% chance of steal (turnover — no shot generated)
      if (rng() < 0.06) {
        const stealBy = pick(isHome ? awayRoster : homeRoster, rng).number;
        events.push({ id: uid(), period, periodMode: "quarters", time, team: isHome ? "Opponent" : "Hornets", player: stealBy, action: "steal" });
        continue;
      }

      // Field goal attempt
      const zone = pickZone(rng);
      // 3-pointers made at a lower rate
      const adjPct = zone.points === 3 ? fgPct * 0.78 : fgPct * 1.08;
      const made = rng() < adjPct;
      const jitter = { x: Math.round((zone.x + (rng() - 0.5) * 3) * 10) / 10, y: Math.round((zone.y + (rng() - 0.5) * 2.5) * 10) / 10 };
      const shotId = uid();
      events.push({ id: shotId, period, periodMode: "quarters", time, team, player, action: "shot", made, shotType: "fieldGoal", points: zone.points, location: { ...jitter, zone: zone.zone } });

      if (!made) {
        // ~65% of misses have a tracked rebounder
        if (rng() < 0.65) {
          const rebTeam = rng() < 0.72 ? (isHome ? "Opponent" : "Hornets") : team; // defensive rebound more likely
          const rebRoster = rebTeam === "Hornets" ? homeRoster : awayRoster;
          const rebounder = pick(rebRoster, rng).number;
          const rebTime = clockStr(Math.max(1, t - 2));
          events.push({ id: uid(), period, periodMode: "quarters", time: rebTime, team: rebTeam, player: rebounder, action: "rebound", missedShotId: shotId });
        }
      }
    }
  }

  return events;
}

// ─── Sample game definitions ──────────────────────────────────────────────────
// Each game references teams by index into SAMPLE_TEAMS and a date offset (days ago).

const SAMPLE_GAMES = [
  { homeIdx: 0, awayIdx: 1, daysAgo: 7,  rngSeed: 42,  homeFgPct: 0.47, awayFgPct: 0.42 }, // Hornets vs Eagles
  { homeIdx: 0, awayIdx: 2, daysAgo: 14, rngSeed: 17,  homeFgPct: 0.44, awayFgPct: 0.46 }, // Hornets vs Wolves
  { homeIdx: 3, awayIdx: 1, daysAgo: 21, rngSeed: 99,  homeFgPct: 0.45, awayFgPct: 0.44 }, // Hawks vs Eagles
];

// ─── Seed ─────────────────────────────────────────────────────────────────────

async function seed() {
  const ids = loadIds();
  const now = new Date().toISOString();

  // Teams
  console.log("Seeding sample teams…");
  const teamIndex = await getIndex("teams");
  const createdTeams = []; // [{id, team}] in order of SAMPLE_TEAMS
  for (const t of SAMPLE_TEAMS) {
    const id = newId();
    const team = { id, name: t.name, color: t.color, roster: t.roster, createdAt: now, updatedAt: now, sample: true };
    await s3Put(`teams/${id}.json`, team);
    teamIndex.unshift({ id, name: t.name, color: t.color, playerCount: t.roster.length, createdAt: now, updatedAt: now });
    ids.teams.push(id);
    createdTeams.push({ id, team: t });
    console.log(`  ✓ ${t.name} (${id})`);
  }
  await s3Put("teams/index.json", teamIndex);

  // Games
  console.log("Seeding sample games…");
  const gameIndex = await getIndex("games");
  for (const def of SAMPLE_GAMES) {
    const homeTeam = createdTeams[def.homeIdx].team;
    const awayTeam  = createdTeams[def.awayIdx].team;
    const events = buildGameEvents(homeTeam.roster, awayTeam.roster, {
      rngSeed: def.rngSeed,
      homeFgPct: def.homeFgPct,
      awayFgPct: def.awayFgPct,
    });
    const homeScore = events.filter(e => e.team === "Hornets" && e.action === "shot" && e.made).reduce((s, e) => s + e.points, 0);
    const awayScore = events.filter(e => e.team === "Opponent" && e.action === "shot" && e.made).reduce((s, e) => s + e.points, 0);
    const savedAt = new Date(Date.now() - def.daysAgo * 24 * 60 * 60 * 1000).toISOString();
    const gameId = newId();

    const game = {
      id: gameId,
      savedAt,
      updatedAt: savedAt,
      sample: true,
      period: 4,
      periodMode: "quarters",
      periodSeconds: 480,
      lastTime: "0:00",
      clockRunning: false,
      courtOrientation: 0,
      teamNames: { Hornets: homeTeam.name, Opponent: awayTeam.name },
      teamColors: { Hornets: homeTeam.color, Opponent: awayTeam.color },
      rosters: { Hornets: homeTeam.roster, Opponent: awayTeam.roster },
      live: { enabled: false, gameId: "", watchUrl: "" },
      events,
    };

    await s3Put(`games/${gameId}.json`, game);
    gameIndex.unshift({
      id: gameId,
      savedAt,
      teamNames: { Hornets: homeTeam.name, Opponent: awayTeam.name },
      finalScore: { Hornets: homeScore, Opponent: awayScore },
    });
    ids.games.push(gameId);
    console.log(`  ✓ ${homeTeam.name} ${homeScore} – ${awayTeam.name} ${awayScore} (${gameId})`);
  }
  await s3Put("games/index.json", gameIndex);

  saveIds(ids);
  console.log("\nSample data loaded. Run with --clear to remove it.");
}

// ─── Clear ────────────────────────────────────────────────────────────────────

async function clear() {
  const ids = loadIds();
  if (!ids.teams.length && !ids.games.length) {
    console.log("No sample data found (run without --clear to seed first).");
    return;
  }

  if (ids.teams.length) {
    console.log("Removing sample teams…");
    const teamIndex = await getIndex("teams");
    for (const id of ids.teams) {
      await s3Del(`teams/${id}.json`);
      console.log(`  ✓ Removed team ${id}`);
    }
    await s3Put("teams/index.json", teamIndex.filter(t => !ids.teams.includes(t.id)));
  }

  if (ids.games.length) {
    console.log("Removing sample games…");
    const gameIndex = await getIndex("games");
    for (const id of ids.games) {
      await s3Del(`games/${id}.json`);
      console.log(`  ✓ Removed game ${id}`);
    }
    await s3Put("games/index.json", gameIndex.filter(g => !ids.games.includes(g.id)));
  }

  saveIds({ teams: [], games: [] });
  console.log("\nSample data removed.");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const clearing = process.argv.includes("--clear");
(clearing ? clear() : seed()).catch(err => { console.error("Error:", err.message); process.exit(1); });
