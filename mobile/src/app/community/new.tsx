import type { S } from "@cm/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, ScrollView, Switch, View } from "react-native";

import { Button, Chip, Field, Section, Txt } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { PLACES, useLocation } from "@/lib/location";
import type { Community } from "@/lib/types";
import { SP, T } from "@/theme";

const KINDS: { v: S<"CommunityKind">; l: string }[] = [
  { v: "locality", l: "Locality" }, { v: "sector", l: "Sector" }, { v: "city", l: "City" }, { v: "interest", l: "Interest" },
  { v: "corporate", l: "Corporate" }, { v: "weekend", l: "Weekend" }, { v: "competitive", l: "Competitive" },
];

export default function NewCommunity() {
  const loc = useLocation();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [guidelines, setGuidelines] = useState("Be on time. Respect umpires, grounds and each other. Settle match fees promptly. No abuse or spam.");
  const [kind, setKind] = useState<S<"CommunityKind">>("locality");
  const [isPrivate, setPrivate] = useState(false);
  const [place, setPlace] = useState(PLACES.find((p) => p.label === loc.label) ?? PLACES[0]!);
  const [area, setArea] = useState("");
  const create = useMutation({
    mutationFn: () => api<Community>("/communities", { method: "POST", body: {
      name, description: description || null, kind, visibility: isPrivate ? "private" : "public", city: place.city, area: area || place.label.split(",")[0],
      location: { lat: place.lat, lng: place.lng }, guidelines: guidelines || null,
    } }),
    onSuccess: (c) => { void qc.invalidateQueries({ queryKey: ["communities"] }); router.replace({ pathname: "/community/[id]", params: { id: c.id } }); },
    onError: (e) => Alert.alert("Couldn't create community", errorText(e)),
  });
  return (
    <ScrollView contentContainerStyle={{ padding: SP.page, gap: SP.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
      <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Sector 137 Cricket" maxLength={60} />
      <Section title="Type">
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{KINDS.map((k) => <Chip key={k.v} label={k.l} active={kind === k.v} onPress={() => setKind(k.v)} />)}</View>
      </Section>
      <Section title="Where">
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{PLACES.map((p) => <Chip key={p.label} label={p.label} active={place.label === p.label} onPress={() => setPlace(p)} />)}</View>
        <Field label="Area shown publicly (optional)" value={area} onChangeText={setArea} placeholder={place.label.split(",")[0]} />
      </Section>
      <Field label="About" value={description} onChangeText={setDescription} multiline placeholder="Who is this for? When do you play?" style={{ minHeight: 90, paddingTop: 12, textAlignVertical: "top" }} />
      <Field label="Community guidelines" value={guidelines} onChangeText={setGuidelines} multiline style={{ minHeight: 90, paddingTop: 12, textAlignVertical: "top" }} hint="Members accept these when they join." />
      <View style={{ flexDirection: "row", alignItems: "center", gap: SP.md, padding: SP.lg, borderRadius: 16, backgroundColor: T.white }}>
        <View style={{ flex: 1 }}>
          <Txt v="h3">Private community</Txt>
          <Txt v="small" color={T.muted}>Anyone can find it, but only approved members see the feed and members.</Txt>
        </View>
        <Switch value={isPrivate} onValueChange={setPrivate} trackColor={{ true: T.accent, false: T.switchOff }} thumbColor={T.surface} {...({ activeThumbColor: T.surface, activeTrackColor: T.accent } as object)} accessibilityLabel="Private community" />
      </View>
      <Button title="Create community" size="lg" disabled={name.trim().length < 3} loading={create.isPending} onPress={() => create.mutate()} />
      <Txt v="small" color={T.muted}>You'll be the owner. You can appoint admins and moderators to help run it.</Txt>
    </ScrollView>
  );
}
