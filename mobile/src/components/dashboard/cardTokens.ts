/**
 * Depth tokens for the 3D action cards. Colours come from the live palette (`T.tile*`), so the cards
 * work in light and dark; only the depth maths lives here. Call these at render time — `T` is mutated
 * in place by `applyTheme`, so module-level constants would freeze the light palette.
 */
import { Platform, type ViewStyle } from "react-native";

import { scheme, T } from "@/theme";

export type CardTone = "mint" | "aqua" | "peach" | "lilac";

/** Multiply a #RRGGBB colour towards black (f < 1) or white (f > 1). Used for the card's bottom edge. */
export function shade(hex: string, f: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  const mix = (c: number) => Math.round(f <= 1 ? c * f : c + (255 - c) * (f - 1));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => mix(c).toString(16).padStart(2, "0")).join("")}`;
}

export type ToneSkin = {
  /** Layer B: pastel surface gradient, light corner → slightly deeper corner. */
  surface: readonly [string, string];
  /** Layer B: the extruded bottom edge peeking out below the surface. */
  edge: string;
  /** Hairline along the top of the surface that reads as a lit upper border. */
  rim: string;
};

export function toneSkin(tone: CardTone): ToneSkin {
  const dark = scheme === "dark";
  const pair: Record<CardTone, readonly [string, string]> = {
    mint: [T.tileMint, T.tileMint2],
    aqua: [T.tileAqua, T.tileAqua2],
    peach: [T.tilePeach, T.tilePeach2],
    lilac: [T.tileLilac, T.tileLilac2],
  };
  const [from, to] = pair[tone];
  return {
    surface: [from, to],
    edge: shade(to, dark ? 0.72 : 0.88),
    rim: dark ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.85)",
  };
}

export const CARD = {
  radius: 18,
  /** How far the darker edge sits below the surface — the extrusion. */
  extrusion: 4,
  padding: 8,
  gapX: 10,
  gapY: 12,
  /** Width ÷ height. Four across a phone: a little taller than wide, so the label sits under the art. */
  aspect: 1 / 1.12,
  minHeight: 84,
  arrow: 34,
  pressScale: 0.97,
  pressDrop: 3,
} as const;

/** Layer A: the ambient shadow that lifts the whole card off the canvas. */
export function cardShadow(): ViewStyle {
  const dark = scheme === "dark";
  return Platform.select<ViewStyle>({
    ios: { shadowColor: dark ? "#000000" : "#244C48", shadowOpacity: dark ? 0.5 : 0.16, shadowRadius: 19, shadowOffset: { width: 0, height: 12 } },
    android: { elevation: 10, shadowColor: dark ? "#000000" : "#244C48" },
    default: { shadowColor: dark ? "#000000" : "#244C48", shadowOpacity: dark ? 0.5 : 0.16, shadowRadius: 19, shadowOffset: { width: 0, height: 12 } },
  })!;
}

/**
 * Soft contact shadow under the floating illustration, so it reads as hovering over the surface.
 * Returned as a colour: it is painted as a gradient that fades out at both ends, because React Native
 * cannot blur a plain view and a solid ellipse reads as a shelf, not a shadow.
 */
export function illustrationShadow(): string {
  return scheme === "dark" ? "rgba(0,0,0,0.42)" : "rgba(26,66,61,0.16)";
}
