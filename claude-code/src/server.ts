import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { unlinkSync } from "node:fs";

const TTYD = "http://127.0.0.1:5101";
const WORKING_DIR = process.env.CLAUDE_WORKING_DIR || "/data/workspace";
const PORT = 5100;

function getSessions() {
  const base = join(process.env.HOME || "/data", ".claude", "projects");
  if (!existsSync(base)) return [];
  try {
    const dirs = readdirSync(base);
    if (dirs.length === 0) return [];
    const dir = join(base, dirs[0]);
    const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    return files
      .map((f) => {
        const id = f.replace(".jsonl", "");
        let title = "Untitled";
        try {
          const lines = readFileSync(join(dir, f), "utf-8").split("\n");
          const userLine = lines.find((l) => l.includes('"user"'));
          if (userLine) {
            const msg = JSON.parse(userLine);
            const text =
              typeof msg?.message?.content === "string"
                ? msg.message.content
                : msg?.message?.content?.find?.((b: any) => b.type === "text")?.text;
            if (text) title = text.slice(0, 60);
          }
        } catch {}
        const stat = Bun.file(join(dir, f));
        return { id, title, path: join(dir, f) };
      })
      .reverse();
  } catch {
    return [];
  }
}

function deleteSession(id: string): boolean {
  const sessions = getSessions();
  const s = sessions.find((s) => s.id === id);
  if (s) {
    try {
      unlinkSync(s.path);
      return true;
    } catch {}
  }
  return false;
}

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<meta http-equiv="Cache-Control" content="no-cache,no-store,must-revalidate">
<title>Claude Code</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.min.css">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%;overflow:hidden;background:#1a1b26;color:#c0caf5;
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro",system-ui,sans-serif;font-size:13px}
#app{display:flex;height:100%}
#sb{width:220px;min-width:220px;background:#1f2335;border-right:1px solid #3b4261;
  display:flex;flex-direction:column;transition:margin-left .2s}
#sb.h{margin-left:-220px}
.sh{padding:8px;border-bottom:1px solid #3b4261;display:flex;flex-direction:column;gap:4px}
.sb{width:100%;padding:7px;border:none;border-radius:5px;cursor:pointer;font-size:12px;font-weight:500}
#bn{background:#7aa2f7;color:#1a1b26}#bn:hover{background:#89b4fa}
#br{background:#3b4261;color:#c0caf5}#br:hover{background:#414868}
#sl{flex:1;overflow-y:auto;padding:4px}
.si{padding:6px 8px;border-radius:4px;cursor:pointer;margin-bottom:1px;
  font-size:11px;color:#565f89;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  display:flex;justify-content:space-between;align-items:center}
.si:hover{background:#292e42;color:#c0caf5}
.si .del{display:none;background:none;border:none;color:#f7768e;cursor:pointer;font-size:14px;padding:0 2px}
.si:hover .del{display:block}
#mn{flex:1;display:flex;flex-direction:column;min-width:0}
#hd{display:flex;align-items:center;padding:4px 10px;background:#1f2335;
  border-bottom:1px solid #3b4261;gap:8px;min-height:34px}
#hd button{background:none;border:none;color:#c0caf5;font-size:16px;cursor:pointer}
#hd span{font-weight:600;font-size:13px;color:#7aa2f7}
#tc{flex:1;padding:2px}
.xterm{height:100%}
::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:#3b4261;border-radius:2px}
@media(max-width:768px){#sb{position:fixed;left:0;top:0;bottom:0;z-index:100;box-shadow:4px 0 20px rgba(0,0,0,.5)}}
</style>
</head>
<body>
<div id="app">
  <aside id="sb">
    <div class="sh">
      <button id="bn" class="sb">+ New Session</button>
      <button id="br" class="sb">Resume (picker)</button>
    </div>
    <div id="sl"></div>
  </aside>
  <main id="mn">
    <header id="hd">
      <button id="tg">&#9776;</button>
      <span>Claude Code</span>
    </header>
    <div id="tc"></div>
  </main>
</div>
<script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@xterm/addon-web-links@0.11.0/lib/addon-web-links.min.js"></script>
<script>
const bp=(()=>{const m=location.pathname.match(/^\\/api\\/hassio_ingress\\/[^/]+/);return m?m[0]:""})();
const enc=new TextEncoder();
let ws=null,term=null;

// Sidebar
document.getElementById("tg").addEventListener("click",()=>document.getElementById("sb").classList.toggle("h"));
document.getElementById("mn").addEventListener("click",()=>{if(innerWidth<=768)document.getElementById("sb").classList.add("h")});

// Terminal
async function initTerminal(){
  term=new Terminal({fontSize:14,fontFamily:'"Cascadia Code","Fira Code","SF Mono",Consolas,monospace',
    theme:{background:"#1a1b26",foreground:"#c0caf5",cursor:"#7aa2f7",
      selectionBackground:"rgba(122,162,247,0.3)"},cursorBlink:true,scrollback:5000});
  const fit=new FitAddon.FitAddon();
  const links=new WebLinksAddon.WebLinksAddon();
  term.loadAddon(fit);term.loadAddon(links);
  term.open(document.getElementById("tc"));
  fit.fit();
  window.addEventListener("resize",()=>fit.fit());
  new ResizeObserver(()=>fit.fit()).observe(document.getElementById("tc"));

  // Get ttyd token
  let token="";
  try{const r=await fetch(bp+"/terminal/token");const j=await r.json();token=j.token||"";}catch{}

  // Connect WebSocket
  const proto=location.protocol==="https:"?"wss:":"ws:";
  ws=new WebSocket(proto+"//"+location.host+bp+"/terminal/ws",["tty"]);
  ws.binaryType="arraybuffer";
  ws.onopen=()=>{
    const msg=JSON.stringify({AuthToken:token,columns:term.cols,rows:term.rows});
    ws.send(enc.encode(msg));
  };
  ws.onmessage=(e)=>{
    const d=new Uint8Array(e.data);
    const cmd=String.fromCharCode(d[0]);
    if(cmd==="0")term.write(d.subarray(1));
  };
  ws.onclose=()=>{term.write("\\r\\n[Disconnected — refresh to reconnect]\\r\\n")};

  term.onData((data)=>{
    if(!ws||ws.readyState!==1)return;
    const buf=new Uint8Array(data.length*3+1);
    buf[0]=48;// '0'
    const s=enc.encodeInto(data,buf.subarray(1));
    ws.send(buf.subarray(0,s.written+1));
  });
  term.onResize(({cols,rows})=>{
    if(!ws||ws.readyState!==1)return;
    ws.send(enc.encode("1"+JSON.stringify({columns:cols,rows:rows})));
  });
  term.focus();
}

function sendCmd(text){
  if(!ws||ws.readyState!==1)return;
  const buf=new Uint8Array(text.length*3+1);
  buf[0]=48;
  const s=enc.encodeInto(text,buf.subarray(1));
  ws.send(buf.subarray(0,s.written+1));
}

document.getElementById("bn").addEventListener("click",()=>sendCmd("claude\\n"));
document.getElementById("br").addEventListener("click",()=>sendCmd("claude --resume\\n"));

async function loadSessions(){
  try{
    const r=await fetch(bp+"/api/sessions");
    const ss=await r.json();
    document.getElementById("sl").innerHTML=ss.map(s=>
      '<div class="si" data-id="'+s.id+'">'
      +'<span>'+s.title.replace(/</g,"&lt;")+'</span>'
      +'<button class="del" data-id="'+s.id+'">&times;</button></div>'
    ).join("");
    document.querySelectorAll(".si span").forEach(el=>{
      el.addEventListener("click",()=>{
        sendCmd("claude --resume "+el.parentElement.dataset.id+"\\n");
      });
    });
    document.querySelectorAll(".del").forEach(el=>{
      el.addEventListener("click",(e)=>{
        e.stopPropagation();
        if(confirm("Delete session?")){
          fetch(bp+"/api/sessions/"+el.dataset.id,{method:"DELETE"}).then(()=>loadSessions());
        }
      });
    });
  }catch{}
}

initTerminal();
loadSessions();
setInterval(loadSessions,30000);
</script>
</body>
</html>`;

Bun.serve({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);
    const path = url.pathname;

    // WebSocket upgrade for ttyd
    if (path.endsWith("/terminal/ws") && req.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const success = server.upgrade(req, {
        data: { search: url.search },
        headers: { "Sec-WebSocket-Protocol": "tty" },
      });
      return success ? undefined : new Response("Upgrade failed", { status: 500 });
    }

    // API: sessions
    if (path.endsWith("/api/sessions") && req.method === "GET") {
      return Response.json(getSessions());
    }
    if (path.match(/\/api\/sessions\/[^/]+$/) && req.method === "DELETE") {
      const id = path.split("/").pop()!;
      return Response.json({ ok: deleteSession(id) });
    }

    // Proxy ttyd HTTP (token endpoint, etc.)
    if (path.includes("/terminal")) {
      const ttydPath = path.replace(/.*?(\/terminal)/, "/terminal");
      try {
        const r = await fetch(TTYD + ttydPath + url.search);
        return new Response(r.body, { status: r.status, headers: r.headers });
      } catch {
        return new Response("ttyd starting...", { status: 502 });
      }
    }

    // Main page
    return new Response(HTML, {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" },
    });
  },

  websocket: {
    open(ws: any) {
      const ttydWsUrl = "ws://127.0.0.1:5101/terminal/ws" + (ws.data?.search || "");
      const upstream = new WebSocket(ttydWsUrl, ["tty"]);
      upstream.binaryType = "arraybuffer";
      ws.data.upstream = upstream;
      upstream.onmessage = (e: any) => { try { ws.send(e.data); } catch {} };
      upstream.onclose = () => { try { ws.close(); } catch {} };
      upstream.onerror = () => { try { ws.close(); } catch {} };
    },
    message(ws: any, msg: any) {
      const u = ws.data?.upstream;
      if (u?.readyState === WebSocket.OPEN) u.send(msg);
    },
    close(ws: any) {
      ws.data?.upstream?.close();
    },
  },
});

console.log(`Claude Code HA Add-on v0.5.0 on port ${PORT}`);
