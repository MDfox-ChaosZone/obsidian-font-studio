import { strFromU8, strToU8, unzipSync, zip } from "fflate";
import { companionFonts, sha256, SUPPORTED_EXTENSIONS, MAX_FONT_BYTES } from "./font-utils";
import { Choice, ImportedFont, Preset, Rule, targets, sizeRange } from "./types";

const FORMAT = "font-studio-preset";
const LIMIT = 500 * 1024 * 1024;
export const validHash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const record = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === "object" && !Array.isArray(v);
function invalid(): never {
    throw Error("Invalid Font Studio preset / 无效的字体工坊预设");
}
function name(v: unknown): string {
    if (typeof v !== "string" || !v.trim() || v.length > 512) invalid();
    return v.trim();
}
function number(v: unknown, min: number, max: number): number | undefined {
    if (v === undefined) return;
    if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) invalid();
    return v;
}
function choice(v: unknown): Choice {
    if (!record(v)) invalid();
    if (v.kind === "local") return { kind: "local", name: name(v.name) };
    if (v.kind === "library" && validHash(v.hash))
        return { kind: "library", hash: v.hash, name: name(v.name) };
    return invalid();
}
export function parsePreset(v: unknown): Preset {
    if (
        !record(v) ||
        !record(v.rules) ||
        typeof v.splitMath !== "boolean" ||
        typeof v.splitCode !== "boolean"
    )
        invalid();
    const rules: Preset["rules"] = {};
    for (const t of targets) {
        const r = v.rules[t];
        if (r === undefined) continue;
        if (!record(r) || !Array.isArray(r.fonts) || r.fonts.length > 256) invalid();
        const rule: Rule = {
            fonts: r.fonts.map(choice),
            size: number(r.size, ...sizeRange(t)),
            weight: number(r.weight, 1, 1000),
        };
        rules[t] = rule;
    }
    return { name: name(v.name), rules, splitCode: v.splitCode, splitMath: v.splitMath };
}
export function referenced(p: Preset, fonts: ImportedFont[]): ImportedFont[] {
    const selected = new Set<ImportedFont>();
    for (const r of Object.values(p.rules))
        for (const c of r.fonts) {
            if (c.kind !== "library") continue;
            const f = fonts.find((f) => f.id === c.hash);
            if (f) {
                selected.add(f);
                for (const sibling of companionFonts(f, fonts)) selected.add(sibling);
            }
        }
    return [...selected];
}
export function missing(p: Preset, fonts: ImportedFont[]): string[] {
    return [
        ...new Set(
            Object.values(p.rules).flatMap((r) =>
                r.fonts.flatMap((c) =>
                    c.kind === "library" && !fonts.some((f) => f.id === c.hash) ? [c.name] : [],
                ),
            ),
        ),
    ];
}
export interface PackageFont {
    filename: string;
    hash: string;
    bytes: ArrayBuffer;
}
export async function pack(
    p: Preset,
    fonts: ImportedFont[],
    read?: (f: ImportedFont) => Promise<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
    const files: Record<string, Uint8Array<ArrayBuffer>> = {};
    const bundled = [];
    let total = 0;
    if (read)
        for (const font of referenced(p, fonts)) {
            const data = await read(font);
            if ((await sha256(data)) !== font.id) invalid();
            total += data.byteLength;
            if (total > LIMIT) invalid();
            const path = "fonts/" + font.id + "." + font.extension;
            files[path] = new Uint8Array(data);
            bundled.push({ path, filename: font.originalName, hash: font.id });
        }
    const manifest = strToU8(
        JSON.stringify({ format: FORMAT, version: 1, preset: parsePreset(p), bundled }, null, 2),
    );
    if (!read) return manifest;
    files["preset.json"] = manifest;
    return new Promise((resolve, reject) =>
        zip(files, { level: 1 }, (err, data) => (err ? reject(err) : resolve(data))),
    );
}
export async function unpack(data: Uint8Array<ArrayBuffer>, isZip: boolean) {
    if (data.length > LIMIT) invalid();
    let total = 0;
    const files = isZip
        ? unzipSync(data, {
              filter: (e) => {
                  if (e.name !== "preset.json" && !/^fonts\/[a-f0-9]{64}\.(woff2?|ttf|otf)$/.test(e.name))
                      return false;
                  total += e.originalSize;
                  if (
                      total > LIMIT ||
                      e.originalSize > (e.name === "preset.json" ? 4 * 1024 * 1024 : MAX_FONT_BYTES)
                  )
                      invalid();
                  return true;
              },
          })
        : { "preset.json": data };
    if (!files["preset.json"] || files["preset.json"].length > 4 * 1024 * 1024) invalid();
    const m: unknown = JSON.parse(strFromU8(files["preset.json"]));
    if (!record(m) || m.format !== FORMAT || m.version !== 1 || !Array.isArray(m.bundled)) invalid();
    const preset = parsePreset(m.preset);
    const fonts: PackageFont[] = [];
    const declared = new Set<string>();
    for (const f of m.bundled) {
        if (!record(f) || !validHash(f.hash) || typeof f.path !== "string") invalid();
        if (declared.has(f.hash)) invalid();
        declared.add(f.hash);
        const filename = name(f.filename);
        const ext = filename.split(".").pop()!.toLowerCase();
        if (!SUPPORTED_EXTENSIONS.has(ext) || f.path !== "fonts/" + f.hash + "." + ext || !files[f.path])
            invalid();
        const bytes = files[f.path].slice().buffer;
        if ((await sha256(bytes)) !== f.hash) invalid();
        fonts.push({ filename, hash: f.hash, bytes });
    }
    return { preset, fonts };
}
