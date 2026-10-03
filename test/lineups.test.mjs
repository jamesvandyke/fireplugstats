import test from "node:test";
import assert from "node:assert/strict";
import { currentLineup, bench, secondsPlayed, startingLineup, formatMinutes } from "../lineups.mjs";

const roster = (...numbers) => numbers.map((number) => ({ number, name: "" }));
const sub = (period, time, playerIn, playerOut, team = "Hornets") =>
  ({ team, action: "sub", player: playerIn, playerOut, period, time });

function game(overrides = {}) {
  return {
    period: 1,
    periodSeconds: 480,
    lastTime: "8:00",
    rosters: { Hornets: roster(1, 2, 3, 4, 5, 6, 7), Opponent: roster(10, 11, 12) },
    starters: { Hornets: [], Opponent: [] },
    events: [],
    ...overrides,
  };
}

test("starters default to the first five on the roster", () => {
  assert.deepEqual(startingLineup(game(), "Hornets"), [1, 2, 3, 4, 5]);
  assert.deepEqual(startingLineup(game({ starters: { Hornets: [7, 6] } }), "Hornets"), [7, 6, 1, 2, 3]);
  assert.deepEqual(startingLineup(game(), "Opponent"), [10, 11, 12]);
  assert.deepEqual(bench(game(), "Opponent"), []);
});

test("a sub puts the new player in the replaced player's slot", () => {
  const g = game({ events: [sub(1, "5:00", 6, 3)] });
  assert.deepEqual(currentLineup(g, "Hornets"), [1, 2, 6, 4, 5]);
  assert.deepEqual(bench(g, "Hornets"), [3, 7]);
});

test("subs that don't match the lineup are ignored", () => {
  const g = game({ events: [sub(1, "5:00", 2, 3), sub(1, "5:00", 6, 7)] });
  assert.deepEqual(currentLineup(g, "Hornets"), [1, 2, 3, 4, 5]);
});

test("players dropped from the roster are replaced from the bench", () => {
  const g = game({ rosters: { Hornets: roster(1, 2, 4, 5, 6, 7) } });
  assert.deepEqual(currentLineup(g, "Hornets"), [1, 2, 4, 5, 6]);
});

test("minutes count game-clock time across subs and periods", () => {
  const g = game({
    period: 2,
    lastTime: "6:00",
    events: [sub(1, "5:00", 6, 3), sub(1, "1:30", 3, 6), sub(2, "7:00", 7, 1)],
  });
  const minutes = secondsPlayed(g, "Hornets");
  assert.equal(minutes.get(1), 480 + 60); // all of Q1, one minute of Q2
  assert.equal(minutes.get(2), 480 + 120);
  assert.equal(minutes.get(3), 180 + 90 + 120); // 8:00-5:00, 1:30-0:00, Q2 so far
  assert.equal(minutes.get(6), 210); // 5:00-1:30
  assert.equal(minutes.get(7), 60);
});

test("no minutes before tip-off, and full periods once the game ends", () => {
  assert.equal(secondsPlayed(game(), "Hornets").get(1), 0);
  const ended = game({ period: 4, lastTime: "0:00" });
  assert.equal(secondsPlayed(ended, "Hornets").get(5), 4 * 480);
  assert.equal(secondsPlayed(ended, "Hornets").has(6), false);
});

test("games saved without lineups have unknown minutes", () => {
  assert.equal(secondsPlayed(game({ starters: undefined }), "Hornets"), null);
  assert.equal(formatMinutes(null), "--");
  assert.equal(formatMinutes(605), "10:05");
});
