"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { loadPositions } from "../lib/positions";
import {
  POSITION_REQUIREMENT_RULE,
  describeRequirement,
  requirementsFromRules,
  type PositionRequirement,
  type SavedRequirement,
} from "../lib/positionRequirements";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Draft = { min: number; positions: string[]; role: "open" | "close"; days: number[] };
const emptyDraft: Draft = { min: 1, positions: [], role: "open", days: [] };

/**
 * Openers and closers by position: "At least 2 ASR II must open on Saturdays".
 * Saved as the same position requirements the Positions page uses, so Auto
 * Generate, the schedule check and Fix all follow them.
 */
export default function PositionStaffing({ openersPerDay, closersPerDay }: { openersPerDay: number; closersPerDay: number }) {
  const [positionNames, setPositionNames] = useState<string[]>([]);
  const [items, setItems] = useState<SavedRequirement[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void loadPositions().then((result) => setPositionNames(result.positions.map((position) => position.name)));
    void supabase
      .from("ai_rules")
      .select("id, rule_type, rule_value, employee_id")
      .eq("rule_type", POSITION_REQUIREMENT_RULE)
      .then(({ data }: { data: Array<{ id: string; rule_type: string; rule_value: string; employee_id: string | null }> | null }) =>
        setItems(requirementsFromRules(data || [])),
      );
  }, []);

  const minimums = items.filter((item) => item.requirement.kind === "minimum");
  const pairings = items.length - minimums.length;

  // Days where position minimums add up to more than the openers/closers per day.
  const overflow = (["open", "close"] as const).flatMap((role) => {
    const perDay = role === "open" ? openersPerDay : closersPerDay;
    return DAYS.map((label, weekday) => {
      const total = minimums
        .map((item) => item.requirement)
        .filter((requirement) => requirement.role === role && (requirement.days.length === 0 || requirement.days.includes(weekday)))
        .reduce((sum, requirement) => sum + (requirement.kind === "minimum" ? requirement.min : 0), 0);
      return total > perDay ? `${label} needs ${total} ${role === "open" ? "openers" : "closers"}` : null;
    }).filter(Boolean);
  });

  function startAdd() {
    setDraft({ ...emptyDraft, positions: positionNames.slice(0, 1) });
    setEditingId(null);
    setAdding(true);
    setError("");
  }

  function startEdit(item: SavedRequirement) {
    if (item.requirement.kind !== "minimum") return;
    setDraft({ min: item.requirement.min, positions: item.requirement.positions, role: item.requirement.role, days: item.requirement.days });
    setEditingId(item.id ?? null);
    setAdding(true);
    setError("");
  }

  async function save() {
    if (draft.positions.length === 0) return setError("Pick at least one position.");
    const requirement: PositionRequirement = {
      kind: "minimum",
      role: draft.role,
      positions: draft.positions,
      min: Math.max(1, Math.floor(draft.min) || 1),
      days: draft.days.length === 6 ? [] : [...draft.days].sort(),
    };
    setBusy(true);
    setError("");
    const value = JSON.stringify(requirement);
    const result = editingId
      ? await supabase.from("ai_rules").update({ rule_value: value }).eq("id", editingId).select("id")
      : await supabase.from("ai_rules").insert({ employee_id: null, rule_type: POSITION_REQUIREMENT_RULE, rule_value: value, start_date: null, end_date: null }).select("id");
    setBusy(false);
    const id = (result.data as Array<{ id: string }> | null)?.[0]?.id;
    if (result.error || !id) {
      setError(result.error?.message || "Couldn't save. Your account may not have permission to change rules.");
      return;
    }
    setItems((current) => (editingId ? current.map((item) => (item.id === editingId ? { id, requirement } : item)) : [...current, { id, requirement }]));
    setAdding(false);
    setEditingId(null);
  }

  async function remove(item: SavedRequirement) {
    if (!item.id) return;
    setBusy(true);
    const { data, error: removeError } = await supabase.from("ai_rules").delete().eq("id", item.id).select("id");
    setBusy(false);
    if (removeError || !data?.length) {
      setError(removeError?.message || "Couldn't remove. Your account may not have permission to change rules.");
      return;
    }
    setItems((current) => current.filter((other) => other.id !== item.id));
  }

  const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 md:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">Openers &amp; closers by position <span className="font-normal text-slate-500">(optional)</span></h3>
          <p className="mt-0.5 text-sm text-slate-600">
            For example, &quot;at least 1 Store Manager must open&quot; or &quot;at least 2 ASR II must close on Saturdays&quot;.
            They count toward the openers and closers per day above.
          </p>
        </div>
        {!adding && (
          <button type="button" onClick={startAdd} className="rounded-lg border border-blue-300 bg-white px-3 py-2 text-sm font-semibold text-blue-800 hover:bg-blue-50">
            + Add by position
          </button>
        )}
      </div>

      {minimums.length > 0 && (
        <ul className="mt-3 space-y-2">
          {minimums.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-slate-200">
              <span className="font-medium">{describeRequirement(item.requirement)}</span>
              <span className="flex gap-2">
                <button type="button" onClick={() => startEdit(item)} disabled={busy} className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold hover:bg-slate-50">Edit</button>
                <button type="button" onClick={() => void remove(item)} disabled={busy} className="rounded-md border border-red-200 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50">Remove</button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {overflow.length > 0 && (
        <p className="mt-3 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">
          {overflow.join("; ")} by position, more than the per-day number above. Auto Generate uses the larger number on those days.
        </p>
      )}

      {adding && (
        <div className="mt-3 space-y-3 rounded-lg bg-white p-3 ring-1 ring-blue-200">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>At least</span>
            <input
              type="number"
              min={1}
              max={10}
              value={draft.min}
              onChange={(e) => setDraft({ ...draft, min: Number(e.target.value) })}
              className="w-16 rounded-lg border border-slate-300 px-2 py-1.5"
            />
            <span>of the positions below must</span>
            <select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as "open" | "close" })} className="rounded-lg border border-slate-300 px-2 py-1.5">
              <option value="open">open</option>
              <option value="close">close</option>
            </select>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Positions (any of these count)</div>
            <div className="mt-1 flex flex-wrap gap-2">
              {positionNames.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setDraft({ ...draft, positions: toggle(draft.positions, name) })}
                  className={`rounded-full px-3 py-1 text-sm font-medium ring-1 ${draft.positions.includes(name) ? "bg-blue-600 text-white ring-blue-600" : "bg-white text-slate-700 ring-slate-300"}`}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Days (none selected = every day)</div>
            <div className="mt-1 flex flex-wrap gap-2">
              {DAYS.map((label, weekday) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setDraft({ ...draft, days: toggle(draft.days, weekday) })}
                  className={`rounded-full px-3 py-1 text-sm font-medium ring-1 ${draft.days.includes(weekday) ? "bg-blue-600 text-white ring-blue-600" : "bg-white text-slate-700 ring-slate-300"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => void save()} disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {editingId ? "Save" : "Add"}
            </button>
            <button type="button" onClick={() => { setAdding(false); setEditingId(null); setError(""); }} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium">
              Cancel
            </button>
          </div>
        </div>
      )}

      {!adding && error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      {pairings > 0 && (
        <p className="mt-3 text-xs text-slate-500">
          {pairings} pairing rule{pairings === 1 ? "" : "s"} (like &quot;ASR I can&apos;t open without a manager&quot;) on the{" "}
          <Link href="/positions" className="font-semibold text-blue-700">Positions page</Link>.
        </p>
      )}
    </div>
  );
}
