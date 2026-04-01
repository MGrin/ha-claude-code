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
sidebarToggle.addEventListener("click", () => sidebar.classList.toggle("hidden"));

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

// ============================================================
// Sessions
// ============================================================

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
  // Build session HTML
  let html = "";
  if (sessions.length > 0) {
    html += '<div class="session-actions"><button id="clear-all-btn" class="clear-all-btn">Clear All Sessions</button></div>';
  }
  for (const s of sessions) {
    const active = s.id === activeSessionId ? "active" : "";
    const title = escapeHtml(s.title);
    html += `<div class="session-item ${active}" data-id="${s.id}">
      <span class="session-title">${title}</span>
      <button class="session-delete" data-sid="${s.id}" title="Delete">x</button>
    </div>`;
  }
  sessionList.innerHTML = html;

  // Bind session click
  sessionList.querySelectorAll(".session-item").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest(".session-delete")) return;
      loadSession(el.dataset.id);
    });
  });

  // Bind delete buttons
  sessionList.querySelectorAll(".session-delete").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteSessionUI(btn.dataset.sid);
    });
  });

  // Bind clear all
  const clearBtn = document.getElementById("clear-all-btn");
  if (clearBtn) {
    clearBtn.addEventListener("click", clearAllSessions);
  }
}

async function deleteSessionUI(id) {
  if (!confirm("Delete this session?")) return;
  try {
    await fetch(apiUrl(`/api/sessions/${id}`), { method: "DELETE" });
    if (activeSessionId === id) startNewChat();
    await loadSessions();
  } catch {
    appendSystemMessage("Failed to delete session.");
  }
}

async function clearAllSessions() {
  if (!confirm("Delete ALL sessions? This cannot be undone.")) return;
  try {
    for (const s of [...sessions]) {
      await fetch(apiUrl(`/api/sessions/${s.id}`), { method: "DELETE" });
    }
    startNewChat();
    await loadSessions();
  } catch {
    appendSystemMessage("Failed to delete some sessions.");
    await loadSessions();
  }
}

async function loadSession(id) {
  activeSessionId = id;
  renderSessionList();
  messagesEl.innerHTML = "";

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

// ============================================================
// Sending messages
// ============================================================

async function sendMessage() {
  const prompt = promptInput.value.trim();
  if (!prompt || isStreaming) return;

  // Handle slash commands locally
  if (prompt.startsWith("/")) {
    const cmd = prompt.slice(1).split(/\s+/)[0].toLowerCase();
    const args = prompt.slice(1 + cmd.length).trim();
    if (cmd === "login") {
      promptInput.value = "";
      if (args) {
        // User pasted credentials JSON
        await setCredentials(args);
      } else {
        await initiateLogin();
      }
      return;
    }
    if (cmd === "logout") {
      appendSystemMessage("Logout is not yet supported from the UI.");
      promptInput.value = "";
      return;
    }
  }

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
  let thinkingText = "";
  let isThinking = false;
  let statusEl = null;

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
            handleEvent(currentEvent, parsed);
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
  removeStatusIndicator();
  assistantEl.querySelector(".content")?.classList.remove("streaming-cursor");
  const thinkingEl = assistantEl.querySelector(".thinking-block");
  if (thinkingEl) thinkingEl.classList.remove("active");
  isStreaming = false;
  sendBtn.style.display = "flex";
  stopBtn.style.display = "none";
  abortController = null;
  scrollToBottom();
  loadSessions();

  function handleEvent(type, data) {
    const contentEl = assistantEl.querySelector(".content");

    switch (type) {
      case "init":
        if (data.sessionId && !activeSessionId) {
          activeSessionId = data.sessionId;
        }
        showStatus("Connected — model: " + (data.model || "claude"));
        break;

      case "thinking_start":
        isThinking = true;
        thinkingText = "";
        ensureThinkingBlock(assistantEl);
        break;

      case "thinking_delta":
        if (data.text) {
          thinkingText += data.text;
          updateThinkingBlock(assistantEl, thinkingText);
          scrollToBottom();
        }
        break;

      case "text_delta":
        if (data.text) {
          if (isThinking) {
            isThinking = false;
            const tb = assistantEl.querySelector(".thinking-block");
            if (tb) tb.classList.remove("active");
          }
          removeStatusIndicator();
          fullText += data.text;
          contentEl.innerHTML = marked.parse(fullText);
          contentEl.classList.add("streaming-cursor");
          scrollToBottom();
        }
        break;

      case "tool_start":
        showStatus(`Using tool: ${data.name}...`);
        break;

      case "tool_use": {
        const toolEl = createToolBlock(data.name, data.input);
        assistantEl.insertBefore(toolEl, contentEl.nextSibling);
        showStatus(`Running ${data.name}...`);
        scrollToBottom();
        break;
      }

      case "tool_result": {
        const lastTool = assistantEl.querySelector(".tool-use:last-of-type");
        if (lastTool) {
          const body = lastTool.querySelector(".tool-use-body");
          if (body && data.content) {
            body.textContent += "\n--- Result ---\n" + data.content;
          }
        }
        break;
      }

      case "tool_progress":
        showStatus(`${data.tool_name}: ${data.message}`);
        break;

      case "tool_summary":
        showStatus(`${data.tool_name}: ${data.summary}`);
        break;

      case "status":
        showStatus(data.message);
        break;

      case "rate_limit":
        updateUsageDisplay(data);
        break;

      case "result":
        removeStatusIndicator();
        contentEl.classList.remove("streaming-cursor");
        if (data.subtype !== "success" && data.errors?.length) {
          appendSystemMessage("Error: " + data.errors.join(", "));
        }
        if (data.cost != null) {
          showStatus(`Done — $${data.cost.toFixed(4)} · ${data.numTurns || 1} turns`);
          setTimeout(removeStatusIndicator, 5000);
        }
        break;

      case "error":
        appendSystemMessage("Error: " + (data.message || "Unknown error"));
        break;

      case "block_stop":
        break;
    }
  }

  function showStatus(text) {
    if (!statusEl) {
      statusEl = document.createElement("div");
      statusEl.className = "status-indicator";
      assistantEl.appendChild(statusEl);
    }
    statusEl.textContent = text;
    scrollToBottom();
  }

  function removeStatusIndicator() {
    if (statusEl) {
      statusEl.remove();
      statusEl = null;
    }
  }
}

function stopStreaming() {
  if (abortController) abortController.abort();
}

// ============================================================
// UI helpers
// ============================================================

function createAssistantBubble() {
  const el = document.createElement("div");
  el.className = "message assistant";
  el.innerHTML = '<div class="content streaming-cursor"></div>';
  messagesEl.appendChild(el);
  scrollToBottom();
  return el;
}

function ensureThinkingBlock(parentEl) {
  let block = parentEl.querySelector(".thinking-block");
  if (!block) {
    block = document.createElement("div");
    block.className = "thinking-block active";
    block.innerHTML =
      '<div class="thinking-header">Thinking...</div><div class="thinking-body"></div>';
    block.querySelector(".thinking-header").addEventListener("click", () => {
      block.classList.toggle("expanded");
    });
    parentEl.insertBefore(block, parentEl.querySelector(".content"));
  }
  block.classList.add("active");
  return block;
}

function updateThinkingBlock(parentEl, text) {
  const block = parentEl.querySelector(".thinking-block");
  if (block) {
    block.querySelector(".thinking-body").textContent = text;
  }
}

function createToolBlock(name, input) {
  const el = document.createElement("div");
  el.className = "tool-use";
  const inputStr =
    typeof input === "string" ? input : JSON.stringify(input, null, 2);
  el.innerHTML = `
    <div class="tool-use-header">${escapeHtml(name)}</div>
    <div class="tool-use-body">${escapeHtml(inputStr)}</div>
  `;
  el.querySelector(".tool-use-header").addEventListener("click", () => {
    el.classList.toggle("open");
  });
  return el;
}

function appendMessage(role, content, toolUse) {
  const el = document.createElement("div");
  el.className = `message ${role}`;

  if (role === "assistant") {
    el.innerHTML = `<div class="content">${marked.parse(content || "")}</div>`;
    if (toolUse?.length) {
      for (const tool of toolUse) {
        el.appendChild(createToolBlock(tool.name, tool.input));
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
  el.className = "message system-message";
  el.innerHTML = marked.parse(text);
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

// ============================================================
// Usage display
// ============================================================

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

async function checkAuth() {
  authStatus.className = "auth-checking";
  authStatus.title = "Checking authentication...";
  try {
    const res = await fetch(apiUrl("/api/auth/status"));
    const data = await res.json();
    authStatus.className = data.authenticated ? "auth-ok" : "auth-error";
    if (data.authenticated) {
      authStatus.title = `Authenticated: ${data.email || ""} (${data.subscription || ""})`;
    } else {
      authStatus.title = "Not authenticated — type /login";
    }
  } catch {
    authStatus.className = "auth-error";
    authStatus.title = "Cannot reach backend";
  }
}

// ============================================================
// Login flow
// ============================================================

async function initiateLogin() {
  appendSystemMessage(
    "**Authentication options:**\n\n" +
    "**Option 1 — Transfer from your computer:**\n" +
    "On your Mac/Linux where Claude Code is already logged in, run:\n\n" +
    "```\nsecurity find-generic-password -s 'Claude Code-credentials' -w\n```\n\n" +
    "Copy the entire output, then type:\n`/login {paste the JSON here}`\n\n" +
    "**Option 2 — On Linux**, copy `~/.claude/.credentials.json` content and use `/login {paste}`\n\n" +
    "**Option 3 — OAuth (may not work in containers):**\n" +
    "Starting OAuth flow..."
  );

  try {
    const res = await fetch(apiUrl("/api/auth/login"), { method: "POST" });
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
            if (currentEvent === "auth_url" && parsed.url) {
              appendSystemMessage(`**OAuth link:** [Open to authenticate](${parsed.url})\n\n(After authenticating, if you see an error page, the OAuth callback couldn't reach the container. Use Option 1 instead.)`);
            } else if (currentEvent === "done" && parsed.success) {
              appendSystemMessage("Authentication successful!");
              checkAuth();
            }
          } catch {}
          currentEvent = "";
        }
      }
    }
  } catch (err) {
    appendSystemMessage("OAuth flow failed: " + err.message + "\n\nUse Option 1 (credential transfer) instead.");
  }
}

async function setCredentials(input) {
  try {
    let creds;
    try {
      creds = JSON.parse(input);
    } catch {
      appendSystemMessage("Invalid JSON. Please paste the exact output of the credentials command.");
      return;
    }

    const res = await fetch(apiUrl("/api/auth/credentials"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(creds),
    });
    const data = await res.json();
    if (data.ok) {
      appendSystemMessage("Credentials saved successfully! Checking auth status...");
      await checkAuth();
    } else {
      appendSystemMessage("Failed to save credentials: " + (data.error || "unknown error"));
    }
  } catch (err) {
    appendSystemMessage("Error: " + err.message);
  }
}

// ============================================================
// Init
// ============================================================

loadSessions();
loadUsage();
checkAuth();

document.getElementById("main").addEventListener("click", () => {
  if (window.innerWidth <= 768) sidebar.classList.add("hidden");
});
