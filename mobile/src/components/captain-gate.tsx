/** Captain-only screens (new team / match / challenge, find players). Player accounts see this instead. */
import { router } from "expo-router";
import { Shield } from "lucide-react-native";
import type { ReactNode } from "react";
import { View } from "react-native";

import { Button, Txt } from "@/components/ui";
import { useIsCaptain } from "@/lib/roles";
import { R, SP, T } from "@/theme";

export function CaptainOnly() {
  return (
    <View testID="captain-only" style={{ flex: 1, backgroundColor: T.bg, padding: SP.page, justifyContent: "center", gap: 14 }}>
      <View style={{ alignItems: "center", gap: 12, padding: 22, borderRadius: R.card, borderWidth: 1, borderColor: T.line, backgroundColor: T.surface }}>
        <Shield size={34} color={T.primary} strokeWidth={1.5} />
        <Txt v="h2" style={{ textAlign: "center" }}>Captain tools</Txt>
        <Txt v="body" color={T.muted} style={{ textAlign: "center" }}>
          {"This account is set up as a player. Teams, matches and challenges are run by captains; you join through their invites and links."}
        </Txt>
        <Button title="Go to Home" onPress={() => router.replace("/")} style={{ alignSelf: "stretch" }} />
      </View>
    </View>
  );
}

export function CaptainGate({ children }: { children: ReactNode }) {
  return useIsCaptain() ? <>{children}</> : <CaptainOnly />;
}
