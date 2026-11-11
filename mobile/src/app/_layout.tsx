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

import { Button, Loading, Txt } from "@/components/ui";
import { api } from "@/lib/api";
import { AuthProvider, useAuth } from "@/lib/auth";
import { useBetaSport } from "@/lib/beta";
import { useSport } from "@/lib/sports";
import { registerForPush } from "@/lib/device";
import { applyTheme, FW, scheme, type Scheme, T } from "@/theme";
import { useAppearance } from "@/lib/appearance";
import { usePendingJoin } from "@/lib/joinlink";
import { useInAppAlerts, usePushNavigation } from "@/lib/push";
import { installWebAlert, WebAlertHost } from "@/lib/web-alert";

installWebAlert(); // browsers: Alert.alert is a no-op in react-native-web

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
  const { user, ready, reload, offline, retry } = useAuth();
  const seg = useSegments();
  const sport = useSport();
  const betaSport = useBetaSport();
  useEffect(() => { if (betaSport && sport.ready && sport.sport !== betaSport) sport.choose(betaSport); }, [betaSport, sport.ready, sport.sport]); // eslint-disable-line react-hooks/exhaustive-deps
  const pending = usePendingJoin();
  useEffect(() => { void sport.load(); void pending.load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (user) void registerForPush(); }, [user]);
  usePushNavigation(!!user && user.agreement.satisfied); // push taps navigate once signed in (parked until then)
  useInAppAlerts(!!user && user.agreement.satisfied); // sound for new messages while the app is open and push isn't set up
  // keep the device selection and the profile in step: a fresh pre-login choice wins; otherwise adopt the profile's
  useEffect(() => {
    if (!user || !sport.ready) return;
    if (betaSport && sport.sport !== betaSport) return; // the beta effect above settles the store first
    if (!sport.sport) sport.choose(user.preferred_sport);
    else if (sport.sport !== user.preferred_sport) void api("/users/me", { method: "PUT", body: { preferred_sport: sport.sport } }).then(() => reload()).catch(() => undefined);
  }, [user?.id, sport.ready, sport.sport]); // eslint-disable-line react-hooks/exhaustive-deps
  if (offline) return <OfflineStart onRetry={retry} />;
  if (!ready || !sport.ready || !pending.ready) return <Loading />;
  const inAuth = seg[0] === "(auth)";
  const onJoin = (seg as string[])[0] === "join"; // captain invite links are reachable before login
  const onLegal = (seg as string[])[0] === "legal"; // Terms and Privacy Notice are public, and readable mid-consent
  const onSport = inAuth && ["sport", "welcome", "server"].includes((seg as string[])[1] ?? ""); // server = beta server picker
  // An invited newcomer goes straight from the invite to sign-up; the sport is then taken from their profile.
  if (!user && !sport.sport && !onSport && !onJoin && !onLegal && !(pending.code && inAuth)) return <Redirect href="/welcome" />;
  const onSim = (seg as string[])[0] === "whatsapp-sim"; // WhatsApp simulator (test mode) is reachable before login
  if (!user && !inAuth && !onSim && !onJoin && !onLegal) return <Redirect href="/login" />;
  if (user && inAuth) return <Redirect href="/" />;
  if (user && !user.agreement.satisfied && seg[0] !== "agreement" && !onLegal) return <Redirect href="/agreement" />;
  if (user && user.agreement.satisfied && seg[0] === "agreement") return <Redirect href={pending.code ? { pathname: "/join/[code]", params: { code: pending.code } } : "/"} />;
  // Sign-up isn't finished until the server says so: a verified number without registration_completed_at
  // reopens registration (also after the app was closed mid-way). Accounts from before this flow are backfilled.
  const onRegister = (seg as string[])[0] === "register";
  const mustRegister = !!user && user.agreement.satisfied && (user.phone_verified || user.email_verified) && !user.registration_completed_at;
  if (mustRegister && !onRegister && !onLegal) return <Redirect href="/register" />;
  if (user && !mustRegister && onRegister) return <Redirect href="/" />;
  if (user && user.agreement.satisfied && pending.code && !onJoin) return <Redirect href={{ pathname: "/join/[code]", params: { code: pending.code } }} />;
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
      <Stack.Screen name="join/[code]" options={{ headerShown: false }} />
      <Stack.Screen name="match/players" options={{ title: "Find Players for a Match" }} />
      <Stack.Screen name="onboarding" options={{ headerShown: false }} />
      <Stack.Screen name="register" options={{ headerShown: false, gestureEnabled: false }} />
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
              <WebAlertHost key={`alert-${resolved}`} />
            </AuthProvider>
          </BottomSheetModalProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
      </View>
    </GestureHandlerRootView>
  );
}

/** Opened offline (or the server is down): the saved session is kept and retried instead of signing out. */
function OfflineStart({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={{ flex: 1, backgroundColor: T.bg, alignItems: "center", justifyContent: "center", padding: 32, gap: 14 }}>
      <Txt v="h2" accessibilityRole="header" style={{ textAlign: "center" }}>Can't reach GoFindr</Txt>
      <Txt v="body" color={T.muted} style={{ textAlign: "center" }}>Check your connection. You're still signed in.</Txt>
      <Button title="Try again" size="lg" onPress={onRetry} style={{ alignSelf: "stretch" }} />
    </View>
  );
}
