import * as pty from "node-pty";
import { type WebSocket, WebSocketServer } from "ws";

const PORT = parseInt(process.env.PORT ?? "3003", 10);
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const SHELL_COMMAND = process.env.SHELL_COMMAND ?? "nsenter";
const SHELL_ARGS = process.env.SHELL_ARGS
  ? process.env.SHELL_ARGS.split(" ")
  : ["-t", "1", "-m", "-u", "-i", "-n", "-p", "--", "/bin/bash", "-il"];

interface TerminalSession {
  ptyProcess: pty.IPty;
  idleTimer: ReturnType<typeof setTimeout>;
}

const sessions = new WeakMap<WebSocket, TerminalSession>();

function resetIdleTimer(ws: WebSocket) {
  const session = sessions.get(ws);
  if (!session) return;

  clearTimeout(session.idleTimer);
  session.idleTimer = setTimeout(() => {
    console.log("[terminal] Idle timeout, closing session");
    ws.close(1000, "Idle timeout");
  }, IDLE_TIMEOUT_MS);
}

const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (ws) => {
  console.log("[terminal] New session");

  const cols = 80;
  const rows = 24;

  const ptyProcess = pty.spawn(SHELL_COMMAND, SHELL_ARGS, {
    name: "xterm-256color",
    cols,
    rows,
    cwd: "/",
    env: {
      TERM: "xterm-256color",
      HOME: "/root",
      PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      LANG: "en_US.UTF-8",
    },
  });

  const session: TerminalSession = {
    ptyProcess,
    idleTimer: setTimeout(() => ws.close(1000, "Idle timeout"), IDLE_TIMEOUT_MS),
  };
  sessions.set(ws, session);

  ptyProcess.onData((data: string) => {
    try {
      if (ws.readyState === ws.OPEN) {
        ws.send(data);
      }
    } catch {
      ptyProcess.kill();
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    console.log(`[terminal] Shell exited with code ${exitCode}`);
    clearTimeout(session.idleTimer);
    try {
      ws.close(1000, "Shell exited");
    } catch {}
  });

  ws.on("message", (message) => {
    resetIdleTimer(ws);

    const raw = typeof message === "string" ? message : message.toString();

    if (raw.charCodeAt(0) === 1) {
      try {
        const control = JSON.parse(raw.slice(1)) as {
          type: string;
          cols?: number;
          rows?: number;
        };
        if (control.type === "resize" && control.cols && control.rows) {
          session.ptyProcess.resize(control.cols, control.rows);
        }
      } catch {}
      return;
    }

    session.ptyProcess.write(raw);
  });

  ws.on("close", () => {
    console.log("[terminal] Session closed");
    clearTimeout(session.idleTimer);
    try {
      session.ptyProcess.kill();
    } catch {}
    sessions.delete(ws);
  });
});

console.log(`[terminal-server] Listening on port ${PORT}`);
