"use client";

/**
 * Login — full-bleed black outside the app shell. The (auth) layout sets
 * bg-black text-white; everything here is styled for that ground, with
 * white focus rings so keyboard focus stays visible.
 */
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const darkField =
  "border-white/20 bg-transparent text-white placeholder:text-white/40 focus-visible:ring-white focus-visible:ring-offset-black";

export default function LoginPage() {
  const router = useRouter();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // TODO: session check — replace with the real auth provider call
    router.push("/");
  }

  function handleSso() {
    // TODO: session check — replace with the real auth provider call
    router.push("/");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-16">
      <div className="flex w-full max-w-sm flex-col items-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/fortmark-wordmark-white.png"
          alt="FortMark"
          className="h-8 w-auto"
        />
        <p className="mt-5 text-center text-sm text-white/60">
          Real estate, returned to its profession.
        </p>

        <form
          onSubmit={handleSubmit}
          className="mt-12 w-full rounded-card border border-white/15 p-8"
        >
          <div className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="login-email" className="text-white">
                Email
              </Label>
              <Input
                id="login-email"
                type="email"
                autoComplete="email"
                placeholder="name@brokerage.com"
                required
                className={darkField}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="login-password" className="text-white">
                Password
              </Label>
              <Input
                id="login-password"
                type="password"
                autoComplete="current-password"
                required
                className={darkField}
              />
            </div>
            <Button
              type="submit"
              className="w-full bg-white text-black hover:bg-white/90 focus-visible:ring-white focus-visible:ring-offset-black"
            >
              Sign in
            </Button>
          </div>

          <div className="my-6 flex items-center gap-3" aria-hidden>
            <span className="h-px flex-1 bg-white/15" />
            <span className="text-[11px] font-semibold uppercase tracking-micro text-white/40">
              or
            </span>
            <span className="h-px flex-1 bg-white/15" />
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={handleSso}
            className="w-full border-white/25 bg-transparent text-white hover:bg-white/10 hover:text-white focus-visible:ring-white focus-visible:ring-offset-black"
          >
            Continue with SSO
          </Button>
        </form>

        <p className="mt-8 text-[13px] text-white/40">
          Access is provisioned by your broker.
        </p>
      </div>
    </main>
  );
}
