// ─── what the bundler understands and TypeScript does not ───────────────────
//
// `main.tsx` imports the page's stylesheet for its side effect, which Vite
// resolves and `tsc` cannot: the repo's own tsconfig does not pull in
// `vite/client`, and a demo is not the place to change the root's compiler
// options. This declaration says the one thing the typechecker needs — that the
// import exists and has no type.

declare module '*.css' {
  const stylesheet: string
  export default stylesheet
}
