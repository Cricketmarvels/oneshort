/** Create (starter v2 centre tab): one place to start a match, team, request, challenge, post or fee split. Role-aware. */
import { router } from "expo-router";
import { View } from "react-native";

import { H, LinkCard, SectionRow, StarterScreen } from "@/components/starter";
import { Txt } from "@/components/ui";
import { useHomeContext } from "@/lib/context";
import { useHome } from "@/lib/hooks";
import { T } from "@/theme";

export default function Create() {
  const home = useHome();
  const team = home.data?.managed_team_ids[0];
  const ctx = useHomeContext((s) => s.ctx);
  const captain = !!team && ctx !== "player";
  return (
    <StarterScreen safeTop>
      <H title="Create" sub={captain ? "Organise your next game" : "Start something with your local players"} />
      <View style={{ gap: 12 }}>
        <SectionRow title={captain ? "For your team" : "Play"} />
        <LinkCard icon="calendarPlus" title="Create a match" sub="Date, venue, format, squad size and a fee estimate" onPress={() => router.push(team ? { pathname: "/match/new", params: { team } } : "/match/new")} />
        <LinkCard icon="search" title="Find players for a match" sub="Pick roles and a time — only available players show up" onPress={() => router.push("/match/players")} />
        {team ? <LinkCard icon="trophy" title="Challenge a team" sub="Propose a date, venue and format" onPress={() => router.push({ pathname: "/challenge/new", params: { from: team } })} /> : null}
        <LinkCard icon="shield" title={team ? "Create another team" : "Create a team"} sub="You become the captain" onPress={() => router.push("/team/new")} />
      </View>
      <View style={{ gap: 12 }}>
        <SectionRow title="Community & fees" />
        <LinkCard icon="chat" title="Post in your community" sub="Match moments, player requests, announcements" onPress={() => router.push("/community")} />
        <LinkCard icon="community" title="Start a community" sub="For your sector, society or office" onPress={() => router.push("/community/new")} />
        <LinkCard icon="receipt" title="Split a match fee" sub="Track who has paid — payments happen outside PlayR" onPress={() => router.push("/payments")} />
      </View>
      <Txt v="small" color={T.muted}>Matches and teams are saved to your account. A join request isn't a confirmed spot until the captain accepts.</Txt>
    </StarterScreen>
  );
}
