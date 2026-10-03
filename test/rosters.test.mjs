import test from "node:test";
import assert from "node:assert/strict";
import { applyPickedRosters } from "../rosters.mjs";
import { bench, startingLineup } from "../lineups.mjs";

const roster = (...numbers) => numbers.map((number) => ({ number, name: `P${number}` }));

function game() {
  return {
    rosters: { Hornets: roster(0, 1, 2, 3, 5, 7), Opponent: roster(1, 2, 3, 4, 5) },
    starters: { Hornets: [2, 7], Opponent: [] },
    events: [],
  };
}

test("a team picked on the setup screen brings its roster into the game", () => {
  const g = applyPickedRosters(game(), {
    Hornets: roster(44, 13, 31, 22, 17, 58, 25),
    Opponent: roster(91, 12, 36, 73, 19, 40),
  });
  assert.deepEqual(g.rosters.Hornets.map((p) => p.number), [13, 17, 22, 25, 31, 44, 58]);
  assert.equal(g.rosters.Hornets[0].name, "P13");
  assert.deepEqual(startingLineup(g, "Hornets"), [13, 17, 22, 25, 31]);
  assert.deepEqual(bench(g, "Hornets"), [44, 58]);
  assert.deepEqual(startingLineup(g, "Opponent"), [12, 19, 36, 40, 73]);
  assert.deepEqual(bench(g, "Opponent"), [91]);
});

test("no pick or an empty team keeps the current roster", () => {
  const g = applyPickedRosters(game(), { Hornets: null, Opponent: [] });
  assert.deepEqual(g.rosters.Hornets.map((p) => p.number), [0, 1, 2, 3, 5, 7]);
  assert.deepEqual(g.starters.Hornets, [2, 7]);
  assert.deepEqual(g.rosters.Opponent.map((p) => p.number), [1, 2, 3, 4, 5]);
});
