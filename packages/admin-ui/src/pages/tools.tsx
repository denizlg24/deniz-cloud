import { useState } from "react";
import { WebTerminal } from "@/components/terminal";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Tool = "adminer" | "mongo-ui" | "terminal";

const IFRAME_TOOLS: Record<"adminer" | "mongo-ui", { label: string; src: string }> = {
  adminer: { label: "Adminer (PostgreSQL)", src: "/tools/adminer/" },
  "mongo-ui": { label: "Mongo Express", src: "/tools/mongo-ui/" },
};

export function ToolsPage() {
  const [activeTool, setActiveTool] = useState<Tool>("adminer");

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col gap-4 -m-4 md:-m-6">
      <div className="px-4 pt-2 md:px-6 md:pt-6">
        <h1 className="text-2xl font-bold tracking-tight">Tools</h1>
        <p className="text-sm text-muted-foreground">Database management and server terminal</p>
      </div>

      <Tabs
        value={activeTool}
        onValueChange={(v) => setActiveTool(v as Tool)}
        className="flex flex-1 flex-col overflow-hidden px-4 md:px-6"
      >
        <TabsList className="w-fit">
          <TabsTrigger value="adminer">Adminer</TabsTrigger>
          <TabsTrigger value="mongo-ui">Mongo Express</TabsTrigger>
          <TabsTrigger value="terminal">Terminal</TabsTrigger>
        </TabsList>

        {(["adminer", "mongo-ui"] as const).map((tool) => (
          <TabsContent
            key={tool}
            value={tool}
            className="flex-1 mt-2 mb-0 overflow-hidden rounded-lg border"
          >
            {activeTool === tool && (
              <iframe
                title={IFRAME_TOOLS[tool].label}
                src={IFRAME_TOOLS[tool].src}
                className="h-full w-full border-0"
              />
            )}
          </TabsContent>
        ))}

        <TabsContent
          value="terminal"
          className="flex-1 mt-2 mb-0 overflow-hidden rounded-lg border"
        >
          {activeTool === "terminal" && <WebTerminal />}
        </TabsContent>
      </Tabs>
    </div>
  );
}
