import {
    requestUrl,
    App,
    getLanguage,
    normalizePath,
    Notice,
    Platform,
    Plugin,
    SuggestModal,
} from "obsidian";
import {
    createId,
    extensionOf,
    extractFontMetadata,
    hasDuplicateHash,
    MAX_FONT_BYTES,
    nameWithoutExtension,
    sha256,
    SUPPORTED_EXTENSIONS,
} from "./font-utils";
import { missing, pack, parsePreset, unpack, validHash } from "./preset";
import { ImportedFont, initial, SavedPreset, State } from "./types";
import { stylesFor } from "./typography";
import { StudioTab } from "./settings";

const EXAMPLE_DOWNLOAD =
    "https://github.com/MDfox-ChaosZone/obsidian-font-studio/releases/download/example-preset-v1/font-studio-example.zip";
const EXAMPLE_SHA256 = "d269f22bb1ab170f297d1e09a11f46d86401e76a92b6a9ad24ee46b28bc0973a";

export default class FontStudio extends Plugin {
    state: State = initial();
    tab!: StudioTab;
    private sheets = new Map<Document, HTMLStyleElement>();
    private writes: Promise<void> = Promise.resolve();
    private imports: Promise<unknown> = Promise.resolve();
    private families: string[] = [];
    private stopped = false;
    tr(zh: string, en: string) {
        return getLanguage().startsWith("zh") ? zh : en;
    }
    presetName(p: SavedPreset) {
        return p.id === "default" && p.name === "Default" ? this.tr("默认方案", "Default") : p.name;
    }
    get current() {
        return this.state.presets.find((p) => p.id === this.state.active)!;
    }
    get fontRoot() {
        return normalizePath(
            (this.manifest.dir ?? this.app.vault.configDir + "/plugins/font-studio") + "/fonts",
        );
    }
    path(f: ImportedFont) {
        return normalizePath(this.fontRoot + "/" + f.id + "." + f.extension);
    }
    url = (f: ImportedFont) => this.app.vault.adapter.getResourcePath(this.path(f));
    async onload() {
        const data = await this.loadData();
        if (data != null) this.state = this.decode(data);
        this.tab = new StudioTab(this.app, this);
        this.addSettingTab(this.tab);
        this.addCommand({
            id: "open",
            name: this.tr("打开字体工坊", "Open Font Studio"),
            callback: () => {
                const { setting } = this.app as App & {
                    setting: { open(): void; openTabById(id: string): void };
                };
                setting.open();
                setting.openTabById(this.manifest.id);
            },
        });
        this.addCommand({
            id: "switch-preset",
            name: this.tr("切换字体预设", "Switch font preset"),
            callback: () => new Picker(this).open(),
        });
        this.attach(document);
        this.app.workspace.iterateAllLeaves((leaf) => this.attach(leaf.view.containerEl.ownerDocument));
        this.registerEvent(this.app.workspace.on("window-open", (_, win) => this.attach(win.document)));
        this.registerEvent(this.app.workspace.on("window-close", (_, win) => this.detach(win.document)));
    }
    private decode(raw: State): State {
        if (
            raw.version !== 1 ||
            !Array.isArray(raw.fonts) ||
            !Array.isArray(raw.presets) ||
            !raw.presets.length
        )
            throw Error(this.tr("无法读取字体工坊配置", "Cannot read Font Studio settings"));
        const fonts = raw.fonts.filter(
            (f) => f && validHash(f.id) && f.sha256 === f.id && SUPPORTED_EXTENSIONS.has(f.extension),
        );
        const presets = raw.presets.map((p) => ({ ...parsePreset(p), id: p.id }));
        return {
            version: 1,
            fonts,
            presets,
            active: presets.some((p) => p.id === raw.active) ? raw.active : presets[0].id,
        };
    }
    private attach(doc: Document) {
        if (this.sheets.has(doc) || this.stopped) return;
        const el = doc.createElement("style");
        el.dataset.fontStudio = "typography";
        doc.head.appendChild(el);
        this.sheets.set(doc, el);
        el.textContent = stylesFor(this.current, this.state.fonts, this.url);
    }
    private detach(doc: Document) {
        this.sheets.get(doc)?.remove();
        this.sheets.delete(doc);
    }
    onunload() {
        this.stopped = true;
        this.tab?.hide();
        for (const doc of this.sheets.keys()) this.detach(doc);
    }
    async onExternalSettingsChange() {
        await this.writes;
        const data = await this.loadData();
        if (data) {
            this.state = this.decode(data);
            this.refresh();
            this.tab.refreshIfVisible();
        }
    }
    private refresh() {
        const css = stylesFor(this.current, this.state.fonts, this.url);
        for (const sheet of this.sheets.values()) if (sheet.textContent !== css) sheet.textContent = css;
    }
    changed() {
        this.refresh();
        this.tab?.updateReadouts();
        const snapshot = JSON.parse(JSON.stringify(this.state));
        const write = this.writes.then(() => this.saveData(snapshot));
        this.writes = write.catch((e) => this.report(e));
        return write;
    }
    report(e: unknown) {
        new Notice(
            this.tr("字体工坊：", "Font Studio: ") + (e instanceof Error ? e.message : String(e)),
            9000,
        );
    }
    async activate(id: string) {
        this.state.active = id;
        await this.changed();
        this.tab.refreshIfVisible();
    }
    async systemFonts(win: Window) {
        const browser = win as Window & { queryLocalFonts?: () => Promise<{ family: string }[]> };
        if (!Platform.isDesktopApp || !browser.queryLocalFonts)
            throw Error(this.tr("请手动输入系统字体家族名。", "Enter a system font family manually."));
        if (!this.families.length)
            this.families = [...new Set((await browser.queryLocalFonts()).map((f) => f.family))].sort();
        return this.families;
    }
    private enqueue<T>(fn: () => Promise<T>): Promise<T> {
        const next = this.imports.then(fn);
        this.imports = next.catch(() => undefined);
        return next;
    }
    private async prepare(filename: string, bytes: ArrayBuffer, hash: string): Promise<ImportedFont> {
        const extension = extensionOf(filename);
        if (!SUPPORTED_EXTENSIONS.has(extension) || !bytes.byteLength || bytes.byteLength > MAX_FONT_BYTES)
            throw Error(this.tr("字体格式或大小无效", "Invalid font format or size") + " · " + filename);
        await new FontFace("FontStudioValidation", bytes).load();
        const metadata = extractFontMetadata(bytes, nameWithoutExtension(filename));
        return {
            ...metadata,
            id: hash,
            sha256: hash,
            originalName: filename,
            displayName: metadata.fontName,
            extension,
            size: bytes.byteLength,
        };
    }
    private async storeFont(meta: ImportedFont, bytes: ArrayBuffer) {
        const adapter = this.app.vault.adapter;
        if (!(await adapter.exists(this.fontRoot))) await adapter.mkdir(this.fontRoot);
        await adapter.writeBinary(this.path(meta), bytes);
    }
    clearLibrary() {
        return this.enqueue(async () => {
            const adapter = this.app.vault.adapter;
            try {
                for (const font of [...this.state.fonts]) {
                    const path = this.path(font);
                    if (await adapter.exists(path)) await adapter.trashLocal(path);
                    this.state.fonts = this.state.fonts.filter((item) => item.id !== font.id);
                }
            } finally {
                await this.changed();
                this.tab.refreshIfVisible();
            }
        });
    }
    importFiles(files: File[]) {
        return this.enqueue(async () => {
            let added = 0,
                repeated = 0;
            const errors: string[] = [];
            for (const f of files)
                try {
                    if (f.size > MAX_FONT_BYTES) throw Error(this.tr("超过 100 MiB", "Exceeds 100 MiB"));
                    const bytes = await f.arrayBuffer(),
                        hash = await sha256(bytes);
                    if (hasDuplicateHash(this.state.fonts, hash)) {
                        const existing = this.state.fonts.find((f) => f.id === hash)!;
                        if (!(await this.app.vault.adapter.exists(this.path(existing))))
                            await this.storeFont(existing, bytes);
                        repeated++;
                        continue;
                    }
                    const meta = await this.prepare(f.name, bytes, hash);
                    await this.storeFont(meta, bytes);
                    this.state.fonts.push(meta);
                    added++;
                } catch (e) {
                    errors.push(f.name + " · " + String(e));
                }
            await this.changed();
            new Notice(
                this.tr("已导入 ", "Imported ") +
                    added +
                    this.tr("，重复 ", " · Duplicates ") +
                    repeated +
                    (errors.length ? "\n" + errors.join("\n") : ""),
                8000,
            );
        });
    }
    private downloadingExample = false;
    async downloadExample() {
        if (this.downloadingExample) return;
        this.downloadingExample = true;
        const progress = new Notice(
            this.tr(
                "正在从 GitHub 下载作者示例方案…",
                "Downloading the author’s example preset from GitHub…",
            ),
            0,
        );
        try {
            const { arrayBuffer } = await requestUrl({ url: EXAMPLE_DOWNLOAD });
            if ((await sha256(arrayBuffer)) !== EXAMPLE_SHA256)
                throw Error(
                    this.tr("示例包校验失败，请重新下载。", "Example checksum mismatch. Please retry."),
                );
            if (this.stopped) return;
            progress.setMessage(this.tr("正在导入示例方案和字体…", "Importing the preset and fonts…"));
            await this.importPreset(
                new File([arrayBuffer], "font-studio-example.zip", { type: "application/zip" }),
            );
        } finally {
            this.downloadingExample = false;
            progress.hide();
        }
    }
    importPreset(file: File) {
        return this.enqueue(async () => {
            if (file.size > 500 * 1024 * 1024) throw Error(this.tr("方案包过大", "Package too large"));
            const pkg = await unpack(
                new Uint8Array(await file.arrayBuffer()),
                extensionOf(file.name) === "zip",
            );
            const staged = new Map<string, { meta: ImportedFont; bytes: ArrayBuffer }>();
            for (const f of pkg.fonts) {
                if (staged.has(f.hash)) continue;
                const existing = this.state.fonts.find((v) => v.id === f.hash);
                if (existing && (await this.app.vault.adapter.exists(this.path(existing)))) continue;
                staged.set(f.hash, {
                    meta: existing ?? (await this.prepare(f.filename, f.bytes, f.hash)),
                    bytes: f.bytes,
                });
            }
            for (const { meta, bytes } of staged.values()) await this.storeFont(meta, bytes);
            for (const { meta } of staged.values())
                if (!hasDuplicateHash(this.state.fonts, meta.id)) this.state.fonts.push(meta);
            const p = { ...pkg.preset, id: createId() };
            this.state.presets.push(p);
            await this.activate(p.id);
            const absent = missing(p, this.state.fonts);
            new Notice(
                absent.length
                    ? this.tr("缺少字体：", "Missing fonts: ") + absent.join(", ")
                    : this.tr("已导入并应用方案", "Preset imported and applied"),
                9000,
            );
        });
    }
    async exportPreset(bundle: boolean) {
        const p = this.current;
        const bytes = await pack(
            p,
            this.state.fonts,
            bundle ? (f) => this.app.vault.adapter.readBinary(this.path(f)) : undefined,
        );
        const folder = "Font Studio Exports";
        if (!(await this.app.vault.adapter.exists(folder))) await this.app.vault.createFolder(folder);
        const safe = p.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 70);
        const file = await this.app.vault.createBinary(
            normalizePath(folder + "/" + safe + "-" + createId().slice(0, 8) + (bundle ? ".zip" : ".json")),
            bytes.buffer,
        );
        new Notice(this.tr("已导出到 ", "Exported to ") + file.path, 8000);
        return file.path;
    }
}
class Picker extends SuggestModal<SavedPreset> {
    constructor(private studio: FontStudio) {
        super(studio.app);
        this.setPlaceholder(studio.tr("选择字体预设", "Choose a font preset"));
    }
    getSuggestions(q: string) {
        return this.studio.state.presets.filter((p) =>
            this.studio.presetName(p).toLowerCase().includes(q.toLowerCase()),
        );
    }
    renderSuggestion(p: SavedPreset, el: HTMLElement) {
        el.setText((p.id === this.studio.state.active ? "✓  " : "") + this.studio.presetName(p));
    }
    onChooseSuggestion(p: SavedPreset) {
        void this.studio.activate(p.id).catch((e) => this.studio.report(e));
    }
}
