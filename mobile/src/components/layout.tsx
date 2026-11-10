/** Tab-root frame (aqua/teal): compact header (mark + wordmark, bell, avatar), screen title, location selector, content. */
import { useQuery } from "@tanstack/react-query";
import { router, useIsFocused } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Bell, ChevronDown, MapPin } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { type PhotoKey, Wordmark } from "@/components/art";
import { SportSwitcher } from "@/components/sports";
import { Avatar, IconButton, Txt } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { isRacket, useSport } from "@/lib/sports";
import { ICON, R, SIZE, SP, T } from "@/theme";

/** Header: GoFindr mark + wordmark, compact sport switcher, bell with unread dot, profile avatar. */
export function TopBar() {
  const { user } = useAuth();
  const unread = useQuery({ queryKey: ["notifications", "unread"], queryFn: () => api<{ meta: { unread: number } }>("/notifications", { query: { page_size: 1 } }), refetchInterval: 60_000 });
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 48 }}>
      <Wordmark size={20} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <SportSwitcher compact />
        <IconButton filled label="Notifications" icon={<Bell size={20} color={T.ink} strokeWidth={ICON.stroke} />} badge={unread.data?.meta.unread} onPress={() => router.push("/notifications")} />
        <Pressable accessibilityRole="button" accessibilityLabel="My profile" onPress={() => router.push("/profile")} hitSlop={4}
          style={{ width: SIZE.touch, height: SIZE.touch, alignItems: "center", justifyContent: "center" }}>
          <Avatar uri={user?.profile_image} name={user?.full_name ?? "Me"} size={40} />
        </Pressable>
      </View>
    </View>
  );
}

/** LocationSelector pill: "Noida (centre) · 10 km" with pin + caret — opens the location/radius sheet. */
export function ContextLine({ text, onPress }: { text: string; onPress?: () => void }) {
  const body = (
    <>
      <MapPin size={14} color={T.primaryDark} strokeWidth={2} />
      <Txt v="smallSemi" color={T.muted} numberOfLines={1} style={{ flexShrink: 1 }}>{text}</Txt>
      {onPress ? <ChevronDown size={14} color={T.muted} strokeWidth={2} /> : null}
    </>
  );
  if (!onPress) return <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>{body}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${text}. Change`} onPress={onPress} hitSlop={8}
      style={({ pressed }) => ({ alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 5, minHeight: 32, paddingHorizontal: 12, borderRadius: R.pill, backgroundColor: pressed ? T.tint : T.surface, borderWidth: 1, borderColor: T.line })}>
      {body}
    </Pressable>
  );
}

/** Tab root page: header, title (+ right action), subtitle/location selector, content with 24px section spacing. */
export function HeroScreen({ hero, children, refreshing, onRefresh, title, subtitle, right, onSubtitle, dense, kicker, backdrop, top }: {
  hero?: ReactNode; children: ReactNode; refreshing?: boolean; onRefresh?: () => void; title?: string; subtitle?: string; right?: ReactNode; photo?: PhotoKey; onSubtitle?: () => void; dense?: boolean; kicker?: string; backdrop?: ReactNode; top?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const racket = isRacket(useSport((x) => x.sport)); // racket tabs keep the sport switcher bar; cricket tabs follow the starter (no logo bar)
  return (
    <ScrollView style={{ flex: 1, backgroundColor: T.bg }} keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingTop: insets.top + (racket ? 6 : SP.page), paddingHorizontal: SP.page, paddingBottom: 40, gap: dense ? 18 : SP.section }}
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={T.primary} /> : undefined}>
      {focused ? <StatusBar style={T.statusBar === "light" ? "light" : "dark"} /> : null}
      {backdrop ? <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, height: 300 }}>{backdrop}</View> : null}
      {racket ? <TopBar /> : null}
      {top}
      {title ? (
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: SP.md }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt v="hero" accessibilityRole="header">{title}</Txt>
              {kicker ? <Txt v="body" color={T.muted}>{kicker}</Txt> : null}
            </View>
            {right}
          </View>
          {subtitle ? <ContextLine text={subtitle} onPress={onSubtitle} /> : null}
        </View>
      ) : null}
      {hero}
      {children}
    </ScrollView>
  );
}

export function HScroll({ children }: { children: ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -SP.page, flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: SP.page, gap: SP.md }}>
      {children}
    </ScrollView>
  );
}

/** Light app: dark status-bar icons everywhere. */
export function PhotoStatusBar() {
  const focused = useIsFocused();
  return focused ? <StatusBar style={T.statusBar === "light" ? "light" : "dark"} /> : null;
}
