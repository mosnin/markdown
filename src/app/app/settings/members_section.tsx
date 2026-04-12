"use client";

import { useEffect, useState, useTransition } from "react";
import { Shield, UserPlus, X } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  listMembersAction,
  inviteMemberAction,
  updateMemberRoleAction,
  removeMemberAction,
  type MemberView,
} from "./member_actions";

/**
 * Workspace members — view, invite, change role, remove.
 *
 * The whole section renders only for admins (the parent page checks the
 * caller's role and doesn't mount this for viewers / members). Write
 * operations still go through the role-gated actions in
 * member_actions.ts, so even if the component is mounted in a privileged
 * shell by mistake, the server rejects any non-admin action.
 *
 * V1 invitation model: admins add users by email. The server resolves
 * the email to an existing auth user and creates the membership row
 * immediately (accepted_at = now()). If the email doesn't match an
 * existing user, the action returns an actionable error message.
 */

type RoleOption = "viewer" | "member" | "admin";

const roleCopy: Record<RoleOption, { label: string; description: string }> = {
  viewer: {
    label: "Viewer",
    description: "Can view all workspace content. Cannot edit, create, or manage members.",
  },
  member: {
    label: "Member",
    description: "Full read / write on workspace content. Cannot manage members or settings.",
  },
  admin: {
    label: "Admin",
    description: "Full write access plus member management.",
  },
};

export function MembersSection({
  workspaceName,
  currentUserId,
}: {
  workspaceName: string;
  currentUserId: string;
}) {
  const [members, setMembers] = useState<MemberView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, startRefresh] = useTransition();

  const refresh = () => {
    startRefresh(async () => {
      const res = await listMembersAction();
      if (res.ok) {
        setMembers(res.data);
        setError(null);
      } else {
        setError(res.error);
      }
    });
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <Card id="settings-members">
      <CardHeader className="px-6 pt-6 pb-4">
        <CardTitle className="text-base font-semibold">Members</CardTitle>
        <CardDescription className="text-sm text-muted-foreground">
          Everyone with access to {workspaceName}. Add teammates by email
          and choose their role. Invited users must already have a Context
          Store account.
        </CardDescription>
      </CardHeader>
      <Separator />
      <CardContent className="px-6 pt-5 pb-6 space-y-5">
        <InviteRow onInvited={refresh} />

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <div className="rounded-md border border-border">
          {!members ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              {refreshing ? "Loading members…" : "No members loaded yet."}
            </p>
          ) : members.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              Just you for now. Invite a teammate above to start sharing.
            </p>
          ) : (
            <ul className="divide-y divide-border list-none">
              {members.map((m) => (
                <MemberRow
                  key={m.id}
                  member={m}
                  currentUserId={currentUserId}
                  onChanged={refresh}
                />
              ))}
            </ul>
          )}
        </div>

        <RoleLegend />
      </CardContent>
    </Card>
  );
}

// ─── Invite row ──────────────────────────────────────────────────────────────

function InviteRow({ onInvited }: { onInvited: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<RoleOption>("member");
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (!value) return;
    startTransition(async () => {
      const res = await inviteMemberAction(value, role);
      if (res.ok) {
        setEmail("");
        setMsg({ kind: "ok", text: `Added ${value} as ${role}.` });
        onInvited();
      } else {
        setMsg({ kind: "err", text: res.error });
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="flex flex-col sm:flex-row gap-2">
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="teammate@example.com"
          className="flex-1"
          disabled={pending}
          required
        />
        <DropdownMenu>
          <DropdownMenuTrigger
            className="inline-flex h-9 min-w-28 items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm hover:bg-accent"
          >
            <span>{roleCopy[role].label}</span>
            <span className="text-muted-foreground">▾</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-56">
            {(["viewer", "member", "admin"] as RoleOption[]).map((r) => (
              <DropdownMenuItem key={r} onClick={() => setRole(r)}>
                <div className="flex flex-col">
                  <span className="font-medium">{roleCopy[r].label}</span>
                  <span className="text-xs text-muted-foreground">
                    {roleCopy[r].description}
                  </span>
                </div>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button type="submit" size="sm" disabled={pending || !email.trim()}>
          <UserPlus className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
          {pending ? "Adding…" : "Add member"}
        </Button>
      </div>
      {msg && (
        <p
          className={
            msg.kind === "ok"
              ? "text-xs text-muted-foreground"
              : "text-xs text-destructive"
          }
          role={msg.kind === "err" ? "alert" : undefined}
        >
          {msg.text}
        </p>
      )}
    </form>
  );
}

// ─── Member row ──────────────────────────────────────────────────────────────

function MemberRow({
  member,
  currentUserId,
  onChanged,
}: {
  member: MemberView;
  currentUserId: string;
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const canEdit = !member.is_owner && member.user_id !== currentUserId;

  function changeRole(role: RoleOption) {
    startTransition(async () => {
      const res = await updateMemberRoleAction(member.user_id, role);
      if (!res.ok) setError(res.error);
      else {
        setError(null);
        onChanged();
      }
    });
  }

  function remove() {
    startTransition(async () => {
      const res = await removeMemberAction(member.user_id);
      if (!res.ok) setError(res.error);
      else {
        setError(null);
        onChanged();
      }
    });
  }

  const displayRole: RoleOption | "owner" = member.is_owner ? "owner" : (member.role as RoleOption);

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
        {(member.email ?? "?").slice(0, 2).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {member.email ?? `User ${member.user_id.slice(0, 8)}`}
          {member.user_id === currentUserId && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">(you)</span>
          )}
        </p>
        {error && (
          <p className="mt-1 text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
      {member.is_owner ? (
        <Badge variant="secondary" className="gap-1">
          <Shield className="h-3 w-3" aria-hidden="true" />
          Owner
        </Badge>
      ) : canEdit ? (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={pending}
              className="inline-flex h-8 min-w-24 items-center justify-center rounded-md border border-input bg-background px-3 text-xs hover:bg-accent disabled:opacity-50"
            >
              {roleCopy[displayRole as RoleOption].label}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              {(["viewer", "member", "admin"] as RoleOption[]).map((r) => (
                <DropdownMenuItem key={r} onClick={() => changeRole(r)}>
                  {roleCopy[r].label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={remove}
            disabled={pending}
            aria-label={`Remove ${member.email ?? "user"}`}
            className="text-muted-foreground hover:text-destructive"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </>
      ) : (
        <Badge variant="outline" className="capitalize">
          {displayRole}
        </Badge>
      )}
    </li>
  );
}

// ─── Legend ──────────────────────────────────────────────────────────────────

function RoleLegend() {
  return (
    <div className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground space-y-1.5">
      <p className="font-medium text-foreground">Roles</p>
      {(["viewer", "member", "admin"] as RoleOption[]).map((r) => (
        <p key={r}>
          <span className="font-medium capitalize text-foreground">{r}</span>
          <span className="mx-1">—</span>
          {roleCopy[r].description}
        </p>
      ))}
    </div>
  );
}
