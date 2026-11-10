import { parseRosterText, parseStatsText, relativeTime, type S } from "@cm/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { useState } from "react";
import { Alert, Linking, Modal, Pressable, ScrollView, Text, View } from "react-native";

import { Badge, Button, C, Card, Empty, ErrorBox, Field, H2, Loading, Muted, s } from "@/components/ui";
import { api, errorText } from "@/lib/api";

type Profile = S<"CricHeroesProfileOut">;
type Snapshot = NonNullable<Profile["snapshot"]>;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** Only open links the server already sanitised to CricHeroes https hosts. */
const open = (url: string | null | undefined) => { if (url?.startsWith("https://")) void Linking.openURL(url); };

export function CricHeroesSection({ teamId }: { teamId: string }) {
  const key = ["team", teamId, "cricheroes"];
  const qc = useQueryClient();
  const q = useQuery({ queryKey: key, queryFn: () => api<Profile>(`/teams/${teamId}/cricheroes`) });
  const [sheet, setSheet] = useState<"link" | "import" | null>(null);
  const done = (msg: string) => { void qc.invalidateQueries({ queryKey: key }); setSheet(null); Alert.alert(msg); };
  const remove = useMutation({
    mutationFn: () => api(`/teams/${teamId}/cricheroes`, { method: "DELETE" }),
    onSuccess: () => done("CricHeroes data removed"), onError: (e) => Alert.alert("Couldn't remove", errorText(e)),
  });
  const sync = useMutation({
    mutationFn: () => api<Profile>(`/teams/${teamId}/cricheroes/sync`, { method: "POST", body: {} }),
    onSuccess: () => done("Synced from CricHeroes"), onError: (e) => Alert.alert("Sync unavailable", errorText(e)),
  });

  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => void q.refetch()} />;
  const p = q.data;
  return (
    <View style={{ gap: 10 }}>
      <H2>CricHeroes</H2>
      {p.link && (
        <Pressable accessibilityRole="link" onPress={() => open(p.link?.url)}>
          <Text style={{ color: C.brand, fontWeight: "700" }}>View team #{p.link.external_team_id} on CricHeroes ↗</Text>
        </Pressable>
      )}
      {p.can_manage && (
        <View style={{ gap: 8 }}>
          <View style={[s.row, { flexWrap: "wrap" }]}>
            <Button variant="secondary" title={p.link ? "Change link" : "Link CricHeroes team"} onPress={() => setSheet("link")} style={{ flexGrow: 1 }} />
            <Button variant="secondary" title={p.snapshot ? "Update data" : "Import data"} onPress={() => setSheet("import")} style={{ flexGrow: 1 }} />
          </View>
          {p.auto_sync_available && p.link ? <Button variant="ghost" title="Sync now" loading={sync.isPending} onPress={() => sync.mutate()} /> : null}
          {!p.auto_sync_available && p.auto_sync_note ? <Text style={{ color: C.muted, fontSize: 12 }}>{p.auto_sync_note}</Text> : null}
        </View>
      )}
      {p.snapshot ? <SnapshotView snap={p.snapshot} /> : (
        <Empty title="No CricHeroes data yet" body={p.can_manage ? "Link your CricHeroes team and add its players and stats." : "This team hasn't added its CricHeroes record."} />
      )}
      {p.can_manage && (p.link || p.snapshot) ? (
        <Button variant="ghost" title="Remove CricHeroes data" onPress={() => Alert.alert("Remove CricHeroes data?", "The link and imported data will be deleted.", [
          { text: "Cancel", style: "cancel" }, { text: "Remove", style: "destructive", onPress: () => remove.mutate() },
        ])} />
      ) : null}
      <LinkModal visible={sheet === "link"} teamId={teamId} current={p.link?.url} onClose={() => setSheet(null)} onDone={() => done("CricHeroes team linked")} />
      <ImportModal visible={sheet === "import"} teamId={teamId} onClose={() => setSheet(null)} onDone={() => done("CricHeroes data saved")} />
    </View>
  );
}

function SnapshotView({ snap }: { snap: Snapshot }) {
  const boards = (["batting", "bowling", "fielding"] as const).filter((k) => snap.leaderboard[k].length);
  return (
    <View style={{ gap: 10 }}>
      {snap.stats.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {snap.stats.map((st) => (
            <View key={st.label} style={{ backgroundColor: C.brandSoft, borderRadius: 14, padding: 10, minWidth: "30%", flexGrow: 1 }}>
              <Text style={{ fontSize: 11, color: C.muted, fontWeight: "600", textTransform: "uppercase" }}>{st.label}</Text>
              <Text style={{ fontSize: 18, fontWeight: "800", color: C.brandDark }}>{st.value}</Text>
            </View>
          ))}
        </View>
      )}
      {snap.players.length > 0 && (
        <Card>
          <Text style={{ fontWeight: "700" }}>Squad on CricHeroes ({snap.players.length})</Text>
          {snap.players.map((pl, i) => (
            <Pressable key={`${pl.name}-${i}`} disabled={!pl.profile_url} onPress={() => open(pl.profile_url)} style={[s.row, { paddingVertical: 4 }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: "600" }}>{pl.name}</Text>
                {pl.role ? <Muted>{pl.role}</Muted> : null}
              </View>
              {pl.member_user_id ? <Badge status="success" label="On GoFindr" /> : null}
            </Pressable>
          ))}
        </Card>
      )}
      {boards.map((k) => (
        <Card key={k}>
          <Text style={{ fontWeight: "700", textTransform: "capitalize" }}>{k} leaders</Text>
          {snap.leaderboard[k].slice(0, 5).map((e, i) => (
            <View key={`${e.player_name}-${i}`} style={s.row}><Text style={{ flex: 1 }}>{i + 1}. {e.player_name}</Text><Text style={{ fontWeight: "700" }}>{e.stat}</Text></View>
          ))}
        </Card>
      ))}
      {snap.matches.length > 0 && (
        <Card>
          <Text style={{ fontWeight: "700" }}>Recent matches</Text>
          {snap.matches.slice(0, 5).map((m, i) => (
            <Pressable key={i} disabled={!m.url} onPress={() => open(m.url)} style={{ paddingVertical: 4, gap: 2 }}>
              <Text style={{ fontWeight: "600" }}>{m.result ?? "Result not recorded"}</Text>
              {m.score.length ? <Muted>{m.score.join(" · ")}</Muted> : null}
              <Text style={{ fontSize: 12, color: C.muted }}>{[m.played_on, m.tournament, m.venue].filter(Boolean).join(" · ")}</Text>
            </Pressable>
          ))}
        </Card>
      )}
      <Text style={{ fontSize: 12, color: C.muted }}>
        {snap.method === "manual" ? "Entered manually" : snap.method === "sync" ? "Synced" : "Imported from file"} {relativeTime(snap.imported_at)}
        {snap.imported_by ? ` by ${snap.imported_by.full_name}` : ""}. Provided by the team; not verified by GoFindr.
      </Text>
    </View>
  );
}

function Sheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ScrollView contentContainerStyle={[s.scroll, { backgroundColor: C.sand, flexGrow: 1 }]} keyboardShouldPersistTaps="handled">
        <View style={s.row}><Text style={[s.h2, { flex: 1, marginTop: 0 }]}>{title}</Text><Button variant="ghost" title="Close" onPress={onClose} /></View>
        {children}
      </ScrollView>
    </Modal>
  );
}

function LinkModal({ visible, teamId, current, onClose, onDone }: { visible: boolean; teamId: string; current?: string; onClose: () => void; onDone: () => void }) {
  const [url, setUrl] = useState(current ?? "");
  const m = useMutation({
    mutationFn: () => api<Profile>(`/teams/${teamId}/cricheroes/link`, { method: "PUT", body: { url } }),
    onSuccess: onDone, onError: (e) => Alert.alert("Couldn't link", errorText(e)),
  });
  return (
    <Sheet visible={visible} title="Link CricHeroes team" onClose={onClose}>
      <Muted>Open your team in the CricHeroes app, tap Share, copy the link and paste it here.</Muted>
      <Field label="CricHeroes team link" value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://cricheroes.com/team-profile/123456/your-team" />
      <Button title="Save link" disabled={url.trim().length < 3} loading={m.isPending} onPress={() => m.mutate()} />
    </Sheet>
  );
}

function ImportModal({ visible, teamId, onClose, onDone }: { visible: boolean; teamId: string; onClose: () => void; onDone: () => void }) {
  const [roster, setRoster] = useState("");
  const [stats, setStats] = useState("");
  const players = parseRosterText(roster);
  const statRows = parseStatsText(stats);
  const save = useMutation({
    mutationFn: (b: S<"CricHeroesImportIn">) => api<Profile>(`/teams/${teamId}/cricheroes/import`, { method: "POST", body: b }),
    onSuccess: onDone, onError: (e) => Alert.alert("Couldn't save", errorText(e)),
  });
  const pickFile = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: ["application/json", "text/plain", "*/*"], copyToCacheDirectory: true });
    const asset = res.canceled ? null : res.assets[0];
    if (!asset) return;
    if ((asset.size ?? 0) > MAX_FILE_BYTES) return Alert.alert("File too large", "Choose a file under 2 MB.");
    try {
      const parsed: unknown = JSON.parse(await new File(asset.uri).text());
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      save.mutate({ method: "file", data: parsed as S<"CricHeroesSnapshotIn"> });
    } catch {
      Alert.alert("Invalid file", "That isn't a valid team data JSON file.");
    }
  };
  return (
    <Sheet visible={visible} title="Import CricHeroes data" onClose={onClose}>
      <Muted>This replaces any CricHeroes data saved for the team.</Muted>
      <Field label={`Players (${players.length}) · one per line: Name - Role`} value={roster} onChangeText={setRoster} multiline style={[s.input, { minHeight: 130, paddingTop: 12, textAlignVertical: "top" }]} placeholder={"Aman Verma - Batsman\nRavi Chauhan - Bowler"} />
      <Field label={`Team stats (${statRows.length}) · one per line: Label: value`} value={stats} onChangeText={setStats} multiline style={[s.input, { minHeight: 100, paddingTop: 12, textAlignVertical: "top" }]} placeholder={"Matches: 42\nWon: 26"} />
      <Button title="Save" disabled={!players.length && !statRows.length} loading={save.isPending}
        onPress={() => save.mutate({ method: "manual", data: { players, stats: statRows } })} />
      <Text style={{ textAlign: "center", color: C.muted }}>or</Text>
      <Button variant="secondary" title="Choose a team data file (.json)" onPress={() => void pickFile()} />
    </Sheet>
  );
}
