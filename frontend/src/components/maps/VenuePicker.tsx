import type { S } from "@cm/shared";
import { MapPin, Search } from "lucide-react";
import { useState } from "react";

import { Input } from "@/components/ui/field";
import { useVenues } from "@/services/api/endpoints";
import { cn } from "@/utils/cn";

import { type LatLng, LocationPicker } from "./LocationPicker";

export interface VenueValue {
  name: string;
  address: string;
  area: string;
  city: string;
  location: LatLng | null;
}

/** Search seeded grounds or drop a custom pin on the map. */
export function VenuePicker({ value, onChange }: { value: VenueValue; onChange: (v: VenueValue) => void }) {
  const [q, setQ] = useState("");
  const venues = useVenues(q);
  const pick = (v: S<"VenueSearchOut">) => onChange({ name: v.name, address: v.address, area: v.area, city: v.city, location: { lat: v.lat, lng: v.lng } });
  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-ink-400" aria-hidden />
        <Input className="pl-10" placeholder="Search grounds, e.g. Sector 62" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search venues" />
      </div>
      <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {(venues.data ?? []).map((v) => (
          <button key={v.id} type="button" onClick={() => pick(v)}
            className={cn("shrink-0 rounded-2xl px-3 py-2 text-left ring-1 transition", value.name === v.name ? "bg-brand-800 text-white ring-brand-800" : "bg-white ring-sand-300 hover:ring-brand-300")}>
            <span className="flex items-center gap-1 text-sm font-semibold"><MapPin className="size-3.5" aria-hidden />{v.name}</span>
            <span className={cn("text-xs", value.name === v.name ? "text-white/75" : "text-ink-500")}>{v.area}</span>
          </button>
        ))}
      </div>
      <LocationPicker value={value.location} onChange={(loc) => onChange({ ...value, location: loc })} height={220} showLocate={false} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Input aria-label="Venue name" placeholder="Venue name" value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} />
        <Input aria-label="Area" placeholder="Area (shown publicly)" value={value.area} onChange={(e) => onChange({ ...value, area: e.target.value })} />
        <Input aria-label="Address" placeholder="Address (shared with squad only)" value={value.address} onChange={(e) => onChange({ ...value, address: e.target.value })} />
        <Input aria-label="City" placeholder="City" value={value.city} onChange={(e) => onChange({ ...value, city: e.target.value })} />
      </div>
    </div>
  );
}
