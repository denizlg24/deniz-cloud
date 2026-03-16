import { Database } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MongoTab } from "./mongo-tab";
import { PostgresTab } from "./postgres-tab";

export function DatabasesPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Database className="h-6 w-6" />
        <h1 className="text-2xl font-bold">Databases</h1>
      </div>

      <Tabs defaultValue="postgres" className="space-y-4">
        <TabsList>
          <TabsTrigger value="postgres">PostgreSQL</TabsTrigger>
          <TabsTrigger value="mongodb">MongoDB</TabsTrigger>
        </TabsList>

        <TabsContent value="postgres" className="mt-0">
          <PostgresTab />
        </TabsContent>

        <TabsContent value="mongodb" className="mt-0">
          <MongoTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
