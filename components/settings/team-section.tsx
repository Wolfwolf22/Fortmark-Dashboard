"use client";

/**
 * Team — the brokerage roster.
 *
 * Real mode reads `/api/team`: actual dashboard users with their professional
 * profiles, read-only. There is no role-change or invitation service behind
 * the dashboard yet, so real mode offers neither control; it says so instead.
 *
 * `TeamManager` below is the labelled fixture roster, reachable only when the
 * server reports explicit sample mode.
 */
import { useState } from "react";
import { UserPlus } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getTeamRoster } from "@/lib/data/adapters/team";
import type { RosterEntry } from "@/lib/team/roster";
import { useQuery } from "@/lib/data/hooks";
import { SubsystemNotConnected, unavailableSubsystem } from "@/components/common/subsystem-state";
import { SampleDataNotice } from "@/components/listings/sample-data-notice";
import { TeamMember } from "@/lib/data/types";
import { initials } from "@/lib/utils";
import { SectionSkeleton } from "./section-skeleton";

const TEAM_ROLES: TeamMember["role"][] = [
  "Broker",
  "Agent",
  "Transaction coordinator",
  "Admin",
];

export function TeamSection() {
  const { data, loading, error } = useQuery(() => getTeamRoster(), []);

  // A failed read is not a slow one: without this the section pulsed
  // forever when the subsystem refused, saying nothing at all.
  const missing = unavailableSubsystem(error);
  if (missing) return <SubsystemNotConnected subsystem={missing} />;
  if (error) return <TeamUnavailable />;
  if (loading || !data) return <SectionSkeleton rows={5} />;
  if (data.source === "sample") return <TeamManager initial={data.items} />;
  return <TeamRosterCard items={data.items} viewerPrivileged={data.viewerPrivileged} />;
}

function TeamUnavailable() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Team</CardTitle>
        <CardDescription>
          The team roster could not be loaded right now. Nothing is shown rather than a guess.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

const STATUS_LABEL: Record<NonNullable<RosterEntry["status"]>, string> = {
  active: "Active",
  pending_profile: "Pending",
  suspended: "Suspended",
};

function licenceText(member: RosterEntry): string | null {
  if (!member.licenseNumber) return null;
  const prefix = [member.licenseState, member.licenseType].filter(Boolean).join(" ");
  return prefix ? `${prefix} ${member.licenseNumber}` : member.licenseNumber;
}

function TeamRosterCard({ items, viewerPrivileged }: { items: RosterEntry[]; viewerPrivileged: boolean }) {
  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle>Team</CardTitle>
        <CardDescription>
          {viewerPrivileged
            ? "Everyone with an account in this workspace, from their own professional profiles."
            : "Your active colleagues, as their professional profiles present them."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Licence</TableHead>
              {viewerPrivileged && <TableHead>Status</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((member) => {
              const licence = licenceText(member);
              return (
                <TableRow key={member.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar>
                        {member.imageUrl && <AvatarImage src={member.imageUrl} alt="" />}
                        <AvatarFallback>{member.hasName ? initials(member.name) : "?"}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className={member.hasName ? "truncate font-semibold" : "truncate text-muted-foreground"}>
                          {member.name}
                          {member.isSelf && <span className="ml-2 text-[12px] font-normal text-muted-foreground">You</span>}
                        </p>
                        <p className="truncate text-muted-foreground">
                          {[member.title, member.email].filter(Boolean).join(" · ") || "No professional details yet"}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{member.roleLabel}</Badge>
                  </TableCell>
                  <TableCell className="text-[13px]">
                    {licence ?? <span className="text-muted-foreground">Not provided</span>}
                  </TableCell>
                  {viewerPrivileged && (
                    <TableCell>
                      {member.status && (
                        <Badge variant={member.status === "active" ? "outline" : "muted"}>
                          {STATUS_LABEL[member.status]}
                        </Badge>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <p className="mt-3 text-[12px] text-muted-foreground">
          Licence details are self-reported by each member; FortMark does not verify them. Adding
          teammates and changing roles are not available in the dashboard yet.
        </p>
      </CardContent>
    </Card>
  );
}

function TeamManager({ initial }: { initial: TeamMember[] }) {
  const [members, setMembers] = useState<TeamMember[]>(initial);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<TeamMember["role"]>("Agent");

  const hasInvited = members.some((m) => m.status === "invited");

  function updateRole(id: string, role: TeamMember["role"]) {
    setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, role } : m)));
  }

  function openInvite() {
    setInviteName("");
    setInviteEmail("");
    setInviteRole("Agent");
    setInviteOpen(true);
  }

  function handleInvite(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMembers((prev) => [
      ...prev,
      {
        id: `invite-${Date.now()}`,
        name: inviteName.trim(),
        email: inviteEmail.trim(),
        role: inviteRole,
        status: "invited",
      },
    ]);
    setInviteOpen(false);
  }

  return (
    <Card>
      <div className="px-6 pt-6">
        <SampleDataNotice subject="These colleagues are generated for development. Nobody listed here has access to this workspace." />
      </div>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1">
          <CardTitle>Team</CardTitle>
          <CardDescription>People with access to this workspace.</CardDescription>
        </div>
        <Button onClick={openInvite}>
          <UserPlus aria-hidden />
          Invite member
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => (
              <TableRow key={member.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Avatar>
                      <AvatarFallback>{initials(member.name)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{member.name}</p>
                      <p className="truncate text-muted-foreground">{member.email}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Select
                    value={member.role}
                    onValueChange={(v) =>
                      updateRole(member.id, v as TeamMember["role"])
                    }
                  >
                    <SelectTrigger
                      className="h-8 w-52 text-[13px]"
                      aria-label={`Role for ${member.name}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TEAM_ROLES.map((role) => (
                        <SelectItem key={role} value={role}>
                          {role}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  {member.status === "active" ? (
                    <Badge variant="outline">Active</Badge>
                  ) : (
                    <Badge variant="muted">Invited</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {hasInvited && (
          <p className="mt-3 text-[12px] text-muted-foreground">
            Invites send when the account service connects.
          </p>
        )}
      </CardContent>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Invite member</DialogTitle>
            <DialogDescription>
              Add a teammate to the FortMark workspace.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleInvite} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invite-name">Name</Label>
              <Input
                id="invite-name"
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                autoComplete="off"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                autoComplete="off"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-role">Role</Label>
              <Select
                value={inviteRole}
                onValueChange={(v) => setInviteRole(v as TeamMember["role"])}
              >
                <SelectTrigger id="invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TEAM_ROLES.map((role) => (
                    <SelectItem key={role} value={role}>
                      {role}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-[12px] text-muted-foreground">
              Invites send when the account service connects.
            </p>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setInviteOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!inviteName.trim() || !inviteEmail.trim()}
              >
                Send invite
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
