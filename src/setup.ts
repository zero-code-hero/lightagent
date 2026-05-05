import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import * as log from "./log.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SERVICE_PATH = "/etc/systemd/system/lightagent.service";
const LIGHTAGENT_DIR = resolve(homedir(), ".lightagent");
const ENV_PATH = resolve(LIGHTAGENT_DIR, ".env");
const WORKSPACE_PATH = resolve(LIGHTAGENT_DIR, "workspace");

function which(cmd: string): string | undefined {
  const result = spawnSync("which", [cmd], { encoding: "utf-8", shell: true });
  if (result.status === 0) {
    return result.stdout.trim();
  }
  return undefined;
}

function hasSudo(): boolean {
  const result = spawnSync("sudo", ["-n", "true"], { encoding: "utf-8", shell: false });
  return result.status === 0;
}

function sudoRun(args: string[]): boolean {
  log.info("running: sudo", args.join(" "));
  const result = spawnSync("sudo", args, { stdio: "inherit", shell: false });
  return result.status === 0;
}

function generateServiceFile(npxPath: string, user: string, home: string): string {
  return `[Unit]
Description=lightagent - Telegram bot wrapping pi coding agent
After=network.target

[Service]
Type=simple
User=${user}
Group=${user}
WorkingDirectory=${home}/.lightagent
ExecStart=${npxPath} lightagent
Restart=on-failure
RestartSec=5
Environment="NODE_ENV=production"

[Install]
WantedBy=multi-user.target
`;
}

export async function runSetup(): Promise<void> {
  log.info("setting up lightagent...");

  // 1. Ensure ~/.lightagent exists
  if (!existsSync(LIGHTAGENT_DIR)) {
    mkdirSync(LIGHTAGENT_DIR, { recursive: true });
    log.info("created", LIGHTAGENT_DIR);
  }

  // 2. Ensure workspace exists
  if (!existsSync(WORKSPACE_PATH)) {
    mkdirSync(WORKSPACE_PATH, { recursive: true });
    log.info("created", WORKSPACE_PATH);
  }

  // 3. Copy .env.example if .env doesn't exist
  if (!existsSync(ENV_PATH)) {
    const examplePath = resolve(__dirname, "../.env.example");
    if (existsSync(examplePath)) {
      copyFileSync(examplePath, ENV_PATH);
      log.info("copied .env.example to", ENV_PATH);
      log.info("👉 edit", ENV_PATH, "and set TELEGRAM_BOT_TOKEN and ALLOWED_USER_IDS");
    } else {
      log.warn(".env.example not found at", examplePath);
    }
  } else {
    log.info(".env already exists at", ENV_PATH);
  }

  // 4. Find npx
  const npxPath = which("npx");
  if (!npxPath) {
    log.error("npx not found in PATH. install node first.");
    process.exit(1);
  }
  log.info("npx found at", npxPath);

  // 5. Generate service file
  const user = process.env.USER ?? "root";
  const serviceContent = generateServiceFile(npxPath, user, homedir());

  // Write to a temp file first (no sudo needed)
  const tmpService = resolve(LIGHTAGENT_DIR, "lightagent.service");
  writeFileSync(tmpService, serviceContent, { mode: 0o644 });
  log.info("generated service file at", tmpService);

  // 6. Install service (needs sudo)
  if (!hasSudo()) {
    log.warn("sudo not available or not cached. manual steps required:");
    console.log("");
    console.log("  sudo cp", tmpService, SERVICE_PATH);
    console.log("  sudo systemctl daemon-reload");
    console.log("  sudo systemctl enable lightagent.service");
    console.log("  sudo systemctl start lightagent.service");
    console.log("");
    console.log("  # check status:");
    console.log("  sudo systemctl status lightagent.service");
    console.log("  sudo journalctl -u lightagent.service -f");
    console.log("");
    process.exit(0);
  }

  log.info("installing systemd service (needs sudo)...");

  if (!sudoRun(["cp", tmpService, SERVICE_PATH])) {
    log.error("failed to copy service file. run manually:");
    console.log("  sudo cp", tmpService, SERVICE_PATH);
    process.exit(1);
  }

  if (!sudoRun(["systemctl", "daemon-reload"])) {
    log.error("systemctl daemon-reload failed");
    process.exit(1);
  }

  if (!sudoRun(["systemctl", "enable", "lightagent.service"])) {
    log.error("systemctl enable failed");
    process.exit(1);
  }

  if (!sudoRun(["systemctl", "start", "lightagent.service"])) {
    log.error("systemctl start failed");
    process.exit(1);
  }

  log.info("✅ lightagent service installed and started");
  console.log("");
  console.log("  # check status:");
  console.log("  sudo systemctl status lightagent.service");
  console.log("  sudo journalctl -u lightagent.service -f");
  console.log("");

  // Check if .env is still unconfigured
  if (existsSync(ENV_PATH)) {
    const envContent = readFileSync(ENV_PATH, "utf-8");
    if (envContent.includes("your_bot_token_here") || !envContent.includes("TELEGRAM_BOT_TOKEN=")) {
      log.warn("👉 remember to edit", ENV_PATH, "and set your real TELEGRAM_BOT_TOKEN");
    }
  }
}
