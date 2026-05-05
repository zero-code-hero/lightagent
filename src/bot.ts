import { Telegraf, Context } from "telegraf";
import { config, isUserAllowed } from "./config.js";
import { PiSessionManager } from "./session-manager.js";
import { TelegramStreamer } from "./streamer.js";
import * as log from "./log.js";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";

export function createBot(sessionManager: PiSessionManager): Telegraf<Context> {
  const bot = new Telegraf(config.telegramBotToken);

  // Catch unhandled errors (timeouts, etc) so the bot doesn't crash
  bot.catch((err: any, ctx) => {
    log.error("unhandled telegraf error:", err.message ?? String(err));
    if (ctx?.chat?.id) {
      void ctx.reply("💥 Something went wrong. Try /abort and send your message again.");
    }
  });

  // Auth middleware
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    log.debug("incoming message from user", userId, "chat", ctx.chat?.id);
    if (!userId || !isUserAllowed(userId)) {
      log.warn("blocked user", userId);
      if (ctx.message) {
        await ctx.reply("🚫 Not authorized.");
      }
      return;
    }
    return next();
  });

  // Commands
  bot.command("start", async (ctx) => {
    log.debug("/start from chat", ctx.chat.id);
    await ctx.reply(
      "👋 lightagent here.\n\nSend me any coding task — I read files, run shell commands, edit code, and write new files.\n\nCommands:\n/new — start a fresh session\n/status — show session info\n/abort — cancel current run"
    );
  });

  bot.command("new", async (ctx) => {
    const chatId = ctx.chat.id;
    log.info("/new from chat", chatId);
    await ctx.reply("🔄 Starting fresh session...");
    await sessionManager.reset(chatId);
    await ctx.reply("✅ New session ready.");
  });

  bot.command("status", async (ctx) => {
    const chatId = ctx.chat.id;
    log.debug("/status from chat", chatId);
    const cs = sessionManager.get(chatId);
    if (!cs) {
      await ctx.reply("No active session.");
      return;
    }
    const msgs = cs.session.agent.state.messages.length;
    const model = cs.session.model?.name ?? "default";
    log.debug("status:", { sessionId: cs.session.sessionId, model, msgs });
    await ctx.reply(`Session: ${cs.session.sessionId}\nModel: ${model}\nMessages: ${msgs}`);
  });

  bot.command("abort", async (ctx) => {
    const chatId = ctx.chat.id;
    log.info("/abort from chat", chatId);
    const cs = sessionManager.get(chatId);
    if (!cs) {
      await ctx.reply("No active session.");
      return;
    }
    if (!cs.context.isProcessing) {
      await ctx.reply("Nothing running right now.");
      return;
    }
    await cs.session.abort();
    cs.context.isProcessing = false;
    await ctx.reply("🛑 Aborted.");
  });

  // Main message handler
  bot.on("text", async (ctx) => {
    const chatId = ctx.chat.id;
    const text = ctx.message.text;

    if (text.startsWith("/")) return;

    log.info("prompt from chat", chatId, "length", text.length);
    log.debug("prompt text:", text.slice(0, 200) + (text.length > 200 ? "..." : ""));

    const cs = await sessionManager.getOrCreate(chatId);

    if (cs.context.isProcessing) {
      log.debug("agent busy, queuing as steer for chat", chatId);
      try {
        await cs.session.steer(text);
        await ctx.reply("📝 Queued as steer.");
      } catch {
        await ctx.reply("⚠️ Could not queue. Try /abort first.");
      }
      return;
    }

    cs.context.isProcessing = true;
    cs.context.pendingText = "";
    cs.context.lastMessageId = undefined;
    cs.context.lastEditAt = 0;

    const streamer = new TelegramStreamer(ctx, cs.context);
    await streamer.startThinking();

    const unsubscribe = cs.session.subscribe((event: AgentSessionEvent) => {
      handleEvent(event, streamer, cs, ctx);
    });

    const start = Date.now();
    try {
      log.debug("sending prompt to agent for chat", chatId);
      await cs.session.prompt(text);
      const elapsed = Date.now() - start;
      log.info("prompt completed for chat", chatId, "in", elapsed, "ms");
    } catch (err: any) {
      log.error("prompt failed for chat", chatId, err.message ?? String(err));
      const msg = err.message?.includes("timed out")
        ? "⏱️ Request timed out. The model took too long to respond. Try again or use a different model."
        : `💥 Error: ${err.message ?? String(err)}`;
      await ctx.reply(msg);
    } finally {
      await streamer.flushNow();
      streamer.dispose();
      unsubscribe();
      cs.context.isProcessing = false;
      cs.lastActivityAt = Date.now();
    }
  });

  // Photo / document with images
  bot.on(["photo", "document"], async (ctx) => {
    log.debug("attachment received from chat", ctx.chat.id);
    await ctx.reply("📎 I see the attachment. Describe what you want me to do with it.");
  });

  return bot;
}

function handleEvent(
  event: AgentSessionEvent,
  streamer: TelegramStreamer,
  cs: import("./types.js").ChatSession,
  ctx: Context
): void {
  switch (event.type) {
    case "agent_start": {
      log.debug("agent_start for chat", cs.chatId);
      break;
    }

    case "message_update": {
      const e = event.assistantMessageEvent;
      if (e.type === "text_delta") {
        streamer.append(e.delta);
      } else if (e.type === "thinking_delta") {
        streamer.appendThinking(e.delta);
        log.debug("thinking_delta", e.delta.slice(0, 50), "... for chat", cs.chatId);
      }
      break;
    }

    case "tool_execution_start": {
      log.debug("tool start:", event.toolName, "for chat", cs.chatId);
      void streamer.setTool(event.toolName);
      break;
    }

    case "tool_execution_end": {
      log.debug("tool end:", event.toolName, event.isError ? "error" : "ok", "for chat", cs.chatId);
      void streamer.endTool(!event.isError);
      break;
    }

    case "agent_end": {
      log.debug("agent_end for chat", cs.chatId);
      break;
    }

    case "auto_retry_start": {
      log.warn("auto_retry_start for chat", cs.chatId);
      void ctx.reply("🔁 Auto-retrying after error...");
      break;
    }

    case "compaction_start": {
      log.info("compaction_start for chat", cs.chatId);
      void ctx.reply("🗜️ Compacting session history...");
      break;
    }

    case "compaction_end": {
      log.info("compaction_end for chat", cs.chatId);
      void ctx.reply("✅ Compaction done.");
      break;
    }

    default:
      break;
  }
}
