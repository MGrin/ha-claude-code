import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { streamSSE } from "hono/streaming";
import {
  getSessions,
  getMessages,
  streamChat,
  deleteSession,
} from "./claude";
import { getUsage } from "./usage";

const app = new Hono();

// Serve static files (UI) with no-cache headers
app.use("/public/*", async (c, next) => {
  c.header("Cache-Control", "no-cache, no-store, must-revalidate");
  c.header("Pragma", "no-cache");
  c.header("Expires", "0");
  await next();
});
app.use("/public/*", serveStatic({ root: "./" }));

// API: List sessions
app.get("/api/sessions", async (c) => {
  const sessions = await getSessions();
  return c.json(sessions);
});

// API: Delete session
app.delete("/api/sessions/:id", async (c) => {
  const id = c.req.param("id");
  const ok = await deleteSession(id);
  return c.json({ ok });
});

// API: Get session messages
app.get("/api/sessions/:id/messages", async (c) => {
  const id = c.req.param("id");
  const messages = await getMessages(id);

  const formatted = messages
    .filter((m: any) => m.type === "user" || m.type === "assistant")
    .map((m: any) => {
      if (m.type === "user") {
        const text =
          typeof m.message?.content === "string"
            ? m.message.content
            : m.message?.content
                ?.filter((b: any) => b.type === "text")
                .map((b: any) => b.text)
                .join("") || "";
        return { role: "user", content: text };
      }
      const content = m.message?.content || [];
      const text = content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("");
      const toolUse = content
        .filter((b: any) => b.type === "tool_use")
        .map((b: any) => ({ name: b.name, input: b.input }));
      return { role: "assistant", content: text, toolUse };
    });

  return c.json(formatted);
});

// API: Send message (SSE streaming)
app.post("/api/sessions/:id/message", async (c) => {
  const sessionId = c.req.param("id");
  const body = await c.req.json<{ prompt: string }>();
  const resumeId = sessionId === "new" ? undefined : sessionId;

  return streamSSE(c, async (stream) => {
    try {
      for await (const event of streamChat(body.prompt, resumeId)) {
        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event.data),
        });
      }
    } catch (err: any) {
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ message: err.message || "Unknown error" }),
      });
    }
  });
});

// API: Get usage info
app.get("/api/usage", (c) => {
  return c.json(getUsage());
});

// API: Check auth status — uses `claude auth status`
app.get("/api/auth/status", async (c) => {
  try {
    const proc = Bun.spawn(["claude", "auth", "status"], {
      env: { ...process.env, HOME: "/data" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode === 0) {
      try {
        const data = JSON.parse(output);
        return c.json({
          authenticated: data.loggedIn === true,
          email: data.email,
          subscription: data.subscriptionType,
          authMethod: data.authMethod,
        });
      } catch {
        return c.json({ authenticated: true });
      }
    }
    return c.json({ authenticated: false });
  } catch {
    return c.json({ authenticated: false });
  }
});

// API: Initiate login — runs `claude auth login` and captures the OAuth URL
app.post("/api/auth/login", async (c) => {
  return streamSSE(c, async (stream) => {
    try {
      const proc = Bun.spawn(["claude", "auth", "login", "--claudeai"], {
        env: { ...process.env, HOME: "/data", BROWSER: "echo" },
        stdout: "pipe",
        stderr: "pipe",
      });

      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      let output = "";
      const timeout = setTimeout(() => {
        proc.kill();
      }, 120_000);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        output += chunk;

        // Look for URLs in the output
        const urlMatch = chunk.match(
          /https:\/\/[^\s]+/,
        );
        if (urlMatch) {
          await stream.writeSSE({
            event: "auth_url",
            data: JSON.stringify({ url: urlMatch[0] }),
          });
        }

        await stream.writeSSE({
          event: "output",
          data: JSON.stringify({ text: chunk }),
        });
      }

      clearTimeout(timeout);
      const exitCode = await proc.exited;

      await stream.writeSSE({
        event: "done",
        data: JSON.stringify({
          success: exitCode === 0,
          output,
        }),
      });
    } catch (err: any) {
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ message: err.message }),
      });
    }
  });
});

// API: Set credentials directly (for environments where OAuth callback can't work)
// Accepts both Ingress (no auth needed) and Bearer token auth
app.post("/api/auth/credentials", async (c) => {
  // Verify the request comes from either Ingress (172.30.32.2) or has a valid Supervisor token
  const authHeader = c.req.header("Authorization");
  const remoteIp = c.req.header("X-Forwarded-For") || c.req.header("X-Real-IP") || "";
  const isIngress = remoteIp.includes("172.30.32");
  const hasSupervisorToken = authHeader && authHeader.startsWith("Bearer ") &&
    process.env.SUPERVISOR_TOKEN && authHeader.slice(7) === process.env.SUPERVISOR_TOKEN;

  // Also accept any valid HA long-lived token by checking with HA API
  let hasValidHaToken = false;
  if (authHeader && authHeader.startsWith("Bearer ") && !hasSupervisorToken) {
    try {
      const res = await fetch("http://supervisor/core/api/", {
        headers: { Authorization: authHeader },
      });
      hasValidHaToken = res.ok;
    } catch {}
  }

  if (!isIngress && !hasSupervisorToken && !hasValidHaToken) {
    return c.json({ ok: false, error: "Unauthorized" }, 401);
  }

  try {
    const body = await c.req.json();
    const credDir = "/data/.claude";
    const credPath = credDir + "/.credentials.json";
    // Ensure directory exists
    const { mkdirSync, existsSync } = await import("node:fs");
    if (!existsSync(credDir)) mkdirSync(credDir, { recursive: true });
    await Bun.write(credPath, JSON.stringify(body, null, 2));
    return c.json({ ok: true });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

// Serve main UI for all other routes (SPA)
app.get("*", async (c) => {
  const html = await Bun.file("./public/index.html").text();
  return c.html(html);
});

const port = parseInt(process.env.INGRESS_PORT || "5100");

console.log(`Claude Code HA Add-on starting on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};
