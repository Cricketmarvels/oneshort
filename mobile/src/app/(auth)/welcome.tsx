/** Splash (starter v2): italic GoFindr wordmark, "Play. Connect. Compete.", photo, Get Started → sport selection. */
import { router } from "expo-router";
import { Image, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PHOTO } from "@/components/identity";
import { Button, Txt } from "@/components/ui";
import { API_URL, SERVER_OVERRIDE_ALLOWED } from "@/lib/config";
import { SP, T } from "@/theme";

export default function Welcome() {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: T.bg, paddingHorizontal: SP.page, paddingTop: insets.top + SP.page, paddingBottom: Math.max(insets.bottom, 20) + 4 }}>
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <Txt accessibilityRole="header" style={{ fontSize: 62, lineHeight: 72, fontFamily: "Inter_800ExtraBold", fontStyle: "italic", color: T.primary, letterSpacing: -1.5 }}>GoFindr</Txt>
        <Txt v="body" style={{ fontSize: 17 }}>Your game, one tap away.</Txt>
        <Image source={PHOTO.stadium} accessibilityLabel="Cricket under floodlights" resizeMode="cover" style={{ height: 290, width: "100%", marginTop: 38, borderRadius: 26 }} />
      </View>
      <Button testID="welcome-start" title="Get Started" size="lg" onPress={() => router.push({ pathname: "/sport", params: { next: "signup" } })} />
      <Txt v="small" color={T.muted} style={{ textAlign: "center", marginTop: 12 }} onPress={() => router.push("/login")}>Already have an account? <Txt v="smallSemi" color={T.primary}>Log in</Txt></Txt>
      {SERVER_OVERRIDE_ALLOWED ? (
        <Txt v="small" color={T.muted} style={{ textAlign: "center", marginTop: 10, fontSize: 12 }} testID="welcome-server" onPress={() => router.push("/server")} accessibilityRole="button" accessibilityLabel="Change server">
          Beta · server {API_URL.replace(/^https?:\/\//, "").replace(/\/api\/v\d+$/, "")}
        </Txt>
      ) : null}
    </View>
  );
}
