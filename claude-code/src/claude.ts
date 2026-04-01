import {
  query,
  listSessions,
  getSessionMessages,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { updateUsageFromRateLimit } from "./usage";
import type { SessionInfo } from "./types";

const WORKING_DIR = process.env.CLAUDE_WORKING_DIR || "/config";

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
    if (message.type === "system" && (message as any).subtype === "init") {
      yield {
        type: "init",
        data: {
          sessionId: message.session_id,
          model: (message as any).model,
        },
      };
    } else if (message.type === "stream_event") {
      const event = (message as any).event;
      if (
        event?.type === "content_block_delta" &&
        event?.delta?.type === "text_delta"
      ) {
        yield { type: "text_delta", data: { text: event.delta.text } };
      }
    } else if (message.type === "assistant") {
      const content = (message as any).message?.content || [];
      for (const block of content) {
        if (block.type === "tool_use") {
          yield {
            type: "tool_use",
            data: { name: block.name, input: block.input },
          };
        }
      }
    } else if (message.type === "result") {
      const msg = message as any;
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
    } else if (message.type === "rate_limit_event") {
      const info = (message as any).rate_limit_info;
      if (info) {
        updateUsageFromRateLimit(info);
        yield { type: "rate_limit", data: info };
      }
    }
  }
}

export async function checkAuth(): Promise<boolean> {
  try {
    const conversation = query({
      prompt: "echo test",
      options: {
        cwd: WORKING_DIR,
        maxTurns: 1,
        model: "claude-haiku-4-5-20251001",
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
