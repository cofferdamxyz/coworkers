# Coworkers as an MCP server — plan

One control plane for everything a bot, an outside agent or the UI can do:
create, pause and delete bots, message and delegate, answer approvals,
change settings and connections. Each operation is defined once. Bots call
it as a tool, outside agents (Claude Code, ChatGPT, Cursor) call it over
MCP with OAuth, and the UI's callables call it too.

Borrowed from T3Code's orchestrator MCP
(`t3code/docs/orchestration-v2/orchestrator-mcp-server.md`): one shared
service with thin transports in front of it, per-caller credentials,
read-only OAuth by default, a privilege ceiling, typed failures and
idempotent writes.

## What exists today

- **Bot to bot.** `message_bot` and `delegate_task` (`bot-agent.ts`) go
  through `hub.relayMessage` / `hub.delegateTask`. Delegation is already
  async: it returns a `taskId`, and the result arrives later as a new
  message. Retries are idempotent (keyed on the tool call), and
  `MAX_BOT_HOPS` stops loops.
- **Management lives in callables.** `createBot`, `deleteBot`,
  connections, models, shared memory, pipelines and the Desk are on
  `UserHub`. Name, role, rules, model, routines, memory and secrets are on
  `BotAgent`. Only the browser can call them (`@callable()`).
- **Approvals.** Rules per action class (`allow` / `ask` / `block`), tool
  approvals in chat, script approvals, and `needs_you` Desk cards that close
  wherever they are answered.
- **Auth.** Cloudflare Access in front of the Worker. `identify()` turns
  the Access JWT into a user id, and `server.ts` only lets a user reach
  their own hub and bots. `/apps` and `/api/hooks` bypass Access and carry
  their own tokens.
- **The gaps.** Bots can't manage bots or settings, nothing outside the
  browser can reach Coworkers, and there's no way to point at a bot from
  the composer.

## The shape

```
                    ┌─────────────── operations (src/control/) ───────────────┐
browser callables ──┤  name · description · input (zod) · level · effect ·    │
bot tools ──────────┤  handler(caller, input)                                  ├─► UserHub / BotAgent
/mcp (OAuth) ───────┤  checked once: level, ceiling, approval, idempotency     │
                    └──────────────────────────────────────────────────────────┘
```

- **An operation** is a plain object: name, short instructive description,
  Zod input, the access `level` it needs, its `effect` (`read`, `write`,
  `destructive`) and a handler that takes `(caller, input)`.
- **One checker** wraps every handler before it runs: the caller's level,
  the ceiling rule, approval for destructive effects, and the
  `clientRequestId` replay. Transports get handlers only from the checker,
  never the raw ones, the same way T3Code's `McpToolAccess` works.
- **Operations run where the call arrives**, against ports: a `HubPort`
  (the `UserHub` itself, or a wrapper over its DO stub) and, for bot
  callers, a `BotPort` for the caller's own files and delegation records.
  Running everything inside the hub would cost a bot an extra round trip
  just to read its own files. The checker is the single entry point for
  logging, rate limits and checks, wherever it runs.
- **Three transports, all thin.**
  - Bot tools are generated from the registry and merged into
    `BotAgent`'s tool set, with no MCP hop. Bots run in-process, unlike
    T3Code's agents, so MCP is only the outside door.
  - `/mcp` registers the same operations as MCP tools for each request,
    and only the ones the token's level allows, so a read-only client never
    sees a write tool.
  - Browser callables stay (live state over WebSockets is the UI's
    strength), but each becomes a one-line call to its operation as it is
    ported.

## Callers and access levels

```ts
type Caller =
  | { kind: "user" } // the browser, signed in through Access
  | { kind: "bot"; botId: string; grants: AccessLevel }
  | { kind: "client"; clientId: string; label: string; level: AccessLevel }

type AccessLevel = "read" | "act" | "manage"
```

| Level    | Can                                                                                                        |
| -------- | ---------------------------------------------------------------------------------------------------------- |
| `read`   | List bots, read a bot's thread, list routines, Desk cards, models and connections (names only)             |
| `act`    | Also message and delegate to bots, cancel its own tasks, answer approvals it is shown                      |
| `manage` | Also create, pause, resume, delete and configure bots, change account settings, add and remove connections |

- **The user** has everything. **Bots** get `act` by default, and a
  chief-of-staff bot gets `manage`. **OAuth clients** get what the user
  picks on the consent page, `read` by default.
- **Ceiling.** A caller can never create or configure a bot with looser
  rules than its own, and can't grant `manage` unless it has it. That is
  T3Code's "no broader runtime mode than the caller" rule, mapped onto our
  per-class rules.
- **Destructive operations always ask**, unless the user does them in the
  browser:
  - deleting a bot
  - removing a connection
  - setting a rule to `allow`
  - adding a connection
  - deleting a routine
  - For a bot, this goes through a new `manage` action class (default
    `ask`), so it uses the existing chat approval and `needs_you` card.
  - For an OAuth client, the operation posts a `needs_you` card and returns
    `{ status: "pending_approval", requestId }`. `approval_status` (or
    `wait`, capped at about 60 s) reads the outcome.
- **Secrets never cross.** No operation returns secret values or connection
  header values. `request_secret` stays a card only the user fills in.
- **Typed failures**, returned as results, not thrown: `denied`,
  `needs_approval`, `not_found`, `paused`, `ceiling`, `invalid`,
  `hop_limit`, `unavailable`.
- **Idempotency.** Every write takes an optional `clientRequestId`. Bots
  pass their tool call id, as `delegate_task` already does. A replay
  returns the first result.
  (Cofferdam: an outside agent's `message_bot` requires its
  `clientRequestId` and declares `idempotentHint`; `DEPLOYMENT.md` step 12.)

## Operations (v1)

Short descriptions in the T3Code style: what it does, what to keep, what
not to do ("Do not poll").

| Operation                         | Level    | Effect      | Notes                                                                 |
| --------------------------------- | -------- | ----------- | --------------------------------------------------------------------- |
| `list_bots`                       | `read`   | read        | Name, role, status, paused, model, link                               |
| `read_bot`                        | `read`   | read        | Thread messages, paged with `after` / `next`, bounded text            |
| `list_models`                     | `read`   | read        | Short list plus `search`, like `orchestrator_capabilities`            |
| `message_bot`                     | `act`    | write       | Ported from the bot tool                                              |
| `delegate_task`                   | `act`    | write       | Ported. Adds an optional `model` for that one task                    |
| `task_status`                     | `act`    | read        | For callers with no inbox (OAuth clients). Bots keep getting messages |
| `task_cancel`                     | `act`    | write       | Only tasks the caller started                                         |
| `list_cards`                      | `read`   | read        | Desk                                                                  |
| `answer_approval`                 | `act`    | write       | Only for approvals shown to this caller. Bots can't answer their own  |
| `create_bot`                      | `manage` | write       | Name, role, rules, model, routines. Ceiling applies                   |
| `update_bot`                      | `manage` | write       | Wraps `updateSettings`. Ceiling applies                               |
| `pause_bot`, `resume_bot`         | `manage` | write       | New (see Chief of staff)                                              |
| `delete_bot`                      | `manage` | destructive | Always asks                                                           |
| `get_settings`, `update_settings` | `manage` | write       | Account model, shared memory                                          |
| `list_connections`                | `read`   | read        | Names, status, tool counts                                            |
| `add_connection`                  | `manage` | destructive | Sign-in URL comes back as a `needs_you` card                          |
| `remove_connection`               | `manage` | destructive |                                                                       |

## Bot links and @mentions

- **Link format.** `coworkers://bot/<botId>` (and `coworkers://task/<id>`).
  Every operation result that names a bot includes its `link`, and
  descriptions tell the model to use the link verbatim. The thread renders
  links as chips with the bot's current name and avatar, so a rename never
  makes a reply stale. OAuth clients get a web URL instead
  (`<origin>/bots/<botId>`).
- **Composer.** Typing `@` opens a picker over the other bots and inserts
  `@Name`. On send, every `@Name` of another bot (picked or typed) becomes
  `[@Name](coworkers://bot/<id>)` in the stored message (`linkMentions` in
  `src/lib/bot-links.ts`). The bubble shows it as a chip.
- **What the model sees.** The link itself, plus the per-turn roster (`#
Other bots`), which lists every bot as its link, and one line in the soul:
  a mention usually means "involve this bot", so pass its link as `to` when
  the message asks for its help, and write links when naming bots. No extra
  per-message block: the link already carries the id, and messages from
  bots are already marked as coming from a colleague.

  The user's sentence decides what to do ("ask @Researcher for the
  numbers"). Unlike T3Code, where a thread mention is reference material, a
  mention here usually means "involve this bot".

- **Addressed by id**, not name. `message_bot` and `delegate_task` take
  `to` as an id or a link, and fall back to a name match for old prompts.

## Multi-model per task

- `list_models` returns the deployment's models (`src/lib/models.ts`),
  short by default with a `search`.
- `delegate_task` takes an optional `model` that applies to that task's
  turn only. "Have @Researcher dig into this with a cheaper model" becomes
  one call. The bot's own model is unchanged.
- A chief of staff can also `create_bot({ model })` for a long-lived
  specialist.

## Chief of staff

Just a bot with `manage` grants, created from a template (name, role,
starter rules). It needs nothing special in the code:

- It lists bots, creates them for new jobs, and pauses or deletes them
  with approval. For routines it delegates: the bot that owns a routine
  writes it, since it knows its own methods, so there are no routine
  operations for other bots.
- **Its tools follow a `manage` rule** (default "Ask first", shown in
  settings only for manage-level bots). `delete_bot` always asks. A bot it
  creates gets the stricter of the defaults and its own rules, and it can't
  give more access than it has. It can't pause or delete itself.
- **Pause** is new: `BotState.paused`, mirrored in the hub's directory.
  While paused, routines (recorded as skipped), check-ins, app events,
  email and webhooks (kept in its inbox, not acted on) skip. `message_bot`,
  `delegate_task` and pipeline steps to it are refused with `paused`, and
  the sidebar and chat show it. The user can still chat with it. Results of
  work it started before the pause still come back.
- **Prompt injection is the real risk.** A web page or email read by the
  chief of staff can say "delete every bot". Destructive operations always
  asking, plus the ceiling, is the defense. Content it reads is never
  treated as approval.

## Transport and auth for outside agents

Built with `@cloudflare/workers-oauth-provider` (1.2), both roles in this
Worker (`src/mcp/`):

- **Authorization server.** `OAuthAuthorizationServer`, one per origin
  (the issuer is whatever URL the request came in on), serves discovery,
  Dynamic Client Registration (`/oauth/register`) and `/oauth/token`.
  Client ID Metadata Documents are off: they need the
  `global_fetch_strictly_public` flag, which breaks `http://localhost`
  connections in dev.
- **Storage without KV.** The library wants a KV namespace bound as
  `OAUTH_KV`. A SQLite Durable Object (`OAuthStore`, one instance) behind
  a KV-shaped adapter stands in, so installs need no new resource and the
  installer no new OAuth scope.
- **Consent page** at `/oauth/authorize`, behind Access, so `identify()`
  knows the user. It names the client (flagged as unverified for DCR
  clients), where access goes, warns for a local app, and asks for a
  level: Read only (default), Work with your bots, Manage your bots.
  `completeAuthorization()` stores `props: { userId, level, label }`; the
  scopes are `coworkers.read` / `.act` / `.manage` plus `offline_access`.
- **Resource server.** `OAuthResourceServer` in front of `/mcp`, which
  builds an `McpServer` per request from `visibleTo(client caller)`. The
  operations run in the Worker against the user's hub over DO RPC. The
  effective level is the lower of the grant and the token's scopes.
- **What agents get.** `list_bots`, `read_bot`; with act, their own
  `message_bot` and `delegate_task` (no workspace files; results wait in
  the hub's `client_tasks` for `task_status`, which can wait up to 50 s);
  with manage, `create_bot`, `update_bot`, `pause_bot`, `resume_bot`. No
  destructive operation is shown to an agent: there is no approval card to
  stop at yet, so deleting stays with the user. Rules an agent sets can't
  be looser than the defaults. A retry with the same `clientRequestId`
  delivers once.
- **Access bypass.** `/mcp`, `/oauth/token`, `/oauth/register` and the two
  `/.well-known/oauth-*` documents, in both the installer and `pnpm run
setup`. `/oauth/authorize` stays behind Access.
- **Without Access** (dev, demo) the consent page signs in as the demo
  user, as the rest of the app does.
- **Settings → Agents** shows the MCP URL with Claude Code and Codex
  commands, lists connected agents with their level, and disconnects
  (revokes the grant; its tokens stop at once). A connection lapses after
  30 days unused.
- **Installer migrations.** Updates used to carry no Durable Object
  migrations; `CLASS_HISTORY` in `installer/src/deploy/upload.ts` now
  adds the classes an install lacks (`v1` → `v2` adds `OAuthStore`).

## Build order

1. **The service, nothing new.** `src/control/` with the registry, checker,
   `Caller` and failures. Port `message_bot`, `delegate_task`,
   `createBot`, `deleteBot` and `updateSettings` onto it: bot tools
   generated from the registry, callables as one-line wrappers. Behavior is
   unchanged, and tests cover the checker. **Done.** Generic
   `clientRequestId` replay is left for step 4: today every write is
   already keyed on the bot's tool call.
2. **Links and @mentions.** Link format and chips in `thread.tsx`, the
   composer picker, the mention projection, `to` by id. **Done.**
   `coworkers://task/<id>` links wait until something renders tasks.
3. **Chief of staff.** Access levels on bots, `manage` action class,
   `pause_bot` / `resume_bot`, the management operations, the ceiling, and
   a template in onboarding. **Done.** Bot tools: `list_bots`, `read_bot`
   (every bot), `create_bot`, `update_bot`, `pause_bot`, `resume_bot`,
   `delete_bot` (manage). Tool parameters avoid records: their
   `propertyNames` is JSON Schema some providers reject.
4. **Outside agents.** OAuth server, consent page, `/mcp`, the Access
   bypass in the installer, `task_status`, pending-approval results and the
   Connected agents settings. **Done**, without pending-approval results:
   destructive operations are hidden from agents for now. Checked end to
   end locally with a scripted MCP client (registration, consent in the
   browser, token, tools, revoke).
5. **Later.** Approval cards for an agent's destructive calls, CIMD,
   per-task `model`, settings and connection operations, pipelines over
   MCP, a `coworkers` CLI on the same operations.

## Files

| File                                  | Change                                                                                                                                              |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/control/` (new)                  | `operations.ts` (registry), `access.ts` (checker, ceiling), `caller.ts`, one file per area (`bots.ts`, `tasks.ts`, `desk.ts`, `settings.ts`), tests |
| `src/agents/user-hub.ts`              | `runOperation`, hub-side task table for client-started tasks, callables become wrappers, `oauth_clients` view for settings                          |
| `src/agents/bot-agent.ts`             | Tools from the registry, `paused`, `manage` action class, per-task model                                                                            |
| `src/lib/types.ts`                    | `AccessLevel`, `BotState.paused` / `grants`, link helpers, `manage` in `ACTION_CLASSES`                                                             |
| `src/agents/prompt.ts`                | Mentions block, chief-of-staff guidance                                                                                                             |
| `src/server.ts`                       | Route `/mcp`, `/authorize`, OAuth endpoints                                                                                                         |
| `src/mcp/` (new)                      | Authorization server, consent page, resource server, tool registration                                                                              |
| `src/components/thread.tsx`, composer | Link chips, `@` picker                                                                                                                              |
| `src/components/settings-panel.tsx`   | Connected agents, bot access level                                                                                                                  |
| `cloudflare.config.ts`                | `OAUTH_KV` (with id), `global_fetch_strictly_public`                                                                                                |
| `installer/src/installer.ts`          | Access bypass paths for MCP                                                                                                                         |

## Decisions to make

1. **One Worker or two.** Decided: one. The library supports both roles in
   one Worker, with `validateToken` called directly.
2. **Approvals for outside agents.** A Desk card plus `pending_approval`
   (works in every client) or MCP elicitation (support varies by client).
   Recommended: the Desk card.
3. **Messages to a paused bot.** Reject with `paused` (recommended) or
   queue until it resumes.
4. **Chief-of-staff defaults.** Recommended: `manage`, with `manage` and
   `apps` on `ask`. The user loosens rules per bot later.
5. **Port everything, or just new work.** Recommended: port each callable
   when its area is touched, not in one sweep. Step 1 proves the pattern on
   five of them.
