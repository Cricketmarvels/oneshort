/**
 * One raised 3D action card: floating illustration, one bold title, one circular arrow.
 *
 * Three layers, as in the reference: (A) an ambient shadow that lifts the card off the canvas,
 * (B) the pastel surface with a lit upper rim and a darker extruded bottom edge, (C) the 3D
 * illustration floating over its own soft contact shadow. The whole card is a single Pressable —
 * the arrow is a visual affordance, never a nested control.
 */
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { memo } from "react";
import { PixelRatio, Pressable, View, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from "react-native-reanimated";

import { CARD, cardShadow, illustrationShadow, toneSkin, type CardTone } from "@/components/dashboard/cardTokens";
import { PlayRIcon, SportsActionIcon, type SportsAction } from "@/components/icons";
import { ARTWORK } from "@/components/media";
import { Txt } from "@/components/ui";
import { FW, shadow, T } from "@/theme";

export type ActionCard = {
  /** Picks the 3D illustration from the shared ARTWORK registry. */
  action: SportsAction;
  title: string;
  tone: CardTone;
  onPress: () => void;
};

const SPRING = { damping: 18, stiffness: 260 } as const;

export const ThreeDActionCard = memo(function ThreeDActionCard({ action, title, tone, onPress }: ActionCard) {
  const skin = toneSkin(tone);
  const base = cardShadow();
  const baseOpacity = typeof base.shadowOpacity === "number" ? base.shadowOpacity : 0.16;
  const baseElevation = typeof base.elevation === "number" ? base.elevation : 0;
  const reduced = useReducedMotion();
  const press = useSharedValue(0);
  const art = ARTWORK[action];

  // Enlarged text needs more room than a fixed aspect ratio can give: fall back to a tall minimum.
  const fontScale = PixelRatio.getFontScale();
  const box: ViewStyle = fontScale > 1.3 ? { minHeight: CARD.minHeight * Math.min(fontScale, 1.8) } : { aspectRatio: CARD.aspect, minHeight: CARD.minHeight };

  const lift = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - (1 - CARD.pressScale) * press.value }, { translateY: CARD.pressDrop * press.value }],
    shadowOpacity: baseOpacity * (1 - 0.4 * press.value),
    elevation: baseElevation * (1 - 0.4 * press.value),
  }));

  const set = (to: number) => { press.value = reduced ? to : withSpring(to, SPRING); };

  return (
    <Animated.View style={[{ flex: 1, borderRadius: CARD.radius }, base, lift]}>
      <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress}
        onPressIn={() => set(1)} onPressOut={() => set(0)} style={[{ borderRadius: CARD.radius }, box]}>
        {/* Layer B — extruded bottom edge, revealed below the surface */}
        <View style={{ position: "absolute", left: 0, right: 0, top: CARD.extrusion, bottom: -CARD.extrusion, borderRadius: CARD.radius, backgroundColor: skin.edge }} />

        {/* Layer B — raised pastel surface */}
        <LinearGradient colors={skin.surface} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={{ flex: 1, borderRadius: CARD.radius, borderWidth: 1, borderColor: skin.rim, padding: CARD.padding, justifyContent: "space-between", overflow: "hidden" }}>

          {/* Layer C — floating illustration over its own contact shadow */}
          <View style={{ flex: 1, minHeight: 84, alignItems: "center", justifyContent: "center" }}>
            <LinearGradient colors={["transparent", illustrationShadow(), "transparent"]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}
              style={{ position: "absolute", bottom: 6, width: "62%", height: 9, borderRadius: 999 }} />
            {art ? (
              <Image source={art} style={{ width: "74%", height: "100%", maxHeight: 100 }} contentFit="contain" cachePolicy="memory-disk"
                priority="high" transition={140} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
            ) : (
              <SportsActionIcon action={action} size={62} />
            )}
          </View>

          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 10 }}>
            <Txt numberOfLines={2} style={{ flex: 1, ...FW.heading, fontSize: 17.5, lineHeight: 21, letterSpacing: -0.4, color: T.tileTitle }}>{title}</Txt>
            <View style={{ width: CARD.arrow, height: CARD.arrow, borderRadius: CARD.arrow / 2, backgroundColor: T.surface, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: skin.rim, ...shadow(2) }}>
              <PlayRIcon name="arrow" size={21} color={T.primaryDark} weight="bold" />
            </View>
          </View>
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
});
