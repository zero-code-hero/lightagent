import type { AgentSession } from "@mariozechner/pi-coding-agent";

export interface ChatSession {
  session: AgentSession;
  chatId: number;
  lastActivityAt: number;
  context: SessionContext;
}

export interface SessionContext {
  pendingText: string;
  lastMessageId?: number;
  lastEditAt: number;
  isProcessing: boolean;
  currentTool?: string;
}
