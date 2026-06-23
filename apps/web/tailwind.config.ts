import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#FFF5F5',
          100: '#FDE8E8',
          200: '#FBBFBF',
          300: '#F99090',
          400: '#F77070',
          DEFAULT: '#F06A6A',
          500: '#F06A6A',
          600: '#E05555',
          700: '#C43A3A',
          800: '#9B2626',
          900: '#7A1A1A',
        },
        sidebar: {
          bg: '#F3F4F6',
          border: '#E5E7EB',
          text: '#4B5563',
          active: '#F06A6A',
          'active-bg': '#FDE8E8',
          hover: '#FDE8E8',
        },
        page: {
          bg: '#F9FAFB',
          card: '#FFFFFF',
        },
        coral: {
          DEFAULT: '#F06A6A',
          hover: '#E05555',
          tint: '#FDE8E8',
        },
        // "Connected Infrastructure" login brand palette
        brand: {
          indigo: '#211A4D',
          navy: '#17123A',
          purple: '#6D4AFF',
          violet: '#8A63FF',
          'violet-soft': '#A78BFA',
          coral: '#F06A6A',
          'coral-bright': '#FF6B6B',
          peach: '#FFD4CC',
          pink: '#F8B4C8',
          focus: '#7C5CFC',
        },
      },
      keyframes: {
        'signal-pulse': {
          '0%': { transform: 'scale(0.6)', opacity: '0.55' },
          '70%': { opacity: '0' },
          '100%': { transform: 'scale(1.9)', opacity: '0' },
        },
        'float-y': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        'glow-drift': {
          '0%, 100%': { transform: 'translate3d(0,0,0)', opacity: '0.85' },
          '50%': { transform: 'translate3d(2%, -3%, 0)', opacity: '1' },
        },
      },
      animation: {
        'signal-pulse': 'signal-pulse 3.6s cubic-bezier(0.22, 1, 0.36, 1) infinite',
        'signal-pulse-slow': 'signal-pulse 5s cubic-bezier(0.22, 1, 0.36, 1) infinite',
        'float-y': 'float-y 6s ease-in-out infinite',
        'glow-drift': 'glow-drift 14s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
export default config;
