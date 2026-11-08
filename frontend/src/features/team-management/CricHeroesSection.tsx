import { parseRosterText, parseStatsText, relativeTime, type S } from "@cm/shared";
import { ExternalLink, FileUp, Link2, RefreshCw, Trash2, Trophy } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader, Stat } from "@/components/ui/card";
import { Tabs } from "@/components/ui/chip";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { EmptyState, QueryState } from "@/components/ui/states";
import { cricheroes, useCricHeroes } from "@/services/api/endpoints";
import { useAction } from "@/services/api/hooks";

type Profile = S<"CricHeroesProfileOut">;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** Team's CricHeroes link + imported stats, roster, recent matches and leaderboards. */
export function CricHeroesSection({ teamId }: { teamId: string }) {
  const q = useCricHeroes(teamId);
  const [sheet, setSheet] = useState<"link" | "import" | null>(null);
  const inv = [["teams", teamId, "cricheroes"]];
  const sync = useAction(() => cricheroes.sync(teamId), { invalidate: inv, success: "Synced from CricHeroes" });
  const remove = useAction(() => cricheroes.remove(teamId), { invalidate: inv, success: "CricHeroes data removed" });

  return (
    <QueryState query={q}>
      {(p) => (
        <section aria-label="CricHeroes">
          <SectionHeader
            title="CricHeroes"
            subtitle={p.link ? `Team #${p.link.external_team_id}` : "Bring in your team's CricHeroes record"}
            action={p.link && (
              <a href={p.link.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">
                View on CricHeroes <ExternalLink className="size-3.5" aria-hidden />
              </a>
            )}
          />
          {p.can_manage && (
            <div className="mb-3 flex flex-wrap gap-2">
              <Button size="sm" variant="soft" icon={<Link2 className="size-4" />} onClick={() => setSheet("link")}>{p.link ? "Change link" : "Link CricHeroes team"}</Button>
              <Button size="sm" variant="soft" icon={<FileUp className="size-4" />} onClick={() => setSheet("import")}>{p.snapshot ? "Update data" : "Import data"}</Button>
              <Button size="sm" variant="ghost" icon={<RefreshCw className="size-4" />} disabled={!p.auto_sync_available || !p.link} loading={sync.isPending}
                title={p.auto_sync_note ?? (p.link ? "Fetch the latest data" : "Link a team first")} onClick={() => sync.mutate(undefined)}>Sync</Button>
              {(p.link || p.snapshot) && (
                <Button size="sm" variant="ghost" className="text-ball-600" icon={<Trash2 className="size-4" />}
                  onClick={() => confirm("Remove the CricHeroes link and imported data?") && remove.mutate(undefined)}>Remove</Button>
              )}
            </div>
          )}
          {p.can_manage && !p.auto_sync_available && p.auto_sync_note && <p className="mb-3 text-xs text-ink-500">{p.auto_sync_note}</p>}
          {p.snapshot ? <Snapshot snap={p.snapshot} /> : (
            <EmptyState icon={<Trophy className="size-6" />} title="No CricHeroes data yet"
              body={p.can_manage ? "Link your CricHeroes team and import its players and stats." : "This team hasn't added its CricHeroes record."} />
          )}
          {sheet === "link" && <LinkSheet teamId={teamId} current={p.link?.url} onClose={() => setSheet(null)} />}
          {sheet === "import" && <ImportSheet teamId={teamId} onClose={() => setSheet(null)} />}
        </section>
      )}
    </QueryState>
  );
}

function Snapshot({ snap }: { snap: NonNullable<Profile["snapshot"]> }) {
  const [showAll, setShowAll] = useState(false);
  const matches = showAll ? snap.matches : snap.matches.slice(0, 4);
  const boards = (["batting", "bowling", "fielding"] as const).filter((k) => snap.leaderboard[k].length);
  return (
    <div className="space-y-4">
      {snap.stats.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{snap.stats.map((s) => <Stat key={s.label} label={s.label} value={s.value} />)}</div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {snap.players.length > 0 && (
          <Card className="p-4">
            <h3 className="mb-2 font-semibold">Squad on CricHeroes <span className="text-ink-500">({snap.players.length})</span></h3>
            <ul className="divide-y divide-sand-200">
              {snap.players.map((pl, i) => (
                <li key={`${pl.name}-${i}`} className="flex items-center gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    {pl.profile_url
                      ? <a href={pl.profile_url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">{pl.name}</a>
                      : <span className="font-medium">{pl.name}</span>}
                    {pl.role && <p className="truncate text-xs text-ink-500">{pl.role}</p>}
                  </div>
                  {pl.member_user_id && <Link to={`/players/${pl.member_user_id}`}><Badge tone="success">On CricketMarvels</Badge></Link>}
                </li>
              ))}
            </ul>
          </Card>
        )}
        {boards.length > 0 && (
          <Card className="p-4">
            <h3 className="mb-2 font-semibold">Leaderboard</h3>
            <div className="space-y-3">
              {boards.map((k) => (
                <div key={k}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{k}</p>
                  <ol className="mt-1 space-y-1">
                    {snap.leaderboard[k].slice(0, 5).map((e, i) => (
                      <li key={`${e.player_name}-${i}`} className="flex justify-between gap-3 text-sm"><span className="truncate">{i + 1}. {e.player_name}</span><span className="tabular shrink-0 text-ink-700">{e.stat}</span></li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
      {snap.matches.length > 0 && (
        <Card className="p-4">
          <h3 className="mb-2 font-semibold">Recent matches</h3>
          <ul className="divide-y divide-sand-200">
            {matches.map((m, i) => (
              <li key={i} className="py-2.5 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{m.result ?? "Result not recorded"}</span>
                  {m.played_on && <span className="text-xs text-ink-500">{new Date(m.played_on).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>}
                </div>
                {m.score.length > 0 && <p className="tabular text-ink-700">{m.score.join(" · ")}</p>}
                <p className="text-xs text-ink-500">{[m.tournament, m.venue].filter(Boolean).join(" · ")}
                  {m.url && <> · <a href={m.url} target="_blank" rel="noopener noreferrer" className="hover:underline">Scorecard</a></>}</p>
              </li>
            ))}
          </ul>
          {snap.matches.length > 4 && <Button size="sm" variant="ghost" onClick={() => setShowAll(!showAll)}>{showAll ? "Show fewer" : `Show all ${snap.matches.length}`}</Button>}
        </Card>
      )}
      <p className="text-xs text-ink-500">
        {snap.method === "manual" ? "Entered manually" : snap.method === "sync" ? "Synced" : "Imported from file"} {relativeTime(snap.imported_at)}
        {snap.imported_by && ` by ${snap.imported_by.full_name}`}. Provided by the team; not verified by CricketMarvels.
      </p>
    </div>
  );
}

function LinkSheet({ teamId, current, onClose }: { teamId: string; current?: string; onClose: () => void }) {
  const [url, setUrl] = useState(current ?? "");
  const link = useAction(() => cricheroes.link(teamId, url), { invalidate: [["teams", teamId, "cricheroes"]], success: "CricHeroes team linked", onSuccess: onClose });
  return (
    <Sheet open onOpenChange={(v) => !v && onClose()} title="Link your CricHeroes team" description="Open your team on CricHeroes, tap Share, and paste the link here."
      footer={<Button block size="lg" disabled={url.trim().length < 3} loading={link.isPending} onClick={() => link.mutate(undefined)}>Save link</Button>}>
      <Field label="CricHeroes team link">{(id) => <Input id={id} inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://cricheroes.com/team-profile/123456/your-team" />}</Field>
    </Sheet>
  );
}

function ImportSheet({ teamId, onClose }: { teamId: string; onClose: () => void }) {
  const [tab, setTab] = useState<"manual" | "file">("manual");
  const [roster, setRoster] = useState("");
  const [stats, setStats] = useState("");
  const [file, setFile] = useState<{ name: string; data: S<"CricHeroesSnapshotIn"> } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const players = parseRosterText(roster);
  const statRows = parseStatsText(stats);
  const body: S<"CricHeroesImportIn"> | null = tab === "file"
    ? file && { method: "file", data: file.data }
    : players.length || statRows.length ? { method: "manual", data: { players, stats: statRows } } : null;
  const run = useAction(() => cricheroes.import(teamId, body!), { invalidate: [["teams", teamId, "cricheroes"]], success: "CricHeroes data saved", onSuccess: onClose });

  const onFile = async (f: File | undefined) => {
    setFile(null);
    setFileError(null);
    if (!f) return;
    if (f.size > MAX_FILE_BYTES) return setFileError("File is larger than 2 MB.");
    try {
      const parsed: unknown = JSON.parse(await f.text());
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      setFile({ name: f.name, data: parsed as S<"CricHeroesSnapshotIn"> });
    } catch {
      setFileError("That isn't a valid team data JSON file.");
    }
  };

  return (
    <Sheet open onOpenChange={(v) => !v && onClose()} title="Import CricHeroes data" description="This replaces any CricHeroes data saved for the team." size="lg"
      footer={<Button block size="lg" disabled={!body} loading={run.isPending} onClick={() => run.mutate(undefined)}>Save</Button>}>
      <div className="space-y-4">
        <Tabs value={tab} onChange={setTab} tabs={[{ value: "manual", label: "Enter manually" }, { value: "file", label: "Upload file" }]} />
        {tab === "manual" ? (
          <>
            <Field label="Players" optional hint={`One per line: "Name - Role". ${players.length} player${players.length === 1 ? "" : "s"}.`}>
              {(id) => <Textarea id={id} rows={6} value={roster} onChange={(e) => setRoster(e.target.value)} placeholder={"Aman Verma - Batsman\nRavi Chauhan - Bowler"} />}
            </Field>
            <Field label="Team stats" optional hint={`One per line: "Label: value". ${statRows.length} stat${statRows.length === 1 ? "" : "s"}.`}>
              {(id) => <Textarea id={id} rows={4} value={stats} onChange={(e) => setStats(e.target.value)} placeholder={"Matches: 42\nWon: 26\nWin %: 61%"} />}
            </Field>
          </>
        ) : (
          <>
            <Field label="Team data file (.json)" hint="Fields: team_name, players, matches, stats, leaderboard. Max 2 MB." error={fileError ?? undefined}>
              {(id) => <Input id={id} type="file" accept="application/json,.json" onChange={(e) => void onFile(e.target.files?.[0])} />}
            </Field>
            {file && (
              <p className="text-sm text-ink-700">
                <strong>{file.name}</strong>: {file.data.players?.length ?? 0} players, {file.data.matches?.length ?? 0} matches, {file.data.stats?.length ?? 0} stats
              </p>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
