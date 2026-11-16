import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { sha256 } from "../src/font-utils";
import { pack, unpack, parsePreset, missing, referenced } from "../src/preset";
import { initial, effective, ImportedFont, Rule } from "../src/types";
import { stylesFor } from "../src/typography";

const sample = () => initial().presets[0];
const local: Rule = { fonts: [{ kind: "local", name: "Georgia" }], size: 24, weight: 550 };
const bytes = new Uint8Array([1, 2, 3]).buffer;
const fake = (hash: string, weight = 400, style = "Regular"): ImportedFont => ({
    id: hash,
    sha256: hash,
    displayName: "Demo",
    fontName: "Demo",
    fontStyle: style,
    fontWeight: weight,
    originalName: "demo.ttf",
    extension: "ttf",
    size: 3,
    variationAxes: {},
    coverage: { chinese: true, english: true, emoji: false, math: false },
});
describe("native typography", () => {
    it("emits no overrides for an empty preset", () => expect(stylesFor(sample(), [], () => "")).toBe(""));
    it("scopes interface weight to chrome so that notes keep their own weight", () => {
        const p = sample();
        p.rules.ui = { fonts: [], weight: 830 };
        const css = stylesFor(p, [], () => "");
        expect(css).toContain(".nav-file-title");
        expect(css).toContain("font-weight:830");
        expect(css).not.toMatch(/body\{[^}]*font-weight/);
    });
    it("keeps native note zoom and independent heading controls", () => {
        const p = sample();
        p.rules.content = { fonts: [], size: 125 };
        p.rules.h2 = local;
        const css = stylesFor(p, [], () => "");
        expect(css).toContain("var(--font-text-size) * 1.25");
        expect(css).toContain("--h2-size:24px");
        expect(css).not.toContain("--h1-size");
    });
    it("keeps dormant block settings when linking code and math", () => {
        const p = sample();
        p.rules.code = local;
        p.rules.blockCode = { fonts: [], size: 42 };
        p.rules.math = { fonts: [], size: 115 };
        expect(effective(p, "blockCode")).toEqual(local);
        expect(effective(p, "blockMath").size).toBe(115);
        p.splitCode = true;
        expect(effective(p, "blockCode").size).toBe(42);
    });
    it("preserves the fallback order, including missing imports", () => {
        const p = sample();
        p.rules.content = {
            fonts: [
                { kind: "library", hash: "1".repeat(64), name: "Lost" },
                { kind: "local", name: "Latin" },
                { kind: "local", name: "CJK" },
            ],
        };
        expect(stylesFor(p, [], () => "")).toContain('"Latin", "CJK", var(--font-text-override)');
        expect(missing(p, [])).toEqual(["Lost"]);
    });
    it("limits named emoji families to emoji codepoints", () => {
        const p = sample();
        p.rules.emoji = local;
        const css = stylesFor(p, [], () => "");
        expect(css).toContain("unicode-range:");
        expect(css).toContain('local("Georgia")');
    });
    it("registers real bold/italic companions under the same family", () => {
        const p = sample();
        const fonts = [
            fake("a".repeat(64)),
            fake("b".repeat(64), 700, "Bold"),
            fake("c".repeat(64), 400, "Italic"),
            fake("d".repeat(64), 700, "Bold Italic"),
        ];
        p.rules.content = { fonts: [{ kind: "library", hash: fonts[0].id, name: "Demo" }] };
        const css = stylesFor(p, fonts, (f) => f.id);
        expect(css.match(/@font-face/g)).toHaveLength(4);
        expect(css).toContain("font-style:italic;font-weight:700");
        expect(referenced(p, fonts)).toHaveLength(4);
    });
    it("registers the weight range for a variable font", () => {
        const p = sample(),
            f = fake("e".repeat(64));
        f.variationAxes.wght = { name: "Weight", min: 100, max: 900, default: 400 };
        p.rules.h2 = { fonts: [{ kind: "library", name: "Variable", hash: f.id }], weight: 530 };
        const css = stylesFor(p, [f], (f) => f.id);
        expect(css).toContain("font-weight:100 900");
        expect(css).toContain("--h2-weight:530");
    });
});
describe("portable presets", () => {
    it("round-trips settings only and preserves unresolved hashes", async () => {
        const p = sample();
        p.rules.h2 = { ...local, fonts: [{ kind: "library", name: "Demo", hash: "e".repeat(64) }] };
        const result = await unpack(await pack(p, []), false);
        expect(result.fonts).toEqual([]);
        expect(missing(result.preset, [])).toEqual(["Demo"]);
    });
    it("round-trips bundled faces and verifies content hashes", async () => {
        const hash = await sha256(bytes),
            f = fake(hash),
            p = sample();
        p.rules.code = { fonts: [{ kind: "library", hash, name: "Demo" }] };
        const result = await unpack(await pack(p, [f], async () => bytes), true);
        expect(result.fonts).toEqual([{ hash, filename: "demo.ttf", bytes }]);
        expect(missing(result.preset, [f])).toEqual([]);
        await expect(pack(p, [f], async () => new ArrayBuffer(0))).rejects.toThrow();
    });
    it("rejects corrupted or missing ZIP entries", async () => {
        const hash = "a".repeat(64),
            path = "fonts/" + hash + ".ttf";
        const manifest = strToU8(
            JSON.stringify({
                version: 1,
                format: "font-studio-preset",
                preset: sample(),
                bundled: [{ filename: "demo.ttf", hash, path }],
            }),
        );
        for (const files of [{}, { [path]: new Uint8Array([3]) }])
            await expect(unpack(zipSync({ "preset.json": manifest, ...files }), true)).rejects.toThrow();
    });
    it.each([
        { format: "siyuan-font-studio-preset", version: 1 },
        { format: "font-studio-preset", version: 2 },
    ])("rejects a foreign format or version", async (x) => {
        await expect(
            unpack(strToU8(JSON.stringify({ ...x, preset: sample(), bundled: [] })), false),
        ).rejects.toThrow();
    });
    it.each([0, -100, 9999, "10px;"])("rejects invalid numeric values %#", (size) => {
        const p = sample();
        expect(() => parsePreset({ ...p, rules: { h1: { fonts: [], size } } })).toThrow();
    });
});
