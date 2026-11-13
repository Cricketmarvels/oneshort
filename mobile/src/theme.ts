/**
 * OneShort · design tokens — the single source of every colour, font, radius and size.
 * Brand: deep pitch green ink (#0A2A20), turf green primary (#0E9F6E), the "eleventh dot" orange accent (#FF6A3D),
 * warm off-white canvas (#F6F7F3); Inter. The accent is reserved for the thing that's missing (a short squad, an unpaid
 * fee, the lit dot in the mark) so it keeps its meaning.
 *
 * Light + dark palettes; applyTheme() swaps them at runtime (lib/appearance.ts: System | Light | Dark).
 * Never hard-code colours in screens — use T.* so both themes work. Legacy aliases (ink, muted, tint…) map onto tokens.
 */
import { Platform, type TextStyle, type ViewStyle } from "react-native";

const LIGHT = {
  background: "#F6F7F3", // warm off-white canvas
  surface: "#FFFFFF",
  surfaceSecondary: "#EFF3EE",
  primary: "#0E9F6E", // turf green — buttons, active states
  primaryDark: "#0B7F58", // green text/links (AA on white)
  primaryPressed: "#09694A",
  aqua: "#17A89C",
  primarySoft: "#DCF4E8", // mint — selected chips, highlights
  pressedSoft: "#C8ECDA",
  textPrimary: "#111F19",
  textSecondary: "#667570",
  textMuted: "#89968F",
  border: "#E0E7E1",
  heroInk: "#0A2A20", // deep pitch green hero (stays dark in both themes)
  accentOrange: "#FF6A3D", // the eleventh dot
  accentOrangeSoft: "#FFECE4",
  successBackground: "#E1F4EA",
  successText: "#12804D",
  success: "#16A765",
  successPill: "#DDF5E6",
  warningBackground: "#FFF1DC",
  warningText: "#9A6200",
  dangerBackground: "#FCE7EA",
  dangerText: "#C2364A",
  chipNeutral: "#EDF1EC",
  limeAccent: "#DCF4E8",
  canvasOuter: "#ECEFE8",
  skeleton: "#EAEEE7",
  overlayRgb: "17,31,25",
  // pastel quick-action tiles: [from, to, icon]
  tileMint: "#E1F6EB", tileMint2: "#CFF0DE", tileMintInk: "#0E8F5F",
  tileAqua: "#E2F3F5", tileAqua2: "#D0ECF0", tileAquaInk: "#0B7F8C",
  tilePeach: "#FFEEE6", tilePeach2: "#FFE1D3", tilePeachInk: "#D4512A",
  tileLilac: "#EEEDFB", tileLilac2: "#E3E1F7", tileLilacInk: "#6A55C9",
  tileTitle: "#0F3A2C", // deep green title on a pastel card; darker than body ink on purpose
  statusBar: "dark",
};

/** Dark theme: pitch-black green canvas, raised surfaces, brighter green for contrast on dark. */
const DARK: typeof LIGHT = {
  background: "#0B1511",
  surface: "#13201A",
  surfaceSecondary: "#192921",
  primary: "#22C283",
  primaryDark: "#5EE0A8",
  primaryPressed: "#1AA56E",
  aqua: "#3BC9B5",
  primarySoft: "#163A2B",
  pressedSoft: "#1C4A37",
  textPrimary: "#E9F2EC",
  textSecondary: "#9DB1A6",
  textMuted: "#7C8F85",
  border: "#24352C",
  heroInk: "#07251B",
  accentOrange: "#FF7A50",
  accentOrangeSoft: "#3D2317",
  successBackground: "#14322A",
  successText: "#5FD49B",
  success: "#2FCB80",
  successPill: "#143528",
  warningBackground: "#3A2C14",
  warningText: "#F2C14E",
  dangerBackground: "#3D1D22",
  dangerText: "#FF8A97",
  chipNeutral: "#22322A",
  limeAccent: "#163A2B",
  canvasOuter: "#070F0B",
  skeleton: "#1E2D25",
  overlayRgb: "0,0,0",
  tileMint: "#143127", tileMint2: "#113A2B", tileMintInk: "#5FD8A8",
  tileAqua: "#142C33", tileAqua2: "#11353D", tileAquaInk: "#5CC8D8",
  tilePeach: "#33261A", tilePeach2: "#3B2A18", tilePeachInk: "#FF9A70",
  tileLilac: "#25223A", tileLilac2: "#2B2746", tileLilacInk: "#B3A4FF",
  tileTitle: "#E9F2EC",
  statusBar: "light",
};
export type Scheme = "light" | "dark";
export type Palette = typeof LIGHT;

function build(A: Palette) {
  return {
    ...A,
    bg: A.background, surface2: A.surfaceSecondary, ink: A.textPrimary, muted: A.textSecondary, faint: A.textMuted, placeholder: A.textMuted,
    line: A.border, accent: A.primaryDark, accentHover: A.primaryDark, tint: A.primarySoft, onPrimary: "#FFFFFF", onAccent: "#FFFFFF",
    up: A.successText, down: A.dangerText,
    // legacy aliases
    paper: A.background, white: A.surface, highlight: A.primarySoft, text: A.textPrimary, text2: A.textSecondary,
    lime: A.primarySoft, limeSoft: A.primarySoft, limeDeep: A.primaryDark, limeText: A.primaryDark, limeGlow: A.border, limeWash: A.primarySoft,
    brand: A.primaryDark, brandHover: A.primaryDark, brandSoft: A.primarySoft, onBrand: A.textPrimary, onBrandMuted: A.textSecondary,
    track: A.surfaceSecondary, trackStrong: A.border, switchOff: A.border, dashed: A.border, ink2: A.surfaceSecondary, ink3: A.surfaceSecondary,
    lineDark: A.border, onPhoto: "#FFFFFF", mutedOnDark: A.textSecondary, glass: A.surfaceSecondary, glassSoft: A.surfaceSecondary,
    glassLine: A.border, glassStrong: A.surfaceSecondary, scrim: `rgba(${A.overlayRgb},${A === LIGHT ? 0.36 : 0.6})`,
    warn: A.warningText, warnSoft: A.warningBackground, warnText: A.warningText, info: A.primaryDark, infoSoft: A.primarySoft, infoText: A.primaryDark,
    successSoft: A.successBackground, dangerSoft: A.dangerBackground, gold: A.primaryDark, silver: A.primaryDark, bronze: A.primaryDark,
  };
}

/** Live palette. Mutated in place by applyTheme(); the root remounts on change so every screen re-reads it. */
export const AQUA: Palette = { ...LIGHT };
export const T = build(LIGHT);
export let scheme: Scheme = "light";
export function applyTheme(next: Scheme) {
  scheme = next;
  const p = next === "dark" ? DARK : LIGHT;
  Object.assign(AQUA, p);
  Object.assign(T, build(p));
}

/** Team identity colours: shown softly (crest backgrounds, slim banners), never as large dark surfaces. */
export const ART = {
  kits: [
    ["#087F7B", "#E5F5F2"], ["#2F6FA8", "#E1ECF6"], ["#B85B13", "#FCE9D5"], ["#287A4B", "#DDF3E0"],
    ["#6B4FA8", "#EAE4F6"], ["#A8325A", "#F7E1E9"], ["#7A6A12", "#F3EED2"], ["#40605C", "#E3ECEA"],
  ] as const,
  skin: "#D7A97F",
  skinShade: "#C99A72",
  grille: "#9AA0A3",
};

export const overlay = (alpha: number) => `rgba(${T.overlayRgb},${Math.max(0, Math.min(1, alpha))})`;

/** Inter (loaded in app/_layout.tsx). `FW.x` = family for that weight. */
export const SYS = Platform.select({ ios: "System", android: "sans-serif", default: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' }) as string;
const fam = (f: string): TextStyle => ({ fontFamily: f });
export const FW = {
  display: fam("Inter_800ExtraBold"), heading: fam("Inter_700Bold"), headingSemi: fam("Inter_600SemiBold"),
  body: fam("Inter_400Regular"), medium: fam("Inter_500Medium"), semibold: fam("Inter_600SemiBold"), bold: fam("Inter_700Bold"), initials: fam("Inter_600SemiBold"),
} as const;
export const F = { display: "Inter_800ExtraBold", heading: "Inter_700Bold", headingSemi: "Inter_600SemiBold", body: "Inter_400Regular", medium: "Inter_500Medium", semibold: "Inter_600SemiBold", bold: "Inter_700Bold", initials: "Inter_600SemiBold" } as const;

export const R = { sm: 10, md: 14, lg: 18, xl: 22, pill: 999, field: 14, button: 14, sheet: 24, card: 20, track: 14, thumb: 11 } as const;
export const SP = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 32, page: 20, section: 24 } as const;
export const SIZE = { touch: 44, row: 56, rowPerson: 64, avatar: 44, avatarSm: 36, avatarLg: 56, avatarXl: 72, nav: 70, icon: 22, button: 52, input: 54 } as const;
export const ICON = { stroke: 1.8, navInactive: 1.8, navActive: 2.1 } as const;

const num: TextStyle = { fontVariant: ["tabular-nums"] };
export const type: Record<string, TextStyle> = {
  display: { ...FW.display, fontSize: 30, lineHeight: 36, letterSpacing: -0.8 },
  hero: { ...FW.display, fontSize: 28, lineHeight: 34, letterSpacing: -0.6 }, // screen titles 26–30
  h1: { ...FW.heading, fontSize: 22, lineHeight: 28, letterSpacing: -0.4 }, // section headings 20–22
  h2: { ...FW.heading, fontSize: 20, lineHeight: 26, letterSpacing: -0.3 },
  h3: { ...FW.heading, fontSize: 16, lineHeight: 21, letterSpacing: -0.1 }, // card titles 15–17
  body: { ...FW.body, fontSize: 15, lineHeight: 22 },
  bodyMed: { ...FW.medium, fontSize: 15, lineHeight: 22 },
  small: { ...FW.medium, fontSize: 13, lineHeight: 18 }, // supporting 12–13
  smallSemi: { ...FW.semibold, fontSize: 13, lineHeight: 18 },
  label: { ...FW.semibold, fontSize: 13, lineHeight: 18 },
  micro: { ...FW.bold, fontSize: 11, lineHeight: 14, letterSpacing: 0.6, textTransform: "uppercase" },
  stat: { ...FW.heading, fontSize: 21, lineHeight: 27, ...num },
  metric: { ...FW.display, fontSize: 28, lineHeight: 34, ...num },
  number: { ...FW.semibold, fontSize: 15, lineHeight: 20, ...num },
};

/** Subtle green-tinted elevation; level 1 = cards (very soft), 2 = floating controls, 3 = sheets. */
export const shadow = (level: 1 | 2 | 3 = 1): ViewStyle => ({
  shadowColor: scheme === "dark" ? "#000000" : "#0A2A20",
  shadowOpacity: scheme === "dark" ? (level === 1 ? 0.25 : level === 2 ? 0.35 : 0.5) : level === 1 ? 0.05 : level === 2 ? 0.08 : 0.14, // subtle, only where it helps hierarchy
  shadowRadius: level === 1 ? 10 : level === 2 ? 16 : 24,
  shadowOffset: { width: 0, height: level === 1 ? 3 : 6 },
  elevation: level,
});
