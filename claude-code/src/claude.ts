import {
  query,
  listSessions,
  getSessionMessages,
  renameSession,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { updateUsageFromRateLimit } from "./usage";
import type { SessionInfo } from "./types";
import { unlink } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const WORKING_DIR = process.env.CLAUDE_WORKING_DIR || "/config";

// Claude stores sessions in ~/.claude/projects/<project-hash>/<session-id>.jsonl
function getProjectDir(): string | null {
  const claudeDir = join(process.env.HOME || "/data", ".claude", "projects");
  if (!existsSync(claudeDir)) return null;
  const dirs = readdirSync(claudeDir);
  // Find the directory matching our working dir
  for (const dir of dirs) {
    const full = join(claudeDir, dir);
    // Project hash is the cwd with non-alphanumeric chars replaced by -
    if (WORKING_DIR.replace(/[^a-zA-Z0-9]/g, "-").includes(dir.slice(0, 10))) {
      return full;
    }
  }
  // Return first dir as fallback
  return dirs.length > 0 ? join(claudeDir, dirs[0]) : null;
}

export async function getSessions(): Promise<SessionInfo[]> {
  try {
    const sessions = await listSessions({ dir: WORKING_DIR, limit: 50 });
    return sessions.map((s) => ({
      id: s.sessionId,
      title: s.customTitle || s.summary || s.firstPrompt || "Untitled",
      createdAt: s.createdAt || s.lastModified,
      lastModified: s.lastModified,
      messageCount: 0,
    }));
  } catch {
    return [];
  }
}

export async function deleteSession(sessionId: string): Promise<boolean> {
  try {
    const projectDir = getProjectDir();
    if (!projectDir) return false;
    const sessionFile = join(projectDir, `${sessionId}.jsonl`);
    if (existsSync(sessionFile)) {
      await unlink(sessionFile);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function getMessages(sessionId: string) {
  try {
    const messages = await getSessionMessages(sessionId, {
      dir: WORKING_DIR,
      includeSystemMessages: false,
    });
    return messages;
  } catch {
    return [];
  }
}

export async function* streamChat(
  prompt: string,
  sessionId?: string,
): AsyncGenerator<{ type: string; data: unknown }> {
  const options: Record<string, unknown> = {
    model: "claude-sonnet-4-6",
    cwd: WORKING_DIR,
    includePartialMessages: true,
    permissionMode: "acceptEdits",
    allowedTools: [
      "Read",
      "Edit",
      "Write",
      "Bash",
      "Glob",
      "Grep",
      "WebFetch",
    ],
  };

  if (sessionId) {
    options.resume = sessionId;
  }

  const conversation = query({ prompt, options });

  for await (const message of conversation) {
    const msg = message as any;

    switch (message.type) {
      case "system":
        if (msg.subtype === "init") {
          yield {
            type: "init",
            data: {
              sessionId: message.session_id,
              model: msg.model,
            },
          };
        } else if (msg.subtype === "status") {
          yield {
            type: "status",
            data: { message: msg.message || msg.status || "Working..." },
          };
        }
        break;

      case "stream_event": {
        const event = msg.event;
        if (
          event?.type === "content_block_delta" &&
          event?.delta?.type === "text_delta"
        ) {
          yield { type: "text_delta", data: { text: event.delta.text } };
        } else if (
          event?.type === "content_block_delta" &&
          event?.delta?.type === "thinking_delta"
        ) {
          yield {
            type: "thinking_delta",
            data: { text: event.delta.thinking },
          };
        } else if (event?.type === "content_block_start") {
          if (event?.content_block?.type === "thinking") {
            yield { type: "thinking_start", data: {} };
          } else if (event?.content_block?.type === "tool_use") {
            yield {
              type: "tool_start",
              data: {
                name: event.content_block.name,
                id: event.content_block.id,
              },
            };
          }
        } else if (event?.type === "content_block_stop") {
          yield { type: "block_stop", data: {} };
        }
        break;
      }

      case "assistant": {
        const content = msg.message?.content || [];
        for (const block of content) {
          if (block.type === "tool_use") {
            yield {
              type: "tool_use",
              data: { name: block.name, input: block.input, id: block.id },
            };
          } else if (block.type === "tool_result") {
            const text =
              typeof block.content === "string"
                ? block.content
                : Array.isArray(block.content)
                  ? block.content
                      .filter((b: any) => b.type === "text")
                      .map((b: any) => b.text)
                      .join("")
                  : "";
            yield {
              type: "tool_result",
              data: {
                tool_use_id: block.tool_use_id,
                content: text.slice(0, 500),
              },
            };
          }
        }
        break;
      }

      case "tool_progress":
        yield {
          type: "tool_progress",
          data: {
            tool_name: msg.tool_name || msg.name,
            message: msg.message || msg.progress || "",
          },
        };
        break;

      case "tool_use_summary":
        yield {
          type: "tool_summary",
          data: {
            tool_name: msg.tool_name || msg.name,
            summary: msg.summary || "",
          },
        };
        break;

      case "result": {
        yield {
          type: "result",
          data: {
            subtype: msg.subtype,
            result: msg.result,
            sessionId: msg.session_id,
            cost: msg.total_cost_usd,
            usage: msg.usage,
            numTurns: msg.num_turns,
            errors: msg.errors,
          },
        };
        break;
      }

      case "rate_limit_event": {
        const info = msg.rate_limit_info;
        if (info) {
          updateUsageFromRateLimit(info);
          yield { type: "rate_limit", data: info };
        }
        break;
      }
    }
  }
}

export async function checkAuth(): Promise<boolean> {
  try {
    // Use persistSession: false to avoid creating "ghost" sessions
    const conversation = query({
      prompt: "ok",
      options: {
        cwd: WORKING_DIR,
        maxTurns: 1,
        model: "claude-haiku-4-5-20251001",
        persistSession: false,
      },
    });

    for await (const message of conversation) {
      if (message.type === "system" && (message as any).subtype === "init") {
        conversation.close();
        return true;
      }
      if (message.type === "result") {
        return !(message as any).is_error;
      }
    }
    return true;
  } catch {
    return false;
  }
}
