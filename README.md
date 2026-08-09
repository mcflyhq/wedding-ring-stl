# One Ring Studio

**Parametric wedding-band designer** in the browser: domed ring geometry, dual-face inscriptions (Tengwar Annatar + Latin date), live 3D preview, and **print-ready binary STL** export (millimeters).

> Client-side only — design stays on your machine unless you host the static build yourself.

---

## Features

- **Domed (D-profile) band** — inner diameter (US size chips), width, thickness
- **Inner + outer text** — Latin fields; optional **Tecendil Annatar key** overrides for exact tengwar
- **Inner date stamp** — Inter digits, opposite the primary inscription
- **Live preview** — orbit / zoom / pan, metal finishes, cutaway, ink fill, lighting presets
- **18k gold estimate** — rough mass / melt value from volume + spot price
- **STL export** — binary, mm units, solid band with recessed engraving

## Quick start (local)

**Requirements:** [Node.js](https://nodejs.org/) **20+** and npm 10+.

```bash
git clone https://github.com/OWNER/wedding-ring-stl.git
cd wedding-ring-stl
npm install
npm run dev
```

Open **http://127.0.0.1:5173** (see the terminal if the port differs).

| Script | Description |
|--------|-------------|
| `npm run dev` | Vite dev server + HMR |
| `npm run build` | `tsc` typecheck + production bundle → `dist/` |
| `npm run preview` | Serve `dist/` locally |

## Using the studio

1. Pick **ring size** (or type diameter / width / thickness).
2. Enter **inner / outer Latin text** for reference or Latin faces.
3. For Tengwar Annatar: paste **Tecendil → Font: Annatar** key strings under **Advanced · Tecendil Annatar encoding**.
4. Set **date**, depth, sizes, metal, and **mesh quality** (use **High** before final export).
5. Turn **cutaway off** for manufacturing STLs.
6. **Export STL** and send to your printer / casting service.

### Print tips

- **Quality → High** (~0.08 mm circumferential edges on a US-7) is the practical sweet spot for jewelry resin masters.
- Engraving depth **0.25–0.4 mm**; text size **~1.0–1.6 mm** on typical 4–5 mm bands.
- Prefer **SLA/DLP resin** for masters; metal FDM is a poor fit for fine tengwar.
- Units are **millimeters**. Leave cutaway **off** for the exported solid.

## Project layout

```
wedding-ring-stl/
├── index.html              # Shell UI
├── public/fonts/           # Bundled fonts (see THIRD_PARTY_NOTICES.md)
├── src/
│   ├── main.ts             # Controls, rebuild pipeline
│   ├── buildRing.ts        # Band + inscriptions assembly
│   ├── ringGeometry.ts     # Lathe D-profile
│   ├── textEngraving.ts    # Layout, bend, displacement carve
│   ├── exportStl.ts        # Binary STL writer
│   ├── goldEstimate.ts     # Volume / 18k estimate
│   └── types.ts            # RingParams + defaults
├── LICENSE                 # MIT (application source)
├── THIRD_PARTY_NOTICES.md  # Fonts & dependencies
└── CONTRIBUTING.md
```

## Contributing

We welcome issues and pull requests. Start here:

1. [CONTRIBUTING.md](./CONTRIBUTING.md) — setup, style, PR checklist  
2. [Bug report](../../issues/new?template=bug_report.yml) / [Feature request](../../issues/new?template=feature_request.yml)  
3. [Code of Conduct](./CODE_OF_CONDUCT.md)

```bash
# Before opening a PR
npm run build
# Manually: rebuild ring, toggle cutaway, export STL
```

## Security

See [SECURITY.md](./SECURITY.md) for how to report vulnerabilities privately.

## License

- **Application source code** is released under the **[MIT License](./LICENSE)**.
- **Fonts and npm packages** retain their own licenses — see **[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)**.
- **Tengwar Annatar** is freeware by Johan Winge with redistribution and commercial-use conditions; using Tolkien’s scripts commercially may require permission from the Tolkien Estate.

This project is **not** affiliated with the Tolkien Estate, Middle-earth Enterprises, or Tecendil.

## Acknowledgments

- [Three.js](https://threejs.org/) and [opentype.js](https://opentype.js.org/)
- [Tengwar Annatar](https://www.dafont.com/tengwar-annatar.font) — Johan Winge  
- [tengwarjs](https://github.com/kriskowal/tengwarjs) — Dan Smith encoding helpers  
- Inter, Cinzel, and Uncial faces used under their respective open/font licenses  
- Community tengwar modes and tooling (Tecendil, Glaemscribe, and others) for inspiration

## Maintainers

Replace this section with your GitHub org/user after pushing:

- **Repository:** `https://github.com/OWNER/wedding-ring-stl`  
- **Issues:** use GitHub Issues templates in this repo
