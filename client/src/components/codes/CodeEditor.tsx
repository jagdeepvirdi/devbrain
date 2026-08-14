import { forwardRef, useEffect, useMemo, useState } from 'react'
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { languages } from '@codemirror/language-data'
import { LanguageDescription, type LanguageSupport } from '@codemirror/language'
import { githubDarkInit } from '@uiw/codemirror-theme-github'
import type { Extension } from '@codemirror/state'
import { listEnterKeymap } from './listFormatting'

// DevBrain's internal language codes (see LANGUAGE_COLOR in Codes.tsx) mapped to the
// display names @codemirror/language-data matches against. Covers everything in that
// map except Svelte, which has no dedicated CodeMirror grammar upstream — falls back
// to plain text (still editable, just uncolored) rather than erroring.
const CM_LANGUAGE_NAME: Record<string, string> = {
  typescript: 'TypeScript', javascript: 'JavaScript', python: 'Python', dart: 'Dart',
  java: 'Java', kotlin: 'Kotlin', go: 'Go', rust: 'Rust', ruby: 'Ruby',
  php: 'PHP', swift: 'Swift', c: 'C', cpp: 'C++', csharp: 'C#',
  bash: 'Shell', powershell: 'PowerShell', vue: 'Vue',
  perl: 'Perl', sql: 'SQL', plsql: 'PLSQL',
}

const theme = githubDarkInit({
  settings: { fontFamily: 'var(--font-mono), monospace', background: 'transparent', gutterBackground: 'transparent' },
})

// `language` (DevBrain's internal short code, e.g. from documents.language) is tried first;
// `filename` (a real path/basename, for the Phase 37 on-disk file editor which has no
// stored language column) is the fallback, matched via CodeMirror's own filename→grammar
// table. Exactly one of the two is expected to be meaningful for any given caller.
async function loadLanguageExtension(language: string | null, filename?: string): Promise<LanguageSupport | null> {
  const desc = language
    ? LanguageDescription.matchLanguageName(languages, CM_LANGUAGE_NAME[language] ?? language, true)
    : filename
    ? LanguageDescription.matchFilename(languages, filename)
    : null
  if (!desc) return null
  try {
    return await desc.load()
  } catch {
    return null
  }
}

type CodeEditorProps = {
  value:      string
  language?:  string | null
  filename?:  string
  onChange:   (value: string) => void
  readOnly?:  boolean
  autoFocus?: boolean
  // Note-only bullet/numbered list Enter-key continuation (see listFormatting.ts) — off by
  // default so the Codes tab's plain code editing is unaffected.
  enableListEditing?: boolean
}

export const CodeEditor = forwardRef<ReactCodeMirrorRef, CodeEditorProps>(function CodeEditor(
  { value, language, filename, onChange, readOnly, autoFocus, enableListEditing }, ref
) {
  const [langExt, setLangExt] = useState<LanguageSupport | null>(null)

  useEffect(() => {
    let cancelled = false
    setLangExt(null)
    loadLanguageExtension(language ?? null, filename).then(ext => { if (!cancelled) setLangExt(ext) })
    return () => { cancelled = true }
  }, [language, filename])

  const extensions = useMemo<Extension[]>(() => {
    const exts: Extension[] = []
    if (langExt) exts.push(langExt)
    if (enableListEditing) exts.push(listEnterKeymap)
    return exts
  }, [langExt, enableListEditing])

  return (
    <CodeMirror
      ref={ref}
      value={value}
      onChange={onChange}
      theme={theme}
      extensions={extensions}
      readOnly={readOnly}
      autoFocus={autoFocus}
      height="100%"
      style={{ height: '100%', fontSize: 13 }}
      basicSetup={{
        lineNumbers:        true,
        highlightActiveLine: true,
        foldGutter:          true,
        bracketMatching:     true,
        closeBrackets:       true,
        autocompletion:      false,
        searchKeymap:        true,
      }}
    />
  )
})
