import { Camera, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Avatar } from "@/components/ui/avatar";
import { errorMessage } from "@/services/api/client";
import { me } from "@/services/api/endpoints";

export function ImageUpload({ name, value, onChange, purpose = "profile" }: { name: string; value?: string | null; onChange: (url: string) => void; purpose?: "profile" | "team" }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) return toast.error("Image must be under 5 MB");
    setBusy(true);
    try {
      onChange((await me.upload(f, purpose)).url);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-4">
      <div className="relative">
        <Avatar name={name || "?"} src={value} size="xl" />
        {busy && <span className="absolute inset-0 grid place-items-center rounded-full bg-white/70"><Loader2 className="size-6 animate-spin text-brand-700" /></span>}
      </div>
      <div>
        <button type="button" onClick={() => ref.current?.click()} className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold ring-1 ring-sand-300 hover:bg-sand-50">
          <Camera className="size-4" aria-hidden /> {value ? "Change photo" : "Add photo"}
        </button>
        <p className="mt-1 text-xs text-ink-500">JPEG, PNG or WebP · max 5 MB</p>
      </div>
      <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp" capture="user" className="sr-only" aria-label="Upload photo" onChange={(e) => void onFile(e.target.files?.[0])} />
    </div>
  );
}
