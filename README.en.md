# Font Studio

[中文说明](README.md)

Pair typefaces for Obsidian notes, the interface, and Canvas. Stack fonts in priority order, give each heading its own style, and switch between vault-specific presets. A fresh installation inherits the vault’s existing appearance.

## Install

Download the latest plugin package. [GitHub Releases](https://github.com/MDfox-ChaosZone/obsidian-font-studio/releases/latest)

Extract the `font-studio` folder from the release ZIP into `.obsidian/plugins/` inside your vault. Substitute your vault’s configuration directory if you use a custom one. Confirm that `main.js`, `manifest.json`, and `styles.css` sit directly inside `plugins/font-studio/`. Reload community plugins, enable **Font Studio**, then open its settings or run **Open Font Studio** from the command palette.

## Author example preset

Choose **Download example → Download and apply** to download the 28.5 MiB author preset from this repository. The plugin verifies its SHA-256 digest, imports the five fonts, and applies a new preset. Downloads are user-initiated. To import manually, download the Obsidian ZIP and click **Import** in the preset toolbar. [Example preset release](https://github.com/MDfox-ChaosZone/obsidian-font-studio/releases/tag/example-preset-v1)

## Use

1. Open **Library** and import WOFF2, WOFF, TTF or OTF files. Include bold and italic faces alongside regular ones for real emphasis. Duplicate files are identified by their SHA-256 digest. Variable fonts display their weight range.
2. In the target’s font card, click **Choose fonts**, add imported faces or enter system family names, and order the fallback list using the arrow buttons. Supported desktop environments can enumerate installed families on request. Choose a target weight to use a variable font’s weight axis.
3. Note text size is a percentage of Obsidian’s native size. At 125%, a 16 px note renders at 20 px. Obsidian’s increase/decrease commands still work. Headings and code accept independent pixel sizes. Math uses percentages. Reset font and size independently. The unit selector switches between pixels and percentages for note text and math.
4. Edits save to the active preset. **＋ New** in the preset toolbar duplicates the current typography so you can experiment. Use **Switch font preset** from the command palette to switch without opening settings.

## Supported surfaces

- Interface and note text, including Source mode, Live Preview, and Reading view.
- The inline filename title and six independent Markdown heading levels.
- Inline and block code with optional separate settings and native syntax highlighting.
- Inline and display math scaling, plus font fallback on styleable MathJax text. MathJax retains its math glyphs and fraction layout.
- Canvas text cards with separate typography. Embedded notes follow note settings.
- Styleable Mermaid labels, including flowcharts and mind maps. The renderer controls diagram geometry. Emoji fallback uses scoped character ranges.

Local and global graph views draw their labels on canvas. This release has no independent graph-label font control.

## Transfer a preset

**Export** in the preset toolbar writes into `Font Studio Exports/` at the vault root. JSON contains settings only. ZIP also contains referenced imported faces and their bold/italic companions. System families travel by name. Import either file in another vault. Missing faces remain referenced and start working once their exact files are imported. Invalid packages leave the active preset intact.

Settings are stored in `data.json` and imported fonts in `fonts/` under the plugin directory in your vault’s actual configuration folder. For cross-device use, transfer a ZIP or sync both locations. This plugin uses its own version 1 `font-studio-preset` format. SiYuan preset packages use a different format.

## Develop and verify

Use Node.js 24 and pnpm. Run `pnpm install`, then `pnpm dev` for a watched build or `pnpm check` for tests, type checking and production output. Production builds create `dist/font-studio-1.1.1.zip`.

Verified in isolated Obsidian 1.15.1 vaults on Windows, including native zoom, actual glyph fallback, bold/italic faces, variable weight, math, diagrams, Canvas, popouts, plugin unload, and cross-vault transfer with a custom config directory. The built-in mobile emulator covered narrow screens, touch ordering, import, export and reload. Physical Android/iOS devices and native macOS/Linux hosts have not been tested.

Adapted from MDfox’s SiYuan Font Studio. MIT license.
