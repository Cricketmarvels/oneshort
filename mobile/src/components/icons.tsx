/**
 * GoFindr icon system.
 * - PlayRIcon: one consistent family (Tabler, MIT) for navigation + utility icons; outline + filled variants.
 * - SportsActionIcon: original two-tone cricket pictograms (drawn for GoFindr, no third-party artwork) for the
 *   primary sports actions, so they don't read as generic outline icons.
 * Sizes: action 36–42 · bottom nav 24 · utility 20–22. Default colour = primary teal.
 */
import {
  IconAdjustmentsHorizontal, IconArrowRight, IconBell, IconBellFilled, IconBookmark, IconBookmarkFilled, IconCalendar, IconCalendarPlus,
  IconCamera, IconChartLine, IconChevronDown, IconClock, IconCompass, IconCompassFilled, IconCricket, IconCurrencyRupee, IconExternalLink,
  IconHome, IconHomeFilled, IconLink, IconMapPin, IconMapPinFilled, IconMessage, IconPhoto, IconPlus, IconSearch, IconSettings, IconShield,
  IconStar, IconStarFilled, IconTrophy, IconUser, IconUserFilled, IconUsers, IconArrowLeft, IconChevronRight, IconUserPlus, IconReceipt,
  IconBuildingStadium, IconBolt, IconCopy, IconHandStop, IconArrowsShuffle, IconBallBaseball, IconCalendarWeek,
} from "@tabler/icons-react-native";
import type { ComponentType } from "react";
import Svg, { Circle, Ellipse, G, Line, Path, Rect } from "react-native-svg";

import { T } from "@/theme";

type TablerIcon = ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
/** name → [outline, filled?] (Tabler, MIT). */
const MAP: Record<PlayRIconName, [TablerIcon, TablerIcon?]> = {
  home: [IconHome, IconHomeFilled], discover: [IconCompass, IconCompassFilled], plus: [IconPlus], community: [IconUsers], profile: [IconUser, IconUserFilled],
  bell: [IconBell, IconBellFilled], pin: [IconMapPin, IconMapPinFilled], caret: [IconChevronDown], calendar: [IconCalendar], calendarPlus: [IconCalendarPlus],
  clock: [IconClock], arrow: [IconArrowRight], search: [IconSearch], filters: [IconAdjustmentsHorizontal], bookmark: [IconBookmark, IconBookmarkFilled],
  chat: [IconMessage], trophy: [IconTrophy], shield: [IconShield], cricket: [IconCricket], rupee: [IconCurrencyRupee], external: [IconExternalLink],
  stats: [IconChartLine], link: [IconLink], settings: [IconSettings], star: [IconStar, IconStarFilled], camera: [IconCamera], photo: [IconPhoto],
  back: [IconArrowLeft], chevronRight: [IconChevronRight], userPlus: [IconUserPlus], users: [IconUsers], receipt: [IconReceipt],
  stadium: [IconBuildingStadium], bolt: [IconBolt], copy: [IconCopy], glove: [IconHandStop], shuffle: [IconArrowsShuffle],
  ball: [IconBallBaseball], week: [IconCalendarWeek],
};
export type PlayRIconName = "home" | "discover" | "plus" | "community" | "profile" | "bell" | "pin" | "caret" | "calendar" | "calendarPlus" | "clock"
  | "arrow" | "search" | "filters" | "bookmark" | "chat" | "trophy" | "shield" | "cricket" | "rupee" | "external" | "stats" | "link" | "settings"
  | "star" | "camera" | "photo" | "back" | "chevronRight" | "userPlus" | "users" | "receipt" | "stadium" | "bolt" | "copy" | "glove"
  | "shuffle" | "ball" | "week";
export type IconWeight = "regular" | "bold" | "fill" | "duotone" | "light" | "thin";

/** Functional icon (Tabler). Nav 24 · utility 20. "fill" uses Tabler's filled variant when one exists. */
export function PlayRIcon({ name, size = 20, color, weight = "regular" }: { name: PlayRIconName; size?: number; color?: string; weight?: IconWeight }) {
  const [Outline, Filled] = MAP[name];
  const C = weight === "fill" && Filled ? Filled : Outline;
  const sw = weight === "bold" ? 2.3 : weight === "light" || weight === "thin" ? 1.4 : 1.8;
  return <C size={size} color={color ?? T.primary} strokeWidth={sw} />;
}

// ---------------------------------------------------------------- sports pictograms (48×48 grid)
export type SportsAction = "findPlayers" | "findTeams" | "bookGround" | "splitFees" | "createMatch" | "manageTeam" | "challenge";

/** Two-tone pictogram: solid strokes in `color`, soft tone fill at ~22% (or a supplied `tone`). */
export function SportsActionIcon({ action, size = 40, color, tone, inverse }: { action: SportsAction; size?: number; color?: string; tone?: string; inverse?: boolean }) {
  const c = color ?? (inverse ? "#FFFFFF" : T.primary);
  const t = tone ?? c;
  const to = inverse ? 0.22 : 0.2;
  const sw = 2.6;
  const common = { stroke: c, strokeWidth: sw, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {action === "findPlayers" ? (
        <G>
          {/* batter in stance + discovery lens */}
          <Circle cx={17} cy={12} r={5.2} fill={t} fillOpacity={to} {...common} />
          <Path d="M11.5 11.2 H22.5" {...common} />
          <Path d="M8 41 C8 30 11.5 22.5 17 22.5 C22.5 22.5 26 30 26 41" fill={t} fillOpacity={to} {...common} />
          <Path d="M21.5 23.5 L24.6 25.6" {...common} strokeWidth={2.2} />
          <Path d="M24 25.2 L27.2 23.4 L36.2 38.6 L32.6 40.8 Z" fill={t} fillOpacity={to + 0.2} {...common} strokeWidth={2.2} />
          <Circle cx={35} cy={14} r={6.5} fill={t} fillOpacity={to} {...common} />
          <Path d="M39.8 18.8 L43.5 22.5" {...common} />
        </G>
      ) : action === "findTeams" ? (
        <G>
          {/* squad of three helmets with a team shield */}
          <Circle cx={11} cy={17} r={4.4} fill={t} fillOpacity={to} {...common} />
          <Circle cx={37} cy={17} r={4.4} fill={t} fillOpacity={to} {...common} />
          <Path d="M3.5 36 C3.5 28.5 6.5 24.5 11 24.5 C13.6 24.5 15.4 25.6 16.6 27.4" {...common} />
          <Path d="M44.5 36 C44.5 28.5 41.5 24.5 37 24.5 C34.4 24.5 32.6 25.6 31.4 27.4" {...common} />
          <Circle cx={24} cy={13} r={5.6} fill={t} fillOpacity={to} {...common} />
          <Path d="M18 12.2 H30" {...common} />
          <Path d="M15.5 33.5 C15.5 25.5 19 21 24 21 C29 21 32.5 25.5 32.5 33.5" {...common} />
          <Path d="M19 31 H29 V38 C29 41.5 26.5 43.5 24 44.5 C21.5 43.5 19 41.5 19 38 Z" fill={t} fillOpacity={to + 0.15} {...common} />
        </G>
      ) : action === "bookGround" ? (
        <G>
          {/* oval ground with pitch, stumps and floodlights */}
          <Ellipse cx={24} cy={30} rx={20} ry={12.5} fill={t} fillOpacity={to} {...common} />
          <Ellipse cx={24} cy={30} rx={12.5} ry={7.2} {...common} strokeWidth={1.8} strokeDasharray="2.5 3" />
          <Rect x={21} y={24} width={6} height={12} rx={1.2} fill={t} fillOpacity={to + 0.25} {...common} strokeWidth={2} />
          <Path d="M22.6 24 V21 M24 24 V21 M25.4 24 V21" {...common} strokeWidth={1.6} />
          <Path d="M7 19 V7 M41 19 V7" {...common} />
          <Rect x={4} y={4} width={6} height={4} rx={1.2} fill={c} />
          <Rect x={38} y={4} width={6} height={4} rx={1.2} fill={c} />
        </G>
      ) : action === "splitFees" ? (
        <G>
          {/* rupee coin splitting into shares */}
          <Circle cx={19} cy={24} r={14} fill={t} fillOpacity={to} {...common} />
          <Path d="M13 16.5 H25.5 M13 21 H25.5 M15.5 16.5 C22.5 16.5 22.5 25.5 15.5 25.5 H14 L23 32" {...common} />
          <Path d="M34 18 L40 13 M34 30 L40 35" {...common} />
          <Circle cx={42} cy={11.5} r={3.4} fill={t} fillOpacity={to + 0.2} {...common} strokeWidth={2.2} />
          <Circle cx={42} cy={36.5} r={3.4} fill={t} fillOpacity={to + 0.2} {...common} strokeWidth={2.2} />
        </G>
      ) : action === "createMatch" ? (
        <G>
          {/* fixture card with ball + plus */}
          <Rect x={5} y={9} width={30} height={30} rx={6} fill={t} fillOpacity={to} {...common} />
          <Path d="M5 17 H35 M13 5.5 V12 M27 5.5 V12" {...common} />
          <Circle cx={20} cy={28} r={5.5} {...common} strokeWidth={2.2} />
          <Path d="M16.3 24.5 C18.5 26.5 18.5 29.5 16.3 31.5 M23.7 24.5 C21.5 26.5 21.5 29.5 23.7 31.5" {...common} strokeWidth={1.4} />
          <Circle cx={38} cy={36} r={7.5} fill={c} />
          <Path d="M38 32.2 V39.8 M34.2 36 H41.8" stroke={inverse ? T.heroInk : "#FFFFFF"} strokeWidth={2.4} strokeLinecap="round" />
        </G>
      ) : action === "manageTeam" ? (
        <G>
          {/* captain's armband shield with C */}
          <Path d="M24 4.5 L39.5 10 V22.5 C39.5 32.5 32.5 40 24 43.5 C15.5 40 8.5 32.5 8.5 22.5 V10 Z" fill={t} fillOpacity={to} {...common} />
          <Path d="M29.5 18.5 C28 16.5 26 15.5 24 15.5 C19.8 15.5 17 18.8 17 23 C17 27.2 19.8 30.5 24 30.5 C26 30.5 28 29.5 29.5 27.5" {...common} strokeWidth={3} />
        </G>
      ) : (
        <G>
          {/* challenge: two bats crossed over a ball */}
          <Line x1={9} y1={39} x2={33} y2={11} {...common} strokeWidth={4.2} />
          <Line x1={39} y1={39} x2={15} y2={11} {...common} strokeWidth={4.2} />
          <Path d="M33 11 L37 6.5 M15 11 L11 6.5" {...common} strokeWidth={2.2} />
          <Circle cx={24} cy={36.5} r={6.5} fill={t} fillOpacity={to + 0.25} {...common} />
        </G>
      )}
    </Svg>
  );
}
