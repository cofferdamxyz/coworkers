import { generateKeyPairSync, createVerify } from "node:crypto"
import { describe, expect, it, vi } from "vitest"
import { MAX_IN_FLIGHT } from "./config"
import {
  ENGINEERING_ROUTINE,
  ENGINEERING_RULES,
  engineeringPolicy,
  presetPolicy,
  stricter,
} from "./engineering"
import { appJwt, pemToPkcs8 } from "./github-app"
import { callLockkeeper } from "./lockkeeper"
import {
  GITHUB_CONNECTION,
  LOCKKEEPER_CONNECTION,
  cofferdamCatalog,
  cofferdamToolReadOnly,
  dispatchRefusal,
  forbiddenLabels,
  hasMandate,
  namedRepository,
} from "./tools"

const MANDATE = `Fix the overlay.

Repository: cofferdam-branding

**Mandate**
- Approved by: CofferdamDev
- Strength: explicit
- Rule: requested
- Judged under: workspace commit abc1234`

const labels = (...names: string[]) => names.map((name) => ({ name }))

describe("GitHub App keys", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  })

  it.each([
    ["PKCS#1, as GitHub hands it out", "pkcs1"],
    ["PKCS#8", "pkcs8"],
  ] as const)("signs a verifiable RS256 JWT from %s", async (_label, type) => {
    const pem = privateKey.export({ type, format: "pem" }) as string
    expect(pemToPkcs8(pem).length).toBeGreaterThan(1000)
    const jwt = await appJwt(
      { GITHUB_APP_ID: "123", GITHUB_APP_PRIVATE_KEY: pem },
      Date.UTC(2026, 10, 2)
    )
    const [header, payload, signature] = jwt.split(".")
    const verify = createVerify("RSA-SHA256")
    verify.update(`${header}.${payload}`)
    expect(verify.verify(publicKey, Buffer.from(signature, "base64url"))).toBe(
      true
    )
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString())
    expect(claims.iss).toBe("123")
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(600)
  })

  it("accepts a key pasted with literal \\n", async () => {
    const pem = (privateKey.export({ type: "pkcs1", format: "pem" }) as string)
      .trim()
      .replace(/\n/g, "\\n")
    await expect(
      appJwt({ GITHUB_APP_ID: "1", GITHUB_APP_PRIVATE_KEY: pem })
    ).resolves.toMatch(/^ey/)
  })
})

describe("dispatch", () => {
  const issue = {
    state: "open",
    labels: labels("engineering"),
    body: MANDATE,
  }

  it("reads the named repository from a label or the body", () => {
    expect(namedRepository(["repo:cofferdam-app"], "")).toBe("cofferdam-app")
    expect(namedRepository([], MANDATE)).toBe("cofferdam-branding")
    expect(namedRepository([], "Repository: `cofferdamxyz/lockkeeper`")).toBe(
      "lockkeeper"
    )
    expect(namedRepository(["repo:somewhere-else"], "")).toBeNull()
    expect(namedRepository([], "no repository here")).toBeNull()
  })

  it("finds a Mandate block", () => {
    expect(hasMandate(MANDATE)).toBe(true)
    expect(hasMandate("## Mandate\n- Approved by: x")).toBe(true)
    expect(hasMandate("The mandate is implied.")).toBe(false)
  })

  it("allows a complete issue within the limits", () => {
    expect(dispatchRefusal(issue, ["dispatch"], [])).toBeNull()
  })

  it("refuses without a lane label, a Mandate or a repository", () => {
    expect(dispatchRefusal({ ...issue, labels: [] }, ["dispatch"], [])).toMatch(
      /lane label/
    )
    expect(
      dispatchRefusal(
        { ...issue, body: "Repository: cofferdam-app" },
        ["dispatch"],
        []
      )
    ).toMatch(/Mandate/)
    expect(
      dispatchRefusal(
        { ...issue, body: "**Mandate**\n- Approved by: x" },
        ["dispatch"],
        []
      )
    ).toMatch(/names no repository/)
  })

  it("refuses closed issues, pull requests and issues already in a state", () => {
    expect(dispatchRefusal({ ...issue, state: "closed" }, [], [])).toMatch(
      /closed/
    )
    expect(dispatchRefusal({ ...issue, pull_request: {} }, [], [])).toMatch(
      /pull request/
    )
    expect(
      dispatchRefusal(
        { ...issue, labels: labels("engineering", "blocked") },
        [],
        []
      )
    ).toMatch(/already/)
  })

  it("holds the in-flight limits across and per repository", () => {
    const other = (n: number, repo: string) => ({
      number: n,
      labels: labels("engineering", "dispatched", `repo:${repo}`),
      body: "",
    })
    expect(
      dispatchRefusal(issue, [], [other(1, "cofferdam-branding")])
    ).toMatch(/already has a dispatched issue in flight \(#1\)/)
    expect(dispatchRefusal(issue, [], [other(1, "cofferdam-app")])).toBeNull()
    const full = Array.from({ length: MAX_IN_FLIGHT }, (_, i) =>
      other(i + 1, "cofferdam-app")
    )
    expect(dispatchRefusal(issue, [], full)).toMatch(/in-flight limit/)
  })

  it("never lets a bot set the routine's labels, nor dispatch on a new issue", () => {
    expect(forbiddenLabels(["engineering", "dispatched"], true)).toEqual([
      "dispatched",
    ])
    expect(forbiddenLabels(["engineering", "dispatch"], false)).toEqual([
      "dispatch",
    ])
    expect(forbiddenLabels(["engineering", "dispatch"], true)).toEqual([])
  })
})

describe("Engineering rules", () => {
  it("never goes looser than the floor", () => {
    expect(stricter("allow", "ask")).toBe("ask")
    expect(presetPolicy({ cls: "shell", own: "allow" })).toBe("block")
    expect(presetPolicy({ cls: "email", own: "allow" })).toBe("block")
    expect(presetPolicy({ cls: "apps", own: "allow" })).toBe("ask")
    expect(presetPolicy({ cls: "files", own: "block" })).toBe("block")
    expect(presetPolicy({ cls: "browse", own: "allow" })).toBe("allow")
  })

  it("lets deployment reads run and makes every deployment write ask", () => {
    const read = { readOnly: true }
    const write = { readOnly: false }
    expect(
      presetPolicy({ cls: "apps", own: "ask", deploymentTool: read })
    ).toBe("allow")
    expect(
      presetPolicy({ cls: "apps", own: "allow", deploymentTool: write })
    ).toBe("ask")
    expect(
      presetPolicy({ cls: "apps", own: "block", deploymentTool: read })
    ).toBe("block")
  })

  it("blocks scripts, the browser and managing bots", () => {
    expect(ENGINEERING_RULES.shell).toBe("block")
    expect(ENGINEERING_RULES.browser).toBe("block")
    expect(ENGINEERING_RULES.manage).toBe("block")
  })

  it("states the policy with its limits and the admission rule", () => {
    const policy = engineeringPolicy()
    expect(policy.startsWith("# Cofferdam policy")).toBe(true)
    expect(policy).toContain(`${MAX_IN_FLIGHT} dispatched issues in flight`)
    expect(policy).toContain("cofferdamxyz/cofferdam")
    expect(policy).toMatch(/never edit a repository's source/)
    expect(policy).toMatch(/changes no permission/)
  })

  it("schedules the check-in on weekday mornings, read-only", () => {
    expect(ENGINEERING_ROUTINE.when).toBe("30 8 * * 1-5")
    expect(ENGINEERING_ROUTINE.prompt).toMatch(/read only/)
  })
})

describe("catalog", () => {
  it("offers nothing until a connection's secrets are there", () => {
    const empty = cofferdamCatalog({})
    expect(empty.tools).toEqual([])
    expect(empty.apps.every((a) => a.status === "failed")).toBe(true)
  })

  it("lists each connection once its secrets are there, read flags fixed", () => {
    const catalog = cofferdamCatalog({
      LOCKKEEPER_URL: "https://lockkeeper.example",
      LOCKKEEPER_ACCESS_CLIENT_ID: "id",
      LOCKKEEPER_ACCESS_CLIENT_SECRET: "secret",
    })
    expect(catalog.tools.map((t) => t.name).sort()).toEqual([
      "brief",
      "check",
      "in_flight",
    ])
    expect(catalog.tools.every((t) => t.readOnly)).toBe(true)
    expect(cofferdamToolReadOnly(GITHUB_CONNECTION, "list_issues")).toBe(true)
    expect(cofferdamToolReadOnly(GITHUB_CONNECTION, "add_labels")).toBe(false)
    expect(cofferdamToolReadOnly(GITHUB_CONNECTION, "unknown")).toBe(false)
    expect(cofferdamToolReadOnly(LOCKKEEPER_CONNECTION, "claim")).toBe(false)
  })
})

describe("Lockkeeper", () => {
  const env = {
    LOCKKEEPER_URL: "https://lockkeeper.example/",
    LOCKKEEPER_ACCESS_CLIENT_ID: "client-id",
    LOCKKEEPER_ACCESS_CLIENT_SECRET: "client-secret",
  }

  it("refuses the write tools", async () => {
    const fetcher = vi.fn()
    await expect(
      callLockkeeper(env, "claim", { repo: "cofferdam" }, fetcher)
    ).rejects.toThrow(/not available/)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("calls a read tool with the service token and returns its text", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: { content: [{ type: "text", text: "2 branches in flight" }] },
      })
    )
    const text = await callLockkeeper(
      env,
      "in_flight",
      {},
      fetcher as unknown as typeof fetch
    )
    expect(text).toBe("2 branches in flight")
    const [url, init] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe("https://lockkeeper.example/mcp")
    const headers = init.headers as Record<string, string>
    expect(headers["cf-access-client-id"]).toBe("client-id")
    expect(JSON.parse(init.body as string).params.name).toBe("in_flight")
  })

  it("says so when the token is refused", async () => {
    const fetcher = vi.fn(async () => new Response("", { status: 403 }))
    await expect(
      callLockkeeper(env, "brief", { repo: "cofferdam" }, fetcher as never)
    ).rejects.toThrow(/refused the service token/)
  })
})

describe("Engineering tool floor", () => {
  it("asks before the bot writes a skill or an app into itself", () => {
    expect(
      presetPolicy({ tool: "save_skill", cls: "files", own: "allow" })
    ).toBe("ask")
    expect(presetPolicy({ tool: "write", cls: "files", own: "allow" })).toBe(
      "allow"
    )
  })

  it("counts held and waiting issues against the per-repository limit", () => {
    const waiting = {
      number: 7,
      labels: labels("engineering", "waiting", "repo:cofferdam-branding"),
      body: "",
    }
    expect(
      dispatchRefusal(
        { state: "open", labels: labels("engineering"), body: MANDATE },
        [],
        [waiting]
      )
    ).toMatch(/#7/)
  })
})
