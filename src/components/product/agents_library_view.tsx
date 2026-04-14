"use client";

import Link from "next/link";
import { Bot } from "lucide-react";
import { Card, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow, Tabs } from "@heroui/react";
import { AgentTypeBadge } from "@/components/product/agent_type_badge";
import { AttachToBoxTrigger } from "@/components/product/attach_to_box_trigger";

interface AgentRow {
  id: string;
  name: string;
  description: string | null;
  agent_type: string | null;
  tags: string[];
  canonical_format: string;
}

export function AgentsLibraryView({
  agents,
  boxes,
}: {
  agents: AgentRow[];
  boxes: Array<{ id: string; name: string }>;
}) {
  return (
    <Tabs aria-label="Agents view" defaultSelectedKey="cards" variant="primary">
      <Tabs.List>
        <Tabs.Tab id="cards">Cards</Tabs.Tab>
        <Tabs.Tab id="table">Table</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel id="cards">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 pt-3">
          {agents.map((agent) => (
            <Card key={agent.id} className="border border-default-200 bg-content1 p-4">
              <div className="flex flex-col gap-2">
                <Link href={`/app/agents/${agent.id}`} className="flex items-center gap-2">
                  <Bot className="h-4 w-4 text-default-500" />
                  <span className="truncate text-sm font-medium">{agent.name}</span>
                </Link>
                {agent.agent_type && <AgentTypeBadge agentType={agent.agent_type} subtle />}
                {agent.description && (
                  <p className="line-clamp-2 text-xs text-default-500">{agent.description}</p>
                )}
                <div className="flex items-center gap-2">
                  <span className="rounded-md border border-default-200 px-1.5 py-0.5 font-mono text-[10px] text-default-500">
                    {agent.canonical_format}
                  </span>
                  <div className="ml-auto">
                    <AttachToBoxTrigger
                      objectType="agent"
                      objectId={agent.id}
                      objectName={agent.name}
                      boxes={boxes}
                    />
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </Tabs.Panel>
      <Tabs.Panel id="table">
        <div className="pt-3">
          <Table aria-label="Agents table">
            <TableHeader>
              <TableColumn>NAME</TableColumn>
              <TableColumn>TYPE</TableColumn>
              <TableColumn>FORMAT</TableColumn>
              <TableColumn>DESCRIPTION</TableColumn>
              <TableColumn>ACTIONS</TableColumn>
            </TableHeader>
            <TableBody items={agents}>
              {(agent) => (
                <TableRow key={agent.id}>
                  <TableCell>
                    <Link href={`/app/agents/${agent.id}`} className="font-medium hover:underline">
                      {agent.name}
                    </Link>
                  </TableCell>
                  <TableCell>{agent.agent_type ?? "—"}</TableCell>
                  <TableCell>{agent.canonical_format}</TableCell>
                  <TableCell className="max-w-md truncate">{agent.description ?? "—"}</TableCell>
                  <TableCell>
                    <AttachToBoxTrigger
                      objectType="agent"
                      objectId={agent.id}
                      objectName={agent.name}
                      boxes={boxes}
                    />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Tabs.Panel>
    </Tabs>
  );
}
