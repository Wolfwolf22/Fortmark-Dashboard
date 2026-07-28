"use client";

/**
 * Profile — the current user's account details. Prefilled from
 * getCurrentUser(); saving is client-side only until the account service
 * connects.
 */
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getCurrentUser } from "@/lib/data/adapters/settings";
import { useQuery } from "@/lib/data/hooks";
import { SavedNote, useSavedNote } from "./saved-note";
import { SectionSkeleton } from "./section-skeleton";

export function ProfileSection() {
  const { data, loading } = useQuery(() => getCurrentUser(), []);

  if (loading || !data) return <SectionSkeleton rows={3} />;
  return <ProfileForm user={data} />;
}

function ProfileForm({
  user,
}: {
  user: { name: string; email: string; role: string; phone?: string };
}) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [phone, setPhone] = useState(user.phone ?? "");
  const { phase, show } = useSavedNote();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Client-side only for now — the account service connects here to
    // persist profile changes.
    show();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>How you appear across the workspace.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="profile-name">Name</Label>
              <Input
                id="profile-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-email">Email</Label>
              <Input
                id="profile-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-phone">
                Phone{" "}
                <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="profile-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoComplete="tel"
                placeholder="(954) 555-0100"
              />
            </div>
            <div className="space-y-2">
              <span className="block text-sm font-semibold leading-none">Role</span>
              <div className="flex h-9 items-center">
                <Badge variant="secondary">{user.role}</Badge>
              </div>
              <p className="text-[12px] text-muted-foreground">
                Roles are managed by your broker.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit">Save changes</Button>
            <SavedNote phase={phase} />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
