/**
 * GoFindr starter-v2 building blocks (source: GoFindr_Claude_Code_Starter_v2 src/ui.tsx + app/home.tsx):
 * heavy page heading with sub line, photo hero with a dark teal overlay, 2-column action tiles,
 * link cards ("Title →"), stat strip, simple screen container. Photos are bundled assets (see assets/images/CREDITS.md).
 */
import { router } from "expo-router";
import type { ComponentType, ReactNode } from "react";
import { ImageBackground, Pressable, RefreshControl, ScrollView, View, type ViewStyle } from "react-native";
import { PlayRIcon , type PlayRIconName } from "@/components/icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PHOTO } from "@/components/identity";
import { Txt } from "@/components/ui";
import { SP, T } from "@/theme";

export type IconT = ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

/** Starter `H`: 29/800 title, -0.8 tracking, 13px muted sub line, 22px bottom gap. */
export function H({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
      <View style={{ flex: 1, gap: 5 }}>
        <Txt v="hero" accessibilityRole="header">{title}</Txt>
        {sub ? <Txt v="small" color={T.muted}>{sub}</Txt> : null}
      </View>
      {right}
    </View>
  );
}

/** Starter `Screen`: canvas, 20px padding, safe-area top (when no native header), extra bottom room. */
export function StarterScreen({ children, safeTop, refreshing, onRefresh, gap = 18 }: { children: ReactNode; safeTop?: boolean; refreshing?: boolean; onRefresh?: () => void; gap?: number }) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: T.bg }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
      contentContainerStyle={{ padding: SP.page, paddingTop: (safeTop ? insets.top : 0) + SP.page, paddingBottom: 60, gap }}
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={T.primary} /> : undefined}>
      {children}
    </ScrollView>
  );
}

/** Photo hero (home "Game on this weekend?" / "Captain Hub"): 148 high, radius 22, dark-teal overlay band. */
export function PhotoBanner({ title, body, photo = "stadium", height = 148, onPress, children }: {
  title: string; body?: string; photo?: keyof typeof PHOTO; height?: number; onPress?: () => void; children?: ReactNode;
}) {
  const inner = (
    <ImageBackground source={PHOTO[photo]} resizeMode="cover" imageStyle={{ borderRadius: 22 }} style={{ height, justifyContent: "flex-end", borderRadius: 22, overflow: "hidden", backgroundColor: T.heroInk }} accessibilityIgnoresInvertColors>
      <View style={{ padding: 17, backgroundColor: "rgba(0,52,48,0.78)", gap: 5 }}>
        <Txt v="h1" color="#FFFFFF" style={{ fontSize: 21, lineHeight: 26, fontFamily: "Inter_800ExtraBold" }}>{title}</Txt>
        {body ? <Txt v="small" color="#E3F8F2">{body}</Txt> : null}
        {children}
      </View>
    </ImageBackground>
  );
  return onPress ? <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${body ?? ""}`} onPress={onPress}>{inner}</Pressable> : inner;
}

/** Starter home tile: white, radius 18, padding 18, teal icon top-left, bold label below, min height 106. */
export function Tile({ icon: Icon, label, hint, onPress }: { icon: IconT; label: string; hint?: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={hint ? `${label}. ${hint}` : label} onPress={onPress}
      style={({ pressed }) => ({ width: "48%", minHeight: 106, padding: 18, borderRadius: 18, borderWidth: 1, borderColor: T.line, backgroundColor: pressed ? T.surface2 : T.surface })}>
      <Icon size={25} color={T.primary} strokeWidth={2} />
      <Txt v="h3" style={{ marginTop: 13, fontSize: 15 }}>{label}</Txt>
      {hint ? <Txt v="small" color={T.muted} numberOfLines={1} style={{ fontSize: 12, marginTop: 2 }}>{hint}</Txt> : null}
    </Pressable>
  );
}

export function TileGrid({ tiles }: { tiles: Parameters<typeof Tile>[0][] }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 12 }}>{tiles.map((t) => <Tile key={t.label} {...t} />)}</View>;
}

/** Section header row: 18/800 title + teal "View all". */
export function SectionRow({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 26 }}>
      <Txt v="h2">{title}</Txt>
      {action && onAction ? <Pressable accessibilityRole="button" hitSlop={10} onPress={onAction}><Txt v="smallSemi" color={T.primary}>{action}</Txt></Pressable> : null}
    </View>
  );
}

/** Starter link card: "Title →" (Explore, Profile lists). Optional icon + sub line. */
export function LinkCard({ title, sub, icon, onPress, badge, style }: { title: string; sub?: string; icon?: PlayRIconName; onPress: () => void; badge?: ReactNode; style?: ViewStyle }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={sub ? `${title}. ${sub}` : title} onPress={onPress}
      style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: 14, padding: 16, minHeight: 60, borderRadius: 20, borderWidth: 1, borderColor: T.line, backgroundColor: pressed ? T.surface2 : T.surface }, style]}>
      {icon ? <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: T.primarySoft, alignItems: "center", justifyContent: "center" }}><PlayRIcon name={icon} size={20} /></View> : null}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Txt v="h3" numberOfLines={1}>{title}</Txt>
        {sub ? <Txt v="small" color={T.muted} numberOfLines={2}>{sub}</Txt> : null}
      </View>
      {badge}
      <PlayRIcon name="chevronRight" size={20} weight="bold" />
    </Pressable>
  );
}

/** Stat strip card (profile "4.8 Rating · 42 Matches · 38 Wkts") — values must be real; "—" when unknown. */
export function StatStrip({ items }: { items: { value: string; label: string }[] }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", padding: 16, borderRadius: 20, borderWidth: 1, borderColor: T.line, backgroundColor: T.surface }}>
      {items.map((it) => (
        <View key={it.label} style={{ flex: 1, alignItems: "center", gap: 2 }}>
          <Txt v="stat" style={{ fontSize: 19 }}>{it.value}</Txt>
          <Txt v="small" color={T.muted} style={{ fontSize: 12, textAlign: "center" }}>{it.label}</Txt>
        </View>
      ))}
    </View>
  );
}

/** Choice card (sport / role): emoji or icon, title, description, ✓ / ○ on the right; selected = mint + teal/aqua border. */
export function ChoiceRow({ title, body, selected, onPress, lead }: { title: string; body: string; selected: boolean; onPress: () => void; lead: ReactNode }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected, checked: selected }} aria-checked={selected} accessibilityLabel={`${title}. ${body}`} onPress={onPress}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 15, padding: 16, borderRadius: 20, borderWidth: selected ? 2 : 1, borderColor: selected ? T.aqua : T.line, backgroundColor: selected ? T.primarySoft : pressed ? T.surface2 : T.surface })}>
      {lead}
      <View style={{ flex: 1, gap: 3 }}>
        <Txt v="h3" style={{ fontSize: 18 }}>{title}</Txt>
        <Txt v="small" color={T.muted} style={{ fontSize: 14 }}>{body}</Txt>
      </View>
      <View style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: T.primary, backgroundColor: selected ? T.primary : "transparent", alignItems: "center", justifyContent: "center" }}>
        {selected ? <Txt v="smallSemi" color="#FFFFFF">✓</Txt> : null}
      </View>
    </Pressable>
  );
}

/** Small teal "label →" link. */
export function ArrowLink({ label, onPress }: { label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} hitSlop={8}><Txt v="smallSemi" color={T.primary}>{label} →</Txt></Pressable>;
}

export const goto = (path: Parameters<typeof router.push>[0]) => () => router.push(path);
