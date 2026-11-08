/**
 * Identity & flow pieces from the approved screen set: shield team crest, stat tiles,
 * photo hero, step indicator and the centred-title sub-page header actions.
 */
import { Check, Share2 } from "lucide-react-native";
import type { ReactNode } from "react";
import { Image, type ImageSourcePropType, Pressable, Share, View, type ViewStyle } from "react-native";
import Svg, { Defs, LinearGradient, Path, Stop, Text as SvgText } from "react-native-svg";

import { kitFor } from "@/components/art";
import { Txt } from "@/components/ui";
import { F, R, shadow, SP, T } from "@/theme";

export const PHOTO: Record<"ground" | "stadium" | "night" | "crowd" | "bowler", ImageSourcePropType> = {
  ground: require("../../assets/images/club-ground.jpg"),
  stadium: require("../../assets/images/stadium-crowd.jpg"),
  night: require("../../assets/images/stadium-night.jpg"),
  crowd: require("../../assets/images/street-india.jpg"),
  bowler: require("../../assets/images/bowler.jpg"),
};

function lines(name: string): string[] {
  const w = name.toUpperCase().split(/\s+/).filter(Boolean);
  if (w.length <= 1) return w;
  if (w.length === 2) return w;
  // "SECTOR 18 KINGS" -> ["SECTOR 18", "KINGS"]; keep a number with its neighbour
  const cut = Math.ceil(w.length / 2);
  return [w.slice(0, cut).join(" "), w.slice(cut).join(" ")];
}

/** Shield crest: team colour shield, gold rim and crown, team name in two lines. Original artwork. */
export function ShieldCrest({ name, size = 96 }: { name: string; size?: number }) {
  const [strong] = kitFor(name);
  const ls = lines(name).slice(0, 2);
  const longest = Math.max(...ls.map((l) => l.length), 4);
  const fs = Math.min(17, 92 / longest);
  const id = `g${[...name].reduce((a, c) => a + c.charCodeAt(0), 0)}`;
  return (
    <View accessibilityLabel={`${name} crest`} style={{ width: size, height: size * 1.16 }}>
      <Svg width={size} height={size * 1.16} viewBox="0 0 100 116">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={strong} stopOpacity="1" />
            <Stop offset="1" stopColor={T.ink} stopOpacity="1" />
          </LinearGradient>
        </Defs>
        <Path d="M50 6 L90 19 V58 C90 85 72 102 50 111 C28 102 10 85 10 58 V19 Z" fill="#1C2B2A" />
        <Path d="M50 11 L85 22.5 V58 C85 81.5 69 97 50 105 C31 97 15 81.5 15 58 V22.5 Z" fill="#E2B93B" />
        <Path d="M50 15 L81 25.5 V58 C81 79 67 93 50 100.5 C33 93 19 79 19 58 V25.5 Z" fill={`url(#${id})`} />
        <Path d="M36 30 L40 21 L45 27 L50 18 L55 27 L60 21 L64 30 Z" fill="#E2B93B" />
        {ls.map((l, i) => (
          <SvgText key={i} x="50" y={(ls.length === 1 ? 64 : 56) + i * (fs + 3)} fill="#FFFFFF" fontSize={fs} fontFamily={F.display} fontWeight="800" textAnchor="middle">{l}</SvgText>
        ))}
        <Path d="M50 80 m-7 0 a7 7 0 1 0 14 0 a7 7 0 1 0 -14 0" fill={T.limeAccent} />
        <Path d="M44.5 77.5 Q50 80 55.5 77.5 M44.5 82.5 Q50 80 55.5 82.5" stroke="#5B6B1F" strokeWidth="1" fill="none" />
      </Svg>
    </View>
  );
}

/** Stat tile: big number + label; `tone="tint"` gives the soft highlighted variant. */
export function StatTile({ value, label, extra, tone, style }: { value: ReactNode; label: string; extra?: ReactNode; tone?: "tint"; style?: ViewStyle }) {
  return (
    <View style={[{ flex: 1, alignItems: "center", gap: 2, paddingVertical: 14, paddingHorizontal: 8, borderRadius: R.lg, backgroundColor: tone ? T.tint : T.surface, borderWidth: 1, borderColor: tone ? T.tint : T.line }, tone ? null : shadow(1), style]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Txt v="metric" style={{ fontSize: 26, lineHeight: 31 }}>{value}</Txt>
        {extra}
      </View>
      <Txt v="small" color={T.muted}>{label}</Txt>
    </View>
  );
}

/** Photo hero with a soft teal-ink scrim for legible text. */
export function PhotoHero({ photo, height = 200, children, style, scrim = 0.52 }: { photo: keyof typeof PHOTO; height?: number; children?: ReactNode; style?: ViewStyle; scrim?: number }) {
  return (
    <View style={[{ height, borderRadius: R.card, overflow: "hidden", backgroundColor: T.ink }, style]}>
      <Image source={PHOTO[photo]} resizeMode="cover" style={{ position: "absolute", width: "100%", height: "100%" }} accessibilityIgnoresInvertColors />
      <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: `rgba(12,38,36,${scrim})` }} />
      {children}
    </View>
  );
}

/** Numbered step indicator: done = teal tick, current = filled teal, upcoming = outlined. */
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start" }} accessibilityLabel={`Step ${current + 1} of ${steps.length}: ${steps[current]}`}>
      {steps.map((s, i) => {
        const done = i < current, on = i === current;
        return (
          <View key={s} style={{ flex: 1, alignItems: "center", gap: 6 }}>
            <View style={{ flexDirection: "row", alignItems: "center", width: "100%" }}>
              <View style={{ flex: 1, height: 2, backgroundColor: i === 0 ? "transparent" : i <= current ? T.primary : T.line }} />
              <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: done || on ? T.primary : T.surface, borderWidth: done || on ? 0 : 1.5, borderColor: T.line }}>
                {done ? <Check size={16} color={T.surface} strokeWidth={3} /> : <Txt v="smallSemi" color={on ? T.surface : T.muted}>{i + 1}</Txt>}
              </View>
              <View style={{ flex: 1, height: 2, backgroundColor: i === steps.length - 1 ? "transparent" : i < current ? T.primary : T.line }} />
            </View>
            <Txt v={on ? "smallSemi" : "small"} color={on ? T.ink : T.muted} style={{ fontSize: 12.5 }}>{s}</Txt>
          </View>
        );
      })}
    </View>
  );
}

/** Header-right share button for profile-type screens (uses the OS share sheet). */
export function ShareButton({ message }: { message: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Share" hitSlop={10} onPress={() => { Share.share({ message }).catch(() => undefined); }}
      style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}>
      <Share2 size={20} color={T.ink} strokeWidth={1.9} />
    </Pressable>
  );
}

/** Small section header row used inside the new screens: title + optional "See all ›". */
export function RowHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: SP.sm }}>
      <Txt v="h2" accessibilityRole="header">{title}</Txt>
      {action && onAction ? <Pressable accessibilityRole="button" onPress={onAction} hitSlop={10}><Txt v="smallSemi" color={T.primaryDark}>{action} ›</Txt></Pressable> : null}
    </View>
  );
}
