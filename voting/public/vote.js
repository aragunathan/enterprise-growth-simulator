const socket = io();
const root = document.getElementById("root");
const pathCode = window.location.pathname.split("/").pop();
let code = pathCode && pathCode.toLowerCase() !== "vote" ? pathCode.toUpperCase() : null;

let currentQuarter = null;
let myVote = null;
let myVoteQuarterId = null;
let countdownHandle = null;

function render(html) {
  root.innerHTML = html;
}

function renderJoinForm(error) {
  render(`
    <div class="card">
      <h2>Join the room</h2>
      ${error ? `<p style="color:var(--bad)">${error}</p>` : ""}
      <input id="code-input" class="code" style="font-size:1.4rem;padding:10px;width:100%" maxlength="4" placeholder="ROOM CODE" />
      <div class="row" style="margin-top:12px">
        <button class="primary" id="join-btn">Join</button>
      </div>
    </div>
  `);
  document.getElementById("join-btn").addEventListener("click", () => {
    code = document.getElementById("code-input").value.trim().toUpperCase();
    if (code) join();
  });
}

function join() {
  render(`<div class="waiting"><div class="spinner"></div><p class="muted">Joining room ${code}…</p></div>`);
  socket.emit("room:join", { code, role: "player" }, (res) => {
    if (!res.ok) {
      renderJoinForm(res.error);
      return;
    }
    applySnapshot(res.snapshot);
  });
}

function applySnapshot(snapshot) {
  if (snapshot.phase === "lobby") {
    renderLobby();
  } else if (snapshot.phase === "report") {
    renderThanks(snapshot.report);
  } else if (snapshot.quarter) {
    currentQuarter = snapshot.quarter;
    if (snapshot.phase === "voting") {
      renderChoices(snapshot.quarter, snapshot.voteDeadline);
    } else {
      renderWaitingForReveal(snapshot.quarter);
    }
  }
}

function renderLobby() {
  render(`
    <div class="waiting">
      <div class="spinner"></div>
      <h2>You're in</h2>
      <p class="muted">Waiting for the facilitator to start the game…</p>
    </div>
  `);
}

function renderChoices(quarter, deadline) {
  currentQuarter = quarter;
  const alreadyVoted = myVoteQuarterId === quarter.id;
  if (alreadyVoted) {
    renderWaitingForReveal(quarter);
    return;
  }
  const buttons = quarter.choices
    .map(
      (c) => `<button class="choice-btn" data-choice="${c.id}"><span class="letter">${c.id}</span><br>${c.label}</button>`,
    )
    .join("");
  render(`
    <div class="card">
      <div class="row" style="justify-content:space-between; align-items:center">
        <p class="muted" style="margin:0">Q${quarter.id}</p>
        <span class="timer" id="vote-timer"></span>
      </div>
      <h2>${quarter.title}</h2>
      <p>${quarter.businessContext}</p>
      <div class="choice-grid">${buttons}</div>
    </div>
  `);
  document.querySelectorAll(".choice-btn").forEach((btn) => {
    btn.addEventListener("click", () => castVote(quarter, btn.dataset.choice));
  });
  if (deadline) startCountdown(deadline);
}

function startCountdown(deadline) {
  if (countdownHandle) clearInterval(countdownHandle);
  function tick() {
    const timerEl = document.getElementById("vote-timer");
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

function castVote(quarter, choiceId) {
  socket.emit("vote:cast", { choiceId }, (res) => {
    if (!res.ok) {
      alert(res.error);
      return;
    }
    myVote = choiceId;
    myVoteQuarterId = quarter.id;
    renderWaitingForReveal(quarter);
  });
}

function renderWaitingForReveal(quarter) {
  render(`
    <div class="waiting">
      <div class="spinner"></div>
      <h2>Vote received</h2>
      ${myVote ? `<p>You picked <strong>${myVote}</strong>.</p>` : ""}
      <p class="muted">Waiting for the rest of the room…</p>
    </div>
  `);
}

function renderReveal(resolution) {
  const won = myVote === resolution.winner;
  render(`
    <div class="waiting">
      <h2>The room chose ${resolution.winner}</h2>
      <p class="muted">${won ? "That's what you picked." : `You picked ${myVote ?? "nothing"}.`}</p>
      <p class="muted">Waiting for the next quarter…</p>
    </div>
  `);
}

function renderThanks(report) {
  render(`
    <div class="card center">
      <h1>That's a wrap</h1>
      <p>${report ? report.headline : "The simulation is complete."}</p>
      <p class="muted">Look up — the full executive report is on the shared screen.</p>
    </div>
  `);
}

socket.on("quarter:start", (payload) => {
  myVote = null;
  if (payload.quarter) renderChoices(payload.quarter, payload.voteDeadline);
});

socket.on("vote:revealed", (payload) => {
  renderReveal(payload.resolution);
});

socket.on("game:report", (payload) => {
  renderThanks(payload.report);
});

if (code) {
  join();
} else {
  renderJoinForm();
}
