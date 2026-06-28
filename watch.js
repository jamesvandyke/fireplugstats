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
  const events = game.events.filter((event) => event.team === team && event.player === player);
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

function renderScore() {
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
      return `<tr>
        <th>${escapeHtml(playerLabel(team, number))}</th>
        <td>${stats.points}</td>
        <td>${stats.fgMade}-${stats.fgAtt}</td>
        <td>${stats.threeMade}-${stats.threeAtt}</td>
        <td>${stats.rebounds}</td>
        <td>${stats.steals}</td>
        <td>${stats.fouls}</td>
      </tr>`;
    }).join("");
    return `<tr class="team-box-row"><th colspan="7">${escapeHtml(teamName(team))}</th></tr>${rows}`;
  }).join("");
}

function render() {
  renderScore();
  renderPlays();
  renderBox();
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
