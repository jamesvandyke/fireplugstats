// Who is on the court, and for how long. Shared by the scorer app, the live
// watch page, the saved-game summary and the tests.
//
// A game's lineup is its `starters` plus every "sub" event in order. A sub event
// is { action: "sub", team, player: <number coming in>, playerOut, period, time }.
// Minutes are game-clock time: a stint runs from the clock reading when a player
// went in to the reading when they came out (or the game's current clock).

export const COURT_SIZE = 5;

function clockSeconds(value) {
  const [minutes = "0", seconds = "0"] = String(value || "0:00").split(":");
  const total = Number(minutes) * 60 + Number(seconds);
  return Number.isFinite(total) ? total : 0;
}

function rosterNumbers(game, team) {
  return (game.rosters?.[team] || []).map((player) => player.number);
}

// Games saved before substitutions existed have no starters, so their minutes are unknown.
export function tracksMinutes(game) {
  return Boolean(game?.starters);
}

// The chosen starters still on the roster, filled out to five in roster order.
export function startingLineup(game, team) {
  const roster = rosterNumbers(game, team);
  const lineup = [...new Set(game.starters?.[team] || [])].filter((number) => roster.includes(number));
  for (const number of roster) {
    if (lineup.length >= COURT_SIZE) break;
    if (!lineup.includes(number)) lineup.push(number);
  }
  return lineup.slice(0, COURT_SIZE);
}

// The incoming player takes the outgoing player's slot so buttons don't jump around.
export function applySub(lineup, event) {
  const slot = lineup.indexOf(event.playerOut);
  if (slot === -1 || lineup.includes(event.player)) return lineup;
  const next = [...lineup];
  next[slot] = event.player;
  return next;
}

function subEvents(game, team) {
  return (game.events || []).filter((event) => event.team === team && event.action === "sub");
}

// Players on the court now. Anyone since dropped from the roster is replaced from the bench.
export function currentLineup(game, team) {
  const roster = rosterNumbers(game, team);
  const lineup = subEvents(game, team)
    .reduce(applySub, startingLineup(game, team))
    .filter((number) => roster.includes(number));
  for (const number of roster) {
    if (lineup.length >= COURT_SIZE) break;
    if (!lineup.includes(number)) lineup.push(number);
  }
  return lineup;
}

export function bench(game, team) {
  const lineup = currentLineup(game, team);
  return rosterNumbers(game, team).filter((number) => !lineup.includes(number));
}

// Game seconds elapsed at a period and clock reading. Overtime uses the regular
// period length, as the scorer's clock does.
function elapsedAt(periodSeconds, period, time) {
  const remaining = Math.min(Math.max(clockSeconds(time), 0), periodSeconds);
  return (Math.max(Number(period) || 1, 1) - 1) * periodSeconds + (periodSeconds - remaining);
}

// Map of player number to seconds on the court, or null when the game has no lineup data.
export function secondsPlayed(game, team) {
  if (!tracksMinutes(game)) return null;
  const periodSeconds = Number(game.periodSeconds) || 8 * 60;
  const totals = new Map();
  const onSince = new Map();
  const add = (number, seconds) => totals.set(number, (totals.get(number) || 0) + Math.max(0, seconds));

  let lineup = startingLineup(game, team);
  lineup.forEach((number) => onSince.set(number, 0));
  for (const event of subEvents(game, team)) {
    const next = applySub(lineup, event);
    if (next === lineup) continue;
    const at = elapsedAt(periodSeconds, event.period, event.time);
    add(event.playerOut, at - onSince.get(event.playerOut));
    onSince.delete(event.playerOut);
    onSince.set(event.player, at);
    lineup = next;
  }
  const end = elapsedAt(periodSeconds, game.period, game.lastTime);
  onSince.forEach((start, number) => add(number, end - start));
  return totals;
}

export function formatMinutes(seconds) {
  if (seconds === null || seconds === undefined) return "--";
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
