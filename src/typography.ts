import { companionFonts, EMOJI_UNICODE_RANGE, quoteFamily, runtimeFamily } from "./font-utils";
import { Choice, effective, ImportedFont, Preset, Rule, Target } from "./types";

type UrlFor = (font: ImportedFont) => string;
export function fontFaces(
    primary: ImportedFont,
    fonts: ImportedFont[],
    url: UrlFor,
    family = runtimeFamily(primary.id),
    emoji = false,
) {
    return [primary, ...companionFonts(primary, fonts)]
        .map((f) => {
            const axis = f.variationAxes?.wght;
            const weight = axis ? axis.min + " " + axis.max : String(f.fontWeight);
            const style = /italic/i.test(f.fontStyle)
                ? "italic"
                : /oblique/i.test(f.fontStyle)
                  ? "oblique"
                  : "normal";
            return (
                "@font-face{font-family:" +
                quoteFamily(family) +
                ";src:url(" +
                quoteFamily(url(f)) +
                ");font-style:" +
                style +
                ";font-weight:" +
                weight +
                ";" +
                (emoji ? "unicode-range:" + EMOJI_UNICODE_RANGE + ";" : "") +
                "}"
            );
        })
        .join("\n");
}
export function stylesFor(p: Preset, fonts: ImportedFont[], url: UrlFor): string {
    const css: string[] = [],
        faces = new Map<string, string>();
    const rule = (sel: string, props: Record<string, string | number | undefined>) => {
        const body = Object.entries(props)
            .filter(([, v]) => v !== undefined && v !== "")
            .map(([k, v]) => k + ":" + v)
            .join(";");
        if (body) css.push(sel + "{" + body + "}");
    };
    function families(choices: Choice[], emoji = false): string[] {
        return choices.flatMap((c, i) => {
            if (c.kind === "local") {
                if (!emoji) return [quoteFamily(c.name)];
                const alias = "FS_emoji_local_" + i;
                faces.set(
                    alias,
                    "@font-face{font-family:" +
                        alias +
                        ";src:local(" +
                        quoteFamily(c.name) +
                        ");unicode-range:" +
                        EMOJI_UNICODE_RANGE +
                        "}",
                );
                return [alias];
            }
            const f = fonts.find((f) => f.id === c.hash);
            if (!f) return [];
            const alias = runtimeFamily(f.id) + (emoji ? "_emoji" : "");
            if (!faces.has(alias)) faces.set(alias, fontFaces(f, fonts, url, alias, emoji));
            return [quoteFamily(alias)];
        });
    }
    const emoji = families(effective(p, "emoji").fonts, true);
    const stack = (r: Rule, tail: string, extra: string[] = []) => {
        const first = [...families(r.fonts), ...extra];
        return first.length ? [...first, tail].join(", ") : undefined;
    };
    const px = (n?: number) => (n === undefined ? undefined : n + "px");
    const ui = effective(p, "ui"),
        content = effective(p, "content");
    rule("body", {
        "--font-interface": stack(
            ui,
            "var(--font-interface-override),var(--font-interface-theme),var(--font-default)",
            emoji,
        ),
        "--font-text": stack(
            content,
            "var(--font-text-override),var(--font-text-theme),var(--font-default)",
            emoji,
        ),
        "--font-ui-medium": px(ui.size),
        "--font-ui-small": ui.size ? "calc(" + ui.size + "px - 1px)" : undefined,
        "--font-ui-smaller": ui.size ? "calc(" + ui.size + "px - 2px)" : undefined,
        "--font-ui-large": ui.size ? px(ui.size + 4) : undefined,
        "--fs-note-size": content.size
            ? "calc(var(--font-text-size) * " + content.size / 100 + ")"
            : undefined,
    });
    // Body weight also cascades into notes. Keep this override on app chrome.
    rule(
        ".nav-file-title,.nav-folder-title,.tree-item-self,.view-header,.workspace-tab-header,.status-bar,.menu,.suggestion-item,.modal-title,.vertical-tab-header,.setting-item,.search-input-container,.fs-ui-example",
        { "font-weight": ui.weight },
    );
    const notes = ":is(.markdown-source-view,.markdown-preview-view,.fs-preview)";
    rule(notes, {
        "--font-text-size": content.size ? "var(--fs-note-size)" : undefined,
        "--font-preferred-size": content.size ? "var(--fs-note-size)" : undefined,
        "font-weight": content.weight,
    });
    for (const t of ["title", "h1", "h2", "h3", "h4", "h5", "h6"] as Target[]) {
        const r = effective(p, t),
            key = t === "title" ? "inline-title" : t;
        rule(notes, {
            ["--" + key + "-font"]: stack(r, "var(--font-text)"),
            ["--" + key + "-size"]: px(r.size),
            ["--" + key + "-weight"]: r.weight,
        });
    }
    function direct(t: Target, selector: string, fallback: string) {
        const r = effective(p, t);
        rule(selector, {
            "font-family": stack(r, fallback),
            "font-size": px(r.size),
            "font-weight": r.weight,
        });
    }
    direct(
        "code",
        "body .markdown-rendered :not(pre)>code,body .cm-s-obsidian span.cm-inline-code",
        "var(--font-monospace)",
    );
    direct(
        "blockCode",
        "body .markdown-rendered pre,body .markdown-rendered pre>code,body .cm-s-obsidian .HyperMD-codeblock",
        "var(--font-monospace)",
    );
    const card = effective(p, "canvas");
    rule(".canvas-node-content.markdown-embed:not(.is-loaded) > .markdown-embed-content > " + notes, {
        "--font-text": stack(card, "var(--font-text-override),var(--font-default)"),
        "font-family": stack(card, "var(--font-text-override),var(--font-default)"),
        "--font-text-size": px(card.size),
        "--font-preferred-size": px(card.size),
        "font-size": px(card.size),
        "font-weight": card.weight,
    });
    for (const t of ["math", "blockMath"] as const) {
        const r = effective(p, t),
            sel = t === "math" ? ".math-inline" : ".math-block";
        rule(sel, { "font-size": r.size ? r.size + "%" : undefined });
        const family = stack(r, "var(--font-text)");
        rule(sel + ' :is(mjx-mtext,mjx-utext,g[data-mml-node="mtext"] text)', {
            "font-family": family ? family + " !important" : undefined,
            "font-weight": r.weight,
        });
    }
    const mer = effective(p, "mermaid");
    rule("body .mermaid", { "--font-mermaid": stack(mer, "var(--font-text)") });
    // Mermaid embeds ID-based CSS in each SVG; scope overrides to label elements only.
    const override = (v: string | number | undefined) => (v === undefined ? undefined : v + " !important");
    rule(
        "body .mermaid :is(text,tspan,.nodeLabel,.edgeLabel,.mindmap-node-label,.label foreignObject div,.label foreignObject span)",
        {
            "font-family": override(stack(mer, "var(--font-text)")),
            "font-size": override(px(mer.size)),
            "font-weight": override(mer.weight),
        },
    );
    return [...faces.values(), ...css].join("\n");
}
