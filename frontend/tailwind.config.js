/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Semantic money colors, green = owed to you, red = you owe.
        credit: '#16a34a',
        debit: '#dc2626',
      },
    },
  },
  plugins: [],
};
