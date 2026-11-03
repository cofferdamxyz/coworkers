/**
 * Cofferdam's deploy of this fork: upstream's `cf deploy` (the same deploy
 * `pnpm run setup` runs, Durable Object classes created from the Worker's
 * exports), from the Mac, with the workspace .envrc loaded. DEPLOYMENT.md
 * has the founder's steps that come first.
 *
 *   direnv exec /Users/hoff/Development/Cofferdam node scripts/cofferdam-deploy.ts --dry-run
 *   direnv exec /Users/hoff/Development/Cofferdam node scripts/cofferdam-deploy.ts
 *
 * What it differs from upstream's setup in, and why:
 * - Secrets are never generated, read, written or printed here. The founder
 *   puts each one with `wrangler secret put`; this script lists only their
 *   names and refuses to deploy while a required one is missing.
 * - A secrets file is always passed, because `cf deploy` keeps the Worker's
 *   existing secrets only when one is (cf 1.0.0-beta.6: `keepSecrets:
 *   keepVars || !!secretsFile`); without it every secret the founder put
 *   would be dropped. The file holds no value at all: only the optional
 *   secrets the Worker does not hold yet, sent empty because `cf deploy`
 *   refuses a declared secret that is missing and the Worker reads an empty
 *   one as "feature off". It is deleted after the deploy.
 * - Cloudflare Access is set up by hand in the dashboard (DEPLOYMENT.md), so
 *   the deploy file must already carry its team domain and AUD; there is no
 *   closed first deploy and no workers.dev hostname.
 * - Never run upstream's web installer against this Worker: it tracks
 *   Durable Object migrations by its own tags.
 */
import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const DEPLOY_FILE = "coworkers.deploy.json"
const WRANGLER = "wrangler@4.95.0"

/** The Engineering bot and push cannot work without these. */
const REQUIRED = [
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "GITHUB_APP_PRIVATE_KEY",
  "LOCKKEEPER_ACCESS_CLIENT_ID",
  "LOCKKEEPER_ACCESS_CLIENT_SECRET",
]
/** Declared upstream, off while empty. */
const OPTIONAL = [
  "BROWSER_RUN_API_TOKEN",
  "AI_GATEWAY_API_TOKEN",
  "EMAIL_ROUTING_API_TOKEN",
]

const dryRun = process.argv.includes("--dry-run")

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`)
  process.exit(1)
}

function run(cmd: string, args: string[], capture = false) {
  const result = spawnSync(cmd, args, {
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
  })
  return result
}

if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) {
  fail(
    "CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are not set. Run this through `direnv exec /Users/hoff/Development/Cofferdam …` so the workspace .envrc is loaded."
  )
}

const deploy: Record<string, unknown> = existsSync(DEPLOY_FILE)
  ? JSON.parse(readFileSync(DEPLOY_FILE, "utf8"))
  : {}
const name = typeof deploy.name === "string" ? deploy.name : "coworkers"

if (!dryRun) {
  const missing = [
    "accessTeamDomain",
    "accessAud",
    "cofferdamOwner",
    "githubAppId",
  ].filter(
    (k) => typeof deploy[k] !== "string" || !(deploy[k] as string).trim()
  )
  if (missing.length) {
    fail(`${DEPLOY_FILE} lacks ${missing.join(", ")}. DEPLOYMENT.md, step 4.`)
  }
  if (deploy.accessAud === "locked") {
    fail(`${DEPLOY_FILE} still has upstream's locked placeholder for Access.`)
  }
}

// ── Secrets: names only ──────────────────────────────────────────────
let present = new Set<string>()
if (!dryRun) {
  const listed = run(
    "pnpm",
    ["dlx", WRANGLER, "secret", "list", "--name", name, "--format", "json"],
    true
  )
  if (listed.status !== 0) {
    fail(
      `wrangler could not list the Worker's secrets (a Worker that does not exist yet is created by the first \`wrangler secret put\`, DEPLOYMENT.md step 6):\n${listed.stderr.trim().slice(-800)}`
    )
  }
  try {
    present = new Set(
      (JSON.parse(listed.stdout) as { name: string }[]).map((s) => s.name)
    )
  } catch {
    fail("Could not read the secret list from wrangler.")
  }
  const missing = REQUIRED.filter((s) => !present.has(s))
  if (missing.length) {
    fail(
      `The Worker ${name} lacks ${missing.join(", ")}. Put each with the command in DEPLOYMENT.md, step 5, then run this again.`
    )
  }
}

// ── Build and deploy ─────────────────────────────────────────────────
const build = run("pnpm", ["build"])
if (build.status !== 0) fail("pnpm build failed.")

const args = ["exec", "cf", "deploy", "--prebuilt"]
let dir: string | null = null
if (dryRun) {
  args.push("--dry-run")
} else {
  const empty = OPTIONAL.filter((s) => !present.has(s))
  dir = mkdtempSync(join(tmpdir(), "coworkers-"))
  const file = join(dir, "optional-empty.json")
  // Names with empty values only, or `{}` once every optional secret exists:
  // no secret is in this file. JSON, because cf reads a dotenv file with no
  // keys as invalid (found on the second deploy, 2026-11-03).
  writeFileSync(
    file,
    JSON.stringify(Object.fromEntries(empty.map((s) => [s, ""]))),
    { mode: 0o600 }
  )
  args.push("--secrets-file", file)
}
const deployed = run("pnpm", args)
if (dir) rmSync(dir, { recursive: true, force: true })
if (deployed.status !== 0) fail("cf deploy failed.")
console.log(
  dryRun
    ? "\n✓ Dry run passed: nothing was uploaded."
    : "\n✓ Deployed. Record the version id above in DEPLOYMENT.md."
)
