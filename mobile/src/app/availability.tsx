import { formatDateTime, timeRange, type S } from "@cm/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, ScrollView, View } from "react-native";

import { Badge, Button, Card, Empty, Field, H2, Loading, Muted, s } from "@/components/ui";
import { api, errorText } from "@/lib/api";

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata";

export default function Availability() {
  const q = useQuery({ queryKey: ["availability"], queryFn: () => api<S<"AvailabilityOut">[]>("/availability/me") });
  const [f, setF] = useState({ date: new Date().toLocaleDateString("en-CA"), start: "06:30", end: "11:00" });
  const [status, setStatus] = useState<S<"AvailabilityStatus">>("available");
  const add = async () => {
    try {
      await api("/availability", { method: "POST", body: { start_at: new Date(`${f.date}T${f.start}:00`).toISOString(), end_at: new Date(`${f.date}T${f.end}:00`).toISOString(), status, timezone: TZ } });
      void q.refetch();
    } catch (e) { Alert.alert("Couldn't add", errorText(e)); }
  };
  const remove = async (id: string) => { await api(`/availability/${id}`, { method: "DELETE" }); void q.refetch(); };
  return (
    <ScrollView contentContainerStyle={s.scroll}>
      <H2>Add a slot</H2>
      <Field label="Date (YYYY-MM-DD)" value={f.date} onChangeText={(date) => setF({ ...f, date })} />
      <View style={s.row}>
        <View style={{ flex: 1 }}><Field label="From" value={f.start} onChangeText={(start) => setF({ ...f, start })} /></View>
        <View style={{ flex: 1 }}><Field label="To" value={f.end} onChangeText={(end) => setF({ ...f, end })} /></View>
      </View>
      <View style={s.row}>
        {(["available", "tentative", "unavailable"] as const).map((st) => <Button key={st} title={st} variant={status === st ? "primary" : "secondary"} style={{ flex: 1, paddingHorizontal: 6 }} onPress={() => setStatus(st)} />)}
      </View>
      <Button title="Add availability" onPress={() => void add()} />
      <H2>Upcoming</H2>
      {q.isPending ? <Loading /> : (q.data ?? []).length === 0 ? <Empty title="No slots yet" /> : q.data!.map((a) => (
        <Card key={a.id}>
          <View style={s.row}><View style={{ flex: 1 }}><Muted>{formatDateTime(a.start_at, a.timezone, { hour: undefined, minute: undefined })}</Muted><Muted>{timeRange(a.start_at, a.end_at, a.timezone)}</Muted></View><Badge status={a.status} /></View>
          <Button title="Remove" variant="ghost" onPress={() => void remove(a.id)} />
        </Card>
      ))}
    </ScrollView>
  );
}
