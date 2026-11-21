import { Link } from "@tanstack/react-router"
import { BotAvatar } from "@/components/bot-avatar"
import { useOptionalHub } from "@/lib/hub-context"

/**
 * A `coworkers://bot/<id>` link: the bot's face and current name, opening
 * its chat. A bot that is gone shows the name the link was written with,
 * and opens nothing.
 */
export function BotMention({
  botId,
  label,
  className = "",
}: {
  botId: string
  label: string
  className?: string
}) {
  const bot = useOptionalHub()?.state.bots.find((b) => b.id === botId)
  const fallback = label.replace(/^@/, "")
  if (!bot) {
    return <span className={`font-medium ${className}`}>@{fallback}</span>
  }
  return (
    <Link
      to="/bots/$botId"
      params={{ botId }}
      className={`inline-flex items-baseline gap-1 rounded-full font-medium decoration-1 underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-kumo-focus ${className}`}
    >
      <BotAvatar
        avatar={bot.avatar}
        size={16}
        // Mentions repeat down a chat; a moving head in each costs frames.
        still
        className="shrink-0 self-center"
      />
      {bot.name}
    </Link>
  )
}
