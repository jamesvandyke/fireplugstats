const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");

const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = __dirname;
const games = new Map();

const spacesConfigured =
  process.env.DO_SPACES_KEY &&
  process.env.DO_SPACES_SECRET &&
  process.env.DO_SPACES_ENDPOINT &&
  process.env.DO_SPACES_BUCKET;

const s3 = spacesConfigured
  ? new S3Client({
      endpoint: process.env.DO_SPACES_ENDPOINT,
      region: "us-east-1",
      credentials: {
        accessKeyId: process.env.DO_SPACES_KEY,
        secretAccessKey: process.env.DO_SPACES_SECRET,
      },
      forcePathStyle: false,
    })
  : null;

const BUCKET = process.env.DO_SPACES_BUCKET || "";

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        request.destroy();
        reject(new Error("Request body too large."));
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function gameIdFromUrl(url) {
  const match = url.pathname.match(/^\/api\/games\/([a-z0-9-]+)$/i);
  return match ? match[1] : "";
}

function savedGameIdFromUrl(url) {
  const match = url.pathname.match(/^\/api\/saved-games\/([a-z0-9-]+)$/i);
  return match ? match[1] : "";
}

function teamIdFromUrl(url) {
  const match = url.pathname.match(/^\/api\/teams\/([a-z0-9-]+)$/i);
  return match ? match[1] : "";
}

async function s3Get(key) {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  const response = await s3.send(command);
  const chunks = [];
  for await (const chunk of response.Body) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function s3Put(key, payload) {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: JSON.stringify(payload),
    ContentType: "application/json",
  });
  await s3.send(command);
}

async function getIndex() {
  try {
    return await s3Get("games/index.json");
  } catch {
    return [];
  }
}

async function putIndex(list) {
  await s3Put("games/index.json", list);
}

async function saveGame(id, payload) {
  await s3Put(`games/${id}.json`, payload);
}

async function getGame(id) {
  return await s3Get(`games/${id}.json`);
}

async function getTeamIndex() {
  try {
    return await s3Get("teams/index.json");
  } catch {
    return [];
  }
}

async function putTeamIndex(list) {
  await s3Put("teams/index.json", list);
}

async function saveTeam(id, payload) {
  await s3Put(`teams/${id}.json`, payload);
}

async function getTeam(id) {
  return await s3Get(`teams/${id}.json`);
}

async function deleteTeam(id) {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: `teams/${id}.json` }));
}

function createSavedGameId() {
  return require("node:crypto").randomBytes(7).toString("hex");
}

function serveFile(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(ROOT, requestedPath));

  if (!filePath.startsWith(ROOT)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "content-type": contentTypes[path.extname(filePath)] || "application/octet-stream",
    });
    response.end(data);
  });
}

async function handleApi(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);

  // Live game routes
  if (url.pathname.startsWith("/api/games/")) {
    const gameId = gameIdFromUrl(url);
    if (!gameId) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (request.method === "GET") {
      const game = games.get(gameId);
      if (!game) { sendJson(response, 404, { error: "Game not found" }); return; }
      sendJson(response, 200, game);
      return;
    }
    if (request.method === "PUT") {
      try {
        const body = await readBody(request);
        games.set(gameId, JSON.parse(body));
        sendJson(response, 200, { ok: true });
      } catch {
        sendJson(response, 400, { error: "Invalid game data" });
      }
      return;
    }
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  // Saved games routes
  if (url.pathname === "/api/saved-games" || url.pathname.startsWith("/api/saved-games/")) {
    if (!s3) {
      sendJson(response, 503, { error: "Storage not configured." });
      return;
    }

    // POST /api/saved-games — save a completed game
    if (url.pathname === "/api/saved-games" && request.method === "POST") {
      try {
        const body = await readBody(request);
        const game = JSON.parse(body);
        const id = createSavedGameId();
        const savedAt = new Date().toISOString();
        const homeScore = (game.events || [])
          .filter((e) => e.team === "Hornets" && e.action === "shot" && e.made)
          .reduce((sum, e) => sum + e.points, 0);
        const awayScore = (game.events || [])
          .filter((e) => e.team === "Opponent" && e.action === "shot" && e.made)
          .reduce((sum, e) => sum + e.points, 0);
        const entry = { id, savedAt, teamNames: game.teamNames, finalScore: { Hornets: homeScore, Opponent: awayScore } };
        await saveGame(id, { ...game, id, savedAt });
        const index = await getIndex();
        await putIndex([entry, ...index]);
        sendJson(response, 201, { id });
      } catch (err) {
        sendJson(response, 400, { error: "Failed to save game." });
      }
      return;
    }

    // GET /api/saved-games — list all saved games
    if (url.pathname === "/api/saved-games" && request.method === "GET") {
      try {
        const index = await getIndex();
        sendJson(response, 200, index);
      } catch {
        sendJson(response, 500, { error: "Failed to load games." });
      }
      return;
    }

    // GET /api/saved-games/:id — fetch one saved game
    const savedId = savedGameIdFromUrl(url);
    if (savedId && request.method === "GET") {
      try {
        const game = await getGame(savedId);
        sendJson(response, 200, game);
      } catch {
        sendJson(response, 404, { error: "Game not found." });
      }
      return;
    }

    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  // Teams routes
  if (url.pathname === "/api/teams" || url.pathname.startsWith("/api/teams/")) {
    if (!s3) {
      sendJson(response, 503, { error: "Storage not configured." });
      return;
    }

    // GET /api/teams — list all teams
    if (url.pathname === "/api/teams" && request.method === "GET") {
      try {
        sendJson(response, 200, await getTeamIndex());
      } catch {
        sendJson(response, 500, { error: "Failed to load teams." });
      }
      return;
    }

    // POST /api/teams — create a team
    if (url.pathname === "/api/teams" && request.method === "POST") {
      try {
        const body = await readBody(request);
        const { name, color, roster } = JSON.parse(body);
        const id = createSavedGameId();
        const now = new Date().toISOString();
        const team = { id, name, color, roster: roster || [], createdAt: now, updatedAt: now };
        await saveTeam(id, team);
        const index = await getTeamIndex();
        await putTeamIndex([{ id, name, color, playerCount: (roster || []).length, createdAt: now, updatedAt: now }, ...index]);
        sendJson(response, 201, { id });
      } catch {
        sendJson(response, 400, { error: "Failed to create team." });
      }
      return;
    }

    const teamId = teamIdFromUrl(url);

    // GET /api/teams/:id — fetch one team
    if (teamId && request.method === "GET") {
      try {
        sendJson(response, 200, await getTeam(teamId));
      } catch {
        sendJson(response, 404, { error: "Team not found." });
      }
      return;
    }

    // PUT /api/teams/:id — update a team
    if (teamId && request.method === "PUT") {
      try {
        const body = await readBody(request);
        const { name, color, roster } = JSON.parse(body);
        const existing = await getTeam(teamId);
        const now = new Date().toISOString();
        const team = { ...existing, name, color, roster: roster || [], updatedAt: now };
        await saveTeam(teamId, team);
        const index = await getTeamIndex();
        const updated = index.map((t) =>
          t.id === teamId ? { ...t, name, color, playerCount: (roster || []).length, updatedAt: now } : t
        );
        await putTeamIndex(updated);
        sendJson(response, 200, { ok: true });
      } catch {
        sendJson(response, 400, { error: "Failed to update team." });
      }
      return;
    }

    // DELETE /api/teams/:id — delete a team
    if (teamId && request.method === "DELETE") {
      try {
        await deleteTeam(teamId);
        const index = await getTeamIndex();
        await putTeamIndex(index.filter((t) => t.id !== teamId));
        sendJson(response, 200, { ok: true });
      } catch {
        sendJson(response, 400, { error: "Failed to delete team." });
      }
      return;
    }

    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  sendJson(response, 404, { error: "Not found" });
}

const server = http.createServer((request, response) => {
  if (request.url.startsWith("/api/")) {
    handleApi(request, response);
    return;
  }
  serveFile(request, response);
});

server.listen(PORT, HOST, () => {
  console.log(`Fireplug Stats live server: http://${HOST}:${PORT}`);
  if (!spacesConfigured) console.warn("Warning: DO Spaces not configured — saved games unavailable.");
});
