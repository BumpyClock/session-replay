import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  discoverCodexSessions,
  loadCodexSession,
  searchCodexSessions,
} from "../../server/providers/codex-provider"

describe("Codex provider", () => {
  let homeDirectory: string

  beforeEach(async () => {
    homeDirectory = await mkdtemp(join(tmpdir(), "codex-provider-test-"))
  })

  afterEach(async () => {
    await rm(homeDirectory, { force: true, recursive: true })
  })

  it("discovers sessions, loads one by session id, and filters search", async () => {
    const dayPath = join(homeDirectory, ".codex", "sessions", "2026", "04", "13")
    await mkdir(dayPath, { recursive: true })

    const sessionPath = join(dayPath, "rollout-2026-04-13T12-00-00-project-alpha.jsonl")
    await writeFile(
      sessionPath,
      [
        JSON.stringify({
          type: "session_meta",
          timestamp: "2026-04-13T12:00:00.000Z",
          payload: {
            cwd: "/Users/dev/projects/alpha",
          },
        }),
        JSON.stringify({
          type: "event_msg",
          timestamp: "2026-04-13T12:00:01.000Z",
          payload: { type: "task_started" },
        }),
        JSON.stringify({
          type: "event_msg",
          timestamp: "2026-04-13T12:00:02.000Z",
          payload: {
            type: "user_message",
            message: "## My request for Codex:\nList my backlog",
          },
        }),
        JSON.stringify({
          type: "response_item",
          timestamp: "2026-04-13T12:00:03.000Z",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "I can do that." }],
          },
        }),
        JSON.stringify({
          type: "response_item",
          timestamp: "2026-04-13T12:00:04.000Z",
          payload: {
            type: "function_call",
            name: "exec_command",
            call_id: "call-1",
            arguments: JSON.stringify({ cmd: "echo hello" }),
          },
        }),
        JSON.stringify({
          type: "response_item",
          timestamp: "2026-04-13T12:00:05.000Z",
          payload: {
            type: "function_call_output",
            call_id: "call-1",
            output: "done",
          },
        }),
        JSON.stringify({
          type: "event_msg",
          payload: { type: "task_complete" },
        }),
      ].join("\n"),
    )

    const sessions = await discoverCodexSessions(homeDirectory)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].project).toBe("alpha")
    expect(sessions[0].path).toBe(sessionPath)

    const loaded = await loadCodexSession({ sessionId: sessions[0].id, homeDirectory })
    expect(loaded.project).toBe("alpha")
    expect(loaded.cwd).toBe("/Users/dev/projects/alpha")
    expect(loaded.turns).toHaveLength(2)
    expect(loaded.turns[0].role).toBe("user")
    expect(loaded.turns[0].blocks[0]?.text).toBe("List my backlog")
    expect(loaded.turns[1].role).toBe("assistant")
    expect(loaded.turns[1].toolCalls?.at(0)?.name).toBe("Bash")

    const byProject = await searchCodexSessions(homeDirectory, {
      query: "alpha",
      limit: 10,
    })
    expect(byProject).toHaveLength(1)
    expect(byProject[0]?.id).toBe(sessions[0].id)

    const byText = await searchCodexSessions(homeDirectory, { query: "backlog" })
    expect(byText).toHaveLength(1)
  })
})
