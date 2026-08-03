const socket = io();
const code = window.location.pathname.split("/").pop();
const root = document.getElementById("root");
let currentQuarter = null;
let countdownHandle = null;

function fmtDelta(n) {
  return n > 0 ? `+${n}` : `${n}`;
}

socket.emit("room:join", { code, role: "screen" }, (res) => {
  if (!res.ok) {
    root.innerHTML = `<div class="card"><h2>Could not join room</h2><p>${res.error}</p></div>`;
    return;
  }
  applySnapshot(res.snapshot);
});

function applySnapshot(snapshot) {
  if (snapshot.phase === "lobby") {
    renderLobby(snapshot);
  } else if (snapshot.phase === "report") {
    renderReport(snapshot.report, "");
  } else if (snapshot.quarter) {
    renderQuarter(snapshot.quarter, snapshot.quarterNumber, snapshot.totalQuarters, snapshot.tally, snapshot.voteDeadline);
    if (snapshot.phase === "revealed" && snapshot.lastResolution) {
      renderReveal(snapshot.lastResolution, snapshot.lastResult);
    }
  }
}

function renderLobby(snapshot) {
  root.innerHTML = `
    <div class="card center">
      <h1>Enterprise Growth Simulator</h1>
      <p class="muted">Room code</p>
      <div class="code" style="font-size:3rem">${snapshot.code}</div>
      <p class="muted" id="lobby-count">${snapshot.playerCount} joined</p>
      <p class="muted">Waiting for the facilitator to start…</p>
    </div>
  `;
}

function renderQuarter(quarter, quarterNumber, totalQuarters, tally, deadline) {
  currentQuarter = quarter;
  const choiceRows = quarter.choices
    .map(
      (c) => `
      <div class="tally-row" data-choice="${c.id}">
        <strong style="width:18px">${c.id}</strong>
        <div style="flex:2" class="muted">${c.label}</div>
        <div class="bar-track" style="flex:1"><div class="bar-fill" style="width:0%"></div></div>
        <span class="muted" style="width:60px;text-align:right" data-count>0</span>
      </div>`,
    )
    .join("");

  root.innerHTML = `
    <div class="card">
      <p class="muted">Quarter ${quarterNumber} of ${totalQuarters}</p>
      <h1>${quarter.title}</h1>
      <p>${quarter.businessContext}</p>
      <p class="muted"><em>${quarter.whyItHappens}</em></p>
    </div>
    <div class="card">
      <div class="row" style="justify-content:space-between; align-items:center">
        <h3 style="margin:0">Live tally</h3>
        <span class="timer" id="timer"></span>
      </div>
      <div id="tally">${choiceRows}</div>
    </div>
    <div id="reveal-info"></div>
  `;
  updateTally(tally);
  if (deadline) startCountdown(deadline);
}

function updateTally(tally) {
  if (!currentQuarter) return;
  const total = Object.values(tally).reduce((a, b) => a + b, 0);
  for (const choice of currentQuarter.choices) {
    const row = document.querySelector(`[data-choice="${choice.id}"]`);
    if (!row) continue;
    const count = tally[choice.id] || 0;
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    row.querySelector(".bar-fill").style.width = `${pct}%`;
    row.querySelector("[data-count]").textContent = `${count} (${pct}%)`;
  }
}

function startCountdown(deadline) {
  if (countdownHandle) clearInterval(countdownHandle);
  function tick() {
    const timerEl = document.getElementById("timer");
    if (!timerEl) {
      clearInterval(countdownHandle);
      return;
    }
    const secondsLeft = Math.max(0, Math.round((deadline - Date.now()) / 1000));
    timerEl.textContent = `${secondsLeft}s`;
    timerEl.classList.toggle("low", secondsLeft <= 5 && secondsLeft > 0);
    if (secondsLeft <= 0) {
      clearInterval(countdownHandle);
    }
  }
  tick();
  countdownHandle = setInterval(tick, 250);
}

function renderReveal(resolution, result) {
  const box = document.getElementById("reveal-info");
  if (!box) return;
  document.querySelectorAll("[data-choice]").forEach((rowEl) => {
    rowEl.classList.toggle("winner", rowEl.dataset.choice === resolution.winner);
  });

  const tieNote = resolution.wasTie
    ? `<p><span class="pill tie">Tie broken by the engine's tie-break rules</span></p>`
    : "";

  const deltaEntries = Object.entries(result.kpiAfter)
    .map(([kpi, value]) => {
      const before = result.kpiBefore[kpi];
      const delta = value - before;
      const cls = delta > 0 ? "up" : delta < 0 ? "down" : "";
      return `<div class="kpi-tile"><div class="name">${kpi}</div><div class="value">${value}</div><div class="delta ${cls}">${fmtDelta(delta)}</div></div>`;
    })
    .join("");

  box.innerHTML = `
    <div class="card">
      <h2>The room chose: ${resolution.winner}</h2>
      ${tieNote}
      <div class="kpi-grid">${deltaEntries}</div>
    </div>
  `;
}

function renderReport(report, layer2Narrative) {
  if (!report) {
    root.innerHTML = '<div class="card"><h2>Report unavailable</h2></div>';
    return;
  }
  const scorecardTiles = report.scorecard
    .map((e) => {
      const cls = e.delta > 0 ? "up" : e.delta < 0 ? "down" : "";
      return `<div class="kpi-tile"><div class="name">${e.name}</div><div class="value">${e.final}</div><div class="delta ${cls}">${fmtDelta(e.delta)} vs baseline ${e.baseline}</div></div>`;
    })
    .join("");
  const swings = report.biggestSwings.map((e) => `<li>${e.name}: ${fmtDelta(e.delta)}</li>`).join("");

  root.innerHTML = `
    <div class="card center">
      <p class="muted">Executive report</p>
      <h1>${report.headline}</h1>
    </div>
    <div class="card">
      <h3>Scorecard</h3>
      <div class="kpi-grid">${scorecardTiles}</div>
    </div>
    <div class="card">
      <h3>Biggest swings</h3>
      <ul>${swings}</ul>
    </div>
    <div class="card">
      <h3>Closing discussion question</h3>
      <p>${report.closingDiscussionQuestion.detail}</p>
    </div>
    <div class="card">
      <h3>AI-generated narrative</h3>
      <p class="muted"><em>${layer2Narrative || "Not yet available."}</em></p>
    </div>
  `;
}

socket.on("room:playerCount", (count) => {
  const countEl = document.getElementById("lobby-count");
  if (countEl) countEl.textContent = `${count} joined`;
});

socket.on("quarter:start", (payload) => {
  renderQuarter(payload.quarter, payload.quarterNumber, payload.totalQuarters, payload.tally, payload.voteDeadline);
});

socket.on("vote:tally", (payload) => updateTally(payload.tally));
socket.on("vote:closed", (payload) => updateTally(payload.tally));

socket.on("vote:revealed", (payload) => {
  renderReveal(payload.resolution, payload.result);
});

socket.on("game:report", (payload) => {
  renderReport(payload.report, payload.layer2Narrative);
});
