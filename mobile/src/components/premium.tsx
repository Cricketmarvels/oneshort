/**
 * OneShort premium design system (3-screen reference, Nov 2026): app header + role switcher, sports hero,
 * match / player / team discovery cards, discovery search header and filters. The home action cards
 * live in `components/dashboard/`.
 * Only real API values are rendered; missing data shows a neutral fallback, never an invented number.
 */
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { Image, type ImageContentPosition } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { Check, Lock } from "lucide-react-native";
import type { ComponentType, ReactNode } from "react";
import { memo, useRef, useState } from "react";
import { Pressable, ScrollView, TextInput, useWindowDimensions, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { OneShortMark, Wordmark } from "@/components/brand";
import { PlayRIcon, type PlayRIconName } from "@/components/icons";
import { PHOTO } from "@/components/identity";
import { AuroraBackground } from "@/components/dashboard/SportsIllustrationCard";
import { MatchCoverImage, TeamCoverImage, TeamLogo } from "@/components/media";
import { FilterBottomSheet } from "@/components/sheet";
import { Avatar, Txt } from "@/components/ui";
import { useProfilePhoto } from "@/lib/profile-photo";
import { useSaved } from "@/lib/saved";
import { FW, R, shadow, SP, T } from "@/theme";

export type IconT = ComponentType<{ size?: number; color?: string; strokeWidth?: number; fill?: string }>;

// ---------------------------------------------------------------- header
export { Wordmark };

const ROLE_ART = {
  player: { art: require("../../assets/images/art/cricket/find-players.png"), colors: { base: ["#DCEEFF", "#C5E2FA"], glow: "#B8DBFF", deep: "#9CC7F5" } },
  captain: { art: require("../../assets/images/art/cricket/my-team.png"), colors: { base: ["#FFEEDD", "#FFE0C2"], glow: "#FFD3B0", deep: "#FFC48E" } },
} as const;

/** One picture tile in the role sheet: the home-card artwork on its aurora colour, a tick when chosen. */
function RoleTile({ role, title, body, selected, locked, onPress }: { role: "player" | "captain"; title: string; body: string; selected: boolean; locked?: boolean; onPress?: () => void }) {
  const a = ROLE_ART[role];
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected, disabled: !!locked }} accessibilityLabel={`${title}. ${body}`} disabled={locked} onPress={onPress}
      style={({ pressed }) => ({ flex: 1, minHeight: 196, borderRadius: 20, overflow: "hidden", justifyContent: "flex-end", paddingHorizontal: 12, paddingBottom: 14, paddingTop: 116,
        borderWidth: 2, borderStyle: locked ? "dashed" : "solid", borderColor: selected ? T.primaryDark : locked ? T.line : "transparent", backgroundColor: locked ? T.surface2 : undefined,
        transform: [{ scale: pressed ? 0.97 : 1 }],
        ...(selected ? { shadowColor: "#0B7F58", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.25, shadowRadius: 12, elevation: 4 } : {}) })}>
      {locked ? null : <AuroraBackground id={`role-${role}`} colors={a.colors} />}
      <Image source={a.art} style={{ position: "absolute", left: 0, right: 0, top: 4, height: 108, opacity: locked ? 0.4 : 1 }} contentFit="contain" />
      <View style={{ position: "absolute", top: 10, right: 10 }}>
        {selected ? (
          <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: T.primaryDark, alignItems: "center", justifyContent: "center" }}><Check size={15} color="#FFFFFF" strokeWidth={3} /></View>
        ) : locked ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, height: 22, borderRadius: 11, backgroundColor: T.surface }}><Lock size={12} color={T.muted} strokeWidth={2.2} /><Txt style={{ ...FW.semibold, fontSize: 11, color: T.muted }}>Player account</Txt></View>
        ) : <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: "#C7D2CB", backgroundColor: "rgba(255,255,255,0.7)" }} />}
      </View>
      <Txt style={{ ...FW.display, fontSize: 18, lineHeight: 22, color: locked ? T.muted : "#102C28" }}>{title}</Txt>
      <Txt style={{ ...FW.medium, fontSize: 12, lineHeight: 16, color: locked ? T.muted : "#3D5652" }}>{body}</Txt>
    </Pressable>
  );
}

/** "Player ⌄" pill → sheet of two picture tiles. Captains switch context; player-only accounts see Captain locked (never self-service). */
export function RoleSwitcher({ value, canCaptain, onChange }: { value: "player" | "captain"; canCaptain: boolean; onChange: (v: "player" | "captain") => void }) {
  const sheet = useRef<BottomSheetModal>(null);
  const pick = (v: "player" | "captain") => { sheet.current?.dismiss(); onChange(v); };
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel={`Viewing as ${value}. Change`} onPress={() => sheet.current?.present()}
        style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 6, height: 40, paddingHorizontal: 16, borderRadius: R.pill, backgroundColor: pressed ? T.pressedSoft : T.primarySoft })}>
        <Txt v="smallSemi" style={{ fontSize: 14 }}>{value === "player" ? "Player" : "Captain"}</Txt>
        <PlayRIcon name="caret" size={15} color={T.ink} weight="bold" />
      </Pressable>
      <FilterBottomSheet ref={sheet} title="View OneShort as" snap={["52%"]}>
        <View style={{ gap: 12 }}>
          <Txt v="small" color={T.muted} style={{ marginTop: -6 }}>Switch anytime. Your account stays the same.</Txt>
          <View accessibilityRole="radiogroup" style={{ flexDirection: "row", gap: 10 }}>
            <RoleTile role="player" title="Player" body="Find games, teams and partners" selected={value === "player"} onPress={() => pick("player")} />
            {canCaptain
              ? <RoleTile role="captain" title="Captain" body="Run your team, matches and fees" selected={value === "captain"} onPress={() => pick("captain")} />
              : <RoleTile role="captain" title="Captain" body="Captain tools are set up when an account is created." selected={false} locked />}
          </View>
        </View>
      </FilterBottomSheet>
    </>
  );
}

export function AppHeader({ role, canCaptain, onRole, unread, avatarUri, name }: {
  role: "player" | "captain"; canCaptain: boolean; onRole: (v: "player" | "captain") => void; unread?: number; avatarUri?: string | null; name: string;
}) {
  const { width } = useWindowDimensions();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48 }}>
      {/* Small phones: the mark alone, so the role pill, bell and avatar never squeeze the wordmark. */}
      <View style={{ flex: 1, minWidth: 0 }}>{width < 380 ? <OneShortMark size={30} /> : <Wordmark size={18} />}</View>
      <RoleSwitcher value={role} canCaptain={canCaptain} onChange={onRole} />
      <Pressable accessibilityRole="button" accessibilityLabel={unread ? `Notifications, ${unread} unread` : "Notifications"} onPress={() => router.push("/notifications")} hitSlop={4}
        style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
        <PlayRIcon name="bell" size={24} color={T.ink} weight={unread ? "fill" : "regular"} />
        {unread ? <View style={{ position: "absolute", top: 8, right: 9, width: 10, height: 10, borderRadius: 5, backgroundColor: "#F2554A", borderWidth: 2, borderColor: T.bg }} /> : null}
      </Pressable>
      <HeaderAvatar uri={avatarUri} name={name} />
    </View>
  );
}

/** Header avatar. With no photo yet it shows a camera badge and tapping it adds one; otherwise it opens the profile. */
function HeaderAvatar({ uri, name }: { uri?: string | null; name: string }) {
  const photo = useProfilePhoto();
  const missing = !uri;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={missing ? "Add profile photo" : "Your profile"} disabled={photo.busy}
      onPress={() => (missing ? void photo.upload() : router.push("/me"))}>
      <View style={{ borderRadius: 26, borderWidth: 2, borderColor: "#F5C044", padding: 1, opacity: photo.busy ? 0.5 : 1 }}><Avatar uri={uri} name={name} size={42} /></View>
      {missing ? <CameraBadge /> : null}
    </Pressable>
  );
}

export function CameraBadge({ size = 20 }: { size?: number }) {
  return (
    <View style={{ position: "absolute", right: -2, bottom: -2, width: size, height: size, borderRadius: size / 2, backgroundColor: T.primary, borderWidth: 2, borderColor: T.bg, alignItems: "center", justifyContent: "center" }}>
      <PlayRIcon name="camera" size={size * 0.55} color="#FFFFFF" />
    </View>
  );
}

// ---------------------------------------------------------------- hero
export function SportsHeroBanner({ eyebrow, title, body, cta, onCta, photo = "batting", focus = { left: "58%", top: "40%" } }: {
  eyebrow: string; title: string; body?: string; cta?: string; onCta?: () => void; photo?: keyof typeof PHOTO; focus?: ImageContentPosition;
}) {
  const { width } = useWindowDimensions();
  const small = width < 390;
  return (
    <View style={{ borderRadius: 24, overflow: "hidden", minHeight: 220, backgroundColor: T.heroInk, ...shadow(2) }}>
      {/* full-bleed action photo; focus keeps the player in the right half, clear of the text */}
      <Image source={PHOTO[photo] as number} contentFit="cover" contentPosition={focus} transition={180} style={{ position: "absolute", left: "28%", right: 0, top: 0, bottom: 0 }} accessibilityLabel="Cricket action photo" />
      <LinearGradient colors={["#063F3D", "rgba(6,63,61,0.96)", "rgba(6,63,61,0.55)", "rgba(6,63,61,0.08)"]} locations={[0, 0.36, 0.62, 1]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }} />
      <LinearGradient colors={["rgba(6,63,61,0)", "rgba(6,63,61,0.45)"]} start={{ x: 0.5, y: 0.55 }} end={{ x: 0.5, y: 1 }} style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }} />
      <View style={{ padding: small ? 18 : 22, gap: 10, maxWidth: small ? "80%" : "72%" }}>
        <View style={{ alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, height: 26, borderRadius: 13, backgroundColor: "rgba(255,255,255,0.16)" }}>
          <PlayRIcon name="cricket" size={14} color="#FFFFFF" weight="fill" />
          <Txt v="micro" color="#FFFFFF">{eyebrow}</Txt>
        </View>
        <Txt style={{ ...FW.display, fontSize: small ? 24 : 27, lineHeight: small ? 29 : 32, letterSpacing: -0.6, color: "#FFFFFF" }}>{title}</Txt>
        {body ? <Txt v="small" color="rgba(255,255,255,0.9)" style={{ fontSize: 14, lineHeight: 19 }}>{body}</Txt> : null}
        {cta && onCta ? (
          <Pressable accessibilityRole="button" accessibilityLabel={cta} onPress={onCta}
            style={({ pressed }) => ({ marginTop: 6, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 8, height: 46, paddingHorizontal: 20, borderRadius: 23, backgroundColor: pressed ? "#CBEEE5" : "#DDF5EF" })}>
            <Txt v="h3" color={T.heroInk} style={{ fontSize: 15 }}>{cta}</Txt>
            <PlayRIcon name="arrow" size={18} color={T.heroInk} weight="bold" />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 28 }}>
      <Txt v="h1" style={{ fontSize: 21 }}>{title}</Txt>
      {action && onAction ? (
        <Pressable accessibilityRole="button" onPress={onAction} hitSlop={10} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Txt v="smallSemi" color={T.primaryDark} style={{ fontSize: 14 }}>{action}</Txt><PlayRIcon name="arrow" size={16} color={T.primaryDark} weight="bold" />
        </Pressable>
      ) : null}
    </View>
  );
}

/** Branded fallback where a real photo doesn't exist (grounds, team covers): deep-green gradient + soft pitch lines. */
export function BrandFallback({ style, icon: Icon, label }: { style?: ViewStyle; icon?: IconT; label?: string }) {
  return (
    <LinearGradient colors={["#10704F", "#0A2A20"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[{ alignItems: "center", justifyContent: "center", overflow: "hidden" }, style]}>
      <View style={{ position: "absolute", width: "70%", aspectRatio: 1, borderRadius: 999, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.10)" }} />
      <View style={{ position: "absolute", width: 22, top: 0, bottom: 0, backgroundColor: "rgba(255,255,255,0.06)" }} />
      <View style={{ position: "absolute", width: "160%", height: 40, backgroundColor: "rgba(255,106,61,0.10)", transform: [{ rotate: "-18deg" }], top: "30%" }} />
      {Icon ? <Icon size={26} color="rgba(255,255,255,0.75)" strokeWidth={1.6} /> : <PlayRIcon name="trophy" size={26} color="rgba(255,255,255,0.75)" />}
      {label ? <Txt v="micro" color="rgba(255,255,255,0.7)" style={{ marginTop: 4, fontSize: 9.5 }}>{label}</Txt> : null}
    </LinearGradient>
  );
}

// ---------------------------------------------------------------- match card
const TICKET_PHOTOS = [PHOTO.ground, PHOTO.batting, PHOTO.bowler, PHOTO.stadium] as const;
/** Same game, same fallback photo: neighbouring cards in a swipe row usually differ. */
function ticketPhoto(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return TICKET_PHOTOS[Math.abs(h) % TICKET_PHOTOS.length]!;
}

/**
 * "Photo ticket" match card: the match or venue photo on top (a cricket photo when there's none) with format,
 * distance and date on it; then the title, host team, a bar showing how full the squad is, the fee and the CTA.
 * One accessible button.
 */
export const MatchDiscoveryCard = memo(function MatchDiscoveryCard({ id, title, format, date, time, distanceKm, area, spots, capacity, needs, host, feePaise, cta = "View", cover, onPress }: {
  id: string; title: string; format?: string | null; date: string; time: string; distanceKm?: number | null; area?: string | null; spots: number; capacity?: number | null;
  needs?: string | null; host?: string | null; feePaise?: number | null; cta?: string; cover?: string | null; onPress: () => void;
}) {
  const cap = capacity && capacity > 0 ? capacity : null;
  const filled = cap ? Math.max(0, cap - spots) : null;
  const pct = cap && filled != null ? Math.min(100, Math.max(4, Math.round((filled / cap) * 100))) : 0;
  const fee = feePaise && feePaise > 0 ? `₹${Math.round(feePaise / 100).toLocaleString("en-IN")}` : null;
  const open = `${spots} spot${spots === 1 ? "" : "s"} open`;
  const label = [title, `${date} ${time}`, host ? `hosted by ${host}` : null, open, fee ? `${fee} per head` : null, cta].filter(Boolean).join(". ");
  const [photoFailed, setPhotoFailed] = useState(false);
  const src = (cover && !photoFailed ? { uri: cover } : ticketPhoto(id)) as number | { uri: string };
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
      style={({ pressed }) => ({ borderRadius: 20, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, overflow: "hidden", transform: [{ scale: pressed ? 0.98 : 1 }],
        shadowColor: "#183B35", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.12, shadowRadius: 14, elevation: 3 })}>
      <View style={{ height: 118 }}>
        <Image source={src} onError={() => setPhotoFailed(true)} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} contentFit="cover" transition={150} accessibilityElementsHidden />
        <LinearGradient colors={["rgba(5,25,18,0.15)", "rgba(5,25,18,0)", "rgba(5,25,18,0.7)"]} locations={[0, 0.35, 1]} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
        <View style={{ position: "absolute", top: 10, left: 10, right: 10, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          {format ? <View style={{ paddingHorizontal: 9, height: 24, borderRadius: 12, backgroundColor: "#0A2A20", justifyContent: "center" }}><Txt style={{ ...FW.bold, fontSize: 12, color: "#FFFFFF" }}>{format}</Txt></View> : <View />}
          {distanceKm != null ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 9, height: 24, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.93)" }}>
              <PlayRIcon name="pin" size={13} color={T.ink} weight="bold" />
              <Txt style={{ ...FW.semibold, fontSize: 12, color: T.ink }}>~{distanceKm} km</Txt>
            </View>
          ) : null}
        </View>
        <View style={{ position: "absolute", left: 12, right: 12, bottom: 10, flexDirection: "row", alignItems: "center", gap: 6 }}>
          <PlayRIcon name="calendar" size={15} color="#FFFFFF" weight="bold" />
          <Txt style={{ ...FW.bold, fontSize: 14, color: "#FFFFFF" }} numberOfLines={1}>{date} · {time}</Txt>
        </View>
      </View>

      <View style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14, gap: 8 }}>
        <Txt style={{ ...FW.display, fontSize: 16, lineHeight: 20.5, letterSpacing: -0.2, color: T.ink }} numberOfLines={2}>{title}</Txt>
        {host || area ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <PlayRIcon name={host ? "shield" : "pin"} size={14} color={T.muted} weight="bold" />
            <Txt v="small" color={T.text2} numberOfLines={1} style={{ flexShrink: 1 }}>{[host ? `Hosted by ${host}` : null, area].filter(Boolean).join(" · ")}</Txt>
          </View>
        ) : null}
        <View style={{ gap: 5 }}>
          {cap ? (
            <View style={{ height: 7, borderRadius: 4, backgroundColor: T.surface2, overflow: "hidden" }}>
              <LinearGradient colors={["#12A672", "#0B7F58"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ width: `${pct}%`, height: "100%", borderRadius: 4 }} />
            </View>
          ) : null}
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
            <Txt v="small" color={T.text2} numberOfLines={1} style={{ flexShrink: 1, fontSize: 12 }}>{cap && filled != null ? `${filled} of ${cap} in${needs ? ` · need ${needs}` : ""}` : needs ? `Need ${needs}` : " "}</Txt>
            <Txt numberOfLines={1} style={{ ...FW.bold, fontSize: 12, flexShrink: 0, color: spots ? T.accentOrange : T.successText }}>{spots ? open : "Squad full"}</Txt>
          </View>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 2 }}>
          <Txt v="small" color={T.text2}>{fee ? <Txt style={{ ...FW.display, fontSize: 16, color: T.ink }}>{fee}</Txt> : <Txt style={{ ...FW.bold, fontSize: 14, color: T.successText }}>Free to play</Txt>}{fee ? " per head" : ""}</Txt>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, height: 40, paddingHorizontal: 18, borderRadius: 13, backgroundColor: T.primaryDark,
            shadowColor: "#0B7F58", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 2 }}>
            <Txt style={{ ...FW.bold, fontSize: 14.5, color: "#FFFFFF" }}>{cta}</Txt>
            <PlayRIcon name="chevronRight" size={15} color="#FFFFFF" weight="bold" />
          </View>
        </View>
      </View>
    </Pressable>
  );
});

function Meta({ icon, text }: { icon: "calendar" | "clock" | "pin"; text: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5, flexShrink: 1 }}>
      <PlayRIcon name={icon} size={15} color={T.muted} weight="bold" />
      <Txt v="small" color={T.ink} numberOfLines={1} style={{ flexShrink: 1 }}>{text}</Txt>
    </View>
  );
}

export function AvailabilityPill({ text }: { text: string }) {
  return (
    <View style={{ alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, height: 24, borderRadius: 12, backgroundColor: T.successPill }}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: T.success }} />
      <Txt v="smallSemi" color={T.successText} numberOfLines={1} style={{ fontSize: 12, flexShrink: 1 }}>{text}</Txt>
    </View>
  );
}

// ---------------------------------------------------------------- discovery header & filters
export function DiscoveryTitle({ title }: { title: string }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingTop: insets.top + 10, paddingBottom: 6, minHeight: 56 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} hitSlop={10} style={{ width: 44, height: 44, justifyContent: "center" }}>
        <PlayRIcon name="back" size={26} color={T.ink} weight="bold" />
      </Pressable>
      <Txt v="hero" accessibilityRole="header">{title}</Txt>
    </View>
  );
}

export function SearchField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, height: 54, paddingHorizontal: 18, borderRadius: 18, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, ...shadow(1) }}>
      <SearchIcon />
      <TextInput accessibilityLabel={placeholder} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={T.muted} autoCorrect={false}
        style={{ flex: 1, minWidth: 0, ...FW.body, fontSize: 15.5, color: T.ink }} />
    </View>
  );
}
function SearchIcon() {
  return <View style={{ width: 20, height: 20, alignItems: "center", justifyContent: "center" }}><View style={{ width: 15, height: 15, borderRadius: 8, borderWidth: 2, borderColor: T.ink }} /><View style={{ position: "absolute", right: 1, bottom: 1, width: 6, height: 2, backgroundColor: T.ink, transform: [{ rotate: "45deg" }] }} /></View>;
}

export function LocationRow({ label, radius, onLocation, onFilters, activeFilters }: { label: string; radius: string | number; onLocation: () => void; onFilters: () => void; activeFilters?: number }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}, ${radius} km. Change location`} onPress={onLocation}
        style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 8, height: 44, paddingHorizontal: 16, borderRadius: 22, backgroundColor: pressed ? T.surface2 : T.surface, borderWidth: 1, borderColor: T.line, flexShrink: 1 })}>
        <PlayRIcon name="pin" size={18} weight="fill" />
        <Txt v="bodyMed" numberOfLines={1} style={{ flexShrink: 1, fontSize: 14.5 }}>{label} · {radius} km</Txt>
        <PlayRIcon name="caret" size={16} color={T.ink} weight="bold" />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={activeFilters ? `Filters, ${activeFilters} active` : "Filters"} onPress={onFilters}
        style={({ pressed }) => ({ width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? T.surface2 : T.surface, borderWidth: 1, borderColor: activeFilters ? T.primary : T.line, ...shadow(1) })}>
        <PlayRIcon name="filters" size={20} color={T.ink} />
        {activeFilters ? <View style={{ position: "absolute", top: 4, right: 4, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: T.primary, alignItems: "center", justifyContent: "center" }}><Txt v="micro" color="#FFFFFF" style={{ fontSize: 9, letterSpacing: 0 }}>{activeFilters}</Txt></View> : null}
      </Pressable>
    </View>
  );
}

/** Pill chip: selected = solid primary with white label; optional leading icon. */
export function Pill({ label, active, onPress, icon }: { label: string; active?: boolean; onPress: () => void; icon?: PlayRIconName }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: !!active }} accessibilityLabel={label} onPress={onPress} hitSlop={{ top: 4, bottom: 4 }}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 6, height: 40, paddingHorizontal: icon ? 12 : 18, borderRadius: 20, backgroundColor: active ? T.primary : pressed ? T.surface2 : T.surface, borderWidth: 1, borderColor: active ? T.primary : T.line, ...(active ? shadow(2) : {}) })}>
      {icon ? <PlayRIcon name={icon} size={17} color={active ? "#FFFFFF" : T.ink} /> : null}
      <Txt v="smallSemi" color={active ? "#FFFFFF" : T.ink} style={{ fontSize: 14 }}>{label}</Txt>
    </Pressable>
  );
}
export function PillRow({ children }: { children: ReactNode }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -SP.page, flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: SP.page, gap: 8 }}>{children}</ScrollView>;
}

export function SaveButton({ kind, id, name }: { kind: "player" | "team"; id: string; name: string }) {
  const saved = useSaved((s) => !!s.ids[`${kind}:${id}`]);
  const toggle = useSaved((s) => s.toggle);
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: saved }} accessibilityLabel={saved ? `Remove ${name} from saved` : `Save ${name}`} onPress={() => toggle(kind, id)} hitSlop={10}
      style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center" }}>
      <PlayRIcon name="bookmark" size={22} color={saved ? T.primary : T.ink} weight={saved ? "fill" : "regular"} />
    </Pressable>
  );
}

// ---------------------------------------------------------------- player card
export type InviteState = "idle" | "sending" | "sent" | "error";
export const PlayerDiscoveryCard = memo(function PlayerDiscoveryCard({ id, name, photo, role, ratingText, meta, available, onOpen, onInvite, invite, canInvite, cricheroes }: {
  id: string; name: string; photo?: string | null; role: string; ratingText?: string | null; meta: string; available: boolean; cricheroes?: boolean;
  onOpen: () => void; onInvite?: () => void; invite?: InviteState; canInvite: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${name}, ${role}. ${meta}${available ? ". Available this week" : ""}${cricheroes ? ". Has a CricHeroes profile" : ""}`} onPress={onOpen}
      style={({ pressed }) => ({ flexDirection: "row", gap: 14, padding: 14, paddingRight: 12, borderRadius: 22, backgroundColor: pressed ? T.surface2 : T.surface, borderWidth: 1, borderColor: T.line, ...shadow(1) })}>
      <Avatar uri={photo} name={name} size={66} />
      <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingRight: 30 }}>
          <Txt v="h3" numberOfLines={1} style={{ flexShrink: 1, fontSize: 17 }}>{name}</Txt>
          {ratingText ? <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}><PlayRIcon name="star" size={14} color="#F5A623" weight="fill" /><Txt v="small" color={T.muted} style={{ fontSize: 13 }}>{ratingText}</Txt></View> : null}
        </View>
        <View style={{ flexDirection: "row", gap: 6, alignSelf: "flex-start" }}>
          <View style={{ paddingHorizontal: 9, height: 22, borderRadius: 11, backgroundColor: T.chipNeutral, justifyContent: "center" }}><Txt v="smallSemi" style={{ fontSize: 12 }}>{role}</Txt></View>
          {cricheroes ? <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 9, height: 22, borderRadius: 11, backgroundColor: T.primarySoft }}><PlayRIcon name="stats" size={12} color={T.primaryDark} /><Txt v="smallSemi" color={T.primaryDark} style={{ fontSize: 12 }}>CricHeroes</Txt></View> : null}
        </View>
        <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 8 }}>
          <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
            <Txt v="small" color={T.muted} numberOfLines={1} style={{ fontSize: 13.5 }}>{meta}</Txt>
            {available ? <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: T.success }} /><Txt v="smallSemi" color={T.successText}>Available this week</Txt></View> : null}
          </View>
          {canInvite ? (
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: invite === "sending" || invite === "sent" }} accessibilityLabel={invite === "sent" ? `${name} invited` : `Invite ${name}`}
              disabled={invite === "sending" || invite === "sent"} onPress={onInvite}
              style={({ pressed }) => ({ height: 40, minWidth: 88, paddingHorizontal: 18, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: invite === "sent" ? T.primarySoft : invite === "error" ? T.dangerBackground : pressed ? T.primaryPressed : T.primary })}>
              <Txt v="h3" color={invite === "sent" ? T.primaryDark : invite === "error" ? T.dangerText : "#FFFFFF"} style={{ fontSize: 14.5 }}>
                {invite === "sending" ? "Sending…" : invite === "sent" ? "Invited" : invite === "error" ? "Retry" : "Invite"}
              </Txt>
            </Pressable>
          ) : null}
        </View>
      </View>
      <View style={{ position: "absolute", top: 10, right: 8 }}><SaveButton kind="player" id={id} name={name} /></View>
    </Pressable>
  );
});

// ---------------------------------------------------------------- team card
export type TeamState = "recruiting" | "pending" | "mine" | "invited" | "full" | "member";
export const TeamDiscoveryCard = memo(function TeamDiscoveryCard({ id, name, ratingText, meta, need, state, onOpen, onJoin, joining, logo, cover }: {
  id: string; name: string; ratingText?: string | null; meta: string; need?: string | null; state: TeamState; onOpen: () => void; onJoin?: () => void; joining?: boolean;
  logo?: string | null; cover?: string | null;
}) {
  const action = state === "mine" ? "Manage Team" : state === "pending" ? "Request Pending" : state === "invited" ? "View invitation" : state === "recruiting" && onJoin ? "Request to join" : "View Team";
  const primary = state === "recruiting" && !!onJoin;
  const stack = (need?.length ?? 0) > 24; // long requirement lists get their own row instead of truncating
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${name}. ${meta}${need ? `. ${need}` : ""}`} onPress={onOpen}
      style={({ pressed }) => ({ borderRadius: 22, overflow: "hidden", backgroundColor: pressed ? T.surface2 : T.surface, borderWidth: 1, borderColor: T.line, ...shadow(1) })}>
      <TeamCoverImage name={name} uri={cover} height={104} />
      <View style={{ position: "absolute", top: 70, left: 14 }}><TeamLogo name={name} uri={logo} size={66} ring /></View>
      <View style={{ paddingTop: 10, paddingLeft: 86, paddingRight: 12, paddingBottom: 14, gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingRight: 32 }}>
          <Txt v="h3" numberOfLines={1} style={{ fontSize: 17, flexShrink: 1 }}>{name}</Txt>
        </View>
        {ratingText ? <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}><PlayRIcon name="star" size={14} color="#F5A623" weight="fill" /><Txt v="small" color={T.muted}>{ratingText}</Txt></View> : null}
        <Txt v="small" color={T.muted} numberOfLines={1} style={{ fontSize: 13 }}>{meta}</Txt>
        <View style={{ flexDirection: stack ? "column" : "row", alignItems: stack ? "stretch" : "center", justifyContent: "space-between", gap: 10, marginTop: 6, marginLeft: -72 }}>
          {need ? <View style={{ alignSelf: "flex-start", flexShrink: 1, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 15, backgroundColor: state === "full" ? T.chipNeutral : T.successPill }}><Txt v="smallSemi" color={state === "full" ? T.muted : T.successText}>{need}</Txt></View> : <View />}
          <Pressable accessibilityRole="button" accessibilityLabel={action} disabled={state === "pending" || joining} onPress={primary ? onJoin : onOpen}
            style={({ pressed }) => ({ alignSelf: stack ? "flex-end" : "auto", flexDirection: "row", alignItems: "center", gap: 6, height: 40, paddingHorizontal: 18, borderRadius: 20, borderWidth: primary ? 0 : 1.5, borderColor: T.line, backgroundColor: primary ? (pressed ? T.primaryPressed : T.primary) : state === "pending" ? T.surface2 : T.surface })}>
            <Txt v="h3" color={primary ? "#FFFFFF" : state === "pending" ? T.muted : T.primaryDark} style={{ fontSize: 14 }}>{joining ? "Sending…" : action}</Txt>
            {!primary && state !== "pending" ? <PlayRIcon name="arrow" size={16} color={T.primaryDark} weight="bold" /> : null}
          </Pressable>
        </View>
      </View>
      <View style={{ position: "absolute", top: 108, right: 8 }}><SaveButton kind="team" id={id} name={name} /></View>
    </Pressable>
  );
});
