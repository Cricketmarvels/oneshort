import { CircleDollarSign, Compass, UserPlus, Users } from "lucide-react";
import { Link } from "react-router";

import { Brand } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";

const FEATURES = [
  { icon: UserPlus, title: "Find a Player", body: "Available players within 5–20 km of your ground" },
  { icon: Compass, title: "Find a Team", body: "Teams near you looking for your role" },
  { icon: Users, title: "Build a Team", body: "Invite, confirm and balance your XI" },
  { icon: CircleDollarSign, title: "Split a Fee", body: "Fair splits, tracked payments, no awkward chasing" },
];

export function WelcomePage() {
  return (
    <div className="pitch-gradient flex min-h-dvh flex-col text-white">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-5 py-8 md:py-14">
        <span className="self-start rounded-2xl bg-white/95 px-3 py-2"><Brand /></span>
        <div className="mt-12 grid flex-1 items-center gap-10 md:grid-cols-2">
          <div>
            <h1 className="font-display text-4xl font-extrabold leading-[1.1] md:text-6xl">Play more cricket.<br /><span className="text-[#f6c453]">Chase fewer people.</span></h1>
            <p className="mt-5 max-w-md text-lg text-white/80">The hyperlocal app for weekend cricketers, captains and corporate teams.</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link to="/register"><Button size="lg" variant="accent" block>Create free account</Button></Link>
              <Link to="/login"><Button size="lg" variant="secondary" block>I already have an account</Button></Link>
            </div>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <li key={f.title} className="rounded-3xl bg-white/10 p-5 ring-1 ring-white/15 backdrop-blur">
                <f.icon className="size-7 text-[#f6c453]" aria-hidden />
                <p className="mt-3 font-display text-lg font-bold">{f.title}</p>
                <p className="text-sm text-white/75">{f.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
