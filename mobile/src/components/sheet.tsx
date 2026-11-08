/** Bottom sheets and modals. */
import { BottomSheetBackdrop, BottomSheetModal, BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { forwardRef, type ReactNode, useCallback, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, TextInput, View } from "react-native";

import { Button, Txt } from "@/components/ui";
import { FW, R, SP, T } from "@/theme";

export const FilterBottomSheet = forwardRef<BottomSheetModal, { title: string; children: ReactNode; snap?: string[] }>(function FilterBottomSheet({ title, children, snap = ["60%"] }, ref) {
  const backdrop = useCallback((p: React.ComponentProps<typeof BottomSheetBackdrop>) => <BottomSheetBackdrop {...p} appearsOnIndex={0} disappearsOnIndex={-1} opacity={1} style={[p.style, { backgroundColor: T.scrim }]} />, []);
  return (
    <BottomSheetModal ref={ref} snapPoints={snap} backdropComponent={backdrop} backgroundStyle={{ backgroundColor: T.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24 }} handleIndicatorStyle={{ backgroundColor: T.border, width: 40, height: 5 }}>
      <BottomSheetScrollView contentContainerStyle={{ paddingHorizontal: SP.page, paddingTop: 8, gap: 20, paddingBottom: 40 }}>
        <Txt v="h1" accessibilityRole="header">{title}</Txt>
        {children}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
});

export function ConfirmationModal({ visible, title, body, confirm = "Confirm", destructive, onConfirm, onCancel, loading }: {
  visible: boolean; title: string; body?: string; confirm?: string; destructive?: boolean; onConfirm: () => void; onCancel: () => void; loading?: boolean;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={{ flex: 1, backgroundColor: T.scrim, justifyContent: "center", padding: SP.xl }} onPress={onCancel} accessibilityLabel="Dismiss">
        <Pressable style={{ backgroundColor: T.white, borderRadius: R.xl, padding: SP.xl, gap: SP.md }} onPress={() => undefined}>
          <Txt v="h2" accessibilityRole="header">{title}</Txt>
          {body ? <Txt v="body" color={T.text2}>{body}</Txt> : null}
          <View style={{ flexDirection: "row", gap: SP.sm, marginTop: SP.sm }}>
            <Button title="Cancel" variant="secondary" onPress={onCancel} style={{ flex: 1 }} />
            <Button title={confirm} variant={destructive ? "danger" : "primary"} onPress={onConfirm} loading={loading} style={{ flex: 1 }} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Cross-platform text prompt (Alert.prompt is iOS-only). */
export function PromptModal({ visible, title, body, placeholder, confirm = "Send", minLength = 1, onSubmit, onCancel, loading }: {
  visible: boolean; title: string; body?: string; placeholder?: string; confirm?: string; minLength?: number; onSubmit: (text: string) => void; onCancel: () => void; loading?: boolean;
}) {
  const [text, setText] = useState("");
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, justifyContent: "flex-end", backgroundColor: T.scrim }}>
        <View style={{ backgroundColor: T.white, borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl, padding: SP.xl, gap: SP.md, paddingBottom: 40 }}>
          <Txt v="h2" accessibilityRole="header">{title}</Txt>
          {body ? <Txt v="small" color={T.text2}>{body}</Txt> : null}
          <TextInput accessibilityLabel={title} value={text} onChangeText={setText} placeholder={placeholder} placeholderTextColor={T.muted} multiline autoFocus
            style={{ minHeight: 96, borderRadius: R.md, borderWidth: 1, borderColor: T.line, padding: 14, ...FW.body, fontSize: 15, textAlignVertical: "top", color: T.text }} />
          <View style={{ flexDirection: "row", gap: SP.sm }}>
            <Button title="Cancel" variant="secondary" onPress={() => { setText(""); onCancel(); }} style={{ flex: 1 }} />
            <Button title={confirm} disabled={text.trim().length < minLength} loading={loading} onPress={() => { onSubmit(text.trim()); setText(""); }} style={{ flex: 1 }} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
