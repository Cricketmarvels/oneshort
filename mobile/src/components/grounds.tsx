/**
 * Find a ground. Data: GET /venues (seeded cricket grounds: name, address, area, city, distance).
 * The backend has no booking, availability, prices, photos or enquiry endpoint, so this screen never
 * claims a ground is bookable: details open in Maps, with a clear note to contact the ground.
 */
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import type { S } from "@cm/shared";
import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { LandPlot, MapPinned, Swords } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Linking, Pressable, View } from "react-native";

import { GroundCoverImage } from "@/components/media";

import { LocationOptions } from "@/components/cricket";
import { ContextLine } from "@/components/layout";
import { FilterBottomSheet } from "@/components/sheet";
import { Button, EmptyState, ErrorBox, InlineNotice, LoadingSkeleton, SearchBar, Txt } from "@/components/ui";
import { api } from "@/lib/api";
import { useManagedTeam } from "@/lib/hooks";
import { useLocation } from "@/lib/location";
import { MapListToggle, MapPreview } from "@/components/refined";
import { ICON, R, SP, T } from "@/theme";

type Ground = S<"VenueSearchOut">;

/** A ground GoFindr knows has an id; a map suggestion only has a provider key. Either identifies the row. */
const gid = (g: Ground) => g.id ?? g.place_id ?? g.name;

/** Venue card: name, type · ~km, area. Price is never shown — no venue supplies one — so the CTA is "Contact venue". */
function GroundCard({ g, onPress, selected }: { g: Ground; onPress: () => void; selected?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${g.name}, ${g.area}${g.distance_km != null ? `, about ${g.distance_km} kilometres` : ""}`} onPress={onPress}
      style={({ pressed }) => ({ padding: 16, borderRadius: 20, backgroundColor: pressed ? T.surface2 : T.surface, borderWidth: selected ? 2 : 1, borderColor: selected ? T.aqua : T.line })}>
      <GroundCoverImage name={g.name} uri={null} style={{ height: 96, borderRadius: 14, marginBottom: 12 }} />
      <Txt v="h3" style={{ fontSize: 17 }}>{g.name}</Txt>
      <Txt v="small" color={T.muted} style={{ marginTop: 6, fontSize: 14 }}>Cricket ground{g.distance_km != null ? ` · ~${g.distance_km} km` : ""} · {[g.area, g.city].filter(Boolean).join(", ")}</Txt>
      <Txt v="h3" color={T.primary} style={{ marginTop: 10, fontSize: 14 }}>Contact venue</Txt>
    </Pressable>
  );
}

export function FindGrounds() {
  const { lat, lng, label } = useLocation();
  const myTeam = useManagedTeam();
  const [q, setQ] = useState("");
  const [focus, setFocus] = useState<Ground | null>(null);
  const [view, setView] = useState<"map" | "list">("map");
  const [picked, setPicked] = useState<string | null>(null);
  const detail = useRef<BottomSheetModal>(null);
  const locSheet = useRef<BottomSheetModal>(null);
  const res = useQuery({ queryKey: ["grounds", lat, lng, q], queryFn: () => api<Ground[]>("/venues", { query: { lat, lng, q: q.trim() || undefined } }) });
  // Opened from search: show that ground's details straight away, even if it is outside the list radius.
  const params = useLocalSearchParams<{ focus?: string; name?: string; address?: string; area?: string; city?: string; lat?: string; lng?: string }>();
  useEffect(() => {
    if (!params.focus || !params.name) return;
    const fromList = res.data?.find((g) => gid(g) === params.focus);
    const g: Ground = fromList ?? { id: params.focus, name: params.name, address: params.address ?? "", area: params.area ?? "", city: params.city ?? "", lat: Number(params.lat) || 0, lng: Number(params.lng) || 0, distance_km: null, source: "gofindr" };
    setFocus(g); setPicked(gid(g)); setView("list");
    const t = setTimeout(() => detail.current?.present(), 250);
    return () => clearTimeout(t);
  }, [params.focus, params.name, params.address, params.area, params.city, params.lat, params.lng, res.data]);
  const n = res.data?.length ?? 0;
  const maps = (g: Ground) => void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${g.name}, ${g.address}`)}`);
  return (
    <View style={{ gap: SP.lg }}>
      <SearchBar value={q} onChange={setQ} placeholder="Search grounds by name or area" />
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <ContextLine text={`${label} · within 50 km`} onPress={() => locSheet.current?.present()} />
        <MapListToggle value={view} onChange={setView} />
      </View>
      {res.data ? <Txt v="small" color={T.muted}>{n} ground{n === 1 ? "" : "s"} · nearest first · prices and slots aren't listed</Txt> : null}
      {res.isPending ? <LoadingSkeleton rows={4} /> : res.isError ? <ErrorBox error={res.error} onRetry={() => void res.refetch()} /> : !n ? (
        <EmptyState icon={<LandPlot size={22} color={T.primaryDark} strokeWidth={ICON.stroke} />} title="No grounds found" body={q ? "Try another name or area." : "Try searching a nearby area."} />
      ) : (
        <View style={{ gap: 10 }}>
          {view === "map" ? (
            <MapPreview center={{ lat, lng }} radiusKm={50} selected={picked} onSelect={setPicked}
              pins={res.data.slice(0, 25).map((g) => ({ id: gid(g), lat: g.lat, lng: g.lng, label: `${g.name}, ~${g.distance_km ?? "?"} km` }))} />
          ) : null}
          {(view === "map" && picked ? [...res.data.filter((g) => gid(g) === picked), ...res.data.filter((g) => gid(g) !== picked)] : res.data).slice(0, view === "map" ? 6 : undefined).map((g) => (
            <GroundCard key={gid(g)} g={g} selected={gid(g) === picked} onPress={() => { setPicked(gid(g)); setFocus(g); detail.current?.present(); }} />
          ))}
          {view === "map" && n > 6 ? <Button title={`Show all ${n} grounds`} variant="secondary" onPress={() => setView("list")} /> : null}
        </View>
      )}
      <FilterBottomSheet ref={detail} title={focus?.name ?? ""} snap={["58%"]}>
        {focus ? (
          <View style={{ gap: SP.md }}>
            <View style={{ gap: 4 }}>
              <Txt v="body">{focus.address}</Txt>
              <Txt v="small" color={T.muted}>{[focus.area, focus.city].filter(Boolean).join(", ")}{focus.distance_km != null ? ` · ~${focus.distance_km} km away` : ""}</Txt>
            </View>
            <InlineNotice>Booking isn't available in GoFindr. Slots, prices and facilities aren't listed — contact the venue directly; Maps shows its phone number and hours where the venue has published them.</InlineNotice>
            <Button title="Contact venue (opens Maps)" icon={<MapPinned size={18} color={T.onPrimary} strokeWidth={ICON.stroke} />} onPress={() => maps(focus)} />
            {myTeam ? <Button title="Challenge a team to play here" variant="secondary" icon={<Swords size={17} color={T.ink} strokeWidth={ICON.stroke} />} onPress={() => { detail.current?.dismiss(); router.push({ pathname: "/challenge/new", params: { from: myTeam } }); }} /> : null}
          </View>
        ) : null}
      </FilterBottomSheet>
      <FilterBottomSheet ref={locSheet} title="Search near" snap={["75%"]}><LocationOptions onDone={() => locSheet.current?.dismiss()} /></FilterBottomSheet>
    </View>
  );
}
