/** GoFindr · aqua/teal primitives (spec: .claude/skills/playr-aqua-design/SKILL.md §6). Theme tokens only. */
import { STATUS_TONE } from "@cm/shared";
import { Image } from "expo-image";
import { Search, X } from "lucide-react-native";
import { type ReactNode, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  View,
  type ViewStyle,
} from "react-native";

import { mediaUrl } from "@/lib/media";
import { FW, ICON, R, shadow, SIZE, SP, T, type } from "@/theme";

/** Legacy palette names (older screens). */
export const C = {
  brand: T.accent, brandDark: T.ink, brandSoft: T.tint, ball: T.down, sand: T.bg, line: T.line,
  ink: T.ink, ink2: T.muted, muted: T.muted, white: T.surface, amber: T.accent, amberSoft: T.tint,
};

// ---------------------------------------------------------------- typography
type TxtProps = TextProps & { v?: keyof typeof type; color?: string; style?: TextStyle | TextStyle[]; children?: ReactNode };
export function Txt({ v = "body", color = T.ink, style, ...p }: TxtProps) {
  return <Text {...p} style={[type[v], { color }, style as TextStyle]} />;
}
export const H1 = ({ children, color }: { children: ReactNode; color?: string }) => <Txt v="h1" accessibilityRole="header" color={color}>{children}</Txt>;
export const H2 = ({ children, color }: { children: ReactNode; color?: string }) => <Txt v="h2" accessibilityRole="header" color={color}>{children}</Txt>;
export const Muted = ({ children, style }: { children: ReactNode; style?: TextStyle }) => <Txt v="small" color={T.muted} style={style}>{children}</Txt>;

/** SectionHeader: section title (Manrope 17) with an optional teal text-link action, then content. */
export function Section({ title, action, onAction, children }: { title: string; action?: string; onAction?: () => void; children: ReactNode; dark?: boolean }) {
  return (
    <View style={{ gap: SP.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 28 }}>
        <Txt v="h2" accessibilityRole="header" style={{ flex: 1 }}>{title}</Txt>
        {action && onAction ? <TextLink title={action} onPress={onAction} /> : null}
      </View>
      {children}
    </View>
  );
}

export function TextLink({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={10} style={({ pressed }) => ({ minHeight: SIZE.touch, justifyContent: "center", opacity: pressed ? 0.7 : 1 })}>
      <Txt v="smallSemi" color={T.primaryDark} style={{ fontSize: 14 }}>{title}</Txt>
    </Pressable>
  );
}

// ---------------------------------------------------------------- buttons
type BtnVariant = "primary" | "lime" | "highlight" | "outline" | "secondary" | "ghost" | "danger" | "dark";
/** Starter Btn: teal fill + white bold label (radius 14, 52 high); "highlight" = mint secondary with teal label; secondary = white + line. */
export function Button({ title, onPress, variant = "primary", loading, disabled, style, icon, size = "md", testID }: {
  title: string; onPress: () => void; variant?: BtnVariant; loading?: boolean; disabled?: boolean; style?: ViewStyle; icon?: ReactNode; size?: "sm" | "md" | "lg"; testID?: string;
}) {
  // "highlight" = lime CTA (sparingly: Join team, Send challenge, Next step); "outline" = ink-bordered secondary
  const v = variant === "lime" ? "primary" : variant === "dark" ? "secondary" : variant;
  const bg = { primary: T.primary, highlight: T.primarySoft, outline: T.surface, secondary: T.surface, ghost: "transparent", danger: T.dangerBackground }[v];
  const pressedBg = { primary: T.primaryPressed, highlight: T.pressedSoft, outline: T.surface2, secondary: T.surface2, ghost: T.tint, danger: T.dangerBackground }[v];
  const fg = { primary: T.onPrimary, highlight: T.primaryDark, outline: T.ink, secondary: T.ink, ghost: T.primaryDark, danger: T.dangerText }[v];
  const h = size === "sm" ? 40 : size === "lg" ? 52 : SIZE.button;
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      disabled={disabled || loading} onPress={onPress} hitSlop={size === "sm" ? 4 : 0}
      style={({ pressed }) => [
        { minHeight: h, borderRadius: R.button, paddingHorizontal: v === "ghost" ? 8 : size === "sm" ? 14 : 20, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, backgroundColor: pressed ? pressedBg : bg },
        v === "secondary" && { borderWidth: 1, borderColor: T.line },
        v === "outline" && { borderWidth: 1.5, borderColor: T.ink },
        v === "outline" && { borderRadius: R.pill },
        { opacity: disabled ? 0.45 : 1 },
        style,
      ]}>
      {({ pressed }) => (loading ? <ActivityIndicator color={fg} /> : (<>{icon}<Txt v="h3" color={v === "primary" && pressed ? T.surface : fg} style={{ fontSize: size === "sm" ? 14 : 15 }}>{title}</Txt></>))}
    </Pressable>
  );
}
export const PrimaryButton = Button;
export const SecondaryButton = (p: Omit<Parameters<typeof Button>[0], "variant">) => <Button {...p} variant="secondary" />;

/** 44×44 icon button. `badge` > 0 shows an unread dot. `filled` gives it a white circular surface (headers). */
export function IconButton({ icon, onPress, label, badge, filled }: { icon: ReactNode; onPress: () => void; label: string; dark?: boolean; badge?: number; filled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={badge ? `${label}, ${badge} unread` : label} onPress={onPress} hitSlop={4}
      style={({ pressed }) => [{ width: SIZE.touch, height: SIZE.touch, borderRadius: SIZE.touch / 2, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? T.tint : filled ? T.surface : "transparent" }, filled ? { borderWidth: 1, borderColor: T.line } : null]}>
      {icon}
      {badge ? <View style={{ position: "absolute", top: 9, right: 10, width: 9, height: 9, borderRadius: 5, backgroundColor: T.dangerText, borderWidth: 2, borderColor: filled ? T.surface : T.bg }} /> : null}
    </Pressable>
  );
}

// ---------------------------------------------------------------- inputs
export function Field({ label, error, hint, ...props }: TextInputProps & { label: string; error?: string | null; hint?: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Txt v="smallSemi" color={T.ink}>{label}</Txt>
      <TextInput accessibilityLabel={label} placeholderTextColor={T.placeholder} {...props} style={[s.input, error ? { borderColor: T.down } : null, props.style]} />
      {error ? <Txt v="small" color={T.down} accessibilityRole="alert">{error}</Txt> : hint ? <Muted>{hint}</Muted> : null}
    </View>
  );
}

export function SearchBar({ value, onChange, placeholder = "Search" }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: T.surface, borderRadius: R.field, borderWidth: 1, borderColor: T.line, paddingHorizontal: 16, height: SIZE.input }}>
      <Search size={18} color={T.muted} strokeWidth={ICON.stroke} />
      <TextInput accessibilityLabel={placeholder} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={T.placeholder} style={{ flex: 1, minWidth: 0, ...FW.body, fontSize: 15, color: T.ink }} autoCorrect={false} />
      {value ? <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => onChange("")} hitSlop={12}><X size={16} color={T.muted} strokeWidth={ICON.stroke} /></Pressable> : null}
    </View>
  );
}

// ---------------------------------------------------------------- surfaces & lists
/** Card: white, 1px border, radius 20, very soft shadow. For independent units (a match, a player, a team). */
export function Card({ children, style, onPress, label }: { children: ReactNode; style?: ViewStyle | ViewStyle[]; dark?: boolean; onPress?: () => void; label?: string; surface?: boolean }) {
  const base: ViewStyle = { backgroundColor: T.surface, borderRadius: R.card, borderWidth: 1, borderColor: T.line, padding: SP.lg, gap: SP.sm, ...shadow(1) };
  if (!onPress) return <View style={[base, style as ViewStyle]}>{children}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [base, style as ViewStyle, pressed ? { backgroundColor: T.surface2 } : null]}>
      {children}
    </Pressable>
  );
}

/** List: one white rounded container holding divider-separated rows (search results, notifications, settings). */
export function List({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[{ backgroundColor: T.surface, borderRadius: R.card, borderWidth: 1, borderColor: T.line, paddingHorizontal: SP.lg, ...shadow(1) }, style]}>{children}</View>;
}
export function Row({ children, onPress, label, last, height = SIZE.row, style }: { children: ReactNode; onPress?: () => void; label?: string; last?: boolean; height?: number; style?: ViewStyle }) {
  const base: ViewStyle = { flexDirection: "row", alignItems: "center", gap: 12, minHeight: height, paddingVertical: 12, borderBottomWidth: last ? 0 : 1, borderBottomColor: T.line };
  if (!onPress) return <View style={[base, style]}>{children}</View>;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [base, style, pressed ? { opacity: 0.65 } : null]}>{children}</Pressable>;
}

/** InlineNotice: a quiet explanatory panel (e.g. "GoFindr does not process payments"). */
export function InlineNotice({ children, tone = "info", icon }: { children: ReactNode; tone?: "info" | "warning"; icon?: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", gap: 10, padding: 14, borderRadius: R.lg, backgroundColor: tone === "warning" ? T.warningBackground : T.tint }}>
      {icon}
      <Txt v="small" color={tone === "warning" ? T.warningText : T.primaryDark} style={{ flex: 1, fontSize: 13.5, lineHeight: 19 }}>{children}</Txt>
    </View>
  );
}

export function Screen({ children }: { children: ReactNode }) {
  return <View style={{ flex: 1, backgroundColor: T.bg }}>{children}</View>;
}

export function Divider(_p: { dark?: boolean }) {
  return <View style={{ height: 1, backgroundColor: T.line }} />;
}

// ---------------------------------------------------------------- chips & badges
/** Starter Chip: white pill with line border; selected = solid teal with white label. */
export function Chip({ label, active, onPress, icon, count }: { label: string; active?: boolean; onPress?: () => void; dark?: boolean; icon?: ReactNode; tone?: "lime" | "brand"; count?: number }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: !!active }} accessibilityLabel={count ? `${label}, ${count} selected` : label} onPress={onPress} hitSlop={{ top: 5, bottom: 5 }}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, height: 36, borderRadius: 22, borderWidth: 1, borderColor: active ? T.primary : T.line, backgroundColor: active ? T.primary : pressed ? T.surface2 : T.surface })}>
      {icon}
      <Txt v="smallSemi" color={active ? "#FFFFFF" : T.ink} style={{ fontSize: 12.5 }}>{label}</Txt>
      {count ? <View style={{ minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: active ? "rgba(255,255,255,0.25)" : T.primary, alignItems: "center", justifyContent: "center" }}><Txt v="micro" color={T.onPrimary} style={{ letterSpacing: 0 }}>{count}</Txt></View> : null}
    </Pressable>
  );
}

export function ChipRow<V extends string>({ value, options, onChange }: { value: V; options: { v: V; l: string }[]; onChange: (v: V) => void; dark?: boolean }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: SP.page }} style={{ marginHorizontal: -SP.page, flexGrow: 0 }}>
      {options.map((o) => <Chip key={o.v} label={o.l} active={o.v === value} onPress={() => onChange(o.v)} />)}
    </ScrollView>
  );
}

/** UnderlineTabs: text tabs with a teal underline on the selected one and a full-width hairline (My Games). */
export function UnderlineTabs<V extends string>({ value, options, onChange }: { value: V; options: { v: V; l: string }[]; onChange: (v: V) => void }) {
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: "row", gap: options.length > 3 ? 16 : 24, marginHorizontal: -SP.page, paddingHorizontal: SP.page, borderBottomWidth: 1, borderBottomColor: T.line }}>
      {options.map((o) => {
        const on = o.v === value;
        return (
          <Pressable key={o.v} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={o.l} onPress={() => onChange(o.v)} hitSlop={{ top: 8, bottom: 4 }}
            style={{ paddingBottom: 10, minHeight: SIZE.touch - 8, justifyContent: "flex-end", borderBottomWidth: 2.5, borderBottomColor: on ? T.primary : "transparent", marginBottom: -1 }}>
            <Txt v={on ? "h3" : "bodyMed"} color={on ? T.ink : T.faint} style={{ fontSize: options.length > 3 ? 14 : 15.5 }} numberOfLines={1}>{o.l}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

/** SegmentedTabs: white track with border; the selected segment is turquoise with a dark-teal label (not colour-only: weight changes too). */
export function Segmented<V extends string>({ value, options, onChange }: { value: V; options: { v: V; l: string }[]; onChange: (v: V) => void; dark?: boolean }) {
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: "row", backgroundColor: T.surface, borderRadius: R.track, borderWidth: 1, borderColor: T.line, padding: 4 }}>
      {options.map((o) => {
        const on = o.v === value;
        return (
          <Pressable key={o.v} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={o.l} onPress={() => onChange(o.v)}
            style={{ flex: 1, height: 38, borderRadius: R.thumb, alignItems: "center", justifyContent: "center", backgroundColor: on ? T.primary : "transparent" }}>
            <Txt v={on ? "smallSemi" : "small"} color={on ? "#FFFFFF" : T.muted} style={{ fontSize: options.length > 3 ? 13 : 14 }} numberOfLines={1}>{o.l}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

/** StatusChip: small restrained label; status colours only here, always with text. */
const TONES: Record<string, [string, string]> = {
  success: [T.successBackground, T.successText], warning: [T.warningBackground, T.warningText], danger: [T.dangerBackground, T.dangerText],
  info: [T.tint, T.primaryDark], brand: [T.tint, T.primaryDark], lime: [T.tint, T.primaryDark], neutral: [T.surface2, T.muted], dark: [T.surface2, T.ink],
};
export function Badge({ status, label, icon }: { status: string; label?: string; icon?: ReactNode }) {
  const tone = TONES[status in TONES ? status : STATUS_TONE[status] ?? "neutral"] ?? TONES.neutral!;
  return (
    <View style={{ alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 4, borderRadius: R.pill, paddingHorizontal: 9, paddingVertical: 3, backgroundColor: tone[0] }}>
      {icon}
      <Txt v="smallSemi" color={tone[1]} style={{ fontSize: 11.5, lineHeight: 16 }}>{label ?? status.replace(/_/g, " ")}</Txt>
    </View>
  );
}
export const StatusChip = Badge;

/** DateBlock: weekday / day / month stacked on primarySoft (My Games cards). */
export function DateBlock({ iso }: { iso: string }) {
  const d = new Date(iso);
  const wd = d.toLocaleDateString("en-IN", { weekday: "short" });
  const mo = d.toLocaleDateString("en-IN", { month: "short" });
  return (
    <View accessibilityLabel={d.toDateString()} style={{ width: 48, alignItems: "center" }}>
      <Txt v="smallSemi" color={T.primaryDark} style={{ fontSize: 12.5, lineHeight: 16 }}>{wd}</Txt>
      <Txt v="display" color={T.ink} style={{ fontSize: 27, lineHeight: 31, letterSpacing: -0.5 }}>{String(d.getDate()).padStart(2, "0")}</Txt>
      <Txt v="small" color={T.muted} style={{ fontSize: 12.5, lineHeight: 16 }}>{mo}</Txt>
    </View>
  );
}

// ---------------------------------------------------------------- avatar
/** Starter Avatar: circular photo, or white initials on the dark teal circle. */
export function Avatar({ uri, name, size = SIZE.avatar, online }: { uri?: string | null; name: string; size?: number; ring?: string; online?: boolean }) {
  const [failed, setFailed] = useState(false);
  const words = name.split(/\s+/).filter(Boolean);
  const lettered = words.filter((w) => /^\p{L}/u.test(w));
  const initials = (lettered.length ? lettered : words).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  const dot = online ? <View accessibilityLabel="Available" style={{ position: "absolute", right: 0, bottom: 0, width: 9, height: 9, borderRadius: 5, backgroundColor: T.successText, borderWidth: 2, borderColor: T.surface }} /> : null;
  const src = mediaUrl(uri);
  if (src && !failed) {
    return (
      <View>
        <Image source={{ uri: src }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: T.primarySoft }} contentFit="cover"
          cachePolicy="memory-disk" transition={150} recyclingKey={src} accessibilityLabel={`${name}'s photo`} onError={() => setFailed(true)} />
        {dot}
      </View>
    );
  }
  return (
    <View accessibilityLabel={name} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: T.heroInk, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ ...FW.bold, fontSize: Math.max(11, size * 0.34), color: "#FFFFFF" }}>{initials}</Text>
      {dot}
    </View>
  );
}

/** AvatarStack: up to 3 overlapping avatars plus "+N". */
export function AvatarStack({ names, extra = 0, size = 26 }: { names: string[]; extra?: number; size?: number }) {
  const shown = names.slice(0, 3);
  const more = extra + Math.max(0, names.length - 3);
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }} accessibilityLabel={`${names.length + extra} participants`}>
      {shown.map((n, i) => <View key={`${n}${i}`} style={{ marginLeft: i ? -8 : 0, borderRadius: size, borderWidth: 2, borderColor: T.surface }}><Avatar name={n} size={size} /></View>)}
      {more > 0 ? <View style={{ marginLeft: -8, height: size + 4, minWidth: size + 4, paddingHorizontal: 4, borderRadius: size, borderWidth: 2, borderColor: T.surface, backgroundColor: T.surface2, alignItems: "center", justifyContent: "center" }}><Txt v="micro" color={T.muted} style={{ letterSpacing: 0 }}>+{more}</Txt></View> : null}
    </View>
  );
}

// ---------------------------------------------------------------- states
/** EmptyState: short title, helpful explanation and one relevant next action. */
export function EmptyState({ title, body, action, onAction, icon }: { title: string; body?: string; icon?: ReactNode; action?: string; onAction?: () => void }) {
  return (
    <View style={{ alignItems: "center", gap: 6, paddingVertical: 28, paddingHorizontal: 16, borderRadius: R.card, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line }}>
      {icon ? <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: T.tint, alignItems: "center", justifyContent: "center", marginBottom: 4 }}>{icon}</View> : null}
      <Txt v="h3" style={{ textAlign: "center" }}>{title}</Txt>
      {body ? <Txt v="small" color={T.muted} style={{ textAlign: "center", fontSize: 13.5 }}>{body}</Txt> : null}
      {action && onAction ? <Button title={action} variant="secondary" size="sm" onPress={onAction} style={{ marginTop: 8 }} /> : null}
    </View>
  );
}
export const Empty = EmptyState;

export function Skeleton({ h = 16, w = "100%", r = 8, style }: { h?: number; w?: number | `${number}%`; r?: number; style?: ViewStyle }) {
  return <View style={[{ height: h, width: w, borderRadius: r, backgroundColor: T.skeleton }, style]} />;
}

export function LoadingSkeleton({ rows = 4 }: { rows?: number; dark?: boolean }) {
  return (
    <View accessibilityLabel="Loading" style={{ backgroundColor: T.surface, borderRadius: R.card, borderWidth: 1, borderColor: T.line, paddingHorizontal: SP.lg }}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={{ flexDirection: "row", gap: 14, alignItems: "center", height: SIZE.rowPerson, borderBottomWidth: i < rows - 1 ? 1 : 0, borderBottomColor: T.line }}>
          <Skeleton h={40} w={40} r={20} />
          <View style={{ flex: 1, gap: 8 }}><Skeleton h={12} w="55%" /><Skeleton h={10} w="35%" /></View>
          <Skeleton h={14} w={40} />
        </View>
      ))}
    </View>
  );
}
export function Loading() { return <View style={{ padding: 40 }}><ActivityIndicator color={T.accent} /></View>; }

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <View accessibilityRole="alert" style={{ alignItems: "center", gap: 6, paddingVertical: 24, paddingHorizontal: 16, borderRadius: R.card, backgroundColor: T.dangerBackground }}>
      <Txt v="h3" color={T.dangerText}>Couldn't load this</Txt>
      <Txt v="small" color={T.dangerText} style={{ textAlign: "center" }}>{error instanceof Error && !/^\w+Error|status \d{3}|fetch/i.test(error.message) ? error.message : "Check your connection and try again."}</Txt>
      {onRetry ? <Button title="Retry" variant="secondary" size="sm" onPress={onRetry} style={{ marginTop: 6 }} /> : null}
    </View>
  );
}

export function Stat({ label, value, accent }: { label: string; value: string | number; dark?: boolean; accent?: boolean }) {
  return (
    <View style={{ flex: 1, minWidth: 64, gap: 2 }}>
      <Txt v="stat" color={accent ? T.primaryDark : T.ink}>{value}</Txt>
      <Txt v="small" color={T.muted}>{label}</Txt>
    </View>
  );
}

/** Shared styles as getters so they read the live (light/dark) palette each render. */
export const s = {
  get input(): TextStyle { return { minHeight: SIZE.input, borderRadius: R.field, borderWidth: 1, borderColor: T.line, backgroundColor: T.surface, paddingHorizontal: 16, fontSize: 15, color: T.ink, ...FW.body }; },
  get card(): ViewStyle { return { backgroundColor: T.surface, borderRadius: R.card, borderWidth: 1, borderColor: T.line, padding: SP.lg, gap: SP.sm }; },
  get h2(): TextStyle { return { ...type.h2, color: T.ink }; },
  scroll: { padding: SP.page, gap: SP.section, paddingBottom: 56 } as ViewStyle,
  row: { flexDirection: "row", alignItems: "center", gap: 10 } as ViewStyle,
};
