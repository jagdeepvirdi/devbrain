"""
sql_bridge.py — Postgres/Oracle SQL entity + table/column read-write
extraction for the Code Intelligence engine (TASKS.md Phase 40).

Reads a single .sql/.plsql file, parses it with sqlglot, and prints a JSON
object on stdout describing:
  - "nodes": CREATE (OR REPLACE) PROCEDURE/FUNCTION entities found in the
    file (name, signature, start/end line).
  - "edges": READS_TABLE/WRITES_TABLE relationships from an entity (or the
    file itself, for top-level statements outside any procedure/function)
    to a table name, with column-level detail where it could be resolved.

Design notes (see TASKS.md Phase 40 for the full rationale):
  - sqlglot cannot reliably parse a full Oracle "IS/AS ... BEGIN ... END;"
    procedure body as one statement — verified empirically: a real UPDATE
    inside a BEGIN block gets silently dropped from the parse tree. So this
    script does NOT trust sqlglot to decompose a procedure body on its own.
    Instead it finds entity boundaries itself (regex + BEGIN/END depth
    counting for Oracle-style bodies, or $$-quote matching for Postgres-style
    ones), splits the body into individual leaf statements with its own
    quote/comment-aware semicolon splitter, and feeds each leaf statement to
    sqlglot *individually*. A leaf statement that still fails to parse (rare,
    but real on messy legacy SQL) falls back to regex-based table-name
    scanning for that one statement rather than losing the whole file.
  - Column-level detail deliberately avoids sqlglot's `qualify()`/optimizer
    path — empirically, `qualify()` raised `OptimizeError` on a perfectly
    ordinary `INSERT INTO x SELECT ... FROM y` during development. Column
    attribution instead reads the raw (unqualified) parse tree directly:
    single-table statements attribute all columns to that table
    unambiguously; multi-table statements only attribute columns already
    qualified in the source (`alias.column`) via each statement's own
    alias->table map. Anything genuinely ambiguous (unqualified column in a
    multi-table statement, or `SELECT *` without a supplied --schema) is
    left as `columns: null` — "unknown", never guessed.

Usage:
  python sql_bridge.py <file_path> --dialect postgres|oracle [--schema '<json>']

--schema is a JSON object of {table_name: {column_name: data_type}}, sourced
from code_schema_tables/code_schema_columns (Phase 40) — optional. Without
it, `SELECT *` and cross-table ambiguity stay unresolved (columns: null);
with it, `SELECT *` on a single known table expands to its full column list.
"""

import argparse
import json
import re
import sys

import sqlglot
from sqlglot import exp


# ── Statement splitting ─────────────────────────────────────────────────
# Quote/comment-aware semicolon splitter. Only tracks single-quoted string
# literals ('' as an escaped quote) and -- / /* */ comments — enough for
# realistic SQL/PL-SQL without implementing a full lexer. Returns
# (statement_text, start_line) pairs, 1-indexed.

def split_statements(source: str, base_line: int = 1) -> list[tuple[str, int]]:
    statements: list[tuple[str, int]] = []
    buf: list[str] = []
    line = base_line
    start_line = base_line
    seen_content = False  # first non-whitespace char since the last ';' not seen yet
    in_single = False
    in_line_comment = False
    in_block_comment = False
    i = 0
    n = len(source)

    while i < n:
        c = source[i]
        nxt = source[i + 1] if i + 1 < n else ''

        # A standalone `/` on its own line is SQL*Plus's batch terminator —
        # common in Oracle scripts between CREATE PROCEDURE/FUNCTION blocks
        # (exactly the NT Billing file format this targets). It carries no
        # SQL meaning; skip the whole line so it doesn't glue onto the next
        # statement the way a stray keyword would.
        if not seen_content and c == '/':
            eol = source.find('\n', i)
            rest_of_line = source[i + 1:eol] if eol != -1 else source[i + 1:]
            if rest_of_line.strip() == '':
                if eol != -1:
                    line += 1
                    i = eol + 1
                else:
                    i = n
                continue

        if not seen_content and not c.isspace():
            # Track forward to wherever this next statement's real content
            # starts, rather than freezing at the previous ';'s line (which
            # under-counts any blank/comment lines in between).
            start_line = line
            seen_content = True

        if in_line_comment:
            buf.append(c)
            if c == '\n':
                in_line_comment = False
                line += 1
            i += 1
            continue

        if in_block_comment:
            buf.append(c)
            if c == '\n':
                line += 1
            if c == '*' and nxt == '/':
                buf.append(nxt)
                i += 2
                in_block_comment = False
                continue
            i += 1
            continue

        if in_single:
            buf.append(c)
            if c == "'":
                if nxt == "'":
                    buf.append(nxt)
                    i += 2
                    continue
                in_single = False
            elif c == '\n':
                line += 1
            i += 1
            continue

        if c == "'":
            in_single = True
            buf.append(c)
            i += 1
            continue
        if c == '-' and nxt == '-':
            in_line_comment = True
            buf.append(c)
            i += 1
            continue
        if c == '/' and nxt == '*':
            in_block_comment = True
            buf.append(c)
            i += 1
            continue
        if c == ';':
            buf.append(c)
            text = ''.join(buf).strip()
            if text and text != ';':
                statements.append((text, start_line))
            buf = []
            seen_content = False
            i += 1
            continue

        if c == '\n':
            line += 1
        buf.append(c)
        i += 1

    tail = ''.join(buf).strip()
    if tail:
        statements.append((tail, start_line))
    return statements


# ── Entity boundary detection ───────────────────────────────────────────
# Finds CREATE (OR REPLACE) PROCEDURE/FUNCTION spans. Oracle-style bodies
# (IS/AS ... BEGIN ... END;) are bounded by counting BEGIN/END nesting,
# distinguishing a bare closing END from a qualified END IF/LOOP/CASE (which
# closes an inner construct, not the block). Postgres-style bodies
# (... AS $$ ... $$ LANGUAGE ...) are bounded by matching dollar-quote tags,
# which is unambiguous and needs no nesting logic.

CREATE_RE = re.compile(r'\bCREATE\s+(?:OR\s+REPLACE\s+)?(PROCEDURE|FUNCTION)\s+("?[\w$#]+"?)', re.IGNORECASE)
DOLLAR_QUOTE_RE = re.compile(r'\bAS\s*(\$\w*\$)', re.IGNORECASE)
BEGIN_RE = re.compile(r'\bBEGIN\b', re.IGNORECASE)
END_TOKEN_RE = re.compile(r'\bEND(?:\s+(IF|LOOP|CASE)\b)?', re.IGNORECASE)

# Procedures/functions declared *inside* a PACKAGE BODY (the common NT
# Billing file shape — see TASKS.md) have no CREATE prefix of their own:
# just `PROCEDURE name(...) IS/AS ... BEGIN ... END;` as a package member.
# The package SPEC repeats the same name as a bare forward declaration
# (`PROCEDURE name(...);` — signature only, no body) — MEMBER_RE below
# matches both shapes, so find_member_entities() has to tell them apart
# itself: a real definition has IS/AS (optionally after a FUNCTION's RETURN
# clause) right after the parameter list; a forward declaration goes
# straight to `;`. Only the former becomes an entity.
MEMBER_RE = re.compile(r'\b(PROCEDURE|FUNCTION)\s+("?[\w$#]+"?)', re.IGNORECASE)
IS_AS_RE = re.compile(r'\b(IS|AS)\b', re.IGNORECASE)
RETURN_CLAUSE_RE = re.compile(r'\bRETURN\s+[\w$#.]+(\([^)]*\))?', re.IGNORECASE)


def skip_ws_comments(source: str, i: int) -> int:
    n = len(source)
    while i < n:
        c = source[i]
        if c.isspace():
            i += 1
            continue
        if c == '-' and i + 1 < n and source[i + 1] == '-':
            eol = source.find('\n', i)
            i = eol if eol != -1 else n
            continue
        if c == '/' and i + 1 < n and source[i + 1] == '*':
            end = source.find('*/', i + 2)
            i = end + 2 if end != -1 else n
            continue
        break
    return i


def skip_balanced_parens(source: str, i: int) -> int:
    i = skip_ws_comments(source, i)
    if i >= len(source) or source[i] != '(':
        return i
    depth = 0
    n = len(source)
    while i < n:
        if source[i] == '(':
            depth += 1
        elif source[i] == ')':
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return i


def find_block_end(source: str, search_from: int) -> tuple[int, int] | None:
    """Returns (body_start, entity_end) or None if no body could be found."""
    dollar = DOLLAR_QUOTE_RE.search(source, search_from)
    begin = BEGIN_RE.search(source, search_from)

    # Prefer whichever construct actually appears first — a $$ body can't
    # contain an unrelated top-level BEGIN before it in a well-formed file,
    # but guard against picking the wrong one on malformed input anyway.
    if dollar and (not begin or dollar.start() < begin.start()):
        tag = dollar.group(1)
        close = source.find(tag, dollar.end())
        if close == -1:
            return None
        end_of_tag = close + len(tag)
        semi = source.find(';', end_of_tag)
        entity_end = (semi + 1) if semi != -1 else end_of_tag
        # A plpgsql body opens with its own BEGIN (`AS $$ BEGIN ... END; $$`)
        # — skip past it just like the Oracle branch below does, so it
        # doesn't glue onto (and break the parse of) the first statement. A
        # plain `LANGUAGE sql` body has no BEGIN at all — dollar.end() (right
        # after the opening tag) is already the correct body start for that.
        inner_begin = BEGIN_RE.search(source, dollar.end(), close)
        body_start = inner_begin.end() if inner_begin else dollar.end()
        return body_start, entity_end

    if not begin:
        return None

    depth = 1
    pos = begin.end()
    while depth > 0:
        m = END_TOKEN_RE.search(source, pos)
        if not m:
            return None  # unterminated block — skip this entity, don't guess
        if m.group(1):  # END IF / END LOOP / END CASE — doesn't close a BEGIN
            pos = m.end()
            continue
        # Also treat a bare BEGIN encountered before this END as opening a
        # nested block (exception handlers, nested declare blocks, ...).
        nested_begin = BEGIN_RE.search(source, pos)
        if nested_begin and nested_begin.start() < m.start():
            depth += 1
            pos = nested_begin.end()
            continue
        depth -= 1
        pos = m.end()

    semi = source.find(';', pos)
    entity_end = (semi + 1) if semi != -1 else pos
    return begin.end(), entity_end


def find_member_entities(source: str) -> list[dict]:
    """Bare `PROCEDURE`/`FUNCTION name(...)` declarations — package-body
    members, no CREATE prefix. Skips forward declarations (package spec) —
    only a declaration immediately followed by IS/AS (a real body) becomes
    an entity; one followed by `;` is a signature-only forward declaration
    and is silently skipped, same as sqlglot's own "can't resolve, don't
    guess" posture elsewhere in this file."""
    entities = []
    for m in MEMBER_RE.finditer(source):
        pos = skip_balanced_parens(source, m.end())  # parameter list, if any
        pos = skip_ws_comments(source, pos)
        if m.group(1).upper() == 'FUNCTION':
            ret = RETURN_CLAUSE_RE.match(source, pos)
            if ret:
                pos = skip_ws_comments(source, ret.end())
        is_as = IS_AS_RE.match(source, pos)
        if not is_as:
            continue  # forward declaration (goes straight to ';') — no body to report
        bounds = find_block_end(source, m.end())
        if bounds is None:
            continue
        body_start, entity_end = bounds
        entities.append({
            'kind': m.group(1).upper(),
            'name': m.group(2).strip('"'),
            'start': m.start(),
            'end': entity_end,
            'body_start': body_start,
        })
    return entities


def find_entities(source: str) -> list[dict]:
    entities = []
    for m in CREATE_RE.finditer(source):
        bounds = find_block_end(source, m.end())
        if bounds is None:
            continue
        body_start, entity_end = bounds
        entities.append({
            'kind': m.group(1).upper(),
            'name': m.group(2).strip('"'),
            'start': m.start(),
            'end': entity_end,
            'body_start': body_start,
        })
    entities.extend(find_member_entities(source))
    entities.sort(key=lambda e: e['start'])
    accepted: list[dict] = []
    for e in entities:
        # Drop matches inside an already-accepted entity's span — e.g. the
        # literal text "CREATE PROCEDURE" appearing inside a dynamic SQL
        # string within another procedure's body, or a package-member match
        # firing again inside a CREATE PROCEDURE/FUNCTION entity already
        # accepted from CREATE_RE above (CREATE_RE's match starts earlier,
        # at "CREATE", so it sorts first and wins the overlap).
        if accepted and e['start'] < accepted[-1]['end']:
            continue
        accepted.append(e)
    return accepted


def line_of(source: str, offset: int) -> int:
    return source.count('\n', 0, offset) + 1


def first_line(text: str) -> str:
    line = text.split('\n')[0].strip()
    return line if len(line) <= 200 else line[:200] + '…'


def split_top_level_commas(text: str) -> list[str]:
    parts, buf, depth = [], [], 0
    for c in text:
        if c == '(':
            depth += 1
        elif c == ')':
            depth -= 1
        if c == ',' and depth == 0:
            parts.append(''.join(buf))
            buf = []
        else:
            buf.append(c)
    if buf:
        parts.append(''.join(buf))
    return parts


# sqlglot parses SQL, not PL/SQL — a procedure parameter (`p_acct_id`) or a
# DECLARE'd local variable referenced bare inside a body reads, to it, just
# like an unqualified column. Declared parameters are the common, reliably
# extractable case (right there in the header) — this filters those out
# before columns are reported. Local `DECLARE`d variables are NOT covered
# (unfixed known limitation — no similarly reliable place to read them from).
def extract_param_names(header_text: str) -> set[str]:
    open_paren = header_text.find('(')
    if open_paren == -1:
        return set()
    depth = 0
    end = None
    for i in range(open_paren, len(header_text)):
        if header_text[i] == '(':
            depth += 1
        elif header_text[i] == ')':
            depth -= 1
            if depth == 0:
                end = i
                break
    if end is None:
        return set()

    names = set()
    for part in split_top_level_commas(header_text[open_paren + 1:end]):
        m = re.match(r'^\s*"?([A-Za-z_][\w$#]*)"?', part)
        if m:
            names.add(m.group(1).lower())
    return names


# ── Per-statement table/column extraction ───────────────────────────────

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


def regex_fallback_edges(text: str) -> list[dict]:
    """Best-effort table detection for a statement sqlglot couldn't parse —
    tables only, never columns (regex has no notion of column scope)."""
    edges = []
    seen_write = set()
    for pattern, rel in WRITE_TARGET_PATTERNS:
        for m in pattern.finditer(text):
            table = m.group(1).lower()
            if table not in seen_write:
                seen_write.add(table)
                edges.append({'relationship_type': rel, 'table': table, 'columns': None})
    seen_read = set()
    for pattern in READ_SOURCE_PATTERNS:
        for m in pattern.finditer(text):
            table = m.group(1).lower()
            if table not in seen_read and table not in seen_write:
                seen_read.add(table)
                edges.append({'relationship_type': 'READS_TABLE', 'table': table, 'columns': None})
    return edges


def target_table(stmt: exp.Expression) -> exp.Table | None:
    this = stmt.args.get('this')
    if isinstance(this, exp.Table):
        return this
    if this is not None:
        found = this.find(exp.Table)
        if found:
            return found
    return None


def columns_for_table(table_name: str, all_tables: list[str], alias_map: dict[str, str],
                       columns: list[exp.Column], is_star: bool,
                       schema: dict[str, dict[str, str]] | None) -> list[str] | None:
    if is_star:
        if len(all_tables) == 1 and schema and table_name in schema:
            return sorted(schema[table_name].keys())
        return None

    if len(all_tables) == 1:
        names = sorted({c.name for c in columns if c.name})
        return names or None

    attributed = set()
    unqualified = set()
    for c in columns:
        alias = c.table
        if not alias:
            unqualified.add(c.name)
            continue
        real_table = alias_map.get(alias, alias)
        if real_table == table_name:
            attributed.add(c.name)

    # An unqualified column in a multi-table statement is ambiguous from
    # syntax alone (`name` could belong to any joined table) — but with a
    # supplied --schema, "which table actually has a column called this" is
    # answerable. Attribute it here only when exactly one of the statement's
    # tables has a matching column; 0 or 2+ matches stays unresolved, not
    # guessed.
    if schema:
        for col_name in unqualified:
            owners = [t for t in all_tables if t in schema and col_name in schema[t]]
            if len(owners) == 1 and owners[0] == table_name:
                attributed.add(col_name)

    return sorted(attributed) or None


def extract_statement_edges(text: str, dialect: str, schema: dict[str, dict[str, str]] | None,
                             known_non_tables: set[str] = frozenset()) -> list[dict]:
    try:
        stmt = sqlglot.parse_one(text, read=dialect)
    except Exception:
        return regex_fallback_edges(text)

    if stmt is None or not isinstance(stmt, (exp.Select, exp.Insert, exp.Update, exp.Delete, exp.Merge)):
        return regex_fallback_edges(text)

    # Oracle's `SELECT ... INTO local_var FROM ...` wraps the INTO target as
    # an exp.Table too (verified empirically) — that's a PL/SQL variable,
    # never a real table, so it's excluded here rather than reported as one.
    tables = [t for t in stmt.find_all(exp.Table)
              if not isinstance(t.parent, exp.Into) and t.name.lower() not in known_non_tables]
    if not tables:
        return []

    alias_map = {t.alias_or_name: t.name.lower() for t in tables}
    all_table_names = sorted({t.name.lower() for t in tables})
    is_star = any(True for _ in stmt.find_all(exp.Star))
    # Procedure parameters referenced bare in the body parse as columns too
    # (sqlglot has no notion of PL/SQL parameter scope) — see
    # extract_param_names(). Filtered here, once, for every table's list.
    columns = [c for c in stmt.find_all(exp.Column) if c.name.lower() not in known_non_tables]

    write_table = None
    if isinstance(stmt, (exp.Insert, exp.Update, exp.Delete, exp.Merge)):
        wt = target_table(stmt)
        write_table = wt.name.lower() if wt else None

    # `INSERT INTO x (a, b) VALUES (...)` puts the target column list as
    # plain Identifiers under a Schema node, NOT exp.Column — so it's
    # invisible to the find_all(exp.Column) above and needs its own read.
    # This is the common case for a VALUES-style insert (no SELECT source),
    # which otherwise has zero exp.Column nodes at all.
    insert_target_columns: set[str] = set()
    if isinstance(stmt, exp.Insert) and isinstance(stmt.this, exp.Schema):
        insert_target_columns = {
            i.name.lower() for i in stmt.this.expressions if i.name.lower() not in known_non_tables
        }

    edges = []
    for table_name in all_table_names:
        rel = 'WRITES_TABLE' if table_name == write_table else 'READS_TABLE'
        cols = columns_for_table(table_name, all_table_names, alias_map, columns, is_star, schema)
        if table_name == write_table and insert_target_columns:
            cols = sorted(insert_target_columns | set(cols or []))
        edges.append({'relationship_type': rel, 'table': table_name, 'columns': cols})
    return edges


# ── Orchestration ────────────────────────────────────────────────────────

def build_result(source: str, dialect: str, schema: dict[str, dict[str, str]] | None) -> dict:
    entities = find_entities(source)
    nodes = []
    edges = []

    for e in entities:
        header_text = source[e['start']:e['body_start']]
        nodes.append({
            'entity_type': 'function' if e['kind'] == 'FUNCTION' else 'procedure',
            'name':        e['name'],
            'signature':   first_line(header_text),
            'start_line':  line_of(source, e['start']),
            'end_line':    line_of(source, e['end']),
        })
        known_params = extract_param_names(header_text)
        body = source[e['body_start']:e['end']]
        for stmt_text, stmt_line in split_statements(body, base_line=line_of(source, e['body_start'])):
            for edge in extract_statement_edges(stmt_text, dialect, schema, known_params):
                edges.append({**edge, 'from_entity_name': e['name'], 'line': stmt_line})

    # Top-level text outside every entity span belongs to the file itself.
    gaps = []  # (text, start_offset)
    cursor = 0
    for e in entities:
        if e['start'] > cursor:
            gaps.append((source[cursor:e['start']], cursor))
        cursor = e['end']
    if cursor < len(source):
        gaps.append((source[cursor:], cursor))

    for gap, gap_start in gaps:
        for stmt_text, stmt_line in split_statements(gap, base_line=line_of(source, gap_start)):
            for edge in extract_statement_edges(stmt_text, dialect, schema):
                edges.append({**edge, 'from_entity_name': None, 'line': stmt_line})

    return {'nodes': nodes, 'edges': edges, 'unresolved_refs': []}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('file_path')
    parser.add_argument('--dialect', default='postgres', choices=['postgres', 'oracle'])
    parser.add_argument('--schema', default=None, help='JSON: {table: {column: data_type}}')
    args = parser.parse_args()

    try:
        with open(args.file_path, 'r', encoding='utf-8', errors='replace') as f:
            source = f.read()
    except OSError as e:
        print(f'Error: could not read file: {e}', file=sys.stderr)
        sys.exit(1)

    schema = None
    if args.schema:
        try:
            schema = json.loads(args.schema)
        except json.JSONDecodeError as e:
            print(f'Error: --schema is not valid JSON: {e}', file=sys.stderr)
            sys.exit(1)

    try:
        result = build_result(source, args.dialect, schema)
    except Exception as e:
        print(f'Error: {e}', file=sys.stderr)
        sys.exit(1)

    print(json.dumps(result))


if __name__ == '__main__':
    main()
