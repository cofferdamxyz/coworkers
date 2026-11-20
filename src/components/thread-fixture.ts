import type { UIMessage } from "ai"

/**
 * A long synthetic chat for the thread's render tests: plain replies, lists,
 * fenced code, tables and tool steps, in the shapes the AI SDK streams them.
 */

const PROSE = [
  "Here is what I found. The **deploy** finished at 14:02 and the health check passed on the first try. Details are in [the run log](https://example.com/runs/42).",
  "Three things stand out:\n\n1. The cache hit rate dropped from 94% to 71%.\n2. Cold starts doubled after the last release.\n3. Nothing else moved.\n\nI would start with the cache.",
  "Done. I renamed the file and updated every import that pointed at it. `pnpm typecheck` is clean.",
  "## Summary\n\nThe report covers last week. Sign-ups are up, churn is flat.\n\n- New accounts: 412\n- Cancelled: 31\n- Net: 381\n\n> The spike on Thursday is the newsletter.",
]

const CODE =
  "```ts\nexport function total(items: Item[]) {\n  let sum = 0\n  for (const item of items) {\n    sum += item.price * item.quantity\n  }\n  return sum\n}\n```"

const TABLE =
  "| Region | Requests | Errors | p95 |\n| --- | ---: | ---: | ---: |\n| WEUR | 1,204,551 | 312 | 84 ms |\n| ENAM | 2,880,104 | 1,020 | 91 ms |\n| APAC | 640,220 | 97 | 133 ms |"

function step(id: string, command: string) {
  return {
    type: "tool-shell",
    toolCallId: id,
    state: "output-available",
    input: { command },
    output: { stdout: "ok\n", exitCode: 0 },
  }
}

/** `turns` user messages, each answered by the bot: twice as many messages. */
export function syntheticThread(turns: number, startAt = 1_800_000_000_000) {
  const messages: UIMessage[] = []
  for (let i = 0; i < turns; i++) {
    const at = startAt + i * 90_000
    messages.push({
      id: `u${i}`,
      role: "user",
      metadata: { at },
      parts: [{ type: "text", text: `Question ${i}: how did the run go?` }],
    })
    const parts: unknown[] = []
    if (i % 3 === 0) {
      parts.push(step(`c${i}a`, "pnpm test"), step(`c${i}b`, "git status"))
    }
    let text = PROSE[i % PROSE.length]
    if (i % 5 === 0) text += `\n\n${CODE}`
    if (i % 7 === 0) text += `\n\n${TABLE}`
    parts.push({ type: "text", text, state: "done" })
    messages.push({
      id: `a${i}`,
      role: "assistant",
      metadata: { at: at + 1000, durationMs: 4200 },
      parts: parts as UIMessage["parts"],
    })
  }
  return messages
}

/**
 * The next state of a chat whose last message grew by `token`, the way the
 * AI SDK's React store publishes it: a new array, a fresh copy of the
 * message being written, and every other message the same object as before.
 */
export function streamToken(messages: UIMessage[], token: string) {
  const last = messages[messages.length - 1]
  const writing = last.role === "assistant" && last.id === "live"
  const parts = writing ? last.parts.map((part) => ({ ...part })) : []
  const text = parts.at(-1)
  if (text?.type === "text") text.text += token
  else parts.push({ type: "text", text: token, state: "streaming" })
  const next: UIMessage = writing
    ? { ...last, parts }
    : { id: "live", role: "assistant", metadata: {}, parts }
  return writing ? [...messages.slice(0, -1), next] : [...messages, next]
}
