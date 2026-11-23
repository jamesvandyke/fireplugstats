import { applySub, bench, currentLineup, formatMinutes, secondsPlayed, startingLineup } from "./lineups.mjs?v=19";
import { applyPickedRosters, sanitizePlayerName, sanitizeRoster } from "./rosters.mjs?v=1";
import { describeCommand, parseSegment, splitPlays } from "./voice.mjs?v=3";
import { createVoiceListener, speechSupported } from "./speech.mjs?v=4";

const STORAGE_KEY = "fireplug.stats.game.v1";
const DEFAULT_CLOCK_SECONDS = 8 * 60;
const MAX_CLOCK_SECONDS = 20 * 60;
const MIN_CLOCK_SECONDS = 1;
const HIGH_SCHOOL_THREE_RADIUS = 19.75;
const ORIENTATIONS = [0, 90, 180, 270];
const DEFAULT_ROSTERS = {
  Hornets: [0, 1, 2, 3, 5, 7, 10, 11, 12, 14, 21, 24].map((number) => ({ number, name: "" })),
  Opponent: [1, 2, 3, 4, 5, 10, 11, 12, 20, 22, 23, 33].map((number) => ({ number, name: "" })),
};
const DEFAULT_TEAM_COLORS = {
  Hornets: "#0f766e",
  Opponent: "#b45309",
};

const state = loadState();
let draft = {};
let step = "player";
// Shots called by voice that still need a court tap, oldest first. The first one
// is on the court now. Each is { team, player, made, time, afterId, seq, rebound, phrase }:
// afterId is the last play logged when it was called and seq the order it was
// called in, so it slots in before anything said after it; rebound is a rebound
// said before the tap ("none" for no rebound).
let pendingShots = [];
let shotSeq = 0;
// Call order of plays placed from the queue, by event id.
const placedSeq = new Map();
let clockTimer = null;
let liveClockTicks = 0;
let savedGameId = null;
// Rosters of the saved teams picked on the setup screen, applied at Start Game.
let pickedRosters = { Hornets: null, Opponent: null };
// Team lookups still loading on the setup screen; Start Game waits for them.
const pendingTeamPicks = { home: null, away: null };

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const stepTitles = {
  player: ["Player", "Hornets on top, opponent below"],
  action: ["Action", ""],
  location: ["Location", "Tap the court"],
  result: ["Result", ""],
  rebound: ["Rebound", "Choose rebounder or skip"],
  subIn: ["Sub In", "Who is coming in?"],
  subOut: ["Sub Out", ""],
};

function defaultState() {
  return {
    period: 1,
    periodMode: "quarters",
    periodSeconds: DEFAULT_CLOCK_SECONDS,
    lastTime: "8:00",
    clockRunning: false,
    courtOrientation: 0,
    courtSwappedAtHalf: false,
    shotFilters: {
      team: "all",
      player: "all",
    },
    teamNames: {
      Hornets: "Hornets",
      Opponent: "Opponent",
    },
    teamColors: { ...DEFAULT_TEAM_COLORS },
    // Extra comma-separated words that name each team by voice.
    voiceWords: { Hornets: "", Opponent: "" },
    rosters: {
      Hornets: cloneRoster(DEFAULT_ROSTERS.Hornets),
      Opponent: cloneRoster(DEFAULT_ROSTERS.Opponent),
    },
    live: {
      enabled: false,
      gameId: "",
      watchUrl: "",
    },
    // Lineup at tip-off per team; empty means the first five on the roster.
    starters: { Hornets: [], Opponent: [] },
    events: [],
    gameStarted: false,
  };
}

function loadState() {
  try {
    return migrateState(JSON.parse(localStorage.getItem(STORAGE_KEY)) || defaultState());
  } catch {
    return defaultState();
  }
}

function migrateState(saved) {
  const periodMode = saved?.periodMode === "halves" ? "halves" : "quarters";
  return {
    ...defaultState(),
    ...saved,
    period: Math.max(Number(saved?.period) || 1, 1),
    periodMode,
    periodSeconds: periodClockLength(saved?.periodSeconds ? clockFromSeconds(saved.periodSeconds) : saved?.periodLength || saved?.lastTime || "8:00"),
    lastTime: normalizeClock(saved?.lastTime || "8:00"),
    clockRunning: false,
    courtOrientation: ORIENTATIONS.includes(saved?.courtOrientation) ? saved.courtOrientation : 0,
    courtSwappedAtHalf: Boolean(saved?.courtSwappedAtHalf),
    shotFilters: {
      team: ["Hornets", "Opponent", "all"].includes(saved?.shotFilters?.team) ? saved.shotFilters.team : "all",
      player: "all",
    },
    teamNames: {
      Hornets: sanitizeTeamName(saved?.teamNames?.Hornets, "Hornets"),
      Opponent: sanitizeTeamName(saved?.teamNames?.Opponent, "Opponent"),
    },
    teamColors: {
      Hornets: sanitizeColor(saved?.teamColors?.Hornets, DEFAULT_TEAM_COLORS.Hornets),
      Opponent: sanitizeColor(saved?.teamColors?.Opponent, DEFAULT_TEAM_COLORS.Opponent),
    },
    voiceWords: {
      Hornets: sanitizeVoiceWords(saved?.voiceWords?.Hornets),
      Opponent: sanitizeVoiceWords(saved?.voiceWords?.Opponent),
    },
    rosters: {
      Hornets: sanitizeRoster(saved?.rosters?.Hornets || DEFAULT_ROSTERS.Hornets),
      Opponent: sanitizeRoster(saved?.rosters?.Opponent || DEFAULT_ROSTERS.Opponent),
    },
    live: {
      enabled: Boolean(saved?.live?.enabled && saved?.live?.gameId),
      gameId: String(saved?.live?.gameId || ""),
      watchUrl: String(saved?.live?.watchUrl || ""),
    },
    starters: {
      Hornets: sanitizeNumbers(saved?.starters?.Hornets),
      Opponent: sanitizeNumbers(saved?.starters?.Opponent),
    },
    events: Array.isArray(saved?.events) ? saved.events : [],
    gameStarted: Boolean(saved?.gameStarted),
  };
}

function sanitizeVoiceWords(value) {
  return String(value || "").replace(/[^\p{L}\p{N} ,'-]/gu, "").slice(0, 60);
}

function sanitizeNumbers(values) {
  return Array.isArray(values) ? values.map(Number).filter((number) => Number.isInteger(number)) : [];
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

async function loadSetupTeams() {
  const homeSelect = $("#setupHomeTeam");
  const awaySelect = $("#setupAwayTeam");
  if (!homeSelect || !awaySelect) return;
  try {
    const res = await fetch("/api/teams");
    if (!res.ok) throw new Error();
    const teams = await res.json();
    const options = teams.length
      ? teams.map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`).join("")
      : "";
    const placeholder = '<option value="">— Enter manually —</option>';
    homeSelect.innerHTML = placeholder + options;
    awaySelect.innerHTML = placeholder + options;
  } catch {
    homeSelect.innerHTML = '<option value="">— Enter manually —</option>';
    awaySelect.innerHTML = '<option value="">— Enter manually —</option>';
  }
}

async function applySetupTeam(teamId, side) {
  const key = side === "home" ? "Hornets" : "Opponent";
  pickedRosters[key] = null;
  if (!teamId) return;
  try {
    const res = await fetch(`/api/teams/${encodeURIComponent(teamId)}`);
    if (!res.ok) return;
    const team = await res.json();
    // Ignore a slow response for a team that is no longer selected.
    if ($(side === "home" ? "#setupHomeTeam" : "#setupAwayTeam").value !== teamId) return;
    pickedRosters[key] = team.roster || null;
    if (side === "home") {
      $("#setupHomeName").value = team.name || "";
      $("#setupHomeColor").value = sanitizeColor(team.color, DEFAULT_TEAM_COLORS.Hornets);
    } else {
      $("#setupAwayName").value = team.name || "";
      $("#setupAwayColor").value = sanitizeColor(team.color, DEFAULT_TEAM_COLORS.Opponent);
    }
  } catch {}
}

function showSetup() {
  const setupView = $("#setupView");
  const shell = $(".shell");
  if (!setupView || !shell) return;
  setupView.style.display = "flex";
  shell.style.display = "none";
  $("#setupHomeName").value = teamName("Hornets");
  $("#setupHomeColor").value = teamColor("Hornets");
  $("#setupAwayName").value = teamName("Opponent");
  $("#setupAwayColor").value = teamColor("Opponent");
  $$("input[name='setupPeriodMode']").forEach((input) => {
    input.checked = input.value === state.periodMode;
  });
  $("#setupPeriodLength").value = clockFromSeconds(state.periodSeconds);
  pickedRosters = { Hornets: null, Opponent: null };
  loadSetupTeams();
  const teamFilter = new URLSearchParams(window.location.search).get("team");
  const titleEl = document.querySelector(".setup-history-title");
  if (titleEl) titleEl.textContent = teamFilter ? `Games — ${teamFilter}` : "Past Games";
  loadPastGames().then((games) => {
    const filtered = teamFilter
      ? games.filter((g) => g.teamNames?.Hornets === teamFilter || g.teamNames?.Opponent === teamFilter)
      : games;
    renderHistory(filtered, $("#setupPastGamesList"));
  });
}

function pickSetupTeam(teamId, side) {
  const pick = applySetupTeam(teamId, side);
  pendingTeamPicks[side] = pick;
  pick.finally(() => {
    if (pendingTeamPicks[side] === pick) pendingTeamPicks[side] = null;
  });
}

async function startGame() {
  const button = $("#startGameBtn");
  if (button.disabled) return;
  button.disabled = true;
  try {
    await Promise.all(Object.values(pendingTeamPicks));
  } finally {
    button.disabled = false;
  }
  const homeName = sanitizeTeamName($("#setupHomeName").value, "Hornets");
  const awayName = sanitizeTeamName($("#setupAwayName").value, "Opponent");
  const homeColor = sanitizeColor($("#setupHomeColor").value, DEFAULT_TEAM_COLORS.Hornets);
  const awayColor = sanitizeColor($("#setupAwayColor").value, DEFAULT_TEAM_COLORS.Opponent);
  const periodMode = $("input[name='setupPeriodMode']:checked")?.value === "halves" ? "halves" : "quarters";
  const periodSeconds = periodClockLength($("#setupPeriodLength").value);

  state.teamNames.Hornets = homeName;
  state.teamNames.Opponent = awayName;
  state.teamColors.Hornets = homeColor;
  state.teamColors.Opponent = awayColor;
  state.voiceWords = { Hornets: "", Opponent: "" };
  state.periodMode = periodMode;
  state.periodSeconds = periodSeconds;
  applyPickedRosters(state, pickedRosters);
  if (state.events.length === 0) state.lastTime = clockFromSeconds(periodSeconds);
  state.gameStarted = true;
  persist();

  $("#setupView").style.display = "none";
  $(".shell").style.display = "";
  render();
}

async function saveGameToServer() {
  if (state.events.length === 0) return null;
  if (savedGameId) return savedGameId;
  try {
    const response = await fetch("/api/saved-games", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(publicGameState()),
    });
    if (!response.ok) return null;
    const { id } = await response.json();
    savedGameId = id;
    return id;
  } catch {
    return null;
  }
}

async function loadPastGames() {
  try {
    const response = await fetch("/api/saved-games");
    if (!response.ok) return [];
    return await response.json();
  } catch {
    return [];
  }
}

function renderHistory(games, list = $("#pastGamesList")) {
  if (!list) return;
  if (!games.length) {
    list.innerHTML = '<p style="color:var(--muted);font-size:13px">No saved games yet.</p>';
    return;
  }
  list.innerHTML = games.map((g) => {
    const home = g.teamNames?.Hornets || "Hornets";
    const away = g.teamNames?.Opponent || "Opponent";
    const score = g.finalScore ? `${g.finalScore.Hornets}–${g.finalScore.Opponent}` : "";
    const date = g.savedAt ? new Date(g.savedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
    return `<div class="history-entry">
      <div class="history-info">
        <strong>${escapeHtml(home)} vs ${escapeHtml(away)}</strong>
        <span>${score ? escapeHtml(score) + " · " : ""}${escapeHtml(date)}</span>
      </div>
      <a class="text-btn history-view-btn" href="/summary.html?game=${encodeURIComponent(g.id)}" target="_blank">View</a>
    </div>`;
  }).join("");
}

async function shareSummary() {
  const shareBtn = $("#shareBtn");
  if (shareBtn) shareBtn.disabled = true;
  const id = await saveGameToServer();
  if (shareBtn) shareBtn.disabled = false;
  if (!id) {
    alert("Could not save game to server. Check that storage is configured.");
    return;
  }
  const url = `${window.location.origin}/summary.html?game=${encodeURIComponent(id)}`;
  const homeName = teamName("Hornets");
  const awayName = teamName("Opponent");
  if (navigator.share) {
    navigator.share({ title: `${homeName} vs ${awayName} — Game Summary`, url }).catch(() => {});
  } else {
    await navigator.clipboard?.writeText(url);
    alert("Summary link copied to clipboard.");
  }
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

function secondsFromClock(value) {
  const [minutes = "0", seconds = "0"] = String(value).split(":");
  const total = Number(minutes) * 60 + Number(seconds);
  return Number.isFinite(total) ? Math.max(0, Math.min(MAX_CLOCK_SECONDS, total)) : DEFAULT_CLOCK_SECONDS;
}

function clockFromSeconds(total) {
  const safe = Math.max(0, Math.min(MAX_CLOCK_SECONDS, total));
  const minutes = Math.floor(safe / 60);
  const seconds = String(safe % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function periodClockLength(value) {
  return Math.max(MIN_CLOCK_SECONDS, secondsFromClock(value));
}

function maxPeriods() {
  return state.periodMode === "halves" ? 2 : 4;
}

function periodLabel(period = state.period, mode = state.periodMode) {
  const regulation = mode === "halves" ? 2 : 4;
  if (period > regulation) return `OT${period - regulation}`;
  return `${mode === "halves" ? "H" : "Q"}${period}`;
}

function normalizeClock(value) {
  const raw = String(value).replace(/[^\d:]/g, "");
  if (raw.includes(":")) return clockFromSeconds(secondsFromClock(raw));
  if (raw.length <= 2) return clockFromSeconds(Number(raw));
  return clockFromSeconds(Number(raw.slice(0, -2)) * 60 + Number(raw.slice(-2)));
}

function scoreFor(team) {
  return state.events
    .filter((event) => event.team === team && event.action === "shot" && event.made)
    .reduce((sum, event) => sum + event.points, 0);
}

function teamName(team) {
  return state.teamNames?.[team] || team;
}

function teamColor(team) {
  return state.teamColors?.[team] || DEFAULT_TEAM_COLORS[team];
}

function statsForPlayer(team, player) {
  return statsForEvents(state.events.filter((event) => event.team === team && event.player === player));
}

function statsForTeam(team) {
  return statsForEvents(state.events.filter((event) => event.team === team));
}

function statsForEvents(events) {
  const shots = events.filter((event) => event.action === "shot");
  const fieldShots = shots.filter((event) => event.shotType !== "freeThrow");
  const threes = fieldShots.filter((event) => event.points === 3);
  const freeThrows = shots.filter((event) => event.shotType === "freeThrow");
  return {
    points: shots.filter((event) => event.made).reduce((sum, event) => sum + event.points, 0),
    fgMade: fieldShots.filter((event) => event.made).length,
    fgAtt: fieldShots.length,
    threeMade: threes.filter((event) => event.made).length,
    threeAtt: threes.length,
    ftMade: freeThrows.filter((event) => event.made).length,
    ftAtt: freeThrows.length,
    rebounds: events.filter((event) => event.action === "rebound").length,
    steals: events.filter((event) => event.action === "steal").length,
    fouls: events.filter((event) => event.action === "foul").length,
  };
}

function pct(made, attempts) {
  return attempts ? `${Math.round((made / attempts) * 100)}%` : "--";
}

function sanitizeColor(value, fallback) {
  const clean = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(clean) ? clean : fallback;
}

function textColorFor(background) {
  const hex = sanitizeColor(background, "#111827").slice(1);
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  return (red * 299 + green * 587 + blue * 114) / 1000 > 150 ? "#111827" : "#ffffff";
}

function applyTeamColors() {
  const root = document.documentElement;
  const hornets = teamColor("Hornets");
  const opponent = teamColor("Opponent");
  root.style.setProperty("--hornets", hornets);
  root.style.setProperty("--hornets-text", textColorFor(hornets));
  root.style.setProperty("--away", opponent);
  root.style.setProperty("--away-text", textColorFor(opponent));
}

function classifyShot(x, y) {
  const courtX = (x / 100) * 50;
  const courtY = (y / 100) * 47;
  const hoopX = 25;
  const hoopY = 41.75;
  const dx = courtX - hoopX;
  const dy = courtY - hoopY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const isThree = distance > HIGH_SCHOOL_THREE_RADIUS;
  if (distance < 4) return { zone: "At Rim", points: 2 };
  if (courtX >= 19 && courtX <= 31 && courtY >= 28) return { zone: "Paint", points: 2 };
  if (isThree) {
    if (courtX < 12) return { zone: "Left Corner 3", points: 3 };
    if (courtX > 38) return { zone: "Right Corner 3", points: 3 };
    if (courtX < 22) return { zone: "Left Wing 3", points: 3 };
    if (courtX > 28) return { zone: "Right Wing 3", points: 3 };
    return { zone: "Top 3", points: 3 };
  }
  if (courtX < 19) return { zone: "Left Midrange", points: 2 };
  if (courtX > 31) return { zone: "Right Midrange", points: 2 };
  return { zone: "Midrange", points: 2 };
}

function renderPlayers() {
  ["Hornets", "Opponent"].forEach((team) => {
    const lineup = currentLineup(state, team);
    const onCourt = lineup.map((number) => playerButton(team, playerFor(team, number))).join("");
    const subButton = bench(state, team).length
      ? `<button class="player-btn sub-btn" data-team="${team}">Sub</button>`
      : "";
    const prefix = team === "Hornets" ? "hornets" : "opponent";
    $(`#${prefix}Players`).innerHTML = onCourt + subButton;
    $(`#rebound${team}Players`).innerHTML = lineup
      .map((number) => playerButton(team, playerFor(team, number), "player-btn rebound-player-btn"))
      .join("");
  });
  renderSubChoices();
}

function renderSubChoices() {
  if (!draft.subTeam || (step !== "subIn" && step !== "subOut")) return;
  const team = draft.subTeam;
  const numbers = step === "subOut" ? currentLineup(state, team) : bench(state, team);
  const className = step === "subOut" ? "player-btn sub-out-btn" : "player-btn sub-in-btn";
  const grid = $(`#${step}Players`);
  grid.classList.toggle("opponent-grid", team === "Opponent");
  grid.innerHTML = numbers.map((number) => playerButton(team, playerFor(team, number), className)).join("");
}

function playerButton(team, player, className = "player-btn") {
  const label = player.name ? `<small>${escapeHtml(player.name)}</small>` : "";
  return `<button class="${className}" data-team="${team}" data-player="${player.number}"><span>${player.number}</span>${label}</button>`;
}

// Before any game time has run or any play is logged, a sub changes who starts
// instead of logging a substitution.
function isBeforeTipOff() {
  return state.events.length === 0 && state.period === 1 && secondsFromClock(state.lastTime) >= state.periodSeconds;
}

function saveSub(team, playerIn, playerOut) {
  const event = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    period: state.period,
    periodMode: state.periodMode,
    time: state.lastTime,
    team,
    player: Number(playerIn),
    action: "sub",
    playerOut: Number(playerOut),
  };
  if (isBeforeTipOff()) {
    state.starters[team] = applySub(currentLineup(state, team), event);
  } else {
    state.events.push(event);
  }
  persist();
  resetDraft();
  render();
  publishLiveSoon();
}

function courtRotationFor(team) {
  return team === "Opponent" ? (state.courtOrientation + 180) % 360 : state.courtOrientation;
}

function toBaseShotLocation(x, y, team) {
  const rotation = courtRotationFor(team);
  if (rotation === 90) return { x: 100 - y, y: x };
  if (rotation === 180) return { x: 100 - x, y: 100 - y };
  if (rotation === 270) return { x: y, y: 100 - x };
  return { x, y };
}

function toVisualShotLocation(location, team) {
  const rotation = courtRotationFor(team);
  if (rotation === 90) return { x: location.y, y: 100 - location.x };
  if (rotation === 180) return { x: 100 - location.x, y: 100 - location.y };
  if (rotation === 270) return { x: 100 - location.y, y: location.x };
  return location;
}

function applyCourtOrientation(court, team) {
  court.classList.remove("rotated", "rotated-right", "rotated-left");
  const rotation = courtRotationFor(team);
  if (rotation === 180) court.classList.add("rotated");
  if (rotation === 90) court.classList.add("rotated-left");
  if (rotation === 270) court.classList.add("rotated-right");
}

function setStep(nextStep) {
  step = nextStep;
  $$(".step").forEach((el) => el.classList.toggle("active", el.id === `${step}Step`));
  const [title, meta] = stepTitles[step];
  $("#stepTitle").textContent = title;
  $("#stepMeta").textContent = step === "player"
    ? `${teamName("Hornets")} on top, ${teamName("Opponent")} below`
    : step === "subIn"
      ? `${teamName(draft.subTeam)}: ${meta}`
      : step === "subOut"
        ? `${playerLabel(draft.subTeam, Number(draft.subIn))} in for who?`
        : meta || playerLabel(draft.team, Number(draft.player));
  $("#backBtn").disabled = step === "player";
  if (step === "location") applyCourtOrientation($("#shotCourt"), draft.team);
  renderShotQueue();
  if (step === "subIn" || step === "subOut") renderSubChoices();
  applyInputMode();
}

function resetDraft() {
  $("#pendingShotMarker").style.display = "none";
  if (pendingShots.length) {
    const shot = pendingShots[0];
    draft = { team: shot.team, player: String(shot.player), time: shot.time, action: "shot", made: shot.made, queued: shot };
    setStep("location");
    revealCourt();
    return;
  }
  draft = {};
  tapFallback = false;
  setStep("player");
}

// Brings the whole court above the mic bar so a shot can be tapped without
// scrolling. Instant, and only when needed: on iPhone a tap during a smooth
// scroll only stops the scroll, so the first tap on the court was lost.
function revealCourt() {
  const court = $("#shotCourt");
  const bar = $("#micBar");
  const limit = bar && !bar.hidden ? bar.getBoundingClientRect().top : window.innerHeight;
  const rect = court.getBoundingClientRect();
  if (rect.top >= 0 && rect.bottom <= limit) return;
  court.scrollIntoView?.({ block: "end", behavior: "instant" });
}

// Drops the shot on the court now (from the ✕, Back or "cancel").
function dropCurrentShot() {
  if (draft.queued) pendingShots = pendingShots.filter((shot) => shot !== draft.queued);
  resetDraft();
  render();
}

function renderShotQueue() {
  const box = $("#shotQueue");
  const shot = step === "location" ? draft.queued : null;
  box.hidden = !shot;
  if (!shot) return;
  const rebound = shot.rebound && shot.rebound !== "none"
    ? `, rebound ${playerLabel(shot.rebound.team, shot.rebound.player)}`
    : "";
  $("#shotQueueText").textContent = `Tap for: ${playerLabel(shot.team, shot.player)}, ${shot.made ? "made" : "missed"}${rebound}`;
  const more = pendingShots.length - 1;
  $("#shotQueueMore").textContent = more > 0 ? `${more} more waiting` : "";
}

// Adds a play right after the play with afterId (null means before everything),
// past any queued plays called before it. At the end when afterId is undefined
// or that play is gone.
function insertEvent(event, afterId, seq = Infinity) {
  let index = afterId === null ? 0 : state.events.findIndex((item) => item.id === afterId) + 1;
  if (afterId === undefined || (afterId !== null && index === 0)) {
    state.events.push(event);
    return;
  }
  while (index < state.events.length && placedSeq.get(state.events[index].id) < seq) index += 1;
  state.events.splice(index, 0, event);
}

function renderScore() {
  applyTeamColors();
  $("#homeTeamLabel").textContent = teamName("Hornets");
  $("#awayTeamLabel").textContent = teamName("Opponent");
  $("#homePlayersLabel").textContent = teamName("Hornets");
  $("#awayPlayersLabel").textContent = teamName("Opponent");
  $("#reboundHomePlayersLabel").textContent = teamName("Hornets");
  $("#reboundAwayPlayersLabel").textContent = teamName("Opponent");
  $("#hornetsScore").textContent = scoreFor("Hornets");
  $("#opponentScore").textContent = scoreFor("Opponent");
  $("#periodLabel").textContent = periodLabel();
  $("#clockLabel").textContent = state.lastTime;
  $("#adjustClockDisplay").textContent = state.lastTime;
  $("#adjustPeriodDisplay").textContent = periodLabel();
  $("#clockToggle").classList.toggle("running", state.clockRunning);
  $("#clockToggle").setAttribute("aria-label", state.clockRunning ? "Pause clock" : "Start clock");
  $("#liveBtn").classList.toggle("active", state.live.enabled);
  $("#liveBtn").textContent = state.live.enabled ? "Live On" : "Live";
  $("#undoBtn").disabled = state.events.length === 0;
}

function renderBox() {
  $("#boxRows").innerHTML = ["Hornets", "Opponent"].map((team) => {
    const rosterNumbers = withEventOnlyPlayers(team);
    const minutes = secondsPlayed(publicGameState(), team);
    const rows = rosterNumbers.map((number) => {
      const stats = statsForPlayer(team, number);
      return boxRow(playerLabel(team, number), stats, "", minutes ? formatMinutes(minutes.get(number) || 0) : "--");
    }).join("");
    return `<tr class="team-box-row"><th colspan="12">${escapeHtml(teamName(team))}</th></tr>${rows}${boxRow("Team", statsForTeam(team), "total-row", "")}`;
  }).join("");
}

function boxRow(label, stats, className = "", minutes = "") {
  return `<tr${className ? ` class="${className}"` : ""}>
        <th>${escapeHtml(label)}</th>
        <td>${minutes}</td>
        <td>${stats.points}</td>
        <td>${stats.fgMade}-${stats.fgAtt}</td>
        <td>${pct(stats.fgMade, stats.fgAtt)}</td>
        <td>${stats.threeMade}-${stats.threeAtt}</td>
        <td>${pct(stats.threeMade, stats.threeAtt)}</td>
        <td>${stats.ftMade}-${stats.ftAtt}</td>
        <td>${pct(stats.ftMade, stats.ftAtt)}</td>
        <td>${stats.rebounds}</td>
        <td>${stats.steals}</td>
        <td>${stats.fouls}</td>
      </tr>`;
}

function withEventOnlyPlayers(team) {
  const roster = (state.rosters[team] || []).map((player) => player.number);
  const eventPlayers = state.events
    .filter((event) => event.team === team && Number.isInteger(event.player))
    .map((event) => event.player);
  return [...new Set([...roster, ...eventPlayers])].sort((a, b) => a - b);
}

function parseRoster(value) {
  const lines = String(value).split(/\n|,/).map((line) => line.trim()).filter(Boolean);
  const entries = lines.flatMap((line) => {
    if (/^\d{1,2}(?:\s+\d{1,2})+$/.test(line)) {
      return line.split(/\s+/).map((number) => ({ number: Number(number), name: "" }));
    }
    const match = line.match(/^(\d{1,2})(?:\s+(.+))?$/);
    return match ? [{ number: Number(match[1]), name: match[2] || "" }] : [];
  });
  return sanitizeRoster(entries);
}

function renderRoster() {
  $("#homeTeamName").value = teamName("Hornets");
  $("#awayTeamName").value = teamName("Opponent");
  $("#homeTeamColor").value = teamColor("Hornets");
  $("#awayTeamColor").value = teamColor("Opponent");
  $("#homeVoiceWords").value = state.voiceWords?.Hornets || "";
  $("#awayVoiceWords").value = state.voiceWords?.Opponent || "";
  $("#homeRosterLabel").textContent = `${teamName("Hornets")} roster`;
  $("#awayRosterLabel").textContent = `${teamName("Opponent")} roster`;
  $$("input[name='periodMode']").forEach((input) => {
    input.checked = input.value === state.periodMode;
  });
  $("#periodLength").value = clockFromSeconds(state.periodSeconds);
  $("#hornetsRoster").value = rosterText(state.rosters.Hornets);
  $("#opponentRoster").value = rosterText(state.rosters.Opponent);
  $("#orientationLabel").textContent =
    `${teamName("Hornets")} basket at ${orientationName(state.courtOrientation)}`;
}

function orientationName(rotation) {
  return {
    0: "bottom",
    90: "right",
    180: "top",
    270: "left",
  }[rotation] || "bottom";
}

function rosterText(roster) {
  return roster.map((player) => `${player.number}${player.name ? ` ${player.name}` : ""}`).join("\n");
}

function playerFor(team, number) {
  return state.rosters[team]?.find((player) => player.number === Number(number));
}

function playerLabel(team, number) {
  const player = playerFor(team, number);
  return `${teamName(team)} #${number}${player?.name ? ` ${player.name}` : ""}`;
}

function sanitizeTeamName(value, fallback) {
  const clean = String(value || "").trim().slice(0, 24);
  return clean || fallback;
}

function cloneRoster(roster) {
  return roster.map((player) => ({ number: player.number, name: player.name }));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function changeClock(deltaSeconds) {
  state.lastTime = clockFromSeconds(secondsFromClock(state.lastTime) + deltaSeconds);
  persist();
  renderScore();
}

function halftimePeriod(mode = state.periodMode) {
  return mode === "halves" ? 2 : 3;
}

function maybeSwapCourtAtHalf(previousPeriod, nextPeriod) {
  const halfStart = halftimePeriod();
  if (state.courtSwappedAtHalf || previousPeriod >= halfStart || nextPeriod < halfStart) return;
  state.courtOrientation = (state.courtOrientation + 180) % 360;
  state.courtSwappedAtHalf = true;
}

function toggleClock() {
  state.clockRunning = !state.clockRunning;
  if (state.clockRunning) startClockTimer();
  else stopClockTimer();
  persist();
  renderScore();
}

function startClockTimer() {
  stopClockTimer();
  clockTimer = setInterval(() => {
    const next = secondsFromClock(state.lastTime) - 1;
    if (next <= 0) {
      handleClockExpired();
      return;
    }
    state.lastTime = clockFromSeconds(next);
    persist();
    renderScore();
    if ($("#boxView")?.classList.contains("active")) renderBox();
    liveClockTicks += 1;
    if (liveClockTicks % 5 === 0) publishLiveSoon();
  }, 1000);
}

function stopClockTimer() {
  if (clockTimer) clearInterval(clockTimer);
  clockTimer = null;
}

function canAdvancePeriod() {
  return state.period < maxPeriods() || scoreFor("Hornets") === scoreFor("Opponent");
}

function handleClockExpired() {
  state.clockRunning = false;
  stopClockTimer();
  if (canAdvancePeriod()) {
    const previousPeriod = state.period;
    state.period += 1;
    maybeSwapCourtAtHalf(previousPeriod, state.period);
    state.lastTime = clockFromSeconds(state.periodSeconds);
    persist();
    render();
    publishLiveSoon();
    return;
  }
  state.lastTime = "0:00";
  persist();
  render();
  publishLiveSoon();
  showExportDialog("Game over. Save or export the final game data.");
}

function changePeriod(delta) {
  state.clockRunning = false;
  stopClockTimer();
  const previousPeriod = state.period;
  if (delta < 0) {
    state.period = Math.max(1, state.period - 1);
  } else if (canAdvancePeriod()) {
    state.period += 1;
    maybeSwapCourtAtHalf(previousPeriod, state.period);
  }
  persist();
  render();
}

function periodLabelFor(event) {
  return periodLabel(event.period, event.periodMode || "quarters");
}

function actionText(event) {
  if (event.action === "shot") {
    if (event.shotType === "freeThrow") return `${event.made ? "made" : "missed"} free throw`;
    return `${event.made ? "made" : "missed"} ${event.points} (${event.location.zone})`;
  }
  if (event.action === "sub") return `in for #${event.playerOut}`;
  if (event.action === "timeout") return "timeout";
  return event.action;
}

// Timeouts have no player, and an official's timeout has no team.
function whoLabel(event) {
  if (event.action === "timeout") return event.team ? teamName(event.team) : "Officials";
  return playerLabel(event.team, event.player);
}

function scoreAfter(index) {
  const partial = state.events.slice(0, index + 1);
  const home = partial
    .filter((event) => event.team === "Hornets" && event.action === "shot" && event.made)
    .reduce((sum, event) => sum + event.points, 0);
  const away = partial
    .filter((event) => event.team === "Opponent" && event.action === "shot" && event.made)
    .reduce((sum, event) => sum + event.points, 0);
  return `${home}-${away}`;
}

function renderPlays() {
  const plays = state.events.map((event, index) => ({ event, index })).reverse();
  $("#playList").innerHTML = plays.map(({ event, index }) => `
    <li>
      <span class="play-time">${periodLabelFor(event)} ${event.time}</span>
      <strong>${escapeHtml(whoLabel(event))}</strong>
      <span>${actionText(event)}</span>
      <em>${scoreAfter(index)}</em>
    </li>
  `).join("");
}

function renderShotChart() {
  const court = $("#reviewCourt");
  court.querySelectorAll(".review-shot").forEach((node) => node.remove());
  const filteredShots = state.events.filter((event) => {
    if (event.action !== "shot" || event.shotType === "freeThrow" || !event.location) return false;
    if (state.shotFilters.team !== "all" && event.team !== state.shotFilters.team) return false;
    if (state.shotFilters.player !== "all") {
      const [team, player] = state.shotFilters.player.split(":");
      if (event.team !== team || String(event.player) !== player) return false;
    }
    return true;
  });
  const orientationTeam = state.shotFilters.team === "Opponent" ? "Opponent" : "Hornets";
  applyCourtOrientation(court, orientationTeam);
  filteredShots.forEach((event) => {
    const visual = toVisualShotLocation(event.location, orientationTeam);
    const marker = document.createElement("span");
    marker.className = `review-shot ${event.made ? "hit" : "miss"}`;
    marker.style.left = `${visual.x}%`;
    marker.style.top = `${visual.y}%`;
    marker.title = `${playerLabel(event.team, event.player)} ${actionText(event)}`;
    court.appendChild(marker);
  });
}

function renderShotFilters() {
  const teamFilter = $("#shotTeamFilter");
  const playerFilter = $("#shotPlayerFilter");
  const currentTeam = state.shotFilters.team;
  teamFilter.innerHTML = `
    <option value="all">All teams</option>
    <option value="Hornets">${escapeHtml(teamName("Hornets"))}</option>
    <option value="Opponent">${escapeHtml(teamName("Opponent"))}</option>
  `;
  teamFilter.value = currentTeam;
  const teams = currentTeam === "all" ? ["Hornets", "Opponent"] : [currentTeam];
  const playerOptions = teams.flatMap((team) =>
    withEventOnlyPlayers(team).map((number) => ({
      value: `${team}:${number}`,
      label: playerLabel(team, number),
    }))
  );
  playerFilter.innerHTML = `<option value="all">All players</option>${playerOptions
    .map((player) => `<option value="${player.value}">${escapeHtml(player.label)}</option>`)
    .join("")}`;
  if ([...playerFilter.options].some((option) => option.value === state.shotFilters.player)) {
    playerFilter.value = state.shotFilters.player;
  } else {
    state.shotFilters.player = "all";
    playerFilter.value = "all";
  }
}

function render() {
  renderPlayers();
  renderScore();
  renderBox();
  renderPlays();
  renderShotChart();
  renderRoster();
  renderShotFilters();
}

function publicGameState() {
  return {
    updatedAt: new Date().toISOString(),
    period: state.period,
    periodMode: state.periodMode,
    periodSeconds: state.periodSeconds,
    lastTime: state.lastTime,
    clockRunning: state.clockRunning,
    courtOrientation: state.courtOrientation,
    teamNames: state.teamNames,
    teamColors: state.teamColors,
    rosters: state.rosters,
    starters: {
      Hornets: startingLineup(state, "Hornets"),
      Opponent: startingLineup(state, "Opponent"),
    },
    events: state.events,
  };
}

function liveWatchUrl(gameId = state.live.gameId) {
  return `${window.location.origin}/watch.html?game=${encodeURIComponent(gameId)}`;
}

function createLiveId() {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(36).padStart(2, "0")).join("").slice(0, 8);
}

async function publishLiveUpdate() {
  if (!state.live.enabled || !state.live.gameId) return false;
  const response = await fetch(`/api/games/${encodeURIComponent(state.live.gameId)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(publicGameState()),
  });
  if (!response.ok) throw new Error("Live update failed.");
  return true;
}

async function startLiveLink() {
  const gameId = state.live.gameId || createLiveId();
  state.live = {
    enabled: true,
    gameId,
    watchUrl: liveWatchUrl(gameId),
  };
  persist();
  renderScore();
  $("#liveStatus").textContent = "Starting live link...";
  $("#liveLink").value = state.live.watchUrl;
  $("#liveDialog").showModal();
  try {
    await publishLiveUpdate();
    $("#liveStatus").textContent = "Live link is ready. Updates publish as you track the game.";
  } catch {
    state.live.enabled = false;
    persist();
    renderScore();
    $("#liveStatus").textContent = "Live link needs the Fireplug live server. Start the app with npm start.";
  }
}

function showLiveLink() {
  $("#liveLink").value = state.live.watchUrl || "";
  $("#liveStatus").textContent = state.live.enabled
    ? "Live link is ready. Updates publish as you track the game."
    : "Start a live link for people following along.";
  $("#liveDialog").showModal();
}

async function shareLiveLink() {
  const url = $("#liveLink").value;
  if (!url) return;
  const text = `${teamName("Hornets")} vs ${teamName("Opponent")} live stats`;
  if (navigator.share) {
    await navigator.share({ title: "Fireplug Stats", text, url }).catch(() => {});
  } else {
    await navigator.clipboard?.writeText(url);
    $("#liveStatus").textContent = "Live link copied.";
  }
}

async function copyLiveLink() {
  const url = $("#liveLink").value;
  if (!url) return;
  await navigator.clipboard?.writeText(url);
  $("#liveStatus").textContent = "Live link copied.";
}

function publishLiveSoon() {
  publishLiveUpdate().catch(() => {
    state.live.enabled = false;
    persist();
    renderScore();
  });
}

function gameDataText() {
  return JSON.stringify(publicGameState(), null, 2);
}

function exportFileName() {
  const teams = `${teamName("Hornets")}-vs-${teamName("Opponent")}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${teams || "fireplug-game"}-${new Date().toISOString().slice(0, 10)}.json`;
}

function showExportDialog(message = "Save or export the current game data.") {
  $("#exportStatus").textContent = message;
  $("#exportText").value = gameDataText();
  $("#exportDialog").showModal();
}

async function copyExportData() {
  await navigator.clipboard?.writeText($("#exportText").value || gameDataText());
  $("#exportStatus").textContent = "Game data copied.";
}

function downloadExportData() {
  const blob = new Blob([$("#exportText").value || gameDataText()], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = exportFileName();
  link.click();
  URL.revokeObjectURL(url);
  $("#exportStatus").textContent = "Game data saved.";
}

function saveDraft() {
  const event = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    period: state.period,
    periodMode: state.periodMode,
    time: draft.time || state.lastTime,
    team: draft.team,
    player: Number(draft.player),
    action: draft.action,
  };
  if (draft.action === "shot") {
    event.made = draft.made;
    event.shotType = draft.shotType || "fieldGoal";
    event.points = draft.points;
    if (draft.location) {
      event.location = draft.location;
    }
  }
  const queued = draft.queued;
  if (queued) {
    pendingShots = pendingShots.filter((shot) => shot !== queued);
    placedSeq.set(event.id, queued.seq);
    insertEvent(event, queued.afterId, queued.seq);
    voicePhrasePlays.get(queued.phrase)?.push(event.id);
  } else {
    state.events.push(event);
  }
  persist();
  if (queued && !event.made && queued.rebound) {
    if (queued.rebound !== "none") {
      draft = { missedShotId: event.id, time: queued.rebound.time };
      const reboundId = saveRebound(queued.rebound.team, queued.rebound.player);
      voicePhrasePlays.get(queued.rebound.phrase)?.push(reboundId);
      return;
    }
    resetDraft();
    render();
  } else if (event.action === "shot" && !event.made) {
    draft = { missedShotId: event.id, time: event.time };
    render();
    setStep("rebound");
  } else {
    resetDraft();
    render();
  }
  publishLiveSoon();
}

function saveRebound(team, player) {
  const missedShotId = draft.missedShotId;
  const id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
  // A rebound goes right after its miss and shares its place in the call order.
  if (placedSeq.has(missedShotId)) placedSeq.set(id, placedSeq.get(missedShotId));
  insertEvent({
    id,
    period: state.period,
    periodMode: state.periodMode,
    time: draft.time || state.lastTime,
    team,
    player: Number(player),
    action: "rebound",
    missedShotId,
  }, state.events.some((event) => event.id === missedShotId) ? missedShotId : undefined);
  persist();
  resetDraft();
  render();
  publishLiveSoon();
  return id;
}

function saveSettings(showStatus = true) {
  const hornetsRoster = parseRoster($("#hornetsRoster").value);
  const opponentRoster = parseRoster($("#opponentRoster").value);
  if (!hornetsRoster.length || !opponentRoster.length) {
    $("#rosterStatus").textContent = "Each team needs at least one number.";
    return false;
  }
  state.teamNames.Hornets = sanitizeTeamName($("#homeTeamName").value, "Hornets");
  state.teamNames.Opponent = sanitizeTeamName($("#awayTeamName").value, "Opponent");
  state.teamColors.Hornets = sanitizeColor($("#homeTeamColor").value, DEFAULT_TEAM_COLORS.Hornets);
  state.teamColors.Opponent = sanitizeColor($("#awayTeamColor").value, DEFAULT_TEAM_COLORS.Opponent);
  state.voiceWords = {
    Hornets: sanitizeVoiceWords($("#homeVoiceWords").value),
    Opponent: sanitizeVoiceWords($("#awayVoiceWords").value),
  };
  state.periodMode = $("input[name='periodMode']:checked")?.value === "halves" ? "halves" : "quarters";
  state.period = Math.min(state.period, maxPeriods());
  state.periodSeconds = periodClockLength($("#periodLength").value);
  if (state.events.length === 0) state.lastTime = clockFromSeconds(state.periodSeconds);
  state.rosters.Hornets = hornetsRoster;
  state.rosters.Opponent = opponentRoster;
  persist();
  render();
  $("#rosterStatus").textContent = showStatus ? "Settings saved." : "";
  publishLiveSoon();
  return true;
}

// team is "Hornets", "Opponent", or null for an official's timeout. The clock stops.
function saveTimeout(team) {
  state.events.push({
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    period: state.period,
    periodMode: state.periodMode,
    time: state.lastTime,
    team,
    action: "timeout",
  });
  if (state.clockRunning) toggleClock();
  persist();
  resetDraft();
  render();
  publishLiveSoon();
}

function undoLastPlay() {
  state.events.pop();
  persist();
  resetDraft();
  render();
  publishLiveSoon();
}

// Voice commands. Each one runs through the same functions the buttons use.
// They come from the hold-to-talk mic, or from a box for typing them that is
// shown with ?voice=text (hidden again with ?voice=off).
const VOICE_TEXT_KEY = "fireplug.voice.text";
// ?voice=debug shows a log of what the speech engine reports (cleared with ?voice=off).
const VOICE_DEBUG_KEY = "fireplug.voice.debug";
let voiceDebug = false;
let voiceTextEnabled = false;
const voiceDebugLines = [];

function logVoiceDebug(message) {
  if (!voiceDebug) return;
  const now = new Date();
  const stamp = `${now.toLocaleTimeString([], { hour12: false })}.${String(now.getMilliseconds()).padStart(3, "0")}`;
  voiceDebugLines.push(`${stamp} ${message}`);
  voiceDebugLines.splice(0, Math.max(0, voiceDebugLines.length - 30));
  const box = $("#voiceDebug");
  box.hidden = false;
  box.textContent = voiceDebugLines.join("\n");
  box.scrollTop = box.scrollHeight;
}

function setupVoiceText() {
  try {
    const mode = new URLSearchParams(location.search).get("voice");
    if (mode === "text") localStorage.setItem(VOICE_TEXT_KEY, "1");
    if (mode === "debug") localStorage.setItem(VOICE_DEBUG_KEY, "1");
    if (mode === "off") {
      localStorage.removeItem(VOICE_TEXT_KEY);
      localStorage.removeItem(VOICE_DEBUG_KEY);
    }
    voiceDebug = localStorage.getItem(VOICE_DEBUG_KEY) === "1";
    voiceTextEnabled = localStorage.getItem(VOICE_TEXT_KEY) === "1";
  } catch {
    voiceTextEnabled = false;
  }
}

// Voice or Touch: how plays are entered on the Track tab, remembered per phone.
// Voice shows what was just heard (each phrase with its own Undo) and the mic
// bar; the court only comes up for a called shot, and the player grid is one tap
// away. Touch is the player grid with no mic.
const INPUT_MODE_KEY = "fireplug.inputMode";
let inputMode = "touch";
let tapFallback = false; // Voice mode, picking a player by hand for one play
let micListener = null;
const voiceLog = []; // newest first: { phrase, heard, lines, undoable, undone }

function voiceAvailable() {
  return speechSupported() || voiceTextEnabled;
}

function setupInputMode() {
  let saved = null;
  try { saved = localStorage.getItem(INPUT_MODE_KEY); } catch { /* private mode */ }
  inputMode = voiceAvailable() && saved !== "touch" ? "voice" : "touch";
  $("#modeSwitch").hidden = !voiceAvailable();
  $$("#modeSwitch [data-mode]").forEach((button) => {
    button.addEventListener("click", () => setInputMode(button.dataset.mode));
  });
  $("#tapPlayerBtn").addEventListener("click", () => {
    tapFallback = true;
    applyInputMode();
  });
  $("#allPlaysBtn").addEventListener("click", () => $('.tab[data-view="plays"]').click());
  $("#voiceLog").addEventListener("click", (event) => {
    const button = event.target.closest("[data-phrase]");
    if (button) undoVoicePlays(Number(button.dataset.phrase));
  });
  applyInputMode();
}

function setInputMode(mode) {
  if (mode === inputMode) return;
  inputMode = mode;
  tapFallback = false;
  try { localStorage.setItem(INPUT_MODE_KEY, mode); } catch { /* private mode */ }
  if (mode === "touch") micListener?.shutdown();
  applyInputMode();
}

function voiceHomeShown() {
  return inputMode === "voice" && step === "player" && !tapFallback;
}

function applyInputMode() {
  const voice = inputMode === "voice";
  const mic = voice && speechSupported();
  document.body.classList.toggle("mode-voice", voice);
  document.body.classList.toggle("has-mic", mic);
  $("#micBar").hidden = !mic;
  $("#voiceTextForm").hidden = !(voice && voiceTextEnabled);
  $$("#modeSwitch [data-mode]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.mode === inputMode));
  });
  const home = voiceHomeShown();
  $("#voiceHome").hidden = !home;
  $(".event-panel").hidden = home;
  if (home || !voice) $("#voiceBanner").hidden = true;
  if (!home) $("#voiceLive").hidden = true;
  // Picking a player by hand in Voice mode: Back returns to what was heard.
  $("#backBtn").disabled = step === "player" && !(voice && tapFallback);
  renderVoiceLog();
}

function renderVoiceLog() {
  const recent = voiceLog.slice(0, 3);
  $("#voiceEmpty").hidden = voiceLog.length > 0;
  $("#voiceLog").innerHTML = recent.map((entry, index) => {
    // "Tap the court" is old news once the phrase's shots are placed.
    const waiting = pendingShots.some((shot) => shot.phrase === entry.phrase);
    const lines = entry.lines
      .map((line) => ({ ...line, text: waiting ? line.text : line.text.replace(/\. Tap the court.*$/, ".") }))
      // Problems start with the words heard, which the card already quotes.
      .map((line) => ({ ...line, text: line.text.replace(/^"[^"]*": /, "") }))
      .map((line) => `<p class="voice-line${line.ok ? "" : " voice-error"}">${escapeHtml(line.text)}</p>`)
      .join("");
    const action = entry.undone
      ? `<span class="voice-undone">Undone</span>`
      : entry.undoable
        ? `<button class="voice-entry-undo" type="button" data-phrase="${entry.phrase}">Undo</button>`
        : "";
    const classes = ["voice-entry", index === 0 ? "latest" : "", entry.undone ? "undone" : ""].filter(Boolean).join(" ");
    return `<li class="${classes}"><div><p class="voice-heard">&ldquo;${escapeHtml(entry.heard)}&rdquo;</p>${lines}</div>${action}</li>`;
  }).join("");
}

// What the mic is hearing right now, or a mic problem, above the list.
function showVoiceLive(text, { listening = false, error = false } = {}) {
  const live = $("#voiceLive");
  live.textContent = text;
  live.classList.toggle("listening", listening);
  live.classList.toggle("voice-error", error);
  live.hidden = false;
}

function voiceGame() {
  return {
    teamNames: state.teamNames,
    teamColors: state.teamColors,
    voiceWords: state.voiceWords,
    rosters: state.rosters,
    lineups: { Hornets: currentLineup(state, "Hornets"), Opponent: currentLineup(state, "Opponent") },
  };
}

let voiceBannerTimer = null;

function showVoiceBanner(lines, { phrase = null, listening = false } = {}) {
  const banner = $("#voiceBanner");
  clearTimeout(voiceBannerTimer);
  if (voiceHomeShown()) {
    banner.hidden = true;
    showVoiceLive(lines.map((line) => line.text).join(" "), { listening, error: lines.some((line) => !line.ok) });
    return;
  }
  banner.classList.toggle("listening", listening);
  banner.innerHTML = lines
    .map((line) => `<p class="${line.ok ? "" : "voice-error"}">${escapeHtml(line.text)}</p>`)
    .join("") + (phrase ? `<button class="voice-undo" type="button">Undo</button>` : "");
  banner.hidden = false;
  banner.querySelector(".voice-undo")?.addEventListener("click", () => undoVoicePlays(phrase));
  // Clear a fully understood phrase after a while; problems stay until the next one.
  if (!listening && lines.every((line) => line.ok)) {
    voiceBannerTimer = setTimeout(() => { banner.hidden = true; }, 8000);
  }
}

// Takes back the plays one phrase logged, and any of its shots still waiting for a tap.
function undoVoicePlays(phrase) {
  const removed = new Set(voicePhrasePlays.get(phrase) || []);
  state.events = state.events.filter((event) => !removed.has(event.id));
  pendingShots = pendingShots.filter((shot) => shot.phrase !== phrase);
  persist();
  const entry = voiceLog.find((item) => item.phrase === phrase);
  if (entry) entry.undone = true;
  resetDraft();
  render();
  publishLiveSoon();
  if (voiceHomeShown()) $("#voiceLive").hidden = true;
  else showVoiceBanner([{ ok: true, text: "Undid that." }]);
}

let voicePhraseCount = 0;
// Ids of the plays each phrase logged, including shots placed after it was said.
const voicePhrasePlays = new Map();

function runVoiceText(text) {
  const before = new Set(state.events.map((event) => event.id));
  const phrase = ++voicePhraseCount;
  // Each play is resolved against the game as the plays before it left it.
  const results = splitPlays(text, voiceGame())
    .map((play) => runVoiceCommand({ ...parseSegment(play, voiceGame()), phrase }));
  if (!results.length) results.push({ ok: false, text: `Heard "${text}" but no play.` });
  const added = state.events.filter((event) => !before.has(event.id)).map((event) => event.id);
  voicePhrasePlays.set(phrase, added);
  const queuedShots = pendingShots.some((shot) => shot.phrase === phrase);
  const undoable = Boolean(!results.some((result) => result.isUndo) && (added.length || queuedShots));
  voiceLog.unshift({ phrase, heard: text.trim(), lines: results, undoable, undone: false });
  voiceLog.splice(20);
  if (voiceHomeShown()) {
    $("#voiceBanner").hidden = true;
    $("#voiceLive").hidden = true;
    renderVoiceLog();
  } else {
    renderVoiceLog();
    showVoiceBanner(results, { phrase: undoable ? phrase : null });
  }
}

function voiceErrorText(code) {
  if (code === "not-allowed" || code === "service-not-allowed") {
    return "Speech is blocked. On iPhone, allow the microphone for this site in Safari, and turn on Siri & Dictation.";
  }
  if (code === "no-speech") return "Didn't hear anything. Hold the mic while you talk.";
  if (code === "network") return "Speech needs an internet connection.";
  if (code === "audio-capture") return "Couldn't use the microphone.";
  if (code === "start-failed") return "The mic didn't start. Try again in a moment.";
  return `Speech stopped (${code}).`;
}

function setupMic() {
  const button = $("#micBtn");
  if (!speechSupported()) return;
  const listener = createVoiceListener({
    onState: (on) => {
      button.classList.toggle("listening", on);
      $("#micLabel").textContent = on ? "Listening… let go when done" : "Hold to talk";
    },
    onInterim: (text) => showVoiceBanner([{ ok: true, text: `"${text}"` }], { listening: true }),
    onText: (text) => {
      logVoiceDebug(`text "${text}"`);
      runVoiceText(text);
    },
    onError: (code) => showVoiceBanner([{ ok: false, text: voiceErrorText(code) }]),
    onDebug: logVoiceDebug,
  });
  micListener = listener;
  if (voiceDebug) logVoiceDebug(`ready: ${navigator.userAgent}`);
  button.addEventListener("pointerdown", (event) => {
    logVoiceDebug(`press (${event.pointerType})`);
    event.preventDefault();
    button.setPointerCapture?.(event.pointerId);
    showVoiceBanner([{ ok: true, text: "Listening…" }], { listening: true });
    listener.start();
  });
  // The mic stays on between presses (Safari only hears the first session on a
  // page otherwise), so turn it off when the app is in the background.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) listener.shutdown();
  });
  const release = (event) => {
    logVoiceDebug(`release (${event.type})`);
    listener.stop();
  };
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
  button.addEventListener("contextmenu", (event) => event.preventDefault());
}

function runVoiceCommand(command) {
  const game = voiceGame();
  if (command.type === "error") return { ok: false, text: `"${command.heard}": ${command.message}` };
  const label = describeCommand(command, game);
  const fail = (reason) => ({ ok: false, text: `${label}: ${reason}` });
  // A shot being entered by taps, waiting on Made or Missed.
  if (step === "result" && !["undo", "cancel", "clock"].includes(command.type)) {
    return fail("pick Made or Missed for the last shot first.");
  }
  const { team, player } = command;
  // The latest missed shot still waiting for a tap with no rebound yet.
  const openMiss = [...pendingShots].reverse().find((shot) => !shot.made && !shot.rebound);
  switch (command.type) {
    case "shot": {
      const lastEvent = state.events.at(-1);
      pendingShots.push({
        team, player, made: command.made, time: state.lastTime,
        afterId: lastEvent ? lastEvent.id : null, seq: ++shotSeq, phrase: command.phrase,
      });
      // Start on the court unless it's already busy or a rebound is being picked.
      if (!(step === "location" && draft.queued) && step !== "rebound") resetDraft();
      else renderShotQueue();
      const waiting = pendingShots.length - 1;
      return { ok: true, text: `${label}. ${waiting ? `Tap the court (${waiting} ahead).` : "Tap the court."}` };
    }
    case "freeThrow":
      draft = {
        team, player: String(player), time: state.lastTime, action: "shot",
        shotType: "freeThrow", points: 1, location: null, made: command.made,
      };
      saveDraft();
      break;
    case "rebound":
      if (step !== "rebound" && openMiss) {
        openMiss.rebound = { team, player, time: state.lastTime, phrase: command.phrase };
        renderShotQueue();
        return { ok: true, text: `${label} (saved with the miss)` };
      }
      if (step !== "rebound") draft = {};
      saveRebound(team, player);
      break;
    case "noRebound":
      if (step === "rebound") {
        draft = {};
        resetDraft();
        render();
        publishLiveSoon();
        break;
      }
      if (!openMiss) return fail("no missed shot is waiting for a rebound.");
      openMiss.rebound = "none";
      break;
    case "foul":
    case "steal":
      draft = { team, player: String(player), time: state.lastTime, action: command.type };
      saveDraft();
      break;
    case "sub":
      if (!currentLineup(state, team).includes(command.playerOut)) return fail(`#${command.playerOut} isn't on the court.`);
      if (!bench(state, team).includes(command.playerIn)) return fail(`#${command.playerIn} isn't on the bench.`);
      saveSub(team, command.playerIn, command.playerOut);
      break;
    case "timeout":
      saveTimeout(command.team);
      break;
    case "clock":
      if (command.run === "toggle" || command.run !== state.clockRunning) toggleClock();
      publishLiveSoon();
      break;
    case "undo":
      if (!state.events.length) return fail("nothing to undo.");
      undoLastPlay();
      return { ok: true, text: label, isUndo: true };
    case "cancel":
      if (draft.queued) dropCurrentShot();
      else {
        resetDraft();
        render();
      }
      break;
    default:
      return fail("not supported yet.");
  }
  return { ok: true, text: label };
}

function wireEvents() {
  document.addEventListener("click", (event) => {
    const rebounder = event.target.closest(".rebound-player-btn");
    if (rebounder) {
      saveRebound(rebounder.dataset.team, rebounder.dataset.player);
      return;
    }

    const subButton = event.target.closest(".sub-btn");
    if (subButton) {
      draft = { subTeam: subButton.dataset.team };
      setStep("subIn");
      return;
    }

    const subIn = event.target.closest(".sub-in-btn");
    if (subIn) {
      draft.subIn = subIn.dataset.player;
      setStep("subOut");
      return;
    }

    const subOut = event.target.closest(".sub-out-btn");
    if (subOut) {
      saveSub(draft.subTeam, draft.subIn, subOut.dataset.player);
      return;
    }

    const player = event.target.closest(".player-btn");
    if (player) {
      draft = { team: player.dataset.team, player: player.dataset.player, time: state.lastTime };
      setStep("action");
    }
  });

  $$(".action-btn[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      draft.action = button.dataset.action;
      delete draft.made;
      if (draft.action === "shot") setStep("location");
      else saveDraft();
    });
  });

  $("#shotCourt").addEventListener("click", (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    const base = toBaseShotLocation(x, y, draft.team);
    const shot = classifyShot(base.x, base.y);
    draft.shotType = "fieldGoal";
    draft.points = shot.points;
    draft.location = { x: Math.round(base.x * 10) / 10, y: Math.round(base.y * 10) / 10, ...shot };
    const marker = $("#pendingShotMarker");
    marker.style.left = `${x}%`;
    marker.style.top = `${y}%`;
    marker.style.display = "block";
    // A shot called by voice already knows whether it went in.
    if (typeof draft.made === "boolean") saveDraft();
    else setStep("result");
  });

  $("#freeThrowBtn").addEventListener("click", () => {
    draft.shotType = "freeThrow";
    draft.points = 1;
    draft.location = null;
    $("#pendingShotMarker").style.display = "none";
    if (typeof draft.made === "boolean") saveDraft();
    else setStep("result");
  });

  $("#dropShotBtn").addEventListener("click", dropCurrentShot);

  $$(".action-btn[data-made]").forEach((button) => {
    button.addEventListener("click", () => {
      draft.made = button.dataset.made === "true";
      saveDraft();
    });
  });

  $("#skipReboundBtn").addEventListener("click", () => {
    resetDraft();
    render();
    publishLiveSoon();
  });

  $$(".time-btn[data-clock-delta]").forEach((button) => {
    button.addEventListener("click", () => {
      changeClock(Number(button.dataset.clockDelta));
      publishLiveSoon();
    });
  });

  $("#clockToggle").addEventListener("click", () => {
    toggleClock();
    publishLiveSoon();
  });

  $("#clockAdjustBtn").addEventListener("click", () => {
    state.clockRunning = false;
    stopClockTimer();
    renderScore();
    publishLiveSoon();
    $("#clockDialog").showModal();
  });

  $("#undoBtn").addEventListener("click", undoLastPlay);

  $$(".timeout-btn").forEach((button) => {
    button.addEventListener("click", () => saveTimeout(button.dataset.timeout || null));
  });

  $("#voiceTextForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = $("#voiceTextInput");
    if (!input.value.trim()) return;
    runVoiceText(input.value);
    input.value = "";
  });

  $("#backBtn").addEventListener("click", () => {
    if (step === "player" && tapFallback) {
      tapFallback = false;
      applyInputMode();
    } else if (step === "action") resetDraft();
    else if (step === "location" && draft.queued) dropCurrentShot();
    else if (step === "location") setStep("action");
    else if (step === "result") setStep("location");
    else if (step === "rebound") resetDraft();
    else if (step === "subIn") resetDraft();
    else if (step === "subOut") setStep("subIn");
  });

  $("#periodMinus").addEventListener("click", () => {
    changePeriod(-1);
    publishLiveSoon();
  });

  $("#periodPlus").addEventListener("click", () => {
    changePeriod(1);
    publishLiveSoon();
  });

  $$(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      $$(".tab").forEach((item) => item.classList.toggle("active", item === tab));
      $$(".view").forEach((view) => view.classList.toggle("active", view.id === `${tab.dataset.view}View`));
      render();
      if (tab.dataset.view === "roster") {
        loadPastGames().then((games) => renderHistory(games, $("#pastGamesList")));
      }
    });
  });

  $("#newGameBtn").addEventListener("click", async () => {
    if (!confirm("Start a new game?")) return;
    if (state.events.length > 0) saveGameToServer();
    savedGameId = null;
    pendingShots = [];
    const courtOrientation = state.courtOrientation;
    const live = state.live;
    Object.assign(state, defaultState(), {
      teamNames: state.teamNames,
      teamColors: state.teamColors,
      rosters: state.rosters,
      periodMode: state.periodMode,
      periodSeconds: state.periodSeconds,
      lastTime: clockFromSeconds(state.periodSeconds),
      courtOrientation,
      courtSwappedAtHalf: false,
      live,
      gameStarted: false,
    });
    persist();
    resetDraft();
    publishLiveSoon();
    showSetup();
  });

  $("#shareBtn").addEventListener("click", shareSummary);

  $("#exportBtn").addEventListener("click", () => {
    showExportDialog();
  });

  $("#copyExportBtn").addEventListener("click", copyExportData);
  $("#downloadExportBtn").addEventListener("click", downloadExportData);

  $("#saveRosterBtn").addEventListener("click", () => {
    saveSettings();
  });

  $("#rosterForm").addEventListener("focusout", (event) => {
    if (event.target.matches("input:not([type='radio']):not([type='color']), textarea")) saveSettings(false);
  });

  $("#rosterForm").addEventListener("change", (event) => {
    if (event.target.matches("input[type='radio'], input[type='color']")) saveSettings(false);
  });

  $("#rotateCourtBtn").addEventListener("click", () => {
    const index = ORIENTATIONS.indexOf(state.courtOrientation);
    state.courtOrientation = ORIENTATIONS[(index + 1) % ORIENTATIONS.length];
    persist();
    render();
    publishLiveSoon();
  });

  $("#shotTeamFilter").addEventListener("change", (event) => {
    state.shotFilters.team = event.target.value;
    state.shotFilters.player = "all";
    renderShotFilters();
    renderShotChart();
  });

  $("#shotPlayerFilter").addEventListener("change", (event) => {
    state.shotFilters.player = event.target.value;
    renderShotChart();
  });

  $("#liveBtn").addEventListener("click", () => {
    if (state.live.enabled) showLiveLink();
    else startLiveLink();
  });

  $("#copyLiveBtn").addEventListener("click", copyLiveLink);
  $("#shareLiveBtn").addEventListener("click", shareLiveLink);
}

// Setup form events
$("#setupHomeTeam").addEventListener("change", (e) => pickSetupTeam(e.target.value, "home"));
$("#setupAwayTeam").addEventListener("change", (e) => pickSetupTeam(e.target.value, "away"));
$("#startGameBtn").addEventListener("click", startGame);

wireEvents();
setupVoiceText();
setupMic();
setupInputMode();
resetDraft();
registerServiceWorker();

if (!state.gameStarted) {
  showSetup();
} else {
  render();
}
