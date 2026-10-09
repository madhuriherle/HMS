/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontSize: {
        'm': '0.875rem',
      },
      colors: {
        brand: {
          primary: 'var(--brand-primary, #510601)',
          secondary: 'var(--brand-secondary, #8C1801)',
          sidebar: 'var(--brand-sidebar, #200200)',
          hover: 'var(--brand-primary-dark, #3D0400)',
          light: 'var(--brand-primary-light, #6D0B04)',
          dark: 'var(--brand-dark, #180200)',
          brown: 'var(--brand-brown, #863221)',
          gold: {
            DEFAULT: 'var(--brand-gold, #FFC107)',
            warm: 'var(--brand-gold-warm, #F4AA26)',
            light: '#FFE082',
            subtle: 'var(--brand-gold-subtle, #FFF8E1)',
          },
          accent: {
            red: 'var(--brand-accent-red, #ED4636)',
            green: 'var(--brand-accent-green, #3D705C)',
            orange: 'var(--brand-accent-orange, #EE6A00)',
          },
          surface: {
            DEFAULT: 'var(--brand-surface, #FFFFFF)',
            cream: 'var(--brand-cream, #FAF7F2)',
            subtle: '#F4EFEA',
            border: 'var(--brand-border, #E8DFD8)',
          },
          maroon: {
            DEFAULT: '#510601',
            dark: '#180200',
            primary: '#510601',
            secondary: '#8C1801',
            brown: '#863221',
            light: '#6D0B04',
          }
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '"Segoe UI"', 'Roboto', 'sans-serif'],
        serif: ['Inter', 'system-ui', '"Segoe UI"', 'Roboto', 'sans-serif'],
        kannada: ["'Anek Kannada'", "'Noto Sans Kannada'", "'Tunga'", 'sans-serif'],
        kannadaSerif: ["'Noto Serif Kannada'", "'Tiro Kannada'", 'serif'],
      },
      boxShadow: {
        'subtle': '0 2px 8px -2px rgba(24, 2, 0, 0.05), 0 4px 16px -4px rgba(24, 2, 0, 0.08)',
        'card': '0 10px 30px -5px rgba(24, 2, 0, 0.06), 0 4px 12px -2px rgba(24, 2, 0, 0.04)',
        'maroon': '0 10px 25px -5px rgba(81, 6, 1, 0.3)',
      }
    },
  },
  plugins: [],
}
