import type { S } from "@cm/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, ScrollView, Switch, View } from "react-native";

import { Button, Chip, Field, Section, Txt } from "@/components/ui";
import { CricHeroesField, cricHeroesError } from "@/components/cricheroes-link";
import { api, errorText } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { FORMATS } from "@/lib/format";
import { PLACES, useLocation } from "@/lib/location";
import type { FixtureFormat } from "@/lib/types";
import { SP, T } from "@/theme";

const CATS: { v: S<"MatchCategory">; l: string }[] = [{ v: "friendly", l: "Friendly" }, { v: "corporate", l: "Corporate" }, { v: "tournament", l: "Tournament" }, { v: "practice", l: "Practice" }];

export default function NewTeam() {
  const { reload } = useAuth();
  const qc = useQueryClient();
  const loc = useLocation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [place, setPlace] = useState(PLACES.find((p) => p.label === loc.label) ?? PLACES[1]!);
  const [area, setArea] = useState(place.label.split(",")[0]!);
  const [category, setCategory] = useState<S<"MatchCategory">>("friendly");
  const [looking, setLooking] = useState(true);
  const [formats, setFormats] = useState<FixtureFormat[]>(["T20"]);
  const [chUrl, setChUrl] = useState("");
  const create = useMutation({
    mutationFn: () => api<S<"TeamOut">>("/teams", { method: "POST", body: {
      team_name: name, description: description || null, area, city: place.city, category, location: { lat: place.lat, lng: place.lng },
      looking_for_opponents: looking, preferred_formats: formats, cricheroes_team_url: chUrl.trim() || null,
    } satisfies S<"TeamIn"> }),
    onSuccess: async (t) => { await reload(); void qc.invalidateQueries(); router.replace({ pathname: "/team/[id]", params: { id: t.id } }); },
    onError: (e) => Alert.alert("Couldn't create team", errorText(e)),
  });
  return (
    <ScrollView contentContainerStyle={{ padding: SP.page, gap: SP.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
      <Txt v="small" color={T.muted}>You'll be the captain. You can appoint a vice-captain from the team dashboard.</Txt>
      <Field label="Team name" value={name} onChangeText={setName} placeholder="e.g. Sector 50 Strikers" maxLength={60} />
      <Section title="Home ground area">
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{PLACES.map((p) => <Chip key={p.label} label={p.label} active={place.label === p.label} onPress={() => { setPlace(p); setArea(p.label.split(",")[0]!); }} />)}</View>
        <Field label="Area shown publicly" value={area} onChangeText={setArea} />
      </Section>
      <Section title="Type"><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{CATS.map((c) => <Chip key={c.v} label={c.l} active={category === c.v} onPress={() => setCategory(c.v)} />)}</View></Section>
      <Section title="Formats you play">
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {FORMATS.map((f) => <Chip key={f.v} label={f.l} active={formats.includes(f.v)} onPress={() => setFormats(formats.includes(f.v) ? formats.filter((x) => x !== f.v) : [...formats, f.v])} />)}
        </View>
      </Section>
      <Field label="About the team (optional)" value={description} onChangeText={setDescription} multiline style={{ minHeight: 90, paddingTop: 12, textAlignVertical: "top" }} />
      <CricHeroesField kind="team" value={chUrl} onChange={setChUrl} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: SP.md, padding: SP.lg, borderRadius: 16, backgroundColor: T.white }}>
        <View style={{ flex: 1 }}><Txt v="h3">Open to challenges</Txt><Txt v="small" color={T.muted}>Show up when nearby captains look for opponents.</Txt></View>
        <Switch value={looking} onValueChange={setLooking} trackColor={{ true: T.accent, false: T.switchOff }} thumbColor={T.surface} {...({ activeThumbColor: T.surface, activeTrackColor: T.accent } as object)} accessibilityLabel="Open to challenges" />
      </View>
      <Button title="Create team" size="lg" disabled={name.trim().length < 2 || !area.trim() || !!cricHeroesError(chUrl, "team")} loading={create.isPending} onPress={() => create.mutate()} />
    </ScrollView>
  );
}
