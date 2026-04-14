"use client";

import Link from "next/link";
import { Zap } from "lucide-react";
import { Card, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow, Tabs } from "@heroui/react";
import { AttachToBoxTrigger } from "@/components/product/attach_to_box_trigger";

interface SkillRow {
  id: string;
  name: string;
  description: string | null;
  canonical_format: string;
  tags: string[];
}

export function SkillsLibraryView({
  skills,
  boxes,
}: {
  skills: SkillRow[];
  boxes: Array<{ id: string; name: string }>;
}) {
  return (
    <Tabs aria-label="Skills view" defaultSelectedKey="cards" variant="primary">
      <Tabs.List>
        <Tabs.Tab id="cards">Cards</Tabs.Tab>
        <Tabs.Tab id="table">Table</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel id="cards">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 pt-3">
          {skills.map((skill) => (
            <Card key={skill.id} className="border border-default-200 bg-content1 p-4">
              <div className="flex flex-col gap-2">
                <Link href={`/app/skills/${skill.id}`} className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-default-500" />
                  <span className="truncate text-sm font-medium">{skill.name}</span>
                </Link>
                {skill.description && (
                  <p className="line-clamp-2 text-xs text-default-500">{skill.description}</p>
                )}
                <div className="flex items-center gap-2">
                  <span className="rounded-md border border-default-200 px-1.5 py-0.5 font-mono text-[10px] text-default-500">
                    {skill.canonical_format}
                  </span>
                  <div className="ml-auto">
                    <AttachToBoxTrigger
                      objectType="skill"
                      objectId={skill.id}
                      objectName={skill.name}
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
          <Table aria-label="Skills table">
            <TableHeader>
              <TableColumn>NAME</TableColumn>
              <TableColumn>FORMAT</TableColumn>
              <TableColumn>DESCRIPTION</TableColumn>
              <TableColumn>ACTIONS</TableColumn>
            </TableHeader>
            <TableBody items={skills}>
              {(skill) => (
                <TableRow key={skill.id}>
                  <TableCell>
                    <Link href={`/app/skills/${skill.id}`} className="font-medium hover:underline">
                      {skill.name}
                    </Link>
                  </TableCell>
                  <TableCell>{skill.canonical_format}</TableCell>
                  <TableCell className="max-w-md truncate">{skill.description ?? "—"}</TableCell>
                  <TableCell>
                    <AttachToBoxTrigger
                      objectType="skill"
                      objectId={skill.id}
                      objectName={skill.name}
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
