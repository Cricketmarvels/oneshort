/** Captain ↔ player chat for an accepted match invitation. Polls every 4 s; WhatsApp link only if the other person opted in. */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { MessageCircle, Send } from "lucide-react-native";
import { type ComponentRef, useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { type ChatThread, useChatThread } from "@/components/invites";
import { Avatar, EmptyState, ErrorBox, InlineNotice, LoadingSkeleton, Txt } from "@/components/ui";
import { api } from "@/lib/api";
import { when } from "@/lib/format";
import { FW, R, SP, T } from "@/theme";

export default function Chat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const q = useChatThread(id, true);
  const [text, setText] = useState("");
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  useEffect(() => { const t = setInterval(() => void q.refetch(), 4000); return () => clearInterval(t); }, [q]);
  useEffect(() => { setTimeout(() => scroll.current?.scrollToEnd({ animated: false }), 50); }, [q.data?.messages.length]);
  const send = useMutation({
    mutationFn: (body: string) => api(`/invitations/${id}/chat`, { method: "POST", body: { body } }),
    onSuccess: () => { setText(""); void qc.invalidateQueries({ queryKey: ["chat", id] }); },
  });
  const t: ChatThread | undefined = q.data;
  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: T.bg }} keyboardVerticalOffset={90}>
      <Stack.Screen options={{
        title: t?.other.full_name ?? "Chat",
        headerRight: () => (t?.whatsapp_url ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Continue on WhatsApp" onPress={() => void Linking.openURL(t.whatsapp_url!)} hitSlop={8}
            style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, height: 34, borderRadius: R.pill, backgroundColor: T.successBackground }}>
            <MessageCircle size={15} color="#128C4A" strokeWidth={2.4} /><Txt v="smallSemi" color="#128C4A">WhatsApp</Txt>
          </Pressable>
        ) : null),
      }} />
      {q.isPending ? <View style={{ padding: SP.page }}><LoadingSkeleton rows={3} /></View> : q.isError ? <View style={{ padding: SP.page }}><ErrorBox error={q.error} onRetry={() => void q.refetch()} /></View> : (
        <>
          <Pressable accessibilityRole="button" accessibilityLabel={`Open ${t!.match_title}`} onPress={() => router.push({ pathname: "/match/[id]", params: { id: t!.match_id } })}
            style={{ flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: SP.page, marginTop: SP.sm, padding: 12, borderRadius: R.lg, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line }}>
            <Avatar name={t!.other.full_name} uri={t!.other.profile_image} size={36} />
            <View style={{ flex: 1 }}><Txt v="smallSemi" numberOfLines={1}>{t!.match_title}</Txt><Txt v="small" color={T.muted}>{when(t!.match_start_at)}</Txt></View>
          </Pressable>
          <ScrollView ref={scroll} contentContainerStyle={{ padding: SP.page, gap: 8, flexGrow: 1 }}>
            {!t!.messages.length ? <EmptyState title="Say hello" body={`Agree arrival time, kit and anything else with ${t!.other.full_name.split(" ")[0]}.`} /> : t!.messages.map((m) => (
              <View key={m.id} style={{ alignSelf: m.mine ? "flex-end" : "flex-start", maxWidth: "80%", gap: 2 }}>
                <View style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18, borderBottomRightRadius: m.mine ? 6 : 18, borderBottomLeftRadius: m.mine ? 18 : 6, backgroundColor: m.mine ? T.primary : T.surface, borderWidth: m.mine ? 0 : 1, borderColor: T.line }}>
                  <Txt v="body" color={m.mine ? T.onPrimary : T.ink}>{m.body}</Txt>
                </View>
                <Txt v="small" color={T.faint} style={{ fontSize: 11, alignSelf: m.mine ? "flex-end" : "flex-start" }}>{when(m.created_at, { hour: "numeric", minute: "2-digit" })}</Txt>
              </View>
            ))}
          </ScrollView>
          {t!.can_send ? (
            <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: SP.page, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 12), backgroundColor: T.bg, borderTopWidth: 1, borderTopColor: T.line }}>
              <TextInput accessibilityLabel="Message" value={text} onChangeText={setText} placeholder="Message" placeholderTextColor={T.placeholder} multiline maxLength={1000}
                style={{ flex: 1, minHeight: 44, maxHeight: 120, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, borderRadius: 22, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, ...FW.body, fontSize: 15, color: T.ink }} />
              <Pressable accessibilityRole="button" accessibilityLabel="Send" disabled={!text.trim() || send.isPending} onPress={() => send.mutate(text.trim())}
                style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: text.trim() ? T.primary : T.line, alignItems: "center", justifyContent: "center" }}>
                <Send size={18} color={text.trim() ? T.onPrimary : T.muted} strokeWidth={2.2} />
              </Pressable>
            </View>
          ) : <View style={{ padding: SP.page }}><InlineNotice>This chat is closed because the invitation is no longer active.</InlineNotice></View>}
        </>
      )}
    </KeyboardAvoidingView>
  );
}
