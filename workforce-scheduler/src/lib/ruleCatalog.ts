// Every rule the Rules page can add: what it means in plain English, who it
// can apply to, how it's edited, and how it's stored (ai_rules.rule_value keeps
// the same formats as before, so Auto Generate and the schedule check read
// existing rules unchanged).

export const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type RuleScope = "store" | "person" | "either";
export type EditorKind = "number" | "days" | "shift" | "dayShift" | "shiftDays" | "dayCount" | "pattern" | "text";

/** Everything an editor can hold; each rule uses some of it. */
export type RuleDraft = {
  number: number;
  days: number[];
  day: number;
  shift: string;
  pattern: "Together" | "Apart";
  text: string;
};

export const EMPTY_DRAFT: RuleDraft = { number: 1, days: [], day: 5, shift: "", pattern: "Together", text: "" };

export type RuleDefinition = {
  type: string;
  group: "Staffing" | "Days off" | "Shifts" | "Opening & closing" | "Other";
  icon: string;
  title: string;
  /** One line under the title in the picker. */
  help: string;
  scope: RuleScope;
  editor: EditorKind;
  /** Number editor: unit and limits. */
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  defaults?: Partial<RuleDraft>;
  /** Plain sentence for the list, e.g. "Sed prefers a day off on Tue, Wed or Thu." */
  sentence: (draft: RuleDraft, who: string, shiftLabel: (code: string) => string) => string;
};

const orList = (items: string[]) =>
  items.length <= 1 ? items[0] ?? "" : `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
const andList = (items: string[]) =>
  items.length <= 1 ? items[0] ?? "" : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
const dayList = (days: number[], joiner = andList) => joiner([...days].sort().map((day) => DAY_SHORT[day]));
const plural = (count: number, word: string) => `${count} ${count === 1 ? word : word === "person" ? "people" : `${word}s`}`;
const subject = (who: string) => (who === "Everyone" ? "Everyone" : who);

export const RULE_DEFINITIONS: RuleDefinition[] = [
  // Staffing (store-wide numbers)
  { type: "openers_per_day", group: "Staffing", icon: "☀", title: "Openers per day", help: "How many people open each day.", scope: "store", editor: "number", unit: "people", min: 0, max: 10, defaults: { number: 2 }, sentence: (d) => `${plural(d.number, "person")} open each day.` },
  { type: "closers_per_day", group: "Staffing", icon: "☾", title: "Closers per day", help: "How many people close each day.", scope: "store", editor: "number", unit: "people", min: 0, max: 10, defaults: { number: 2 }, sentence: (d) => `${plural(d.number, "person")} close each day.` },
  { type: "target_hours", group: "Staffing", icon: "◷", title: "Weekly hours target", help: "Hours each person should get per week.", scope: "store", editor: "number", unit: "hours", min: 0, max: 80, step: 0.25, defaults: { number: 40 }, sentence: (d) => `Aim for ${d.number} hours a week per person.` },
  { type: "days_off_per_week", group: "Staffing", icon: "☐", title: "Days off per week", help: "Days off each person gets every week.", scope: "store", editor: "number", unit: "days", min: 0, max: 6, defaults: { number: 1 }, sentence: (d) => `Everyone gets ${plural(d.number, "day")} off each week.` },
  { type: "saturday_off_goal", group: "Staffing", icon: "★", title: "Saturdays off per month", help: "Saturdays off each person gets every month.", scope: "store", editor: "number", unit: "Saturdays", min: 0, max: 5, defaults: { number: 1 }, sentence: (d) => `Everyone gets at least ${plural(d.number, "Saturday")} off each month.` },
  { type: "manager_saturday_goal", group: "Staffing", icon: "◆", title: "Managers working Saturday", help: "How many managers should work each Saturday.", scope: "store", editor: "number", unit: "managers", min: 0, max: 5, defaults: { number: 1 }, sentence: (d) => `${plural(d.number, "manager")} work${d.number === 1 ? "s" : ""} each Saturday.` },

  // Days off
  { type: "preferred_day_off", group: "Days off", icon: "☺", title: "Preferred days off", help: "The weekly day off goes on one of these days.", scope: "either", editor: "days", defaults: { days: [1, 2, 3] }, sentence: (d, who) => `${subject(who)} prefer${who === "Everyone" ? "s" : "s"} a day off on ${dayList(d.days, orList)}.` },
  { type: "unavailable", group: "Days off", icon: "⊘", title: "Can't work these days", help: "Never scheduled on these days.", scope: "person", editor: "days", defaults: { days: [] }, sentence: (d, who) => `${who} can't work ${dayList(d.days)}.` },
  { type: "availability", group: "Days off", icon: "✓", title: "Only works these days", help: "Only scheduled on these days.", scope: "person", editor: "days", defaults: { days: [0, 1, 2, 3, 4] }, sentence: (d, who) => `${who} only works ${dayList(d.days)}.` },

  // Shifts
  { type: "required_shift", group: "Shifts", icon: "⚑", title: "Always works a shift on a day", help: "Same shift every week on one day.", scope: "person", editor: "dayShift", sentence: (d, who, label) => `${who} always works ${label(d.shift)} on ${DAY_NAMES[d.day]}s.` },
  { type: "preferred_shift", group: "Shifts", icon: "♥", title: "Prefers a shift", help: "Gets this shift (opening or closing) when possible.", scope: "person", editor: "shift", sentence: (d, who, label) => `${who} prefers the ${label(d.shift)} shift.` },
  { type: "allowed_days_for_shift", group: "Shifts", icon: "▣", title: "Shift only on certain days", help: "A shift is used on these days and no others.", scope: "store", editor: "shiftDays", sentence: (d, _who, label) => `The ${label(d.shift)} shift is only used on ${dayList(d.days)}.` },
  { type: "blocked_days_for_shift", group: "Shifts", icon: "⊟", title: "Shift never on certain days", help: "A shift is never used on these days.", scope: "store", editor: "shiftDays", sentence: (d, _who, label) => `The ${label(d.shift)} shift is never used on ${dayList(d.days)}.` },

  // Opening & closing
  { type: "monthly_close_target", group: "Opening & closing", icon: "☾", title: "Closes per month on a day", help: "e.g. close about 1 Saturday a month (0 = avoid).", scope: "either", editor: "dayCount", defaults: { day: 5, number: 1 }, sentence: (d, who) => (d.number === 0 ? `${subject(who)} avoid${who === "Everyone" ? "s" : "s"} closing on ${DAY_NAMES[d.day]}s.` : `${subject(who)} close${who === "Everyone" ? "s" : "s"} about ${plural(d.number, DAY_NAMES[d.day])} a month.`) },
  { type: "monthly_open_target", group: "Opening & closing", icon: "☀", title: "Opens per month on a day", help: "e.g. open about 2 Mondays a month (0 = avoid).", scope: "either", editor: "dayCount", defaults: { day: 0, number: 2 }, sentence: (d, who) => (d.number === 0 ? `${subject(who)} avoid${who === "Everyone" ? "s" : "s"} opening on ${DAY_NAMES[d.day]}s.` : `${subject(who)} open${who === "Everyone" ? "s" : "s"} about ${plural(d.number, DAY_NAMES[d.day])} a month.`) },
  { type: "avoid_closing_days", group: "Opening & closing", icon: "☒", title: "Prefers not to close on", help: "Avoids closing these days when possible.", scope: "person", editor: "days", defaults: { days: [3] }, sentence: (d, who) => `${who} prefers not to close on ${dayList(d.days, orList)}.` },
  { type: "closing_pattern", group: "Opening & closing", icon: "⇄", title: "Back-to-back or spread-out closes", help: "Closing shifts together (Thu–Fri–Sat) or apart.", scope: "person", editor: "pattern", sentence: (d, who) => (d.pattern === "Together" ? `${who} prefers closing shifts back-to-back.` : `${who} prefers closing shifts spread out.`) },

  // Other
  { type: "custom", group: "Other", icon: "✎", title: "Note", help: "A reminder for managers. Auto Generate doesn't use it.", scope: "either", editor: "text", sentence: (d, who) => `${who === "Everyone" ? "" : `${who}: `}${d.text}` },
];

export const RULE_GROUPS: RuleDefinition["group"][] = ["Staffing", "Days off", "Shifts", "Opening & closing", "Other"];

export function definitionFor(type: string): RuleDefinition | undefined {
  return RULE_DEFINITIONS.find((definition) => definition.type === type);
}

function dayIndex(text: string): number | null {
  const value = text.trim().toLowerCase().replace(/\.$/, "");
  if (value.length < 3) return null;
  const index = DAY_NAMES.findIndex((name) => name.toLowerCase().startsWith(value));
  return index >= 0 ? index : null;
}

function parseDays(text: string): number[] {
  return [...new Set(text.split(/[,|/]|\band\b/).map(dayIndex).filter((day): day is number => day !== null))].sort();
}

/** Stored rule_value → editor draft. */
export function parseRuleValue(type: string, value: string): RuleDraft {
  const definition = definitionFor(type);
  const draft: RuleDraft = { ...EMPTY_DRAFT, ...(definition?.defaults ?? {}) };
  const text = (value || "").trim();
  switch (definition?.editor) {
    case "number":
      return { ...draft, number: Number(text) || 0 };
    case "days":
      return { ...draft, days: parseDays(text) };
    case "shift":
      return { ...draft, shift: text };
    case "dayShift": {
      const [day, shift] = text.split("|");
      return { ...draft, day: dayIndex(day || "") ?? 0, shift: (shift || "").trim() };
    }
    case "shiftDays": {
      const [shift, days] = text.split("|");
      return { ...draft, shift: (shift || "").trim(), days: parseDays(days || "") };
    }
    case "dayCount": {
      const [day, count] = text.split("|");
      return { ...draft, day: dayIndex(day || "") ?? 5, number: Number(count) || 0 };
    }
    case "pattern":
      return { ...draft, pattern: /apart|spread/i.test(text) ? "Apart" : "Together" };
    default:
      return { ...draft, text };
  }
}

/** Editor draft → stored rule_value (same formats as before), or an error message. */
export function buildRuleValue(type: string, draft: RuleDraft): { value?: string; error?: string } {
  const definition = definitionFor(type);
  const days = [...draft.days].sort().map((day) => DAY_NAMES[day]);
  switch (definition?.editor) {
    case "number":
      if (!Number.isFinite(draft.number) || draft.number < (definition.min ?? 0)) return { error: "Enter a number." };
      return { value: String(draft.number) };
    case "days":
      if (days.length === 0) return { error: "Pick at least one day." };
      return { value: days.join(", ") };
    case "shift":
      if (!draft.shift) return { error: "Pick a shift." };
      return { value: draft.shift };
    case "dayShift":
      if (!draft.shift) return { error: "Pick a shift." };
      return { value: `${DAY_NAMES[draft.day]}|${draft.shift}` };
    case "shiftDays":
      if (!draft.shift) return { error: "Pick a shift." };
      if (days.length === 0) return { error: "Pick at least one day." };
      return { value: `${draft.shift}|${days.join(",")}` };
    case "dayCount":
      if (!Number.isInteger(draft.number) || draft.number < 0 || draft.number > 6) return { error: "Use a whole number from 0 to 6." };
      return { value: `${DAY_NAMES[draft.day]}|${draft.number}` };
    case "pattern":
      return { value: draft.pattern };
    default:
      if (!draft.text.trim()) return { error: "Write the note." };
      return { value: draft.text.trim() };
  }
}
