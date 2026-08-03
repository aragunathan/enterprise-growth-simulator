import type { ChoiceId, QuarterResult, VoteResolution } from "../../simulation/src/index.js";
import type { RoomSnapshot } from "./room.js";

export type ClientRole = "player" | "screen" | "facilitator";

// --- client -> server payloads ---

export interface RoomJoinRequest {
  code: string;
  role: ClientRole;
  facilitatorToken?: string;
}

export interface VoteCastRequest {
  choiceId: ChoiceId;
}

export interface FacilitatorActionRequest {
  code: string;
  facilitatorToken: string;
}

// --- server -> client acks / broadcasts ---

export interface RoomCreatedResponse {
  code: string;
  facilitatorToken: string;
  voteUrl: string;
  qrDataUrl: string;
}

export interface RoomJoinResponse {
  ok: true;
  snapshot: RoomSnapshot;
}

export interface ErrorResponse {
  ok: false;
  error: string;
}

export interface QuarterStartEvent {
  quarter: RoomSnapshot["quarter"];
  quarterNumber: number | null;
  totalQuarters: number;
  voteDeadline: number | null;
  voteTimerSeconds: number;
  tally: Record<string, number>;
}

export interface VoteTallyEvent {
  tally: Record<string, number>;
}

export interface VoteClosedEvent {
  tally: Record<string, number>;
  auto: boolean;
}

export interface VoteRevealedEvent {
  resolution: VoteResolution;
  result: QuarterResult;
  isGameComplete: boolean;
}

export interface GameReportEvent {
  report: RoomSnapshot["report"];
  layer2Narrative: string;
}
