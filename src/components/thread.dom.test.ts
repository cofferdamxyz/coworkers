// @vitest-environment jsdom

import { createElement } from "react"
import { cleanup, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Thread } from "@/components/thread"
import { streamToken, syntheticThread } from "@/components/thread-fixture"
import { toBlocks } from "@/lib/message-parts"
import type { UIMessage } from "ai"
import type { BotState } from "@/lib/types"

// Every Markdown parse, by the text it was given.
const parsed: string[] = []
vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => {
    parsed.push(children)
    return createElement("p", null, children)
  },
  defaultUrlTransform: (url: string) => url,
}))

vi.mock("@/lib/message-parts", async (original) => {
  const actual = await original<typeof import("@/lib/message-parts")>()
  return { ...actual, toBlocks: vi.fn(actual.toBlocks) }
})

vi.mock("@tanstack/react-router", () => ({
  useHydrated: () => true,
  useLocation: () => "",
  Link: () => null,
}))

const BOT: Pick<BotState, "name" | "avatar" | "status"> = {
  name: "Bot",
  avatar: "blue-rectangle",
  status: "idle",
}

const TURNS = 40

function thread(messages: UIMessage[], busy: boolean) {
  return createElement(Thread, {
    bot: BOT,
    messages,
    busy,
    // New on every render, as the chat hook's handlers are.
    onApproval: () => {},
  })
}

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    }
  )
  vi.stubGlobal("matchMedia", () => ({ matches: true }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  parsed.length = 0
  vi.mocked(toBlocks).mockClear()
})

describe("Thread while a reply streams", () => {
  it("renders the history once", () => {
    render(thread(syntheticThread(TURNS), false))
    expect(parsed).toHaveLength(TURNS)
    expect(toBlocks).toHaveBeenCalledTimes(TURNS)
  })

  it("re-renders only the reply being written on each chunk", () => {
    let messages = syntheticThread(TURNS)
    const view = render(thread(messages, false))
    parsed.length = 0
    vi.mocked(toBlocks).mockClear()

    const chunks = ["The", " answer", " is", " 42."]
    for (const chunk of chunks) {
      messages = streamToken(messages, chunk)
      view.rerender(thread(messages, true))
    }

    // One parse per chunk, each of the growing reply and of nothing else.
    expect(parsed).toEqual([
      "The",
      "The answer",
      "The answer is",
      "The answer is 42.",
    ])
    expect(toBlocks).toHaveBeenCalledTimes(chunks.length)
    for (const [message] of vi.mocked(toBlocks).mock.calls) {
      expect(message.id).toBe("live")
    }
  })

  it("leaves the reply alone when the turn ends, and nothing above it", () => {
    let messages = syntheticThread(TURNS)
    const view = render(thread(messages, false))
    messages = streamToken(messages, "Done.")
    view.rerender(thread(messages, true))
    parsed.length = 0
    vi.mocked(toBlocks).mockClear()

    view.rerender(thread(messages, false))

    expect(parsed).toEqual([])
    expect(toBlocks).not.toHaveBeenCalled()
  })

  it("marks all but the newest rows as skippable off screen", () => {
    const view = render(thread(syntheticThread(TURNS), false))
    const rows = [...view.container.querySelectorAll(".thread-row")]
    expect(rows).toHaveLength(TURNS * 2)
    const kept = rows.filter((row) => !row.hasAttribute("data-skip"))
    expect(kept.length).toBeGreaterThan(0)
    expect(kept.length).toBeLessThan(10)
    // The rows always laid out are the last ones.
    expect(rows.slice(-kept.length)).toEqual(kept)
  })
})
