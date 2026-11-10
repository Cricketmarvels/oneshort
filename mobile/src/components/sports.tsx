/** Original vector sport marks (no third-party logos) and the sport switcher used in headers. */
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { router } from "expo-router";
import { Check, ChevronDown } from "lucide-react-native";
import { useRef } from "react";
import { Pressable, View } from "react-native";
import Svg, { Circle, G, Line, Path, Rect } from "react-native-svg";

import { FilterBottomSheet } from "@/components/sheet";
import { Row, Txt } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useBetaSport } from "@/lib/beta";
import { SPORT_ORDER, SPORTS, type SportId, useSport } from "@/lib/sports";
import { R, T } from "@/theme";

/** Sport mark inside a soft circle. */
export function SportIcon({ sport, size = 96, active }: { sport: SportId; size?: number; active?: boolean }) {
  const bg = active ? T.primary : T.primarySoft;
  const ink = active ? "#FFFFFF" : T.primaryDark;
  return (
    <View accessibilityLabel={`${SPORTS[sport].name} logo`} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size * 0.62} height={size * 0.62} viewBox="0 0 64 64">
        {sport === "cricket" ? (
          <G>
            <G transform="rotate(-40 30 32)">
              <Rect x="25" y="6" width="11" height="38" rx="5" fill={active ? "#FFFFFF" : "#F3E3C3"} stroke={ink} strokeWidth="2" />
              <Rect x="28" y="44" width="5" height="14" rx="2.5" fill={ink} />
            </G>
            <Circle cx="48" cy="46" r="7" fill={active ? T.limeAccent : "#E05A4F"} />
            <Path d="M43 42 Q48 46 43 50 M53 42 Q48 46 53 50" stroke="#FFFFFF" strokeWidth="1.4" fill="none" />
          </G>
        ) : sport === "badminton" ? (
          <G>
            <Path d="M22 10 L42 10 L37 38 L27 38 Z" fill={active ? "rgba(255,255,255,0.25)" : "#FFFFFF"} stroke={ink} strokeWidth="2" strokeLinejoin="round" />
            <Line x1="27" y1="10" x2="29.5" y2="38" stroke={ink} strokeWidth="1.5" />
            <Line x1="32" y1="10" x2="32" y2="38" stroke={ink} strokeWidth="1.5" />
            <Line x1="37" y1="10" x2="34.5" y2="38" stroke={ink} strokeWidth="1.5" />
            <Line x1="23.5" y1="20" x2="40.5" y2="20" stroke={ink} strokeWidth="1.2" />
            <Line x1="25" y1="29" x2="39" y2="29" stroke={ink} strokeWidth="1.2" />
            <Path d="M26 38 L38 38 L38 42 Q38 52 32 52 Q26 52 26 42 Z" fill={active ? T.limeAccent : T.primary} />
          </G>
        ) : (
          <G>
            <G transform="rotate(-30 28 30)">
              <Rect x="14" y="6" width="26" height="30" rx="12" fill={active ? "#FFFFFF" : T.primary} stroke={ink} strokeWidth="2" />
              <Rect x="23.5" y="35" width="7" height="18" rx="3" fill={ink} />
            </G>
            <Circle cx="48" cy="46" r="8" fill={T.limeAccent} stroke={active ? "#FFFFFF" : ink} strokeWidth="1.5" />
            <Circle cx="45.5" cy="43.5" r="1.3" fill={ink} /><Circle cx="50.5" cy="44" r="1.3" fill={ink} />
            <Circle cx="46" cy="48.5" r="1.3" fill={ink} /><Circle cx="50.5" cy="48.5" r="1.3" fill={ink} />
          </G>
        )}
      </Svg>
    </View>
  );
}

/** Compact pill in the header: current sport + chevron; opens a sheet to switch. Syncs to the profile. */
export function SportSwitcher({ compact }: { compact?: boolean }) {
  const beta = useBetaSport();
  const { sport, choose } = useSport();
  const { user, reload } = useAuth();
  const sheet = useRef<BottomSheetModal>(null);
  const cur = sport ?? "cricket";
  const pick = async (s: SportId) => {
    sheet.current?.dismiss();
    if (s === cur) return;
    choose(s);
    if (user) { await api("/users/me", { method: "PUT", body: { preferred_sport: s } }).catch(() => undefined); void reload().catch(() => undefined); }
    router.replace("/");
  };
  if (beta !== null) return null; // single-sport beta (or options still loading): nothing to switch
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel={`Sport: ${SPORTS[cur].name}. Switch sport`} onPress={() => sheet.current?.present()} hitSlop={6}
        style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: compact ? 2 : 6, height: compact ? 44 : 36, paddingLeft: compact ? 5 : 4, paddingRight: compact ? 8 : 10, borderRadius: R.pill, backgroundColor: pressed ? T.tint : T.surface, borderWidth: 1, borderColor: T.line })}>
        <SportIcon sport={cur} size={compact ? 32 : 28} />
        {compact ? null : <Txt v="smallSemi">{SPORTS[cur].name}</Txt>}
        <ChevronDown size={14} color={T.muted} strokeWidth={2.2} />
      </Pressable>
      <FilterBottomSheet ref={sheet} title="Switch sport" snap={["46%"]}>
        <View>
          {SPORT_ORDER.map((s, i) => (
            <Row key={s} onPress={() => void pick(s)} last={i === SPORT_ORDER.length - 1} height={68} label={SPORTS[s].name}>
              <SportIcon sport={s} size={44} active={s === cur} />
              <View style={{ flex: 1, gap: 2 }}><Txt v="h3">{SPORTS[s].name}</Txt><Txt v="small" color={T.muted} numberOfLines={1}>{SPORTS[s].tagline}</Txt></View>
              {s === cur ? <Check size={20} color={T.primary} strokeWidth={2.4} /> : null}
            </Row>
          ))}
        </View>
      </FilterBottomSheet>
    </>
  );
}
