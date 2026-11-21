import test from "node:test";
import assert from "node:assert/strict";
import { describeCommand, normalizeText, parseCommands, parseSegment, splitPlays, teamForColor } from "../voice.mjs";

const roster = (...numbers) => numbers.map((number) => ({ number, name: "" }));

function game(overrides = {}) {
  return {
    teamNames: { Hornets: "Fireplugs", Opponent: "Gold Rush" },
    teamColors: { Hornets: "#ffffff", Opponent: "#d4a017" },
    rosters: { Hornets: roster(0, 3, 4, 5, 12, 17, 32), Opponent: roster(2, 4, 10, 23, 33) },
    ...overrides,
  };
}

// Strips the echo of what was heard so tests can compare the command itself.
const parse = (text, g = game()) => parseCommands(text, g).map(({ heard, ...command }) => command);

test("the examples from the plan", () => {
  const g = game({
    teamColors: { Hornets: "#ffffff", Opponent: "#111111" },
    rosters: { Hornets: roster(5, 17, 23, 32), Opponent: roster(4, 10) },
  });
  assert.deepEqual(parse("score white 32", g), [{ type: "shot", team: "Hornets", player: 32, made: true }]);
  assert.deepEqual(parse("miss black 4", g), [{ type: "shot", team: "Opponent", player: 4, made: false }]);
  assert.deepEqual(parse("rebound white 17", g), [{ type: "rebound", team: "Hornets", player: 17 }]);
  assert.deepEqual(parse("foul white 23", g), [{ type: "foul", team: "Hornets", player: 23 }]);
  assert.deepEqual(parse("steal white 5", g), [{ type: "steal", team: "Hornets", player: 5 }]);
  assert.deepEqual(parse("timeout black", g), [{ type: "timeout", team: "Opponent" }]);
  assert.deepEqual(parse("start clock", g), [{ type: "clock", run: true }]);
});

test("several plays in one breath come back in order", () => {
  assert.deepEqual(parse("miss gold 4 rebound white 17 foul gold 23"), [
    { type: "shot", team: "Opponent", player: 4, made: false },
    { type: "rebound", team: "Hornets", player: 17 },
    { type: "foul", team: "Opponent", player: 23 },
  ]);
  assert.deepEqual(parse("Score, white 32. Stop the clock."), [
    { type: "shot", team: "Hornets", player: 32, made: true },
    { type: "clock", run: false },
  ]);
});

test("number words and soundalikes", () => {
  assert.deepEqual(parse("score white thirty two"), [{ type: "shot", team: "Hornets", player: 32, made: true }]);
  assert.deepEqual(parse("foul gold for"), [{ type: "foul", team: "Opponent", player: 4 }]);
  assert.deepEqual(parse("steal gold to"), [{ type: "steal", team: "Opponent", player: 2 }]);
  assert.deepEqual(parse("rebound white twelve"), [{ type: "rebound", team: "Hornets", player: 12 }]);
  assert.deepEqual(parse("rebound gold twenty three"), [{ type: "rebound", team: "Opponent", player: 23 }]);
  assert.deepEqual(parse("foul white double oh"), [{ type: "foul", team: "Hornets", player: 0 }]);
  assert.deepEqual(parse("foul white number #3"), [{ type: "foul", team: "Hornets", player: 3 }]);
  assert.deepEqual(parse("steal white thirty 2"), [{ type: "steal", team: "Hornets", player: 32 }]);
});

test("word order is forgiving", () => {
  const expected = [{ type: "shot", team: "Hornets", player: 32, made: true }];
  assert.deepEqual(parse("white 32 score"), expected);
  assert.deepEqual(parse("score 32 white"), expected);
  assert.deepEqual(parse("bucket white 32"), expected);
});

test("verb soundalikes", () => {
  assert.deepEqual(parse("fowl gold 23"), [{ type: "foul", team: "Opponent", player: 23 }]);
  assert.deepEqual(parse("steel gold 10"), [{ type: "steal", team: "Opponent", player: 10 }]);
  assert.deepEqual(parse("mist gold 33"), [{ type: "shot", team: "Opponent", player: 33, made: false }]);
});

test("free throws need made or missed", () => {
  assert.deepEqual(parse("free throw white 32 made"), [{ type: "freeThrow", team: "Hornets", player: 32, made: true }]);
  assert.deepEqual(parse("free throw gold 4 missed rebound white 5"), [
    { type: "freeThrow", team: "Opponent", player: 4, made: false },
    { type: "rebound", team: "Hornets", player: 5 },
  ]);
  assert.deepEqual(parse("made free throw white 32"), [
    { type: "error", message: "Didn't hear a jersey number." },
    { type: "error", message: "Free throw made or missed?" },
  ]);
  assert.equal(parse("free throw white 32")[0].type, "error");
});

test("teams by name, home and away", () => {
  assert.deepEqual(parse("score fireplugs 32"), [{ type: "shot", team: "Hornets", player: 32, made: true }]);
  // "Gold Rush" is a team name, so its "gold" isn't read as a color word.
  assert.deepEqual(parse("score gold rush 10"), [{ type: "shot", team: "Opponent", player: 10, made: true }]);
  assert.deepEqual(parse("foul home 3"), [{ type: "foul", team: "Hornets", player: 3 }]);
  assert.deepEqual(parse("foul away 33"), [{ type: "foul", team: "Opponent", player: 33 }]);
});

test("color words match the closest jersey", () => {
  const g = game({ teamColors: { Hornets: "#1e3a8a", Opponent: "#f5f5f5" } });
  assert.equal(teamForColor("blue", g), "Hornets");
  assert.equal(teamForColor("navy", g), "Hornets");
  assert.equal(teamForColor("white", g), "Opponent");
  assert.equal(teamForColor("silver", g), "Opponent");
  assert.equal(teamForColor("blew", g), "Hornets");
  const greens = game({ teamColors: { Hornets: "#16a34a", Opponent: "#fbbf24" } });
  assert.equal(teamForColor("green", greens), "Hornets");
  assert.equal(teamForColor("yellow", greens), "Opponent");
  assert.equal(teamForColor("gold", greens), "Opponent");
});

test("a color halfway between both jerseys is refused", () => {
  const g = game({ teamColors: { Hornets: "#ffffff", Opponent: "#000000" } });
  assert.equal(teamForColor("gray", g), null);
  const [result] = parse("score gray 32", g);
  assert.equal(result.type, "error");
  assert.match(result.message, /gray/);
});

test("the team can be left out when only one has that number on the court", () => {
  assert.deepEqual(parse("score 32"), [{ type: "shot", team: "Hornets", player: 32, made: true }]);
  // Both rosters have a #4, but only one has them on the court.
  const g = game({ lineups: { Hornets: [0, 3, 5, 12, 17], Opponent: [2, 4, 10, 23, 33] } });
  assert.deepEqual(parse("foul 4", g), [{ type: "foul", team: "Opponent", player: 4 }]);
  const [both] = parse("foul 4");
  assert.equal(both.type, "error");
  assert.match(both.message, /Both teams have #4/);
});

test("numbers not on the roster are rejected, with close ones suggested", () => {
  const [result] = parse("score white 31");
  assert.equal(result.type, "error");
  assert.equal(result.message, "Fireplugs has no #31. Did you mean #3, #32?");
  assert.match(parse("score 99")[0].message, /Nobody wears #99/);
  assert.match(parse("score white 3 2")[0].message, /more than one number/);
});

test("timeouts belong to a team, or to the officials", () => {
  assert.deepEqual(parse("timeout gold"), [{ type: "timeout", team: "Opponent" }]);
  assert.deepEqual(parse("white time out"), [{ type: "timeout", team: "Hornets" }]);
  assert.deepEqual(parse("ref timeout"), [{ type: "timeout", team: null }]);
  assert.deepEqual(parse("official's time out"), [{ type: "timeout", team: null }]);
  assert.match(parse("timeout")[0].message, /Whose timeout/);
});

test("subs", () => {
  assert.deepEqual(parse("sub white 12 for 5"), [{ type: "sub", team: "Hornets", playerIn: 12, playerOut: 5 }]);
  assert.deepEqual(parse("sub white 17 in for 32"), [{ type: "sub", team: "Hornets", playerIn: 17, playerOut: 32 }]);
  assert.deepEqual(parse("sub 10 for 33"), [{ type: "sub", team: "Opponent", playerIn: 10, playerOut: 33 }]);
  assert.match(parse("sub white 12")[0].message, /sub white 12 for 5/);
  assert.match(parse("sub white 12 for 99")[0].message, /no #99/);
  assert.match(parse("sub white 1 2 for 5")[0].message, /one number each side/);
  assert.match(parse("sub white 12 for 3 5")[0].message, /one number each side/);
});

test("clock, undo, cancel and no rebound", () => {
  assert.deepEqual(parse("stop clock"), [{ type: "clock", run: false }]);
  assert.deepEqual(parse("pause"), [{ type: "clock", run: false }]);
  assert.deepEqual(parse("clock"), [{ type: "clock", run: "toggle" }]);
  assert.deepEqual(parse("undo"), [{ type: "undo" }]);
  assert.deepEqual(parse("cancel"), [{ type: "cancel" }]);
  assert.deepEqual(parse("no rebound"), [{ type: "noRebound" }]);
});

test("plays can be resolved one at a time against the lineup they'll meet", () => {
  const g = game({ lineups: { Hornets: [0, 3, 5, 17, 32], Opponent: [2, 4, 10, 23, 12] }, rosters: { Hornets: roster(0, 3, 5, 12, 17, 32), Opponent: roster(2, 4, 10, 12, 23, 33) } });
  const [sub1, sub2, foul] = splitPlays("sub white 12 for 5 sub gold 33 for 12 foul 12", g);
  assert.equal(parseSegment(sub1, g).type, "sub");
  assert.equal(parseSegment(sub2, g).type, "sub");
  const after = { ...g, lineups: { Hornets: [0, 3, 12, 17, 32], Opponent: [2, 4, 10, 23, 33] } };
  assert.deepEqual(parseSegment(foul, after), { type: "foul", team: "Hornets", player: 12, heard: "foul 12" });
});

test("words with no play are reported, not guessed", () => {
  const [result] = parseCommands("white 32", game());
  assert.equal(result.type, "error");
  assert.equal(result.heard, "white 32");
  assert.deepEqual(parse(""), []);
});

test("banner text", () => {
  const g = game();
  assert.equal(describeCommand(parse("score white 32", g)[0], g), "Made shot: Fireplugs #32");
  assert.equal(describeCommand(parse("sub white 12 for 5", g)[0], g), "Sub: Fireplugs #12 in for #5");
  assert.equal(describeCommand(parse("ref timeout", g)[0], g), "Official's timeout");
});

test("normalizing", () => {
  assert.equal(normalizeText("Free Throws, #32 — Made!"), "freethrow 32 made");
  assert.equal(normalizeText("Referee's time-out"), "reftimeout");
});
