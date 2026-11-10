/**
 * Identity pieces (aqua/teal system): player avatars, team crests in the team's colour,
 * restrained team-colour banners, a versus card and the GoFindr mark + wordmark.
 */
import type { ReactNode } from "react";
import { Pressable, Text, View, type ViewStyle } from "react-native";

import { Avatar, Txt } from "@/components/ui";
import { ART, FW, R, shadow, SP, T } from "@/theme";

export type PhotoKey = "stadium" | "crowd" | "bowler" | "ground" | "street";

/** Plain container (no image, no gradient). */
export function PhotoBlock({ children, style, height }: { photo?: PhotoKey; children?: ReactNode; style?: ViewStyle; height?: number; strength?: number; position?: "top" | "center" | "bottom" }) {
  return <View style={[{ overflow: "hidden" }, style, height ? { minHeight: height } : null]}>{children}</View>;
}

const KITS = ART.kits;
export const kitFor = (seed: string) => KITS[[...seed].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % KITS.length]!;

/** Player avatar: real photo when uploaded, otherwise initials on tint. */
export function PlayerArt({ name, uri, size = 40 }: { name: string; uri?: string | null; size?: number; ring?: string; number?: number | string }) {
  return <Avatar name={name} uri={uri} size={size} />;
}

export function initialsOf(name: string): string {
  const words = name.split(" ").filter(Boolean);
  // "Sector 18 Kings" -> "18K": sector numbers are what tells Noida teams apart
  return (/^sector$/i.test(words[0] ?? "") && /^\d+$/.test(words[1] ?? "")
    ? `${words[1]}${words[2]?.[0] ?? ""}`
    : words.filter((w) => /[A-Za-z]/.test(w[0] ?? "")).map((w) => w[0]).slice(0, 2).join("")).toUpperCase();
}

/** TeamCrest: rounded square in the team's soft colour with initials in the team colour. */
export function TeamCrest({ name, size = 40 }: { name: string; size?: number }) {
  const [strong, soft] = kitFor(name);
  const s = Math.max(28, Math.round(size));
  const initials = initialsOf(name);
  return (
    <View accessibilityLabel={`${name} badge`} style={{ width: s, height: s, borderRadius: Math.round(s * 0.3), backgroundColor: soft, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ ...FW.initials, fontSize: Math.max(11, s * (initials.length > 2 ? 0.27 : 0.33)), color: strong }}>{initials}</Text>
    </View>
  );
}

/** Restrained team-colour banner (team profile, community cover): soft kit colour with a thin strong stripe. */
export function TeamBanner({ name, height = 88, children }: { name: string; height?: number; children?: ReactNode }) {
  const [strong, soft] = kitFor(name);
  return (
    <View style={{ height, borderRadius: R.card, backgroundColor: soft, overflow: "hidden", justifyContent: "flex-end", padding: SP.md }}>
      <View style={{ position: "absolute", left: 0, right: 0, top: 0, height: 6, backgroundColor: strong, opacity: 0.85 }} />
      <View style={{ position: "absolute", right: -30, top: -30, width: 140, height: 140, borderRadius: 70, backgroundColor: strong, opacity: 0.08 }} />
      {children}
    </View>
  );
}

/** Quiet versus card: two teams, a small "vs", optional lines above/below and an action. */
export function VersusCard({ left, right, top, bottom, cta, onPress }: {
  left: { name: string; sub?: string }; right: { name: string; sub?: string } | null; top?: ReactNode; bottom?: ReactNode; cta?: ReactNode; onPress?: () => void; photo?: PhotoKey;
}) {
  const body = (
    <View style={{ backgroundColor: T.surface, borderRadius: R.card, borderWidth: 1, borderColor: T.line, padding: SP.lg, gap: SP.lg, ...shadow(1) }}>
      {top}
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Side t={left} />
        <Txt v="h3" color={T.primaryDark} style={{ width: 40, textAlign: "center" }}>vs</Txt>
        {right ? <Side t={right} /> : (
          <View style={{ flex: 1, alignItems: "center", gap: 8 }}>
            <View style={{ width: 40, height: 40, borderRadius: 12, borderWidth: 1, borderColor: T.line, alignItems: "center", justifyContent: "center" }}><Txt v="h2" color={T.muted}>?</Txt></View>
            <Txt v="small" color={T.muted}>Your next rival</Txt>
          </View>
        )}
      </View>
      {bottom}
      {cta}
    </View>
  );
  return onPress ? <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>{body}</Pressable> : body;
}

function Side({ t }: { t: { name: string; sub?: string } }) {
  return (
    <View style={{ flex: 1, alignItems: "center", gap: 8 }}>
      <TeamCrest name={t.name} size={48} />
      <Txt v="h3" numberOfLines={2} style={{ textAlign: "center", fontSize: 14 }}>{t.name}</Txt>
      {t.sub ? <Txt v="small" color={T.muted} style={{ fontVariant: ["tabular-nums"] }}>{t.sub}</Txt> : null}
    </View>
  );
}

/** GoFindr mark (turquoise rounded tile with a cricket-ball seam "P") + Manrope wordmark. */
export function Wordmark({ size = 20 }: { size?: number; dark?: boolean; tone?: "lime" | "brand" }) {
  const m = Math.round(size * 1.45);
  return (
    <View accessibilityRole="header" accessibilityLabel="GoFindr" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <View style={{ width: m, height: m, borderRadius: m * 0.32, backgroundColor: T.primary, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ ...FW.display, fontSize: m * 0.58, lineHeight: m * 0.72, color: T.surface }}>G</Text>
        <View style={{ position: "absolute", right: m * 0.16, bottom: m * 0.16, width: m * 0.2, height: m * 0.2, borderRadius: m, backgroundColor: T.limeAccent }} />
      </View>
      <Text style={{ ...FW.display, fontSize: size, color: T.ink, letterSpacing: -0.4 }}>Go<Text style={{ color: T.primaryDark }}>Findr</Text></Text>
    </View>
  );
}
