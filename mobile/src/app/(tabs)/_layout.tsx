/**
 * Bottom navigation (starter v2 BottomNav): Home · Discover · Create (large aqua) · Community · Profile.
 * Badminton/Pickleball: Home · Players · Courts · Requests · Profile. My Games and Leaderboard stay as routes
 * (hidden from the bar) and are reached from Profile, Discover and Home.
 */
import { Tabs } from "expo-router";
import { Compass, Home, Inbox, LandPlot, Plus, User, UserRoundSearch, Users } from "lucide-react-native";
import type { ComponentType } from "react";
import { type ColorValue, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { isRacket, useSport } from "@/lib/sports";
import { FW, shadow, T } from "@/theme";

type IconT = ComponentType<{ size?: number; color?: string; strokeWidth?: number; fill?: string }>;
const icon = (Icon: IconT, fillable = false) => ({ focused }: { color: ColorValue; focused: boolean }) => (
  <Icon size={23} color={focused ? T.primary : T.ink} fill={focused && fillable ? T.primary : "transparent"} strokeWidth={focused ? 2.2 : 1.7} />
);
/** Raised circular teal "+" (Create). */
const createIcon = () => (
  <View style={{ marginTop: -26, width: 60, height: 60, borderRadius: 30, backgroundColor: T.primary, alignItems: "center", justifyContent: "center", borderWidth: 4, borderColor: T.surface, ...shadow(3) }}>
    <Plus size={30} color="#FFFFFF" strokeWidth={2.6} />
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
      <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: icon(Home, true), tabBarLabel: label("Home") }} />
      <Tabs.Screen name="discover" options={{ title: "Discover", tabBarIcon: icon(Compass), tabBarLabel: label("Discover"), ...cricketOnly }} />
      <Tabs.Screen name="players" options={{ title: "Players", tabBarIcon: icon(UserRoundSearch), tabBarLabel: label("Players"), ...racketOnly }} />
      <Tabs.Screen name="create" options={{ title: "Create", tabBarIcon: createIcon, tabBarLabel: () => null, tabBarAccessibilityLabel: "Create", ...cricketOnly }} />
      <Tabs.Screen name="courts" options={{ title: "Courts", tabBarIcon: icon(LandPlot), tabBarLabel: label("Courts"), ...racketOnly }} />
      <Tabs.Screen name="community" options={{ title: "Community", tabBarIcon: icon(Users), tabBarLabel: label("Community"), ...cricketOnly }} />
      <Tabs.Screen name="requests" options={{ title: "Requests", tabBarIcon: icon(Inbox), tabBarLabel: label("Requests"), ...racketOnly }} />
      <Tabs.Screen name="me" options={{ title: "Profile", tabBarIcon: icon(User), tabBarLabel: label("Profile") }} />
      <Tabs.Screen name="games" options={{ title: "My Games", ...hidden }} />
      <Tabs.Screen name="leaderboard" options={{ title: "Leaderboard", ...hidden }} />
    </Tabs>
  );
}
