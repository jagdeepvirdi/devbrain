// xlsx (SheetJS) is CJS. Node's static export-detection (cjs-module-lexer) hoists
// most named exports (utils, read, write, writeFile) but misses a few — notably
// readFile — so those are only reachable via `.default` under plain Node ESM.
// vitest's transform happens to expose everything at the top level either way,
// which is why this only bites outside the test runner (see services/parser.ts
// history). Centralizing the workaround here so every call site gets the same
// defensively-unwrapped module instead of re-deriving it.
export async function loadXlsx(): Promise<typeof import('xlsx')> {
  const mod = await import('xlsx')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- runtime/typings mismatch, not a real `any` value
  const modAny = mod as any
  const hasFullApi = typeof modAny.readFile === 'function' && typeof modAny.write === 'function'
  return hasFullApi ? mod : (modAny.default ?? mod)
}
