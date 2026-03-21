import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";

type ConnectionState = "connecting" | "connected" | "disconnected" | "error";

export function WebTerminal() {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [state, setState] = useState<ConnectionState>("connecting");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      theme: {
        background: "#09090b",
        foreground: "#fafafa",
        cursor: "#fafafa",
        selectionBackground: "#27272a",
        black: "#09090b",
        red: "#ef4444",
        green: "#22c55e",
        yellow: "#eab308",
        blue: "#3b82f6",
        magenta: "#a855f7",
        cyan: "#06b6d4",
        white: "#fafafa",
        brightBlack: "#71717a",
        brightRed: "#f87171",
        brightGreen: "#4ade80",
        brightYellow: "#facc15",
        brightBlue: "#60a5fa",
        brightMagenta: "#c084fc",
        brightCyan: "#22d3ee",
        brightWhite: "#ffffff",
      },
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/terminal`);
    wsRef.current = ws;

    ws.onopen = () => {
      setState("connected");
      const dims = fit.proposeDimensions();
      if (dims) {
        ws.send(`\x01${JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows })}`);
      }
    };

    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        term.write(event.data);
      }
    };

    ws.onclose = () => {
      setState("disconnected");
      term.write("\r\n\x1b[90m--- Session ended ---\x1b[0m\r\n");
    };

    ws.onerror = () => {
      setState("error");
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    const handleResize = () => {
      fit.fit();
      const dims = fit.proposeDimensions();
      if (dims && ws.readyState === WebSocket.OPEN) {
        ws.send(`\x01${JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows })}`);
      }
    };

    const observer = new ResizeObserver(handleResize);
    observer.observe(container);

    return () => {
      observer.disconnect();
      ws.close();
      term.dispose();
      termRef.current = null;
      wsRef.current = null;
      fitRef.current = null;
    };
  }, []);

  const reconnect = () => {
    setState("connecting");
    const container = containerRef.current;
    const term = termRef.current;
    const fit = fitRef.current;
    if (!container || !term || !fit) return;

    term.clear();

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/terminal`);
    wsRef.current = ws;

    ws.onopen = () => {
      setState("connected");
      const dims = fit.proposeDimensions();
      if (dims) {
        ws.send(`\x01${JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows })}`);
      }
    };

    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        term.write(event.data);
      }
    };

    ws.onclose = () => {
      setState("disconnected");
      term.write("\r\n\x1b[90m--- Session ended ---\x1b[0m\r\n");
    };

    ws.onerror = () => {
      setState("error");
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });
  };

  return (
    <div className="relative flex h-full flex-col">
      {state !== "connected" && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#09090b]/80">
          {state === "connecting" && <p className="text-sm text-muted-foreground">Connecting...</p>}
          {(state === "disconnected" || state === "error") && (
            <div className="flex flex-col items-center gap-3">
              <p className="text-sm text-muted-foreground">
                {state === "error" ? "Connection failed" : "Session ended"}
              </p>
              <button
                type="button"
                onClick={reconnect}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Reconnect
              </button>
            </div>
          )}
        </div>
      )}
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
