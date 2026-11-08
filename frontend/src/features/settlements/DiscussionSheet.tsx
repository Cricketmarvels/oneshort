import { relativeTime, type S } from "@cm/shared";
import { Send } from "lucide-react";
import { useState } from "react";

import { useAuth } from "@/app/store/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { EmptyState, QueryState } from "@/components/ui/states";
import { fees, useDiscussion } from "@/services/api/endpoints";
import { useAction } from "@/services/api/hooks";
import { cn } from "@/utils/cn";

export function DiscussionSheet({ record, onClose }: { record: S<"PaymentRecordOut">; onClose: () => void }) {
  const me = useAuth((s) => s.user);
  const q = useDiscussion(record.id);
  const [msg, setMsg] = useState("");
  const post = useAction(() => fees.postDiscussion(record.id, msg), { invalidate: [["payments", "discussion", record.id]], onSuccess: () => setMsg("") });
  return (
    <Sheet open onOpenChange={(v) => !v && onClose()} title="Fee discussion" description={`${record.player.full_name} · ${record.match_title}`}
      footer={<form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (msg.trim()) post.mutate(undefined); }}>
        <Input aria-label="Message" value={msg} maxLength={1000} onChange={(e) => setMsg(e.target.value)} placeholder="Write a message…" />
        <Button type="submit" size="icon" aria-label="Send" loading={post.isPending} className="h-12 w-12"><Send className="size-4" /></Button>
      </form>}>
      <QueryState query={q} isEmpty={(d) => d.length === 0} empty={<EmptyState title="No messages yet" body="Discuss the amount or payment here. Only you and the captain can see this." />}>
        {(d) => (
          <ul className="space-y-2">
            {d.map((m) => {
              const mine = m.author.id === me?.id;
              return (
                <li key={m.id} className={cn("max-w-[85%] rounded-2xl px-3.5 py-2 text-sm", mine ? "ml-auto bg-brand-700 text-white" : "bg-sand-100")}>
                  {!mine && <p className="text-xs font-semibold text-ink-500">{m.author.full_name}</p>}
                  <p>{m.message}</p>
                  <p className={cn("mt-0.5 text-[10px]", mine ? "text-white/70" : "text-ink-400")}>{relativeTime(m.created_at)}</p>
                </li>
              );
            })}
          </ul>
        )}
      </QueryState>
    </Sheet>
  );
}
