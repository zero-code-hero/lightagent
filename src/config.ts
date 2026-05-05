import dotenv from "dotenv";
import { homedir } from "node:os";
import { resolve } from "node:path";

dotenv.config();

function expandTilde(p: string): string {
  if (p.startsWith("~/")) return resolve(homedir(), p.slice(2));
  if (p === "~") return homedir();
  return p;
}

function getEnv(key: string, fallback?: string): string {
  const val = process.env[key] ?? fallback;
  if (val === undefined) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return val;
}

function parseIds(raw?: string): Set<number> {
  if (!raw || raw.trim() === "") return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number)
      .filter((n) => !Number.isNaN(n))
  );
}

export const config = {
  telegramBotToken: getEnv("TELEGRAM_BOT_TOKEN"),
  allowedUserIds: parseIds(process.env.ALLOWED_USER_IDS),
  agentCwd: resolve(expandTilde(process.env.AGENT_CWD ?? "~/.lightagent/workspace")),
  agentDir: resolve(expandTilde(process.env.AGENT_DIR ?? "~/.pi/agent")),
  telegramEditIntervalMs: 800,
  telegramMaxMessageLength: 4000,
  sessionIdleTimeoutMs: Number(process.env.SESSION_IDLE_TIMEOUT_MS ?? "0"),
  noUpdateCheck: process.env.LIGHTAGENT_NO_UPDATE_CHECK === "1" || process.env.LIGHTAGENT_NO_UPDATE_CHECK === "true",
  debug: process.env.LIGHTAGENT_DEBUG === "1" || process.env.LIGHTAGENT_DEBUG === "true" || process.env.DEBUG === "lightagent",
} as const;

export function isUserAllowed(userId: number): boolean {
  if (config.allowedUserIds.size === 0) return false;
  return config.allowedUserIds.has(userId);
}

export function validateUsers(): void {
  if (config.allowedUserIds.size === 0) {
    throw new Error(
      "ALLOWED_USER_IDS is empty. set it to your telegram user id(s) or the bot refuses to start."
    );
  }
}
