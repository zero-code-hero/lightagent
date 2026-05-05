import type { Context } from "telegraf";
import * as log from "./log.js";
import type { SessionContext } from "./types.js";

export class TelegramStreamer {
  private ctx: Context;
  private context: SessionContext;
  private textBuffer: string = "";

  constructor(ctx: Context, context: SessionContext) {
    this.ctx = ctx;
    this.context = context;
  }

  /** Start a new run — send the "thinking" placeholder */
  async startThinking(): Promise<void> {
    try {
      const msg = await this.ctx.reply("🤔 Thinking...");
      this.context.lastMessageId = msg.message_id;
      // Send typing action every few seconds while processing
      this.keepTyping();
    } catch (err: any) {
      log.debug("failed to send thinking message:", err.message ?? String(err));
    }
  }

  /** Append text to the internal buffer (no Telegram updates) */
  append(text: string): void {
    this.textBuffer += text;
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
          `🔧 ${name}...`,
          { parse_mode: undefined }
        );
      } else {
        const msg = await this.ctx.reply(`🔧 ${name}...`);
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
          success ? "✅ Done" : "❌ Error",
          { parse_mode: undefined }
        );
        // Brief pause so user sees the status, then back to thinking
        await new Promise((r) => setTimeout(r, 400));
        await this.ctx.telegram.editMessageText(
          this.ctx.chat!.id,
          this.context.lastMessageId,
          undefined,
          "🤔 Thinking...",
          { parse_mode: undefined }
        );
      }
    } catch (err: any) {
      log.debug("endTool edit failed:", err.message ?? String(err));
    }
  }

  /** Flush the complete response to Telegram */
  async flushNow(): Promise<void> {
    const text = this.textBuffer;
    if (!text.trim()) {
      // No text generated — maybe just tools ran
      if (this.context.lastMessageId) {
        try {
          await this.ctx.telegram.editMessageText(
            this.ctx.chat!.id,
            this.context.lastMessageId,
            undefined,
            "✅ Done",
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
      // Single chunk — edit the placeholder
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
        // Fallback: send as new message
        await this.ctx.reply(chunks[0]!, { parse_mode: undefined });
      }
    } else {
      // Multiple chunks or no placeholder — send as new messages
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

  private keepTyping(): void {
    const chatId = this.ctx.chat?.id;
    if (!chatId || !this.context.isProcessing) return;
    // Send typing action every 4 seconds while running
    if (this.context.isProcessing) {
      this.ctx.sendChatAction("typing").catch(() => {});
      setTimeout(() => this.keepTyping(), 4000);
    }
  }

  dispose(): void {
    // nothing to clean up anymore
  }
}
