#!/usr/bin/env node
import { spawn } from "node:child_process";
import { PiSessionManager } from "./session-manager.js";
import { createBot } from "./bot.js";
import { config, validateUsers } from "./config.js";
import { CURRENT_VERSION, checkForUpdates } from "./version.js";
import * as log from "./log.js";

const args = process.argv.slice(2);

if (args.includes("--setup")) {
  const { runSetup } = await import("./setup.js");
  await runSetup();
  process.exit(0);
}

if (args.includes("--version") || args.includes("-v")) {
  console.log(CURRENT_VERSION);
  process.exit(0);
}

if (args.includes("--update")) {
  log.info("updating from", CURRENT_VERSION, "...");
  const child = spawn("npm", ["install", "-g", "lightagent"], {
    stdio: "inherit",
    shell: true,
  });
  child.on("exit", (code) => {
    if (code === 0) {
      log.info("updated. restart to use the new version.");
    } else {
      log.error("update failed.");
    }
    process.exit(code ?? 1);
  });
  throw new Error("unreachable");
}

if (args.includes("--help") || args.includes("-h")) {
  console.log(`lightagent ${CURRENT_VERSION}

telegram bot wrapping the pi coding agent loop.

usage:
  lightagent                          start the bot
  lightagent --setup                  install systemd service and create dirs
  lightagent --version, -v            show version
  lightagent --update                 self-update via npm
  lightagent --help, -h               show this

env:
  TELEGRAM_BOT_TOKEN         required. bot token from @BotFather
  ALLOWED_USER_IDS           comma-separated telegram user ids
  AGENT_CWD                  ~/.lightagent/workspace
  AGENT_DIR                  ~/.pi/agent
  LIGHTAGENT_NO_UPDATE_CHECK 1 to skip version check on startup
  LIGHTAGENT_DEBUG           1 to enable debug logging
  DEBUG                      set to "lightagent" to enable debug logging
`);
  process.exit(0);
}

async function main() {
  validateUsers();

  log.info(CURRENT_VERSION, "starting...");
  log.info("cwd:", config.agentCwd);
  log.info("agentDir:", config.agentDir);
  log.debug("debug logging enabled");
  log.debug("allowed users:", [...config.allowedUserIds]);

  // Check for updates
  if (!config.noUpdateCheck && !args.includes("--no-update-check")) {
    const update = await checkForUpdates();
    if (update) {
      log.warn("update available:", `${update.current} → ${update.latest}`);
      log.warn("run  lightagent --update  to install");
    } else {
      log.debug("no update available");
    }
  } else {
    log.debug("update check skipped");
  }

  const sessionManager = new PiSessionManager();
  const bot = createBot(sessionManager);

  const stop = async () => {
    log.info("shutting down...");
    sessionManager.disposeAll();
    await bot.stop();
    process.exit(0);
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  if (config.sessionIdleTimeoutMs > 0) {
    setInterval(() => sessionManager.gc(), 60_000);
  }

  await bot.launch();
  log.info("bot polling started");
}

main().catch((err) => {
  log.error("fatal:", err);
  process.exit(1);
});
