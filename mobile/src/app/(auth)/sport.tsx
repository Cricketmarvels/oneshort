/** Choose Your Sport (starter v2): emoji, name, descriptor, ✓/○; persisted locally and attached to the account after login. */
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ChoiceRow, H } from "@/components/starter";
import { SportIcon } from "@/components/sports";
import { Button, Txt } from "@/components/ui";
import { useBetaSport } from "@/lib/beta";
import { SPORT_ORDER, SPORTS, type SportId, useSport } from "@/lib/sports";
import { SP, T } from "@/theme";


export default function SelectSport() {
  const insets = useSafeAreaInsets();
  const { sport, choose } = useSport();
  const signupNext = useLocalSearchParams<{ next?: string }>().next === "signup"; // from Get Started: new people sign up
  const beta = useBetaSport(); // single-sport beta: only that sport is offered
  const [picked, setPicked] = useState<SportId>(sport ?? "cricket");
  useEffect(() => { if (beta) setPicked(beta); }, [beta]);
  const order = beta ? [beta] : SPORT_ORDER;
  return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
      <ScrollView contentContainerStyle={{ padding: SP.page, paddingTop: insets.top + SP.page + 8, paddingBottom: 140, gap: 12 }}>
        <View style={{ marginBottom: 10 }}><H title={beta ? `${SPORTS[beta].name} beta` : "Choose Your Sport"} sub={beta ? "This release is cricket only. More sports are coming." : "Pick a sport to get started. You can switch any time."} /></View>
        <View accessibilityRole="radiogroup" style={{ gap: 12 }}>
          {order.map((s) => (
            <ChoiceRow key={s} testID={`sport-${s}`} selected={picked === s} onPress={() => setPicked(s)} title={SPORTS[s].name} body={SPORTS[s].tagline}
              lead={<SportIcon sport={s} size={48} active={picked === s} />} />
          ))}
        </View>
        {beta ? null : <Txt v="small" color={T.muted} style={{ marginTop: 6 }}>More sports coming soon.</Txt>}
      </ScrollView>
      <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: SP.page, paddingBottom: Math.max(insets.bottom, 20), backgroundColor: T.bg }}>
        <Button testID="sport-continue" title="Continue" size="lg" onPress={() => { choose(picked); router.push(signupNext ? "/signup" : "/login"); }} />
      </View>
    </View>
  );
}
