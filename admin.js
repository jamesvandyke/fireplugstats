const $ = (sel) => document.querySelector(sel);

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function sanitizeColor(value, fallback = "#0f766e") {
  const clean = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(clean) ? clean : fallback;
}

function sanitizePlayerName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 24);
}

function collectRoster(tbody) {
  const rows = [...tbody.querySelectorAll("tr.player-row")];
  const seen = new Set();
  const players = [];
  for (const row of rows) {
    const num = parseInt(row.querySelector(".player-number").value, 10);
    const name = sanitizePlayerName(row.querySelector(".player-name").value);
    if (!Number.isInteger(num) || num < 0 || num > 99) continue;
    if (seen.has(num)) continue;
    seen.add(num);
    players.push({ number: num, name });
  }
  return players.sort((a, b) => a.number - b.number);
}

function addPlayerRow(tbody, player = null) {
  const tr = document.createElement("tr");
  tr.className = "player-row";
  tr.innerHTML = `
    <td><input class="player-number" type="number" min="0" max="99" value="${player ? escapeHtml(String(player.number)) : ""}" placeholder="#" inputmode="numeric"></td>
    <td><input class="player-name" type="text" maxlength="24" value="${player ? escapeHtml(player.name) : ""}" placeholder="Name (optional)" autocapitalize="words"></td>
    <td><button class="remove-player-btn" type="button" aria-label="Remove player">✕</button></td>
  `;
  tr.querySelector(".remove-player-btn").addEventListener("click", () => tr.remove());
  tbody.appendChild(tr);
  tr.querySelector(".player-number").focus();
}

let editingId = null;

function openTeamForm(team = null) {
  editingId = team?.id || null;
  $("#dialogTitle").textContent = team ? "Edit Team" : "New Team";
  $("#teamName").value = team?.name || "";
  $("#teamColor").value = sanitizeColor(team?.color, "#0f766e");
  const tbody = $("#playerTableBody");
  tbody.innerHTML = "";
  (team?.roster || []).forEach((p) => addPlayerRow(tbody, p));
  $("#formStatus").textContent = "";
  $("#teamDialog").showModal();
  $("#teamName").focus();
}

function renderTeamList(teams) {
  const list = $("#teamList");
  if (!teams.length) {
    list.innerHTML = '<div class="admin-empty">No teams yet. Tap + New Team to get started.</div>';
    return;
  }
  list.innerHTML = teams.map((t) => {
    const count = t.playerCount ?? 0;
    return `<div class="team-card" data-id="${escapeHtml(t.id)}">
      <div class="color-swatch" style="background:${escapeHtml(sanitizeColor(t.color))}"></div>
      <div class="team-card-info">
        <strong>${escapeHtml(t.name)}</strong>
        <span>${count} player${count !== 1 ? "s" : ""}</span>
      </div>
      <button class="icon-action-btn edit-btn" data-id="${escapeHtml(t.id)}" aria-label="Edit ${escapeHtml(t.name)}">Edit</button>
      <button class="icon-action-btn danger delete-btn" data-id="${escapeHtml(t.id)}" aria-label="Delete ${escapeHtml(t.name)}">Del</button>
    </div>`;
  }).join("");

  list.querySelectorAll(".edit-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const team = await fetchTeam(btn.dataset.id);
      if (team) openTeamForm(team);
    });
  });

  list.querySelectorAll(".delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => handleDelete(btn.dataset.id));
  });
}

async function loadTeams() {
  try {
    const res = await fetch("/api/teams");
    if (!res.ok) throw new Error();
    const teams = await res.json();
    renderTeamList(teams);
    return teams;
  } catch {
    $("#teamList").innerHTML = '<div class="admin-empty">Could not load teams. Is the server running?</div>';
    return [];
  }
}

async function fetchTeam(id) {
  try {
    const res = await fetch(`/api/teams/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error();
    return await res.json();
  } catch {
    return null;
  }
}

async function handleSave() {
  const name = $("#teamName").value.trim().slice(0, 24);
  const color = sanitizeColor($("#teamColor").value);
  if (!name) {
    $("#formStatus").textContent = "Team name is required.";
    $("#teamName").focus();
    return;
  }
  const roster = collectRoster($("#playerTableBody"));
  const btn = $("#saveTeamBtn");
  btn.disabled = true;
  btn.textContent = "Saving…";
  try {
    const method = editingId ? "PUT" : "POST";
    const url = editingId ? `/api/teams/${encodeURIComponent(editingId)}` : "/api/teams";
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, color, roster }),
    });
    if (!res.ok) throw new Error();
    $("#teamDialog").close();
    loadTeams();
  } catch {
    $("#formStatus").textContent = "Save failed. Please try again.";
  } finally {
    btn.disabled = false;
    btn.textContent = "Save";
  }
}

async function handleDelete(id) {
  const card = document.querySelector(`.team-card[data-id="${CSS.escape(id)}"]`);
  const name = card?.querySelector("strong")?.textContent || "this team";
  if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
  try {
    const res = await fetch(`/api/teams/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) throw new Error();
    loadTeams();
  } catch {
    alert("Delete failed. Please try again.");
  }
}

// Wire events
$("#newTeamBtn").addEventListener("click", () => openTeamForm(null));
$("#closeDialogBtn").addEventListener("click", () => $("#teamDialog").close());
$("#cancelBtn").addEventListener("click", () => $("#teamDialog").close());
$("#saveTeamBtn").addEventListener("click", handleSave);
$("#addPlayerBtn").addEventListener("click", () => addPlayerRow($("#playerTableBody")));

// Enter in name field triggers save
$("#teamName").addEventListener("keydown", (e) => { if (e.key === "Enter") handleSave(); });

// Initial load
loadTeams();
