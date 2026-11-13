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
import type { ComponentType, ReactNode } from "react";
import { memo, useRef } from "react";
import { Pressable, ScrollView, TextInput, useWindowDimensions, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { OneShortMark, Wordmark } from "@/components/brand";
import { PlayRIcon, type PlayRIconName } from "@/components/icons";
import { PHOTO } from "@/components/identity";
import { MatchCoverImage, TeamCoverImage, TeamLogo } from "@/components/media";
import { FilterBottomSheet } from "@/components/sheet";
import { Avatar, Txt } from "@/components/ui";
import { useProfilePhoto } from "@/lib/profile-photo";
import { useSaved } from "@/lib/saved";
import { FW, R, shadow, SP, T } from "@/theme";

export type IconT = ComponentType<{ size?: number; color?: string; strokeWidth?: number; fill?: string }>;

// ---------------------------------------------------------------- header
export { Wordmark };

/** "Player ⌄" pill → sheet. Captains switch context; players get a path to start a team (one account, never a second one). */
export function RoleSwitcher({ value, canCaptain, onChange }: { value: "player" | "captain"; canCaptain: boolean; onChange: (v: "player" | "captain") => void }) {
  const sheet = useRef<BottomSheetModal>(null);
  const opt = (v: "player" | "captain", title: string, body: string) => (
    <Pressable key={v} accessibilityRole="radio" accessibilityState={{ selected: value === v }} onPress={() => { sheet.current?.dismiss(); onChange(v); }}
      style={{ padding: 16, borderRadius: 18, borderWidth: value === v ? 2 : 1, borderColor: value === v ? T.primary : T.line, backgroundColor: value === v ? T.primarySoft : T.surface, gap: 3 }}>
      <Txt v="h3">{title}</Txt><Txt v="small" color={T.muted}>{body}</Txt>
    </Pressable>
  );
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel={`Viewing as ${value}. Change`} onPress={() => sheet.current?.present()}
        style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 6, height: 40, paddingHorizontal: 16, borderRadius: R.pill, backgroundColor: pressed ? T.pressedSoft : T.primarySoft })}>
        <Txt v="smallSemi" style={{ fontSize: 14 }}>{value === "player" ? "Player" : "Captain"}</Txt>
        <PlayRIcon name="caret" size={15} color={T.ink} weight="bold" />
      </Pressable>
      <FilterBottomSheet ref={sheet} title="View OneShort as" snap={["44%"]}>
        <View style={{ gap: 10 }}>
          {opt("player", "Player", "Find games, teams and playing partners")}
          {canCaptain ? opt("captain", "Captain", "Manage your team, matches and invitations") : (
            <Pressable accessibilityRole="button" onPress={() => { sheet.current?.dismiss(); router.push("/team/new"); }}
              style={{ padding: 16, borderRadius: 18, borderWidth: 1, borderColor: T.line, borderStyle: "dashed", gap: 3 }}>
              <Txt v="h3" color={T.primaryDark}>Become a captain</Txt><Txt v="small" color={T.muted}>Create a team — same account, captain tools unlock.</Txt>
            </Pressable>
          )}
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
/** Compact match card: branded ground thumbnail, format badge, 2-line title, date · time, ~distance · area, open positions, CTA. */
export const MatchDiscoveryCard = memo(function MatchDiscoveryCard({ title, format, date, time, distanceKm, area, spots, needs, cta = "View", cover, onPress }: {
  title: string; format?: string | null; date: string; time: string; distanceKm?: number | null; area?: string | null; spots: number; needs?: string | null; cta?: string; cover?: string | null; onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${date} ${time}. ${spots} spots open. ${cta}`} onPress={onPress}
      style={({ pressed }) => ({ flexDirection: "row", gap: 12, padding: 12, borderRadius: 20, backgroundColor: pressed ? T.surface2 : T.surface, borderWidth: 1, borderColor: T.line, ...shadow(1) })}>
      <View style={{ width: 84, alignSelf: "stretch", minHeight: 96, borderRadius: 16, overflow: "hidden" }}>
        <MatchCoverImage uri={cover} title={title} format={format} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
        {cover && format ? <View style={{ position: "absolute", left: 6, bottom: 6, paddingHorizontal: 7, height: 18, borderRadius: 9, backgroundColor: "rgba(6,63,61,0.85)", justifyContent: "center" }}><Txt v="micro" color="#FFFFFF" style={{ fontSize: 10 }}>{format}</Txt></View> : null}
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
        <Txt v="h3" numberOfLines={2} style={{ fontSize: 16.5, lineHeight: 21 }}>{title}</Txt>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <Meta icon="calendar" text={date} />
          <Meta icon="clock" text={time} />
        </View>
        {distanceKm != null || area ? <Meta icon="pin" text={[distanceKm != null ? `~${distanceKm} km` : null, area].filter(Boolean).join(" · ")} /> : null}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 2 }}>
          <View style={{ flexShrink: 1 }}><AvailabilityPill text={`${spots} spot${spots === 1 ? "" : "s"} open${needs ? ` · ${needs}` : ""}`} /></View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, height: 32, paddingHorizontal: 14, borderRadius: 16, backgroundColor: T.primary }}>
            <Txt v="smallSemi" color="#FFFFFF" style={{ fontSize: 13.5 }}>{cta}</Txt>
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
