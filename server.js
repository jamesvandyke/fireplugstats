const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = __dirname;
const games = new Map();

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
  const gameId = gameIdFromUrl(url);

  if (!gameId) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  if (request.method === "GET") {
    const game = games.get(gameId);
    if (!game) {
      sendJson(response, 404, { error: "Game not found" });
      return;
    }
    sendJson(response, 200, game);
    return;
  }

  if (request.method === "PUT") {
    try {
      const body = await readBody(request);
      const game = JSON.parse(body);
      games.set(gameId, game);
      sendJson(response, 200, { ok: true });
    } catch {
      sendJson(response, 400, { error: "Invalid game data" });
    }
    return;
  }

  sendJson(response, 405, { error: "Method not allowed" });
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
});
