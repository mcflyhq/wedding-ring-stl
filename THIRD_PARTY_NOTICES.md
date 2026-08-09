# Third-party notices

This project bundles or depends on third-party software and fonts. The
application source code is MIT-licensed; fonts and dependencies keep their own
terms.

## Runtime dependencies (npm)

See `package.json` / `package-lock.json` for versions. Major libraries:

| Package | License (typical) | Use |
|---------|-------------------|-----|
| [three](https://github.com/mrdoob/three.js) | MIT | 3D rendering |
| [three-bvh-csg](https://github.com/gkjohnson/three-bvh-csg) | MIT | Optional CSG tooling |
| [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) | MIT | Mesh BVH |
| [opentype.js](https://github.com/opentypejs/opentype.js) | MIT | Font outline parsing |
| [tengwar](https://github.com/kriskowal/tengwarjs) | MIT | Annatar / Dan Smith helpers |
| [lil-gui](https://github.com/georgealways/lil-gui) | MIT | (available dependency) |

Always verify the license file inside each package for the exact terms of the
version you install.

## Fonts in `public/fonts/`

| Font | Files | License / notes |
|------|-------|-----------------|
| **Tengwar Annatar** | `TengwarAnnatar*.ttf` | © Johan Winge — freeware. See `public/fonts/TengwarAnnatar-LICENSE.txt`. Non-commercial redistribution terms and commercial-use conditions apply. Using Tolkien’s tengwar in commercial products may require rights from the Tolkien Estate. |
| **Inter** | `Inter-Regular.ttf` | [SIL Open Font License 1.1](https://github.com/rsms/inter) |
| **Cinzel / Cinzel Decorative** | `Cinzel-*.ttf`, `CinzelDecorative-*.ttf` | [SIL Open Font License 1.1](https://fonts.google.com/specimen/Cinzel) |
| **Uncial Antiqua** | `UncialAntiqua.ttf` | Check the original distributor’s terms before commercial redistribution of the font file |

### Redistributing this repo

- **Source code** — MIT (see `LICENSE`).
- **Tengwar Annatar** — keep the original license + readme files next to the TTFs; do not charge for the font alone; follow Johan Winge’s conditions for commercial products.
- **OFL fonts** — may be redistributed under OFL rules (keep license notices).

This project does **not** claim affiliation with the Tolkien Estate, Middle-earth Enterprises, or Tecendil.
