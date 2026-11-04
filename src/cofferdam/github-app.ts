/**
 * A preset bot's GitHub identity: one GitHub App per bot
 * (agentic-loop-completion.md §4). Engineering's is installed on the
 * workspace repository only; Security's on the workspace repository (its
 * triage issues) and the repositories whose alerts it reads. The Worker holds
 * each App's private key as a secret and mints a one-hour installation token
 * per use, narrowed in the request itself to one repository and the
 * permissions the call needs, so even an App granted more cannot be used for
 * more from here.
 */
import { REPOSITORIES, WORKSPACE_REPO } from "./config"

/** One App's credentials, in the Engineering bot's binding names. */
export interface GitHubAppEnv {
  GITHUB_APP_ID: string
  GITHUB_APP_PRIVATE_KEY: string
}

const API = "https://api.github.com"
const USER_AGENT = "cofferdam-coworkers"

export type TokenPermissions = Partial<
  Record<
    | "issues"
    | "contents"
    | "security_events"
    | "vulnerability_alerts"
    | "secret_scanning_alerts",
    "read" | "write"
  >
>

export class GitHubNotConfigured extends Error {
  constructor() {
    super(
      "This bot's GitHub App is not configured on this deployment (its App id or private key is missing). Tell the user; do not retry."
    )
  }
}

export function githubConfigured(env: Partial<GitHubAppEnv>) {
  return Boolean(
    env.GITHUB_APP_ID?.trim() && env.GITHUB_APP_PRIVATE_KEY?.trim()
  )
}

// ── Keys ──────────────────────────────────────────────────────────────

function derLength(n: number): number[] {
  if (n < 0x80) return [n]
  const bytes: number[] = []
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff)
  return [0x80 | bytes.length, ...bytes]
}

function der(tag: number, body: Uint8Array) {
  return Uint8Array.from([tag, ...derLength(body.length), ...body])
}

/** RSAPrivateKey (PKCS#1, what GitHub hands out) wrapped as PKCS#8. */
export function pkcs1ToPkcs8(pkcs1: Uint8Array) {
  const version = Uint8Array.from([0x02, 0x01, 0x00])
  // SEQUENCE { OID 1.2.840.113549.1.1.1 (rsaEncryption), NULL }
  const algorithm = Uint8Array.from([
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01,
    0x01, 0x05, 0x00,
  ])
  const key = der(0x04, pkcs1)
  const body = new Uint8Array(version.length + algorithm.length + key.length)
  body.set(version, 0)
  body.set(algorithm, version.length)
  body.set(key, version.length + algorithm.length)
  return der(0x30, body)
}

/** PEM (PKCS#1 or PKCS#8) to the PKCS#8 bytes WebCrypto imports. */
export function pemToPkcs8(pem: string) {
  const pkcs1 = /-----BEGIN RSA PRIVATE KEY-----/.test(pem)
  const b64 = pem
    .replace(/-----(BEGIN|END) [A-Z ]+-----/g, "")
    .replace(/\\n/g, "")
    .replace(/\s+/g, "")
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  return pkcs1 ? pkcs1ToPkcs8(bytes) : bytes
}

function base64url(input: Uint8Array | string) {
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : input
  let s = ""
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/** The App's own JWT: ten minutes at most, issued a minute in the past. */
export async function appJwt(env: GitHubAppEnv, now = Date.now()) {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(env.GITHUB_APP_PRIVATE_KEY),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const iat = Math.floor(now / 1000) - 60
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))
  const payload = base64url(
    JSON.stringify({ iat, exp: iat + 9 * 60, iss: env.GITHUB_APP_ID.trim() })
  )
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${header}.${payload}`)
  )
  return `${header}.${payload}.${base64url(new Uint8Array(signature))}`
}

// ── Tokens ────────────────────────────────────────────────────────────

const tokens = new Map<string, { token: string; expires: number }>()
/** Installation per App id: each App is installed once, on the organisation. */
const installations = new Map<string, number>()

async function gh(path: string, init: RequestInit & { token: string }) {
  const { token, headers, ...rest } = init
  const res = await fetch(`${API}${path}`, {
    ...rest,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "user-agent": USER_AGENT,
      "x-github-api-version": "2022-11-28",
      ...(rest.body ? { "content-type": "application/json" } : {}),
      ...headers,
    },
  })
  return res
}

async function failure(res: Response, what: string) {
  const text = await res.text().catch(() => "")
  let message = text.slice(0, 300)
  try {
    message = (JSON.parse(text) as { message?: string }).message ?? message
  } catch {
    // not JSON
  }
  return new Error(`GitHub ${what} failed (${res.status}): ${message}`)
}

function checkedRepo(repo: string) {
  if (!(REPOSITORIES as readonly string[]).includes(repo)) {
    throw new Error(`Unknown repository ${repo}.`)
  }
  return repo
}

/**
 * An installation token for one repository of the organisation (the
 * workspace repository unless named) with these permissions.
 */
export async function installationToken(
  env: Partial<GitHubAppEnv>,
  permissions: TokenPermissions,
  repo: string = WORKSPACE_REPO.repo
) {
  if (!githubConfigured(env)) throw new GitHubNotConfigured()
  const app = env as GitHubAppEnv
  const appId = app.GITHUB_APP_ID.trim()
  checkedRepo(repo)
  const cacheKey = JSON.stringify([appId, repo, permissions])
  const cached = tokens.get(cacheKey)
  if (cached && cached.expires - Date.now() > 5 * 60_000) return cached.token
  const jwt = await appJwt(app)
  let installationId = installations.get(appId)
  if (installationId === undefined) {
    const res = await gh(
      `/repos/${WORKSPACE_REPO.owner}/${repo}/installation`,
      {
        token: jwt,
      }
    )
    if (!res.ok) throw await failure(res, "finding the App's installation")
    installationId = ((await res.json()) as { id: number }).id
    installations.set(appId, installationId)
  }
  const res = await gh(`/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    token: jwt,
    body: JSON.stringify({ repositories: [repo], permissions }),
  })
  if (!res.ok) {
    // A reinstalled App has a new installation: look it up again next time.
    if (res.status === 404) installations.delete(appId)
    throw await failure(res, "minting an installation token")
  }
  const body = (await res.json()) as { token: string; expires_at: string }
  tokens.set(cacheKey, {
    token: body.token,
    expires: Date.parse(body.expires_at),
  })
  return body.token
}

/**
 * A REST call on one repository of the organisation (the workspace
 * repository unless named), with a narrowed token; the raw response, for
 * callers that read a status such as 404 themselves.
 */
export async function repoFetch(
  env: Partial<GitHubAppEnv>,
  permissions: TokenPermissions,
  path: string,
  init: RequestInit = {},
  repo: string = WORKSPACE_REPO.repo
): Promise<Response> {
  const token = await installationToken(env, permissions, repo)
  const prefix = `/repos/${WORKSPACE_REPO.owner}/${repo}`
  return gh(path.startsWith("/search/") ? path : `${prefix}${path}`, {
    ...init,
    token,
  })
}

/** A REST call on one repository, its JSON body, or an error. */
export async function repoApi<T>(
  env: Partial<GitHubAppEnv>,
  permissions: TokenPermissions,
  path: string,
  init: RequestInit = {},
  what = "request",
  repo: string = WORKSPACE_REPO.repo
): Promise<T> {
  const res = await repoFetch(env, permissions, path, init, repo)
  if (!res.ok) throw await failure(res, what)
  return (await res.json()) as T
}

/** The error for a failed response, with GitHub's message. */
export { failure as githubFailure }

/** Test hook: forget cached tokens and the installation id. */
export function resetGitHubAppCache() {
  tokens.clear()
  installations.clear()
}
