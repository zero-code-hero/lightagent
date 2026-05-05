import { config } from "./config.js";

export function debug(...args: unknown[]): void {
  if (config.debug) {
    console.log("[debug]", ...args);
  }
}

export function info(...args: unknown[]): void {
  console.log("[lightagent]", ...args);
}

export function warn(...args: unknown[]): void {
  console.warn("[lightagent] warn:", ...args);
}

export function error(...args: unknown[]): void {
  console.error("[lightagent] error:", ...args);
}
