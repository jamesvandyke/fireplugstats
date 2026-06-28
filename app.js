const STORAGE_KEY = "fireplug.stats.game.v1";
const DEFAULT_CLOCK_SECONDS = 8 * 60;
const MAX_CLOCK_SECONDS = 20 * 60;
const HIGH_SCHOOL_THREE_RADIUS = 19.75;
const ORIENTATIONS = [0, 90, 180, 270];
const DEFAULT_ROSTERS = {
  Hornets: [0, 1, 2, 3, 5, 7, 10, 11, 12, 14, 21, 24].map((number) => ({ number, name: "" })),
  Opponent: [1, 2, 3, 4, 5, 10, 11, 12, 20, 22, 23, 33].map((number) => ({ number, name: "" })),
};

const state = loadState();
let draft = {};
let step = "player";
let clockTimer = null;
let liveClockTicks = 0;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const stepTitles = {
  player: ["Player", "Hornets on top, opponent below"],
  action: ["Action", ""],
  location: ["Location", "Tap the court"],
  result: ["Result", ""],
};

function defaultState() {
  return {
    period: 1,
    periodMode: "quarters",
    lastTime: "8:00",
    clockRunning: false,
    courtOrientation: 0,
    shotFilters: {
      team: "all",
      player: "all",
    },
    teamNames: {
      Hornets: "Hornets",
      Opponent: "Opponent",
    },
    rosters: {
      Hornets: cloneRoster(DEFAULT_ROSTERS.Hornets),
      Opponent: cloneRoster(DEFAULT_ROSTERS.Opponent),
    },
    live: {
      enabled: false,
      gameId: "",
      watchUrl: "",
    },
    events: [],
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
    lastTime: normalizeClock(saved?.lastTime || "8:00"),
    clockRunning: false,
    courtOrientation: ORIENTATIONS.includes(saved?.courtOrientation) ? saved.courtOrientation : 0,
    shotFilters: {
      team: ["Hornets", "Opponent", "all"].includes(saved?.shotFilters?.team) ? saved.shotFilters.team : "all",
      player: "all",
    },
    teamNames: {
      Hornets: sanitizeTeamName(saved?.teamNames?.Hornets, "Hornets"),
      Opponent: sanitizeTeamName(saved?.teamNames?.Opponent, "Opponent"),
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
    events: Array.isArray(saved?.events) ? saved.events : [],
  };
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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

function shotsFor(team = "Hornets") {
  return state.events.filter((event) => event.team === team && event.action === "shot");
}

function statsForPlayer(player) {
  const events = state.events.filter((event) => event.team === "Hornets" && event.player === player);
  const shots = events.filter((event) => event.action === "shot");
  const fieldShots = shots.filter((event) => event.shotType !== "freeThrow");
  const threes = fieldShots.filter((event) => event.points === 3);
  return {
    points: shots.filter((event) => event.made).reduce((sum, event) => sum + event.points, 0),
    fgMade: fieldShots.filter((event) => event.made).length,
    fgAtt: fieldShots.length,
    threeMade: threes.filter((event) => event.made).length,
    threeAtt: threes.length,
    rebounds: events.filter((event) => event.action === "rebound").length,
    steals: events.filter((event) => event.action === "steal").length,
    fouls: events.filter((event) => event.action === "foul").length,
  };
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
  $("#hornetsPlayers").innerHTML = state.rosters.Hornets.map((player) => playerButton("Hornets", player)).join("");
  $("#opponentPlayers").innerHTML = state.rosters.Opponent.map((player) => playerButton("Opponent", player)).join("");
}

function playerButton(team, player) {
  const label = player.name ? `<small>${escapeHtml(player.name)}</small>` : "";
  return `<button class="player-btn" data-team="${team}" data-player="${player.number}"><span>${player.number}</span>${label}</button>`;
}

function courtRotationFor(team) {
  return team === "Opponent" ? (state.courtOrientation + 180) % 360 : state.courtOrientation;
}

function toBaseShotLocation(x, y, team) {
  const rotation = courtRotationFor(team);
  if (rotation === 90) return { x: y, y: 100 - x };
  if (rotation === 180) return { x: 100 - x, y: 100 - y };
  if (rotation === 270) return { x: 100 - y, y: x };
  return { x, y };
}

function toVisualShotLocation(location, team) {
  const rotation = courtRotationFor(team);
  if (rotation === 90) return { x: 100 - location.y, y: location.x };
  if (rotation === 180) return { x: 100 - location.x, y: 100 - location.y };
  if (rotation === 270) return { x: location.y, y: 100 - location.x };
  return location;
}

function applyCourtOrientation(court, team) {
  court.classList.remove("rotated", "rotated-right", "rotated-left");
  const rotation = courtRotationFor(team);
  if (rotation === 180) court.classList.add("rotated");
  if (rotation === 90) court.classList.add("rotated-right");
  if (rotation === 270) court.classList.add("rotated-left");
}

function setStep(nextStep) {
  step = nextStep;
  $$(".step").forEach((el) => el.classList.toggle("active", el.id === `${step}Step`));
  const [title, meta] = stepTitles[step];
  $("#stepTitle").textContent = title;
  $("#stepMeta").textContent = step === "player" ? `${teamName("Hornets")} on top, ${teamName("Opponent")} below` : meta || playerLabel(draft.team, Number(draft.player));
  $("#backBtn").disabled = step === "player";
  if (step === "location") applyCourtOrientation($("#shotCourt"), draft.team);
}

function resetDraft() {
  draft = {};
  $("#pendingShotMarker").style.display = "none";
  setStep("player");
}

function renderScore() {
  $("#homeTeamLabel").textContent = teamName("Hornets");
  $("#awayTeamLabel").textContent = teamName("Opponent");
  $("#homePlayersLabel").textContent = teamName("Hornets");
  $("#awayPlayersLabel").textContent = teamName("Opponent");
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
  const rosterNumbers = withEventOnlyPlayers("Hornets");
  $("#boxRows").innerHTML = rosterNumbers.map((number) => {
    const stats = statsForPlayer(number);
    return `<tr>
      <th>${playerLabel("Hornets", number)}</th>
      <td>${stats.points}</td>
      <td>${stats.fgMade}-${stats.fgAtt}</td>
      <td>${stats.threeMade}-${stats.threeAtt}</td>
      <td>${stats.rebounds}</td>
      <td>${stats.steals}</td>
      <td>${stats.fouls}</td>
    </tr>`;
  }).join("");
}

function withEventOnlyPlayers(team) {
  const roster = (state.rosters[team] || []).map((player) => player.number);
  const eventPlayers = state.events.filter((event) => event.team === team).map((event) => event.player);
  return [...new Set([...roster, ...eventPlayers])].sort((a, b) => a - b);
}

function sanitizeRoster(values) {
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
  $("#homeRosterLabel").textContent = `${teamName("Hornets")} roster`;
  $("#awayRosterLabel").textContent = `${teamName("Opponent")} roster`;
  $$("input[name='periodMode']").forEach((input) => {
    input.checked = input.value === state.periodMode;
  });
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

function sanitizePlayerName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 24);
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
    state.lastTime = clockFromSeconds(next);
    if (next <= 0) {
      state.clockRunning = false;
      stopClockTimer();
    }
    persist();
    renderScore();
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

function changePeriod(delta) {
  state.clockRunning = false;
  stopClockTimer();
  if (delta < 0) {
    state.period = Math.max(1, state.period - 1);
  } else if (canAdvancePeriod()) {
    state.period += 1;
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
  return event.action;
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
      <strong>${playerLabel(event.team, event.player)}</strong>
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
    lastTime: state.lastTime,
    clockRunning: state.clockRunning,
    courtOrientation: state.courtOrientation,
    teamNames: state.teamNames,
    rosters: state.rosters,
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
  state.events.push(event);
  persist();
  resetDraft();
  render();
  publishLiveSoon();
}

function wireEvents() {
  document.addEventListener("click", (event) => {
    const player = event.target.closest(".player-btn");
    if (player) {
      draft = { team: player.dataset.team, player: player.dataset.player, time: state.lastTime };
      setStep("action");
    }
  });

  $$(".action-btn[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      draft.action = button.dataset.action;
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
    setStep("result");
  });

  $("#freeThrowBtn").addEventListener("click", () => {
    draft.shotType = "freeThrow";
    draft.points = 1;
    draft.location = null;
    $("#pendingShotMarker").style.display = "none";
    setStep("result");
  });

  $$(".action-btn[data-made]").forEach((button) => {
    button.addEventListener("click", () => {
      draft.made = button.dataset.made === "true";
      saveDraft();
    });
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

  $("#undoBtn").addEventListener("click", () => {
    state.events.pop();
    persist();
    resetDraft();
    render();
    publishLiveSoon();
  });

  $("#backBtn").addEventListener("click", () => {
    if (step === "action") resetDraft();
    else if (step === "location") setStep("action");
    else if (step === "result") setStep("location");
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
    });
  });

  $("#newGameBtn").addEventListener("click", () => {
    if (!confirm("Start a new game?")) return;
    const rosters = state.rosters;
    const teamNames = state.teamNames;
    const periodMode = state.periodMode;
    const courtOrientation = state.courtOrientation;
    const live = state.live;
    Object.assign(state, defaultState(), { rosters, teamNames, periodMode, courtOrientation, live });
    persist();
    resetDraft();
    render();
    publishLiveSoon();
  });

  $("#exportBtn").addEventListener("click", () => {
    $("#exportText").value = JSON.stringify(state, null, 2);
    $("#exportDialog").showModal();
  });

  $("#saveRosterBtn").addEventListener("click", () => {
    const hornetsRoster = parseRoster($("#hornetsRoster").value);
    const opponentRoster = parseRoster($("#opponentRoster").value);
    if (!hornetsRoster.length || !opponentRoster.length) {
      $("#rosterStatus").textContent = "Each team needs at least one number.";
      return;
    }
    state.teamNames.Hornets = sanitizeTeamName($("#homeTeamName").value, "Hornets");
    state.teamNames.Opponent = sanitizeTeamName($("#awayTeamName").value, "Opponent");
    state.periodMode = $("input[name='periodMode']:checked")?.value === "halves" ? "halves" : "quarters";
    state.period = Math.min(state.period, maxPeriods());
    state.rosters.Hornets = hornetsRoster;
    state.rosters.Opponent = opponentRoster;
    persist();
    render();
    $("#rosterStatus").textContent = "Settings saved.";
    publishLiveSoon();
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

wireEvents();
resetDraft();
render();
registerServiceWorker();
