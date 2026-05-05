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
  private startTime = 0;
  private inTool = false;

  constructor(ctx: Context, context: SessionContext) {
    this.ctx = ctx;
    this.context = context;
  }

  /** Start a new run */
  async startThinking(): Promise<void> {
    this.startTime = Date.now();
    try {
      const msg = await this.ctx.reply("🤔 Thinking...");
      this.context.lastMessageId = msg.message_id;
      this.keepTyping();
    } catch (err: any) {
      log.debug("failed to send thinking message:", err.message ?? String(err));
    }
  }

  /** Accumulate text */
  append(text: string): void {
    if (this.inTool) return;
    this.buffer += text;
  }

  /** Show tool status */
  async setTool(name: string): Promise<void> {
    this.cancelEdit();
    this.inTool = true;
    this.context.currentTool = name;
    try {
      const text = `🔧 ${name}... ${this.elapsed()}`;
      if (this.context.lastMessageId) {
        await this.ctx.telegram.editMessageText(
          this.ctx.chat!.id,
          this.context.lastMessageId,
          undefined,
          text,
          { parse_mode: undefined }
        );
      } else {
        const msg = await this.ctx.reply(text, { parse_mode: undefined });
        this.context.lastMessageId = msg.message_id;
      }
    } catch (err: any) {
      log.debug("tool status failed:", err.message ?? String(err));
    }
  }

  /** Tool done — flash, resume */
  async endTool(success: boolean): Promise<void> {
    this.context.currentTool = undefined;
    try {
      if (this.context.lastMessageId) {
        const text = success ? `✅ Done ${this.elapsed()}` : `❌ Error ${this.elapsed()}`;
        await this.ctx.telegram.editMessageText(
          this.ctx.chat!.id,
          this.context.lastMessageId,
          undefined,
          text,
          { parse_mode: undefined }
        );
      }
    } catch {
      // ignore
    }
    this.inTool = false;
    this.scheduleEdit();
  }

  /** Force final flush */
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
            `✅ Done ${this.elapsed()}`,
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
    const text = `🤔 Thinking... ${this.elapsed()}`;
    try {
      await this.ctx.telegram.editMessageText(
        this.ctx.chat!.id,
        this.context.lastMessageId,
        undefined,
        text,
        { parse_mode: undefined }
      );
      this.lastEditAt = Date.now();
    } catch (err: any) {
      log.debug("edit failed:", err.message ?? String(err));
      try {
        const msg = await this.ctx.reply(text, { parse_mode: undefined });
        this.context.lastMessageId = msg.message_id;
        this.lastEditAt = Date.now();
      } catch {
        // ignore
      }
    }
  }

  private elapsed(): string {
    const s = Math.floor((Date.now() - this.startTime) / 1000);
    if (s < 1) return "";
    return `(${s}s)`;
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
