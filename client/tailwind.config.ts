import type { Config } from 'tailwindcss'

// Design tokens extracted from DevBrain-handoff/project/styles.css
// and reconciled with CLAUDE.md design system section.

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    // Override default font sizes with DevBrain density scale
    fontSize: {
      xs:   ['10.5px', { lineHeight: '1.4' }],
      sm:   ['11.5px', { lineHeight: '1.4' }],
      base: ['13px',   { lineHeight: '1.45' }],
      md:   ['13.5px', { lineHeight: '1.65' }],
      lg:   ['14px',   { lineHeight: '1.4' }],
      xl:   ['15px',   { lineHeight: '1.3' }],
      '2xl':['22px',   { lineHeight: '1.25' }],
      '3xl':['26px',   { lineHeight: '1.2' }],
    },
    borderRadius: {
      none: '0',
      sm:   '4px',
      DEFAULT: '6px',
      lg:   '10px',
      xl:   '12px',
      full: '9999px',
    },
    extend: {
      colors: {
        // ── Surfaces ─────────────────────────────────────────
        bg: {
          DEFAULT:  '#0A0A0F',   // --bg
          elev:     '#0F0F17',   // --bg-elev
          'elev-2': '#14141E',   // --bg-elev-2
          hover:    '#1A1A26',   // --bg-hover
          panel:    '#0D0D14',   // --panel
          code:     '#07070C',   // code block background
        },

        // ── Text ─────────────────────────────────────────────
        fg: {
          DEFAULT: '#E8E8F0',    // --fg
          2:       '#B4B4C2',    // --fg-2
          3:       '#7A7A8A',    // --fg-3
          4:       '#4A4A56',    // --fg-4
        },

        // ── Accent (electric indigo) ──────────────────────────
        accent: {
          DEFAULT: '#6366F1',    // --accent
          2:       '#818CF8',    // --accent-2
          hover:   '#7077F5',    // primary btn hover
        },

        // ── Border / line ─────────────────────────────────────
        // These are rgba values — use bg-[...] or border-[...] with raw values
        // Aliases provided as Tailwind can't easily extend rgba with names.
        // Use: border-white/[.06]  border-white/[.10]  border-white/[.16]

        // ── Status / semantic ─────────────────────────────────
        status: {
          red:    '#F05A5A',
          orange: '#FF9D4D',
          yellow: '#E6C341',
          green:  '#4ADE80',
          blue:   '#60A5FA',
          teal:   '#2DD4BF',
          violet: '#A78BFA',
        },

        // ── Project identity ──────────────────────────────────
        project: {
          playcru:     '#2ECC71',
          quantcru:    '#F59E0B',
          memex:       '#8B5CF6',
          devbrain:    '#6366F1',
          musicplayer: '#EC4899',
        },
      },

      fontFamily: {
        ui:   ['"IBM Plex Sans"', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', '"SF Mono"', 'Menlo', 'monospace'],
      },

      // Named spacing for DevBrain density tokens
      spacing: {
        'pad':    '14px',
        'pad-sm': '10px',
        'gap':    '12px',
        'row':    '32px',
      },

      height: {
        'topbar': '44px',
        'row':    '32px',
        'btn':    '26px',
        'badge':  '18px',
        'pill':   '18px',
      },

      width: {
        'sidebar': '220px',
        'sidebar-collapsed': '56px',
      },

      // Box shadow helpers matching the design
      boxShadow: {
        'accent-glow':  '0 0 0 1px rgba(99,102,241,.3), 0 0 18px rgba(99,102,241,.25)',
        'accent-ring':  '0 0 0 3px rgba(99,102,241,.10)',
        'brand-mark':   'inset 0 0 0 1px rgba(255,255,255,.1), 0 0 0 1px rgba(99,102,241,.25), 0 0 16px rgba(99,102,241,.35)',
        'palette':      '0 24px 60px rgba(0,0,0,.6), 0 0 0 1px rgba(99,102,241,.10)',
        'dd':           '0 16px 40px rgba(0,0,0,.55)',
        'nav-active':   'inset 0 0 0 1px rgba(255,255,255,.10)',
        'toast':        '0 12px 32px rgba(0,0,0,.5)',
      },
    },
  },
  plugins: [],
} satisfies Config
