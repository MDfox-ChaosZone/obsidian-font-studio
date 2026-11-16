export interface FontVariationAxis {
    name: string;
    min: number;
    default: number;
    max: number;
}
export interface FontCoverage {
    chinese: boolean;
    english: boolean;
    emoji: boolean;
    math: boolean;
}
export interface ImportedFont {
    id: string;
    sha256: string;
    displayName: string;
    originalName: string;
    extension: string;
    fontName: string;
    fontStyle: string;
    fontWeight: number;
    variationAxes: Record<string, FontVariationAxis>;
    coverage: FontCoverage;
    size: number;
}
export const targets = [
    "ui",
    "content",
    "title",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "code",
    "blockCode",
    "math",
    "blockMath",
    "canvas",
    "mermaid",
    "emoji",
] as const;
export type Target = (typeof targets)[number];
export type Choice = { kind: "local"; name: string } | { kind: "library"; name: string; hash: string };
export interface Rule {
    fonts: Choice[];
    size?: number;
    weight?: number;
}
export interface Preset {
    name: string;
    rules: Partial<Record<Target, Rule>>;
    splitCode: boolean;
    splitMath: boolean;
}
export interface SavedPreset extends Preset {
    id: string;
}
export interface State {
    version: 1;
    fonts: ImportedFont[];
    presets: SavedPreset[];
    active: string;
}
export const emptyRule = (): Rule => ({ fonts: [] });
export const initial = (): State => ({
    version: 1,
    fonts: [],
    active: "default",
    presets: [{ id: "default", name: "Default", rules: {}, splitCode: false, splitMath: false }],
});
export function effective(p: Preset, t: Target): Rule {
    if (t === "blockCode" && !p.splitCode) t = "code";
    if (t === "blockMath" && !p.splitMath) t = "math";
    return p.rules[t] ?? emptyRule();
}
export const isScale = (t: Target) => ["content", "math", "blockMath"].includes(t);
export function sizeRange(t: Target): [number, number] {
    return isScale(t) ? [25, 400] : [6, 180];
}
