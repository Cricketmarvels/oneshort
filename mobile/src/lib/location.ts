/**
 * Where rankings and discovery are measured from. Defaults to Noida; the player can use
 * their device location (asked only when they tap it) or pick a locality manually.
 * Coordinates stay on the device and are only sent as query parameters; the server never
 * returns anyone's coordinates.
 */
import { DEFAULT_CITY, DEFAULT_LOCATION } from "@cm/shared";
import { create } from "zustand";

import { readLocation } from "./device";

export const PLACES: { label: string; city: string; lat: number; lng: number }[] = [
  { label: "Noida (centre)", city: "Noida", ...DEFAULT_LOCATION },
  { label: "Sector 18, Noida", city: "Noida", lat: 28.5708, lng: 77.3261 },
  { label: "Sector 62, Noida", city: "Noida", lat: 28.627, lng: 77.3649 },
  { label: "Sector 137, Noida", city: "Noida", lat: 28.51, lng: 77.408 },
  { label: "Noida Extension", city: "Noida", lat: 28.606, lng: 77.425 },
  { label: "Greater Noida", city: "Greater Noida", lat: 28.4744, lng: 77.504 },
  { label: "Indirapuram, Ghaziabad", city: "Ghaziabad", lat: 28.646, lng: 77.3695 },
  { label: "Mayur Vihar, Delhi", city: "Delhi", lat: 28.608, lng: 77.293 },
];

export const RADII = ["5", "10", "20", "50"] as const;
export type Radius = (typeof RADII)[number];

type LocState = {
  lat: number; lng: number; label: string; city: string; source: "default" | "device" | "manual";
  radius: Radius;
  setRadius: (r: Radius) => void;
  pick: (p: (typeof PLACES)[number]) => void;
  /** true once the device position is in use, otherwise a reason to show the player. */
  useDevice: () => Promise<true | string>;
};

export const useLocation = create<LocState>((set) => ({
  ...DEFAULT_LOCATION,
  label: `${DEFAULT_CITY} (centre)`,
  city: DEFAULT_CITY,
  source: "default",
  radius: "10",
  setRadius: (radius) => set({ radius }),
  pick: (p) => set({ lat: p.lat, lng: p.lng, label: p.label, city: p.city, source: "manual" }),
  useDevice: async () => {
    const r = await readLocation();
    if (!r.ok) return r.reason;
    set({ lat: r.lat, lng: r.lng, label: "My location", source: "device" });
    return true;
  },
}));
