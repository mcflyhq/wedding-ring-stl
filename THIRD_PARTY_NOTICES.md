# Third-party notices

Application source in this repository is MIT (`LICENSE`). Everything below keeps
its own terms. Versions: see `package-lock.json`.

## npm packages

| Package | License | Role |
|---------|---------|------|
| [three](https://github.com/mrdoob/three.js) | MIT | 3D |
| [three-bvh-csg](https://github.com/gkjohnson/three-bvh-csg) | MIT | Date CSG |
| [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) | MIT | BVH peer of CSG |
| [opentype.js](https://github.com/opentypejs/opentype.js) | MIT | Font outlines |
| [tengwar](https://github.com/kriskowal/tengwarjs) | MIT (`LICENSE.md` in package) | Annatar / Dan Smith helpers |
| [lil-gui](https://github.com/georgealways/lil-gui) | MIT | Listed dependency (UI kit) |

Dev-only tools (TypeScript, Vite, vite-node, `@types/*`) are not shipped in the
browser bundle. Check each package's own license file for the pinned version.

## Mode data (`src/tecendil/modes/`)

JSON mode shape matches the open format from
[arnog/tecendil-js](https://github.com/arnog/tecendil-js) (MIT, © Arno Gourdol).
Annatar key encoding is implemented here. No network calls to tecendil.com.
Not affiliated with Tecendil.

## Fonts (`public/fonts/`)

| Font | Files | Terms |
|------|-------|--------|
| Tengwar Annatar | `TengwarAnnatar*.ttf` | © Johan Winge. Freeware. Full text: `TengwarAnnatar-LICENSE.txt` and `TengwarAnnatar-readme.txt`. Redistribute only with those notices; do not sell the font alone; commercial products using the font must send the author a free copy of the product (his terms). Tolkien's tengwar as a writing system may need Estate permission for commercial use. Filenames here are not the original `tngan*.ttf` names. |
| Inter | `Inter-Regular.ttf` | SIL OFL 1.1: https://github.com/rsms/inter/blob/master/LICENSE.txt |
| Cinzel / Cinzel Decorative | `Cinzel*.ttf`, `CinzelDecorative-*.ttf` | SIL OFL 1.1 (Google Fonts): https://scripts.sil.org/OFL |
| Uncial Antiqua | `UncialAntiqua.ttf` | © 2011 Brian J. Bonislawsky / Astigmatic (AOETI). Confirm Astigmatic free-font terms before redistributing the file in a commercial font package. |

## What you can do with this repo

| Piece | Summary |
|-------|---------|
| App source | MIT |
| OFL fonts | Keep OFL notices; OFL rules apply |
| Tengwar Annatar | Follow Winge's license next to the TTFs |
| Uncial Antiqua | Follow Astigmatic terms |
| Mode JSON format | MIT upstream (tecendil-js); our encoding code is MIT with the app |

No affiliation with the Tolkien Estate, Middle-earth Enterprises, or Tecendil.
