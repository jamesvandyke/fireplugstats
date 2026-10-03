// Roster cleanup and the setup screen's team pick. Shared by the scorer app and the tests.

export function sanitizePlayerName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 24);
}

export function sanitizeRoster(values) {
  const players = values
    .map((entry) => {
      if (typeof entry === "number") return { number: entry, name: "" };
      const number = Number(entry?.number);
      return {
        number,
        name: sanitizePlayerName(entry?.name || ""),
      };
    })
    .filter((player) => Number.isInteger(player.number) && player.number >= 0 && player.number <= 99);
  const byNumber = new Map();
  players.forEach((player) => byNumber.set(player.number, player));
  return [...byNumber.values()].sort((a, b) => a.number - b.number);
}

// A saved team picked on the setup screen brings its roster into the game. Its
// starters reset so the first five on the new roster start. A team with no
// players, or no pick ("Enter manually"), keeps the current roster.
export function applyPickedRosters(game, picked) {
  for (const team of ["Hornets", "Opponent"]) {
    const roster = sanitizeRoster(Array.isArray(picked?.[team]) ? picked[team] : []);
    if (!roster.length) continue;
    game.rosters[team] = roster;
    game.starters[team] = [];
  }
  return game;
}
