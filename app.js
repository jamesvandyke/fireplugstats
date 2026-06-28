const STORAGE_KEY = "fireplug.stats.game.v1";
const PERIOD_SECONDS = 8 * 60;
const DEFAULT_ROSTERS = {
  Hornets: [0, 1, 2, 3, 5, 7, 10, 11, 12, 14, 21, 24].map((number) => ({ number, name: "" })),
  Opponent: [1, 2, 3, 4, 5, 10, 11, 12, 20, 22, 23, 33].map((number) => ({ number, name: "" })),
};

const state = loadState();
let draft = {};
let step = "player";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const stepTitles = {
  player: ["Player", "Hornets on top, opponent below"],
  action: ["Action", ""],
  location: ["Location", "Tap the court"],
  result: ["Result", ""],
  time: ["Time", ""],
};

function defaultState() {
  return {
    period: 1,
    periodMode: "quarters",
    lastTime: "8:00",
    teamNames: {
      Hornets: "Hornets",
      Opponent: "Opponent",
    },
    rosters: {
      Hornets: cloneRoster(DEFAULT_ROSTERS.Hornets),
      Opponent: cloneRoster(DEFAULT_ROSTERS.Opponent),
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
  const periodLimit = periodMode === "halves" ? 2 : 4;
  return {
    ...defaultState(),
    ...saved,
    period: Math.min(Math.max(Number(saved?.period) || 1, 1), periodLimit),
    periodMode,
    teamNames: {
      Hornets: sanitizeTeamName(saved?.teamNames?.Hornets, "Hornets"),
      Opponent: sanitizeTeamName(saved?.teamNames?.Opponent, "Opponent"),
    },
    rosters: {
      Hornets: sanitizeRoster(saved?.rosters?.Hornets || DEFAULT_ROSTERS.Hornets),
      Opponent: sanitizeRoster(saved?.rosters?.Opponent || DEFAULT_ROSTERS.Opponent),
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
  return Number.isFinite(total) ? Math.max(0, Math.min(PERIOD_SECONDS, total)) : PERIOD_SECONDS;
}

function clockFromSeconds(total) {
  const safe = Math.max(0, Math.min(PERIOD_SECONDS, total));
  const minutes = Math.floor(safe / 60);
  const seconds = String(safe % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function maxPeriods() {
  return state.periodMode === "halves" ? 2 : 4;
}

function periodPrefix() {
  return state.periodMode === "halves" ? "H" : "Q";
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
  const threes = shots.filter((event) => event.points === 3);
  return {
    points: shots.filter((event) => event.made).reduce((sum, event) => sum + event.points, 0),
    fgMade: shots.filter((event) => event.made).length,
    fgAtt: shots.length,
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
  const isCornerThree = courtY > 32.8 && (courtX < 3 || courtX > 47);
  const isAboveBreakThree = courtY <= 32.8 && distance > 23.75;
  if (distance < 4) return { zone: "At Rim", points: 2 };
  if (courtX >= 19 && courtX <= 31 && courtY >= 28) return { zone: "Paint", points: 2 };
  if (isCornerThree || isAboveBreakThree) {
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

function setStep(nextStep) {
  step = nextStep;
  $$(".step").forEach((el) => el.classList.toggle("active", el.id === `${step}Step`));
  const [title, meta] = stepTitles[step];
  $("#stepTitle").textContent = title;
  $("#stepMeta").textContent = step === "player" ? `${teamName("Hornets")} on top, ${teamName("Opponent")} below` : meta || playerLabel(draft.team, Number(draft.player));
  $("#backBtn").disabled = step === "player";
}

function resetDraft() {
  draft = {};
  $("#pendingShotMarker").style.display = "none";
  renderEventTime();
  setStep("player");
}

function renderScore() {
  $("#homeTeamLabel").textContent = teamName("Hornets");
  $("#awayTeamLabel").textContent = teamName("Opponent");
  $("#homePlayersLabel").textContent = teamName("Hornets");
  $("#awayPlayersLabel").textContent = teamName("Opponent");
  $("#hornetsScore").textContent = scoreFor("Hornets");
  $("#opponentScore").textContent = scoreFor("Opponent");
  $("#periodLabel").textContent = `${periodPrefix()}${state.period}`;
  $("#clockLabel").textContent = state.lastTime;
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

function renderEventTime() {
  $("#eventTimeDisplay").textContent = state.lastTime;
}

function changeEventTime(deltaSeconds) {
  state.lastTime = clockFromSeconds(secondsFromClock(state.lastTime) + deltaSeconds);
  renderEventTime();
}

function periodLabelFor(event) {
  return `${event.periodMode === "halves" ? "H" : "Q"}${event.period}`;
}

function actionText(event) {
  if (event.action === "shot") return `${event.made ? "made" : "missed"} ${event.points} (${event.location.zone})`;
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
  shotsFor().forEach((event) => {
    const marker = document.createElement("span");
    marker.className = `review-shot ${event.made ? "hit" : "miss"}`;
    marker.style.left = `${event.location.x}%`;
    marker.style.top = `${event.location.y}%`;
    marker.title = `${playerLabel(event.team, event.player)} ${actionText(event)}`;
    court.appendChild(marker);
  });
}

function render() {
  renderPlayers();
  renderScore();
  renderBox();
  renderPlays();
  renderShotChart();
  renderRoster();
}

function saveDraft() {
  const event = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    period: state.period,
    periodMode: state.periodMode,
    time: state.lastTime,
    team: draft.team,
    player: Number(draft.player),
    action: draft.action,
  };
  if (draft.action === "shot") {
    event.made = draft.made;
    event.points = draft.location.points;
    event.location = draft.location;
  }
  state.events.push(event);
  persist();
  resetDraft();
  render();
}

function wireEvents() {
  document.addEventListener("click", (event) => {
    const player = event.target.closest(".player-btn");
    if (player) {
      draft = { team: player.dataset.team, player: player.dataset.player };
      setStep("action");
    }
  });

  $$(".action-btn[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      draft.action = button.dataset.action;
      if (draft.action === "shot") setStep("location");
      else setStep("time");
    });
  });

  $("#shotCourt").addEventListener("click", (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    draft.location = { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, ...classifyShot(x, y) };
    const marker = $("#pendingShotMarker");
    marker.style.left = `${draft.location.x}%`;
    marker.style.top = `${draft.location.y}%`;
    marker.style.display = "block";
    setStep("result");
  });

  $$(".action-btn[data-made]").forEach((button) => {
    button.addEventListener("click", () => {
      draft.made = button.dataset.made === "true";
      setStep("time");
    });
  });

  $$(".time-btn[data-time-delta]").forEach((button) => {
    button.addEventListener("click", () => {
      changeEventTime(Number(button.dataset.timeDelta));
      renderScore();
    });
  });

  $("#saveEvent").addEventListener("click", saveDraft);

  $("#undoBtn").addEventListener("click", () => {
    state.events.pop();
    state.lastTime = state.events.at(-1)?.time || "8:00";
    persist();
    resetDraft();
    render();
  });

  $("#backBtn").addEventListener("click", () => {
    if (step === "action") resetDraft();
    else if (step === "location") setStep("action");
    else if (step === "result") setStep("location");
    else if (step === "time") setStep(draft.action === "shot" ? "result" : "action");
  });

  $("#periodDown").addEventListener("click", () => {
    state.period = Math.max(1, state.period - 1);
    persist();
    render();
  });

  $("#periodUp").addEventListener("click", () => {
    state.period = Math.min(maxPeriods(), state.period + 1);
    persist();
    render();
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
    Object.assign(state, defaultState(), { rosters, teamNames, periodMode });
    persist();
    resetDraft();
    render();
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
    $("#rosterStatus").textContent = "Roster saved.";
  });
}

wireEvents();
resetDraft();
render();
registerServiceWorker();
