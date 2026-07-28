"use client";

/**
 * Brokerage — office details prefilled from getBrokerage(). Saving is
 * client-side only until the account service connects.
 */
import { useState } from "react";
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
import { getBrokerage } from "@/lib/data/adapters/settings";
import { useQuery } from "@/lib/data/hooks";
import { BrokerageProfile } from "@/lib/data/types";
import { SavedNote, useSavedNote } from "./saved-note";
import { SectionSkeleton } from "./section-skeleton";

export function BrokerageSection() {
  const { data, loading } = useQuery(() => getBrokerage(), []);

  if (loading || !data) return <SectionSkeleton rows={4} />;
  return <BrokerageForm brokerage={data} />;
}

function BrokerageForm({ brokerage }: { brokerage: BrokerageProfile }) {
  const [name, setName] = useState(brokerage.name);
  const [license, setLicense] = useState(brokerage.license);
  const [address, setAddress] = useState(brokerage.address);
  const [phone, setPhone] = useState(brokerage.phone);
  const [email, setEmail] = useState(brokerage.email);
  const { phase, show } = useSavedNote();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Client-side only for now — the account service connects here to
    // persist brokerage details.
    show();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Brokerage</CardTitle>
        <CardDescription>
          Office details used on documents and client-facing pages.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="brokerage-name">Name</Label>
              <Input
                id="brokerage-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="brokerage-license">License</Label>
              <Input
                id="brokerage-license"
                value={license}
                onChange={(e) => setLicense(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="brokerage-address">Address</Label>
              <Input
                id="brokerage-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                autoComplete="street-address"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="brokerage-phone">Phone</Label>
              <Input
                id="brokerage-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="brokerage-email">Email</Label>
              <Input
                id="brokerage-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
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
