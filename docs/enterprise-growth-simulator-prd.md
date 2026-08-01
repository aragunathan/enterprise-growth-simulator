# Enterprise Growth Simulator — Product Requirements Document (PRD)

**Phase**: 1 — Design (no code yet)
**Scope of this document**: Roundtable version only. Website version is explicitly deferred — see Non-Goals.

---

## 1. Vision

A live, facilitator-run business simulation for CIO/COO/CXO roundtables. Over 8 quarterly decisions spanning a simulated two-year period, participants vote in real time — via phone, no login — on how a large UAE enterprise (starting around 4,200 employees and $120M revenue) navigates compounding operational complexity as it grows further. The room's collective choices drive one shared story to a close, ending in an executive report that synthesizes what the group's decisions revealed. The game is not the product — it exists to earn 30-40 minutes of sharp, informed discussion afterward.

**What players should feel**: recognition — "that's exactly the tradeoff we're facing right now" — and productive disagreement with peers in the room.

**What players should learn**: that organizational friction at scale is the accumulation of many reasonable-looking decisions, not one catastrophic call.

---

## 2. Format constraints (locked)

| Parameter | Value |
|---|---|
| Setting | Live roundtable, one shared screen, facilitator-run |
| Participants | ~10-15 CIOs/COOs/CXOs, each voting individually on their phone |
| Total gameplay time | 15 minutes hard ceiling |
| Number of decisions | 8 (one per simulated quarter, spanning ~2 simulated years) |
| Pacing budget | ~60s open, ~94s per decision × 8, ~90s report reveal = ~900s |
| Voting mechanism | QR-code join, no accounts, tap one of 4 options per decision, live tally on shared screen |
| Outcome model | Plurality vote advances the one shared story — no branching per-individual paths |
| Delayed effects | Yes — a quarter's choice can affect KPIs 2-3 quarters later, tied back explicitly in-story |

## 3. Non-goals (explicitly out of scope for this phase)

- **Website / solo-play version** — deferred. The engine should be built so it *could* support this later without a rewrite, but no solo-mode UI, no async pacing, no timer-free experience is being designed or built now.
- Player accounts, login, or persistence beyond a single live session
- Multiple industries/verticals or a content library beyond one curated arc
- Any live-voting platform (Mentimeter, AhaSlides, etc.) — confirmed not viable for this use case; custom QR/WebSocket build only

## 4. Success criteria

- A full room can complete all 8 decisions inside the 15-minute window in a live rehearsal, including real voting time
- At least 2 of the 8 votes produce a genuine split (not >80/20) in a rehearsal with a realistic exec audience — confirms the choices are debatable, not obvious
- The closing report gives the facilitator 2-3 concrete, specific lines they can read aloud to open discussion — not generic score language
- Zero manual intervention required from the facilitator to advance the story, except the "close vote / reveal / next" control

## 5. Core components (what Phase 1 needs to define in detail next)

1. **The 8-quarter narrative arc** — one company, one growth story, 4 choices per decision, immediate + delayed effects, mapped to a small set of KPIs
2. **KPI model** — the 4-6 metrics the story tracks and the report draws from (e.g. revenue, morale, compliance, decision speed, customer experience, friction)
3. **Voting layer** — QR join, phone client (4 buttons), shared screen (live tally + story), facilitator control (close vote / reveal / next)
4. **Rules engine** — applies immediate + delayed effects, advances quarters, holds KPI state
5. **Executive report generator** — synthesizes the room's 8 choices into a short, specific closing narrative

## 6. KPI model (resolved)

8 KPIs, each 0-100, tracked by the engine throughout. Only 3 are shown live during play — the rest surface in the closing report. This keeps the shared screen readable inside the ~94s/decision pacing budget while still giving the report real depth to draw from.

| KPI | Moves up when... | Moves down when... | Tension partner | Live during play? |
|---|---|---|---|---|
| Revenue Growth | expansion, sales investment, new markets | underinvestment, churn from friction | Cash | Yes (headline) |
| Decision Velocity | simplification, delegated authority | added process/approval layers | Compliance, Enterprise Friction | Yes (headline) |
| Enterprise Friction | *(see note below — accumulates from delayed effects)* | rare direct decreases, earned back slowly | everything | Yes (headline) |
| Cash | cost discipline, delayed hiring | headcount growth, expansion spend | Revenue Growth, Employee Experience | Report only |
| Employee Experience | people investment, autonomy | overload, layoffs, heavy process | Cash, Decision Velocity | Report only |
| Customer Experience | support/quality investment | friction, outages, neglect | Cash | Report only |
| Compliance | governance investment | speed-over-process choices | Innovation, Decision Velocity | Report only |
| Innovation | R&D investment, autonomy | heavy governance, risk-aversion | Compliance | Report only |

**Enterprise Friction is the core mechanic, not a normal metric.** Almost every decision should nudge it up slightly immediately, with a larger delayed hit landing 2-3 quarters later — this is what makes the vision statement's "friction is emergent, not catastrophic" idea actually playable rather than just a tagline.

## 7. Company context and quarter map (resolved — enterprise scale)

**Industry: generic / diversified.** Deliberately not sector-specific, so any CIO/COO/CXO in the room maps their own org onto it. Industry-specific variants (real estate, financial services, healthcare, etc.) are future content-library work, built only after the generic version is validated live — see Section 3, Non-Goals.

**Company**: a Dubai-headquartered, multi-business-unit enterprise, already at scale — roughly 4,200 employees and ~$120M revenue at Q1, growing to ~7,000 employees and ~$250-300M revenue by Q8 through the events below. Revised from an earlier "small company scaling up" version once we confirmed the actual roundtable audience is $100M+ revenue enterprises — the story needed to open at a scale those leaders currently recognize as their own reality, not one they left behind years ago. The 8 quarters are new layers of complexity compounding on an already-large, already-complex organization, not startup growing pains.

8 decision scenarios, grounded in current UAE/GCC enterprise conditions rather than invented problems, sequenced so early choices generate the friction that surfaces later:

| Q | Decision | Primary tension |
|---|---|---|
| 1 | A regional demand surge outpaces the existing multi-business-unit approval chain | Revenue Growth vs Enterprise Friction |
| 2 | A landmark AED 50M government tender appears; governance records are scattered across business units | Compliance vs Decision Velocity |
| 3 | A flagship customer asks the company to establish operations in Saudi Arabia | Revenue Growth vs Cash, cross-border Compliance |
| 4 | The board demands an enterprise-wide AI strategy; data is fragmented across legacy business-unit systems | Innovation vs Compliance |
| 5 | UAE e-invoicing becomes mandatory for a company well above the revenue threshold | Compliance vs Decision Velocity |
| 6 | A cyber incident forces IT to freeze deployments across multiple business units | Innovation vs Enterprise Friction |
| 7 | A major acquisition brings duplicate ERPs, HR systems, vendors, and approval hierarchies at scale | Everything collides — where earlier debt gets exposed |
| 8 | A regional security disruption hits a key shipping route overnight, threatening a major client relationship | Cash vs Customer Experience — closing test of the whole arc |

The design intent: whatever the room defers or shortcuts in Q1-Q2 should resurface as Enterprise Friction by Q6-Q7, and Q8 should land as a direct test of whether earlier choices built real capability or just visible progress.

## 8. Delayed-effect map (resolved)

6 causal links across the 8 quarters — enough for the "friction accumulates" mechanic to land without overloading an 8-event MVP. Every quarter Q1-Q7 sends an effect forward; Q8 is pure payoff.

| Origin | Delay | Lands at | Logic |
|---|---|---|---|
| Q1 (approvals bottleneck) | 1Q | Q2 | Shortcuts taken under growth pressure show up as documentation gaps for the tender |
| Q2 (tender governance choice) | 3Q | Q5 | Skipped governance makes e-invoicing compliance slower and harder |
| Q3 (Saudi expansion) | 4Q | Q7 | Loose cross-border setup makes M&A system integration worse |
| Q4 (AI governance choice) | 2Q | Q6 | Rushed AI without governance makes the cyber incident hit harder |
| Q6 (cyber incident response) | 2Q | Q8 | Security-vs-speed tradeoff determines how much crisis-response muscle the org has when the next shock hits |
| Q7 (M&A) | 1Q | Q8 | Immediate carryover — the finale inherits whatever the M&A quarter left behind |

## 9. Facilitator fallback behavior (resolved)

- Each vote has a **visible 20-second countdown timer**, auto-closes on expiry — no waiting on stragglers
- Winner = **plurality of votes actually cast**, no minimum quorum required
- **Ties are broken automatically** by a fixed priority chain, computed live from the KPI model rather than authored per event: Enterprise Friction (lowest delta wins) → Cash (highest) → Revenue Growth (highest) → Customer Experience (highest) → Decision Velocity (highest) → Innovation (highest) → Compliance (highest) → Employee Experience (highest) → first-listed option (A>B>C>D) as an absolute last resort. Never a live facilitator judgment call, to avoid pacing loss and any perception of bias. See the "Tie-Break Priority" sheet in the KPI model workbook for the resolved order per quarter.
- One **facilitator-only override control**, reserved for catastrophic connectivity failure (near-zero votes registered) — a safety net, not a normal-operation path

## 10. Executive report format (resolved)

Hybrid design: a deterministic skeleton (always renders correctly, zero live-dependency risk) wrapping one AI-generated section (the part that most benefits from being bespoke to this specific room's choices).

**Layer 1 — Deterministic, computed directly from the KPI model:**
1. Headline framing line — one sentence on the final Enterprise Friction score vs. baseline
2. KPI scorecard — all 8 KPIs, final value vs. Q1 baseline (this is where the 5 report-only KPIs get their reveal)
3. Biggest swings — top 2-3 KPIs by absolute change from baseline, auto-sorted
4. Closing discussion question — auto-selected using the closest vote split across the 8 decisions (the engine already tracks tallies live for the shared screen, so this reuses existing data, not new scope). Fallback rule if tally data is unavailable: the single quarter that contributed most to the final Enterprise Friction score.

**Layer 2 — AI-generated narrative (one Claude API call):**
- Input: the room's 8 actual choices (by topic, not quarter number), the KPI trajectory, and Layer 1's biggest-swings list
- Output: 2-3 sentences, facilitator-readable aloud, required to name at least 2 specific quarters by topic
- Triggered the instant Q8's vote closes, before the reveal screen renders, to hide latency inside the transition
- Fallback: a pre-authored template using Layer 1's already-computed numbers, used only if the API call doesn't return in time — the shared screen must never hang or go blank in front of this audience

---

**Phase 2 status: complete.** Company context, 8-quarter map, KPI model with real point values (stress-tested), delayed-effect chain, facilitator fallback with a computed tie-break priority, and the executive report format are all locked.

*Next: Phase 3 — build the rules engine and voting layer against this spec.*
