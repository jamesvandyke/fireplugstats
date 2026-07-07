#!/usr/bin/env node
/**
 * Seed / unseed sample data for testing.
 *
 * Usage:
 *   node scripts/seed.js          — load sample teams + one completed game
 *   node scripts/seed.js --clear  — remove everything this script created
 *
 * Reads credentials from .env (same as the server).
 * Does NOT require the server to be running — writes directly to Spaces.
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

// IDs file — tracks what this script created so --clear knows what to remove
const IDS_FILE = path.join(__dirname, ".seed-ids.json");

function loadIds() {
  try { return JSON.parse(fs.readFileSync(IDS_FILE, "utf8")); } catch { return { teams: [], games: [] }; }
}
function saveIds(ids) {
  fs.writeFileSync(IDS_FILE, JSON.stringify(ids, null, 2));
}

function newId() {
  return crypto.randomBytes(7).toString("hex");
}

async function s3Get(key) {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const chunks = [];
  for await (const chunk of res.Body) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function s3Put(key, payload) {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key,
    Body: JSON.stringify(payload), ContentType: "application/json",
  }));
}

async function s3Del(key) {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

async function getIndex(prefix) {
  try { return await s3Get(`${prefix}/index.json`); } catch { return []; }
}

// ─── Sample data definitions ──────────────────────────────────────────────────

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
];

// Prebuilt game events — a realistic 4-quarter game, Hornets 64 Eagles 57
function buildGameEvents(hornetTeamName = "Hornets", eagleTeamName = "Eagles") {
  const id = () => crypto.randomUUID();
  const shot = (team, player, made, points, zone, x, y, time, period, shotType = "fieldGoal") => ({
    id: id(), period, periodMode: "quarters", time, team, player, action: "shot",
    made, shotType, points,
    ...(shotType !== "freeThrow" ? { location: { x, y, zone } } : {}),
  });
  const ft = (team, player, made, time, period) =>
    shot(team, player, made, 1, null, null, null, time, period, "freeThrow");
  const reb = (team, player, time, period, missedShotId) =>
    ({ id: id(), period, periodMode: "quarters", time, team, player, action: "rebound", missedShotId });
  const steal = (team, player, time, period) =>
    ({ id: id(), period, periodMode: "quarters", time, team, player, action: "steal" });
  const foul = (team, player, time, period) =>
    ({ id: id(), period, periodMode: "quarters", time, team, player, action: "foul" });

  // Q1
  const e = [];
  let m1, m2;

  e.push(shot("Hornets", 10, true,  2, "Paint",         24.5, 38.2, "7:44", 1));
  e.push(shot("Opponent", 11, true, 2, "Right Midrange", 34.2, 32.1, "7:21", 1));
  m1 = shot("Hornets", 23, false, 3, "Top 3",          25.1, 10.4, "6:58", 1);
  e.push(m1);
  e.push(reb("Opponent", 20, "6:56", 1, m1.id));
  e.push(shot("Opponent", 7,  true,  3, "Left Wing 3",   8.2, 22.4, "6:30", 1));
  e.push(shot("Hornets", 33, true,  2, "At Rim",        25.0, 42.1, "6:05", 1));
  e.push(foul("Opponent", 4, "5:48", 1));
  e.push(ft("Hornets", 33, true,  "5:47", 1));
  e.push(ft("Hornets", 33, false, "5:46", 1));
  m2 = shot("Opponent", 14, false, 2, "Left Midrange",  12.4, 28.6, "5:20", 1);
  e.push(m2);
  e.push(reb("Hornets", 21, "5:18", 1, m2.id));
  e.push(shot("Hornets", 5,  true,  2, "Paint",         22.1, 34.5, "4:52", 1));
  e.push(shot("Opponent", 32, true, 2, "At Rim",        25.0, 42.8, "4:28", 1));
  e.push(steal("Hornets", 3, "4:10", 1));
  e.push(shot("Hornets", 3,  true,  3, "Right Wing 3",  40.2, 20.1, "3:55", 1));
  m1 = shot("Opponent", 2,  false, 3, "Top 3",         26.0, 8.3,  "3:30", 1);
  e.push(m1);
  e.push(reb("Hornets", 33, "3:28", 1, m1.id));
  e.push(shot("Hornets", 21, true,  2, "Paint",         21.5, 36.4, "3:05", 1));
  e.push(shot("Opponent", 24, true, 2, "Midrange",      26.2, 28.1, "2:40", 1));
  e.push(shot("Hornets", 10, true,  2, "At Rim",        24.8, 43.0, "2:15", 1));
  m2 = shot("Opponent", 7, false, 3, "Right Corner 3", 42.1, 44.5, "1:50", 1);
  e.push(m2);
  e.push(reb("Opponent", 11, "1:48", 1, m2.id));
  e.push(shot("Opponent", 11, true, 2, "Paint",         23.8, 35.2, "1:30", 1));
  e.push(shot("Hornets", 1,  true,  3, "Left Wing 3",   7.8, 21.6, "0:55", 1));
  e.push(foul("Hornets", 12, "0:38", 1));
  e.push(ft("Opponent", 14, true,  "0:37", 1));
  e.push(ft("Opponent", 14, true,  "0:36", 1));

  // Q2
  e.push(shot("Opponent", 20, true,  3, "Top 3",         24.9, 9.0,  "7:50", 2));
  e.push(shot("Hornets", 23, true,  3, "Top 3",          25.2, 10.1, "7:28", 2));
  m1 = shot("Hornets", 5, false, 2, "Right Midrange",   36.1, 30.5, "7:05", 2);
  e.push(m1);
  e.push(reb("Hornets", 21, "7:03", 2, m1.id));
  e.push(shot("Hornets", 21, true,  2, "Paint",          22.0, 37.0, "6:44", 2));
  e.push(steal("Opponent", 2, "6:25", 2));
  e.push(shot("Opponent", 2,  true,  2, "At Rim",        25.1, 42.5, "6:10", 2));
  e.push(shot("Hornets", 12, true,  2, "Paint",          23.5, 33.8, "5:48", 2));
  e.push(foul("Opponent", 32, "5:30", 2));
  e.push(ft("Hornets", 12, true,  "5:29", 2));
  e.push(ft("Hornets", 12, true,  "5:28", 2));
  m2 = shot("Opponent", 4, false, 3, "Left Corner 3",   6.5, 45.1, "5:05", 2);
  e.push(m2);
  e.push(reb("Hornets", 33, "5:03", 2, m2.id));
  e.push(shot("Hornets", 10, true,  2, "At Rim",         25.0, 43.2, "4:40", 2));
  e.push(shot("Opponent", 24, true, 3, "Right Wing 3",  41.5, 19.8, "4:18", 2));
  e.push(shot("Hornets", 23, true,  2, "Paint",          24.1, 35.6, "3:55", 2));
  m1 = shot("Opponent", 7, false, 2, "Midrange",        27.4, 27.3, "3:32", 2);
  e.push(m1);
  e.push(reb("Opponent", 20, "3:30", 2, m1.id));
  e.push(shot("Opponent", 20, true,  2, "At Rim",        24.9, 42.9, "3:12", 2));
  e.push(shot("Hornets", 33, true,  2, "Paint",          21.8, 36.8, "2:50", 2));
  e.push(shot("Opponent", 11, true, 2, "Paint",          23.2, 34.1, "2:25", 2));
  e.push(shot("Hornets", 1,  true,  2, "At Rim",         25.2, 43.5, "2:02", 2));
  m2 = shot("Hornets", 3, false, 3, "Left Wing 3",      8.4, 23.2, "1:40", 2);
  e.push(m2);
  e.push(reb("Opponent", 32, "1:38", 2, m2.id));
  e.push(shot("Opponent", 32, true, 2, "At Rim",         25.0, 42.2, "1:15", 2));
  e.push(shot("Hornets", 10, true,  3, "Top 3",          26.1, 9.5,  "0:48", 2));
  e.push(foul("Hornets", 21, "0:22", 2));
  e.push(ft("Opponent", 14, true,  "0:21", 2));
  e.push(ft("Opponent", 14, false, "0:20", 2));
  m1 = shot("Opponent", 11, false, 3, "Right Corner 3", 43.2, 45.5, "0:04", 2);
  e.push(m1);
  e.push(reb("Hornets", 12, "0:02", 2, m1.id));

  // Q3
  e.push(shot("Opponent", 7,  true,  2, "Paint",         22.5, 34.9, "7:42", 3));
  e.push(shot("Hornets", 5,  true,  2, "Paint",          23.8, 37.2, "7:20", 3));
  e.push(steal("Hornets", 1,  "7:02", 3));
  e.push(shot("Hornets", 1,  true,  2, "At Rim",         25.1, 42.8, "6:48", 3));
  m2 = shot("Opponent", 24, false, 3, "Top 3",          25.5, 8.8,  "6:25", 3);
  e.push(m2);
  e.push(reb("Hornets", 33, "6:23", 3, m2.id));
  e.push(shot("Hornets", 23, true,  3, "Right Wing 3",  40.8, 21.4, "6:00", 3));
  e.push(shot("Opponent", 20, true,  2, "Midrange",      27.0, 27.8, "5:38", 3));
  e.push(foul("Opponent", 11, "5:20", 3));
  e.push(ft("Hornets", 23, true,  "5:19", 3));
  e.push(ft("Hornets", 23, true,  "5:18", 3));
  e.push(shot("Opponent", 2,  true,  3, "Left Wing 3",   8.0, 20.5, "4:55", 3));
  m1 = shot("Hornets", 10, false, 2, "Left Midrange",   11.8, 29.4, "4:32", 3);
  e.push(m1);
  e.push(reb("Opponent", 4, "4:30", 3, m1.id));
  e.push(shot("Opponent", 4,  true,  2, "At Rim",        25.0, 43.1, "4:08", 3));
  e.push(shot("Hornets", 33, true,  2, "Paint",          22.2, 35.5, "3:48", 3));
  e.push(shot("Opponent", 32, true, 2, "Paint",          23.4, 36.2, "3:25", 3));
  e.push(shot("Hornets", 21, true,  2, "At Rim",         24.8, 43.4, "3:02", 3));
  e.push(steal("Opponent", 7, "2:44", 3));
  m2 = shot("Opponent", 7, false, 3, "Left Corner 3",   5.8, 44.2, "2:30", 3);
  e.push(m2);
  e.push(reb("Hornets", 12, "2:28", 3, m2.id));
  e.push(shot("Hornets", 12, true,  2, "Midrange",       24.5, 27.1, "2:05", 3));
  e.push(shot("Opponent", 14, true, 2, "Paint",          21.9, 34.8, "1:42", 3));
  e.push(shot("Hornets", 3,  true,  3, "Top 3",          25.0, 9.2,  "1:18", 3));
  m1 = shot("Opponent", 20, false, 2, "Midrange",       26.8, 28.4, "0:55", 3);
  e.push(m1);
  e.push(reb("Hornets", 21, "0:53", 3, m1.id));
  e.push(shot("Hornets", 21, true,  2, "At Rim",         25.2, 42.6, "0:30", 3));
  e.push(foul("Hornets", 5, "0:10", 3));
  e.push(ft("Opponent", 24, true,  "0:09", 3));
  e.push(ft("Opponent", 24, true,  "0:08", 3));

  // Q4
  e.push(shot("Opponent", 11, true, 3, "Right Wing 3",  41.2, 20.8, "7:45", 4));
  m2 = shot("Hornets", 23, false, 2, "Midrange",        25.8, 26.4, "7:22", 4);
  e.push(m2);
  e.push(reb("Opponent", 32, "7:20", 4, m2.id));
  e.push(shot("Opponent", 32, true, 2, "At Rim",         24.9, 43.0, "7:00", 4));
  e.push(shot("Hornets", 10, true,  3, "Left Wing 3",    7.5, 22.8, "6:38", 4));
  e.push(shot("Opponent", 7,  true,  2, "Paint",         22.8, 35.8, "6:15", 4));
  e.push(shot("Hornets", 33, true,  2, "At Rim",         25.1, 43.3, "5:52", 4));
  e.push(steal("Hornets", 3, "5:34", 4));
  e.push(shot("Hornets", 3,  true,  2, "At Rim",         24.8, 42.5, "5:18", 4));
  m1 = shot("Opponent", 24, false, 3, "Top 3",          26.2, 8.5,  "4:55", 4);
  e.push(m1);
  e.push(reb("Hornets", 33, "4:53", 4, m1.id));
  e.push(shot("Hornets", 1,  true,  2, "Paint",          23.1, 36.6, "4:30", 4));
  e.push(shot("Opponent", 2,  true,  2, "Midrange",      27.5, 27.0, "4:08", 4));
  e.push(foul("Opponent", 20, "3:50", 4));
  e.push(ft("Hornets", 21, true,  "3:49", 4));
  e.push(ft("Hornets", 21, true,  "3:48", 4));
  e.push(shot("Opponent", 14, true, 3, "Top 3",         25.3, 9.8,  "3:25", 4));
  m2 = shot("Hornets", 5, false, 2, "Left Midrange",    12.2, 30.1, "3:02", 4);
  e.push(m2);
  e.push(reb("Opponent", 4, "3:00", 4, m2.id));
  e.push(shot("Opponent", 4,  true,  2, "At Rim",        25.0, 43.2, "2:38", 4));
  e.push(shot("Hornets", 23, true,  2, "Paint",          24.2, 35.0, "2:15", 4));
  e.push(shot("Opponent", 11, true, 2, "At Rim",         24.8, 42.8, "1:52", 4));
  e.push(shot("Hornets", 10, true,  2, "At Rim",         25.0, 43.5, "1:28", 4));
  e.push(foul("Hornets", 12, "1:10", 4));
  e.push(ft("Opponent", 7, true,  "1:09", 4));
  e.push(ft("Opponent", 7, false, "1:08", 4));
  m1 = shot("Opponent", 20, false, 3, "Right Wing 3",  40.5, 21.0, "0:48", 4);
  e.push(m1);
  e.push(reb("Hornets", 21, "0:46", 4, m1.id));
  e.push(shot("Hornets", 21, true,  2, "At Rim",         25.1, 43.1, "0:30", 4));
  e.push(foul("Opponent", 32, "0:12", 4));
  e.push(ft("Hornets", 33, true,  "0:11", 4));
  e.push(ft("Hornets", 33, true,  "0:10", 4));

  return e;
}

// ─── Seed ─────────────────────────────────────────────────────────────────────

async function seed() {
  const ids = loadIds();
  const now = new Date().toISOString();

  console.log("Seeding sample teams…");
  const teamIndex = await getIndex("teams");
  for (const t of SAMPLE_TEAMS) {
    const id = newId();
    const team = { id, name: t.name, color: t.color, roster: t.roster, createdAt: now, updatedAt: now, sample: true };
    await s3Put(`teams/${id}.json`, team);
    teamIndex.unshift({ id, name: t.name, color: t.color, playerCount: t.roster.length, createdAt: now, updatedAt: now });
    ids.teams.push(id);
    console.log(`  ✓ Team: ${t.name} (${id})`);
  }
  await s3Put("teams/index.json", teamIndex);

  console.log("Seeding sample game…");
  const hornetId = ids.teams[0];
  const eagleId  = ids.teams[1];
  const events = buildGameEvents();
  const homeScore = events.filter(e => e.team === "Hornets" && e.action === "shot" && e.made).reduce((s, e) => s + e.points, 0);
  const awayScore = events.filter(e => e.team === "Opponent" && e.action === "shot" && e.made).reduce((s, e) => s + e.points, 0);
  const gameId = newId();
  const savedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(); // 2 days ago

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
    teamNames: { Hornets: "Hornets", Opponent: "Eagles" },
    teamColors: { Hornets: "#0f766e", Opponent: "#7c3aed" },
    rosters: {
      Hornets: SAMPLE_TEAMS[0].roster,
      Opponent: SAMPLE_TEAMS[1].roster,
    },
    live: { enabled: false, gameId: "", watchUrl: "" },
    events,
  };

  await s3Put(`games/${gameId}.json`, game);
  const gameEntry = {
    id: gameId,
    savedAt,
    teamNames: { Hornets: "Hornets", Opponent: "Eagles" },
    finalScore: { Hornets: homeScore, Opponent: awayScore },
  };
  const gameIndex = await getIndex("games");
  gameIndex.unshift(gameEntry);
  await s3Put("games/index.json", gameIndex);
  ids.games.push(gameId);
  console.log(`  ✓ Game: Hornets ${homeScore} – Eagles ${awayScore} (${gameId})`);

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
    const filtered = teamIndex.filter(t => !ids.teams.includes(t.id));
    for (const id of ids.teams) {
      await s3Del(`teams/${id}.json`);
      console.log(`  ✓ Removed team ${id}`);
    }
    await s3Put("teams/index.json", filtered);
  }

  if (ids.games.length) {
    console.log("Removing sample games…");
    const gameIndex = await getIndex("games");
    const filtered = gameIndex.filter(g => !ids.games.includes(g.id));
    for (const id of ids.games) {
      await s3Del(`games/${id}.json`);
      console.log(`  ✓ Removed game ${id}`);
    }
    await s3Put("games/index.json", filtered);
  }

  saveIds({ teams: [], games: [] });
  console.log("\nSample data removed.");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const clearing = process.argv.includes("--clear");
(clearing ? clear() : seed()).catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
