# lightagent

> a telegram bot wrapping the pi coding agent loop. runs ollama by default. deployed on whatever box you own.

## why should you use this?

you should not. go away.

if you insist: it gives you a persistent coding agent accessible from your phone, laptop, or that weird tablet you bought on aliexpress. each chat gets its own session with full filesystem + shell access on the host machine.

## requirements

- a server/vps/raspberry pi/old laptop you control
- node 22+
- an ollama instance somewhere (localhost or remote)
- a telegram bot token from @BotFather
- `ALLOWED_USER_IDS` set or you will get owned

## install

### global (recommended)

```bash
npm install -g @mariozechner/pi-coding-agent  # peer dependency
npm install -g lightagent

mkdir -p ~/.lightagent/workspace

cp $(npm root -g)/lightagent/.env.example ~/.lightagent/.env
# edit ~/.lightagent/.env

cd ~/.lightagent && lightagent
```

### update

```bash
lightagent --update   # self-update via npm
```

### local clone

```bash
git clone <this repo>
cd lightagent
npm install   # pi-coding-agent must be installed globally or linked
npm run build
cp .env.example .env
# edit .env
npm start
```

### npx (one-off)

```bash
npx lightagent   # after installing peer dep and setting env vars
```

## env

`.env` is loaded from the working directory. only `TELEGRAM_BOT_TOKEN` is required.

```
TELEGRAM_BOT_TOKEN=your_bot_token
ALLOWED_USER_IDS=123456789,987654321   # empty = not allowed. set it.

# where the bot works on the filesystem (files get created/edited here)
AGENT_CWD=~/.lightagent/workspace

# pi config dir — holds auth.json, models.json, sessions
# defaults to ~/.pi/agent so auth and models are shared with the pi cli
# AGENT_DIR=~/.pi/agent

# skip update check on startup
# LIGHTAGENT_NO_UPDATE_CHECK=1

# enable debug logging
# LIGHTAGENT_DEBUG=1
```

lightagent does not manage its own auth or model registry. it piggybacks on `~/.pi/agent` — the same directory the `pi` cli uses. configure your models and api keys there (or via `pi --login`) and the bot inherits them immediately.

if you want isolation, override `AGENT_DIR` in `.env`.

## system prompt

lightagent does not override pi's system prompt. pi's default prompt is already tuned for coding agents — tool usage patterns, file editing conventions, bash safety, etc. replacing it would break all of that.

if you want custom behavior, use pi's native mechanisms:
- `.pi/prompts/` files in your working directory
- `AGENTS.md` context files
- `pi --login` and per-provider configuration

lightagent stays a thin wrapper. it doesn't pretend to be smarter than the agent it's wrapping.

## commands

| command | what it does |
|---------|--------------|
| `/start` | welcome blurb |
| `/new` | wipe session, fresh context |
| `/status` | session id, model, message count |
| `/abort` | kill the current run |

## cli flags

| flag | what it does |
|------|--------------|
| `lightagent --setup` | install systemd service, create dirs, copy .env |
| `lightagent --version, -v` | show version |
| `lightagent --update` | self-update via npm |
| `lightagent --no-update-check` | skip version check this run |
| `lightagent --help, -h` | show help |

## how it works

- each telegram chat = one `AgentSession`
- messages stream back live (buffered to respect telegram rate limits)
- tool calls show status (`🔧 read...` → `✅ done`) then assistant text resumes
- if the agent is already running, your message queues as a **steer**

## deps & auditability

- **runtime deps:** `telegraf` + `dotenv`. that's it.
- **peer dep:** `@mariozechner/pi-coding-agent` (already installed globally if you use pi)
- **total source:** ~300 lines across 7 files. you can read the whole thing in one sitting.
- **no build tools at runtime:** typescript compiles to plain node esm. no bundlers, no transpilers, no magic.
- **easy to audit:** small surface area, no hidden network calls outside telegram + your configured llm endpoint, no telemetry, no phoning home.

## security

- `ALLOWED_USER_IDS` is the only gate. set it.
- the agent runs shell commands as the user that started it. it can `rm -rf /` if you ask nicely.
- no sandbox. no container. bare metal.

## extending

want images? download + base64 encode + pass to `session.prompt(..., { images: [...] })`. not hard.
want another model? point `OLLAMA_BASE_URL` at any openai-compatible endpoint (vllm, lm studio, tabbyapi, etc).
want to swap the whole framework out? fork it. it's like 300 lines.

## changelog

see [CHANGELOG.md](./CHANGELOG.md) or `npm version` tags.

## publishing

### one-time setup

1. create an npm account at https://www.npmjs.com
2. create an automation token at https://www.npmjs.com/settings/tokens (type: **automation**)
3. in your github repo: **settings → secrets and variables → actions → new repository secret**
   - name: `NPM_TOKEN`
   - value: your automation token

### publish a new version

```bash
npm version patch   # or minor / major
# this bumps version, creates a git tag, and commits
git push origin main --tags
```

then go to github → releases → **draft a new release** from the tag you just pushed. hit **publish release**.

the github action (`publish.yml`) will:
- install deps
- typecheck
- build
- publish to npm

### manual publish (if you hate automation)

```bash
npm login
npm version patch
npm run build
npm publish
```

## running as a service

```bash
lightagent --setup
```

this creates `~/.lightagent/`, copies `.env.example`, generates a systemd service file, and tries to enable/start it via sudo. if sudo isn't available, it prints the manual commands.

after setup, edit `~/.lightagent/.env` with your bot token, then:

```bash
sudo systemctl restart lightagent.service
```

check logs:
```bash
sudo journalctl -u lightagent.service -f
```

### manual service setup

if you prefer doing it yourself, the template is `lightagent.service.template`:

```bash
sudo cp lightagent.service.template /etc/systemd/system/lightagent.service
# edit if needed
sudo systemctl daemon-reload
sudo systemctl enable lightagent.service
sudo systemctl start lightagent.service
```

## license

whatever pi's license is. this is a wrapper, not a product.
