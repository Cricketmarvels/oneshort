/** Welcome: the eleventh dot lights up. "Never one short again." → Get started (sport selection) / Log in. */
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Animated, Easing, Image, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { OneShortMark, Wordmark } from "@/components/brand";
import { PHOTO } from "@/components/identity";
import { Button, Txt } from "@/components/ui";
import { API_URL, SERVER_OVERRIDE_ALLOWED } from "@/lib/config";
import { R, SP, T } from "@/theme";

const INK = "#0A2A20"; // the hero stays deep green in both themes
const ON_INK = "#FFFFFF";
const ON_INK_MUTED = "rgba(255,255,255,0.72)";

export default function Welcome() {
  const insets = useSafeAreaInsets();
  const [lit, setLit] = useState(0);
  const [pulse] = useState(() => new Animated.Value(0)); // state, not a ref: nothing reads .current during render

  // Ten dots fill in, then the eleventh lights and breathes.
  useEffect(() => {
    let i = 0;
    const t = setInterval(() => { i += 1; setLit(i); if (i >= 11) clearInterval(t); }, 80);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (lit < 11) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [lit, pulse]);

  return (
    <View style={{ flex: 1, backgroundColor: INK }}>
      <View style={{ flex: 1, paddingHorizontal: SP.page, paddingTop: insets.top + 16, justifyContent: "center", gap: 26 }}>
        <Wordmark size={22} color={ON_INK} muted={ON_INK_MUTED} />
        <Animated.View style={{ alignSelf: "flex-start", transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] }) }] }}>
          <OneShortMark size={128} lit={lit} tile={false} dot="rgba(255,255,255,0.92)" />
        </Animated.View>
        <View style={{ gap: 12 }}>
          <Txt accessibilityRole="header" v="display" color={ON_INK} style={{ fontSize: 40, lineHeight: 44, letterSpacing: -1.2 }}>Never one{"\n"}short again.</Txt>
          <Txt v="body" color={ON_INK_MUTED} style={{ fontSize: 16, lineHeight: 23, maxWidth: 330 }}>Fill your squad, split the fee, find the ground. Cricket, badminton and pickleball, near you.</Txt>
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {["Find players", "Split fees", "Book grounds"].map((t) => (
            <View key={t} style={{ paddingHorizontal: 12, height: 30, borderRadius: 15, borderWidth: 1, borderColor: "rgba(255,255,255,0.22)", justifyContent: "center" }}>
              <Txt v="smallSemi" color={ON_INK} style={{ fontSize: 12.5 }}>{t}</Txt>
            </View>
          ))}
        </View>
      </View>

      <View style={{ backgroundColor: T.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: SP.page, paddingTop: 18, paddingBottom: Math.max(insets.bottom, 20) + 4, gap: 12 }}>
        <Image source={PHOTO.stadium} accessibilityLabel="Cricket under floodlights" resizeMode="cover" style={{ height: 112, width: "100%", borderRadius: R.card }} />
        <Button testID="welcome-start" title="Get started" size="lg" onPress={() => router.push({ pathname: "/sport", params: { next: "signup" } })} />
        <Txt v="small" color={T.muted} style={{ textAlign: "center" }} onPress={() => router.push("/login")}>Already have an account? <Txt v="smallSemi" color={T.primaryDark}>Log in</Txt></Txt>
        {SERVER_OVERRIDE_ALLOWED ? (
          <Txt v="small" color={T.muted} style={{ textAlign: "center", fontSize: 12 }} testID="welcome-server" onPress={() => router.push("/server")} accessibilityRole="button" accessibilityLabel="Change server">
            Beta · server {API_URL.replace(/^https?:\/\//, "").replace(/\/api\/v\d+$/, "")}
          </Txt>
        ) : null}
      </View>
    </View>
  );
}
