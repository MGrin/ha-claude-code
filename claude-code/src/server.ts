/**
 * Web server that serves the wrapper page with session sidebar
 * and proxies HTTP + WebSocket to ttyd on port 5101.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const TTYD_URL = "http://127.0.0.1:5101";
const WORKING_DIR = process.env.CLAUDE_WORKING_DIR || "/data/workspace";
const PORT = 5100;

function getProjectDir(): string | null {
  const base = join(process.env.HOME || "/data", ".claude", "projects");
  if (!existsSync(base)) return null;
  try {
    const dirs = readdirSync(base);
    return dirs.length > 0 ? join(base, dirs[0]) : null;
  } catch {
    return null;
  }
}

function getSessions() {
  const dir = getProjectDir();
  if (!dir) return [];
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    return files.map((f) => {
      const id = f.replace(".jsonl", "");
      let title = "Untitled";
      try {
        const content = readFileSync(join(dir, f), "utf-8");
        const firstLine = content.split("\n").find((l) => l.includes('"user"'));
        if (firstLine) {
          const msg = JSON.parse(firstLine);
          const text =
            typeof msg?.message?.content === "string"
              ? msg.message.content
              : msg?.message?.content?.find?.((b: any) => b.type === "text")?.text;
          if (text) title = text.slice(0, 60);
        }
      } catch {}
      return { id, title };
    }).reverse();
  } catch {
    return [];
  }
}

const HTML = /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
  <title>Claude Code</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{height:100%;overflow:hidden;background:#1c1c1e;color:#f5f5f7;
      font-family:-apple-system,BlinkMacSystemFont,"SF Pro",system-ui,sans-serif;font-size:13px}
    #app{display:flex;height:100%}
    #sidebar{width:240px;min-width:240px;background:#2c2c2e;border-right:1px solid #3a3a3c;
      display:flex;flex-direction:column;transition:margin-left .2s}
    #sidebar.hidden{margin-left:-240px}
    .sb-hdr{padding:8px;border-bottom:1px solid #3a3a3c;display:flex;flex-direction:column;gap:5px}
    .sb-btn{width:100%;padding:7px;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:500}
    #btn-new{background:#6c5ce7;color:#fff}#btn-new:hover{background:#7c6cf7}
    #btn-resume{background:#3a3a3c;color:#f5f5f7}#btn-resume:hover{background:#48484a}
    #slist{flex:1;overflow-y:auto;padding:4px}
    .si{padding:7px 9px;border-radius:5px;cursor:pointer;margin-bottom:1px;
      font-size:11px;color:#98989d;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .si:hover{background:#3a3a3c;color:#f5f5f7}
    #main{flex:1;display:flex;flex-direction:column;min-width:0}
    #hdr{display:flex;align-items:center;padding:4px 10px;background:#2c2c2e;
      border-bottom:1px solid #3a3a3c;gap:8px;min-height:36px}
    #hdr button{background:none;border:none;color:#f5f5f7;font-size:16px;cursor:pointer;padding:2px 4px}
    #hdr span{font-weight:600;font-size:13px}
    #term{flex:1;border:none;width:100%;height:100%;background:#1c1c1e}
    ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:#3a3a3c;border-radius:2px}
    @media(max-width:768px){
      #sidebar{position:fixed;left:0;top:0;bottom:0;z-index:100;box-shadow:4px 0 20px rgba(0,0,0,.5)}
    }
  </style>
</head>
<body>
<div id="app">
  <aside id="sidebar">
    <div class="sb-hdr">
      <button id="btn-new" class="sb-btn">+ New Session</button>
      <button id="btn-resume" class="sb-btn">Pick Session (interactive)</button>
    </div>
    <div id="slist"></div>
  </aside>
  <main id="main">
    <header id="hdr">
      <button id="tog">&#9776;</button>
      <span>Claude Code</span>
    </header>
    <iframe id="term"></iframe>
  </main>
</div>
<script>
const bp=(()=>{const m=location.pathname.match(/^\\/api\\/hassio_ingress\\/[^/]+/);return m?m[0]:""})();
document.getElementById("tog").addEventListener("click",()=>document.getElementById("sidebar").classList.toggle("hidden"));
document.getElementById("main").addEventListener("click",()=>{if(innerWidth<=768)document.getElementById("sidebar").classList.add("hidden")});

// Load ttyd in iframe
document.getElementById("term").src=bp+"/ttyd/";

// Session actions — these write commands to a shared file that the launcher watches
document.getElementById("btn-new").addEventListener("click",async()=>{
  await fetch(bp+"/api/command",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({cmd:"new"})});
  document.getElementById("term").src=bp+"/ttyd/";
});
document.getElementById("btn-resume").addEventListener("click",async()=>{
  await fetch(bp+"/api/command",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({cmd:"resume"})});
  document.getElementById("term").src=bp+"/ttyd/";
});

async function loadSessions(){
  try{
    const r=await fetch(bp+"/api/sessions");
    const ss=await r.json();
    document.getElementById("slist").innerHTML=ss.map(s=>
      '<div class="si" data-id="'+s.id+'" title="'+s.id+'">'+
      s.title.replace(/</g,"&lt;").slice(0,50)+'</div>'
    ).join("");
    document.querySelectorAll(".si").forEach(el=>{
      el.addEventListener("click",async()=>{
        const id=el.dataset.id;
        await fetch(bp+"/api/command",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({cmd:"resume-id",id})});
        document.getElementById("term").src=bp+"/ttyd/";
      });
    });
  }catch{}
}
loadSessions();setInterval(loadSessions,15000);
</script>
</body>
</html>`;

let pendingCommand: { cmd: string; id?: string } | null = null;

const server = Bun.serve({
  port: PORT,

  async fetch(req, server) {
    const url = new URL(req.url);
    const path = url.pathname;

    // WebSocket upgrade for ttyd proxy
    if (path.endsWith("/ws") && req.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const ok = server.upgrade(req, { data: { search: url.search } });
      if (ok) return undefined;
      return new Response("WebSocket upgrade failed", { status: 500 });
    }

    // API: sessions list
    if (path.endsWith("/api/sessions")) {
      return Response.json(getSessions());
    }

    // API: send command to terminal
    if (path.endsWith("/api/command") && req.method === "POST") {
      const body = await req.json() as { cmd: string; id?: string };
      pendingCommand = body;
      return Response.json({ ok: true });
    }

    // API: get pending command (called by launcher)
    if (path.endsWith("/api/command") && req.method === "GET") {
      const cmd = pendingCommand;
      pendingCommand = null;
      return Response.json(cmd || { cmd: null });
    }

    // Proxy ttyd HTTP
    if (path.includes("/ttyd")) {
      const ttydPath = path.replace(/.*\/ttyd/, "") || "/";
      try {
        const resp = await fetch(TTYD_URL + ttydPath + url.search, {
          method: req.method,
          headers: req.headers,
        });
        const headers = new Headers(resp.headers);
        headers.delete("content-encoding");
        return new Response(resp.body, { status: resp.status, headers });
      } catch {
        return new Response("ttyd not ready yet — try refreshing in a few seconds", { status: 502 });
      }
    }

    // Serve main page
    return new Response(HTML, {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" },
    });
  },

  websocket: {
    open(ws: any) {
      const upstream = new WebSocket(TTYD_URL.replace("http", "ws") + "/ws" + (ws.data?.search || ""));
      ws.data.upstream = upstream;
      upstream.binaryType = "arraybuffer";
      upstream.onmessage = (e: any) => {
        try { ws.send(e.data); } catch {}
      };
      upstream.onclose = () => {
        try { ws.close(); } catch {}
      };
      upstream.onerror = () => {
        try { ws.close(); } catch {}
      };
    },
    message(ws: any, msg: any) {
      if (ws.data.upstream?.readyState === WebSocket.OPEN) {
        ws.data.upstream.send(msg);
      }
    },
    close(ws: any) {
      ws.data.upstream?.close();
    },
  },
});

console.log(`Claude Code HA Add-on v0.4.1 on port ${PORT}`);
