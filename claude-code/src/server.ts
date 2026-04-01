import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { streamSSE } from "hono/streaming";
import {
  getSessions,
  getMessages,
  streamChat,
  checkAuth,
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

// API: Check auth status
app.get("/api/auth/status", async (c) => {
  const authenticated = await checkAuth();
  return c.json({ authenticated });
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
