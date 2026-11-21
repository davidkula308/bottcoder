// Tiny line-based syntax colouring for the code screen.
export type TokenKind = "kw" | "str" | "com" | "num" | "fn" | "plain";
export interface Token {
  k: TokenKind;
  v: string;
}

const KEYWORDS = new Set(
  (
    "def class return if elif else for while in not and or import from as with try except finally raise pass break continue lambda yield None True False self async await global nonlocal assert del is " +
    "function const let var new this typeof instanceof export default extends super null undefined true false switch case do throw catch static get set of void delete package func struct type interface map chan go defer range " +
    "param begin process end foreach"
  ).split(" "),
);

const BODY =
  /("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|`(?:[^`\\]|\\.)*`?)|(\b\d[\d_.]*\b)|([A-Za-z_$][\w$]*)(?=\s*\()|([A-Za-z_$][\w$]*)/.source;
const HASH_RE = new RegExp(`(#.*$|<#.*?#>)|${BODY}`, "g");
const SLASH_RE = new RegExp(`(\\/\\/.*$|\\/\\*.*?\\*\\/|<!--.*?-->)|${BODY}`, "g");

export function tokenize(line: string, language: string): Token[] {
  const out: Token[] = [];
  const re = /^(py|python|sh|bash|ps1|powershell|toml|yaml|yml|text|)$/i.test(language) ? HASH_RE : SLASH_RE;
  re.lastIndex = 0;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m.index > last) out.push({ k: "plain", v: line.slice(last, m.index) });
    const [all, com, str, num, fn, word] = m;
    if (com) out.push({ k: "com", v: com });
    else if (str) out.push({ k: "str", v: str });
    else if (num) out.push({ k: "num", v: num });
    else if (fn) out.push({ k: KEYWORDS.has(fn) ? "kw" : "fn", v: fn });
    else if (word) out.push({ k: KEYWORDS.has(word) ? "kw" : "plain", v: word });
    last = re.lastIndex;
    if (all.length === 0) re.lastIndex++;
  }
  if (last < line.length) out.push({ k: "plain", v: line.slice(last) });
  return out;
}
