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
  - `/manifest.webmanifest`, `/sw.js`, `/icons` — the install files (no secrets; a phone fetches them without the Access cookie, and "Add to Home Screen" fails without them). Upstream renamed `/manifest.json` (fayazara/coworkers#18). **Done 2026-11-04** by the founder in the dashboard: `/manifest.webmanifest` added (it answers 200 `application/manifest+json` without the Access cookie). The old `/manifest.json` destination was deleted the same day (checked: it now redirects to the Access sign-in). The manifest link also sends the Access cookie (`crossOrigin: use-credentials`), so installs work either way.
- Policy: Bypass, include Everyone.
- Left out on purpose: `/apps`, the share links for small web apps a bot builds.
  Behind Access they open for you only, which is what joint 3 needs; add the
  path when a shared link is wanted.

The Worker checks the Access token itself on every request (`ACCESS_AUD`), so it
answers 401 even if Access is switched off by mistake.

## 3. The Engineering bot's GitHub App — done 2026-11-03

**Done 2026-11-03** by the founder in the dashboard: App `Cofferdam Engineering Bot`
(slug `cofferdam-engineering-bot`, App ID 5602071), Issues read and write,
Metadata read, webhook inactive, installed on `cofferdam` only (checked through
`GET /orgs/cofferdamxyz/installations`); the private key is on the Worker as
`GITHUB_APP_PRIVATE_KEY`; the logo is `cofferdam-branding/assets/github/bot-engineering-idle-transparent.png`
on badge colour `0b1124`. The text below is the record of what was asked for.

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

## 4. The deploy file — done 2026-11-03

**Done:** `coworkers.deploy.json` holds all six fields (App ID added 2026-11-03).

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

## 5. The Lockkeeper service token — done 2026-11-03

**Done 2026-11-03:** the founder ran the script below; service token
`coworkers-engineering` (`06ac2eab…`, expires 2027-11-03) exists and both
halves are on the Worker; the reusable policy `Lockkeeper Access from the
Engineering bot` (`c4149d6f…`, Service Auth) is attached to the `lockkeeper`
application as its third policy, beside the founder's email and the
workspace's `lockkeeper-claude-code` token. The VAPID pair is on the Worker
too, so step 6 has only the GitHub App key left. Renew the token before
2027-11-03 by running the script again and swapping the policy's token id.

After the VAPID commands of step 6 (so the Worker exists), in your own terminal:

```bash
cd /Users/hoff/Development/Cofferdam/coworkers && direnv exec .. sh scripts/lockkeeper-service-token.sh
```

It creates the Access service token `coworkers-engineering` (one year) with
`CLOUDFLARE_ACCESS_API_TOKEN` and pipes its client id and client secret
straight into `wrangler secret put LOCKKEEPER_ACCESS_CLIENT_ID` and
`LOCKKEEPER_ACCESS_CLIENT_SECRET`; the secret is returned once and is never
printed. It ends by printing the token's **id**: give that to the session, which
adds a reusable policy `Lockkeeper Access from the Engineering bot`
(Service Auth, that token) to the Lockkeeper Access application
(`lockkeeper.cofferdam.xyz`), beside the workspace's own `Lockkeeper Access
from Claude Code`. A separate token and policy can be revoked alone, and only
the Engineering bot holds it. The dashboard route (Access → Service
credentials → Service Tokens → Create, then the application's policies) does
the same by hand; then the two `wrangler secret put` commands below take the
values.

## 6. Secrets — done 2026-11-03

**Done:** the Worker holds the five required secrets (`wrangler secret list`
2026-11-03): the VAPID pair, the GitHub App key, both halves of the Lockkeeper
token; `AI_GATEWAY_API_TOKEN` not set (optional). The commands below are the
record and the rotation path.

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
direnv exec ~/Development/Cofferdam pnpm dlx wrangler@4.95.0 secret put VAPID_PUBLIC_KEY --name coworkers
```

```bash
direnv exec ~/Development/Cofferdam pnpm dlx wrangler@4.95.0 secret put VAPID_PRIVATE_KEY --name coworkers
```

The GitHub App's private key, from the file GitHub downloaded:

```bash
direnv exec ~/Development/Cofferdam pnpm dlx wrangler@4.95.0 secret put GITHUB_APP_PRIVATE_KEY --name coworkers < ~/Downloads/cofferdam-engineering-bot.*.private-key.pem
```

```bash
rm ~/Downloads/cofferdam-engineering-bot.*.private-key.pem
```

The Lockkeeper service token, both halves (already put if the step 5 script ran):

```bash
direnv exec ~/Development/Cofferdam pnpm dlx wrangler@4.95.0 secret put LOCKKEEPER_ACCESS_CLIENT_ID --name coworkers
```

```bash
direnv exec ~/Development/Cofferdam pnpm dlx wrangler@4.95.0 secret put LOCKKEEPER_ACCESS_CLIENT_SECRET --name coworkers
```

Optional, for the per-bot Spend page (an API token with **AI Gateway Read** on
the Cofferdam account only):

```bash
direnv exec ~/Development/Cofferdam pnpm dlx wrangler@4.95.0 secret put AI_GATEWAY_API_TOKEN --name coworkers
```

Check the names (never the values):

```bash
direnv exec ~/Development/Cofferdam pnpm dlx wrangler@4.95.0 secret list --name coworkers
```

Not set, on purpose: `BROWSER_RUN_API_TOKEN` (the crawl tool, later if wanted)
and `EMAIL_ROUTING_API_TOKEN` (email is off). The deploy sends those two empty.

## 7. Deploy — first deployed 2026-11-03

**Record.** 2026-11-03, from the Mac, `scripts/cofferdam-deploy.ts`: version
`a52c10a1-a2f9-4bc2-93cf-fdd6c48c542b`, custom domain `bots.cofferdam.xyz`
(DNS live within a minute), gateway `cofferdam-coworkers`, the eight secrets
kept (five set, three sent empty). The gateway's Anthropic Provider Key and
spend limits were still unset at deploy time: the site opens, a bot's first
turn fails until step 1 is done.

Same evening, key and limits set: the first chat answered `Format conversion
failed: No compatible input messages found` (AI Gateway code 7003) while the
Models page's test passed. Replayed through the gateway: the conversion of a
chat-completions body into Anthropic's format fails whenever the first
non-system message is the assistant's, and every bot opens with its own
greeting. Fix in `src/agents/models.ts` (`userFirst`): a short user turn,
`(Chat opened.)`, in front of a history that opens with the bot. Versions:
`b2dd7376` (a diagnostic that logged each prompt's roles and part types,
never content), then `1b4448b4` with the fix. The deploy script's
optional-secrets file became JSON on the way (`cf` reads a key-less dotenv
file as invalid once every optional secret exists). Sent upstream as
fayazara/coworkers#21 (branch `fix/anthropic-user-first` off upstream `40e1a9f`,
the fix and its tests only): any Anthropic model on the gateway's unified path
hits it. Once it lands, the next upstream merge carries it and our copy goes.

**Deployed again 2026-11-03** as `a014d4fc` (the app icons) and `68e3c064` (the Engineering bot's `close_issue` tool: ask-first, refuses unless the issue is in `waiting`, its report names the pull request, and Lockkeeper shows it merged and out of flight; GitHub's public view of the pull request must agree when readable).

**Deployed 2026-11-04 01:20 UTC (2026-11-03 evening in São Paulo)** as `a87cb839` from `main` at `ddfb79f`: the
Security bot (471f6c4, step 10; its App, key and token not yet created, so its
two connections show failed) and the theme tokens and brand of
fayazara/coworkers#22 (`d641647`, `ddfb79f`). Tests 211 passed on that commit
before the deploy. `/manifest.webmanifest` answered with the Access
sign-in until the founder's path change in step 2, made the same night: checked
afterwards, it answers 200 `application/manifest+json` without the cookie;
`/sw.js` is public.

**Deployed 2026-11-04 02:07 UTC (2026-11-03 23:07 in São Paulo)** as
`abc5e93a` from `main` at `d588eb2`: the installed Android app's manifest
colours (`theme_color` and `background_color` both the brand's dark `web-bg`
`#0a0a0a`, so the splash and the system navigation bar are dark; standalone, so
the status bar stays; `9c9708c`, `d588eb2`) and the Security bot's Code Quality
tools, read only (`bb3fea6`). Tests 212 passed on that commit. The first attempt
failed with `fetch failed` after uploading the assets; the retry deployed.
Checked after: the live manifest carries the new colours, `/` still redirects to
Access. An installed app picks the colours up when Chrome refreshes it, or on a
reinstall.

**Redeployed 2026-11-04 02:09 UTC** as `c2d71868` from `main` at `149c2c7`: the
same code as `abc5e93a` (the commit since is this file only), by the Security
session, whose three tries before that failed with `fetch failed` on the
script upload while Cloudflare reported a partial outage (Curitiba degraded).

**Deployed 2026-11-04 18:23 UTC** as `7f77d094` from `main` at `8695bd9`: the
Ops bot's App, `Cofferdam Ops Bot` (slug `cofferdam-ops-bot`, App ID 5615846;
Contents read, Issues write, Metadata read, on selected repositories), its key
put as `OPS_GITHUB_APP_PRIVATE_KEY` at 18:20 (version `4d1d230e`). The first
`secret put` ran from the workspace root with a bare `..`, loaded no `.envrc`
and created a Worker named `coworkers` in the founder's personal account; the
founder deleted it the same minute and put the key again with the full path
(step 10.3). Checked after: `/` redirects to Access, the Worker holds its 12
secrets.

**Deployed 2026-11-04 18:08 UTC** as `32f5ba2f` from `main` at `ef51e3b`: the
Ops bot (step 11, The Ops bot). Tests 231 passed, typecheck clean, dry run
clean. `OPS_GITHUB_APP_ID` is still empty: the bot appears in the hub on the
next sign-in with its GitHub connection failed until steps 11.1–11.5. Checked
after: `/` redirects to Access.

**Deployed 2026-11-04** as `3e3e9ffd` from `main` at `5b609f7`: the daily
security triage lists the Dependabot pull requests that need `@dependabot
rebase`, and a preset routine changed in code now reaches the existing bot on
the next hub start (the Security triage had kept its first prompt; it takes
the current one when the founder next opens the site).

**Deployed 2026-11-04 15:39 UTC** as `c57ac86b` from `main` at `135a4f9`: the
Dependabot patch (Dependencies, below; 60 of 62 open alerts) with the brand
session's link accent (`29ad8d7`, `9b312f8`). Tests 223 passed on that commit.
The first try, on Node 25.7, failed with `fetch failed` on the script upload
after the assets went up (nothing went live); the retry on Node 24.19
deployed. Checked after: `/` redirects to Access,
`/manifest.webmanifest` and `/sw.js` answer 200.

**2026-11-04, the rebase tool removed:** with Pull requests write the bot's
comment posted on `lockkeeper#5` at 13:51:03 UTC as
`cofferdam-security-bot[bot]`, and Dependabot answered four seconds later
"Sorry, only users with push access can use that command." The tool and its
permission are out of the code; the policy tells the bot to ask the founder
for the comment. The founder sets the App's Pull requests back to Read-only. Deployed as
`022e5934` from `60a6491`.

**Deployed 2026-11-04** as `73f8fcc7` from `main` at `f4d2dac`: the rebase
comment's token carries Pull requests write (the first try on `lockkeeper#5`
answered 403 with Issues write alone).

**Deployed 2026-11-04** as `e03f1df3` from `main` at `9e66f8f`: the Security
bot's `request_dependabot_rebase` (the fixed `@dependabot rebase` on
Dependabot's own open pull requests, ask-first); first test on
`lockkeeper#5`. Two tries before it failed with `fetch failed` on the script
upload during Cloudflare's partial outage.

**Deployed 2026-11-04** as `1484ae4b` from `main` at `12d407b`: the Security
bot names the commit behind a fix the founder landed by hand, from
Lockkeeper's "Landed on" list.

**Deployed 2026-11-04** as `0c8301bf` from `main` at `0ed17d0`: a pull
request's comments read with Pull requests on the token too, so a private
repository's CI comment answers (cofferdam-pages#18 had answered 403). Two
tries the night before failed with `fetch failed` on the script upload.

**Deployed 2026-11-04** as `487be9c3` from `main` at `fa1ffe5`: the Security
bot's exact alert totals (every list paged), "not enabled" instead of a 403,
and its pull request reads (they answer once the installation accepts Pull
requests read). Tests 221 passed on that commit.

**Verified 2026-11-03 22:09 UTC:** the founder signed in through Google, the
hub created the Engineering bot on first sign-in, and "What is in flight?"
came back with Lockkeeper's branches, pull requests, the Dependabot queue and
the four daily issues. The gateway log shows the two Sonnet calls of that turn
with the metadata `bot=Engineering`, `botId=b9b03875`, `turn=chat`, about
25–30k input tokens each (the 65 tools and the policy) and $0.05–0.07 a call:
the $8-a-day bucket is roughly 120 chat calls. Not yet: the phone install, a
background routine, and Dependabot alerts on the fork.

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

**Done 2026-11-04:** Dependabot security updates on (`gh api -X PUT
repos/cofferdamxyz/coworkers/automated-security-fixes`), after the Security
bot found three critical alerts with no pull request: `@tanstack/react-start`
(direct, 1.168.60), `@tanstack/start-server-core` and `seroval` (transitive).
Patched the same day in the fork (Dependencies, below), deployed as
`c57ac86b`.

- Settings → Code security: **Dependabot alerts** and **Dependabot security
  updates** on (GitHub leaves both off on a fork). `.github/dependabot.yml`
  groups them; version updates are off for the reason it gives.
- Actions are enabled on the fork (checked 2026-11-02); CI runs on every push to
  `main` and every pull request.

## 10. Joint 5: the Security bot — founder, after the session's deploy

Built 2026-11-03 (`src/cofferdam/security.ts`, `security-tools.ts`,
`presets.ts`). The deploy that carries it creates the bot in your hub on the
next sign-in, with both of its connections marked **failed** until the steps
below are done; its rules and policy apply from the first turn. The order is
the deploy first, then these, because each `wrangler secret put` publishes a
version of whatever code is deployed.

**10.1 The GitHub App.** github.com → `cofferdamxyz` → Settings → Developer
settings → GitHub Apps → New GitHub App:

- **Name:** exactly `Cofferdam Security Bot`, so its slug is
  `cofferdam-security-bot` (the admission list in `src/cofferdam/config.ts`
  names `cofferdam-security-bot[bot]`).
- **Homepage URL:** `https://bots.cofferdam.xyz`. **Webhook:** untick Active.
- **Repository permissions:** Code scanning alerts **Read and write** (write is
  what `POST …/autofix` needs; it would also let an App dismiss an alert, which
  this Worker never calls), Dependabot alerts **Read-only**, Secret scanning
  alerts **Read-only**, Code quality **Read and write** (read is what the
  findings and setup reads need; write is the founder's choice of 2026-11-03,
  unused by any tool), Pull requests **Read-only** (added by the founder
  2026-11-03: a Dependabot pull request's advisories and CI result are read,
  not guessed from its branch; write was granted 2026-11-04 for a rebase
  request that Dependabot refused, see below, and goes back to read), Issues **Read and write** (the triage issue
  and the weekly summary; read on a product repository for a pull request's
  CI comment), Metadata Read-only. Nothing else: no contents, no pull
  requests, no workflows, no organisation permissions.
- **Where can this GitHub App be installed:** Only on this account. Create,
  note the **App ID**, **Generate a private key**.
- **Install App** → `cofferdamxyz` → Only select repositories → the eleven of
  `REPOSITORIES` (`cofferdam` for the issues, the other ten for their alerts).
  A GitHub App's permissions hold on every repository it is installed on, so
  Issues write is the ceiling everywhere; the Worker mints every token for one
  repository and one permission, and its issue tools reach `cofferdam` only, so
  an issue on a public product repository is refused in code.
- **Future additions, ruled 2026-11-03:** `self` (public fork of Self.xyz),
  `cofferdam-footage` (private), `cofferdam-prover` (public) and
  `enterprise-contracts` (private, the `base-contracts` submodule). Each one
  goes into `REPOSITORIES` in `src/cofferdam/config.ts` first, in a reviewed
  commit, and is deployed; then it is added to this installation. In that
  order, because the bot refuses a repository missing from the list, and the
  list is also what the bots ask Lockkeeper about, so Lockkeeper should watch
  the repository too. Not yet: a private repository answers secret scanning
  and code scanning only with GitHub's paid add-ons, and `self` is a fork whose
  alerts are mostly upstream's.
- Logo: after creating the App, its **Display information** → upload
  `cofferdam-branding/assets/github/bot-security-idle-transparent.png` (the
  steel hexagon head with Cerulean ears), **Badge background color** `0b1124`,
  as for the Engineering bot.

**Progress 2026-11-03:** the App exists, `Cofferdam Security Bot` (slug
`cofferdam-security-bot`, App ID 5604602), installed on selected repositories
of `cofferdamxyz`; its id is in `coworkers.deploy.json` and on the Worker since
version `36445372`. Its permissions as GitHub reports them: Code scanning
alerts write, Dependabot alerts read, Secret scanning alerts read, Issues
write, Metadata read, and **Code quality write**, added by the founder so the
bot reads Code Quality too: its findings and each repository's setup, through
three read tools on `code_quality: read` tokens (GitHub's public preview API,
version 2026-03-10). Write would also let a token change a repository's Code
Quality setup; no tool does, since that is repository configuration and the
founder's. **10.3 done** the same evening: the founder put the key and
deleted the download. **10.4 done:** service token `coworkers-security`
(`1854afb2…`, expires 2027-11-04), both halves on the Worker through the
script; the reusable policy `Lockkeeper Access from the Security bot`
(`03f2b46b…`, Service Auth) is the `lockkeeper` application's fifth policy,
beside the founder's email, Claude Code, the Engineering bot and the dispatch
routine (attached through the API with the app's other settings unchanged).
Each secret put published a version, so no deploy was needed.

**Verified 2026-11-03 evening:** the bot's first chat read all eleven
repositories through its App and Lockkeeper's open Dependabot pull requests:
about 390 open Dependabot alerts (pages over 100, so a minimum: the one-page
lists of then), 10 code scanning (9 on `coworkers`, 1 on `lockkeeper`), no
secret scanning; code scanning answered 403 on the four repositories without
Code Security. It named the green Dependabot pull requests by branch name only,
since it could not read pull requests. Both gaps were fixed the same night: the
lists page to exact totals, a feature that is off says so, and the founder
added Pull requests read so it reads each pull request's advisories and CI
result. Left for joint 5's Security part: its first triage issue, approved on
its card.

**10.2 The deploy file.** Add `"securityGithubAppId": "<App ID>"` to
`coworkers.deploy.json` (or give the id to the session).

**10.3 The key**, in your terminal (the workspace path is spelled out: from any other folder a bare `..` loads no `.envrc` and wrangler falls back to its own login, the personal account, as on 2026-11-04):

```bash
direnv exec ~/Development/Cofferdam pnpm dlx wrangler@4.95.0 secret put SECURITY_GITHUB_APP_PRIVATE_KEY --name coworkers < ~/Downloads/cofferdam-security-bot.*.private-key.pem
```

```bash
rm ~/Downloads/cofferdam-security-bot.*.private-key.pem
```

**10.4 The Lockkeeper token**, its own (`coworkers-security`, one year), piped
into `SECURITY_LOCKKEEPER_ACCESS_CLIENT_ID` and `…_SECRET` without showing the
secret:

```bash
direnv exec .. sh scripts/lockkeeper-service-token.sh coworkers-security coworkers SECURITY_
```

Give the printed token **id** to the session, which adds the reusable policy
`Lockkeeper Access from the Security bot` (Service Auth) to the `lockkeeper`
application, as for Engineering in step 5.

**10.5 Deploy again** (the session), so `SECURITY_GITHUB_APP_ID` carries the
id. Joint 5's Security part is done when the bot answers "what is open?" with
alerts from at least one repository and its first triage issue, approved on
its card, lands in `cofferdam` with the `security` label.

## Brand

The Cofferdam brand is the fork's own layer over upstream's theme tokens
(`docs/theming.md`), in `src/cofferdam/brand/`: `theme.css` (hand-written,
points the `--brand-*` tokens at cofferdam-branding's `--cd-*` ones),
`brand.generated.css` and `fonts/` (Geist, Geist Mono). The last two are
cofferdam-branding's `dist/pages/brand.generated.css` and `fonts/` copied byte
for byte; never edit them. A brand change arrives from cofferdam-branding on the
Mac, not as a pull request (its `brand-sync` workflow serves the app and the
website only):

```sh
cd /Users/hoff/Development/Cofferdam/cofferdam-branding && node scripts/build.mjs && node scripts/sync.mjs --only=coworkers --write
```

Then run the tests (`brand.test.ts` checks the copy and the mapping), commit
here and deploy (step 7). If the dark `web-bg` changed, `docs/theming.md` lists
what follows `--brand-surface` (`THEME_COLORS`, the manifest, `public/sw.js`,
`scripts/make-dark-splashes.sh`).

## Dependencies

The fork moves upstream's code only by reviewed merges (the pin above). Security
bumps are the exception: a dependency fix that upstream has not taken yet lands
here as a fork commit on `package.json`, `installer/package.json`,
`pnpm-workspace.yaml` and `pnpm-lock.yaml` only, never a major version, and is
deployed like any other change (step 7). In order of preference: raise a direct
dependency to its fixed patch inside its own range, let pnpm move a transitive
inside its parents' ranges (`pnpm update -r --depth Infinity <name>`,
`pnpm dedupe`), and only then an override in `pnpm-workspace.yaml` scoped to the
parent that pins the old version (`parent>child`), as a caret floor so a later
pin never goes back down. Each override says why; drop it once upstream's own
bump carries the fix. A peer that pnpm installed by itself (`solid-js` here)
moves with neither `update` nor an override; `pnpm --filter coworkers add -D
<name>@^<fixed>` then `pnpm --filter coworkers remove <name>` re-resolves it
and leaves `package.json` as it was. Run with Node 24.19 and pnpm 11.7.0, the
versions CI uses (nvm's Node 24.19 carries pnpm 12, which writes a different
lockfile).

**2026-11-04, the Security bot's sweep** (upstream still at `40e1a9f`, no fix
there): three criticals and every runtime high closed, 60 of 62 open alerts.
Direct: `@tanstack/react-start` 1.168.59 → 1.168.61 (with
`@tanstack/react-router` 1.170.42 and `@tanstack/router-plugin` 1.168.43, so
Start and the app share one router), `@tanstack/react-devtools` 0.10.14,
`zod` 4.6.7, `vite` 8.3.5, `postal-mime` 4.0.11. Transitive inside their
ranges: `@tanstack/start-server-core` 1.169.40, `seroval` 1.7.7 (TanStack) and
1.6.12 (devtools, through `solid-js` 1.9.18), MCP `sdk` 1.32.1 and `client`
2.3.1 (the versions `agents` 0.30 asks for), `body-parser` 2.4.0,
`source-map-js` 1.2.2, `launch-editor` 2.14.2, `undici` 8.12.3 (jsdom), and
`@cloudflare/codemode` 0.5.5 through `dedupe`. Overrides, all under the beta
`cf`/Vite plugin toolchain (`miniflare`, `@cloudflare/config`), which pins exact
versions: `undici` 7.30.1, `sharp` 0.35.5, `zod` 4.6.7. Left open: `minimatch`
(eslint and `just-bash`, the fix is 11.x, a major) and `esbuild` 0.18 (dev,
under `drizzle-kit`'s deprecated `@esbuild-kit`).

## 11. Joint 5: the Ops bot — founder, after the session's deploy

Built 2026-11-04 (`src/cofferdam/ops.ts`; ruled the same day: the bot gets its
own App, Cofferdam OS stays the one billing meter and sends the Billing
Monitor's review into this bot's chat over MCP at joint 9, and the bot holds
no billing credential). The deploy that carries it creates the bot in your hub
on the next sign-in, its connections marked **failed** until these steps.

**11.1 The GitHub App.** github.com → `cofferdamxyz` → Settings → Developer
settings → GitHub Apps → New GitHub App:

- **Name:** exactly `Cofferdam Ops Bot`, so its slug is `cofferdam-ops-bot`
  (`src/cofferdam/config.ts` lists `cofferdam-ops-bot[bot]`).
- **Homepage URL:** `https://bots.cofferdam.xyz`. **Webhook:** untick Active.
- **Repository permissions:** Contents **Read-only** (its `read_doc`: Markdown
  under `docs/`, `decisions/`, `rules/`, and `TODO.md`, enforced in code),
  Issues **Read and write** (the daily note on the standing ops issue; the
  code comments only on `ops` issues), Metadata Read-only. Nothing else.
- **Install App** → `cofferdamxyz` → Only select repositories → `cofferdam`.
- **Logo:** Display information → upload
  `cofferdam-branding/assets/github/bot-ops-idle-transparent.png` (the tan
  square head with Cerulean ears), **Badge background color** `0b1124`, as for
  the other two bots.

**11.2 The deploy file.** Add `"opsGithubAppId": "<App ID>"` to
`coworkers.deploy.json` (or give the id to the session).

**11.3 The key**, in your terminal (the full workspace path, as in 10.3):

```bash
direnv exec ~/Development/Cofferdam pnpm dlx wrangler@4.95.0 secret put OPS_GITHUB_APP_PRIVATE_KEY --name coworkers < ~/Downloads/cofferdam-ops-bot.*.private-key.pem
```

```bash
rm ~/Downloads/cofferdam-ops-bot.*.private-key.pem
```

**11.4 The bots' spend.** `bots_spend` reads the hub's own sync of the
`cofferdam-coworkers` gateway logs, the same data as the Spend page, which
needs `AI_GATEWAY_API_TOKEN` (step 6: an API token with **AI Gateway Read** on
the Cofferdam account only). Until it is set the Ops bot reports its spend as
unavailable and the Spend page stays off.

**11.5 Deploy again** (the session), so `OPS_GITHUB_APP_ID` carries the id.

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

## The Security bot

Created by code (`src/cofferdam/security.ts`) in the owner's hub on the first
sign-in after the deploy that carries it, never by hand:

- **Reads:** Dependabot, code scanning and secret scanning alerts, Code
  Quality findings and setup, and pull requests with their bot comments, on
  the repositories its App is installed on; every list pages through to exact
  totals by severity with the worst 40 in full, and a feature that is off
  in a repository says so, cut to the fields triage needs (a
  secret scanning alert's value is never returned); each CodeQL alert's Copilot
  Autofix; issues of `cofferdamxyz/cofferdam`; Lockkeeper `brief`,
  `in_flight`, `check` with its own token.
- **Writes, each on an approval card, never in a background turn:** file the
  triage issue in `cofferdam` with the `security` label and no other lane
  label; comment (the weekly summary, a sentence on a triage issue); request a
  Copilot Autofix. Nothing on a product repository: a `@dependabot rebase`
  tool was built and tested on 2026-11-04 (`lockkeeper#5`); the comment
  posted, and Dependabot answered "only users with push access can use that
  command". Push access is Contents write, never this App's, so the tool was
  removed; the bot asks the founder to comment it instead.
- **Never:** labels, `dispatch`, closing, dismissing an alert, accepting or
  committing a fix (the founder does it on the alert's page), changing a
  repository's Code Quality setup, a secret value, a
  shell, scripts, the browser, email, managing bots.
- **Routine:** "Daily security triage", weekdays 08:00 São Paulo, read-only:
  what to land, what it would file, which CodeQL alerts lack an Autofix; on
  Mondays a draft of the weekly summary. Requesting an Autofix waits for you in
  chat (the ruling of 2026-11-03 had the triage request it; a background turn
  never writes here, so it asks instead). It also lists every open Dependabot pull
  request that needs `@dependabot rebase` (no CI result, or conflicting or
  behind main), with links, for the founder to comment. Routine changes in
  code reach the existing bot on the next hub start (`routineKey`, since
  2026-11-04; before that the routine stayed as first created).
- Its connections (`cofferdam-security-github`, `cofferdam-security-lockkeeper`)
  are listed only to it; Engineering's only to Engineering.

## The Ops bot

Created by code (`src/cofferdam/ops.ts`) in the owner's hub on the first
sign-in after the deploy that carries it, never by hand:

- **Reads:** the Billing Monitor's reviews as messages in its chat (Cofferdam
  OS, joint 9; the one meter for Cloudflare spend, decision 0045); the bots'
  own Claude spend (`bots_spend`, the hub's gateway sync, against $250 a month
  and $8 a day per bot); workspace Markdown (`read_doc`); issues of
  `cofferdamxyz/cofferdam`. No Lockkeeper, no billing credential.
- **Writes, each on an approval card, never in a background turn:** a comment
  on an `ops` issue (the daily note, the Monday checklist).
- **Never:** labels, filing or closing issues, `dispatch`, company state (the
  OS's), a payment, a subscription or a credential, a shell, scripts, the
  browser, email, managing bots.
- **Routine:** "Daily ops check-in", weekdays 09:00 São Paulo, read-only.
- Its connections (`cofferdam-ops-github`, `cofferdam-ops-spend`) are listed
  only to it.

## Deployments

| Date | Commit | Version id | Notes |
|---|---|---|---|
| — | — | — | Not deployed yet. Dry run passed 2026-11-02 from the Mac (`cf deploy --prebuilt --dry-run`, the workspace `.envrc` loaded); waits on steps 1 to 6. |
