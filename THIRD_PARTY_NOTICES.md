# Third-party notices

This project bundles or depends on third-party software and fonts. The
application source code is MIT-licensed; fonts and dependencies keep their own
terms.

## Runtime dependencies (npm)

See `package.json` / `package-lock.json` for versions. Major libraries:

| Package | License (typical) | Use |
|---------|-------------------|-----|
| [three](https://github.com/mrdoob/three.js) | MIT | 3D rendering |
| [three-bvh-csg](https://github.com/gkjohnson/three-bvh-csg) | MIT | Date cavity CSG |
| [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) | MIT | Mesh BVH (CSG peer) |
| [opentype.js](https://github.com/opentypejs/opentype.js) | MIT | Font outline parsing |
| [tengwar](https://github.com/kriskowal/tengwarjs) | MIT | Annatar / Dan Smith helpers |
| [lil-gui](https://github.com/georgealways/lil-gui) | MIT | Optional UI dependency |

Always verify the license file inside each package for the exact terms of the
version you install.

## Tecendil-compatible mode data

Offline mode JSON under `src/tecendil/modes/` follows the open mode format used by
[arnog/tecendil-js](https://github.com/arnog/tecendil-js) (preprocess / map / words /
tengwar literals). Encoding to Annatar keys is implemented in this repo.

This project does **not** call tecendil.com and is not affiliated with Tecendil.

Check upstream license terms if you extract or redistribute those mode files alone.

## Fonts in `public/fonts/`

| Font | Files | License / notes |
|------|-------|-----------------|
| **Tengwar Annatar** | `TengwarAnnatar*.ttf` | © Johan Winge. Freeware. See `public/fonts/TengwarAnnatar-LICENSE.txt` and `TengwarAnnatar-readme.txt`. Redistribution and commercial-use conditions apply (including providing the author a free copy of commercial products that use the font). Using Tolkien's tengwar in commercial products may also require rights from the Tolkien Estate. Filenames here differ from the original `tngan*.ttf` package names; keep the license/readme next to the TTFs when redistributing. |
| **Inter** | `Inter-Regular.ttf` | [SIL Open Font License 1.1](https://github.com/rsms/inter/blob/master/LICENSE.txt) |
| **Cinzel / Cinzel Decorative** | `Cinzel-*.ttf`, `CinzelDecorative-*.ttf` | [SIL Open Font License 1.1](https://scripts.sil.org/OFL) (Google Fonts distribution) |
| **Uncial Antiqua** | `UncialAntiqua.ttf` | Copyright © 2011 Brian J. Bonislawsky DBA Astigmatic (AOETI). Confirm current Astigmatic free-font terms before commercial redistribution of the font file alone. |

### Redistributing this repo

- **Source code:** MIT (see `LICENSE`).
- **Tengwar Annatar:** keep the license + readme files next to the TTFs; do not charge for the font alone; follow Johan Winge's conditions for commercial products.
- **OFL fonts (Inter, Cinzel):** redistributable under OFL rules (retain copyright and license notices).
- **Uncial Antiqua:** verify Astigmatic terms for your use case before shipping the font in a commercial product package.

This project does **not** claim affiliation with the Tolkien Estate, Middle-earth Enterprises, or Tecendil.
