/**
 * Bottom navigation (starter v2 BottomNav): Home · Discover · Create (large aqua) · Community · Profile.
 * Badminton/Pickleball: Home · Players · Courts · Requests · Profile. My Games and Leaderboard stay as routes
 * (hidden from the bar) and are reached from Profile, Discover and Home.
 */
import { Tabs } from "expo-router";
import { type ColorValue, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PlayRIcon, type PlayRIconName } from "@/components/icons";
import { isRacket, useSport } from "@/lib/sports";
import { FW, shadow, T } from "@/theme";

/** Phosphor 24px; active tab = fill weight + teal, inactive = regular + ink. */
const icon = (name: PlayRIconName) => ({ focused }: { color: ColorValue; focused: boolean }) => (
  <PlayRIcon name={name} size={24} color={focused ? T.primary : T.ink} weight={focused ? "fill" : "regular"} />
);
/** Raised circular teal "+" (Create). */
const createIcon = () => (
  <View style={{ marginTop: -26, width: 60, height: 60, borderRadius: 30, backgroundColor: T.primary, alignItems: "center", justifyContent: "center", borderWidth: 4, borderColor: T.surface, ...shadow(3) }}>
    <PlayRIcon name="plus" size={28} color="#FFFFFF" weight="bold" />
  </View>
);
const label = (text: string) => ({ focused }: { focused: boolean; color: ColorValue }) => (
  <Text numberOfLines={1} style={{ ...(focused ? FW.bold : FW.medium), fontSize: 11, color: focused ? T.primary : T.ink, marginTop: 3 }}>{text}</Text>
);

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const racket = isRacket(useSport((s) => s.sport));
  const cricketOnly = racket ? { href: null } : {};
  const racketOnly = racket ? {} : { href: null };
  // Route stays reachable (href:null would make it unroutable); only the bar button is hidden.
  const hidden = { tabBarItemStyle: { display: "none" as const }, tabBarButton: () => null };
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: T.surface, borderTopWidth: 1, borderTopColor: T.line, height: 66 + Math.max(insets.bottom, 12), paddingTop: 10, overflow: "visible", paddingBottom: Math.max(insets.bottom, 12), elevation: 0, shadowOpacity: 0 },
        sceneStyle: { backgroundColor: T.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: icon("home"), tabBarLabel: label("Home") }} />
      <Tabs.Screen name="discover" options={{ title: "Discover", tabBarIcon: icon("discover"), tabBarLabel: label("Discover"), ...cricketOnly }} />
      <Tabs.Screen name="players" options={{ title: "Players", tabBarIcon: icon("search"), tabBarLabel: label("Players"), ...racketOnly }} />
      <Tabs.Screen name="create" options={{ title: "Create", tabBarIcon: createIcon, tabBarLabel: () => null, tabBarAccessibilityLabel: "Create", ...cricketOnly }} />
      <Tabs.Screen name="courts" options={{ title: "Courts", tabBarIcon: icon("pin"), tabBarLabel: label("Courts"), ...racketOnly }} />
      <Tabs.Screen name="community" options={{ title: "Community", tabBarIcon: icon("community"), tabBarLabel: label("Community"), ...cricketOnly }} />
      <Tabs.Screen name="requests" options={{ title: "Requests", tabBarIcon: icon("chat"), tabBarLabel: label("Requests"), ...racketOnly }} />
      <Tabs.Screen name="me" options={{ title: "Profile", tabBarIcon: icon("profile"), tabBarLabel: label("Profile") }} />
      <Tabs.Screen name="games" options={{ title: "My Games", ...hidden }} />
      <Tabs.Screen name="leaderboard" options={{ title: "Leaderboard", ...hidden }} />
    </Tabs>
  );
}
