/**
 * Lockkeeper (workspace decision 0053) over its stateless MCP endpoint, with
 * the Access service token only the Engineering bot holds (§4, §9). Only the
 * read tools of LOCKKEEPER_TOOLS are reachable from here: a bot never claims
 * paths, since it never edits a repository.
 */
import { LOCKKEEPER_TOOLS } from "./config"

export interface LockkeeperEnv {
  LOCKKEEPER_URL: string
  LOCKKEEPER_ACCESS_CLIENT_ID: string
  LOCKKEEPER_ACCESS_CLIENT_SECRET: string
}

export type LockkeeperTool = (typeof LOCKKEEPER_TOOLS)[number]

export function lockkeeperConfigured(env: Partial<LockkeeperEnv>) {
  return Boolean(
    env.LOCKKEEPER_URL?.trim() &&
    env.LOCKKEEPER_ACCESS_CLIENT_ID?.trim() &&
    env.LOCKKEEPER_ACCESS_CLIENT_SECRET?.trim()
  )
}

export function isLockkeeperTool(name: string): name is LockkeeperTool {
  return (LOCKKEEPER_TOOLS as readonly string[]).includes(name)
}

/** Calls one Lockkeeper tool and returns its text. */
export async function callLockkeeper(
  env: Partial<LockkeeperEnv>,
  name: string,
  args: Record<string, unknown>,
  fetcher: typeof fetch = fetch
): Promise<string> {
  if (!isLockkeeperTool(name)) {
    throw new Error(`Lockkeeper's ${name} is not available to bots.`)
  }
  if (!lockkeeperConfigured(env)) {
    throw new Error(
      "Lockkeeper is not configured on this deployment (its Access service token is missing). Tell the user; do not retry."
    )
  }
  const res = await fetcher(`${env.LOCKKEEPER_URL!.replace(/\/+$/, "")}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "cf-access-client-id": env.LOCKKEEPER_ACCESS_CLIENT_ID!,
      "cf-access-client-secret": env.LOCKKEEPER_ACCESS_CLIENT_SECRET!,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method: "tools/call",
      params: { name, arguments: args },
    }),
  })
  if (!res.ok) {
    throw new Error(
      res.status === 401 || res.status === 403
        ? "Lockkeeper refused the service token (expired or revoked). Tell the user; do not retry."
        : `Lockkeeper answered ${res.status}. It may be down; do not retry more than once.`
    )
  }
  const body = (await res.json()) as {
    result?: { content?: { type: string; text?: string }[]; isError?: boolean }
    error?: { message?: string }
  }
  if (body.error)
    throw new Error(`Lockkeeper: ${body.error.message ?? "error"}`)
  const text = (body.result?.content ?? [])
    .map((part) => part.text ?? "")
    .join("\n")
  if (body.result?.isError) throw new Error(`Lockkeeper: ${text}`)
  return text
}
