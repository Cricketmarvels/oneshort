/**
 * Speech-to-text for the search bar.
 *
 * - Website (Safari/Chrome): the browser's Web Speech API, via expo-speech-recognition's web build.
 * - Installed iOS/Android app (EAS/dev build): the platform speech recogniser (Apple Speech /
 *   Android SpeechRecognizer) through the expo-speech-recognition native module.
 * - Expo Go: the native module isn't bundled, so `available` is false and callers fall back to the
 *   keyboard's own dictation button. We never import the native module there (it would throw).
 *
 * PlayR doesn't record or store audio; recognition is done by the device or browser speech service.
 */
import { requireOptionalNativeModule } from "expo";
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

type SpeechModule = typeof import("expo-speech-recognition");

function loadSpeech(): SpeechModule | null {
  if (Platform.OS !== "web" && !requireOptionalNativeModule("ExpoSpeechRecognition")) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("expo-speech-recognition") as SpeechModule;
    return mod.ExpoSpeechRecognitionModule.isRecognitionAvailable() ? mod : null;
  } catch {
    return null;
  }
}

const HINTS = ["T10", "T15", "T20", "wicketkeeper", "all-rounder", "bowler", "batter", "Noida", "Greater Noida", "Sector", "PlayR", "weekend"];

export function useVoiceInput({ onText, onFinal }: { onText: (t: string) => void; onFinal: (t: string) => void }) {
  const mod = useRef<SpeechModule | null | undefined>(undefined);
  if (mod.current === undefined) mod.current = loadSpeech();
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const last = useRef("");
  const cb = useRef({ onText, onFinal });
  cb.current = { onText, onFinal };

  useEffect(() => {
    const m = mod.current;
    if (!m) return;
    const S = m.ExpoSpeechRecognitionModule;
    const subs = [
      S.addListener("result", (e) => {
        const t = e.results[0]?.transcript ?? "";
        if (t) { last.current = t; cb.current.onText(t); }
      }),
      S.addListener("end", () => {
        setListening(false);
        if (last.current.trim()) cb.current.onFinal(last.current.trim());
      }),
      S.addListener("error", (e) => {
        setListening(false);
        if (e.error !== "aborted" && e.error !== "no-speech") setError(e.message || "Voice input stopped.");
        if (e.error === "no-speech") setError("Didn't catch that. Try again.");
      }),
    ];
    return () => { subs.forEach((s) => s.remove()); try { S.abort(); } catch { /* not running */ } };
  }, []);

  const start = useCallback(async () => {
    const m = mod.current;
    if (!m) return false;
    setError(null);
    last.current = "";
    const perm = await m.ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) { setError("Allow microphone access to search by voice."); return false; }
    m.ExpoSpeechRecognitionModule.start({ lang: "en-IN", interimResults: true, continuous: false, contextualStrings: HINTS, addsPunctuation: false });
    setListening(true);
    return true;
  }, []);

  const stop = useCallback(() => { try { mod.current?.ExpoSpeechRecognitionModule.stop(); } catch { /* not running */ } }, []);

  return { available: !!mod.current, listening, error, start, stop };
}
