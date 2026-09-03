import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

const config: Config = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '1.5rem',
      screens: { '2xl': '1400px' },
    },
    extend: {
      colors: {
        border: 'hsl(20 15% 88%)',
        input: 'hsl(20 15% 88%)',
        ring: 'hsl(22 90% 48%)',
        background: 'hsl(30 33% 98%)',
        foreground: 'hsl(20 14% 12%)',
        primary: {
          DEFAULT: 'hsl(22 90% 48%)',
          foreground: 'hsl(0 0% 100%)',
        },
        secondary: {
          DEFAULT: 'hsl(215 28% 17%)',
          foreground: 'hsl(0 0% 100%)',
        },
        destructive: {
          DEFAULT: 'hsl(0 72% 51%)',
          foreground: 'hsl(0 0% 100%)',
        },
        muted: {
          DEFAULT: 'hsl(30 15% 94%)',
          foreground: 'hsl(20 8% 40%)',
        },
        accent: {
          DEFAULT: 'hsl(30 20% 92%)',
          foreground: 'hsl(20 14% 12%)',
        },
        popover: {
          DEFAULT: 'hsl(0 0% 100%)',
          foreground: 'hsl(20 14% 12%)',
        },
        card: {
          DEFAULT: 'hsl(0 0% 100%)',
          foreground: 'hsl(20 14% 12%)',
        },
        sidebar: {
          DEFAULT: 'hsl(215 32% 14%)',
          foreground: 'hsl(210 20% 92%)',
          accent: 'hsl(215 28% 22%)',
          border: 'hsl(215 25% 24%)',
        },
        chart: {
          '1': 'hsl(22 90% 48%)',
          '2': 'hsl(199 89% 48%)',
          '3': 'hsl(142 71% 45%)',
          '4': 'hsl(48 96% 53%)',
          '5': 'hsl(280 65% 60%)',
        },
      },
      borderRadius: {
        lg: '0.75rem',
        md: '0.5rem',
        sm: '0.375rem',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [animate],
};

export default config;
