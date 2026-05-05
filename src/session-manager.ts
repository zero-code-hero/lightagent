import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
} from "@mariozechner/pi-coding-agent";
import { config } from "./config.js";
import * as log from "./log.js";
import type { ChatSession, SessionContext } from "./types.js";

export class PiSessionManager {
  private sessions = new Map<number, ChatSession>();
  private authStorage: AuthStorage;
  private modelRegistry: ModelRegistry;

  constructor() {
    this.authStorage = AuthStorage.create(config.agentDir);
    this.modelRegistry = ModelRegistry.create(this.authStorage);

    const allModels = this.modelRegistry.getAll();
    log.debug("available models:", allModels.map((m) => `${m.provider}/${m.id}`));
  }

  async getOrCreate(chatId: number): Promise<ChatSession> {
    const existing = this.sessions.get(chatId);
    if (existing) {
      log.debug("reusing existing session for chat", chatId);
      existing.lastActivityAt = Date.now();
      return existing;
    }

    log.debug("creating new session for chat", chatId);
    const sessionManager = SessionManager.create(config.agentCwd);

    const { session } = await createAgentSession({
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
      sessionManager,
      cwd: config.agentCwd,
      agentDir: config.agentDir,
    });

    log.debug("session created", session.sessionId, "for chat", chatId);

    const context: SessionContext = {
      pendingText: "",
      lastEditAt: 0,
      isProcessing: false,
    };

    const chatSession: ChatSession = {
      session,
      chatId,
      lastActivityAt: Date.now(),
      context,
    };

    this.sessions.set(chatId, chatSession);
    log.debug("total sessions:", this.sessions.size);
    return chatSession;
  }

  async reset(chatId: number): Promise<ChatSession> {
    log.debug("resetting session for chat", chatId);
    const existing = this.sessions.get(chatId);
    if (existing) {
      existing.session.dispose();
      this.sessions.delete(chatId);
      log.debug("old session disposed for chat", chatId);
    }
    return this.getOrCreate(chatId);
  }

  get(chatId: number): ChatSession | undefined {
    return this.sessions.get(chatId);
  }

  disposeAll(): void {
    log.debug("disposing all", this.sessions.size, "sessions");
    for (const cs of this.sessions.values()) {
      cs.session.dispose();
    }
    this.sessions.clear();
  }

  gc(): void {
    if (config.sessionIdleTimeoutMs <= 0) return;
    const now = Date.now();
    let collected = 0;
    for (const [chatId, cs] of this.sessions) {
      if (!cs.context.isProcessing && now - cs.lastActivityAt > config.sessionIdleTimeoutMs) {
        log.debug("gc: collecting idle session for chat", chatId);
        cs.session.dispose();
        this.sessions.delete(chatId);
        collected++;
      }
    }
    if (collected > 0) {
      log.debug("gc: collected", collected, "idle sessions");
    }
  }
}
