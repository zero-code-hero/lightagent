import type { Context } from "telegraf";
import { config } from "./config.js";
import * as log from "./log.js";
import type { SessionContext } from "./types.js";

export class TelegramStreamer {
  private ctx: Context;
  private context: SessionContext;
  private buffer = "";
  private editTimer?: NodeJS.Timeout;
  private typingTimer?: NodeJS.Timeout;
  private lastEditAt = 0;
  private inTool = false;

  constructor(ctx: Context, context: SessionContext) {
    this.ctx = ctx;
    this.context = context;
  }

  /** Start a new run — send initial placeholder */
  async startThinking(): Promise<void> {
    try {
      const msg = await this.ctx.reply("🤔 Thinking...");
      this.context.lastMessageId = msg.message_id;
      this.keepTyping();
    } catch (err: any) {
      log.debug("failed to send thinking message:", err.message ?? String(err));
    }
  }

  /** Append text delta — stream live */
  append(text: string): void {
    if (this.inTool) return; // don't add text while tool status is showing
    this.buffer += text;
    this.scheduleEdit();
  }

  /** Show tool is running — immediate, pauses text */
  async setTool(name: string): Promise<void> {
    this.cancelEdit();
    this.inTool = true;
    this.context.currentTool = name;
    try {
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

  /** Tool done — flash status, resume text */
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
      }
    } catch {
      // ignore
    }
    // Back to text
    this.inTool = false;
    this.scheduleEdit();
  }

  /** Force final flush — strip prefix, deliver complete text */
  async flushNow(): Promise<void> {
    this.cancelEdit();

    const text = this.buffer.trim();
    if (!text) {
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

    const chunks = [];
    const MAX = config.telegramMaxMessageLength;
    for (let i = 0; i < text.length; i += MAX) {
      chunks.push(text.slice(i, i + MAX));
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

  /** Live edit with "Thinking... (snippit)" prefix during generation */
  private scheduleEdit(): void {
    if (this.editTimer) return;
    const delay = Math.max(
      0,
      config.telegramEditIntervalMs - (Date.now() - this.lastEditAt)
    );
    this.editTimer = setTimeout(() => {
      this.editTimer = undefined;
      void this.doEdit();
    }, delay);
  }

  private cancelEdit(): void {
    if (this.editTimer) {
      clearTimeout(this.editTimer);
      this.editTimer = undefined;
    }
  }

  private async doEdit(): Promise<void> {
    if (!this.context.lastMessageId) return;

    const text = this.buffer.trim();
    let content: string;

    if (!text) {
      content = "🤔 Thinking...";
    } else {
      // Build a "Thinking... (snippet)" preview of current output
      const snippet = text.slice(-300); // last ~300 chars
      content = `🤔 Thinking...\n\n${snippet}`;
    }

    // Respect Telegram edit size limit
    if (content.length > config.telegramMaxMessageLength) {
      content = content.slice(0, config.telegramMaxMessageLength);
    }

    try {
      await this.ctx.telegram.editMessageText(
        this.ctx.chat!.id,
        this.context.lastMessageId,
        undefined,
        content,
        { parse_mode: undefined }
      );
      this.lastEditAt = Date.now();
    } catch (err: any) {
      log.debug("edit failed:", err.message ?? String(err));
      try {
        const msg = await this.ctx.reply(content, { parse_mode: undefined });
        this.context.lastMessageId = msg.message_id;
        this.lastEditAt = Date.now();
      } catch {
        // ignore
      }
    }
  }

  private keepTyping(): void {
    const chatId = this.ctx.chat?.id;
    if (!chatId || !this.context.isProcessing) return;
    void this.ctx.sendChatAction("typing").catch(() => {});
    this.typingTimer = setTimeout(() => this.keepTyping(), 4000);
  }

  dispose(): void {
    this.cancelEdit();
    if (this.typingTimer) {
      clearTimeout(this.typingTimer);
      this.typingTimer = undefined;
    }
  }
}
