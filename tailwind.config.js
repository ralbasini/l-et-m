/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,js}'],
  theme: {
    extend: {
      colors: {
        ink: '#1A2130',
        'ink-2': '#232B3D',
        brass: '#C9A15C',
        'brass-soft': '#DDBF8C',
        ivory: '#F2E9D8',
        charcoal: '#2B2620',
        wine: '#7B3B49',
      },
      fontFamily: {
        display: ['"Fraunces"', 'Georgia', 'serif'],
        script: ['"Bonheur Royale"', 'cursive'],
        body: ['"Work Sans"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
