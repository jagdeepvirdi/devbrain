export const LANGUAGE_COLOR: Record<string, string> = {
  typescript: '#3178C6', javascript: '#F1C40F', python: '#3776AB', dart: '#0175C2',
  java: '#EA6B23', kotlin: '#7F52FF', go: '#00ADD8', rust: '#DE7A22', ruby: '#CC342D',
  php: '#787CB5', swift: '#FA7343', c: '#93C5FD', cpp: '#93C5FD', csharp: '#68217A',
  bash: '#89E051', powershell: '#5391FE', vue: '#41B883', svelte: '#FF3E00',
  perl: '#39457E', sql: '#E38C00', plsql: '#F80000',
}

export function langColor(lang: string | null) {
  return LANGUAGE_COLOR[lang ?? ''] ?? 'var(--fg-3)'
}
