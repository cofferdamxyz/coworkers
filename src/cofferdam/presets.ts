/**
 * The preset bots by name: what the UserHub provisions for the deployment's
 * owner and what each BotAgent applies to itself. A preset's floor and policy
 * are code; nothing a chat, a setting or a tool result says can loosen them.
 */
import type {
  ActionClass,
  ProactiveSettings,
  RulePolicy,
  Routine,
} from "@/lib/types"
import { PRESETS } from "./config"
import type { Preset } from "./config"
import {
  ENGINEERING_NAME,
  ENGINEERING_PROACTIVE,
  ENGINEERING_ROLE,
  ENGINEERING_ROUTINE,
  ENGINEERING_RULES,
  ENGINEERING_TOOL_RULES,
  engineeringPolicy,
} from "./engineering"
import {
  OPS_NAME,
  OPS_PROACTIVE,
  OPS_ROLE,
  OPS_ROUTINE,
  OPS_RULES,
  OPS_TOOL_RULES,
  OPS_ZKPASSPORT_ROUTINE,
  opsPolicy,
} from "./ops"
import {
  SECURITY_NAME,
  SECURITY_PROACTIVE,
  SECURITY_ROLE,
  SECURITY_ROUTINE,
  SECURITY_RULES,
  SECURITY_TOOL_RULES,
  securityPolicy,
} from "./security"

export interface PresetDef {
  name: string
  role: string
  /** The strictest each class may be set to. */
  rules: Record<ActionClass, RulePolicy>
  /** Tools stricter than their class. */
  toolRules: Record<string, RulePolicy>
  proactive: Partial<ProactiveSettings>
  routine: Omit<Routine, "id">
  /** Further routines of the preset, each synced on its own. */
  extraRoutines?: Omit<Routine, "id">[]
  /** The policy section, appended last to every turn's instructions. */
  policy: () => string
}

export const PRESET_DEFS: Record<Preset, PresetDef> = {
  engineering: {
    name: ENGINEERING_NAME,
    role: ENGINEERING_ROLE,
    rules: ENGINEERING_RULES,
    toolRules: ENGINEERING_TOOL_RULES,
    proactive: ENGINEERING_PROACTIVE,
    routine: ENGINEERING_ROUTINE,
    policy: engineeringPolicy,
  },
  security: {
    name: SECURITY_NAME,
    role: SECURITY_ROLE,
    rules: SECURITY_RULES,
    toolRules: SECURITY_TOOL_RULES,
    proactive: SECURITY_PROACTIVE,
    routine: SECURITY_ROUTINE,
    policy: securityPolicy,
  },
  ops: {
    name: OPS_NAME,
    role: OPS_ROLE,
    rules: OPS_RULES,
    toolRules: OPS_TOOL_RULES,
    proactive: OPS_PROACTIVE,
    routine: OPS_ROUTINE,
    extraRoutines: [OPS_ZKPASSPORT_ROUTINE],
    policy: opsPolicy,
  },
}

/**
 * What a preset's routine is in code, as one string: a bot stores the key it
 * last applied, and a change in code reaches it once, on the next hub start.
 */
export function routineKey(routine: Omit<Routine, "id">) {
  return JSON.stringify([
    routine.name,
    routine.kind,
    routine.when,
    routine.onlyNew === true,
    routine.prompt,
  ])
}

/**
 * A preset's routines with the storage key each one's applied routineKey is
 * kept under: the first keeps the key it always had, so bots provisioned
 * before extra routines existed do not sync it again. An extra routine's key
 * is its name: renaming one in code leaves bots with the old routine and adds
 * the new one, so delete the old one in the bot's settings after such a rename.
 */
export function presetRoutines(def: PresetDef) {
  return [
    { routine: def.routine, storageKey: "cofferdam_routine" },
    ...(def.extraRoutines ?? []).map((routine) => ({
      routine,
      storageKey: `cofferdam_routine:${routine.name}`,
    })),
  ]
}

export function isPreset(value: unknown): value is Preset {
  return (PRESETS as readonly unknown[]).includes(value)
}

const ORDER: Record<RulePolicy, number> = { allow: 0, ask: 1, block: 2 }

export function stricter(a: RulePolicy, b: RulePolicy): RulePolicy {
  return ORDER[a] >= ORDER[b] ? a : b
}

/**
 * The policy for one call by a preset bot. `own` is the bot's rule for the
 * call's class; `deploymentTool` tells this fork's GitHub and Lockkeeper tools
 * apart, whose read flag is fixed in code: their reads run without a card,
 * their writes always ask. Any other connected app's tools ask at least.
 */
export function presetPolicy(input: {
  preset: Preset
  tool?: string
  cls: ActionClass | undefined
  own: RulePolicy
  deploymentTool?: { readOnly: boolean }
}): RulePolicy {
  if (input.deploymentTool) {
    if (input.own === "block") return "block"
    return input.deploymentTool.readOnly ? "allow" : "ask"
  }
  const def = PRESET_DEFS[input.preset]
  const own =
    input.tool && def.toolRules[input.tool]
      ? stricter(input.own, def.toolRules[input.tool])
      : input.own
  if (!input.cls) return own
  return stricter(own, def.rules[input.cls])
}
