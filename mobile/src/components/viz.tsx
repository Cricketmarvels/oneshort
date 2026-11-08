/** Small, dependency-free data visualisations drawn with react-native-svg. */
import { ArrowDown, ArrowUp, Minus } from "lucide-react-native";
import { View } from "react-native";
import Svg, { Circle, G, Line, Path, Polygon, Text as SvgText } from "react-native-svg";

import { Txt } from "@/components/ui";
import { F, T } from "@/theme";

function path(values: number[], w: number, h: number, pad = 2): { d: string; pts: [number, number][] } {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i): [number, number] => [pad + (i * (w - 2 * pad)) / Math.max(1, values.length - 1), h - pad - ((v - min) / span) * (h - 2 * pad)]);
  return { d: pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" "), pts };
}

export function Sparkline({ values, w = 64, h = 24, color, dark }: { values: number[]; w?: number; h?: number; color?: string; dark?: boolean }) {
  if (values.length < 2) return <View style={{ width: w, height: h }} />;
  const up = values[values.length - 1]! >= values[0]!;
  const stroke = color ?? (up ? T.up : T.down);
  const { d, pts } = path(values, w, h);
  const last = pts[pts.length - 1]!;
  return (
    <Svg width={w} height={h} accessibilityLabel={`Trend ${up ? "up" : "down"}`}>
      <Path d={d} stroke={stroke} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx={last[0]} cy={last[1]} r={2.6} fill={stroke} />
    </Svg>
  );
}

/** Ring that fills with rating confidence; the rating sits in the middle. */
export function RatingRing({ rating, confidence, size = 120, dark, label = "PlayR rating" }: { rating: number | null; confidence: number; size?: number; dark?: boolean; label?: string }) {
  const sw = size * 0.075;
  const r = (size - sw) / 2;
  const c = 2 * Math.PI * r;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }} accessibilityLabel={`${label} ${rating ? Math.round(rating) : "not yet rated"}, confidence ${Math.round(confidence * 100)} percent`}>
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={T.surface2} strokeWidth={sw} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={T.accent} strokeWidth={sw} fill="none" strokeLinecap="round"
          strokeDasharray={`${c * Math.max(0.02, confidence)} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </Svg>
      <Txt v="h1" color={T.ink} style={{ fontSize: size * 0.27, lineHeight: size * 0.32 }}>{rating ? Math.round(rating) : "—"}</Txt>
      <Txt v="label" color={dark ? T.muted : T.muted} style={{ fontSize: Math.max(9, size * 0.075) }}>{Math.round(confidence * 100)}% sure</Txt>
    </View>
  );
}

export function ConfidenceBar({ value, dark, w = 56 }: { value: number; dark?: boolean; w?: number }) {
  return (
    <View style={{ width: w, height: 5, borderRadius: 3, backgroundColor: T.surface2, overflow: "hidden" }} accessibilityLabel={`Confidence ${Math.round(value * 100)}%`}>
      <View style={{ width: `${Math.round(Math.max(0.04, value) * 100)}%`, height: "100%", backgroundColor: T.accent, borderRadius: 3 }} />
    </View>
  );
}

export function Movement({ value, dark }: { value: number | null | undefined; dark?: boolean }) {
  if (value == null) return <Txt v="label" color={dark ? T.muted : T.muted} style={{ fontSize: 10 }}>NEW</Txt>;
  if (value === 0) return <Minus size={14} color={dark ? T.muted : T.muted} accessibilityLabel="No change" strokeWidth={1.5} />;
  const up = value > 0;
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 1 }} accessibilityLabel={`${up ? "Up" : "Down"} ${Math.abs(value)}`}>
      <Icon size={12} color={up ? T.up : T.down} strokeWidth={3} />
      <Txt v="smallSemi" color={up ? T.up : T.down} style={{ fontSize: 12 }}>{Math.abs(value)}</Txt>
    </View>
  );
}

/** Recent form as round pills: W lime, L peach, T neutral (always lettered, never colour-only). */
export function FormPills({ form, size = 26 }: { form: string[]; size?: number }) {
  const col: Record<string, [string, string]> = { W: [T.limeAccent, T.ink], L: [T.warningBackground, T.warningText], T: [T.surface2, T.muted] };
  return (
    <View style={{ flexDirection: "row", gap: 5 }} accessibilityLabel={`Recent form ${form.join(" ")}`}>
      {form.map((f, i) => (
        <View key={i} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: col[f]?.[0] ?? T.line, alignItems: "center", justifyContent: "center" }}>
          <Txt v="label" color={col[f]?.[1] ?? T.ink} style={{ fontSize: size * 0.42, letterSpacing: 0 }}>{f}</Txt>
        </View>
      ))}
    </View>
  );
}

/** Line chart with soft fill: rating history. */
export function PlayerPerformanceChart({ values, w = 320, h = 140, dark }: { values: number[]; w?: number; h?: number; dark?: boolean }) {
  if (values.length < 2) return null;
  const { d, pts } = path(values, w, h - 18, 8);
  const area = `${d} L${pts[pts.length - 1]![0]},${h - 18} L${pts[0]![0]},${h - 18} Z`;
  const min = Math.round(Math.min(...values));
  const max = Math.round(Math.max(...values));
  return (
    <Svg width={w} height={h} accessibilityLabel={`Rating history from ${Math.round(values[0]!)} to ${Math.round(values[values.length - 1]!)}`}>
      <Line x1={0} y1={h - 18} x2={w} y2={h - 18} stroke={dark ? T.lineDark : T.line} strokeWidth={1} />
      <Path d={area} fill={T.tint} fillOpacity={0.7} />
      <Path d={d} stroke={T.ink} strokeWidth={1.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map(([x, y], i) => <Circle key={i} cx={x} cy={y} r={i === pts.length - 1 ? 4.5 : 2.5} fill={i === pts.length - 1 ? T.accent : T.ink} strokeWidth={0} />)}
      <SvgText x={2} y={h - 4} fontSize={10} fill={dark ? T.muted : T.muted} fontFamily={F.medium}>{`Low ${min}`}</SvgText>
      <SvgText x={w - 2} y={h - 4} fontSize={10} fill={dark ? T.muted : T.muted} fontFamily={F.medium} textAnchor="end">{`High ${max}`}</SvgText>
    </Svg>
  );
}

/** Match-impact bars (0..1), par line at 0.5. */
export function FormBars({ values, w = 160, h = 44 }: { values: number[]; w?: number; h?: number }) {
  if (!values.length) return null;
  const bw = Math.min(14, (w - (values.length - 1) * 4) / values.length);
  return (
    <Svg width={w} height={h} accessibilityLabel="Recent match impact">
      <Line x1={0} y1={h / 2} x2={w} y2={h / 2} stroke={T.line} strokeDasharray="3 3" />
      {values.map((v, i) => {
        const bh = Math.max(3, v * h);
        return <Path key={i} d={`M${i * (bw + 4)},${h} h${bw} v${-bh} h${-bw} Z`} fill={v >= 0.5 ? T.accent : T.line} />;
      })}
    </Svg>
  );
}

/** Radar for player comparison; values normalised 0..1. */
export function RadarChart({ axes, a, b, size = 260 }: { axes: string[]; a: number[]; b: number[]; size?: number }) {
  const cx = size / 2;
  const cy = size / 2;
  const R0 = size / 2 - 34;
  const pt = (i: number, v: number) => {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / axes.length;
    return [cx + Math.cos(ang) * R0 * v, cy + Math.sin(ang) * R0 * v] as const;
  };
  const poly = (vals: number[]) => vals.map((v, i) => pt(i, Math.max(0.05, Math.min(1, v))).join(",")).join(" ");
  return (
    <Svg width={size} height={size} accessibilityLabel="Skill comparison radar">
      <G>
        {[0.25, 0.5, 0.75, 1].map((k) => <Polygon key={k} points={axes.map((_, i) => pt(i, k).join(",")).join(" ")} fill="none" stroke={T.line} strokeWidth={1} />)}
        {axes.map((ax, i) => {
          const [x, y] = pt(i, 1);
          const [lx, ly] = pt(i, 1.2);
          return (
            <G key={ax}>
              <Line x1={cx} y1={cy} x2={x} y2={y} stroke={T.line} />
              <SvgText x={lx} y={ly + 4} fontSize={11} fontFamily={F.semibold} fill={T.text2} textAnchor="middle">{ax}</SvgText>
            </G>
          );
        })}
        <Polygon points={poly(b)} fill={T.ink} fillOpacity={0.12} stroke={T.ink} strokeWidth={2} />
        <Polygon points={poly(a)} fill={T.tint} fillOpacity={0.8} stroke={T.accent} strokeWidth={1.5} />
      </G>
    </Svg>
  );
}

/** Two-sided bar: who leads on this metric. */
export function CompareBar({ label, a, b, fmt = (v: number) => String(Math.round(v)) }: { label: string; a: number | null; b: number | null; fmt?: (v: number) => string }) {
  const av = a ?? 0;
  const bv = b ?? 0;
  const total = av + bv || 1;
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Txt v="number" color={av >= bv ? T.text : T.muted} style={{ fontSize: 16 }}>{a == null ? "—" : fmt(av)}</Txt>
        <Txt v="label" color={T.muted}>{label}</Txt>
        <Txt v="number" color={bv > av ? T.text : T.muted} style={{ fontSize: 16 }}>{b == null ? "—" : fmt(bv)}</Txt>
      </View>
      <View style={{ flexDirection: "row", height: 8, borderRadius: 4, overflow: "hidden", gap: 3 }}>
        <View style={{ flex: av / total, backgroundColor: av >= bv ? T.accent : T.line, borderRadius: 4 }} />
        <View style={{ flex: bv / total, backgroundColor: bv > av ? T.ink : T.trackStrong, borderRadius: 4 }} />
      </View>
    </View>
  );
}
