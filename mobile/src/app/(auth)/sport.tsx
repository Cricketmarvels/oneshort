/** Choose Your Sport (starter v2): emoji, name, descriptor, ✓/○; persisted locally and attached to the account after login. */
import { router } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ChoiceRow, H } from "@/components/starter";
import { SportIcon } from "@/components/sports";
import { Button, Txt } from "@/components/ui";
import { SPORT_ORDER, SPORTS, type SportId, useSport } from "@/lib/sports";
import { SP, T } from "@/theme";


export default function SelectSport() {
  const insets = useSafeAreaInsets();
  const { sport, choose } = useSport();
  const [picked, setPicked] = useState<SportId>(sport ?? "cricket");
  return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
      <ScrollView contentContainerStyle={{ padding: SP.page, paddingTop: insets.top + SP.page + 8, paddingBottom: 140, gap: 12 }}>
        <View style={{ marginBottom: 10 }}><H title="Choose Your Sport" sub="Pick a sport to get started. You can switch any time." /></View>
        <View accessibilityRole="radiogroup" style={{ gap: 12 }}>
          {SPORT_ORDER.map((s) => (
            <ChoiceRow key={s} selected={picked === s} onPress={() => setPicked(s)} title={SPORTS[s].name} body={SPORTS[s].tagline}
              lead={<SportIcon sport={s} size={48} active={picked === s} />} />
          ))}
        </View>
        <Txt v="small" color={T.muted} style={{ marginTop: 6 }}>More sports coming soon.</Txt>
      </ScrollView>
      <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: SP.page, paddingBottom: Math.max(insets.bottom, 20), backgroundColor: T.bg }}>
        <Button title="Continue" size="lg" onPress={() => { choose(picked); router.push("/login"); }} />
      </View>
    </View>
  );
}
