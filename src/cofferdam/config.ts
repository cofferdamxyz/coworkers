/**
 * Cofferdam's layer over upstream Coworkers (workspace
 * docs/runbooks/agentic-loop-completion.md §3, §4, §9). Everything here is
 * fixed in code on purpose: a chat, an issue or a web page can change what a
 * bot reads, never what it may do. Change these values only in a reviewed
 * commit on this fork.
 */

/** The deployment's host, behind one Cloudflare Access application. */
export const HOST = "bots.cofferdam.xyz"

/** The only repository a bot writes to: the private workspace repository. */
export const WORKSPACE_REPO = {
  owner: "cofferdamxyz",
  repo: "cofferdam",
} as const

/** The four lanes of decision 0053; a dispatched issue carries one. */
export const LANE_LABELS = [
  "engineering",
  "marketing",
  "security",
  "ops",
] as const

/**
 * Labels as states (§6). Only `dispatch` may be applied by a bot, and only
 * the Engineering bot, after a listed person approved it on the card. The
 * other three belong to the dispatch routine.
 */
export const DISPATCH_LABEL = "dispatch"
export const ROUTINE_LABELS = ["dispatched", "blocked", "waiting"] as const

/** Trial limits of §6: in flight across all repositories, and per repository. */
export const MAX_IN_FLIGHT = 2
export const MAX_IN_FLIGHT_PER_REPO = 1

/** The Security bot's lane label: every issue it files carries it. */
export const SECURITY_LABEL = "security"

/** People whose request is `explicit` in the admission table (§4). */
export const LISTED_PEOPLE = ["CofferdamDev"] as const

/** Bots and services whose trigger is `inferred` at most (§4). */
export const LISTED_BOTS = [
  "dependabot[bot]",
  "github-actions[bot]",
  "claude[bot]",
  "cofferdam-lockkeeper[bot]",
  "cofferdam-engineering-bot[bot]",
  "cofferdam-security-bot[bot]",
] as const

/** Lockkeeper's MCP tools a preset bot may call: reads only. */
export const LOCKKEEPER_TOOLS = ["brief", "in_flight", "check"] as const

/** The repositories Lockkeeper watches, for the bot's `repo` arguments. */
export const REPOSITORIES = [
  "cofferdam",
  "cofferdam-app",
  "cofferdam-sdk",
  "cofferdam-api",
  "cofferdam-attester",
  "base-contracts",
  "cofferdam-pages",
  "cofferdam-branding",
  "cofferdam-os",
  "lockkeeper",
  "coworkers",
] as const

/** The bots defined by this fork rather than by a person in the UI. */
export const PRESETS = ["engineering", "security"] as const
export type Preset = (typeof PRESETS)[number]
