/**
 * Full-width "banner" action card for the captain home: title and subtitle on the left, a shaded sports
 * illustration on the right, a small round arrow, on a light "aurora" mesh gradient (a soft base plus three
 * glows: white light top left, the card's colour top right, a deeper tone bottom left).
 *
 * Presentation only: the parent supplies the copy, artwork, colours and onPress (navigation lives in
 * dashboardActions). The whole card is one accessible button; the arrow is decoration inside it.
 */
import { Image, type ImageSource } from "expo-image";
import { memo } from "react";
import { PixelRatio, Pressable, StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from "react-native-reanimated";
import Svg, { Defs, Ellipse, LinearGradient, RadialGradient, Rect, Stop } from "react-native-svg";

import { PlayRIcon } from "@/components/icons";
import { Txt } from "@/components/ui";
import { FW } from "@/theme";

export type AuroraColors = {
  /** Base wash, top → bottom. */
  base: readonly [string, string];
  /** Glow in the top-right corner. */
  glow: string;
  /** Deeper glow along the bottom left. */
  deep: string;
  /** Arrow colour. */
  accent: string;
};

export type SportsIllustrationCardProps = {
  title: string;
  subtitle: string;
  illustration: ImageSource | number;
  colors: AuroraColors;
  onPress: () => void;
  testID?: string;
};

const HEIGHT = 104;
const RADIUS = 24;
const ARROW = 36;
const TITLE = "#102C28";
const SUBTITLE = "#3D5652";
const SPRING = { damping: 18, stiffness: 260 } as const;
const SHADOW = { shadowColor: "#183B35", shadowOffset: { width: 0, height: 7 }, shadowOpacity: 0.13, shadowRadius: 12, elevation: 5 } as const;

function Glow({ id, color }: { id: string; color: string }) {
  return (
    <RadialGradient id={id} cx="50%" cy="50%" r="50%" gradientUnits="objectBoundingBox">
      <Stop offset="0" stopColor={color} stopOpacity={1} />
      <Stop offset="1" stopColor={color} stopOpacity={0} />
    </RadialGradient>
  );
}

/** The aurora mesh (base wash plus three glows) as an absolutely filled background. Shared with other home cards. */
export function AuroraBackground({ id: g, colors }: { id: string; colors: Pick<AuroraColors, "base" | "glow" | "deep"> }) {
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
      <Defs>
        <LinearGradient id={`${g}-base`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={colors.base[0]} />
          <Stop offset="1" stopColor={colors.base[1]} />
        </LinearGradient>
        <Glow id={`${g}-light`} color="#FFFFFF" />
        <Glow id={`${g}-glow`} color={colors.glow} />
        <Glow id={`${g}-deep`} color={colors.deep} />
      </Defs>
      <Rect x="0" y="0" width="100" height="100" fill={`url(#${g}-base)`} />
      <Ellipse cx="92" cy="30" rx="70" ry="60" fill={`url(#${g}-glow)`} />
      <Ellipse cx="20" cy="100" rx="80" ry="70" fill={`url(#${g}-deep)`} />
      <Ellipse cx="18" cy="12" rx="60" ry="55" fill={`url(#${g}-light)`} />
    </Svg>
  );
}

export const SportsIllustrationCard = memo(function SportsIllustrationCard({ title, subtitle, illustration, colors, onPress, testID }: SportsIllustrationCardProps) {
  const reduced = useReducedMotion();
  const press = useSharedValue(0);
  // Big system text: let the card grow instead of clipping the title.
  const big = PixelRatio.getFontScale() > 1.3;
  const g = `sic-${testID ?? title.replace(/\W+/g, "")}`;

  const lift = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - 0.03 * press.value }],
    shadowOpacity: SHADOW.shadowOpacity * (1 - 0.45 * press.value),
    elevation: SHADOW.elevation * (1 - 0.45 * press.value),
  }));
  const set = (to: number) => { press.value = reduced ? to : withSpring(to, SPRING); };

  return (
    <Animated.View style={[{ borderRadius: RADIUS }, SHADOW, lift]}>
      <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={`${title}. ${subtitle}`} onPress={onPress}
        onPressIn={() => set(1)} onPressOut={() => set(0)}
        style={{ borderRadius: RADIUS, overflow: "hidden", flexDirection: "row", alignItems: "stretch", ...(big ? { minHeight: HEIGHT } : { height: HEIGHT }) }}>
        <AuroraBackground id={g} colors={colors} />
        {/* lit top rim and a slightly deeper bottom edge, for a gentle raised feel */}
        <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, height: 1, backgroundColor: "rgba(255,255,255,0.75)" }} />
        <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 3, backgroundColor: "rgba(24,59,53,0.06)" }} />

        <View style={{ flex: 1, minWidth: 0, justifyContent: "center", paddingVertical: 14, paddingLeft: 18, paddingRight: 4, gap: 2 }}>
          <Txt style={{ ...FW.display, fontSize: 18, lineHeight: 22, letterSpacing: -0.2, color: TITLE }} numberOfLines={2}>{title}</Txt>
          <Txt style={{ ...FW.medium, fontSize: 12.5, lineHeight: 16, color: SUBTITLE }} numberOfLines={2}>{subtitle}</Txt>
        </View>
        <View style={{ width: "52%", justifyContent: "center" }} aria-hidden>
          <Image source={illustration} style={{ width: "100%", height: big ? HEIGHT : "100%" }} contentFit="contain" cachePolicy="memory-disk" priority="high" transition={120} />
        </View>
        <View pointerEvents="none" style={{ position: "absolute", right: 12, top: "50%", marginTop: -ARROW / 2, width: ARROW, height: ARROW, borderRadius: ARROW / 2,
          backgroundColor: "rgba(255,255,255,0.92)", alignItems: "center", justifyContent: "center",
          shadowColor: "#183B35", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.14, shadowRadius: 6, elevation: 2 }}>
          <PlayRIcon name="chevronRight" size={18} color={colors.accent} weight="bold" />
        </View>
      </Pressable>
    </Animated.View>
  );
});
