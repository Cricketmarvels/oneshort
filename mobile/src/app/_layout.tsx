import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Redirect, Stack, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold } from "@expo-google-fonts/inter";
import { useFonts } from "expo-font";
import { Platform, useColorScheme, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { Loading } from "@/components/ui";
import { api } from "@/lib/api";
import { AuthProvider, useAuth } from "@/lib/auth";
import { useSport } from "@/lib/sports";
import { registerForPush } from "@/lib/device";
import { applyTheme, FW, scheme, type Scheme, T } from "@/theme";
import { useAppearance } from "@/lib/appearance";

/** Stack header options — built at render time so they follow the current theme. */
const makeHeader = () => ({
  headerTintColor: T.ink,
  headerTitleAlign: "left" as const,
  headerStyle: { backgroundColor: T.bg },
  headerTitleStyle: { ...FW.heading, fontSize: 19, color: T.ink },
  headerShadowVisible: false,
  headerBackTitle: "Back",
  contentStyle: { backgroundColor: T.bg },
});

function Gate() {
  const header = makeHeader();
  const darkHeader = header;
  const { user, ready, reload } = useAuth();
  const seg = useSegments();
  const sport = useSport();
  useEffect(() => { void sport.load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (user) void registerForPush(); }, [user]);
  // keep the device selection and the profile in step: a fresh pre-login choice wins; otherwise adopt the profile's
  useEffect(() => {
    if (!user || !sport.ready) return;
    if (!sport.sport) sport.choose(user.preferred_sport);
    else if (sport.sport !== user.preferred_sport) void api("/users/me", { method: "PUT", body: { preferred_sport: sport.sport } }).then(() => reload()).catch(() => undefined);
  }, [user?.id, sport.ready, sport.sport]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ready || !sport.ready) return <Loading />;
  const inAuth = seg[0] === "(auth)";
  const onSport = inAuth && ["sport", "welcome"].includes((seg as string[])[1] ?? "");
  if (!user && !sport.sport && !onSport) return <Redirect href="/welcome" />;
  const onSim = (seg as string[])[0] === "whatsapp-sim"; // WhatsApp simulator (test mode) is reachable before login
  if (!user && !inAuth && !onSim) return <Redirect href="/login" />;
  if (user && inAuth) return <Redirect href="/" />;
  if (user && !user.agreement.satisfied && seg[0] !== "agreement") return <Redirect href="/agreement" />;
  if (user && user.agreement.satisfied && seg[0] === "agreement") return <Redirect href="/" />;
  return (
    <Stack screenOptions={header}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="agreement" options={{ title: "User Agreement", headerBackVisible: false }} />
      <Stack.Screen name="profile" options={{ title: "Settings", ...darkHeader }} />
      <Stack.Screen name="player/[id]" options={{ title: "", ...darkHeader }} />
      <Stack.Screen name="compare" options={{ title: "Compare players" }} />
      <Stack.Screen name="team/[id]" options={{ title: "", ...darkHeader }} />
      <Stack.Screen name="team/new" options={{ title: "Create a team", presentation: "modal" }} />
      <Stack.Screen name="teams" options={{ title: "My teams" }} />
      <Stack.Screen name="challenge/new" options={{ title: "Challenge a team" }} />
      <Stack.Screen name="challenge/[id]" options={{ title: "Challenge" }} />
      <Stack.Screen name="fixture/[id]" options={{ title: "", ...darkHeader }} />
      <Stack.Screen name="fixture/result" options={{ title: "Submit result" }} />
      <Stack.Screen name="community/[id]" options={{ title: "", ...darkHeader }} />
      <Stack.Screen name="community/new" options={{ title: "Create a community", presentation: "modal" }} />
      <Stack.Screen name="match/[id]" options={{ title: "Match Details" }} />
      <Stack.Screen name="match/new" options={{ title: "Create a Match" }} />
      <Stack.Screen name="availability" options={{ title: "Availability" }} />
      <Stack.Screen name="payments" options={{ title: "Split Fees" }} />
      <Stack.Screen name="fee/index" options={{ title: "Match fee" }} />
      <Stack.Screen name="find/players" options={{ title: "Find Players", headerShown: false }} />
      <Stack.Screen name="find/teams" options={{ title: "Find Teams", headerShown: false }} />
      <Stack.Screen name="grounds" options={{ title: "Book a Ground" }} />
      <Stack.Screen name="quick-match" options={{ title: "Quick Match" }} />
      <Stack.Screen name="match/players" options={{ title: "Find Players for a Match" }} />
      <Stack.Screen name="onboarding" options={{ headerShown: false }} />
      <Stack.Screen name="racket/profile" options={{ title: "Profile" }} />
      <Stack.Screen name="chat/[id]" options={{ title: "Chat" }} />
      <Stack.Screen name="whatsapp-sim" options={{ title: "WhatsApp (test mode)" }} />
      <Stack.Screen name="racket/player/[id]" options={{ title: "Player profile" }} />
      <Stack.Screen name="search" options={{ title: "Search" }} />
      <Stack.Screen name="notifications" options={{ title: "Notifications", headerTitleAlign: "center" }} />
      <Stack.Screen name="about-ratings" options={{ title: "How ratings work", presentation: "modal" }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 20_000, retry: 1 } } }));
  const [fonts] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold });
  const system = useColorScheme();
  const appearance = useAppearance();
  useEffect(() => { void appearance.load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const resolved: Scheme = appearance.pref === "system" ? (system === "dark" ? "dark" : "light") : appearance.pref;
  if (resolved !== scheme) applyTheme(resolved); // swap palette before children read T
  if (!fonts || !appearance.ready) return <View style={{ flex: 1, backgroundColor: T.bg }} />;
  return (
    <GestureHandlerRootView style={Platform.OS === "web" ? { flex: 1, backgroundColor: T.canvasOuter, alignItems: "center" } : { flex: 1 }}>
      <View style={Platform.OS === "web" ? { flex: 1, width: "100%", maxWidth: 480, overflow: "hidden", backgroundColor: T.bg } : { flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={qc}>
          <BottomSheetModalProvider>
            <AuthProvider>
              <StatusBar style={T.statusBar === "light" ? "light" : "dark"} />
              <Gate key={resolved} />
            </AuthProvider>
          </BottomSheetModalProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
      </View>
    </GestureHandlerRootView>
  );
}
