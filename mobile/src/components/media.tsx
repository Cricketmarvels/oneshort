/**
 * Media-first rendering. Each component shows the entity's own uploaded image (expo-image: cached, fades in,
 * placeholder while loading) and falls back when the URL is missing OR the image fails to load.
 * Fallbacks are branded, never another team's logo or a real venue photo presented as this entity's.
 */
import { Image, type ImageContentPosition, type ImageSource } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import type { ReactNode } from "react";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View, type ViewStyle } from "react-native";

import { PlayRIcon, SportsActionIcon, type SportsAction } from "@/components/icons";
import { Avatar, Txt } from "@/components/ui";
import { errorText } from "@/lib/api";
import { pickAndUpload, type UploadPurpose } from "@/lib/device";
import { mediaUrl } from "@/lib/media";
import { ART, FW, T } from "@/theme";

export { Avatar as PlayerAvatar };

function hashIndex(s: string, n: number) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % n;
}
function initialsOf(name: string) {
  const w = name.split(/\s+/).filter(Boolean);
  const lettered = w.filter((x) => /^\p{L}/u.test(x));
  return (lettered.length ? lettered : w).map((x) => x[0]).slice(0, 2).join("").toUpperCase();
}

/** Raster with load-failure fallback. */
function SafeImage({ uri, label, style, fallback, position = "center" }: { uri: string | null | undefined; label: string; style: ViewStyle; fallback: ReactNode; position?: ImageContentPosition }) {
  const [failed, setFailed] = useState(false);
  const src = mediaUrl(uri);
  if (!src || failed) return <>{fallback}</>;
  return (
    <View style={[style, { overflow: "hidden", backgroundColor: T.primarySoft }]}>
      <Image source={{ uri: src }} style={{ width: "100%", height: "100%" }} contentFit="cover" contentPosition={position} cachePolicy="memory-disk"
        transition={180} recyclingKey={src} accessibilityLabel={label} onError={() => setFailed(true)} />
    </View>
  );
}

/** Team logo → branded monogram (team colour derived from the name, so it's stable). */
export function TeamLogo({ name, uri, size = 48, ring }: { name: string; uri?: string | null; size?: number; ring?: boolean }) {
  const [fg, bg] = ART.kits[hashIndex(name, ART.kits.length)]!;
  const box: ViewStyle = { width: size, height: size, borderRadius: size / 2, ...(ring ? { borderWidth: 3, borderColor: T.surface } : {}) };
  const monogram = (
    <View accessibilityLabel={`${name} logo`} style={[box, { backgroundColor: bg, alignItems: "center", justifyContent: "center", overflow: "hidden" }]}>
      <Text style={{ ...FW.display, fontSize: size * 0.36, color: fg, letterSpacing: -0.5 }}>{initialsOf(name)}</Text>
    </View>
  );
  return <SafeImage uri={uri} label={`${name} logo`} style={box} fallback={monogram} />;
}

/** Approved cricket-themed banner (branded, not a photo of any real team/venue). */
export function CricketBanner({ style, label, tone = "teal" }: { style: ViewStyle; label?: string; tone?: "teal" | "night" }) {
  return (
    <LinearGradient colors={tone === "night" ? ["#0A3D3A", "#041F1E"] : ["#0B6B66", "#063F3D"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={[style, { overflow: "hidden", alignItems: "center", justifyContent: "center" }]} accessibilityLabel={label}>
      <View style={{ position: "absolute", width: "75%", aspectRatio: 1.7, borderRadius: 999, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.10)" }} />
      <View style={{ position: "absolute", width: "30%", aspectRatio: 0.9, borderRadius: 999, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" }} />
      <View style={{ position: "absolute", width: 18, top: "22%", bottom: "22%", borderRadius: 3, backgroundColor: "rgba(232,220,180,0.18)" }} />
      <View style={{ position: "absolute", width: "160%", height: 46, backgroundColor: "rgba(127,224,214,0.07)", transform: [{ rotate: "-16deg" }], top: "28%" }} />
    </LinearGradient>
  );
}

/** Team cover → approved cricket banner. */
export function TeamCoverImage({ name, uri, height = 110, style }: { name: string; uri?: string | null; height?: number; style?: ViewStyle }) {
  const box: ViewStyle = { height, width: "100%", ...style };
  return <SafeImage uri={uri} label={`${name} cover photo`} style={box} fallback={<CricketBanner style={box} label={`${name} banner`} />} />;
}

/** Match photo → (venue photo, when a verified one exists) → sport-specific fallback tile. */
export function MatchCoverImage({ uri, venueUri, title, format, style }: { uri?: string | null; venueUri?: string | null; title: string; format?: string | null; style: ViewStyle }) {
  const fallback = (
    <LinearGradient colors={["#0B6B66", "#063F3D"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[style, { alignItems: "center", justifyContent: "center", gap: 6, overflow: "hidden" }]} accessibilityLabel={`${title} — no match photo yet`}>
      <SportsActionIcon action="bookGround" size={Math.min(56, Math.max(40, ((style.height as number) || 96) * 0.46))} inverse />
      {format ? <View style={{ paddingHorizontal: 8, height: 20, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.18)", justifyContent: "center" }}><Txt v="micro" color="#FFFFFF" style={{ fontSize: 10.5 }}>{format}</Txt></View> : null}
    </LinearGradient>
  );
  const venue = <SafeImage uri={venueUri} label={`${title} venue`} style={style} fallback={fallback} />;
  return <SafeImage uri={uri} label={`${title} photo`} style={style} fallback={venue} />;
}

/** Ground photo (owner-uploaded only) → neutral placeholder. */
export function GroundCoverImage({ name, uri, style }: { name: string; uri?: string | null; style: ViewStyle }) {
  const fallback = (
    <View style={[style, { backgroundColor: T.primarySoft, alignItems: "center", justifyContent: "center", gap: 4 }]} accessibilityLabel={`${name} — no venue photos yet`}>
      <SportsActionIcon action="bookGround" size={34} />
      <Txt v="small" color={T.primaryDark} style={{ fontSize: 11.5 }}>No photos from this venue yet</Txt>
    </View>
  );
  return <SafeImage uri={uri} label={`${name} photo`} style={style} fallback={fallback} />;
}

/**
 * Large action-card artwork. ARTWORK holds licensed raster illustrations once approved (drop files in
 * assets/artwork/ and register them here). Until then the interim PlayR pictogram is shown.
 */
export const ARTWORK: Partial<Record<SportsAction, ImageSource | number>> = {};

export function SportsActionArtwork({ action, size = 56, color }: { action: SportsAction; size?: number; color?: string }) {
  const art = ARTWORK[action];
  if (art) return <Image source={art} style={{ width: size, height: size }} contentFit="contain" accessibilityElementsHidden />;
  return <SportsActionIcon action={action} size={size * 0.78} color={color} />;
}

/**
 * Manager-only "change photo" control. Picks from the library, uploads with the purpose (server validates, resizes,
 * strips metadata and records the owner), then hands the PlayR URL to `save` (PUT on the entity — the API rejects
 * any URL that isn't a PlayR upload). Errors are shown inline; nothing changes until the save succeeds.
 */
export function MediaEditButton({ label, purpose, save, onDark }: { label: string; purpose: UploadPurpose; save: (url: string) => Promise<unknown>; onDark?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    setErr(null); setBusy(true);
    try { const url = await pickAndUpload("library", purpose); if (url) await save(url); }
    catch (e) { setErr(errorText(e)); }
    finally { setBusy(false); }
  };
  const fg = onDark ? "#FFFFFF" : T.primaryDark;
  return (
    <View style={{ gap: 4 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={busy} onPress={() => void run()} hitSlop={6}
        style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: 12, height: 34, borderRadius: 17,
          backgroundColor: onDark ? (pressed ? "rgba(0,0,0,0.6)" : "rgba(0,0,0,0.42)") : pressed ? T.primarySoft : T.surface, borderWidth: onDark ? 0 : 1, borderColor: T.line, opacity: busy ? 0.6 : 1 })}>
        {busy ? <ActivityIndicator size="small" color={fg} /> : <PlayRIcon name="camera" size={16} color={fg} />}
        <Txt v="smallSemi" color={fg}>{busy ? "Uploading…" : label}</Txt>
      </Pressable>
      {err ? <Txt v="small" color={onDark ? "#FFD7D7" : T.dangerText}>{err}</Txt> : null}
    </View>
  );
}
