import { createServer, type Server as HttpServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import QRCode from "qrcode";
import { Server as SocketIOServer } from "socket.io";
import { loadGameData, type ChoiceId, type GameData } from "../../simulation/src/index.js";
import { Room } from "./room.js";
import {
  LAYER2_PLACEHOLDER,
  type ClientRole,
  type FacilitatorActionRequest,
  type RoomJoinRequest,
  type VoteCastRequest,
} from "./types.js";
import { generateUniqueRoomCode } from "./roomCode.js";

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

export interface AppOptions {
  gameData?: GameData;
  publicUrl?: string;
}

export interface AppHandle {
  app: Express;
  httpServer: HttpServer;
  io: SocketIOServer;
  rooms: Map<string, Room>;
}

type Ack<T> = (response: T) => void;

function ok<T extends object>(payload: T) {
  return { ok: true as const, ...payload };
}

function err(error: string) {
  return { ok: false as const, error };
}

export function createApp(options: AppOptions = {}): AppHandle {
  const gameData = options.gameData ?? loadGameData();
  const rooms = new Map<string, Room>();

  const app = express();
  app.use(express.static(PUBLIC_DIR));
  app.get("/vote/:code", (_req, res) => res.sendFile(join(PUBLIC_DIR, "vote.html")));
  app.get("/screen/:code", (_req, res) => res.sendFile(join(PUBLIC_DIR, "screen.html")));

  const httpServer = createServer(app);
  const io = new SocketIOServer(httpServer, { cors: { origin: "*" } });

  function resolvePublicUrl(): string {
    if (options.publicUrl) return options.publicUrl;
    const address = httpServer.address();
    const port = address && typeof address === "object" ? address.port : undefined;
    return `http://localhost:${port ?? "3000"}`;
  }

  function broadcastQuarterStart(room: Room): void {
    io.to(room.code).emit("quarter:start", {
      quarter: room.currentQuarter ?? null,
      quarterNumber: room.currentQuarter?.id ?? null,
      totalQuarters: room.gameData.quarters.length,
      voteDeadline: room.voteDeadline,
      voteTimerSeconds: room.gameData.meta.voteTimerSeconds,
      tally: room.tally(),
    });
  }

  function scheduleAutoClose(room: Room): void {
    const deadline = room.voteDeadline;
    if (deadline === null) return;
    const msRemaining = Math.max(0, deadline - Date.now());
    room.timer = setTimeout(() => {
      if (room.phase !== "voting") return;
      room.closeVoting();
      io.to(room.code).emit("vote:closed", { tally: room.tally(), auto: true });
    }, msRemaining);
  }

  function openQuarter(room: Room): void {
    room.startVoting();
    scheduleAutoClose(room);
    broadcastQuarterStart(room);
  }

  function broadcastReveal(room: Room, resolution: ReturnType<Room["reveal"]>["resolution"], result: ReturnType<Room["reveal"]>["result"]): void {
    io.to(room.code).emit("vote:revealed", {
      resolution,
      result,
      isGameComplete: room.engine.isComplete,
    });
    if (room.phase === "report" && room.report) {
      io.to(room.code).emit("game:report", {
        report: room.report,
        layer2Placeholder: LAYER2_PLACEHOLDER,
      });
    }
  }

  function requireFacilitator(room: Room, token: string): void {
    if (token !== room.facilitatorToken) {
      throw new Error("invalid facilitator token");
    }
  }

  io.on("connection", (socket) => {
    socket.on("room:create", (_payload: unknown, cb: Ack<unknown>) => {
      const code = generateUniqueRoomCode(rooms);
      const room = new Room(code, gameData);
      rooms.set(code, room);

      const voteUrl = `${resolvePublicUrl()}/vote/${code}`;
      QRCode.toDataURL(voteUrl)
        .then((qrDataUrl) => {
          cb(ok({ code, facilitatorToken: room.facilitatorToken, voteUrl, qrDataUrl }));
        })
        .catch((error: unknown) => {
          cb(err(error instanceof Error ? error.message : "failed to generate QR code"));
        });
    });

    socket.on("room:join", (payload: RoomJoinRequest, cb: Ack<unknown>) => {
      const room = rooms.get(payload.code);
      if (!room) {
        cb(err(`no room with code "${payload.code}"`));
        return;
      }
      if (payload.role === "facilitator") {
        try {
          requireFacilitator(room, payload.facilitatorToken ?? "");
        } catch (error) {
          cb(err(error instanceof Error ? error.message : "unauthorized"));
          return;
        }
      }

      socket.data.roomCode = room.code;
      socket.data.role = payload.role satisfies ClientRole;
      socket.join(room.code);

      if (payload.role === "player") {
        room.playerIds.add(socket.id);
        io.to(room.code).emit("room:playerCount", room.playerIds.size);
      }

      cb(ok({ snapshot: room.toSnapshot() }));
    });

    socket.on("vote:cast", (payload: VoteCastRequest, cb: Ack<unknown>) => {
      const room = rooms.get(socket.data.roomCode as string);
      if (!room) {
        cb(err("not in a room"));
        return;
      }
      try {
        room.castVote(socket.id, payload.choiceId);
      } catch (error) {
        cb(err(error instanceof Error ? error.message : "could not cast vote"));
        return;
      }
      cb(ok({ choiceId: payload.choiceId }));
      io.to(room.code).emit("vote:tally", { tally: room.tally() });
    });

    socket.on("facilitator:startGame", (payload: FacilitatorActionRequest, cb: Ack<unknown>) => {
      const room = rooms.get(payload.code);
      if (!room) return cb(err("no such room"));
      try {
        requireFacilitator(room, payload.facilitatorToken);
        if (room.phase !== "lobby") throw new Error(`cannot start game from phase "${room.phase}"`);
        openQuarter(room);
        cb(ok({}));
      } catch (error) {
        cb(err(error instanceof Error ? error.message : "could not start game"));
      }
    });

    socket.on("facilitator:closeVote", (payload: FacilitatorActionRequest, cb: Ack<unknown>) => {
      const room = rooms.get(payload.code);
      if (!room) return cb(err("no such room"));
      try {
        requireFacilitator(room, payload.facilitatorToken);
        // Guard against a race with the auto-close timer: only broadcast if this
        // call is the one that actually closed voting (closeVoting is idempotent).
        const didClose = room.closeVoting();
        if (didClose) {
          io.to(room.code).emit("vote:closed", { tally: room.tally(), auto: false });
        }
        cb(ok({}));
      } catch (error) {
        cb(err(error instanceof Error ? error.message : "could not close vote"));
      }
    });

    socket.on("facilitator:revealResult", (payload: FacilitatorActionRequest, cb: Ack<unknown>) => {
      const room = rooms.get(payload.code);
      if (!room) return cb(err("no such room"));
      try {
        requireFacilitator(room, payload.facilitatorToken);
        const { resolution, result } = room.reveal();
        broadcastReveal(room, resolution, result);
        cb(ok({}));
      } catch (error) {
        cb(err(error instanceof Error ? error.message : "could not reveal result"));
      }
    });

    socket.on("facilitator:nextQuarter", (payload: FacilitatorActionRequest, cb: Ack<unknown>) => {
      const room = rooms.get(payload.code);
      if (!room) return cb(err("no such room"));
      try {
        requireFacilitator(room, payload.facilitatorToken);
        if (room.phase !== "revealed") throw new Error(`cannot advance from phase "${room.phase}"`);
        if (room.engine.isComplete) throw new Error("the game is already complete");
        openQuarter(room);
        cb(ok({}));
      } catch (error) {
        cb(err(error instanceof Error ? error.message : "could not advance quarter"));
      }
    });

    socket.on("facilitator:forceAdvance", (payload: FacilitatorActionRequest, cb: Ack<unknown>) => {
      const room = rooms.get(payload.code);
      if (!room) return cb(err("no such room"));
      try {
        requireFacilitator(room, payload.facilitatorToken);
        const outcome = room.forceAdvance();
        if (outcome) {
          broadcastReveal(room, outcome.resolution, outcome.result);
        }
        if (room.phase === "voting") {
          scheduleAutoClose(room);
          broadcastQuarterStart(room);
        }
        cb(ok({}));
      } catch (error) {
        cb(err(error instanceof Error ? error.message : "could not force-advance"));
      }
    });

    socket.on("disconnect", () => {
      const room = rooms.get(socket.data.roomCode as string);
      if (!room) return;
      if (room.playerIds.delete(socket.id)) {
        io.to(room.code).emit("room:playerCount", room.playerIds.size);
      }
    });
  });

  return { app, httpServer, io, rooms };
}
