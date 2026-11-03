# Deployment — `bots.cofferdam.xyz`

The founder's list for joint 3 of the agentic loop (workspace
`docs/runbooks/agentic-loop-completion.md` §3, §4, §8), and the record of every
deployment. Do the steps in order; each says who does it. No value below is a
secret: secrets go only through the commands in step 6, typed or piped in your
own terminal, never in this file, a chat or a command argument.

## What gets deployed

| | |
|---|---|
| Worker | `coworkers` in the Cofferdam Inc. account (from the workspace `.envrc`; no account id in this repository) |
| Host | `bots.cofferdam.xyz`, a Workers custom domain; no `workers.dev` hostname, no preview URLs |
| Upstream pin | `fayazara/coworkers@40e1a9fcb923b5182248e907648383ca0273ec53` (2026-11-02) |
| Durable Objects | `UserHub`, `BotAgent`, `AppLive`, `OAuthStore`, `EmailDirectory` (SQLite), created by `cf deploy` from the Worker's exports |
| Other bindings | `AI` (Workers AI and AI Gateway), `BROWSER` (Browser Run), `LOADER` (Dynamic Workers), `SEND_EMAIL` (unused: email is off) |
| Models | Claude through the bots' own AI Gateway, `cofferdam-coworkers`: `anthropic/claude-sonnet-5.5` for conversations, `anthropic/claude-haiku-5.5` for routines, check-ins and webhooks; no Workers AI fallback |
| Email | off (`EMAIL_DOMAIN` empty) until OD-15 is ruled |
| Deploy | `scripts/cofferdam-deploy.ts`, upstream's `cf deploy` under the workspace `.envrc`, from the Mac only |

## 1. AI Gateway `cofferdam-coworkers` — created 2026-11-03; the key and the limits are the founder's

The bots have a gateway of their own, `cofferdam-coworkers`, apart from
`default` (Lockkeeper and the OS) and the plane's `cofferdam-strict` and
`cofferdam-documents`, so their spend, logs and limits are read on their own.
Created 2026-11-03 through the REST API
(`POST /accounts/{account}/ai-gateway/gateways`, with the workspace's AI
Gateway token; Wrangler has no AI Gateway command) with authentication on,
logs on, no cache, no rate limit and **Require provider credentials** on
(`byok_only`), so a missing key fails instead of drawing on Unified Billing
credits. The Worker's `AI` binding satisfies the gateway's authentication; no
gateway token is issued. Logs are on for upstream's per-bot Spend page and the
Ops bot; each bot's calls carry the metadata `bot`, `botId` and `turn` (`chat`
or `background`).

Cloudflare dashboard → AI → AI Gateway → `cofferdam-coworkers`:

1. **Provider Keys → Add API Key → Anthropic**: the Console key, alias `default`
   (the alias the `AI` binding consults; it is not the gateway's name). This is
   where "the Anthropic key the gateway fronts" goes. The Worker calls Claude
   through its `AI` binding and the gateway adds the key, so a Worker secret
   holding it would never be read; the plan's §3 listed it with the
   `wrangler secret put` commands, and this step replaces that one.
2. **Settings → Spend limits**, before the first routine runs (the budget per
   bot of §3; each bot is one `botId`, there are no per-bot gateway tokens):
   - rule 1: metadata `botId`, **Split by value**, $8 over a **sliding** 24
     hours (each bot its own bucket; about one long Sonnet conversation hour).
     Sliding, because the bots run at every hour and a fixed day would let a
     runaway routine spend $8 before midnight UTC and $8 again after it; a bot
     blocked at 429 recovers as old spend rolls off.
   - rule 2: no dimension, $250 over a **fixed** calendar month (the whole
     deployment). Fixed, because the Anthropic Console invoices and the
     Billing Monitor reports by calendar month, so the figure and its reset
     date match theirs.
   Raise them when the Billing Monitor shows the need. A limit reached answers
   429: the bot says the model failed; nothing falls back to another model.
   Enforcement is eventually consistent (a burst of concurrent calls can
   overshoot briefly) and the cost is an estimate from token counts and list
   prices; the Console is the record of what was billed.

## 2. Cloudflare Access — created 2026-11-03 through the REST API

**Done 2026-11-03** with the founder's `CLOUDFLARE_ACCESS_API_TOKEN` (Access:
Apps and Policies Write, Organizations Read, Service Tokens Write; whole
account): reusable policies `coworkers: people` (allow, the founder's email,
`01c12634…`) and `coworkers: links` (bypass, everyone, `08da8ead…`);
applications `coworkers` (`6f498b5c…`, 720h) and `coworkers: links`
(`2cd40e0d…`, the nine paths below, not in the App Launcher). One departure
from the text below: `coworkers` is pinned to the OS's Google Workspace
identity provider with auto-redirect, as `cofferdam-os` is, so the sign-in
goes straight to Google. The AUD tag and team domain are in
`coworkers.deploy.json` (step 4), written the same day; the file still lacks
`githubAppId` until step 3. The rest of this section is the record of what was
asked for.

Two self-hosted applications, both with public hostname destinations (a Worker
destination refuses WebSocket upgrades, and the bots talk over WebSockets).

The workspace deploy token cannot write them (tried 2026-11-03:
`POST /accounts/{account}/access/policies` answers `auth.forbidden`). A session
can create both through the REST API, as upstream's installer does through the
`cf` CLI, with an API token scoped to the Cofferdam account that holds
**Access: Apps and Policies — Edit** and **Access: Organizations, Identity
Providers, and Groups — Read** (add **Access: Service Tokens — Edit** for step
5), exported in the workspace `.envrc` as `CLOUDFLARE_ACCESS_API_TOKEN`; two
reusable policies (`coworkers: people`, allow, the founder's email;
`coworkers: links`, bypass, everyone), then the two applications below with
`policies: [<id>]`, the AUD tag read from the create response. Delete or keep
the token afterwards as you prefer; it never enters a repository.

**`coworkers`** — the site.
- Destination: `bots.cofferdam.xyz`, no path.
- Policy: Allow, include Emails: your Cofferdam identity (the Google Workspace
  login the OS uses). Nobody else.
- Session duration: **1 month** (720 hours, the maximum).
- `/oauth/authorize`, the consent page an outside agent's sign-in lands on, stays
  behind this application: it is not in the list below.
- After saving, copy its **Application Audience (AUD) Tag** and the team domain
  (`<team>.cloudflareaccess.com`, Zero Trust → Settings) for step 4 (done: both
  are in the deploy file).

**`coworkers: links`** — what carries its own token, exactly as upstream's
installer lists it (`scripts/setup.ts`, `BYPASS_PATHS`).
- Destinations, one per path on `bots.cofferdam.xyz`:
  - `/api/hooks` — webhooks (a token per bot in the URL)
  - `/mcp` — the MCP server outside agents call (OAuth bearer tokens)
  - `/oauth/token`, `/oauth/register` — the OAuth server's token and client registration endpoints
  - `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource` — OAuth discovery
  - `/manifest.json`, `/sw.js`, `/icons` — the install files (no secrets; a phone fetches them without the Access cookie, and "Add to Home Screen" fails without them)
- Policy: Bypass, include Everyone.
- Left out on purpose: `/apps`, the share links for small web apps a bot builds.
  Behind Access they open for you only, which is what joint 3 needs; add the
  path when a shared link is wanted.

The Worker checks the Access token itself on every request (`ACCESS_AUD`), so it
answers 401 even if Access is switched off by mistake.

## 3. The Engineering bot's GitHub App — founder, GitHub

github.com → `cofferdamxyz` organisation → Settings → Developer settings →
GitHub Apps → New GitHub App.

- **Name:** `Cofferdam Engineering Bot` (its slug, `cofferdam-engineering-bot`,
  names the bot in every issue and comment it writes).
- **Homepage URL:** `https://bots.cofferdam.xyz`
- **Webhook:** untick **Active** for joint 3: the bot reads on its daily
  routine and when you ask. To wake it on events later, tick Active and use the
  bot's own hook URL, `https://bots.cofferdam.xyz/api/hooks/<user>/<bot>/<token>?source=github`,
  copied from the bot's settings (Reach this bot); the token in it is a
  credential, so it goes only into this field. Events then: Issue comment.
- **Repository permissions:** Issues **Read and write**; Metadata Read-only (GitHub
  requires it). Nothing else: no contents, no pull requests, no workflows, no
  organisation or account permissions. Optional and your call: Contents
  **Read-only** lets the bot read `TODO.md` (its `read_backlog` tool); it also
  lets it read every file of the workspace repository. Without it the backlog
  is the lane issues.
- **Where can this GitHub App be installed:** Only on this account.
- Create, note the **App ID** (step 4), then **Generate a private key**: a
  `.pem` file lands in your Downloads; it goes to the Worker in step 6 and is
  deleted after (keep a copy only in the vault of decision 0054).
- **Install App** → `cofferdamxyz` → Only select repositories → `cofferdam`.

The Worker narrows every token it mints to the `cofferdam` repository and the
permission the call needs, and the code refuses any other repository, so a
wider installation would still not widen what the bot does.

## 4. The deploy file — founder, on the Mac (written 2026-11-03 but for `githubAppId`)

`coworkers.deploy.json` in this folder (ignored by git; upstream's file, read by
`cloudflare.config.ts`). No account id: the deploy reads it from the `.envrc`.

```json
{
  "name": "coworkers",
  "gateway": "cofferdam-coworkers",
  "accessTeamDomain": "<team>.cloudflareaccess.com",
  "accessAud": "<the coworkers application's AUD tag>",
  "cofferdamOwner": "<your Cofferdam email, the one Access admits>",
  "githubAppId": "<the App ID from step 3>"
}
```

`cofferdamOwner` is whose hub gets the Engineering bot, created once on the
first sign-in.

## 5. The Lockkeeper service token — founder, Zero Trust dashboard

Access → Service credentials → Service Tokens → Create: name
`coworkers-engineering`, duration one year. Then open the Lockkeeper Access
application (`lockkeeper.cofferdam.xyz`) and add the token to its Service Auth
policy, beside the workspace's own token. A separate token can be revoked
alone, and only the Engineering bot holds it. Keep the dashboard tab open: its
Client ID and Client Secret go into step 6, and the secret is shown once.

## 6. Secrets — founder, in your own terminal

Each command prompts for its value (or reads the piped file); nothing is echoed.
The first one asks whether to create the Worker `coworkers`: answer yes, it is a
placeholder until the deploy.

```bash
cd /Users/hoff/Development/Cofferdam/coworkers
```

Generate the Web Push key pair once (it prints a public and a private key; new
keys later break every phone's subscription):

```bash
pnpm exec web-push generate-vapid-keys
```

```bash
direnv exec .. pnpm dlx wrangler@4.95.0 secret put VAPID_PUBLIC_KEY --name coworkers
```

```bash
direnv exec .. pnpm dlx wrangler@4.95.0 secret put VAPID_PRIVATE_KEY --name coworkers
```

The GitHub App's private key, from the file GitHub downloaded:

```bash
direnv exec .. pnpm dlx wrangler@4.95.0 secret put GITHUB_APP_PRIVATE_KEY --name coworkers < ~/Downloads/cofferdam-engineering-bot.*.private-key.pem
```

```bash
rm ~/Downloads/cofferdam-engineering-bot.*.private-key.pem
```

The Lockkeeper service token, both halves:

```bash
direnv exec .. pnpm dlx wrangler@4.95.0 secret put LOCKKEEPER_ACCESS_CLIENT_ID --name coworkers
```

```bash
direnv exec .. pnpm dlx wrangler@4.95.0 secret put LOCKKEEPER_ACCESS_CLIENT_SECRET --name coworkers
```

Optional, for the per-bot Spend page (an API token with **AI Gateway Read** on
the Cofferdam account only):

```bash
direnv exec .. pnpm dlx wrangler@4.95.0 secret put AI_GATEWAY_API_TOKEN --name coworkers
```

Check the names (never the values):

```bash
direnv exec .. pnpm dlx wrangler@4.95.0 secret list --name coworkers
```

Not set, on purpose: `BROWSER_RUN_API_TOKEN` (the crawl tool, later if wanted)
and `EMAIL_ROUTING_API_TOKEN` (email is off). The deploy sends those two empty.

## 7. Deploy — a session, after you say "deploy"

From this folder on the Mac:

```bash
direnv exec .. node scripts/cofferdam-deploy.ts --dry-run
```

```bash
direnv exec .. node scripts/cofferdam-deploy.ts
```

The script refuses while the deploy file lacks Access, the owner or the App ID,
or while a required secret is missing, and prints which. It lists secret names
only, and always deploys with a secrets file holding no value: `cf deploy`
keeps the Worker's secrets only when it is given one, so a bare
`pnpm run deploy` would drop every secret of step 6. If the custom domain step fails for the token's permissions, add it in the
dashboard (Workers → `coworkers` → Settings → Domains & Routes → Custom domain
`bots.cofferdam.xyz`) and deploy again. The session records the version id below.

## 8. The phone — founder

1. Open `https://bots.cofferdam.xyz` in Safari (iPhone) or Chrome (Pixel), pass
   Access with your Cofferdam login.
2. Share → **Add to Home Screen** (Chrome: Install app). On iOS, Web Push works
   only from the installed app.
3. Open it from the home screen and allow notifications when it asks.
4. The **Engineering** bot is in the list. Ask it "what is in flight?": it should
   answer from Lockkeeper's `in_flight` without an approval card (reads run;
   writes ask).

Joint 3 is done when the site is installed, a push arrives (an approval card
left unanswered sends a reminder after four hours; "Run a check-in now" in the
bot's settings is quicker) and the Engineering bot answers "what is in flight"
from Lockkeeper.

## 9. The fork's repository settings — founder, GitHub

- Settings → Code security: **Dependabot alerts** and **Dependabot security
  updates** on (GitHub leaves both off on a fork). `.github/dependabot.yml`
  groups them; version updates are off for the reason it gives.
- Actions are enabled on the fork (checked 2026-11-02); CI runs on every push to
  `main` and every pull request.

## The Engineering bot

Created by code (`src/cofferdam/engineering.ts`) in the owner's hub on the first
sign-in, never by hand:

- **Reads:** Lockkeeper `brief`, `in_flight`, `check`; issues of `cofferdamxyz/cofferdam`
  (list, read with comments, search); `TODO.md` if the App has Contents
  Read-only.
- **Writes, each on an approval card, never in a background turn:** file an issue
  with a lane label; comment; add labels. `dispatch` only on an issue with a
  lane label, a named repository and a Mandate block, at most two dispatched
  issues in flight and one per repository; never `dispatched`, `blocked` or
  `waiting`. All of it enforced in code, whatever its settings say.
- **Never:** a shell, scripts, the browser, email, managing other bots, any
  repository's source, any write outside the workspace repository.
- **Routine:** "Daily engineering check-in", weekdays 08:30 São Paulo, read-only.
- **Prompt:** upstream's, then the turn's context, then the Cofferdam policy
  section last, regenerated from code every turn.
- The GitHub and Lockkeeper connections are the deployment's, listed only to
  this bot. Do not add GitHub or Lockkeeper again under Connections: a
  connection added there is shared by every bot.

## Deployments

| Date | Commit | Version id | Notes |
|---|---|---|---|
| — | — | — | Not deployed yet. Dry run passed 2026-11-02 from the Mac (`cf deploy --prebuilt --dry-run`, the workspace `.envrc` loaded); waits on steps 1 to 6. |
