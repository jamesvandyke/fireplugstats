// Turns spoken (or typed) play calls into commands, e.g.
//   "score white 32, miss black 4, rebound green 17, foul gold 23, timeout white, start clock"
// Pure functions with no DOM, shared by the scorer app and the tests.
//
// parseCommands(text, game) returns one entry per play heard, in order. Each is a
// command such as { type: "shot", team: "Hornets", player: 32, made: true } or
// { type: "error", heard, message } when a play couldn't be understood.
//
// `game` needs teamNames, teamColors and rosters (as stored by the app), and may
// include lineups: { Hornets: [numbers], Opponent: [numbers] } of players on the
// court, used to work out the team when none is said, and voiceWords:
// { Hornets: "white, silver", Opponent: "" }, extra comma-separated words that
// name each team.

export const TEAMS = ["Hornets", "Opponent"];

// Reference shades for spoken color words. A color word picks whichever team's
// jersey color is clearly closest to it.
const COLOR_WORDS = {
  white: "#ffffff",
  black: "#111111",
  gray: "#808080",
  grey: "#808080",
  silver: "#c0c0c0",
  red: "#dc2626",
  maroon: "#7f1d1d",
  orange: "#f97316",
  gold: "#d4a017",
  yellow: "#facc15",
  green: "#16a34a",
  teal: "#0f766e",
  blue: "#2563eb",
  navy: "#1e3a8a",
  purple: "#7c3aed",
  pink: "#ec4899",
  brown: "#78350f",
};

// What speech engines tend to write instead of the color word.
const COLOR_SOUNDALIKES = {
  blew: "blue",
  great: "gray",
  golden: "gold",
  read: "red",
  greene: "green",
  teel: "teal",
  marine: "maroon",
  purpose: "purple",
};

const UNITS = {
  zero: 0, oh: 0, o: 0,
  one: 1, won: 1,
  two: 2, to: 2, too: 2,
  three: 3, tree: 3,
  four: 4, for: 4, fore: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8, ate: 8,
  nine: 9, nein: 9,
};
const TEENS = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

// Words that start a play, mapped to the play they start.
const VERBS = {
  score: "made", scores: "made", scored: "made", made: "made", make: "made", makes: "made",
  bucket: "made", basket: "made", hit: "made", hits: "made", good: "made",
  sank: "made", sinks: "made", drained: "made", drains: "made", swish: "made", scoring: "made",
  miss: "missed", missed: "missed", misses: "missed", mist: "missed", mister: "missed",
  brick: "missed", bricked: "missed", bricks: "missed", airball: "missed",
  freethrow: "freeThrow",
  rebound: "rebound", rebounds: "rebound", board: "rebound", boards: "rebound",
  norebound: "noRebound", skip: "noRebound",
  foul: "foul", fouls: "foul", fouled: "foul", fowl: "foul",
  steal: "steal", steals: "steal", steel: "steal", stole: "steal",
  sub: "sub", subs: "sub", substitution: "sub", substitute: "sub",
  timeout: "timeout", timeouts: "timeout",
  reftimeout: "refTimeout",
  clockstart: "clockStart", start: "clockStart", resume: "clockStart",
  clockstop: "clockStop", stop: "clockStop", pause: "clockStop",
  clock: "clockToggle",
  undo: "undo",
  cancel: "cancel", never: "cancel",
};

const PLAYER_PLAYS = new Set(["made", "missed", "freeThrow", "rebound", "foul", "steal"]);

export function normalizeText(text) {
  return ` ${String(text).toLowerCase()} `
    .replace(/#/g, " ")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/'s\b/g, "")
    .replace(/'/g, "")
    .replace(/\b(?:free\s*throws?|foul\s+shots?)\b/g, " freethrow ")
    .replace(/\bair\s+ball\b/g, " airball ")
    .replace(/\btime\s*outs?\b/g, " timeout ")
    .replace(/\b(?:ref|refs|referee|referees|official|officials)\s+timeout\b/g, " reftimeout ")
    .replace(/\bno\s+(?:rebound|board)s?\b/g, " norebound ")
    .replace(/\b(?:start|resume|run)\s+(?:the\s+)?clock\b/g, " clockstart ")
    .replace(/\b(?:stop|pause|hold)\s+(?:the\s+)?clock\b/g, " clockstop ")
    .replace(/\bclock\s+(?:start|go|run|resume)\b/g, " clockstart ")
    .replace(/\bclock\s+(?:stop|pause|hold)\b/g, " clockstop ")
    .replace(/\bin\s+for\b/g, " for ")
    .replace(/\bdouble\s+(?:zero|oh|o)\b/g, " 0 ")
    .replace(/\s+/g, " ")
    .trim();
}

function words(text) {
  return text ? text.split(" ") : [];
}

// Tokens for a team named in the text. Team names are matched first so a team
// called "Gold Rush" isn't read as the color gold.
export function teamWords(game, team) {
  const extra = String(game.voiceWords?.[team] || "").split(",");
  return [game.teamNames?.[team] || "", ...extra]
    .map(normalizeText)
    .filter((words) => words && !VERBS[words] && !/^\d+$/.test(words));
}

function tagTeams(text, game) {
  let tagged = ` ${text} `;
  // Longest first, so "gold rush" is tagged before a plain "gold".
  const names = TEAMS
    .flatMap((team) => teamWords(game, team).map((words) => ({ team, words })))
    .sort((a, b) => b.words.length - a.words.length);
  for (const { team, words } of names) {
    tagged = tagged.replace(new RegExp(` ${words}(?= )`, "g"), ` @${team}`);
  }
  return tagged
    .replace(/ (?:home|hometeam) /g, " @Hornets ")
    .replace(/ (?:away|visitor|visitors|visiting) /g, " @Opponent ")
    .trim();
}

function channels(color) {
  const hex = String(color).replace(/[^0-9a-f]/gi, "").slice(0, 6).padEnd(6, "0");
  return [0, 2, 4].map((start) => parseInt(hex.slice(start, start + 2), 16));
}

// "Redmean" color distance: cheap and close enough to how far apart colors look.
function colorDistance(a, b) {
  const [r1, g1, b1] = channels(a);
  const [r2, g2, b2] = channels(b);
  const rMean = (r1 + r2) / 2;
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt((2 + rMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rMean) / 256) * db * db);
}

// The team a spoken color word means, or null when both jerseys are about as close.
export function teamForColor(word, game) {
  const reference = COLOR_WORDS[COLOR_SOUNDALIKES[word] || word];
  if (!reference) return null;
  const [near, far] = TEAMS
    .map((team) => ({ team, distance: colorDistance(reference, game.teamColors?.[team] || "#000000") }))
    .sort((a, b) => a.distance - b.distance);
  return near.distance < far.distance * 0.75 ? near.team : null;
}

function isColorWord(word) {
  return Boolean(COLOR_WORDS[COLOR_SOUNDALIKES[word] || word]);
}

// Reads digits and number words ("thirty two", "for", "double oh") into numbers.
function readNumbers(tokens) {
  const numbers = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (/^\d{1,3}$/.test(token)) numbers.push(Number(token));
    else if (token in TEENS) numbers.push(TEENS[token]);
    else if (token in TENS) {
      const next = tokens[i + 1];
      if (next in UNITS && UNITS[next] > 0) {
        numbers.push(TENS[token] + UNITS[next]);
        i += 1;
      } else if (/^[1-9]$/.test(next || "")) {
        numbers.push(TENS[token] + Number(next));
        i += 1;
      } else numbers.push(TENS[token]);
    } else if (token in UNITS) numbers.push(UNITS[token]);
  }
  return numbers;
}

// Splits the text into one run of tokens per play. A play starts at its verb;
// words said before the first verb ("white 32 score") belong to it.
function segment(tokens) {
  const segments = [];
  let leading = [];
  let current = null;
  for (const token of tokens) {
    const verb = VERBS[token];
    const isResult = verb === "made" || verb === "missed";
    if (verb && current?.verb === "freeThrow" && isResult && current.result === undefined) {
      current.result = verb === "made";
      current.words.push(token);
    } else if (verb) {
      current = { verb, words: [...leading, token], rest: [...leading] };
      leading = [];
      segments.push(current);
    } else if (current) {
      current.words.push(token);
      current.rest.push(token);
    } else {
      leading.push(token);
    }
  }
  if (leading.length) segments.push({ verb: null, words: leading, rest: leading });
  return segments;
}

function heardText(words) {
  return words.join(" ").replace(/@(\w+)/g, (_, team) => team);
}

function rosterNumbers(game, team) {
  return (game.rosters?.[team] || []).map((player) => Number(player.number));
}

function onCourt(game, team) {
  return game.lineups?.[team] || rosterNumbers(game, team);
}

export function teamLabel(team, game) {
  return game.teamNames?.[team] || team;
}

// Roster numbers that sound or look like the one heard, for the error message.
function closeNumbers(game, team, number) {
  const heard = String(number);
  return rosterNumbers(game, team)
    .filter((n) => {
      const s = String(n);
      return s !== heard && (s.includes(heard) || heard.includes(s) || (s.length === 2 && heard.length === 2 && (s[0] === heard[0] || s[1] === heard[1])));
    })
    .slice(0, 4);
}

function findTeam(rest, game) {
  const teams = new Set();
  const unknownColors = [];
  for (const token of rest) {
    if (token.startsWith("@")) teams.add(token.slice(1));
    else if (isColorWord(token)) {
      const team = teamForColor(token, game);
      if (team) teams.add(team);
      else unknownColors.push(token);
    }
  }
  if (teams.size > 1) return { error: "Heard both teams in one play." };
  if (teams.size === 1) return { team: [...teams][0] };
  if (unknownColors.length) {
    return { error: `"${unknownColors[0]}" doesn't clearly match either team's color. Say the team name instead.` };
  }
  return { team: null };
}

function resolvePlayer(team, number, game) {
  if (team) {
    if (rosterNumbers(game, team).includes(number)) return { team, player: number };
    const close = closeNumbers(game, team, number);
    const hint = close.length ? ` Did you mean ${close.map((n) => `#${n}`).join(", ")}?` : "";
    return { error: `${teamLabel(team, game)} has no #${number}.${hint}` };
  }
  const courtMatches = TEAMS.filter((t) => onCourt(game, t).includes(number));
  const matches = courtMatches.length ? courtMatches : TEAMS.filter((t) => rosterNumbers(game, t).includes(number));
  if (matches.length === 1) return { team: matches[0], player: number };
  if (matches.length > 1) return { error: `Both teams have #${number}. Say the team's color.` };
  return { error: `Nobody wears #${number}.` };
}

export function parseSegment(seg, game) {
  const { verb, rest } = seg;
  const heard = heardText(seg.words);
  const fail = (message) => ({ type: "error", heard, message });

  if (!verb) {
    return fail("Didn't hear a play. Start with score, miss, free throw, rebound, foul, steal, sub, timeout or clock.");
  }
  if (verb === "undo") return { type: "undo", heard };
  if (verb === "cancel") return { type: "cancel", heard };
  if (verb === "noRebound") return { type: "noRebound", heard };
  if (verb === "clockStart") return { type: "clock", run: true, heard };
  if (verb === "clockStop") return { type: "clock", run: false, heard };
  if (verb === "clockToggle") return { type: "clock", run: "toggle", heard };
  if (verb === "refTimeout") return { type: "timeout", team: null, heard };

  const found = findTeam(rest, game);
  if (found.error) return fail(found.error);

  if (verb === "timeout") {
    if (!found.team) return fail("Whose timeout? Say a team color, or \"ref timeout\".");
    return { type: "timeout", team: found.team, heard };
  }

  if (verb === "sub") {
    const at = rest.indexOf("for");
    if (at === -1) return fail("Say it like \"sub white 12 for 5\".");
    const ins = readNumbers(rest.slice(0, at));
    const outs = readNumbers(rest.slice(at + 1));
    if (ins.length !== 1 || outs.length !== 1) return fail("Say it like \"sub white 12 for 5\", one number each side.");
    const [playerIn] = ins;
    const [playerOut] = outs;
    let team = found.team;
    if (!team) {
      const both = TEAMS.filter((t) => rosterNumbers(game, t).includes(playerIn) && onCourt(game, t).includes(playerOut));
      if (both.length !== 1) return fail("Which team? Say the team's color.");
      team = both[0];
    }
    for (const number of [playerIn, playerOut]) {
      const check = resolvePlayer(team, number, game);
      if (check.error) return fail(check.error);
    }
    return { type: "sub", team, playerIn, playerOut, heard };
  }

  if (PLAYER_PLAYS.has(verb)) {
    const numbers = readNumbers(rest);
    if (!numbers.length) return fail("Didn't hear a jersey number.");
    if (numbers.length > 1) return fail(`Heard more than one number (${numbers.join(", ")}).`);
    const who = resolvePlayer(found.team, numbers[0], game);
    if (who.error) return fail(who.error);
    if (verb === "made" || verb === "missed") {
      return { type: "shot", team: who.team, player: who.player, made: verb === "made", heard };
    }
    if (verb === "freeThrow") {
      if (seg.result === undefined) return fail("Free throw made or missed?");
      return { type: "freeThrow", team: who.team, player: who.player, made: seg.result, heard };
    }
    return { type: verb, team: who.team, player: who.player, heard };
  }

  return fail("Didn't understand that play.");
}

// The plays in the text, not yet resolved to commands. Resolve each one with
// parseSegment just before running it, so a team left out is worked out from
// the lineup after any earlier subs in the same breath.
export function splitPlays(text, game) {
  return segment(words(tagTeams(normalizeText(text), game)));
}

export function parseCommands(text, game) {
  return splitPlays(text, game).map((seg) => parseSegment(seg, game));
}

// A short line for the banner, e.g. "Made shot: White #32".
export function describeCommand(command, game) {
  const who = command.team ? `${teamLabel(command.team, game)} #${command.player}` : "";
  switch (command.type) {
    case "shot": return `${command.made ? "Made" : "Missed"} shot: ${who}`;
    case "freeThrow": return `${command.made ? "Made" : "Missed"} free throw: ${who}`;
    case "rebound": return `Rebound: ${who}`;
    case "foul": return `Foul: ${who}`;
    case "steal": return `Steal: ${who}`;
    case "sub": return `Sub: ${teamLabel(command.team, game)} #${command.playerIn} in for #${command.playerOut}`;
    case "timeout": return command.team ? `Timeout: ${teamLabel(command.team, game)}` : "Official's timeout";
    case "noRebound": return "No rebound";
    case "clock": return command.run === "toggle" ? "Clock" : command.run ? "Start clock" : "Stop clock";
    case "undo": return "Undo";
    case "cancel": return "Cancel";
    default: return command.message || "Didn't understand";
  }
}
