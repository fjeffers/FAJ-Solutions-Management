// Tailwind v4 (Next.js): single PostCSS plugin. Next has no postcss-import
// prerender conflict, so @tailwindcss/postcss is the right integration here
// (the Vite template uses the @tailwindcss/vite plugin instead).
module.exports = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}
