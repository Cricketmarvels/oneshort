/** "Continue with Google": shown only when the server has Google configured AND this build has the native module. */
import type { S } from "@cm/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { Txt } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { googleAvailable, googleIdToken } from "@/lib/google";
import { T } from "@/theme";

function GoogleG({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.5l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <Path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.6z" />
      <Path fill="#FBBC05" d="M10.5 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.5 0 20.1 0 24s.9 7.5 2.6 10.8l7.9-6.1z" />
      <Path fill="#34A853" d="M24 48c6.3 0 11.7-2.1 15.5-5.7l-7.6-5.9c-2.1 1.4-4.8 2.3-7.9 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </Svg>
  );
}

export function GoogleButton({ onError, label = "Continue with Google" }: { onError?: (text: string) => void; label?: string }) {
  const { signIn } = useAuth();
  const [busy, setBusy] = useState(false);
  const opts = useQuery({ queryKey: ["auth-options"], queryFn: () => api<S<"AuthOptionsOut">>("/auth/options"), staleTime: 60_000 });
  if (!opts.data?.google || !googleAvailable()) return null;
  const go = async () => {
    setBusy(true);
    try {
      const r = await googleIdToken();
      if ("cancelled" in r) return;
      if ("error" in r) return onError?.(r.error);
      const t = await api<S<"TokenOut">>("/auth/google", { method: "POST", body: { id_token: r.idToken } });
      await signIn(t.access_token, t.refresh_token, t.user); // the root gate opens complete-profile if needed
    } catch (e) { onError?.(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <Pressable testID="google-signin" accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ busy }} disabled={busy} onPress={() => void go()}
      style={({ pressed }) => ({ height: 52, borderRadius: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderWidth: 1, borderColor: T.line, backgroundColor: pressed ? T.surface2 : T.surface })}>
      <View style={{ width: 22, height: 22, alignItems: "center", justifyContent: "center" }}><GoogleG /></View>
      <Txt v="smallSemi" style={{ fontSize: 15 }}>{busy ? "Opening Google…" : label}</Txt>
    </Pressable>
  );
}
