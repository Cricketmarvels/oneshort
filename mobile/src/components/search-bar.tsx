/** Plain-language search field with voice input (Home and the results screen). Sand search field: surface, radius 14, 48 high. */
import { ArrowRight, Mic, Search, Square } from "lucide-react-native";
import { type ComponentRef, useRef } from "react";
import { Alert, Pressable, TextInput, View } from "react-native";

import { Txt } from "@/components/ui";
import { useVoiceInput } from "@/lib/voice";
import { FW, ICON, R, shadow, T } from "@/theme";

export function SmartSearchBar({ value, onChange, onSubmit, autoFocus }: { value: string; onChange: (v: string) => void; onSubmit: (v: string) => void; autoFocus?: boolean }) {
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const voice = useVoiceInput({ onText: onChange, onFinal: onSubmit });
  const mic = async () => {
    if (voice.listening) return voice.stop();
    if (!voice.available) {
      input.current?.focus();
      return Alert.alert("Speak using your keyboard", "Voice search needs the installed GoFindr app or the website. Here, tap the microphone on your phone's keyboard to dictate.");
    }
    await voice.start();
  };
  const canSearch = value.trim().length >= 2 && !voice.listening;
  return (
    <View style={{ gap: 6 }}>
      <View style={[{ flexDirection: "row", alignItems: "center", gap: 10, height: 50, paddingLeft: 16, paddingRight: 4, borderRadius: R.field, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line }, shadow(2)]}>
        <Search size={18} color={T.muted} strokeWidth={ICON.stroke} />
        <TextInput ref={input} accessibilityLabel="Search GoFindr in your own words" value={value} onChangeText={onChange} onSubmitEditing={() => onSubmit(value)} returnKeyType="search" autoFocus={autoFocus}
          placeholder={voice.listening ? "Listening…" : "Try “play on Saturday morning”"} placeholderTextColor={T.placeholder}
          style={{ flex: 1, minWidth: 0, height: 48, ...FW.body, fontSize: 15, color: T.ink, outlineStyle: "none" } as object} />
        {canSearch ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Search" onPress={() => onSubmit(value)} hitSlop={4} style={{ width: 40, height: 44, alignItems: "center", justifyContent: "center" }}>
            <ArrowRight size={18} color={T.accent} strokeWidth={ICON.navActive} />
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" accessibilityLabel={voice.listening ? "Stop voice search" : "Search by voice"} accessibilityState={{ busy: voice.listening }} onPress={() => void mic()} hitSlop={4}
          style={{ width: 40, height: 44, alignItems: "center", justifyContent: "center" }}>
          {voice.listening ? <Square size={14} color={T.accent} fill={T.accent} strokeWidth={1.5} /> : <Mic size={18} color={T.muted} strokeWidth={ICON.stroke} />}
        </Pressable>
      </View>
      {voice.listening ? <Txt v="small" color={T.accent}>Listening… tap the square when you're done</Txt>
        : voice.error ? <Txt v="small" color={T.down} accessibilityRole="alert">{voice.error}</Txt> : null}
    </View>
  );
}
