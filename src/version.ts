import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as log from "./log.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const CURRENT_VERSION: string = JSON.parse(
  readFileSync(resolve(__dirname, "../package.json"), "utf-8")
).version;

interface NpmView {
  "dist-tags"?: { latest?: string };
}

export async function fetchLatestVersion(): Promise<string | undefined> {
  try {
    log.debug("checking npm registry for updates...");
    const res = await fetch("https://registry.npmjs.org/lightagent", {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      log.debug("npm registry returned", res.status);
      return undefined;
    }
    const data = (await res.json()) as NpmView;
    return data["dist-tags"]?.latest;
  } catch (err: any) {
    log.debug("failed to check npm registry:", err.message ?? String(err));
    return undefined;
  }
}

export function isBehind(current: string, latest: string): boolean {
  const c = current.split(".").map(Number);
  const l = latest.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((l[i] ?? 0) > (c[i] ?? 0)) return true;
    if ((l[i] ?? 0) < (c[i] ?? 0)) return false;
  }
  return false;
}

export async function checkForUpdates(): Promise<
  { latest: string; current: string } | undefined
> {
  const latest = await fetchLatestVersion();
  if (!latest) return undefined;
  if (isBehind(CURRENT_VERSION, latest)) {
    return { latest, current: CURRENT_VERSION };
  }
  log.debug("running latest version:", CURRENT_VERSION);
  return undefined;
}
