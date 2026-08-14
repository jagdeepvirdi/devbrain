"""
perl_bridge.py — Perl subroutine/import/DBI-call extraction for the Code
Intelligence engine (TASKS.md Phase 40).

Reads a single .pl/.pm file and prints a JSON object on stdout describing:
  - "nodes": `sub NAME { ... }` definitions (name, signature, start/end line).
  - "edges": table reads/writes found directly in embedded SQL strings
    passed to DBI (`$dbh->do("SELECT ...")`) — table names only, no
    column-level detail (see design notes below for why).
  - "unresolved_refs": everything that names another entity by a string
    that can only be resolved once the whole project is indexed —
    `use`/`require` (kind: 'import'), plain sub calls (kind: 'call'), and
    DBI calls whose embedded SQL invokes a stored procedure rather than a
    plain DML statement (kind: 'sql_exec', per TASKS.md Phase 40's Pass 2
    link-resolution design — NOT silently dropped).

Design notes:
  - Perl has no realistic regex-only full parse ("Perl cannot be parsed,
    only perl can parse Perl" is the standard warning) — Phase 40 chose
    regex/heuristic extraction over shelling out to a real Perl interpreter
    + the CPAN PPI module specifically to avoid adding a third language
    runtime (Perl) alongside Node + Python for marginal v1 gain. This script
    is deliberately best-effort: it handles ordinary code (single/double-
    quoted strings, # comments, brace-delimited sub bodies) and does NOT
    attempt heredocs, regex literals (//, qr//), or q()/qq()-family
    alternate quoting — real code using those can produce a truncated or
    over-extended sub boundary. Known, accepted limitation, not a bug to
    chase down.
  - Embedded SQL is extracted from `->do(...)`/`->prepare(...)` string
    arguments via regex only — deliberately not routed through sqlglot
    (unlike sql_bridge.py). A string embedded in Perl source commonly has
    `?` placeholders or is built via concatenation, which a real SQL parser
    handles poorly; regex-based table-name detection is honest about being
    approximate rather than pretending AST-level precision on text that was
    never a complete, self-contained SQL statement to begin with.
  - A generic bareword `name(...)` call is only reported as a 'call'
    reference when `name` isn't one of Perl's own keywords/builtins (a
    denylist below) — without it, `if (...)`, `print(...)`, etc. would
    flood the output as false "calls" to nonexistent user subroutines.

Usage:
  python perl_bridge.py <file_path>
"""

import argparse
import json
import re
import sys

# ── Perl builtins/keywords ──────────────────────────────────────────────
# Excluded from bareword-call detection so `if (...)`, `print(...)`, etc.
# don't get reported as calls to a user-defined subroutine of that name.
# Not exhaustive — common ones only, matching this script's regex/heuristic
# (not exhaustive-by-design) approach throughout.

PERL_KEYWORDS = frozenset({
    'if', 'elsif', 'else', 'unless', 'while', 'until', 'for', 'foreach', 'do', 'sub', 'return',
    'print', 'printf', 'say', 'push', 'pop', 'shift', 'unshift', 'splice', 'keys', 'values', 'each',
    'exists', 'delete', 'defined', 'ref', 'bless', 'die', 'warn', 'eval', 'local', 'my', 'our',
    'use', 'require', 'package', 'qw', 'sort', 'map', 'grep', 'join', 'split', 'sprintf', 'length',
    'substr', 'index', 'rindex', 'uc', 'lc', 'ucfirst', 'lcfirst', 'chomp', 'chop', 'chr', 'ord',
    'int', 'abs', 'sqrt', 'wantarray', 'caller', 'close', 'open', 'read', 'write', 'binmode',
    'chdir', 'mkdir', 'rmdir', 'unlink', 'rename', 'stat', 'sleep', 'exit', 'system', 'exec',
    'wait', 'waitpid', 'fork', 'kill', 'scalar', 'not', 'and', 'or', 'xor', 'lock', 'last', 'next',
    'redo', 'given', 'when', 'state', 'local',
})


# ── Sub boundary detection ──────────────────────────────────────────────
# Quote/comment-aware brace-depth counter — same spirit as sql_bridge.py's
# statement splitter, scoped to Perl's ' / " / # instead of SQL's quoting.

SUB_RE = re.compile(r'\bsub\s+(\w+)\s*(?:\([^)]*\))?\s*(?::\s*\w+(?:\([^)]*\))?\s*)*\{')


def find_matching_brace(source: str, open_pos: int) -> int | None:
    """`open_pos` points at the opening '{'. Returns the index just past the
    matching '}', or None if it's never found (unterminated / a construct
    this scanner doesn't understand broke the count)."""
    depth = 1
    i = open_pos + 1
    n = len(source)
    while i < n:
        c = source[i]
        if c == '#':
            nl = source.find('\n', i)
            i = nl + 1 if nl != -1 else n
            continue
        if c in ("'", '"'):
            quote = c
            i += 1
            while i < n and source[i] != quote:
                i += 2 if source[i] == '\\' else 1
            i += 1
            continue
        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return None


def find_subs(source: str) -> list[dict]:
    subs = []
    for m in SUB_RE.finditer(source):
        end = find_matching_brace(source, m.end() - 1)
        if end is None:
            continue
        subs.append({'name': m.group(1), 'start': m.start(), 'body_start': m.end(), 'end': end})
    subs.sort(key=lambda s: s['start'])
    accepted: list[dict] = []
    for s in subs:
        if accepted and s['start'] < accepted[-1]['end']:
            continue  # nested `sub` text matched inside a string/comment the scanner didn't skip
        accepted.append(s)
    return accepted


def line_of(source: str, offset: int) -> int:
    return source.count('\n', 0, offset) + 1


def first_line(text: str) -> str:
    line = text.split('\n')[0].strip()
    return line if len(line) <= 200 else line[:200] + '…'


# ── use / require ────────────────────────────────────────────────────────

USE_REQUIRE_RE = re.compile(r'\b(?:use|require)\s+([A-Za-z_][\w:]*)')


def find_imports(text: str) -> list[tuple[str, int]]:
    return [(m.group(1), m.start()) for m in USE_REQUIRE_RE.finditer(text)]


# ── DBI embedded SQL ─────────────────────────────────────────────────────

DBI_CALL_RE = re.compile(r'->\s*(?:do|prepare)\s*\(\s*(["\'])')

PROC_CALL_PATTERNS = [
    re.compile(r'\b(?:EXEC|EXECUTE)\s+([A-Za-z_]\w*)', re.IGNORECASE),
    re.compile(r'\{?\s*CALL\s+([A-Za-z_]\w*)', re.IGNORECASE),
    re.compile(r'\bBEGIN\s+([A-Za-z_]\w*)\s*\(', re.IGNORECASE),
]
WRITE_TARGET_PATTERNS = [
    (re.compile(r'\bINSERT\s+INTO\s+([A-Za-z_][\w$#]*)', re.IGNORECASE), 'WRITES_TABLE'),
    (re.compile(r'\bMERGE\s+INTO\s+([A-Za-z_][\w$#]*)', re.IGNORECASE), 'WRITES_TABLE'),
    (re.compile(r'\bUPDATE\s+([A-Za-z_][\w$#]*)\s+SET\b', re.IGNORECASE), 'WRITES_TABLE'),
    (re.compile(r'\bDELETE\s+FROM\s+([A-Za-z_][\w$#]*)', re.IGNORECASE), 'WRITES_TABLE'),
]
READ_SOURCE_PATTERNS = [
    re.compile(r'\bFROM\s+([A-Za-z_][\w$#]*)', re.IGNORECASE),
    re.compile(r'\bJOIN\s+([A-Za-z_][\w$#]*)', re.IGNORECASE),
]


def extract_quoted_string(text: str, quote_start: int, quote_char: str) -> tuple[str, int]:
    """`quote_start` points just past the opening quote. Returns (content,
    index just past the closing quote) — content has escaped quotes
    un-escaped for pattern matching, not full Perl string interpolation."""
    i = quote_start
    n = len(text)
    buf = []
    while i < n and text[i] != quote_char:
        if text[i] == '\\' and i + 1 < n:
            buf.append(text[i + 1])
            i += 2
            continue
        buf.append(text[i])
        i += 1
    return ''.join(buf), i + 1


def classify_embedded_sql(sql: str) -> tuple[str, str] | None:
    """Returns (kind, target) — kind is 'sql_exec' (a procedure call, target
    is its name) or a table relationship_type (target is the table name) —
    or None if the string doesn't look like recognizable SQL at all."""
    for pattern in PROC_CALL_PATTERNS:
        m = pattern.search(sql)
        if m:
            return 'sql_exec', m.group(1).lower()

    for pattern, rel in WRITE_TARGET_PATTERNS:
        m = pattern.search(sql)
        if m:
            return rel, m.group(1).lower()

    for pattern in READ_SOURCE_PATTERNS:
        m = pattern.search(sql)
        if m:
            return 'READS_TABLE', m.group(1).lower()

    return None


def find_dbi_refs(text: str) -> list[tuple[str, str, int]]:
    """Returns (kind_or_relationship_type, target, offset) tuples."""
    results = []
    for m in DBI_CALL_RE.finditer(text):
        sql, _ = extract_quoted_string(text, m.end(), m.group(1))
        classified = classify_embedded_sql(sql)
        if classified:
            kind, target = classified
            results.append((kind, target, m.start()))
    return results


# ── String/comment masking ──────────────────────────────────────────────
# find_plain_calls() and find_imports() scan for bare identifiers followed
# by "(" — without this, a table/column name that happens to precede "("
# *inside an embedded SQL string* (e.g. "INSERT INTO audit_log (acct_id...")
# reads as a false Perl call. Blanks out string/comment contents (keeping
# length and quote/hash characters intact, so offsets used elsewhere stay
# valid) before those two scans; find_dbi_refs() below still needs the real
# text and is never run against the masked version.

def mask_noncode(text: str) -> str:
    out = list(text)
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if c == '#':
            end = text.find('\n', i)
            if end == -1:
                end = n
            for j in range(i, end):
                out[j] = ' '
            i = end
            continue
        if c in ("'", '"'):
            quote = c
            start = i
            i += 1
            while i < n and text[i] != quote:
                i += 2 if text[i] == '\\' else 1
            i += 1
            for j in range(start + 1, min(i - 1, n)):
                out[j] = ' '
            continue
        i += 1
    return ''.join(out)


# ── Plain subroutine calls ──────────────────────────────────────────────
# The `(?<![$@%])` guard matters: `for my $i (1..$x)` would otherwise match
# bareword `i` followed by `(` (the `$` isn't a word character, so `\b`
# alone is satisfied right after it) and get reported as a call to `i`.

CALL_RE = re.compile(r'(->\s*)?(?<![$@%])\b([A-Za-z_]\w*(?:::\w+)*)\s*\(')


def find_plain_calls(text: str) -> list[tuple[str, int]]:
    calls = []
    for m in CALL_RE.finditer(text):
        if m.group(1):  # `->method(...)` — a method call, not a plain sub call
            continue
        name = m.group(2)
        if name.lower() in PERL_KEYWORDS:
            continue
        calls.append((name, m.start()))
    return calls


# ── Orchestration ────────────────────────────────────────────────────────

def scan_span(source: str, text: str, span_start: int, from_entity_name: str | None,
              edges: list[dict], refs: list[dict]) -> None:
    masked = mask_noncode(text)

    for module, offset in find_imports(masked):
        refs.append({
            'from_entity_name': from_entity_name, 'raw_target_name': module, 'kind': 'import',
            'line': line_of(source, span_start + offset),
        })
    # DBI extraction needs the real string contents — never run against the
    # masked text, unlike the other two scans below.
    for kind_or_rel, target, offset in find_dbi_refs(text):
        line = line_of(source, span_start + offset)
        if kind_or_rel == 'sql_exec':
            refs.append({'from_entity_name': from_entity_name, 'raw_target_name': target,
                         'kind': 'sql_exec', 'line': line})
        else:
            edges.append({'from_entity_name': from_entity_name, 'relationship_type': kind_or_rel,
                          'table': target, 'columns': None, 'line': line})
    for name, offset in find_plain_calls(masked):
        refs.append({
            'from_entity_name': from_entity_name, 'raw_target_name': name, 'kind': 'call',
            'line': line_of(source, span_start + offset),
        })


def build_result(source: str) -> dict:
    subs = find_subs(source)
    nodes = []
    edges: list[dict] = []
    refs: list[dict] = []

    for s in subs:
        header_text = source[s['start']:s['body_start']]
        nodes.append({
            'entity_type': 'subroutine',
            'name':        s['name'],
            'signature':   first_line(header_text),
            'start_line':  line_of(source, s['start']),
            'end_line':    line_of(source, s['end']),
        })
        body = source[s['body_start']:s['end']]
        scan_span(source, body, s['body_start'], s['name'], edges, refs)

    # Top-level text outside every sub belongs to the file itself — this is
    # where a Perl file's `use`/`require` statements almost always live.
    cursor = 0
    for s in subs:
        if s['start'] > cursor:
            gap = source[cursor:s['start']]
            scan_span(source, gap, cursor, None, edges, refs)
        cursor = s['end']
    if cursor < len(source):
        gap = source[cursor:]
        scan_span(source, gap, cursor, None, edges, refs)

    return {'nodes': nodes, 'edges': edges, 'unresolved_refs': refs}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('file_path')
    args = parser.parse_args()

    try:
        with open(args.file_path, 'r', encoding='utf-8', errors='replace') as f:
            source = f.read()
    except OSError as e:
        print(f'Error: could not read file: {e}', file=sys.stderr)
        sys.exit(1)

    try:
        result = build_result(source)
    except Exception as e:
        print(f'Error: {e}', file=sys.stderr)
        sys.exit(1)

    print(json.dumps(result))


if __name__ == '__main__':
    main()
