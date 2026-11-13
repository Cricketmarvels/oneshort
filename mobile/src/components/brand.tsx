/**
 * OneShort brand: the eleventh dot. Ten dots in place, the eleventh lit — the missing player, found.
 * - OneShortMark: the 4-4-3 dot grid (tile or bare), with `lit` for the welcome animation.
 * - Wordmark: mark + "OneShort" ("One" display weight, "Short" lighter, in green).
 * - ShortChip: the squad state in the brand's own words — "ONE SHORT", "TWO SHORT", "FULL HOUSE".
 */
import { Text, View, type ViewStyle } from "react-native";
import Svg, { Circle } from "react-native-svg";

import { FW, scheme, T } from "@/theme";

const ROWS = [4, 4, 3];
/** Grid positions (col, row) for the eleven dots, 4-4-3, each row centred. The last one is the eleventh. */
export const DOTS: [number, number][] = ROWS.flatMap((n, r) => Array.from({ length: n }, (_, c) => [c + (4 - n) / 2, r] as [number, number]));

export function OneShortMark({ size = 28, lit = 11, tile = true, dot, glow, style }: {
  size?: number; lit?: number; tile?: boolean; dot?: string; glow?: string; style?: ViewStyle;
}) {
  const u = 100 / 4.7; // grid cell, inside a 100-unit box
  const ox = 50 - 1.5 * u;
  const oy = 50 - 1 * u;
  const rad = u * 0.3;
  const dotColor = dot ?? (tile ? "#FFFFFF" : T.ink);
  const accent = glow ?? T.accentOrange;
  const [lx, ly] = DOTS[10]!;
  return (
    <View style={[{ width: size, height: size, borderRadius: tile ? size * 0.28 : 0, backgroundColor: tile ? T.heroInk : "transparent", alignItems: "center", justifyContent: "center", overflow: "hidden" }, style]}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        {lit >= 11 ? <Circle cx={ox + lx * u} cy={oy + ly * u} r={rad * 2.1} fill={accent} opacity={0.22} /> : null}
        {DOTS.map(([c, r], i) => {
          const last = i === 10;
          return <Circle key={i} cx={ox + c * u} cy={oy + r * u} r={last ? rad * 1.12 : rad} fill={last ? accent : dotColor} opacity={i < lit ? 1 : 0.18} />;
        })}
      </Svg>
    </View>
  );
}

export function Wordmark({ size = 24, mark = true, color, muted }: { size?: number; mark?: boolean; color?: string; muted?: string; dark?: boolean; tone?: string }) {
  const ink = color ?? T.ink;
  return (
    <View accessibilityRole="header" accessibilityLabel="OneShort" style={{ flexDirection: "row", alignItems: "center", gap: Math.round(size * 0.36), flexShrink: 1 }}>
      {mark ? <OneShortMark size={Math.round(size * 1.3)} /> : null}
      <Text style={{ ...FW.display, fontSize: size, lineHeight: Math.round(size * 1.2), letterSpacing: -size * 0.035, color: ink, flexShrink: 1 }} numberOfLines={1}>
        One<Text style={{ ...FW.medium, color: muted ?? (color ? ink : T.primaryDark), letterSpacing: -size * 0.02 }}>Short</Text>
      </Text>
    </View>
  );
}

const WORDS = ["", "One", "Two", "Three", "Four", "Five", "Six"];
/** The brand's own status line for a squad: how many players are still missing. */
export function shortLabel(short: number) {
  return short <= 0 ? "Full house" : `${WORDS[short] ?? short} short`;
}

export function ShortChip({ short, style }: { short: number; style?: ViewStyle }) {
  const full = short <= 0;
  const dark = scheme === "dark";
  const [bg, fg, dotC] = full ? [T.successPill, T.successText, T.success] : [T.accentOrangeSoft, dark ? "#FFB08F" : "#B4421B", T.accentOrange];
  return (
    <View accessibilityLabel={shortLabel(short)} style={[{ alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, height: 26, borderRadius: 13, backgroundColor: bg }, style]}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dotC }} />
      <Text style={{ ...FW.bold, fontSize: 11.5, letterSpacing: 0.5, color: fg }}>{shortLabel(short).toUpperCase()}</Text>
    </View>
  );
}
