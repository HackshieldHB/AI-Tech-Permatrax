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
      },
    },
  },
  plugins: [],
};
export default config;
