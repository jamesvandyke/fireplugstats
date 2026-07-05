const COURT_SVG = `<svg class="court-lines" viewBox="0 0 50 47" aria-hidden="true">
  <rect x="0.5" y="0.5" width="49" height="46" />
  <line x1="0.5" y1="46.5" x2="49.5" y2="46.5" />
  <rect x="19" y="28" width="12" height="18.5" />
  <path d="M19 28a6 6 0 0 1 12 0" />
  <path class="hash" d="M19 34h-2.3M31 34h2.3M19 38h-2.3M31 38h2.3M19 42h-2.3M31 42h2.3" />
  <line x1="22" y1="43" x2="28" y2="43" />
  <circle class="rim-line" cx="25" cy="41.75" r="0.75" />
  <path d="M5.96 46.5V37.95C8 28.2 15.8 22 25 22C34.2 22 42 28.2 44.04 37.95V46.5" />
  <line class="midcourt" x1="0.5" y1="0.5" x2="49.5" y2="0.5" />
  <path class="center-mark" d="M19 0.5a6 6 0 0 0 12 0" />
</svg>`;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function textColorFor(background) {
  const hex = String(background).replace(/[^0-9a-f]/gi, "").slice(0, 6).padEnd(6, "0");
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#111827" : "#ffffff";
}

function statsForEvents(events) {
  const shots = events.filter((e) => e.action === "shot");
  const fieldShots = shots.filter((e) => e.shotType !== "freeThrow");
  const threes = fieldShots.filter((e) => e.points === 3);
  const freeThrows = shots.filter((e) => e.shotType === "freeThrow");
  return {
    points: shots.filter((e) => e.made).reduce((sum, e) => sum + e.points, 0),
    fgMade: fieldShots.filter((e) => e.made).length,
    fgAtt: fieldShots.length,
    threeMade: threes.filter((e) => e.made).length,
    threeAtt: threes.length,
    ftMade: freeThrows.filter((e) => e.made).length,
    ftAtt: freeThrows.length,
    rebounds: events.filter((e) => e.action === "rebound").length,
    steals: events.filter((e) => e.action === "steal").length,
    fouls: events.filter((e) => e.action === "foul").length,
  };
}

function pct(made, attempts) {
  return attempts ? `${Math.round((made / attempts) * 100)}%` : "--";
}

function toVisualShotLocation(location, rotation) {
  if (rotation === 90) return { x: location.y, y: 100 - location.x };
  if (rotation === 180) return { x: 100 - location.x, y: 100 - location.y };
  if (rotation === 270) return { x: 100 - location.y, y: location.x };
  return location;
}

function applyTeamColors(game) {
  const root = document.documentElement;
  const hornets = game.teamColors?.Hornets || "#0f766e";
  const opponent = game.teamColors?.Opponent || "#b45309";
  root.style.setProperty("--hornets", hornets);
  root.style.setProperty("--hornets-text", textColorFor(hornets));
  root.style.setProperty("--away", opponent);
  root.style.setProperty("--away-text", textColorFor(opponent));
}

function playerLabel(game, team, number) {
  const player = (game.rosters?.[team] || []).find((p) => p.number === Number(number));
  const teamName = game.teamNames?.[team] || team;
  return `${teamName} #${number}${player?.name ? ` ${player.name}` : ""}`;
}

function withEventOnlyPlayers(game, team) {
  const roster = (game.rosters?.[team] || []).map((p) => p.number);
  const eventPlayers = (game.events || []).filter((e) => e.team === team).map((e) => e.player);
  return [...new Set([...roster, ...eventPlayers])].sort((a, b) => a - b);
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

function renderBoxScore(game) {
  const rows = ["Hornets", "Opponent"].map((team) => {
    const teamName = game.teamNames?.[team] || team;
    const numbers = withEventOnlyPlayers(game, team);
    const playerRows = numbers.map((n) => {
      const stats = statsForEvents((game.events || []).filter((e) => e.team === team && e.player === n));
      return boxRow(playerLabel(game, team, n), stats);
    }).join("");
    const teamStats = statsForEvents((game.events || []).filter((e) => e.team === team));
    return `<tr class="team-box-row"><th colspan="11">${escapeHtml(teamName)}</th></tr>${playerRows}${boxRow("Team", teamStats, "total-row")}`;
  }).join("");

  return `<div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Player</th><th>PTS</th><th>FG</th><th>FG%</th>
          <th>3PT</th><th>3P%</th><th>FT</th><th>FT%</th>
          <th>REB</th><th>STL</th><th>F</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function renderCourtWithShots(game, team) {
  const shots = (game.events || []).filter(
    (e) => e.action === "shot" && e.shotType !== "freeThrow" && e.location && e.team === team
  );
  const rotation = game.courtOrientation || 0;
  const teamRotation = team === "Opponent" ? (rotation + 180) % 360 : rotation;

  const rotClass = teamRotation === 180 ? "rotated" : teamRotation === 90 ? "rotated-left" : teamRotation === 270 ? "rotated-right" : "";
  const markers = shots.map((e) => {
    const v = toVisualShotLocation(e.location, teamRotation);
    return `<span class="review-shot${e.made ? " hit" : ""}" style="left:${v.x}%;top:${v.y}%" title="${escapeHtml(playerLabel(game, team, e.player))}"></span>`;
  }).join("");

  return `<div class="court review-court ${rotClass}">${COURT_SVG}${markers}</div>`;
}

function scoreFor(game, team) {
  return (game.events || [])
    .filter((e) => e.team === team && e.action === "shot" && e.made)
    .reduce((sum, e) => sum + e.points, 0);
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "";
  }
}

function render(game) {
  applyTeamColors(game);
  const homeName = game.teamNames?.Hornets || "Hornets";
  const awayName = game.teamNames?.Opponent || "Opponent";
  const homeScore = scoreFor(game, "Hornets");
  const awayScore = scoreFor(game, "Opponent");
  const dateStr = formatDate(game.savedAt || game.updatedAt);

  document.title = `${homeName} ${homeScore}–${awayScore} ${awayName} — Fireplug Stats`;

  document.getElementById("summaryRoot").innerHTML = `
    <div class="summary-header">
      <div class="summary-team">
        <div class="summary-team-name">${escapeHtml(homeName)}</div>
        <div class="summary-score summary-score-home">${homeScore}</div>
      </div>
      <div class="summary-divider">–</div>
      <div class="summary-team">
        <div class="summary-team-name">${escapeHtml(awayName)}</div>
        <div class="summary-score summary-score-away">${awayScore}</div>
      </div>
    </div>
    ${dateStr ? `<div class="summary-date">${escapeHtml(dateStr)}</div>` : ""}
    <div>
      <p class="summary-section-title">Shot Charts</p>
      <div class="summary-courts">
        <div class="summary-court-wrap">
          <div class="summary-court-label">${escapeHtml(homeName)}</div>
          ${renderCourtWithShots(game, "Hornets")}
        </div>
        <div class="summary-court-wrap">
          <div class="summary-court-label">${escapeHtml(awayName)}</div>
          ${renderCourtWithShots(game, "Opponent")}
        </div>
      </div>
    </div>
    <div>
      <p class="summary-section-title">Box Score</p>
      ${renderBoxScore(game)}
    </div>
    <div class="summary-wordmark">Fireplug Stats</div>
  `;
}

async function init() {
  const params = new URLSearchParams(window.location.search);
  const gameId = params.get("game");
  if (!gameId) {
    document.getElementById("summaryRoot").innerHTML = '<p class="summary-error">No game specified.</p>';
    return;
  }
  try {
    const response = await fetch(`/api/saved-games/${encodeURIComponent(gameId)}`);
    if (!response.ok) throw new Error("Not found");
    const game = await response.json();
    render(game);
  } catch {
    document.getElementById("summaryRoot").innerHTML = '<p class="summary-error">Could not load game summary.</p>';
  }
}

init();
