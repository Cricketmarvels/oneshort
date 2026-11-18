/**
 * Reads a pending-fees list pasted from WhatsApp, e.g.
 *
 *   Pending Match Fees to be paid at:
 *   shubhang.dixit@ybl
 *   2. Ajay Sinha - 600
 *   5. mohitbirbalgaur - 588 + 500 = 1088
 *   10. Abhishek Tyagi - 577 (advance)
 *
 * into rows (name, signed amount) plus the UPI ID if the list has one. Sums are worked out ("588 + 500 = 1088"
 * takes the total); "advance" or "adv" makes the amount a credit. Anything with a subtraction is flagged for the
 * captain to check, because "258 - 475" can mean either way round.
 */

export type DueRow = { name: string; amountPaise: number; note: string; check: boolean; raw: string };
export type Person = { key: string; name: string };

const UPI = /[A-Za-z0-9][A-Za-z0-9.\-_]{1,99}@[A-Za-z][A-Za-z0-9.\-]{1,49}/;

export function parseDuesList(text: string): { upi: string | null; rows: DueRow[] } {
  let upi: string | null = null;
  const rows: DueRow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const u = line.match(UPI);
    if (u && !/\d/.test(line.replace(u[0], ""))) { upi = upi ?? u[0]; continue; }
    const body = line.replace(/^\d+\s*[.)]\s*/, "").replace(/@/g, "");
    const at = body.search(/\d/);
    if (at < 0) continue;
    const name = body.slice(0, at).replace(/[\s\-–—:=]+$/, "").trim();
    if (name.length < 2) continue;
    const expr = body.slice(at);
    const advance = /\b(adv|advance|credit)\b/i.test(expr);
    const nums = expr.replace(/\([^)]*\)/g, " ").replace(/,/g, "");
    let value: number;
    if (nums.includes("=")) {
      const last = nums.slice(nums.lastIndexOf("=") + 1).match(/\d+(?:\.\d+)?/);
      if (!last) continue;
      value = Number(last[0]);
    } else {
      value = 0;
      let seen = false;
      for (const m of nums.matchAll(/([+\-–]?)\s*(\d+(?:\.\d+)?)/g)) {
        const sign = m[1] === "-" || m[1] === "–" ? -1 : 1;
        value += sign * Number(m[2]);
        seen = true;
      }
      if (!seen) continue;
    }
    let paise = Math.round(value * 100);
    if (advance) paise = -Math.abs(paise);
    rows.push({ name, amountPaise: paise, note: paise < 0 ? "Advance" : "Previous dues", check: !nums.includes("=") && /\d\s*[-–]\s*\d/.test(nums), raw: line });
  }
  return { upi, rows };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);

/** The person in the split a pasted name refers to, or null if it's unclear. "mohitbirbalgaur" finds "Mohit Birbal Gaur". */
export function matchPerson(name: string, people: Person[]): string | null {
  const words = norm(name);
  if (!words.length) return null;
  const compact = words.join("");
  let best: { key: string; score: number } | null = null;
  let tie = false;
  for (const p of people) {
    const pw = norm(p.name);
    const pc = pw.join("");
    let score = 0;
    if (pc === compact) score = 4;
    else if (pw[0] === words[0] && (words.length === 1 || pw.length === 1)) score = 3;
    else if (compact.length >= 4 && (pc.startsWith(compact) || compact.startsWith(pc))) score = 2;
    else if (words[0]!.length >= 3 && pw[0] === words[0]) score = 1;
    if (!score) continue;
    if (!best || score > best.score) { best = { key: p.key, score }; tie = false; }
    else if (score === best.score) tie = true;
  }
  return best && !tie ? best.key : null;
}
