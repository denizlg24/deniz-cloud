import type { ServerWebSocket } from "bun";
import * as pty from "node-pty";

const PORT = parseInt(process.env.PORT ?? "3003", 10);
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const SHELL_COMMAND = process.env.SHELL_COMMAND ?? "/bin/bash";
const SHELL_ARGS = process.env.SHELL_ARGS ? process.env.SHELL_ARGS.split(" ") : ["-il"];

interface TerminalSession {
  ptyProcess: pty.IPty;
  idleTimer: ReturnType<typeof setTimeout>;
}

function resetIdleTimer(ws: ServerWebSocket<TerminalSession>) {
  clearTimeout(ws.data.idleTimer);
  ws.data.idleTimer = setTimeout(() => {
    console.log("[terminal] Idle timeout, closing session");
    ws.close(1000, "Idle timeout");
  }, IDLE_TIMEOUT_MS);
}

Bun.serve<TerminalSession>({
  port: PORT,
  fetch(req, server) {
    if (server.upgrade(req, { data: {} as TerminalSession })) {
      return undefined;
    }
    return new Response("WebSocket upgrade required", { status: 426 });
  },
  websocket: {
    open(ws) {
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

      ws.data = {
        ptyProcess,
        idleTimer: setTimeout(() => ws.close(1000, "Idle timeout"), IDLE_TIMEOUT_MS),
      };

      ptyProcess.onData((data: string) => {
        try {
          ws.send(data);
        } catch {
          ptyProcess.kill();
        }
      });

      ptyProcess.onExit(({ exitCode }) => {
        console.log(`[terminal] Shell exited with code ${exitCode}`);
        clearTimeout(ws.data.idleTimer);
        try {
          ws.close(1000, "Shell exited");
        } catch {}
      });
    },

    message(ws, message) {
      resetIdleTimer(ws);

      const raw = typeof message === "string" ? message : new TextDecoder().decode(message);

      if (raw.charCodeAt(0) === 1) {
        try {
          const control = JSON.parse(raw.slice(1)) as {
            type: string;
            cols?: number;
            rows?: number;
          };
          if (control.type === "resize" && control.cols && control.rows) {
            ws.data.ptyProcess.resize(control.cols, control.rows);
          }
        } catch {}
        return;
      }

      ws.data.ptyProcess.write(raw);
    },

    close(ws) {
      console.log("[terminal] Session closed");
      clearTimeout(ws.data.idleTimer);
      try {
        ws.data.ptyProcess.kill();
      } catch {}
    },
  },
});

console.log(`[terminal-server] Listening on port ${PORT}`);
