import L from "leaflet";
import { Crosshair, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Circle, MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";

import { DEFAULT_LOCATION } from "@cm/shared";

import { Button } from "@/components/ui/button";

export type LatLng = { lat: number; lng: number };
/** Dev/demo flag: treat "my location" as the default city (Noida) instead of asking the browser. */
const USE_DEFAULT_LOCATION = import.meta.env.VITE_USE_DEFAULT_LOCATION === "true";

const pin = L.divIcon({
  className: "",
  html: '<div style="width:28px;height:28px;border-radius:50% 50% 50% 0;background:#0b3d2e;transform:rotate(-45deg);border:3px solid #fff;box-shadow:0 6px 14px rgba(0,0,0,.25)"></div>',
  iconSize: [28, 28],
  iconAnchor: [14, 28],
});

const TILE_URL = import.meta.env.VITE_MAP_TILE_URL ?? "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTR = import.meta.env.VITE_MAP_ATTRIBUTION ?? "&copy; OpenStreetMap contributors";

function ClickToSet({ onPick }: { onPick: (p: LatLng) => void }) {
  useMapEvents({ click: (e) => onPick({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

function Recenter({ at }: { at: LatLng }) {
  const map = useMap();
  useEffect(() => {
    map.setView([at.lat, at.lng], Math.max(map.getZoom(), 13));
  }, [at.lat, at.lng, map]);
  return null;
}

/** Map with tap-to-place pin and an opt-in "use my location" button (permission requested only on click). */
export function LocationPicker({ value, onChange, radiusKm, height = 260, showLocate = true }: {
  value: LatLng | null; onChange: (p: LatLng) => void; radiusKm?: number; height?: number; showLocate?: boolean;
}) {
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const center = value ?? DEFAULT_LOCATION;

  const locate = () => {
    if (USE_DEFAULT_LOCATION) return onChange({ ...DEFAULT_LOCATION });
    if (!("geolocation" in navigator)) return setGeoError("Location isn't available on this device.");
    setLocating(true);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        onChange({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      (err) => {
        setLocating(false);
        setGeoError(err.code === err.PERMISSION_DENIED ? "Location permission denied. Tap the map to set it instead." : "Couldn't get your location.");
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  };

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-2xl ring-1 ring-sand-300" style={{ height }}>
        <MapContainer center={[center.lat, center.lng]} zoom={value ? 14 : 11} style={{ height: "100%" }} scrollWheelZoom={false}>
          <TileLayer url={TILE_URL} attribution={TILE_ATTR} />
          <ClickToSet onPick={onChange} />
          {value && <Marker position={[value.lat, value.lng]} icon={pin} draggable eventHandlers={{ dragend: (e) => { const ll = (e.target as L.Marker).getLatLng(); onChange({ lat: ll.lat, lng: ll.lng }); } }} />}
          {value && radiusKm && <Circle center={[value.lat, value.lng]} radius={radiusKm * 1000} pathOptions={{ color: "#156b48", weight: 1.5, fillOpacity: 0.08 }} />}
          {value && <Recenter at={value} />}
        </MapContainer>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {showLocate && (
          <Button variant="secondary" size="sm" onClick={locate} icon={locating ? <Loader2 className="size-4 animate-spin" /> : <Crosshair className="size-4" />}>
            Use my location
          </Button>
        )}
        <span className="text-xs text-ink-500">{value ? "Tap the map or drag the pin to adjust." : "Tap the map to drop a pin."}</span>
      </div>
      {geoError && <p role="alert" className="text-sm text-ball-600">{geoError}</p>}
    </div>
  );
}
