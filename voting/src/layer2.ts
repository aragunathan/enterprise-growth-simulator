import type { GameData, VoteResolution } from "../../simulation/src/index.js";
import type { Layer1Report } from "../../simulation/src/index.js";

const DEFAULT_MODEL = "claude-sonnet-5";
const DEFAULT_TIMEOUT_MS = 4000;

export interface AnthropicMessagesClient {
  messages: {
    create(params: {
      model: string;
      max_tokens: number;
      system: string;
      messages: Array<{ role: "user"; content: string }>;
    }): Promise<{ content: Array<{ type: string; text?: string }> }>;
  };
}

export interface Layer2Options {
  /** How long to wait for the API before falling back to the template. */
  timeoutMs?: number;
  /** Injectable client, used by tests to simulate success/failure/timeout. */
  client?: AnthropicMessagesClient;
}

/**
 * The fallback used whenever the Claude call hasn't returned (or fails) by the
 * time the narrative is needed — always built from the same real, already-computed
 * numbers the Layer 1 report shows, never placeholder text.
 */
export function buildFallbackNarrative(gameData: GameData, layer1Report: Layer1Report): string {
  const rg = layer1Report.scorecard.find((e) => e.kpi === "RG");
  const ef = layer1Report.scorecard.find((e) => e.kpi === gameData.meta.frictionDriftAppliesTo);
  return `Over the two simulated years, the room balanced growth against friction — closing at ${rg?.final} growth and ${ef?.final} friction.`;
}

function buildQuarterChoiceLines(gameData: GameData, voteResolutions: VoteResolution[]): string[] {
  return voteResolutions.map((resolution) => {
    const quarter = gameData.quarters.find((q) => q.id === resolution.quarterId);
    const choice = quarter?.choices.find((c) => c.id === resolution.winner);
    const topic = quarter?.title ?? `Quarter ${resolution.quarterId}`;
    return `- ${topic}: chose "${choice?.label ?? resolution.winner}"`;
  });
}

function buildPrompt(gameData: GameData, voteResolutions: VoteResolution[], layer1Report: Layer1Report): string {
  const choiceLines = buildQuarterChoiceLines(gameData, voteResolutions).join("\n");
  const trajectoryLines = layer1Report.scorecard
    .map((entry) => `- ${entry.name}: ${entry.baseline} -> ${entry.final} (${entry.delta >= 0 ? "+" : ""}${entry.delta})`)
    .join("\n");
  const swingLines = layer1Report.biggestSwings.map((entry) => `- ${entry.name}: ${entry.delta >= 0 ? "+" : ""}${entry.delta}`).join("\n");

  return [
    "The room just finished an 8-quarter enterprise growth simulation by voting on a decision each quarter.",
    "",
    "Choices made, by topic:",
    choiceLines,
    "",
    "Final KPI trajectory (baseline -> final):",
    trajectoryLines,
    "",
    "Biggest swings from baseline:",
    swingLines,
    "",
    "Write a 2-3 sentence executive narrative synthesizing the room's choices for a facilitator to read aloud to the room.",
    "Requirements: name at least 2 specific quarters by their topic (not \"Q3\" or \"quarter 3\"), no bullet points, boardroom-appropriate tone.",
  ].join("\n");
}

async function callClaude(client: AnthropicMessagesClient, prompt: string): Promise<string> {
  const response = await client.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 300,
    system:
      "You are writing a short executive narrative for a corporate simulation's closing report. " +
      "Respond with only the narrative — no preamble, no headers, no bullet points.",
    messages: [{ role: "user", content: prompt }],
  });
  const text = response.content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("")
    .trim();
  if (!text) {
    throw new Error("Claude returned no narrative text");
  }
  return text;
}

let cachedClient: AnthropicMessagesClient | null | undefined;

/** Lazily constructs the real Anthropic client, or null if no API key is configured. */
async function getDefaultClient(): Promise<AnthropicMessagesClient | null> {
  if (cachedClient !== undefined) return cachedClient;
  if (!process.env.ANTHROPIC_API_KEY) {
    cachedClient = null;
    return cachedClient;
  }
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  cachedClient = new Anthropic() as unknown as AnthropicMessagesClient;
  return cachedClient;
}

/**
 * Generates the Layer 2 AI narrative. Never rejects and never returns placeholder
 * text — on any failure or timeout it resolves to `buildFallbackNarrative`'s
 * real-numbers template instead, so the reveal screen never hangs or blanks.
 */
export async function generateLayer2Narrative(
  gameData: GameData,
  voteResolutions: VoteResolution[],
  layer1Report: Layer1Report,
  options: Layer2Options = {},
): Promise<string> {
  const fallback = buildFallbackNarrative(gameData, layer1Report);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const client = options.client ?? (await getDefaultClient());
  if (!client) return fallback;

  const prompt = buildPrompt(gameData, voteResolutions, layer1Report);

  const timeout = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), timeoutMs);
  });

  try {
    const result = await Promise.race([callClaude(client, prompt), timeout]);
    return result ?? fallback;
  } catch {
    return fallback;
  }
}
