// State
let sessions = [];
let activeSessionId = null;
let isStreaming = false;
let abortController = null;

// DOM
const sidebar = document.getElementById("sidebar");
const sidebarToggle = document.getElementById("sidebar-toggle");
const newChatBtn = document.getElementById("new-chat-btn");
const sessionList = document.getElementById("session-list");
const messagesEl = document.getElementById("messages");
const welcomeEl = document.getElementById("welcome");
const promptInput = document.getElementById("prompt-input");
const sendBtn = document.getElementById("send-btn");
const stopBtn = document.getElementById("stop-btn");
const authStatus = document.getElementById("auth-status");
const usage5h = document.getElementById("usage-5h");
const usage7d = document.getElementById("usage-7d");
const usage5hPct = document.getElementById("usage-5h-pct");
const usage7dPct = document.getElementById("usage-7d-pct");

// Get base path from Ingress
const basePath = (() => {
  const path = window.location.pathname;
  // Ingress paths look like /api/hassio_ingress/xxx/
  const match = path.match(/^(\/api\/hassio_ingress\/[^/]+)/);
  return match ? match[1] : "";
})();

function apiUrl(path) {
  return basePath + path;
}

// Markdown setup
marked.setOptions({
  highlight: (code, lang) => {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value;
    }
    return hljs.highlightAuto(code).value;
  },
  breaks: true,
});

// Sidebar toggle
sidebarToggle.addEventListener("click", () => {
  sidebar.classList.toggle("hidden");
});

// Auto-resize textarea
promptInput.addEventListener("input", () => {
  promptInput.style.height = "auto";
  promptInput.style.height = Math.min(promptInput.scrollHeight, 120) + "px";
});

// Send on Enter (Shift+Enter for newline)
promptInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

sendBtn.addEventListener("click", sendMessage);
stopBtn.addEventListener("click", stopStreaming);
newChatBtn.addEventListener("click", startNewChat);

// Load sessions
async function loadSessions() {
  try {
    const res = await fetch(apiUrl("/api/sessions"));
    sessions = await res.json();
    renderSessionList();
  } catch {
    sessions = [];
  }
}

function renderSessionList() {
  sessionList.innerHTML = sessions
    .map(
      (s) => `
    <div class="session-item ${s.id === activeSessionId ? "active" : ""}" data-id="${s.id}">
      <span class="session-title">${escapeHtml(s.title)}</span>
    </div>
  `,
    )
    .join("");

  sessionList.querySelectorAll(".session-item").forEach((el) => {
    el.addEventListener("click", () => loadSession(el.dataset.id));
  });
}

async function loadSession(id) {
  activeSessionId = id;
  renderSessionList();

  messagesEl.innerHTML = "";
  welcomeEl?.remove();

  try {
    const res = await fetch(apiUrl(`/api/sessions/${id}/messages`));
    const messages = await res.json();

    for (const msg of messages) {
      appendMessage(msg.role, msg.content, msg.toolUse);
    }
    scrollToBottom();
  } catch {
    appendSystemMessage("Failed to load session messages.");
  }
}

function startNewChat() {
  activeSessionId = null;
  renderSessionList();
  messagesEl.innerHTML = `
    <div id="welcome" class="welcome">
      <h2>Claude Code</h2>
      <p>Ask Claude to help with your Home Assistant setup, code, or anything else.</p>
    </div>
  `;
}

async function sendMessage() {
  const prompt = promptInput.value.trim();
  if (!prompt || isStreaming) return;

  // Remove welcome
  document.getElementById("welcome")?.remove();

  // Show user message
  appendMessage("user", prompt);
  promptInput.value = "";
  promptInput.style.height = "auto";

  // Start streaming
  isStreaming = true;
  sendBtn.style.display = "none";
  stopBtn.style.display = "flex";
  abortController = new AbortController();

  const sessionId = activeSessionId || "new";
  const assistantEl = createAssistantBubble();
  let fullText = "";

  try {
    const res = await fetch(apiUrl(`/api/sessions/${sessionId}/message`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
      signal: abortController.signal,
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          const data = line.slice(5).trim();
          if (!data) continue;
          try {
            const parsed = JSON.parse(data);
            handleSSEEvent(currentEvent, parsed, assistantEl, { getText: () => fullText, setText: (t) => (fullText = t) });
          } catch {}
          currentEvent = "";
        }
      }
    }
  } catch (err) {
    if (err.name !== "AbortError") {
      appendSystemMessage("Connection error: " + err.message);
    }
  }

  // Finalize
  assistantEl.querySelector(".content")?.classList.remove("streaming-cursor");
  isStreaming = false;
  sendBtn.style.display = "flex";
  stopBtn.style.display = "none";
  abortController = null;
  scrollToBottom();

  // Reload sessions to pick up new/updated session
  loadSessions();
}

function handleSSEEvent(type, data, el, textState) {
  const contentEl = el.querySelector(".content");

  if (type === "init" || data.sessionId) {
    if (data.sessionId && !activeSessionId) {
      activeSessionId = data.sessionId;
    }
  }

  if (type === "text_delta" && data.text) {
    textState.setText(textState.getText() + data.text);
    contentEl.innerHTML = marked.parse(textState.getText());
    contentEl.classList.add("streaming-cursor");
    scrollToBottom();
  }

  if (type === "tool_use") {
    const toolEl = document.createElement("div");
    toolEl.className = "tool-use";
    toolEl.innerHTML = `
      <div class="tool-use-header">${escapeHtml(data.name)}</div>
      <div class="tool-use-body">${escapeHtml(typeof data.input === "string" ? data.input : JSON.stringify(data.input, null, 2))}</div>
    `;
    toolEl.querySelector(".tool-use-header").addEventListener("click", () => {
      toolEl.classList.toggle("open");
    });
    el.appendChild(toolEl);
    scrollToBottom();
  }

  if (type === "rate_limit") {
    updateUsageDisplay(data);
  }

  if (type === "result") {
    contentEl.classList.remove("streaming-cursor");
    if (data.subtype !== "success" && data.errors?.length) {
      appendSystemMessage("Error: " + data.errors.join(", "));
    }
  }
}

function stopStreaming() {
  if (abortController) abortController.abort();
}

function createAssistantBubble() {
  const el = document.createElement("div");
  el.className = "message assistant";
  el.innerHTML = '<div class="content streaming-cursor"></div>';
  messagesEl.appendChild(el);
  scrollToBottom();
  return el;
}

function appendMessage(role, content, toolUse) {
  const el = document.createElement("div");
  el.className = `message ${role}`;

  if (role === "assistant") {
    el.innerHTML = `<div class="content">${marked.parse(content || "")}</div>`;
    if (toolUse?.length) {
      for (const tool of toolUse) {
        const toolEl = document.createElement("div");
        toolEl.className = "tool-use";
        toolEl.innerHTML = `
          <div class="tool-use-header">${escapeHtml(tool.name)}</div>
          <div class="tool-use-body">${escapeHtml(typeof tool.input === "string" ? tool.input : JSON.stringify(tool.input, null, 2))}</div>
        `;
        toolEl.querySelector(".tool-use-header").addEventListener("click", () => {
          toolEl.classList.toggle("open");
        });
        el.appendChild(toolEl);
      }
    }
  } else {
    el.textContent = content;
  }

  messagesEl.appendChild(el);
  scrollToBottom();
}

function appendSystemMessage(text) {
  const el = document.createElement("div");
  el.className = "message assistant";
  el.style.opacity = "0.7";
  el.style.fontStyle = "italic";
  el.textContent = text;
  messagesEl.appendChild(el);
  scrollToBottom();
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

// Usage display
function updateUsageDisplay(rateLimitInfo) {
  if (rateLimitInfo.rateLimitType === "five_hour" && rateLimitInfo.utilization != null) {
    const pct = Math.round(rateLimitInfo.utilization * 100);
    usage5h.style.width = pct + "%";
    usage5h.className = "usage-fill" + (pct > 80 ? " danger" : pct > 50 ? " warning" : "");
    usage5hPct.textContent = pct + "%";
  }
  if (
    (rateLimitInfo.rateLimitType === "seven_day" ||
      rateLimitInfo.rateLimitType === "seven_day_opus" ||
      rateLimitInfo.rateLimitType === "seven_day_sonnet") &&
    rateLimitInfo.utilization != null
  ) {
    const pct = Math.round(rateLimitInfo.utilization * 100);
    usage7d.style.width = pct + "%";
    usage7d.className = "usage-fill" + (pct > 80 ? " danger" : pct > 50 ? " warning" : "");
    usage7dPct.textContent = pct + "%";
  }
}

// Fetch cached usage on load
async function loadUsage() {
  try {
    const res = await fetch(apiUrl("/api/usage"));
    const data = await res.json();
    if (data.fiveHour) {
      const pct = Math.round(data.fiveHour.usedPercentage);
      usage5h.style.width = pct + "%";
      usage5h.className = "usage-fill" + (pct > 80 ? " danger" : pct > 50 ? " warning" : "");
      usage5hPct.textContent = pct + "%";
    }
    if (data.sevenDay) {
      const pct = Math.round(data.sevenDay.usedPercentage);
      usage7d.style.width = pct + "%";
      usage7d.className = "usage-fill" + (pct > 80 ? " danger" : pct > 50 ? " warning" : "");
      usage7dPct.textContent = pct + "%";
    }
  } catch {}
}

// Check auth
async function checkAuth() {
  authStatus.className = "auth-checking";
  authStatus.title = "Checking authentication...";
  try {
    const res = await fetch(apiUrl("/api/auth/status"));
    const data = await res.json();
    authStatus.className = data.authenticated ? "auth-ok" : "auth-error";
    authStatus.title = data.authenticated ? "Authenticated" : "Not authenticated — run 'claude login' in add-on terminal";
  } catch {
    authStatus.className = "auth-error";
    authStatus.title = "Cannot reach backend";
  }
}

// SSE parsing helper — parse raw SSE format properly
// The SSE stream has lines like:
//   event: text_delta
//   data: {"text":"hello"}
//   (blank line)
// We need to handle this properly in the reader loop.
// The current implementation in sendMessage handles this inline.

// Initialize
loadSessions();
loadUsage();
checkAuth();

// Close sidebar on mobile when tapping main area
document.getElementById("main").addEventListener("click", () => {
  if (window.innerWidth <= 768) {
    sidebar.classList.add("hidden");
  }
});
