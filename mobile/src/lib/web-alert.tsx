/**
 * Alert.alert on the web. react-native-web ships `Alert.alert() {}` — an empty function — so in a browser every
 * error message, confirmation ("Delete your account?") and choice sheet the app shows through Alert silently
 * vanished. installWebAlert() replaces it with a small in-app dialog rendered by <WebAlertHost/>, keeping the
 * exact Alert.alert(title, message, buttons) contract, so none of the existing call sites change. Native
 * platforms keep their system alerts.
 */
import { Alert, type AlertButton, Modal, Platform, Pressable, View } from "react-native";
import { create } from "zustand";

import { Txt } from "@/components/ui";
import { T } from "@/theme";

type Dialog = { id: number; title: string; message?: string; buttons: AlertButton[] };
type State = { queue: Dialog[]; push: (d: Omit<Dialog, "id">) => void; pop: () => void };

let seq = 0;
const useDialogs = create<State>((set) => ({
  queue: [],
  push: (d) => set((s) => ({ queue: [...s.queue, { ...d, id: ++seq }] })),
  pop: () => set((s) => ({ queue: s.queue.slice(1) })),
}));

let installed = false;
export function installWebAlert(): void {
  if (Platform.OS !== "web" || installed) return;
  installed = true;
  (Alert as unknown as { alert: typeof Alert.alert }).alert = (title, message, buttons) => {
    useDialogs.getState().push({ title: title ?? "", message: message ?? undefined, buttons: buttons?.length ? buttons : [{ text: "OK" }] });
  };
}

export function WebAlertHost() {
  const current = useDialogs((s) => s.queue[0]);
  const pop = useDialogs((s) => s.pop);
  if (Platform.OS !== "web" || !current) return null;
  const choose = (b?: AlertButton) => { pop(); b?.onPress?.(); };
  const cancel = current.buttons.find((b) => b.style === "cancel");
  // Cancel last, like iOS action sheets; two buttons sit side by side, more stack vertically.
  const ordered = [...current.buttons.filter((b) => b.style !== "cancel"), ...(cancel ? [cancel] : [])];
  const row = ordered.length <= 2;
  return (
    <Modal transparent visible animationType="fade" onRequestClose={() => choose(cancel)}>
      <Pressable accessibilityLabel="Close dialog" onPress={() => choose(cancel)} style={{ flex: 1, backgroundColor: "rgba(13,23,22,0.45)", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Pressable accessibilityRole="alert" onPress={() => undefined} style={{ width: "100%", maxWidth: 360, backgroundColor: T.surface, borderRadius: 22, padding: 20, gap: 14 }}>
          <View style={{ gap: 6 }}>
            <Txt v="h3" accessibilityRole="header">{current.title}</Txt>
            {current.message ? <Txt v="body" color={T.muted}>{current.message}</Txt> : null}
          </View>
          <View style={{ flexDirection: row ? "row-reverse" : "column", gap: 8 }}>
            {ordered.map((b, i) => {
              const primary = i === 0 && b.style !== "cancel" && b.style !== "destructive";
              const color = b.style === "destructive" ? T.dangerText : primary ? "#FFFFFF" : T.ink;
              return (
                <Pressable key={`${b.text}-${i}`} accessibilityRole="button" onPress={() => choose(b)}
                  style={({ pressed }) => ({ flex: row ? 1 : undefined, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.85 : 1,
                    backgroundColor: primary ? T.primary : b.style === "destructive" ? T.dangerBackground : T.surface2 })}>
                  <Txt v="smallSemi" color={color} style={{ fontSize: 15 }}>{b.text ?? "OK"}</Txt>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
