import { forwardRef, useEffect, useMemo, useState } from 'react'
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { languages } from '@codemirror/language-data'
import { LanguageDescription, type LanguageSupport } from '@codemirror/language'
import { githubDarkInit } from '@uiw/codemirror-theme-github'
import type { Extension } from '@codemirror/state'

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

async function loadLanguageExtension(language: string | null): Promise<LanguageSupport | null> {
  if (!language) return null
  const name = CM_LANGUAGE_NAME[language] ?? language
  const desc = LanguageDescription.matchLanguageName(languages, name, true)
  if (!desc) return null
  try {
    return await desc.load()
  } catch {
    return null
  }
}

type CodeEditorProps = {
  value:      string
  language:   string | null
  onChange:   (value: string) => void
  readOnly?:  boolean
  autoFocus?: boolean
}

export const CodeEditor = forwardRef<ReactCodeMirrorRef, CodeEditorProps>(function CodeEditor(
  { value, language, onChange, readOnly, autoFocus }, ref
) {
  const [langExt, setLangExt] = useState<LanguageSupport | null>(null)

  useEffect(() => {
    let cancelled = false
    setLangExt(null)
    loadLanguageExtension(language).then(ext => { if (!cancelled) setLangExt(ext) })
    return () => { cancelled = true }
  }, [language])

  const extensions = useMemo<Extension[]>(() => (langExt ? [langExt] : []), [langExt])

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
