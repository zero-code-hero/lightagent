import type { Context } from "telegraf";
import * as log from "./log.js";
import type { SessionContext } from "./types.js";

export class TelegramStreamer {
  private ctx: Context;
  private context: SessionContext;
  private textBuffer: string = "";
  private startTime: number = 0;
  private heartbeatTimer?: NodeJS.Timeout;
  private thinkingSnippet: string = "";

  constructor(ctx: Context, context: SessionContext) {
    this.ctx = ctx;
    this.context = context;
  }

  /** Start a new run */
  async startThinking(): Promise<void> {
    this.startTime = Date.now();
    this.thinkingSnippet = "";
    try {
      const msg = await this.ctx.reply("🤔 Thinking...");
      this.context.lastMessageId = msg.message_id;
      this.startHeartbeat();
      this.keepTyping();
    } catch (err: any) {
      log.debug("failed to send thinking message:", err.message ?? String(err));
    }
  }

  /** Append text to the internal buffer (no Telegram updates) */
  append(text: string): void {
    this.textBuffer += text;
  }

  /** Append thinking/reasoning snippet */
  appendThinking(text: string): void {
    this.thinkingSnippet += text;
    // Only keep last ~100 chars so the status doesn't get huge
    if (this.thinkingSnippet.length > 120) {
      this.thinkingSnippet = "..." + this.thinkingSnippet.slice(-100);
    }
  }

  /** Mark that a tool is running */
  async setTool(name: string): Promise<void> {
    try {
      this.context.currentTool = name;
      if (this.context.lastMessageId) {
        await this.ctx.telegram.editMessageText(
          this.ctx.chat!.id,
          this.context.lastMessageId,
          undefined,
          `🔧 ${name}...${this.elapsedSuffix()}`,
          { parse_mode: undefined }
        );
      } else {
        const msg = await this.ctx.reply(`🔧 ${name}...${this.elapsedSuffix()}`);
        this.context.lastMessageId = msg.message_id;
      }
    } catch (err: any) {
      log.debug("tool status failed:", err.message ?? String(err));
    }
  }

  /** Clear tool status — back to thinking */
  async endTool(success: boolean): Promise<void> {
    this.context.currentTool = undefined;
    try {
      if (this.context.lastMessageId) {
        await this.ctx.telegram.editMessageText(
          this.ctx.chat!.id,
          this.context.lastMessageId,
          undefined,
          success ? `✅ Done${this.elapsedSuffix()}` : `❌ Error${this.elapsedSuffix()}`,
          { parse_mode: undefined }
        );
        await new Promise((r) => setTimeout(r, 400));
        await this.statusUpdate();
      }
    } catch (err: any) {
      log.debug("endTool edit failed:", err.message ?? String(err));
    }
  }

  /** Update the thinking message with current status */
  private async statusUpdate(): Promise<void> {
    if (!this.context.lastMessageId || !this.context.isProcessing) return;

    const elapsed = this.elapsedSuffix();
    let status: string;

    if (this.context.currentTool) {
      status = `🔧 ${this.context.currentTool}...${elapsed}`;
    } else if (this.thinkingSnippet) {
      const snippet = this.thinkingSnippet.slice(0, 80);
      status = `🤔 ${snippet}${this.thinkingSnippet.length > 80 ? "..." : ""}${elapsed}`;
    } else {
      status = `🤔 Thinking...${elapsed}`;
    }

    try {
      await this.ctx.telegram.editMessageText(
        this.ctx.chat!.id,
        this.context.lastMessageId,
        undefined,
        status,
        { parse_mode: undefined }
      );
    } catch {
      // ignore edit failures
    }
  }

  /** Flush the complete response to Telegram */
  async flushNow(): Promise<void> {
    this.stopHeartbeat();

    const text = this.textBuffer;
    if (!text.trim()) {
      if (this.context.lastMessageId) {
        try {
          await this.ctx.telegram.editMessageText(
            this.ctx.chat!.id,
            this.context.lastMessageId,
            undefined,
            `✅ Done${this.elapsedSuffix()}`,
            { parse_mode: undefined }
          );
        } catch {
          // ignore
        }
      }
      return;
    }

    // Telegram message limit: 4096 chars. Use 4000 to be safe.
    const MAX_LEN = 4000;
    const chunks = [];
    for (let i = 0; i < text.length; i += MAX_LEN) {
      chunks.push(text.slice(i, i + MAX_LEN));
    }

    if (chunks.length === 1 && this.context.lastMessageId) {
      try {
        await this.ctx.telegram.editMessageText(
          this.ctx.chat!.id,
          this.context.lastMessageId,
          undefined,
          chunks[0]!,
          { parse_mode: undefined }
        );
      } catch (err: any) {
        log.debug("final edit failed:", err.message ?? String(err));
        await this.ctx.reply(chunks[0]!, { parse_mode: undefined });
      }
    } else {
      if (this.context.lastMessageId) {
        try {
          await this.ctx.telegram.deleteMessage(this.ctx.chat!.id, this.context.lastMessageId);
        } catch {
          // ignore
        }
      }
      for (const chunk of chunks) {
        try {
          await this.ctx.reply(chunk, { parse_mode: undefined });
        } catch (err: any) {
          log.debug("send chunk failed:", err.message ?? String(err));
        }
      }
    }
  }

  private elapsedSuffix(): string {
    const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
    if (elapsed < 10) return "";
    return ` (${elapsed}s)`;
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      void this.statusUpdate();
    }, 5000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private keepTyping(): void {
    const chatId = this.ctx.chat?.id;
    if (!chatId || !this.context.isProcessing) return;
    this.ctx.sendChatAction("typing").catch(() => {});
    setTimeout(() => this.keepTyping(), 5000);
  }

  dispose(): void {
    this.stopHeartbeat();
  }
}
