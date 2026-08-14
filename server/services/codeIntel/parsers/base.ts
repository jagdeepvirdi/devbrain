import type { ParseResult } from '../types.js'

// Shared contract every language parser implements (tree-sitter-based, e.g.
// python/bash/typescript/javascript, or Python-subprocess-bridge-based, e.g.
// sql/plsql/perl — see TASKS.md Phase 40). The indexer (index-code-graph.ts,
// not yet built) dispatches to one of these per file by extension via
// CODE_EXT_LANGUAGE (server/services/parser.ts) and doesn't need to know how
// any individual language is actually parsed.
export interface BaseParser {
  // Languages this parser handles, matching the `language` values produced
  // by CODE_EXT_LANGUAGE — e.g. ['python'], ['sql', 'plsql'].
  languages: string[]
  extractEntities(filePath: string, projectId: string, source: string): Promise<ParseResult>
}
