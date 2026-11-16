import { setIcon } from "obsidian";
import type FontStudio from "./main";
import { emptyRule, isScale, sizeRange, Target, Rule } from "./types";
import { openFontPicker, sameChoice } from "./picker";

const targets: Record<Target, [string, string, string, string]> = {
    ui: ["界面字体", "Interface font", "用于菜单、侧栏和设置", "Menus, sidebars and settings"],
    content: ["正文字体", "Note font", "用于编辑器和阅读视图", "Editing and reading views"],
    code: ["等宽字体", "Monospace font", "用于行内代码和代码块", "Inline and fenced code"],
    blockCode: ["代码块", "Code blocks", "", ""],
    math: ["公式字体", "Math font", "用于行内公式和公式块", "Inline and display math"],
    blockMath: ["公式块", "Display math", "", ""],
    emoji: ["表情字体", "Emoji font", "用于表情字符回退", "Fallback for emoji"],
    canvas: ["白板字体", "Canvas font", "用于白板文字卡片", "Canvas text cards"],
    mermaid: ["Mermaid 字体", "Mermaid font", "用于图表文字标签", "Diagram labels"],
    title: ["内联标题", "Inline title", "笔记顶部的文件名", "Filename above the note"],
    h1: ["一级标题", "Heading 1", "H1", "H1"],
    h2: ["二级标题", "Heading 2", "H2", "H2"],
    h3: ["三级标题", "Heading 3", "H3", "H3"],
    h4: ["四级标题", "Heading 4", "H4", "H4"],
    h5: ["五级标题", "Heading 5", "H5", "H5"],
    h6: ["六级标题", "Heading 6", "H6", "H6"],
};
export function measureTypography(root: HTMLElement) {
    const sample = root.createDiv({ cls: "fs-measure markdown-preview-view markdown-rendered" });
    sample.setAttr("aria-hidden", "true");
    const els: Partial<Record<Target, HTMLElement>> = {
        ui: root.ownerDocument.body,
        content: sample,
        title: sample.createDiv({ cls: "inline-title" }),
        code: sample.createEl("p").createEl("code"),
        blockCode: sample.createEl("pre").createEl("code"),
        math: sample.createSpan({ cls: "math-inline" }),
        blockMath: sample.createSpan({ cls: "math-block" }),
        canvas: sample,
        mermaid: sample.createDiv({ cls: "mermaid" }),
        emoji: sample,
    };
    for (const t of ["h1", "h2", "h3", "h4", "h5", "h6"] as const) els[t] = sample.createEl(t);
    const values = new Map<Target, { size: number; family: string }>();
    for (const [key, el] of Object.entries(els)) {
        const style = root.win.getComputedStyle(el);
        const family =
            style.fontFamily
                .split(",")
                .map((s) => s.trim().replace(/^["']|["']$/g, ""))
                .find((s) => s && s !== "??") || "";
        values.set(key as Target, { size: parseFloat(style.fontSize) || 16, family });
    }
    sample.remove();
    return values;
}

export function renderCard(
    parent: HTMLElement,
    primary: Target,
    studio: FontStudio,
    metrics: ReturnType<typeof measureTypography>,
    blocks: Set<Target>,
    register: (fn: () => void) => void,
    onMeasure: (fn: () => void) => void,
) {
    const tr = studio.tr.bind(studio),
        p = studio.current;
    const card = parent.createEl("section", { cls: "fs-card" });
    card.dataset.target = primary;
    const [zh, en, descZh, descEn] = targets[primary],
        title = tr(zh, en);
    let refresh = () => {};
    onMeasure(() => refresh());
    function paint() {
        card.empty();
        const head = card.createDiv({ cls: "fs-card-head" });
        head.createEl("strong", { text: title });
        head.createEl("small", { text: tr(descZh, descEn) });
        const split = primary === "code" ? "splitCode" : primary === "math" ? "splitMath" : undefined;
        const secondary: Target = primary === "code" ? "blockCode" : "blockMath";
        if (split) {
            const label = head.createEl("label", { cls: "fs-split" });
            const input = label.createEl("input", { type: "checkbox" });
            input.checked = p[split];
            label.appendText(tr("分别设置", "Separate"));
            input.onchange = () => {
                p[split] = input.checked;
                if (input.checked) p.rules[secondary] ??= structuredClone(p.rules[primary] ?? emptyRule());
                void studio.changed().catch(() => {});
                paint();
            };
            if (p[split]) {
                const tabs = card.createDiv({ cls: "fs-subtabs" });
                for (const block of [false, true]) {
                    const b = tabs.createEl("button", {
                        type: "button",
                        text: block ? tr("块级", "Block") : tr("行内", "Inline"),
                    });
                    b.setAttr("aria-pressed", String(block === blocks.has(primary)));
                    b.onclick = () => {
                        if (block) blocks.add(primary);
                        else blocks.delete(primary);
                        paint();
                    };
                }
            }
        }
        const t = split && p[split] && blocks.has(primary) ? secondary : primary;
        const rule = p.rules[t] ?? emptyRule();
        const save = () => {
            p.rules[t] = rule;
            void studio.changed().catch(() => {});
        };
        const metric = () => metrics.get(t)!;
        let updateSize = () => {};
        const stack = card.createDiv({ cls: "fs-stack" });
        function icon(el: HTMLElement, symbol: string, label: string, fn: () => void) {
            const b = el.createEl("button", { type: "button", cls: "fs-icon" });
            setIcon(b, symbol);
            b.title = label;
            b.setAttr("aria-label", label);
            b.onclick = fn;
            return b;
        }
        function rows() {
            stack.empty();
            if (!rule.fonts.length) {
                const resolved =
                    t === "math" || t === "blockMath"
                        ? "MathJax"
                        : t === "emoji"
                          ? tr("系统表情", "System emoji")
                          : metric().family;
                stack.createDiv({
                    cls: "fs-default",
                    text: tr("Obsidian 默认", "Obsidian default") + (resolved ? " (" + resolved + ")" : ""),
                });
            }
            let dragging: number | undefined;
            for (const [i, c] of rule.fonts.entries()) {
                const row = stack.createDiv({ cls: "fs-face" });
                row.draggable = true;
                row.ondragstart = (ev) => {
                    dragging = i;
                    ev.dataTransfer?.setData("text/plain", c.name);
                };
                row.ondragend = () => {
                    dragging = undefined;
                };
                row.ondragover = (ev) => {
                    if (dragging !== undefined) ev.preventDefault();
                };
                row.ondrop = (ev) => {
                    if (dragging === undefined) return;
                    ev.preventDefault();
                    const [face] = rule.fonts.splice(dragging, 1);
                    rule.fonts.splice(i, 0, face);
                    save();
                    rows();
                };
                row.createSpan({ text: c.name }).title = c.name;
                const move = (delta: number) => {
                    const [v] = rule.fonts.splice(i, 1);
                    rule.fonts.splice(i + delta, 0, v);
                    save();
                    rows();
                };
                icon(row, "arrow-up", tr("上移", "Move up"), () => move(-1)).disabled = i === 0;
                icon(row, "arrow-down", tr("下移", "Move down"), () => move(1)).disabled =
                    i === rule.fonts.length - 1;
                icon(row, "x", tr("移除字体", "Remove font"), () => {
                    rule.fonts.splice(i, 1);
                    save();
                    rows();
                });
            }
            resetFont.disabled = !rule.fonts.length && rule.weight === undefined;
            weightBox.hidden = t === "emoji" || (!rule.fonts.length && rule.weight === undefined);
        }
        const select = card.createEl("button", { type: "button", cls: "fs-select" });
        select.createSpan({ text: tr("＋ 选择字体", "＋ Choose fonts") });
        setIcon(select.createSpan(), "chevron-down");
        select.setAttr("aria-haspopup", "dialog");
        select.setAttr("aria-expanded", "false");
        select.onclick = () => {
            const wasOpen = select.getAttribute("aria-expanded") === "true";
            register(() => {});
            if (wasOpen) return;
            register(
                openFontPicker(
                    studio,
                    select,
                    () => rule.fonts,
                    (c) => {
                        const i = rule.fonts.findIndex((f) => sameChoice(f, c));
                        if (i >= 0) rule.fonts.splice(i, 1);
                        else if (rule.fonts.length < 256) rule.fonts.push(c);
                        save();
                        rows();
                    },
                    t === "emoji"
                        ? undefined
                        : {
                              value: rule.weight,
                              set: (n) => {
                                  if (n === undefined) delete rule.weight;
                                  else rule.weight = n;
                                  weight.value = n?.toString() ?? "";
                                  save();
                                  rows();
                              },
                          },
                ),
            );
        };
        const weightBox = card.createEl("label", { cls: "fs-weight" });
        weightBox.appendText(tr("字重", "Weight"));
        const weight = weightBox.createEl("input", { type: "number" });
        weight.placeholder = tr("跟随默认", "Inherit");
        weight.min = "1";
        weight.max = "1000";
        weight.value = rule.weight?.toString() ?? "";
        weight.onchange = () => {
            if (!weight.value) delete rule.weight;
            else if (weight.validity.valid) rule.weight = weight.valueAsNumber;
            else {
                weight.value = rule.weight?.toString() ?? "";
                return;
            }
            save();
            rows();
        };
        let controls: HTMLDivElement | undefined;
        if (t !== "emoji") controls = card.createDiv({ cls: "fs-slider" });
        const actions = card.createDiv({ cls: "fs-reset" });
        const resetFont = actions.createEl("button", {
            type: "button",
            text: tr("恢复默认字体", "Reset font"),
        });
        resetFont.onclick = () => {
            rule.fonts = [];
            delete rule.weight;
            save();
            paint();
        };
        if (controls) {
            const resetSize = actions.createEl("button", {
                type: "button",
                text: tr("恢复默认字号", "Reset size"),
            });
            const relative = isScale(t),
                unit = relative ? "%" : "px",
                [min, max] = sizeRange(t);
            let percent = false;
            let nativeSize = metric().size / (relative ? (rule.size ?? 100) / 100 : 1);
            const base = () => nativeSize;
            const visibleValue = () =>
                relative ? (percent ? (rule.size ?? 100) : metric().size) : (rule.size ?? metric().size);
            const slider = controls.createEl("input", { type: "range" });
            const field = controls.createEl("input", { type: "number", cls: "fs-size-number" });
            let unitPicker: HTMLSelectElement | undefined;
            if (relative) {
                unitPicker = controls.createEl("select", { cls: "fs-unit" });
                unitPicker.setAttr("aria-label", title + " " + tr("字号单位", "size unit"));
                for (const u of ["px", "%"]) unitPicker.createEl("option", { text: u, value: u });
                unitPicker.onchange = () => {
                    percent = unitPicker!.value === "%";
                    sync();
                };
            } else controls.createSpan({ text: "px" });
            for (const e of [field, slider]) {
                e.min = String(min);
                e.step = "1";
                e.setAttr("aria-label", title + " " + tr("字号", "size") + " (" + unit + ")");
            }
            const sync = () => {
                const n = visibleValue(),
                    factor = relative && !percent ? base() / 100 : 1;
                const lo = Math.ceil(min * factor),
                    hi = Math.floor(max * factor);
                for (const e of [slider, field]) {
                    e.min = String(lo);
                    e.max = String(hi);
                    e.setAttr(
                        "aria-label",
                        title + " " + tr("字号", "size") + " (" + (percent ? "%" : "px") + ")",
                    );
                }
                slider.max = String(Math.min(hi, Math.max(percent ? 200 : 48, Math.ceil(n))));
                slider.value = String(Math.round(n));
                if (field !== field.ownerDocument.activeElement) field.value = String(Number(n.toFixed(1)));
                resetSize.disabled = rule.size === undefined;
            };
            const set = (n: number) => {
                if (!Number.isFinite(n)) return;
                const value = Math.round(relative && !percent ? (n / base()) * 100 : n);
                if (value < min || value > max) return;
                rule.size = value;
                save();
                // Show immediate feedback during a drag, before the next layout measurement.
                field.value = String(Number(n.toFixed(1)));
                slider.value = String(n);
                resetSize.disabled = false;
            };
            slider.oninput = () => set(slider.valueAsNumber);
            field.onchange = () => {
                set(field.valueAsNumber);
                field.blur();
            };
            field.onblur = () => requestAnimationFrame(sync);
            resetSize.onclick = () => {
                delete rule.size;
                save();
            };
            updateSize = () => {
                nativeSize = metric().size / (relative ? (rule.size ?? 100) / 100 : 1);
                sync();
            };
            sync();
        }
        refresh = () => {
            const line = stack.querySelector<HTMLElement>(".fs-default");
            if (line && t !== "math" && t !== "blockMath" && t !== "emoji")
                line.setText(tr("Obsidian 默认", "Obsidian default") + " (" + metric().family + ")");
            updateSize();
        };
        rows();
    }
    paint();
}
