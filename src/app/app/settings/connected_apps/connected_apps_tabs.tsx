"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ConnectedAppsList } from "./connected_apps_list";
import { PullTokensList } from "./pull_tokens_list";

/**
 * Two-tab container for the Connected Apps settings page.
 *
 * Underline-style tabs per the style brief — the brand-yellow
 * indicator sits below the active label. The "Pull links" tab
 * carries a live count badge that reflects optimistic state from
 * the inner list; we lift the count up via a callback so the badge
 * stays accurate even between server refreshes.
 */
export function ConnectedAppsTabs() {
  const [activePullCount, setActivePullCount] = useState<number | null>(null);

  return (
    <Tabs defaultValue="oauth" className="w-full">
      <TabsList>
        <TabsTrigger value="oauth">OAuth apps</TabsTrigger>
        <TabsTrigger value="pull">
          <span>Pull links</span>
          {activePullCount !== null && activePullCount > 0 && (
            <Badge
              variant="brand-subtle"
              className="ml-1 h-4 min-w-4 px-1 text-[10px] tabular-nums"
            >
              {activePullCount}
            </Badge>
          )}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="oauth" className="pt-4">
        <ConnectedAppsList />
      </TabsContent>
      <TabsContent value="pull" className="pt-4">
        <PullTokensList onActiveCountChange={setActivePullCount} />
      </TabsContent>
    </Tabs>
  );
}
