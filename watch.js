const params = new URLSearchParams(window.location.search);
const gameId = params.get("game");
let game = null;

const $ = (selector) => document.querySelector(selector);

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function teamName(team) {
  return game?.teamNames?.[team] || team;
}

function teamColor(team) {
  return game?.teamColors?.[team] || (team === "Opponent" ? "#b45309" : "#0f766e");
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

function periodLabel(period = game?.period || 1, mode = game?.periodMode || "quarters") {
  const regulation = mode === "halves" ? 2 : 4;
  if (period > regulation) return `OT${period - regulation}`;
  return `${mode === "halves" ? "H" : "Q"}${period}`;
}

function periodLabelFor(event) {
  return periodLabel(event.period, event.periodMode || "quarters");
}

function playerFor(team, number) {
  return game?.rosters?.[team]?.find((player) => player.number === Number(number));
}

function playerLabel(team, number) {
  const player = playerFor(team, number);
  return `${teamName(team)} #${number}${player?.name ? ` ${player.name}` : ""}`;
}

function actionText(event) {
  if (event.action === "shot") {
    if (event.shotType === "freeThrow") return `${event.made ? "made" : "missed"} free throw`;
    return `${event.made ? "made" : "missed"} ${event.points} (${event.location.zone})`;
  }
  return event.action;
}

function scoreFor(team, events = game?.events || []) {
  return events
    .filter((event) => event.team === team && event.action === "shot" && event.made)
    .reduce((sum, event) => sum + event.points, 0);
}

function scoreAfter(index) {
  const partial = game.events.slice(0, index + 1);
  return `${scoreFor("Hornets", partial)}-${scoreFor("Opponent", partial)}`;
}

function withEventOnlyPlayers(team) {
  const roster = (game.rosters?.[team] || []).map((player) => player.number);
  const eventPlayers = game.events.filter((event) => event.team === team).map((event) => event.player);
  return [...new Set([...roster, ...eventPlayers])].sort((a, b) => a - b);
}

function statsForPlayer(team, player) {
  return statsForEvents(game.events.filter((event) => event.team === team && event.player === player));
}

function statsForTeam(team) {
  return statsForEvents(game.events.filter((event) => event.team === team));
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

function courtRotationFor(team) {
  const orientation = [0, 90, 180, 270].includes(game?.courtOrientation) ? game.courtOrientation : 0;
  return team === "Opponent" ? (orientation + 180) % 360 : orientation;
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

function renderScore() {
  applyTeamColors();
  $("#homeTeamLabel").textContent = teamName("Hornets");
  $("#awayTeamLabel").textContent = teamName("Opponent");
  $("#hornetsScore").textContent = scoreFor("Hornets");
  $("#opponentScore").textContent = scoreFor("Opponent");
  $("#periodLabel").textContent = periodLabel();
  $("#clockLabel").textContent = game.lastTime || "8:00";
}

function renderPlays() {
  const plays = game.events.map((event, index) => ({ event, index })).reverse().slice(0, 12);
  $("#playList").innerHTML = plays.length
    ? plays.map(({ event, index }) => `
      <li>
        <span class="play-time">${periodLabelFor(event)} ${event.time}</span>
        <strong>${escapeHtml(playerLabel(event.team, event.player))}</strong>
        <span>${escapeHtml(actionText(event))}</span>
        <em>${scoreAfter(index)}</em>
      </li>
    `).join("")
    : `<li><span class="play-time">Live</span><strong>Waiting for plays</strong><span>The scorer has not entered an event yet.</span><em>0-0</em></li>`;
}

function renderBox() {
  $("#boxTitle").textContent = "Box Score";
  $("#boxRows").innerHTML = ["Hornets", "Opponent"].map((team) => {
    const rows = withEventOnlyPlayers(team).map((number) => {
      const stats = statsForPlayer(team, number);
      return boxRow(playerLabel(team, number), stats);
    }).join("");
    return `<tr class="team-box-row"><th colspan="11">${escapeHtml(teamName(team))}</th></tr>${rows}${boxRow("Team", statsForTeam(team), "total-row")}`;
  }).join("");
}

function boxRow(label, stats, className = "") {
  return `<tr${className ? ` class="${className}"` : ""}>
        <th>${escapeHtml(label)}</th>
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

function renderShotChart() {
  const court = $("#watchCourt");
  court.querySelectorAll(".review-shot").forEach((node) => node.remove());
  applyCourtOrientation(court, "Hornets");
  game.events
    .filter((event) => event.action === "shot" && event.shotType !== "freeThrow" && event.location)
    .forEach((event) => {
      const visual = toVisualShotLocation(event.location, "Hornets");
      const marker = document.createElement("span");
      marker.className = `review-shot ${event.made ? "hit" : "miss"}`;
      marker.style.left = `${visual.x}%`;
      marker.style.top = `${visual.y}%`;
      marker.title = `${playerLabel(event.team, event.player)} ${actionText(event)}`;
      court.appendChild(marker);
    });
}

function render() {
  renderScore();
  renderPlays();
  renderBox();
  renderShotChart();
  const updated = game.updatedAt ? new Date(game.updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }) : "";
  $("#watchStatus").textContent = updated ? `Live stats updated ${updated}` : "Live stats connected.";
}

async function loadGame() {
  if (!gameId) {
    $("#watchStatus").textContent = "Missing live game link.";
    return;
  }
  try {
    const response = await fetch(`/api/games/${encodeURIComponent(gameId)}`);
    if (response.status === 404) {
      $("#watchStatus").textContent = "Waiting for the scorer to start this live game.";
      return;
    }
    if (!response.ok) throw new Error("Unable to load live game.");
    game = await response.json();
    render();
  } catch {
    $("#watchStatus").textContent = "Live stats are temporarily unavailable.";
  }
}

loadGame();
setInterval(loadGame, 2000);
