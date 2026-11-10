/** Pick a photo, upload it as the profile picture and refresh the signed-in user. Shared by Home and Me. */
import { useState } from "react";
import { Alert } from "react-native";

import { api, errorText } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { pickAndUpload } from "@/lib/device";

export function useProfilePhoto() {
  const { reload } = useAuth();
  const [busy, setBusy] = useState(false);
  const upload = async (source: "library" | "camera" = "library") => {
    setBusy(true);
    try {
      const url = await pickAndUpload(source);
      if (url) { await api("/users/me", { method: "PUT", body: { profile_image: url } }); await reload(); }
    } catch (e) { Alert.alert("Upload failed", errorText(e)); } finally { setBusy(false); }
  };
  return { upload, busy };
}
