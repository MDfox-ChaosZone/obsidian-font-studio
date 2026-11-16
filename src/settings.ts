import {
    App,
    Component,
    MarkdownRenderer,
    Modal,
    Notice,
    Platform,
    FileSystemAdapter,
    setIcon,
    PluginSettingTab,
    Setting,
} from "obsidian";
import type FontStudio from "./main";
import { createId, groupImportedFonts, runtimeFamily } from "./font-utils";
import { missing, referenced } from "./preset";
import { fontFaces } from "./typography";

import { measureTypography, renderCard } from "./cards";
import type { Target } from "./types";
class AskName extends Modal {
    constructor(
        app: App,
        private title: string,
        private initial: string,
        private ok: string,
        private accept: (text: string) => void,
    ) {
        super(app);
    }
    onOpen() {
        this.setTitle(this.title);
        const input = this.contentEl.createEl("input", { type: "text", value: this.initial, cls: "fs-name" });
        input.maxLength = 128;
        input.setAttr("aria-label", this.title);
        const submit = () => {
            const v = input.value.trim();
            if (v) {
                this.close();
                this.accept(v);
            }
        };
        input.onkeydown = (e) => {
            if (e.key === "Enter" && !e.isComposing) {
                e.preventDefault();
                e.stopPropagation();
                submit();
            }
        };
        new Setting(this.contentEl).addButton((b) => b.setButtonText(this.ok).setCta().onClick(submit));
        input.focus();
        input.select();
    }
    onClose() {
        this.contentEl.empty();
    }
}
export class StudioTab extends PluginSettingTab {
    name: string;
    private sections = new Map<string, boolean>();
    private blocks = new Set<Target>();
    private observer?: IntersectionObserver;
    private previewStyle?: HTMLStyleElement;
    private frame = 0;
    private remeasure?: () => void;
    updateReadouts() {
        if (this.frame || !this.remeasure) return;
        this.frame = this.containerEl.win.requestAnimationFrame(() => {
            this.frame = 0;
            this.remeasure?.();
        });
    }
    private closePicker?: () => void;
    private tr: (zh: string, en: string) => string;
    constructor(
        app: App,
        private studio: FontStudio,
    ) {
        super(app, studio);
        this.tr = studio.tr.bind(studio);
        this.name = this.tr("字体工坊", "Font Studio");
    }
    private run(fn: () => void | Promise<unknown>) {
        void Promise.resolve()
            .then(fn)
            .catch((e) => this.studio.report(e));
    }
    private change() {
        void this.studio.changed().catch(() => {});
    }
    private button(el: HTMLElement, label: string, fn: () => void | Promise<unknown>, primary = false) {
        const b = el.createEl("button", { type: "button", text: label, cls: primary ? "fs-accent" : "" });
        b.onclick = () => this.run(fn);
        return b;
    }
    private cleanup() {
        this.containerEl.win.cancelAnimationFrame(this.frame);
        this.frame = 0;
        this.remeasure = undefined;
        this.closePicker?.();
        this.closePicker = undefined;
        this.observer?.disconnect();
        this.previewStyle?.remove();
    }
    hide() {
        this.cleanup();
    }
    refreshIfVisible() {
        if (this.containerEl.isConnected && this.containerEl.offsetWidth) this.display();
    }
    display() {
        this.cleanup();
        const root = this.containerEl,
            scroll = root.scrollTop;
        root.empty();
        root.addClass("fs-settings");
        const box = root.createDiv({ cls: "fs-manager" }),
            tr = this.tr;
        this.presets(box);
        const metrics = measureTypography(document.body),
            callbacks: Array<() => void> = [];
        this.remeasure = () => {
            const fresh = measureTypography(document.body);
            for (const [t, v] of fresh) metrics.set(t, v);
            for (const fn of callbacks) fn();
        };
        const group = (key: string, title: string, items: Target[]) => {
            const details = box.createEl("details", { cls: "fs-group" });
            details.open = this.sections.get(key) ?? key === "main";
            details.createEl("summary", { text: title });
            const grid = details.createDiv({ cls: "fs-grid" });
            for (const t of items)
                renderCard(
                    grid,
                    t,
                    this.studio,
                    metrics,
                    this.blocks,
                    (fn) => {
                        this.closePicker?.();
                        this.closePicker = fn;
                    },
                    (fn) => callbacks.push(fn),
                );
            details.ontoggle = () => {
                if (details.isConnected) this.sections.set(key, details.open);
            };
        };
        group("main", tr("主要字体设置", "Primary fonts"), ["ui", "content", "code", "math"]);
        group("other", tr("其他字体设置", "Other fonts"), ["emoji", "canvas", "mermaid"]);
        group("headings", tr("各级标题字体设置", "Heading fonts"), [
            "title",
            "h1",
            "h2",
            "h3",
            "h4",
            "h5",
            "h6",
        ]);
        this.library(box);
        root.scrollTop = scroll;
        this.updateReadouts();
    }
    private confirm(title: string, description: string, action: string, fn: () => void | Promise<unknown>) {
        const modal = new Modal(this.app);
        modal.setTitle(title);
        modal.contentEl.createEl("p", { text: description });
        const buttons = modal.contentEl.createDiv({ cls: "modal-button-container" });
        this.button(buttons, this.tr("取消", "Cancel"), () => modal.close());
        this.button(buttons, action, () => {
            modal.close();
            return fn();
        }).addClass("mod-warning");
        modal.open();
    }
    private presets(root: HTMLElement) {
        const tr = this.tr,
            s = this.studio,
            state = s.state,
            p = s.current;
        const bar = root.createDiv({ cls: "fs-toolbar" });
        const label = bar.createEl("label", { text: tr("预设方案", "Preset") });
        const select = bar.createEl("select");
        select.id = "fs-active-preset";
        label.htmlFor = select.id;
        for (const x of state.presets) select.createEl("option", { text: s.presetName(x), value: x.id });
        select.value = p.id;
        select.onchange = () => this.run(() => s.activate(select.value));
        this.button(bar, tr("＋ 新建", "＋ New"), () =>
            new AskName(this.app, tr("新建预设方案", "New preset"), "", tr("新建", "Create"), (name) => {
                const copy = { ...structuredClone(p), id: createId(), name };
                state.presets.push(copy);
                this.run(() => s.activate(copy.id));
            }).open(),
        );
        this.files(bar, ".json,.zip", false, tr("导入", "Import"), (f) => s.importPreset(f[0]));
        this.button(bar, tr("导出", "Export"), () => {
            const m = new Modal(this.app);
            m.setTitle(tr("导出预设方案", "Export preset"));
            m.contentEl.createEl("p", { text: s.presetName(p) + " · Font Studio Exports/" });
            const buttons = m.contentEl.createDiv({ cls: "modal-button-container" });
            for (const [bundle, title] of [
                [false, tr("仅配置 · JSON", "Settings only · JSON")],
                [true, tr("包含字体 · ZIP", "Include fonts · ZIP")],
            ] as const)
                this.button(buttons, title, async () => {
                    await s.exportPreset(bundle);
                    m.close();
                });
            m.open();
        });
        this.button(bar, tr("重命名", "Rename"), () =>
            new AskName(
                this.app,
                tr("重命名预设", "Rename preset"),
                s.presetName(p),
                tr("保存", "Save"),
                (name) => {
                    p.name = name;
                    this.change();
                    this.display();
                },
            ).open(),
        );
        const del = this.button(bar, tr("删除", "Delete"), () =>
            this.confirm(
                tr("删除预设？", "Delete preset?"),
                s.presetName(p),
                tr("删除", "Delete"),
                async () => {
                    state.presets = state.presets.filter((x) => x.id !== p.id);
                    await s.activate(state.presets[0].id);
                },
            ),
        );
        del.disabled = state.presets.length === 1;
        del.addClass("fs-danger");
        const extra = bar.createDiv({ cls: "fs-extra" });
        this.button(extra, tr("下载示例方案", "Download example"), () =>
            this.confirm(
                tr("下载作者示例方案？", "Download the author’s preset?"),
                tr(
                    "从本项目的 GitHub Release 下载约 28.5 MiB 的方案包，导入 5 个字体文件并应用为新预设。",
                    "Download a 28.5 MiB package from this project’s GitHub release, import its five font files and apply it as a new preset.",
                ),
                tr("下载并应用", "Download and apply"),
                () => s.downloadExample(),
            ),
        );
        this.button(extra, tr("排版预览", "Preview"), () => {
            const m = new Modal(this.app);
            m.setTitle(tr("排版预览", "Typography preview"));
            const sample = m.contentEl.createDiv({ cls: "fs-preview markdown-rendered" });
            sample.createDiv({ cls: "inline-title", text: tr("山间手记", "Field journal") });
            sample.createEl("h2", { text: "山间来信 · Field notes" });
            const line = sample.createEl("p");
            line.appendText("雨后的山径，");
            line.createEl("strong", { text: "青苔与石纹。" });
            line.appendText(" A walk through ");
            line.createEl("em", { text: "quiet woods" });
            line.appendText(" 🌿");
            line.createEl("code", { text: "trail.md" });
            sample.createEl("pre").createEl("code", { text: 'const season = "秋";' });
            const renderer = new Component();
            renderer.load();
            m.onClose = () => renderer.unload();
            m.open();
            this.run(() =>
                MarkdownRenderer.render(
                    this.app,
                    "$x^2+y^2$\n\n$$\\frac{1}{2}+\\text{山径}$$",
                    sample,
                    "",
                    renderer,
                ),
            );
        });
        const absent = missing(p, state.fonts);
        if (absent.length)
            root.createEl("p", {
                cls: "fs-warning",
                text: tr("缺少字体：", "Missing fonts: ") + absent.join(", "),
            });
    }

    private files(
        root: HTMLElement,
        accept: string,
        multiple: boolean,
        label: string,
        fn: (files: File[]) => Promise<unknown>,
    ) {
        const input = root.createEl("input", { type: "file" });
        input.hidden = true;
        input.accept = accept;
        input.multiple = multiple;
        input.onchange = () => {
            const files = Array.from(input.files ?? []);
            input.value = "";
            if (files.length)
                this.run(async () => {
                    await fn(files);
                    this.refreshIfVisible();
                });
        };
        this.button(root, label, () => input.click(), true);
    }
    private library(root: HTMLElement) {
        const tr = this.tr,
            fonts = this.studio.state.fonts;
        const section = root.createEl("section", { cls: "fs-library" }),
            tools = section.createDiv({ cls: "fs-library-head" });
        tools.createEl("strong", { text: tr("字体库", "Font library") });
        const info = tools.createSpan({ cls: "fs-info" });
        setIcon(info, "info");
        info.tabIndex = 0;
        info.title = tr(
            "支持 WOFF2、WOFF、TTF、OTF，可同时导入多个字重。",
            "Import WOFF2, WOFF, TTF or OTF files, including multiple weights.",
        );
        info.setAttr("aria-label", info.title);
        const bar = tools.createDiv({ cls: "fs-actions" });
        const adapter = this.app.vault.adapter;
        if (Platform.isDesktopApp && adapter instanceof FileSystemAdapter) {
            this.button(bar, tr("打开字体文件夹", "Open font folder"), async () => {
                if (!(await adapter.exists(this.studio.fontRoot))) await adapter.mkdir(this.studio.fontRoot);
                const err = await require("electron").shell.openPath(
                    adapter.getFullPath(this.studio.fontRoot),
                );
                if (err) throw new Error(err);
            });
        }
        this.files(bar, ".ttf,.otf,.woff,.woff2", true, tr("导入字体", "Import fonts"), (f) =>
            this.studio.importFiles(f),
        );
        const clear = this.button(bar, tr("全部删除", "Delete all"), () =>
            this.confirm(
                tr("移除全部已导入字体？", "Remove all imported fonts?"),
                tr(
                    "将仓库内的字体副本移入回收站。预设保留字体引用，重新导入后会恢复。",
                    "Move the vault copies to trash. Presets retain references and will recover when the fonts are imported again.",
                ),
                tr("全部删除", "Delete all"),
                async () => {
                    await this.studio.clearLibrary();
                    this.display();
                },
            ),
        );
        clear.disabled = !fonts.length;
        clear.addClass("fs-danger");
        root = section;
        if (!fonts.length) {
            root.createDiv({ cls: "fs-empty", text: tr("尚未导入字体", "No fonts imported yet") });
            return;
        }

        const style = root.ownerDocument.createElement("style");
        root.ownerDocument.head.appendChild(style);
        this.previewStyle = style;
        const previews = new Map<Element, () => void>();
        this.observer = new IntersectionObserver((entries) => {
            for (const { target, isIntersecting } of entries)
                if (isIntersecting) {
                    previews.get(target)?.();
                    this.observer?.unobserve(target);
                }
        });
        for (const group of groupImportedFonts(fonts)) {
            root.createEl("h3", { text: group.familyName });
            for (const f of group.fonts) {
                const row = new Setting(root)
                    .setName(
                        f.fontStyle +
                            " · " +
                            (f.variationAxes.wght
                                ? f.variationAxes.wght.min + "–" + f.variationAxes.wght.max
                                : f.fontWeight),
                    )
                    .setDesc(f.originalName);
                row.addExtraButton((b) =>
                    b
                        .setIcon("trash-2")
                        .setTooltip(tr("移除字体", "Remove font"))
                        .onClick(() =>
                            this.run(async () => {
                                if (this.studio.state.presets.some((p) => referenced(p, fonts).includes(f))) {
                                    new Notice(
                                        tr(
                                            "请先从使用此字体的预设中移除它。",
                                            "Remove this font from the presets that use it first.",
                                        ),
                                    );
                                    return;
                                }
                                await this.studio.app.vault.adapter.remove(this.studio.path(f));
                                this.studio.state.fonts = this.studio.state.fonts.filter(
                                    (x) => x.id !== f.id,
                                );
                                await this.studio.changed();
                                this.display();
                            }),
                        ),
                );
                const sample = root.createEl("p", { cls: "fs-specimen", text: "山川与星河 · Aa Bb 0123" });
                previews.set(sample, () => {
                    const family = runtimeFamily(f.id) + "_preview";
                    style.append(
                        root.ownerDocument.createTextNode(fontFaces(f, [], this.studio.url, family)),
                    );
                    sample.style.fontFamily = family;
                    sample.style.fontWeight = String(f.fontWeight);
                    sample.style.fontStyle = /italic/i.test(f.fontStyle) ? "italic" : "normal";
                });
                this.observer.observe(sample);
            }
        }
    }
}
