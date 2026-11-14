"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "../../src/lib/supabase";
import { BUILT_IN_SHIFTS, customShiftToDefinition, type CustomShiftRow, type ShiftDefinition } from "../../src/lib/shifts";
import {
  DAY_NAMES,
  DAY_SHORT,
  EMPTY_DRAFT,
  RULE_DEFINITIONS,
  RULE_GROUPS,
  buildRuleValue,
  definitionFor,
  parseRuleValue,
  type RuleDefinition,
  type RuleDraft,
} from "../../src/lib/ruleCatalog";

type Rule = {
  id: string;
  /** Several saved rows shown as one (e.g. "Tuesday", "Wednesday" preferred days off). */
  mergedIds?: string[];
  employee_id: string | null;
  rule_type: string;
  rule_value: string;
  start_date: string | null;
  end_date: string | null;
};

type Employee = { id: string; employee_name: string; position: string | null };

/** Rule types with their own pages (not shown in this list). */
const HIDDEN_TYPES = ["starter_shifts", "holiday", "employee_order", "positions", "position_requirement", "workday_title_map"];
const EVERYONE = "";

type Editing = {
  id: string | null;
  mergedIds?: string[];
  type: string | null;
  employeeId: string;
  draft: RuleDraft;
  startDate: string;
  endDate: string;
  showDates: boolean;
};

const shortDate = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export default function RulesPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<ShiftDefinition[]>(BUILT_IN_SHIFTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      const [ruleResult, employeeResult, shiftResult] = await Promise.all([
        supabase.from("ai_rules").select("id, employee_id, rule_type, rule_value, start_date, end_date").order("created_at"),
        supabase.from("employees").select("id, employee_name, position").or("status.eq.Active,status.is.null").order("employee_name"),
        supabase.from("shift_templates").select("code, name, start_time, end_time, paid_hours, color").eq("active", true),
      ]);
      if (ruleResult.error) setErrorMessage(ruleResult.error.message);
      setRules(((ruleResult.data as Rule[]) || []).filter((rule) => !HIDDEN_TYPES.includes(rule.rule_type)));
      setEmployees((employeeResult.data as Employee[]) || []);
      if (!shiftResult.error) setShifts([...BUILT_IN_SHIFTS, ...((shiftResult.data || []) as CustomShiftRow[]).map(customShiftToDefinition)]);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (editing) panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [editing?.id, editing?.type, editing]);

  const nameOf = (employeeId: string | null) =>
    employeeId ? employees.find((employee) => employee.id === employeeId)?.employee_name ?? "Former employee" : "Everyone";
  const shiftLabel = (code: string) => shifts.find((shift) => shift.code === code)?.label ?? (code || "a shift");

  function sentenceFor(rule: Rule) {
    const definition = definitionFor(rule.rule_type);
    if (!definition) return `${rule.rule_type.replaceAll("_", " ")}: ${rule.rule_value}`;
    return definition.sentence(parseRuleValue(rule.rule_type, rule.rule_value), nameOf(rule.employee_id), shiftLabel);
  }

  // Group the list: Everyone first, then each person.
  const sections = useMemo(() => {
    const query = search.trim().toLowerCase();
    const visible = rules.filter((rule) => {
      if (filter === "everyone" && rule.employee_id) return false;
      if (filter !== "all" && filter !== "everyone" && rule.employee_id !== filter) return false;
      if (!query) return true;
      const definition = definitionFor(rule.rule_type);
      return [sentenceFor(rule), definition?.title ?? "", nameOf(rule.employee_id)].join(" ").toLowerCase().includes(query);
    });
    // Show several "preferred days off" rows for the same person as one rule.
    const merged: Rule[] = [];
    for (const rule of visible) {
      const twin = rule.rule_type === "preferred_day_off" && !rule.start_date && !rule.end_date
        ? merged.find((other) => other.rule_type === "preferred_day_off" && other.employee_id === rule.employee_id && !other.start_date && !other.end_date)
        : undefined;
      if (twin) {
        const days = parseRuleValue("preferred_day_off", `${twin.rule_value}, ${rule.rule_value}`).days;
        twin.rule_value = buildRuleValue("preferred_day_off", { ...EMPTY_DRAFT, days }).value ?? twin.rule_value;
        twin.mergedIds = [...(twin.mergedIds ?? [twin.id]), rule.id];
      } else merged.push({ ...rule });
    }
    const groups = new Map<string, Rule[]>();
    for (const rule of merged) {
      const key = rule.employee_id ?? EVERYONE;
      groups.set(key, [...(groups.get(key) ?? []), rule]);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => (a === EVERYONE ? -1 : b === EVERYONE ? 1 : nameOf(a).localeCompare(nameOf(b))))
      .map(([key, list]) => ({
        key,
        title: key === EVERYONE ? "Everyone (store-wide)" : nameOf(key),
        rules: list.sort((a, b) => RULE_DEFINITIONS.findIndex((d) => d.type === a.rule_type) - RULE_DEFINITIONS.findIndex((d) => d.type === b.rule_type)),
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rules, employees, shifts, filter, search]);

  function startAdd(employeeId = filter !== "all" && filter !== "everyone" ? filter : EVERYONE) {
    setMessage("");
    setErrorMessage("");
    setEditing({ id: null, type: null, employeeId, draft: EMPTY_DRAFT, startDate: "", endDate: "", showDates: false });
  }

  function startEdit(rule: Rule) {
    setMessage("");
    setErrorMessage("");
    setEditing({
      id: rule.id,
      mergedIds: rule.mergedIds,
      type: rule.rule_type,
      employeeId: rule.employee_id ?? EVERYONE,
      draft: parseRuleValue(rule.rule_type, rule.rule_value),
      startDate: rule.start_date ?? "",
      endDate: rule.end_date ?? "",
      showDates: Boolean(rule.start_date || rule.end_date),
    });
  }

  function chooseType(definition: RuleDefinition) {
    if (!editing) return;
    const employeeId =
      definition.scope === "store" ? EVERYONE : definition.scope === "person" && !editing.employeeId ? employees[0]?.id ?? "" : editing.employeeId;
    const firstShift = shifts[0]?.code ?? "";
    setEditing({ ...editing, type: definition.type, employeeId, draft: { ...EMPTY_DRAFT, shift: firstShift, ...(definition.defaults ?? {}) } });
  }

  async function save() {
    if (!editing?.type) return;
    const definition = definitionFor(editing.type)!;
    if (definition.scope === "person" && !editing.employeeId) {
      setErrorMessage("Choose who this rule is for.");
      return;
    }
    const built = buildRuleValue(editing.type, editing.draft);
    if (built.error) {
      setErrorMessage(built.error);
      return;
    }
    if (editing.startDate && editing.endDate && editing.endDate < editing.startDate) {
      setErrorMessage("The end date is before the start date.");
      return;
    }
    setSaving(true);
    setErrorMessage("");
    const payload = {
      employee_id: editing.employeeId || null,
      rule_type: editing.type,
      rule_value: built.value!,
      start_date: editing.showDates ? editing.startDate || null : null,
      end_date: editing.showDates ? editing.endDate || null : null,
    };
    const result = editing.id
      ? await supabase.from("ai_rules").update(payload).eq("id", editing.id).select("id, employee_id, rule_type, rule_value, start_date, end_date")
      : await supabase.from("ai_rules").insert(payload).select("id, employee_id, rule_type, rule_value, start_date, end_date");
    setSaving(false);
    const saved = (result.data as Rule[] | null)?.[0];
    if (result.error || !saved) {
      setErrorMessage(result.error?.message || "This rule couldn't be saved. Your account may not have permission to change rules. Ask the workspace owner to check access.");
      return;
    }
    const extraIds = (editing.mergedIds ?? []).filter((id) => id !== editing.id);
    if (extraIds.length > 0) await supabase.from("ai_rules").delete().in("id", extraIds);
    setRules((current) =>
      (editing.id ? current.map((rule) => (rule.id === editing.id ? saved : rule)) : [...current, saved]).filter((rule) => !extraIds.includes(rule.id)),
    );
    setMessage(`${editing.id ? "Updated" : "Added"}: ${sentenceFor(saved)}`);
    setEditing(null);
  }

  async function remove(rule: Rule) {
    if (!window.confirm(`Remove this rule?\n\n${sentenceFor(rule)}`)) return;
    setMessage("");
    setErrorMessage("");
    const ids = rule.mergedIds ?? [rule.id];
    const { data, error } = await supabase.from("ai_rules").delete().in("id", ids).select("id");
    if (error || !data?.length) {
      setErrorMessage(error?.message || "This rule couldn't be removed. Your account may not have permission to remove rules.");
      return;
    }
    setRules((current) => current.filter((item) => !ids.includes(item.id)));
    if (editing?.id === rule.id) setEditing(null);
    setMessage(`Removed: ${sentenceFor(rule)}`);
  }

  const definition = editing?.type ? definitionFor(editing.type) : undefined;
  const preview = editing?.type && definition ? definition.sentence(editing.draft, nameOf(editing.employeeId || null), shiftLabel) : "";
  const setDraft = (patch: Partial<RuleDraft>) => editing && setEditing({ ...editing, draft: { ...editing.draft, ...patch } });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-4xl font-bold">Rules</h1>
          <p className="mt-1 text-slate-600">
            How Auto Generate builds the schedule: for everyone, or for one person. The schedule check warns when a rule isn&apos;t met.
          </p>
        </div>
        <button type="button" onClick={() => startAdd()} className="shrink-0 whitespace-nowrap rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700">
          + Add rule
        </button>
      </div>

      {message && <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-green-800">{message}</div>}
      {errorMessage && !editing && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">{errorMessage}</div>
      )}

      {/* Add / edit */}
      {editing && (
        <div ref={panelRef} className="scroll-mt-4 rounded-2xl bg-white p-5 shadow-lg ring-1 ring-blue-200 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-2xl font-bold">{editing.id ? "Edit rule" : "Add a rule"}</h2>
            <button type="button" onClick={() => setEditing(null)} disabled={saving} className="rounded-lg px-3 py-1 text-slate-600 hover:bg-slate-100">Cancel</button>
          </div>

          {/* Step 1: what kind */}
          {!editing.type ? (
            <div className="mt-5 space-y-5">
              <p className="text-sm font-semibold text-slate-700">What kind of rule?</p>
              {RULE_GROUPS.map((group) => (
                <div key={group}>
                  <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">{group}</h3>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {RULE_DEFINITIONS.filter((item) => item.group === group).map((item) => (
                      <button
                        key={item.type}
                        type="button"
                        onClick={() => chooseType(item)}
                        className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 text-left hover:border-blue-400 hover:bg-blue-50"
                      >
                        <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-lg text-blue-700">{item.icon}</span>
                        <span>
                          <span className="block font-semibold">{item.title}</span>
                          <span className="block text-xs text-slate-500">{item.help}</span>
                          <span className="mt-1 block text-[11px] font-medium text-slate-400">
                            {item.scope === "store" ? "Store-wide" : item.scope === "person" ? "One person" : "Everyone or one person"}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : definition && (
            <div className="mt-5 space-y-5">
              <div className="flex items-center gap-3">
                <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-lg text-white">{definition.icon}</span>
                <div>
                  <div className="font-bold">{definition.title}</div>
                  <div className="text-sm text-slate-500">{definition.help}</div>
                </div>
                {!editing.id && (
                  <button type="button" onClick={() => setEditing({ ...editing, type: null })} className="ml-auto text-sm font-semibold text-blue-700">Change</button>
                )}
              </div>

              {/* Who */}
              {definition.scope !== "store" && (
                <Field label="Who is it for?">
                  <select
                    value={editing.employeeId}
                    onChange={(e) => setEditing({ ...editing, employeeId: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 sm:w-72"
                  >
                    {definition.scope === "either" && <option value={EVERYONE}>Everyone</option>}
                    {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.employee_name}</option>)}
                  </select>
                  {definition.scope === "either" && editing.employeeId === EVERYONE && (
                    <p className="mt-1 text-xs text-slate-500">A rule for one person replaces this one for them.</p>
                  )}
                </Field>
              )}

              {/* Details */}
              {definition.editor === "number" && (
                <Field label={definition.title}>
                  <Stepper value={editing.draft.number} min={definition.min ?? 0} max={definition.max ?? 99} step={definition.step ?? 1} unit={definition.unit} onChange={(number) => setDraft({ number })} />
                </Field>
              )}
              {definition.editor === "days" && (
                <Field label={definition.type === "preferred_day_off" ? "Which days? (they'll get one of these off each week)" : "Which days?"}>
                  <DayPicker value={editing.draft.days} onChange={(days) => setDraft({ days })} />
                </Field>
              )}
              {(definition.editor === "shift" || definition.editor === "dayShift" || definition.editor === "shiftDays") && (
                <div className="flex flex-wrap gap-5">
                  {definition.editor === "dayShift" && (
                    <Field label="Day">
                      <select value={editing.draft.day} onChange={(e) => setDraft({ day: Number(e.target.value) })} className="rounded-lg border border-slate-300 px-3 py-2">
                        {DAY_NAMES.map((name, index) => <option key={name} value={index}>{name}</option>)}
                      </select>
                    </Field>
                  )}
                  <Field label="Shift">
                    <select value={editing.draft.shift} onChange={(e) => setDraft({ shift: e.target.value })} className="rounded-lg border border-slate-300 px-3 py-2">
                      {!shifts.some((shift) => shift.code === editing.draft.shift) && editing.draft.shift && <option value={editing.draft.shift}>{editing.draft.shift} (no longer offered)</option>}
                      {shifts.map((shift) => <option key={shift.code} value={shift.code}>{shift.label}</option>)}
                    </select>
                  </Field>
                </div>
              )}
              {definition.editor === "shiftDays" && (
                <Field label={definition.type === "allowed_days_for_shift" ? "Only on these days" : "Never on these days"}>
                  <DayPicker value={editing.draft.days} onChange={(days) => setDraft({ days })} />
                </Field>
              )}
              {definition.editor === "dayCount" && (
                <div className="flex flex-wrap items-end gap-5">
                  <Field label="Day">
                    <select value={editing.draft.day} onChange={(e) => setDraft({ day: Number(e.target.value) })} className="rounded-lg border border-slate-300 px-3 py-2">
                      {DAY_NAMES.map((name, index) => <option key={name} value={index}>{name}s</option>)}
                    </select>
                  </Field>
                  <Field label="Times a month (0 = avoid)">
                    <Stepper value={editing.draft.number} min={0} max={6} step={1} unit="per month" onChange={(number) => setDraft({ number })} />
                  </Field>
                </div>
              )}
              {definition.editor === "pattern" && (
                <Field label="Prefers">
                  <div className="grid gap-2 sm:grid-cols-2">
                    {([["Together", "Back-to-back", "e.g. Thu, Fri, Sat"], ["Apart", "Spread out", "never two nights in a row"]] as const).map(([value, title, text]) => (
                      <button key={value} type="button" onClick={() => setDraft({ pattern: value })} className={`rounded-xl border p-3 text-left ${editing.draft.pattern === value ? "border-blue-600 bg-blue-50 ring-2 ring-blue-200" : "border-slate-200"}`}>
                        <div className="font-semibold">{title}</div>
                        <div className="text-xs text-slate-500">{text}</div>
                      </button>
                    ))}
                  </div>
                </Field>
              )}
              {definition.editor === "text" && (
                <Field label="Note">
                  <textarea value={editing.draft.text} onChange={(e) => setDraft({ text: e.target.value })} rows={3} className="w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="e.g. Ask before scheduling Shundra on the first Saturday" />
                </Field>
              )}

              {/* Dates */}
              <div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={editing.showDates} onChange={(e) => setEditing({ ...editing, showDates: e.target.checked })} />
                  Only for certain dates
                </label>
                {editing.showDates && (
                  <div className="mt-2 flex flex-wrap gap-3">
                    <Field label="From"><input type="date" value={editing.startDate} onChange={(e) => setEditing({ ...editing, startDate: e.target.value })} className="rounded-lg border border-slate-300 px-3 py-2" /></Field>
                    <Field label="Until"><input type="date" value={editing.endDate} onChange={(e) => setEditing({ ...editing, endDate: e.target.value })} className="rounded-lg border border-slate-300 px-3 py-2" /></Field>
                  </div>
                )}
              </div>

              {/* Preview + save */}
              <div className="rounded-xl bg-slate-900 p-4 text-white">
                <div className="text-xs font-semibold uppercase tracking-wide text-blue-300">This rule says</div>
                <div className="mt-1 text-lg font-semibold">{preview}</div>
                {editing.showDates && (editing.startDate || editing.endDate) && (
                  <div className="mt-1 text-sm text-slate-300">
                    {editing.startDate ? `From ${shortDate(editing.startDate)}` : "Until"} {editing.endDate ? `${editing.startDate ? "until " : ""}${shortDate(editing.endDate)}` : "on"}
                  </div>
                )}
              </div>
              {errorMessage && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{errorMessage}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={() => void save()} disabled={saving} className="rounded-lg bg-blue-600 px-5 py-2.5 font-semibold text-white disabled:opacity-50">
                  {saving ? "Saving…" : editing.id ? "Save rule" : "Add rule"}
                </button>
                <button type="button" onClick={() => setEditing(null)} disabled={saving} className="rounded-lg border border-slate-300 px-4 py-2.5 font-medium">Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 sm:w-60">
          <option value="all">All rules</option>
          <option value="everyone">Store-wide only</option>
          {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.employee_name}</option>)}
        </select>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search rules…" className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2" />
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">{[0, 1, 2].map((item) => <div key={item} className="h-20 animate-pulse rounded-xl bg-white shadow-sm" />)}</div>
      ) : sections.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="text-slate-600">{rules.length === 0 ? "No rules yet." : "No rules match."}</p>
          <button type="button" onClick={() => startAdd()} className="mt-3 rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white">+ Add rule</button>
        </div>
      ) : (
        sections.map((section) => (
          <section key={section.key} className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold">{section.title}</h2>
              <button type="button" onClick={() => startAdd(section.key)} className="text-sm font-semibold text-blue-700">+ Add for {section.key === EVERYONE ? "everyone" : section.title}</button>
            </div>
            <ul className="divide-y">
              {section.rules.map((rule) => {
                const item = definitionFor(rule.rule_type);
                return (
                  <li key={rule.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700">{item?.icon ?? "•"}</span>
                      <div className="min-w-0">
                        <div className="font-medium">{sentenceFor(rule)}</div>
                        <div className="text-xs text-slate-500">
                          {item?.title ?? rule.rule_type}
                          {(rule.start_date || rule.end_date) && ` · ${rule.start_date ? shortDate(rule.start_date) : "…"} – ${rule.end_date ? shortDate(rule.end_date) : "…"}`}
                          {rule.rule_type === "custom" && " · not used by Auto Generate"}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2 pl-11 sm:pl-0">
                      <button type="button" onClick={() => startEdit(rule)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50">Edit</button>
                      <button type="button" onClick={() => void remove(rule)} className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50">Remove</button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      <p className="text-sm text-slate-500">
        Also see: <Link href="/positions" className="font-semibold text-blue-700">Positions</Link> (who can open/close with whom),{" "}
        <Link href="/holidays" className="font-semibold text-blue-700">Holidays</Link>,{" "}
        <Link href="/shifts" className="font-semibold text-blue-700">Shifts</Link> and{" "}
        <Link href="/settings" className="font-semibold text-blue-700">Settings</Link>.
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-sm font-semibold text-slate-700">{label}</div>
      {children}
    </div>
  );
}

function DayPicker({ value, onChange }: { value: number[]; onChange: (days: number[]) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {DAY_SHORT.map((label, index) => {
        const on = value.includes(index);
        return (
          <button
            key={label}
            type="button"
            onClick={() => onChange(on ? value.filter((day) => day !== index) : [...value, index].sort())}
            className={`h-10 min-w-14 rounded-lg px-3 text-sm font-semibold ring-1 ${on ? "bg-blue-600 text-white ring-blue-600" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"}`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function Stepper({ value, min, max, step, unit, onChange }: { value: number; min: number; max: number; step: number; unit?: string; onChange: (value: number) => void }) {
  const clamp = (next: number) => Math.min(max, Math.max(min, Math.round(next / step) * step));
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={() => onChange(clamp(value - step))} className="h-10 w-10 rounded-lg border border-slate-300 text-lg font-bold hover:bg-slate-50" aria-label="Less">−</button>
      <input type="number" value={value} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))} className="h-10 w-20 rounded-lg border border-slate-300 text-center text-lg font-semibold" />
      <button type="button" onClick={() => onChange(clamp(value + step))} className="h-10 w-10 rounded-lg border border-slate-300 text-lg font-bold hover:bg-slate-50" aria-label="More">+</button>
      {unit && <span className="text-sm text-slate-500">{unit}</span>}
    </div>
  );
}
