const socket = io();

let code = sessionStorage.getItem("egs.code") || null;
let facilitatorToken = sessionStorage.getItem("egs.facilitatorToken") || null;
let currentQuarter = null;
let countdownHandle = null;

const el = (id) => document.getElementById(id);

function fmtDelta(n) {
  return n > 0 ? `+${n}` : `${n}`;
}

function renderTally(tally, choices) {
  const container = el("tally");
  container.innerHTML = "";
  const total = Object.values(tally).reduce((a, b) => a + b, 0);
  for (const choice of choices) {
    const count = tally[choice.id] || 0;
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    const row = document.createElement("div");
    row.className = "tally-row";
    row.innerHTML = `
      <strong style="width:18px">${choice.id}</strong>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
      <span class="muted" style="width:70px;text-align:right">${count} vote${count === 1 ? "" : "s"}</span>
    `;
    container.appendChild(row);
  }
}

function startCountdown(deadline) {
  if (countdownHandle) clearInterval(countdownHandle);
  const timerEl = el("timer");
  function tick() {
    const secondsLeft = Math.max(0, Math.round((deadline - Date.now()) / 1000));
    timerEl.textContent = deadline ? `${secondsLeft}s left` : "";
    timerEl.classList.toggle("low", secondsLeft <= 5 && secondsLeft > 0);
    if (secondsLeft <= 0 && countdownHandle) {
      clearInterval(countdownHandle);
      countdownHandle = null;
    }
  }
  tick();
  countdownHandle = setInterval(tick, 250);
}

function showGamePanel(payload) {
  el("room-panel").style.display = "none";
  el("game-panel").style.display = "block";
  el("report-panel").style.display = "none";
  currentQuarter = payload.quarter;
  el("q-number").textContent = payload.quarterNumber;
  el("q-title").textContent = payload.quarter ? payload.quarter.title : "";
  el("phase-label").textContent = "Voting open";
  el("reveal-info").style.display = "none";
  renderTally(payload.tally, payload.quarter.choices);
  if (payload.voteDeadline) startCountdown(payload.voteDeadline);
}

el("create-btn").addEventListener("click", () => {
  socket.emit("room:create", {}, (res) => {
    if (!res.ok) return alert(res.error);
    code = res.code;
    facilitatorToken = res.facilitatorToken;
    sessionStorage.setItem("egs.code", code);
    sessionStorage.setItem("egs.facilitatorToken", facilitatorToken);
    joinAsFacilitator();
    el("create-panel").style.display = "none";
    el("room-panel").style.display = "block";
    el("room-code").textContent = code;
    el("qr").src = res.qrDataUrl;
    el("vote-url").textContent = res.voteUrl;
    el("screen-link").href = `/screen/${code}`;
  });
});

function joinAsFacilitator() {
  socket.emit("room:join", { code, role: "facilitator", facilitatorToken }, (res) => {
    if (!res.ok) return alert(res.error);
    applySnapshot(res.snapshot);
  });
}

function applySnapshot(snapshot) {
  el("player-count").textContent = snapshot.playerCount;
  if (snapshot.phase === "lobby") {
    el("create-panel").style.display = "none";
    el("room-panel").style.display = "block";
  } else if (snapshot.phase === "report") {
    renderReport(snapshot.report);
  } else if (snapshot.quarter) {
    showGamePanel({
      quarter: snapshot.quarter,
      quarterNumber: snapshot.quarterNumber,
      tally: snapshot.tally,
      voteDeadline: snapshot.voteDeadline,
    });
    if (snapshot.phase === "revealed" && snapshot.lastResolution) {
      renderReveal(snapshot.lastResolution, snapshot.lastResult, false);
    }
  }
}

el("start-btn").addEventListener("click", () => {
  socket.emit("facilitator:startGame", { code, facilitatorToken }, (res) => {
    if (!res.ok) alert(res.error);
  });
});

el("close-vote-btn").addEventListener("click", () => {
  socket.emit("facilitator:closeVote", { code, facilitatorToken }, (res) => {
    if (!res.ok) alert(res.error);
  });
});

el("reveal-btn").addEventListener("click", () => {
  socket.emit("facilitator:revealResult", { code, facilitatorToken }, (res) => {
    if (!res.ok) alert(res.error);
  });
});

el("next-btn").addEventListener("click", () => {
  socket.emit("facilitator:nextQuarter", { code, facilitatorToken }, (res) => {
    if (!res.ok) alert(res.error);
  });
});

el("force-btn").addEventListener("click", () => {
  if (!confirm("Emergency force-advance: skip normal close/reveal flow and push the game forward with whatever votes exist. Use only for catastrophic connectivity failure. Continue?")) return;
  socket.emit("facilitator:forceAdvance", { code, facilitatorToken }, (res) => {
    if (!res.ok) alert(res.error);
  });
});

socket.on("room:playerCount", (count) => {
  el("player-count").textContent = count;
});

socket.on("quarter:start", (payload) => {
  showGamePanel(payload);
});

socket.on("vote:tally", (payload) => {
  if (currentQuarter) renderTally(payload.tally, currentQuarter.choices);
});

socket.on("vote:closed", (payload) => {
  el("phase-label").textContent = payload.auto ? "Voting closed (timer expired)" : "Voting closed";
  if (currentQuarter) renderTally(payload.tally, currentQuarter.choices);
});

socket.on("vote:revealed", (payload) => {
  renderReveal(payload.resolution, payload.result, payload.isGameComplete);
});

function renderReveal(resolution, result, isGameComplete) {
  el("phase-label").textContent = "Result revealed";
  const box = el("reveal-info");
  box.style.display = "block";

  const tieNote = resolution.wasTie
    ? `<p><span class="pill tie">Tie broken by engine</span> ${
        resolution.usedFinalFallback
          ? "chain didn't discriminate — used first-listed-option fallback."
          : `resolved via: ${resolution.tieBreakStepsUsed.map((s) => `${s.kpi} (${s.direction})`).join(" → ")}.`
      }</p>`
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
    <h3>Winning choice: ${resolution.winner}</h3>
    ${tieNote}
    <div class="kpi-grid">${deltaEntries}</div>
    ${isGameComplete ? '<p class="muted">Game complete — waiting for report…</p>' : ""}
  `;
}

socket.on("game:report", (payload) => {
  renderReport(payload.report, payload.layer2Placeholder);
});

function renderReport(report, layer2Placeholder) {
  el("game-panel").style.display = "none";
  el("room-panel").style.display = "none";
  const panel = el("report-panel");
  panel.style.display = "block";
  if (!report) {
    panel.innerHTML = "<p>Report unavailable.</p>";
    return;
  }
  const scorecardRows = report.scorecard
    .map((e) => `<tr><td>${e.name}</td><td>${e.baseline}</td><td>${e.final}</td><td>${fmtDelta(e.delta)}</td></tr>`)
    .join("");
  const swings = report.biggestSwings.map((e) => `<li>${e.name}: ${fmtDelta(e.delta)} (baseline ${e.baseline} → ${e.final})</li>`).join("");
  panel.innerHTML = `
    <h2>Executive report</h2>
    <p>${report.headline}</p>
    <h3>Scorecard</h3>
    <table style="width:100%; border-collapse:collapse">
      <tr class="muted"><th align="left">KPI</th><th align="left">Baseline</th><th align="left">Final</th><th align="left">Δ</th></tr>
      ${scorecardRows}
    </table>
    <h3>Biggest swings</h3>
    <ul>${swings}</ul>
    <h3>Closing discussion question</h3>
    <p>${report.closingDiscussionQuestion.detail}</p>
    <h3>AI-generated narrative (Layer 2)</h3>
    <p class="muted"><em>${layer2Placeholder || "Not available in this session."}</em></p>
  `;
}

if (code && facilitatorToken) {
  el("create-panel").style.display = "none";
  el("room-panel").style.display = "block";
  el("room-code").textContent = code;
  el("screen-link").href = `/screen/${code}`;
  joinAsFacilitator();
}
