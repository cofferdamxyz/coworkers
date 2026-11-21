import { useEffect, useRef, useState } from "react"
import { RobotHead } from "robot-heads"
import type { RobotHeadState } from "robot-heads"
import { BOT_AVATARS, BOT_AVATAR_LOOKS } from "@/lib/types"
import type { BotAvatarKind, BotStatus } from "@/lib/types"

interface BotAvatarProps {
  avatar: BotAvatarKind
  size?: number
  status?: BotStatus
  /** Follow the pointer and hop on click. Off for small inline avatars. */
  interactive?: boolean
  /**
   * Draw the head once, at rest, and never animate it. For heads that
   * repeat in long lists, such as the ones inline in chat messages.
   */
  still?: boolean
  className?: string
}

const STATE_FOR_STATUS: Record<BotStatus, RobotHeadState> = {
  idle: "idle",
  thinking: "thinking",
  working: "working",
  action_needed: "listening",
}

function hash(value: string) {
  let h = 0
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) | 0
  return Math.abs(h)
}

/**
 * Whether the element is on screen. Every animated head redraws its canvas
 * on every frame, a few milliseconds each on a phone, so a head out of view
 * stops until it comes back. Starts as visible so the first paint animates.
 */
function useOnScreen(ref: React.RefObject<Element | null>, skip: boolean) {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const el = ref.current
    if (skip || !el || typeof IntersectionObserver === "undefined") return
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      // The canvas draws past its box; a margin keeps hops from cutting off.
      { rootMargin: "64px" }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, skip])
  return visible
}

/** A bot's face. Its LED screen and motion follow the bot's status. */
export function BotAvatar({
  avatar,
  size = 44,
  status = "idle",
  interactive = false,
  still = false,
  className,
}: BotAvatarProps) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const onScreen = useOnScreen(canvas, still)
  const h = hash(avatar)
  // Bots created before robot-heads stored other avatar names; give them a
  // stable look instead.
  const look =
    (
      BOT_AVATAR_LOOKS as Partial<
        Record<string, (typeof BOT_AVATAR_LOOKS)[BotAvatarKind]>
      >
    )[avatar] ?? BOT_AVATAR_LOOKS[BOT_AVATARS[h % BOT_AVATARS.length]]
  return (
    <RobotHead
      ref={canvas}
      shape={look.shape}
      color={look.color}
      state={STATE_FOR_STATUS[status]}
      size={size}
      interactive={interactive && !still}
      paused={still || !onScreen}
      floorShadow={size >= 56}
      antenna={false}
      seed={(h % 1000) / 1000}
      // Decorative: the bot's name and status are always in text beside it.
      aria-hidden="true"
      className={className}
      style={{ flexShrink: 0 }}
    />
  )
}
