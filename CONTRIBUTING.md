# Contributing

Thanks for helping improve **One Ring Studio**. Short path: clone → change → pull request.

## Ways to contribute

- Bug reports and regressions
- Print-quality / mesh fixes
- UI/UX polish
- Docs and examples
- Tests and tooling

## Development setup

**Requirements:** Node.js 20+ (LTS recommended), npm 10+.

```bash
git clone https://github.com/mcflyhq/wedding-ring-stl.git
cd wedding-ring-stl
npm install
npm run dev
```

Open the URL Vite prints (default `http://127.0.0.1:5173`).

Hosted demo (no install): https://wedding-ring-stl.vercel.app

### Useful scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Local dev server with HMR |
| `npm run build` | Typecheck + production build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Integration checks for preview vs final `buildRing` |
| `npm run typecheck` | TypeScript only |

## Project map

```
src/
  main.ts              # UI wiring, rebuild scheduling
  buildRing.ts         # Assemble band + inscriptions
  ringGeometry.ts      # Domed lathe band
  textEngraving.ts     # Glyph layout, bend, displacement carve
  exportStl.ts         # Binary STL (mm)
  tengwarTranscribe.ts # Resolve Latin vs Tecendil keys
  types.ts             # RingParams + defaults
public/fonts/          # Bundled typefaces (see THIRD_PARTY_NOTICES.md)
scripts/
  test-build-modes.mts # Preview / final stage tests
```

## Coding guidelines

- **TypeScript:** no `any` without a short justification comment; no bare
  `@ts-ignore` / `@ts-expect-error` without explanation.
- **Match existing style:** keep changes focused; avoid drive-by refactors.
- **Comments:** explain *why*, not *what*; delete dead code instead of
  commenting it out.
- **Performance:** interactive rebuilds should stay responsive (debounce,
  cancel in-flight work, draft quality while dragging).
- **Print safety:** export mesh must be the solid band with recesses only
  (no cutaway, no preview-only ink unless intentional).

## Pull requests

1. Fork the repo (or branch from `main` if you have write access).
2. Create a branch: `git checkout -b fix/short-description`.
3. Make a focused change; keep PRs reviewable.
4. Run `npm run build` and `npm test`; fix failures.
5. Manually smoke-test in the browser:
   - Ring appears with default params
   - Inner / outer text and date update after rebuild
   - Cutaway toggles without breaking export intent
   - **Export STL** downloads a non-empty `.stl`
6. Open a PR against `main` using the PR template.

### Commit messages

Prefer short, imperative summaries:

```
Fix date engraving angular wrap on opposite face
Document Tengwar Annatar redistribution terms
```

## Issues

- Search existing issues before opening a new one.
- Use the **bug report** or **feature request** templates.
- For bugs, include browser, OS, steps, expected vs actual, and screenshots
  when the 3D view is involved.

## License

By contributing, you agree that your contributions are licensed under the
MIT License (`LICENSE`), except where you clearly mark third-party material
under another license.
