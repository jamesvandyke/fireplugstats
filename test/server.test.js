const test = require("node:test");
const assert = require("node:assert/strict");
const { createServer, flushLiveSaves, teamScore } = require("../server.js");

function memoryStorage() {
  const data = new Map();
  return {
    data,
    async get(key) {
      if (!data.has(key)) throw new Error(`NoSuchKey: ${key}`);
      return structuredClone(data.get(key));
    },
    async put(key, payload) {
      data.set(key, structuredClone(payload));
    },
    async delete(key) {
      data.delete(key);
    },
  };
}

async function start(options) {
  const server = createServer({ liveSaveDelayMs: 10, ...options });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, init = {}) =>
    fetch(base + path, {
      ...init,
      headers: { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  return { server, request, close: () => new Promise((resolve) => server.close(resolve)) };
}

const shot = (team, points, made = true) => ({ team, action: "shot", points, made });

test("teamScore sums made shots for one team", () => {
  const events = [
    shot("Hornets", 2),
    shot("Hornets", 3),
    shot("Hornets", 2, false),
    shot("Opponent", 1),
    { team: "Hornets", action: "rebound" },
  ];
  assert.equal(teamScore(events, "Hornets"), 5);
  assert.equal(teamScore(events, "Opponent"), 1);
  assert.equal(teamScore(undefined, "Hornets"), 0);
});

test("live game round-trips and is written through to storage", async () => {
  const storage = memoryStorage();
  const app = await start({ storage });
  try {
    const game = { teamNames: { Hornets: "Hornets", Opponent: "Tigers" }, events: [shot("Hornets", 2)] };
    assert.equal((await app.request("/api/games/abc123", { method: "PUT", body: game })).status, 200);
    assert.deepEqual(await (await app.request("/api/games/abc123")).json(), game);

    await flushLiveSaves();
    assert.deepEqual(storage.data.get("live/abc123.json"), game);
  } finally {
    await app.close();
  }
});

test("live game survives a server restart", async () => {
  const storage = memoryStorage();
  const game = { events: [shot("Opponent", 3)] };

  const first = await start({ storage });
  await first.request("/api/games/restart1", { method: "PUT", body: game });
  await flushLiveSaves();
  await first.close();

  const second = await start({ storage });
  try {
    const response = await second.request("/api/games/restart1");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), game);
  } finally {
    await second.close();
  }
});

test("live game writes are batched to the latest state", async () => {
  const storage = memoryStorage();
  let puts = 0;
  const put = storage.put;
  storage.put = async (key, payload) => {
    puts += 1;
    return put(key, payload);
  };
  const app = await start({ storage, liveSaveDelayMs: 50 });
  try {
    for (let i = 1; i <= 5; i += 1) {
      await app.request("/api/games/batch1", { method: "PUT", body: { events: [], clock: i } });
    }
    await flushLiveSaves();
    assert.equal(puts, 1);
    assert.equal(storage.data.get("live/batch1.json").clock, 5);
  } finally {
    await app.close();
  }
});

test("live games still work without storage", async () => {
  const app = await start({ storage: null });
  try {
    assert.equal((await app.request("/api/games/nostore")).status, 404);
    await app.request("/api/games/nostore", { method: "PUT", body: { events: [] } });
    assert.equal((await app.request("/api/games/nostore")).status, 200);
    assert.equal((await app.request("/api/saved-games")).status, 503);
    assert.equal((await app.request("/api/teams")).status, 503);
  } finally {
    await app.close();
  }
});

test("invalid live game data is rejected", async () => {
  const app = await start({ storage: memoryStorage() });
  try {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api/games/bad1`, {
      method: "PUT",
      body: "{not json",
    });
    assert.equal(response.status, 400);
  } finally {
    await app.close();
  }
});

test("saving a game records the final score by home/away slot", async () => {
  const storage = memoryStorage();
  const app = await start({ storage });
  try {
    const game = {
      teamNames: { Hornets: "Fireplugs", Opponent: "Tigers" },
      events: [shot("Hornets", 2), shot("Hornets", 3), shot("Opponent", 2), shot("Opponent", 2, false)],
    };
    const created = await app.request("/api/saved-games", { method: "POST", body: game });
    assert.equal(created.status, 201);
    const { id } = await created.json();

    const index = await (await app.request("/api/saved-games")).json();
    assert.equal(index.length, 1);
    assert.equal(index[0].id, id);
    assert.deepEqual(index[0].teamNames, game.teamNames);
    assert.deepEqual(index[0].finalScore, { Hornets: 5, Opponent: 2 });

    const saved = await (await app.request(`/api/saved-games/${id}`)).json();
    assert.deepEqual(saved.events, game.events);
    assert.equal((await app.request("/api/saved-games/missing")).status, 404);
  } finally {
    await app.close();
  }
});

test("teams can be created, updated and deleted", async () => {
  const app = await start({ storage: memoryStorage() });
  try {
    const roster = [{ number: 3, name: "Sam" }];
    const created = await app.request("/api/teams", { method: "POST", body: { name: "Tigers", color: "#ff0000", roster } });
    assert.equal(created.status, 201);
    const { id } = await created.json();

    let index = await (await app.request("/api/teams")).json();
    assert.equal(index[0].playerCount, 1);

    await app.request(`/api/teams/${id}`, { method: "PUT", body: { name: "Lions", color: "#00ff00", roster: [] } });
    const team = await (await app.request(`/api/teams/${id}`)).json();
    assert.equal(team.name, "Lions");
    index = await (await app.request("/api/teams")).json();
    assert.equal(index[0].name, "Lions");
    assert.equal(index[0].playerCount, 0);

    await app.request(`/api/teams/${id}`, { method: "DELETE" });
    assert.deepEqual(await (await app.request("/api/teams")).json(), []);
    assert.equal((await app.request(`/api/teams/${id}`)).status, 404);
  } finally {
    await app.close();
  }
});

test("static files are served and unknown paths 404", async () => {
  const app = await start({ storage: null });
  try {
    const home = await app.request("/");
    assert.equal(home.status, 200);
    assert.match(home.headers.get("content-type"), /text\/html/);
    assert.equal((await app.request("/nope.html")).status, 404);
    assert.equal((await app.request("/api/unknown")).status, 404);
  } finally {
    await app.close();
  }
});
