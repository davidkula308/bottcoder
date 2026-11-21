// Built-in "practice code" writer: works with no AI, no internet and nothing installed.
// It combines domains, program shapes and languages so it keeps writing different, realistic code.

type Kind = "str" | "int" | "float" | "bool" | "date";
type Field = [name: string, kind: Kind];
interface Domain {
  entity: string;
  plural: string;
  fields: Field[];
}

const DOMAINS: Domain[] = [
  { entity: "Invoice", plural: "invoices", fields: [["number", "str"], ["customer", "str"], ["amount", "float"], ["paid", "bool"], ["dueDate", "date"], ["taxRate", "float"]] },
  { entity: "Sensor", plural: "sensors", fields: [["code", "str"], ["location", "str"], ["temperature", "float"], ["humidity", "float"], ["active", "bool"], ["lastSeen", "date"]] },
  { entity: "Order", plural: "orders", fields: [["orderId", "str"], ["items", "int"], ["total", "float"], ["shipped", "bool"], ["createdAt", "date"], ["priority", "int"]] },
  { entity: "Ticket", plural: "tickets", fields: [["title", "str"], ["assignee", "str"], ["severity", "int"], ["open", "bool"], ["createdAt", "date"], ["estimateHours", "float"]] },
  { entity: "Track", plural: "tracks", fields: [["title", "str"], ["artist", "str"], ["durationSec", "int"], ["rating", "float"], ["explicit", "bool"], ["releasedAt", "date"]] },
  { entity: "Book", plural: "books", fields: [["title", "str"], ["author", "str"], ["pages", "int"], ["price", "float"], ["inStock", "bool"], ["publishedAt", "date"]] },
  { entity: "Shipment", plural: "shipments", fields: [["trackingCode", "str"], ["destination", "str"], ["weightKg", "float"], ["delivered", "bool"], ["eta", "date"], ["stops", "int"]] },
  { entity: "Player", plural: "players", fields: [["username", "str"], ["level", "int"], ["score", "int"], ["accuracy", "float"], ["banned", "bool"], ["joinedAt", "date"]] },
  { entity: "Recipe", plural: "recipes", fields: [["name", "str"], ["cuisine", "str"], ["servings", "int"], ["calories", "float"], ["vegetarian", "bool"], ["prepMinutes", "int"]] },
  { entity: "Flight", plural: "flights", fields: [["code", "str"], ["origin", "str"], ["destination", "str"], ["seats", "int"], ["fare", "float"], ["cancelled", "bool"], ["departsAt", "date"]] },
  { entity: "Device", plural: "devices", fields: [["serial", "str"], ["model", "str"], ["batteryPct", "int"], ["firmware", "str"], ["online", "bool"], ["lastSync", "date"]] },
  { entity: "Account", plural: "accounts", fields: [["owner", "str"], ["balance", "float"], ["frozen", "bool"], ["openedAt", "date"], ["overdraftLimit", "float"]] },
  { entity: "Employee", plural: "employees", fields: [["fullName", "str"], ["department", "str"], ["salary", "float"], ["remote", "bool"], ["hiredAt", "date"], ["level", "int"]] },
  { entity: "Parcel", plural: "parcels", fields: [["label", "str"], ["sender", "str"], ["weightKg", "float"], ["fragile", "bool"], ["sentAt", "date"], ["zone", "int"]] },
  { entity: "Reading", plural: "readings", fields: [["meterId", "str"], ["kwh", "float"], ["peak", "bool"], ["takenAt", "date"], ["phase", "int"]] },
  { entity: "Course", plural: "courses", fields: [["title", "str"], ["teacher", "str"], ["credits", "int"], ["fee", "float"], ["online", "bool"], ["startsOn", "date"]] },
];

const SHAPES = ["model", "repository", "report", "validator", "pipeline", "tests"] as const;
const ALGOS = ["binarySearch", "mergeSort", "lruCache", "tokenBucket", "trie", "levenshtein", "bfsGrid", "movingAverage", "runLength", "topK"] as const;
const LANGS = ["python", "typescript", "javascript", "go", "rust", "java"] as const;
type Lang = (typeof LANGS)[number];
type Shape = (typeof SHAPES)[number];

/** Which shapes each language can write. */
const SUPPORT: Record<Lang, (Shape | "algo")[]> = {
  python: ["model", "repository", "report", "validator", "pipeline", "tests", "algo"],
  typescript: ["model", "repository", "report", "validator", "pipeline", "tests"],
  javascript: ["model", "repository", "report", "pipeline", "algo"],
  go: ["model", "repository", "report"],
  rust: ["model", "repository", "report"],
  java: ["model", "repository", "report"],
};

export interface PracticeSnippet {
  filename: string;
  language: string;
  code: string;
  /** Unique key: never written twice. */
  signature: string;
}

/* ---------- naming helpers ---------- */
const words = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[\s_-]+/).filter(Boolean);
const snake = (s: string) => words(s).join("_");
const camel = (s: string) => words(s).map((w, i) => (i ? w[0]!.toUpperCase() + w.slice(1) : w)).join("");
const pascal = (s: string) => words(s).map((w) => w[0]!.toUpperCase() + w.slice(1)).join("");
const kebab = (s: string) => words(s).join("-");

const SAMPLE_STR = ["alpha", "north", "atlas", "nova", "delta", "harbor", "maple", "orbit", "cedar", "lumen", "pixel", "zephyr"];
function sample(kind: Kind, rand: () => number, i: number): string | number | boolean {
  switch (kind) {
    case "str": return `${SAMPLE_STR[Math.floor(rand() * SAMPLE_STR.length)]}-${100 + i * 7}`;
    case "int": return 1 + Math.floor(rand() * 90);
    case "float": return Math.round(rand() * 50000) / 100;
    case "bool": return rand() < 0.5;
    case "date": return `2026-${String(1 + Math.floor(rand() * 12)).padStart(2, "0")}-${String(1 + Math.floor(rand() * 28)).padStart(2, "0")}`;
  }
}
const num = (f: Field) => f[1] === "int" || f[1] === "float";

/* ---------- literal + type maps ---------- */
function lit(lang: Lang, kind: Kind, v: string | number | boolean): string {
  if (kind === "bool") return lang === "python" ? (v ? "True" : "False") : String(v);
  if (kind === "str") return lang === "rust" ? `"${v}".to_string()` : `"${v}"`;
  if (kind === "date") {
    if (lang === "python") return `date.fromisoformat("${v}")`;
    if (lang === "typescript" || lang === "javascript") return `new Date("${v}")`;
    if (lang === "go") return `mustDate("${v}")`;
    if (lang === "java") return `LocalDate.parse("${v}")`;
    return `"${v}".to_string()`;
  }
  if (kind === "float") return Number.isInteger(v) ? `${v}.0` : String(v);
  return String(v);
}
const TYPES: Record<Lang, Record<Kind, string>> = {
  python: { str: "str", int: "int", float: "float", bool: "bool", date: "date" },
  typescript: { str: "string", int: "number", float: "number", bool: "boolean", date: "Date" },
  javascript: { str: "", int: "", float: "", bool: "", date: "" },
  go: { str: "string", int: "int", float: "float64", bool: "bool", date: "time.Time" },
  rust: { str: "String", int: "i64", float: "f64", bool: "bool", date: "String" },
  java: { str: "String", int: "int", float: "double", bool: "boolean", date: "LocalDate" },
};
const EXT: Record<Lang, string> = { python: "py", typescript: "ts", javascript: "js", go: "go", rust: "rs", java: "java" };

interface Ctx {
  d: Domain;
  fields: Field[];
  numField: Field;
  sortField: Field;
  flag: Field | undefined;
  rows: (string | number | boolean)[][];
  limit: number;
  lang: Lang;
}

const nameFor = (lang: Lang, f: Field) => (lang === "python" || lang === "rust" ? snake(f[0]) : lang === "go" ? pascal(f[0]) : camel(f[0]));
const rowLits = (c: Ctx, row: (string | number | boolean)[]) => c.fields.map((f, i) => lit(c.lang, f[1], row[i]!));

/* ---------- shapes ---------- */
function model(c: Ctx): string {
  const E = c.d.entity;
  const n = (f: Field) => nameFor(c.lang, f);
  const nf = n(c.numField);
  switch (c.lang) {
    case "python":
      return `"""${E} record with validation and a readable summary."""
from dataclasses import dataclass, asdict
from datetime import date


@dataclass
class ${E}:
${c.fields.map((f) => `    ${n(f)}: ${TYPES.python[f[1]]}`).join("\n")}

    def __post_init__(self) -> None:
        if self.${nf} < 0:
            raise ValueError("${snake(c.numField[0]).replace(/_/g, " ")} cannot be negative")

    def summary(self) -> str:
        return f"${E}(${c.fields.slice(0, 3).map((f) => `${n(f)}={self.${n(f)}}`).join(", ")})"

    def to_dict(self) -> dict:
        data = asdict(self)
${c.fields.filter((f) => f[1] === "date").map((f) => `        data["${n(f)}"] = self.${n(f)}.isoformat()`).join("\n") || "        # nothing to convert"}
        return data


if __name__ == "__main__":
    item = ${E}(${rowLits(c, c.rows[0]!).join(", ")})
    print(item.summary())
    print(item.to_dict())
`;
    case "typescript":
    case "javascript": {
      const ts = c.lang === "typescript";
      return `// ${E} model with validation and JSON helpers.
${ts ? `export interface ${E}Data {\n${c.fields.map((f) => `  ${n(f)}: ${TYPES.typescript[f[1]]};`).join("\n")}\n}\n\n` : ""}export class ${E} {
${ts ? c.fields.map((f) => `  readonly ${n(f)}: ${TYPES.typescript[f[1]]};`).join("\n") + "\n\n" : ""}  constructor(data${ts ? `: ${E}Data` : ""}) {
    if (data.${nf} < 0) throw new RangeError("${nf} cannot be negative");
${c.fields.map((f) => `    this.${n(f)} = data.${n(f)};`).join("\n")}
  }

  summary()${ts ? ": string" : ""} {
    return \`${E}(${c.fields.slice(0, 3).map((f) => `${n(f)}=\${this.${n(f)}}`).join(", ")})\`;
  }

  toJSON()${ts ? `: Record<string, unknown>` : ""} {
    return {
${c.fields.map((f) => `      ${n(f)}: this.${n(f)}${f[1] === "date" ? ".toISOString().slice(0, 10)" : ""},`).join("\n")}
    };
  }
}

const sample = new ${E}({ ${c.fields.map((f, i) => `${n(f)}: ${lit(c.lang, f[1], c.rows[0]![i]!)}`).join(", ")} });
console.log(sample.summary());
console.log(JSON.stringify(sample));
`;
    }
    case "go":
      return `// ${E} model with validation.
package main

import (
	"errors"
	"fmt"
	"time"
)

type ${E} struct {
${c.fields.map((f) => `	${n(f)} ${TYPES.go[f[1]]}`).join("\n")}
}

func (x ${E}) Validate() error {
	if x.${nf} < 0 {
		return errors.New("${camel(c.numField[0])} cannot be negative")
	}
	return nil
}

func (x ${E}) String() string {
	return fmt.Sprintf("${E}(${c.fields.slice(0, 3).map((f) => `${f[0]}=%v`).join(", ")})", ${c.fields.slice(0, 3).map((f) => `x.${n(f)}`).join(", ")})
}

func mustDate(s string) time.Time {
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		panic(err)
	}
	return t
}

func main() {
	item := ${E}{${rowLits(c, c.rows[0]!).join(", ")}}
	if err := item.Validate(); err != nil {
		fmt.Println("invalid:", err)
		return
	}
	fmt.Println(item)
}
`;
    case "rust":
      return `// ${E} model with validation.
#[derive(Debug, Clone)]
struct ${E} {
${c.fields.map((f) => `    ${n(f)}: ${TYPES.rust[f[1]]},`).join("\n")}
}

impl ${E} {
    fn validate(&self) -> Result<(), String> {
        if self.${nf} < ${c.numField[1] === "float" ? "0.0" : "0"} {
            return Err("${snake(c.numField[0])} cannot be negative".into());
        }
        Ok(())
    }

    fn summary(&self) -> String {
        format!("${E}(${c.fields.slice(0, 3).map((f) => `${n(f)}={:?}`).join(", ")})", ${c.fields.slice(0, 3).map((f) => `self.${n(f)}`).join(", ")})
    }
}

fn main() {
    let item = ${E} { ${c.fields.map((f, i) => `${n(f)}: ${lit("rust", f[1], c.rows[0]![i]!)}`).join(", ")} };
    match item.validate() {
        Ok(()) => println!("{}", item.summary()),
        Err(e) => eprintln!("invalid: {e}"),
    }
}
`;
    case "java":
      return `// ${E} record with validation.
import java.time.LocalDate;

public class ${E}App {
    record ${E}(${c.fields.map((f) => `${TYPES.java[f[1]]} ${n(f)}`).join(", ")}) {
        ${E} {
            if (${nf} < 0) throw new IllegalArgumentException("${nf} cannot be negative");
        }

        String summary() {
            return "${E}(" + ${c.fields.slice(0, 3).map((f) => `"${n(f)}=" + ${n(f)}`).join(' + ", " + ')} + ")";
        }
    }

    public static void main(String[] args) {
        var item = new ${E}(${rowLits(c, c.rows[0]!).join(", ")});
        System.out.println(item.summary());
    }
}
`;
  }
}

function repository(c: Ctx): string {
  const E = c.d.entity;
  const P = pascal(c.d.plural);
  const n = (f: Field) => nameFor(c.lang, f);
  const key = n(c.fields[0]!);
  const sf = n(c.sortField);
  switch (c.lang) {
    case "python":
      return `"""In-memory store for ${c.d.plural} with add, find, update and remove."""
from dataclasses import dataclass, replace
from datetime import date
from typing import Callable, Iterable


@dataclass(frozen=True)
class ${E}:
${c.fields.map((f) => `    ${n(f)}: ${TYPES.python[f[1]]}`).join("\n")}


class ${E}Store:
    def __init__(self, items: Iterable[${E}] = ()) -> None:
        self._items: dict[str, ${E}] = {}
        for item in items:
            self.add(item)

    def add(self, item: ${E}) -> None:
        if item.${key} in self._items:
            raise KeyError(f"{item.${key}} already exists")
        self._items[item.${key}] = item

    def get(self, key: str) -> ${E} | None:
        return self._items.get(key)

    def update(self, key: str, **changes) -> ${E}:
        updated = replace(self._items[key], **changes)
        self._items[key] = updated
        return updated

    def remove(self, key: str) -> bool:
        return self._items.pop(key, None) is not None

    def where(self, test: Callable[[${E}], bool]) -> list[${E}]:
        return [i for i in self._items.values() if test(i)]

    def sorted_by_${sf}(self, reverse: bool = False) -> list[${E}]:
        return sorted(self._items.values(), key=lambda i: i.${sf}, reverse=reverse)

    def __len__(self) -> int:
        return len(self._items)


if __name__ == "__main__":
    store = ${E}Store([
${c.rows.map((r) => `        ${E}(${rowLits(c, r).join(", ")}),`).join("\n")}
    ])
    print(f"{len(store)} ${c.d.plural} stored")
    for item in store.sorted_by_${sf}(reverse=True)[:${c.limit}]:
        print(" -", item.${key}, item.${sf})
`;
    case "typescript":
    case "javascript": {
      const ts = c.lang === "typescript";
      return `// In-memory ${c.d.plural} repository.
${ts ? `interface ${E} {\n${c.fields.map((f) => `  ${n(f)}: ${TYPES.typescript[f[1]]};`).join("\n")}\n}\n\n` : ""}class ${P}Repository {
  ${ts ? "private items = new Map<string, " + E + ">();" : "#items = new Map();"}

  add(item${ts ? `: ${E}` : ""})${ts ? ": void" : ""} {
    if (this.${ts ? "items" : "#items"}.has(item.${key})) throw new Error(\`\${item.${key}} already exists\`);
    this.${ts ? "items" : "#items"}.set(item.${key}, item);
  }

  get(key${ts ? ": string" : ""})${ts ? `: ${E} | undefined` : ""} {
    return this.${ts ? "items" : "#items"}.get(key);
  }

  update(key${ts ? ": string" : ""}, changes${ts ? `: Partial<${E}>` : ""})${ts ? `: ${E}` : ""} {
    const current = this.${ts ? "items" : "#items"}.get(key);
    if (!current) throw new Error(\`no ${c.d.entity.toLowerCase()} \${key}\`);
    const next = { ...current, ...changes };
    this.${ts ? "items" : "#items"}.set(key, next);
    return next;
  }

  remove(key${ts ? ": string" : ""})${ts ? ": boolean" : ""} {
    return this.${ts ? "items" : "#items"}.delete(key);
  }

  where(test${ts ? `: (item: ${E}) => boolean` : ""})${ts ? `: ${E}[]` : ""} {
    return [...this.${ts ? "items" : "#items"}.values()].filter(test);
  }

  sortedBy${pascal(c.sortField[0])}(desc = false)${ts ? `: ${E}[]` : ""} {
    const list = [...this.${ts ? "items" : "#items"}.values()];
    list.sort((a, b) => (a.${sf} < b.${sf} ? -1 : a.${sf} > b.${sf} ? 1 : 0) * (desc ? -1 : 1));
    return list;
  }
}

const repo = new ${P}Repository();
${c.rows.map((r) => `repo.add({ ${c.fields.map((f, i) => `${n(f)}: ${lit(c.lang, f[1], r[i]!)}`).join(", ")} });`).join("\n")}
console.log(repo.sortedBy${pascal(c.sortField[0])}(true).slice(0, ${c.limit}).map((x) => x.${key}));
`;
    }
    case "go":
      return `// In-memory ${c.d.plural} store.
package main

import (
	"fmt"
	"sort"
	"time"
)

type ${E} struct {
${c.fields.map((f) => `	${n(f)} ${TYPES.go[f[1]]}`).join("\n")}
}

type Store struct{ items map[string]${E} }

func NewStore() *Store { return &Store{items: map[string]${E}{}} }

func (s *Store) Add(x ${E}) error {
	if _, ok := s.items[x.${key}]; ok {
		return fmt.Errorf("%s already exists", x.${key})
	}
	s.items[x.${key}] = x
	return nil
}

func (s *Store) Remove(key string) bool {
	_, ok := s.items[key]
	delete(s.items, key)
	return ok
}

func (s *Store) SortedBy${pascal(c.sortField[0])}() []${E} {
	out := make([]${E}, 0, len(s.items))
	for _, x := range s.items {
		out = append(out, x)
	}
	sort.Slice(out, func(i, j int) bool { return ${c.sortField[1] === "date" ? `out[i].${sf}.Before(out[j].${sf})` : c.sortField[1] === "bool" ? `!out[i].${sf} && out[j].${sf}` : `out[i].${sf} < out[j].${sf}`} })
	return out
}

func mustDate(s string) time.Time {
	t, _ := time.Parse("2006-01-02", s)
	return t
}

func main() {
	s := NewStore()
${c.rows.map((r) => `	_ = s.Add(${E}{${rowLits(c, r).join(", ")}})`).join("\n")}
	for _, x := range s.SortedBy${pascal(c.sortField[0])}() {
		fmt.Println(x.${key}, x.${sf})
	}
}
`;
    case "rust":
      return `// In-memory ${c.d.plural} store.
use std::collections::HashMap;

#[derive(Debug, Clone)]
struct ${E} {
${c.fields.map((f) => `    ${n(f)}: ${TYPES.rust[f[1]]},`).join("\n")}
}

#[derive(Default)]
struct Store {
    items: HashMap<String, ${E}>,
}

impl Store {
    fn add(&mut self, item: ${E}) -> Result<(), String> {
        if self.items.contains_key(&item.${key}) {
            return Err(format!("{} already exists", item.${key}));
        }
        self.items.insert(item.${key}.clone(), item);
        Ok(())
    }

    fn remove(&mut self, key: &str) -> bool {
        self.items.remove(key).is_some()
    }

    fn sorted_by_${sf}(&self) -> Vec<&${E}> {
        let mut out: Vec<&${E}> = self.items.values().collect();
        out.sort_by(|a, b| a.${sf}.partial_cmp(&b.${sf}).unwrap());
        out
    }
}

fn main() {
    let mut store = Store::default();
${c.rows.map((r) => `    store.add(${E} { ${c.fields.map((f, i) => `${n(f)}: ${lit("rust", f[1], r[i]!)}`).join(", ")} }).unwrap();`).join("\n")}
    for item in store.sorted_by_${sf}().iter().take(${c.limit}) {
        println!("{} {:?}", item.${key}, item.${sf});
    }
}
`;
    case "java":
      return `// In-memory ${c.d.plural} repository.
import java.time.LocalDate;
import java.util.*;

public class ${P}Repository {
    record ${E}(${c.fields.map((f) => `${TYPES.java[f[1]]} ${n(f)}`).join(", ")}) {}

    private final Map<String, ${E}> items = new LinkedHashMap<>();

    void add(${E} item) {
        if (items.putIfAbsent(item.${key}(), item) != null)
            throw new IllegalStateException(item.${key}() + " already exists");
    }

    boolean remove(String key) {
        return items.remove(key) != null;
    }

    List<${E}> sortedBy${pascal(c.sortField[0])}() {
        var list = new ArrayList<>(items.values());
        list.sort(Comparator.comparing(${E}::${sf}));
        return list;
    }

    public static void main(String[] args) {
        var repo = new ${P}Repository();
${c.rows.map((r) => `        repo.add(new ${E}(${rowLits(c, r).join(", ")}));`).join("\n")}
        repo.sortedBy${pascal(c.sortField[0])}().stream().limit(${c.limit}).forEach(System.out::println);
    }
}
`;
  }
}

function report(c: Ctx): string {
  const E = c.d.entity;
  const n = (f: Field) => nameFor(c.lang, f);
  const nf = n(c.numField);
  const group = c.fields.find((f) => f[1] === "str" && f !== c.fields[0]) ?? c.fields[0]!;
  const g = n(group);
  const values = c.rows.map((r) => r[c.fields.indexOf(c.numField)]);
  const groups = c.rows.map((r) => r[c.fields.indexOf(group)]);
  switch (c.lang) {
    case "python":
      return `"""Statistics report for ${c.d.plural}: totals, averages and a ${snake(group[0]).replace(/_/g, " ")} breakdown."""
from collections import defaultdict
from statistics import mean, median

ROWS = [
${c.rows.map((_, i) => `    {"${g}": "${groups[i]}", "${nf}": ${values[i]}},`).join("\n")}
]


def build_report(rows: list[dict]) -> dict:
    values = [r["${nf}"] for r in rows]
    by_group: dict[str, list[float]] = defaultdict(list)
    for r in rows:
        by_group[r["${g}"]].append(r["${nf}"])
    return {
        "count": len(values),
        "total": round(sum(values), 2),
        "mean": round(mean(values), 2),
        "median": median(values),
        "max": max(values),
        "groups": {k: round(sum(v), 2) for k, v in sorted(by_group.items())},
    }


def print_report(report: dict) -> None:
    width = max(len(k) for k in report["groups"]) + 2
    print("${E} report".upper())
    for key in ("count", "total", "mean", "median", "max"):
        print(f"  {key:<8}{report[key]}")
    for name, value in report["groups"].items():
        bar = "#" * max(1, int(value / max(report["groups"].values()) * 20))
        print(f"  {name:<{width}}{bar} {value}")


if __name__ == "__main__":
    print_report(build_report(ROWS))
`;
    case "typescript":
    case "javascript": {
      const ts = c.lang === "typescript";
      return `// ${E} statistics: totals, averages and a breakdown by ${camel(group[0])}.
${ts ? `type Row = { ${g}: string; ${nf}: number };\n\n` : ""}const rows${ts ? ": Row[]" : ""} = [
${c.rows.map((_, i) => `  { ${g}: "${groups[i]}", ${nf}: ${values[i]} },`).join("\n")}
];

function stats(values${ts ? ": number[]" : ""}) {
  const sorted = [...values].sort((a, b) => a - b);
  const total = values.reduce((s, v) => s + v, 0);
  const mid = Math.floor(sorted.length / 2);
  return {
    count: values.length,
    total: Math.round(total * 100) / 100,
    mean: Math.round((total / values.length) * 100) / 100,
    median: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1]${ts ? "!" : ""} + sorted[mid]${ts ? "!" : ""}) / 2,
    max: sorted[sorted.length - 1],
  };
}

function groupBy(list${ts ? ": Row[]" : ""}) {
  const out${ts ? ": Record<string, number>" : ""} = {};
  for (const r of list) out[r.${g}] = (out[r.${g}] ?? 0) + r.${nf};
  return out;
}

console.table(stats(rows.map((r) => r.${nf})));
for (const [name, value] of Object.entries(groupBy(rows))) {
  console.log(name.padEnd(14), "#".repeat(Math.max(1, Math.round(value / 50))), value.toFixed(2));
}
`;
    }
    case "go":
      return `// ${E} statistics report.
package main

import (
	"fmt"
	"sort"
)

type row struct {
	${pascal(group[0])} string
	${pascal(c.numField[0])} float64
}

func main() {
	rows := []row{
${c.rows.map((_, i) => `		{"${groups[i]}", ${values[i]}},`).join("\n")}
	}
	total, max := 0.0, 0.0
	byGroup := map[string]float64{}
	for _, r := range rows {
		total += r.${pascal(c.numField[0])}
		if r.${pascal(c.numField[0])} > max {
			max = r.${pascal(c.numField[0])}
		}
		byGroup[r.${pascal(group[0])}] += r.${pascal(c.numField[0])}
	}
	fmt.Printf("count=%d total=%.2f mean=%.2f max=%.2f\\n", len(rows), total, total/float64(len(rows)), max)
	keys := make([]string, 0, len(byGroup))
	for k := range byGroup {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		fmt.Printf("  %-14s %.2f\\n", k, byGroup[k])
	}
}
`;
    case "rust":
      return `// ${E} statistics report.
use std::collections::BTreeMap;

fn main() {
    let rows: Vec<(&str, f64)> = vec![
${c.rows.map((_, i) => `        ("${groups[i]}", ${Number(values[i]).toFixed(2)}),`).join("\n")}
    ];
    let total: f64 = rows.iter().map(|r| r.1).sum();
    let max = rows.iter().map(|r| r.1).fold(f64::MIN, f64::max);
    let mut by_group: BTreeMap<&str, f64> = BTreeMap::new();
    for (name, value) in &rows {
        *by_group.entry(name).or_insert(0.0) += value;
    }
    println!("count={} total={:.2} mean={:.2} max={:.2}", rows.len(), total, total / rows.len() as f64, max);
    for (name, value) in by_group {
        println!("  {:<14} {:.2}", name, value);
    }
}
`;
    case "java":
      return `// ${E} statistics report.
import java.util.*;
import java.util.stream.*;

public class ${E}Report {
    record Row(String ${g}, double ${nf}) {}

    public static void main(String[] args) {
        var rows = List.of(
${c.rows.map((_, i) => `            new Row("${groups[i]}", ${Number(values[i]).toFixed(2)})`).join(",\n")}
        );
        var stats = rows.stream().mapToDouble(Row::${nf}).summaryStatistics();
        System.out.printf("count=%d total=%.2f mean=%.2f max=%.2f%n", stats.getCount(), stats.getSum(), stats.getAverage(), stats.getMax());
        var byGroup = rows.stream().collect(Collectors.groupingBy(Row::${g}, TreeMap::new, Collectors.summingDouble(Row::${nf})));
        byGroup.forEach((name, value) -> System.out.printf("  %-14s %.2f%n", name, value));
    }
}
`;
  }
}

function validator(c: Ctx): string {
  const E = c.d.entity;
  const n = (f: Field) => nameFor(c.lang, f);
  if (c.lang === "python") {
    return `"""Checks raw ${snake(E).replace(/_/g, " ")} data before it is stored."""
from datetime import date

RULES = {
${c.fields.map((f) => `    "${n(f)}": ${f[1] === "str" ? "lambda v: isinstance(v, str) and 0 < len(v) <= 80" : f[1] === "bool" ? "lambda v: isinstance(v, bool)" : f[1] === "date" ? "lambda v: isinstance(v, str) and len(v) == 10" : "lambda v: isinstance(v, (int, float)) and v >= 0"},`).join("\n")}
}


def validate(raw: dict) -> list[str]:
    problems = []
    for field, rule in RULES.items():
        if field not in raw:
            problems.append(f"missing {field}")
        elif not rule(raw[field]):
            problems.append(f"bad value for {field}: {raw[field]!r}")
    unknown = set(raw) - set(RULES)
    problems.extend(f"unknown field {name}" for name in sorted(unknown))
    return problems


if __name__ == "__main__":
    good = {${c.fields.map((f, i) => `"${n(f)}": ${f[1] === "date" ? `"${c.rows[0]![i]}"` : lit("python", f[1], c.rows[0]![i]!)}`).join(", ")}}
    bad = dict(good, ${n(c.numField)}=-1, extra="?")
    print("good:", validate(good) or "ok")
    print("bad:", validate(bad))
`;
  }
  return `// Validates raw ${E} input and lists every problem found.
type Problem = { field: string; message: string };
type Check = (value: unknown) => boolean;

const rules: Record<string, Check> = {
${c.fields.map((f) => `  ${n(f)}: ${f[1] === "str" ? `(v) => typeof v === "string" && v.length > 0 && v.length <= 80` : f[1] === "bool" ? `(v) => typeof v === "boolean"` : f[1] === "date" ? `(v) => typeof v === "string" && !Number.isNaN(Date.parse(v))` : `(v) => typeof v === "number" && v >= 0`},`).join("\n")}
};

export function validate${E}(raw: Record<string, unknown>): Problem[] {
  const problems: Problem[] = [];
  for (const [field, check] of Object.entries(rules)) {
    if (!(field in raw)) problems.push({ field, message: "missing" });
    else if (!check(raw[field])) problems.push({ field, message: \`bad value \${JSON.stringify(raw[field])}\` });
  }
  for (const field of Object.keys(raw)) if (!(field in rules)) problems.push({ field, message: "unknown field" });
  return problems;
}

const good = { ${c.fields.map((f, i) => `${n(f)}: ${f[1] === "date" ? `"${c.rows[0]![i]}"` : lit("typescript", f[1], c.rows[0]![i]!)}`).join(", ")} };
console.log("good:", validate${E}(good));
console.log("bad:", validate${E}({ ...good, ${n(c.numField)}: -1, extra: "?" }));
`;
}

function pipeline(c: Ctx): string {
  const n = (f: Field) => nameFor(c.lang, f);
  const nf = n(c.numField);
  const key = n(c.fields[0]!);
  const flag = c.flag ? n(c.flag) : null;
  if (c.lang === "python") {
    return `"""Small data pipeline: load ${c.d.plural}, filter, transform, rank the top ${c.limit}."""
import csv
import io

RAW = """${[c.fields.map(n).join(","), ...c.rows.map((r) => r.map((v) => (typeof v === "boolean" ? (v ? "yes" : "no") : String(v))).join(","))].join("\n")}"""


def load(text: str) -> list[dict]:
    return list(csv.DictReader(io.StringIO(text)))


def clean(rows: list[dict]) -> list[dict]:
    out = []
    for r in rows:
        r["${nf}"] = float(r["${nf}"])
${flag ? `        r["${flag}"] = r["${flag}"] == "yes"\n` : ""}        out.append(r)
    return out


def rank(rows: list[dict], top: int = ${c.limit}) -> list[tuple[str, float]]:
    ${flag ? `rows = [r for r in rows if not r["${flag}"]] or rows\n    ` : ""}best = sorted(rows, key=lambda r: r["${nf}"], reverse=True)[:top]
    return [(r["${key}"], r["${nf}"]) for r in best]


if __name__ == "__main__":
    for place, (name, value) in enumerate(rank(clean(load(RAW))), start=1):
        print(f"{place}. {name:<16} {value:>10.2f}")
`;
  }
  const ts = c.lang === "typescript";
  return `// Pipeline: parse ${c.d.plural}, filter, transform and rank the top ${c.limit}.
const RAW = \`${[c.fields.map(n).join(","), ...c.rows.map((r) => r.map((v) => (typeof v === "boolean" ? (v ? "yes" : "no") : String(v))).join(","))].join("\n")}\`;

${ts ? "type Row = Record<string, string | number | boolean>;\n\n" : ""}const parse = (text${ts ? ": string" : ""})${ts ? ": Row[]" : ""} => {
  const [head, ...lines] = text.trim().split("\\n");
  const keys = head${ts ? "!" : ""}.split(",");
  return lines.map((line) => Object.fromEntries(line.split(",").map((v, i) => [keys[i]${ts ? "!" : ""}, v])));
};

const clean = (rows${ts ? ": Row[]" : ""}) =>
  rows.map((r) => ({ ...r, ${nf}: Number(r.${nf})${flag ? `, ${flag}: r.${flag} === "yes"` : ""} }));

const rank = (rows${ts ? ": Row[]" : ""}, top = ${c.limit}) =>
  [...rows]${flag ? `.filter((r) => !r.${flag})` : ""}
    .sort((a, b) => Number(b.${nf}) - Number(a.${nf}))
    .slice(0, top)
    .map((r, i) => \`\${i + 1}. \${String(r.${key}).padEnd(16)} \${Number(r.${nf}).toFixed(2)}\`);

rank(clean(parse(RAW))).forEach((line) => console.log(line));
`;
}

function tests(c: Ctx): string {
  const E = c.d.entity;
  const nf = nameFor(c.lang, c.numField);
  if (c.lang === "python") {
    return `"""Unit tests for ${snake(c.d.plural).replace(/_/g, " ")} totals and ranking."""
import unittest


def total(values: list[float]) -> float:
    return round(sum(values), 2)


def top(values: list[float], k: int) -> list[float]:
    return sorted(values, reverse=True)[:k]


class ${E}TotalsTest(unittest.TestCase):
    values = [${values(c).join(", ")}]

    def test_total_adds_every_${snake(c.numField[0])}(self):
        self.assertEqual(total(self.values), ${Math.round(values(c).reduce((s, v) => s + v, 0) * 100) / 100})

    def test_top_${c.limit}_is_sorted_high_to_low(self):
        result = top(self.values, ${c.limit})
        self.assertEqual(result, sorted(result, reverse=True))
        self.assertEqual(len(result), min(${c.limit}, len(self.values)))

    def test_empty_list_totals_zero(self):
        self.assertEqual(total([]), 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
`;
  }
  return `// Tiny test runner + tests for ${c.d.plural} totals and ranking.
const tests: [string, () => void][] = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);
const expectEqual = (a: unknown, b: unknown) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(\`expected \${JSON.stringify(b)}, got \${JSON.stringify(a)}\`);
};

const total = (values: number[]) => Math.round(values.reduce((s, v) => s + v, 0) * 100) / 100;
const top = (values: number[], k: number) => [...values].sort((a, b) => b - a).slice(0, k);
const ${nf}Values = [${values(c).join(", ")}];

test("total adds every ${camel(c.numField[0])}", () => expectEqual(total(${nf}Values), ${Math.round(values(c).reduce((s, v) => s + v, 0) * 100) / 100}));
test("top ${c.limit} is sorted high to low", () => {
  const r = top(${nf}Values, ${c.limit});
  expectEqual(r, [...r].sort((a, b) => b - a));
});
test("empty list totals zero", () => expectEqual(total([]), 0));

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log("✓", name);
  } catch (e) {
    failed++;
    console.log("✗", name, "-", (e as Error).message);
  }
}
console.log(\`\${tests.length - failed}/\${tests.length} passed\`);
`;
}
const values = (c: Ctx) => c.rows.map((r) => Number(r[c.fields.indexOf(c.numField)]));

/* ---------- algorithms (Python + JavaScript) ---------- */
const ALGO_CODE: Record<(typeof ALGOS)[number], { python: string; javascript: string; title: string }> = {
  binarySearch: {
    title: "binary search",
    python: `def binary_search(items: list[int], target: int) -> int:\n    lo, hi = 0, len(items) - 1\n    while lo <= hi:\n        mid = (lo + hi) // 2\n        if items[mid] == target:\n            return mid\n        if items[mid] < target:\n            lo = mid + 1\n        else:\n            hi = mid - 1\n    return -1\n\n\nif __name__ == "__main__":\n    data = sorted([{SEEDS}])\n    for t in (data[2], 999):\n        print(t, "->", binary_search(data, t))\n`,
    javascript: `function binarySearch(items, target) {\n  let lo = 0;\n  let hi = items.length - 1;\n  while (lo <= hi) {\n    const mid = (lo + hi) >> 1;\n    if (items[mid] === target) return mid;\n    if (items[mid] < target) lo = mid + 1;\n    else hi = mid - 1;\n  }\n  return -1;\n}\n\nconst data = [{SEEDS}].sort((a, b) => a - b);\nfor (const t of [data[2], 999]) console.log(t, "->", binarySearch(data, t));\n`,
  },
  mergeSort: {
    title: "merge sort",
    python: `def merge_sort(items: list[int]) -> list[int]:\n    if len(items) <= 1:\n        return items\n    mid = len(items) // 2\n    left, right = merge_sort(items[:mid]), merge_sort(items[mid:])\n    out, i, j = [], 0, 0\n    while i < len(left) and j < len(right):\n        if left[i] <= right[j]:\n            out.append(left[i]); i += 1\n        else:\n            out.append(right[j]); j += 1\n    return out + left[i:] + right[j:]\n\n\nif __name__ == "__main__":\n    print(merge_sort([{SEEDS}]))\n`,
    javascript: `function mergeSort(items) {\n  if (items.length <= 1) return items;\n  const mid = items.length >> 1;\n  const left = mergeSort(items.slice(0, mid));\n  const right = mergeSort(items.slice(mid));\n  const out = [];\n  while (left.length && right.length) out.push(left[0] <= right[0] ? left.shift() : right.shift());\n  return [...out, ...left, ...right];\n}\n\nconsole.log(mergeSort([{SEEDS}]));\n`,
  },
  lruCache: {
    title: "LRU cache",
    python: `from collections import OrderedDict\n\n\nclass LRUCache:\n    def __init__(self, capacity: int) -> None:\n        self.capacity = capacity\n        self.data: OrderedDict[str, int] = OrderedDict()\n\n    def get(self, key: str) -> int | None:\n        if key not in self.data:\n            return None\n        self.data.move_to_end(key)\n        return self.data[key]\n\n    def put(self, key: str, value: int) -> None:\n        self.data[key] = value\n        self.data.move_to_end(key)\n        if len(self.data) > self.capacity:\n            self.data.popitem(last=False)\n\n\nif __name__ == "__main__":\n    cache = LRUCache({K})\n    for i, v in enumerate([{SEEDS}]):\n        cache.put(f"k{i}", v)\n    print(list(cache.data.items()))\n`,
    javascript: `class LRUCache {\n  constructor(capacity) {\n    this.capacity = capacity;\n    this.map = new Map();\n  }\n  get(key) {\n    if (!this.map.has(key)) return undefined;\n    const v = this.map.get(key);\n    this.map.delete(key);\n    this.map.set(key, v);\n    return v;\n  }\n  put(key, value) {\n    this.map.delete(key);\n    this.map.set(key, value);\n    if (this.map.size > this.capacity) this.map.delete(this.map.keys().next().value);\n  }\n}\n\nconst cache = new LRUCache({K});\n[{SEEDS}].forEach((v, i) => cache.put(\`k\${i}\`, v));\nconsole.log([...cache.map]);\n`,
  },
  tokenBucket: {
    title: "token bucket rate limiter",
    python: `import time\n\n\nclass TokenBucket:\n    def __init__(self, rate: float, capacity: int) -> None:\n        self.rate, self.capacity = rate, capacity\n        self.tokens = float(capacity)\n        self.updated = time.monotonic()\n\n    def allow(self) -> bool:\n        now = time.monotonic()\n        self.tokens = min(self.capacity, self.tokens + (now - self.updated) * self.rate)\n        self.updated = now\n        if self.tokens >= 1:\n            self.tokens -= 1\n            return True\n        return False\n\n\nif __name__ == "__main__":\n    bucket = TokenBucket(rate={K}, capacity={K})\n    print([bucket.allow() for _ in range({K} * 2)])\n`,
    javascript: `class TokenBucket {\n  constructor(rate, capacity) {\n    this.rate = rate;\n    this.capacity = capacity;\n    this.tokens = capacity;\n    this.updated = Date.now();\n  }\n  allow() {\n    const now = Date.now();\n    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.updated) / 1000) * this.rate);\n    this.updated = now;\n    if (this.tokens < 1) return false;\n    this.tokens -= 1;\n    return true;\n  }\n}\n\nconst bucket = new TokenBucket({K}, {K});\nconsole.log(Array.from({ length: {K} * 2 }, () => bucket.allow()));\n`,
  },
  trie: {
    title: "prefix trie",
    python: `class Trie:\n    def __init__(self) -> None:\n        self.root: dict = {}\n\n    def insert(self, word: str) -> None:\n        node = self.root\n        for ch in word:\n            node = node.setdefault(ch, {})\n        node["$"] = True\n\n    def starts_with(self, prefix: str) -> list[str]:\n        node = self.root\n        for ch in prefix:\n            if ch not in node:\n                return []\n            node = node[ch]\n        out: list[str] = []\n        def walk(n: dict, acc: str) -> None:\n            for k, child in n.items():\n                if k == "$":\n                    out.append(prefix + acc)\n                else:\n                    walk(child, acc + k)\n        walk(node, "")\n        return sorted(out)\n\n\nif __name__ == "__main__":\n    t = Trie()\n    for w in {WORDS}:\n        t.insert(w)\n    print(t.starts_with("{PREFIX}"))\n`,
    javascript: `class Trie {\n  constructor() {\n    this.root = {};\n  }\n  insert(word) {\n    let node = this.root;\n    for (const ch of word) node = node[ch] ??= {};\n    node.$ = true;\n  }\n  startsWith(prefix) {\n    let node = this.root;\n    for (const ch of prefix) if (!(node = node[ch])) return [];\n    const out = [];\n    const walk = (n, acc) => {\n      for (const [k, child] of Object.entries(n)) k === "$" ? out.push(prefix + acc) : walk(child, acc + k);\n    };\n    walk(node, "");\n    return out.sort();\n  }\n}\n\nconst t = new Trie();\n{WORDS}.forEach((w) => t.insert(w));\nconsole.log(t.startsWith("{PREFIX}"));\n`,
  },
  levenshtein: {
    title: "edit distance",
    python: `def levenshtein(a: str, b: str) -> int:\n    prev = list(range(len(b) + 1))\n    for i, ca in enumerate(a, start=1):\n        cur = [i]\n        for j, cb in enumerate(b, start=1):\n            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))\n        prev = cur\n    return prev[-1]\n\n\nif __name__ == "__main__":\n    words = {WORDS}\n    for w in words[1:]:\n        print(f"{words[0]} -> {w}: {levenshtein(words[0], w)}")\n`,
    javascript: `function levenshtein(a, b) {\n  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);\n  for (let i = 1; i <= a.length; i++) {\n    const cur = [i];\n    for (let j = 1; j <= b.length; j++) {\n      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));\n    }\n    prev = cur;\n  }\n  return prev[b.length];\n}\n\nconst words = {WORDS};\nfor (const w of words.slice(1)) console.log(\`\${words[0]} -> \${w}: \${levenshtein(words[0], w)}\`);\n`,
  },
  bfsGrid: {
    title: "shortest path on a grid",
    python: `from collections import deque\n\nGRID = [\n    "S..#....",\n    ".#.#.##.",\n    ".#...#..",\n    "...#...E",\n]\n\n\ndef shortest_path(grid: list[str]) -> int:\n    rows, cols = len(grid), len(grid[0])\n    start = next((r, c) for r in range(rows) for c in range(cols) if grid[r][c] == "S")\n    queue, seen = deque([(start, 0)]), {start}\n    while queue:\n        (r, c), dist = queue.popleft()\n        if grid[r][c] == "E":\n            return dist\n        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):\n            nr, nc = r + dr, c + dc\n            if 0 <= nr < rows and 0 <= nc < cols and grid[nr][nc] != "#" and (nr, nc) not in seen:\n                seen.add((nr, nc))\n                queue.append(((nr, nc), dist + 1))\n    return -1\n\n\nif __name__ == "__main__":\n    print("steps:", shortest_path(GRID))\n`,
    javascript: `const GRID = ["S..#....", ".#.#.##.", ".#...#..", "...#...E"];\n\nfunction shortestPath(grid) {\n  const rows = grid.length;\n  const cols = grid[0].length;\n  const start = grid.flatMap((row, r) => [...row].map((ch, c) => [ch, r, c])).find(([ch]) => ch === "S");\n  const queue = [[start[1], start[2], 0]];\n  const seen = new Set([\`\${start[1]},\${start[2]}\`]);\n  while (queue.length) {\n    const [r, c, d] = queue.shift();\n    if (grid[r][c] === "E") return d;\n    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {\n      const nr = r + dr, nc = c + dc, key = \`\${nr},\${nc}\`;\n      if (nr >= 0 && nc >= 0 && nr < rows && nc < cols && grid[nr][nc] !== "#" && !seen.has(key)) {\n        seen.add(key);\n        queue.push([nr, nc, d + 1]);\n      }\n    }\n  }\n  return -1;\n}\n\nconsole.log("steps:", shortestPath(GRID));\n`,
  },
  movingAverage: {
    title: "moving average",
    python: `from collections import deque\n\n\ndef moving_average(values: list[float], window: int) -> list[float]:\n    buf: deque[float] = deque(maxlen=window)\n    out = []\n    for v in values:\n        buf.append(v)\n        out.append(round(sum(buf) / len(buf), 2))\n    return out\n\n\nif __name__ == "__main__":\n    print(moving_average([{SEEDS}], window={K}))\n`,
    javascript: `function movingAverage(values, windowSize) {\n  const out = [];\n  let sum = 0;\n  values.forEach((v, i) => {\n    sum += v;\n    if (i >= windowSize) sum -= values[i - windowSize];\n    out.push(Math.round((sum / Math.min(i + 1, windowSize)) * 100) / 100);\n  });\n  return out;\n}\n\nconsole.log(movingAverage([{SEEDS}], {K}));\n`,
  },
  runLength: {
    title: "run-length encoding",
    python: `from itertools import groupby\n\n\ndef encode(text: str) -> str:\n    return "".join(f"{len(list(g))}{ch}" for ch, g in groupby(text))\n\n\ndef decode(code: str) -> str:\n    out, num = [], ""\n    for ch in code:\n        if ch.isdigit():\n            num += ch\n        else:\n            out.append(ch * int(num))\n            num = ""\n    return "".join(out)\n\n\nif __name__ == "__main__":\n    text = "{RUN}"\n    packed = encode(text)\n    print(packed, decode(packed) == text)\n`,
    javascript: `const encode = (text) => text.replace(/(.)\\1*/g, (run, ch) => \`\${run.length}\${ch}\`);\nconst decode = (code) => code.replace(/(\\d+)(\\D)/g, (_, n, ch) => ch.repeat(Number(n)));\n\nconst text = "{RUN}";\nconst packed = encode(text);\nconsole.log(packed, decode(packed) === text);\n`,
  },
  topK: {
    title: "top-k with a heap",
    python: `import heapq\n\n\ndef top_k(values: list[int], k: int) -> list[int]:\n    heap: list[int] = []\n    for v in values:\n        if len(heap) < k:\n            heapq.heappush(heap, v)\n        elif v > heap[0]:\n            heapq.heapreplace(heap, v)\n    return sorted(heap, reverse=True)\n\n\nif __name__ == "__main__":\n    print(top_k([{SEEDS}], {K}))\n`,
    javascript: `function topK(values, k) {\n  const heap = [];\n  for (const v of values) {\n    heap.push(v);\n    heap.sort((a, b) => a - b);\n    if (heap.length > k) heap.shift();\n  }\n  return heap.reverse();\n}\n\nconsole.log(topK([{SEEDS}], {K}));\n`,
  },
};
const WORD_SETS = [
  ["planet", "plane", "plant", "plan", "planner", "plaza"],
  ["stream", "streak", "street", "strength", "strong", "stride"],
  ["cargo", "carbon", "career", "carpet", "cart", "carve"],
  ["signal", "sign", "signet", "silent", "silver", "simple"],
];

function algorithm(lang: "python" | "javascript", algo: (typeof ALGOS)[number], rand: () => number, k: number): string {
  const seeds = Array.from({ length: 10 }, () => 1 + Math.floor(rand() * 99)).join(", ");
  const ws = WORD_SETS[Math.floor(rand() * WORD_SETS.length)]!;
  const run = Array.from({ length: 4 }, () => "ABCDXYZ"[Math.floor(rand() * 7)]!.repeat(1 + Math.floor(rand() * 5))).join("");
  const t = ALGO_CODE[algo];
  const head = lang === "python" ? `"""${t.title[0]!.toUpperCase() + t.title.slice(1)}, written from scratch."""\n` : `// ${t.title[0]!.toUpperCase() + t.title.slice(1)}, written from scratch.\n`;
  return (
    head +
    t[lang]
      .replace(/\{SEEDS\}/g, seeds)
      .replace(/\{K\}/g, String(k))
      .replace(/\{WORDS\}/g, JSON.stringify(ws))
      .replace(/\{PREFIX\}/g, ws[0]!.slice(0, 3))
      .replace(/\{RUN\}/g, run)
  );
}

/* ---------- generator ---------- */
function pick<T>(list: readonly T[], rand: () => number): T {
  return list[Math.floor(rand() * list.length)]!;
}

/**
 * Writes a new practice program. `used` holds signatures already written (kept across sessions),
 * so the same program is never written twice.
 */
export function writePractice(rand: () => number, used: Set<string>): PracticeSnippet {
  for (let attempt = 0; attempt < 80; attempt++) {
    const lang = pick(LANGS, rand);
    const shape = pick(SUPPORT[lang], rand);
    if (shape === "algo") {
      const algo = pick(ALGOS, rand);
      const k = 2 + Math.floor(rand() * 4);
      const l = lang === "python" ? "python" : "javascript";
      const sig = `${l}:algo:${algo}:${k}`;
      if (used.has(sig)) continue;
      return { filename: `${l === "python" ? snake(algo) : kebab(algo)}.${EXT[l]}`, language: l, code: algorithm(l, algo, rand, k), signature: sig };
    }
    const d = pick(DOMAINS, rand);
    // a random subset of fields (always keep the first = the key, and at least one number)
    const mask = d.fields.map((_, i) => i === 0 || rand() < 0.75);
    let fields = d.fields.filter((_, i) => mask[i]);
    if (!fields.some(num)) fields = [...fields, d.fields.find(num)!];
    if (fields[0]![1] !== "str") fields = [d.fields.find((f) => f[1] === "str")!, ...fields.filter((f) => f[1] !== "str" || f !== fields[0])];
    const numField = pick(fields.filter(num), rand);
    const sortField = pick(fields.filter((f) => f[1] !== "bool"), rand);
    const limit = 2 + Math.floor(rand() * 4);
    const sig = `${lang}:${shape}:${d.entity}:${fields.map((f) => f[0]).join("+")}:${numField[0]}:${sortField[0]}:${limit}`;
    if (used.has(sig)) continue;
    const rows = Array.from({ length: 4 + Math.floor(rand() * 3) }, (_, i) => fields.map((f) => sample(f[1], rand, i)));
    const c: Ctx = { d, fields, numField, sortField, flag: fields.find((f) => f[1] === "bool"), rows, limit, lang };
    const code = { model, repository, report, validator, pipeline, tests }[shape](c);
    const base =
      shape === "model" ? d.entity : shape === "repository" ? `${d.plural} store` : shape === "report" ? `${d.plural} report` : shape === "validator" ? `${d.entity} validator` : shape === "pipeline" ? `${d.plural} pipeline` : `test ${d.plural}`;
    const file = lang === "python" || lang === "go" || lang === "rust" ? snake(base) : kebab(base);
    // Java needs the file named after its public class.
    const javaName = shape === "model" ? `${d.entity}App` : shape === "repository" ? `${pascal(d.plural)}Repository` : `${d.entity}Report`;
    return { filename: `${lang === "java" ? javaName : file}.${EXT[lang]}`, language: lang, code, signature: sig };
  }
  // Practically never reached: fall back to a numbered variant.
  const n = used.size + 1;
  return {
    filename: `practice_${n}.py`,
    language: "python",
    code: `"""Practice program #${n}."""\nprint(sum(i * i for i in range(${n + 10})))\n`,
    signature: `fallback:${n}`,
  };
}
