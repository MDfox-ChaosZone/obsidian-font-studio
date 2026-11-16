import { Platform, setIcon } from "obsidian";
import type FontStudio from "./main";
import type { Choice } from "./types";

export function sameChoice(a: Choice, b: Choice) {
    return a.kind === "local"
        ? b.kind === "local" && a.name === b.name
        : b.kind === "library" && a.hash === b.hash;
}

/** A top-layer picker stays visible beyond the card and the settings pane's scroll clip. */
export function openFontPicker(
    studio: FontStudio,
    anchor: HTMLButtonElement,
    selected: () => Choice[],
    toggle: (choice: Choice) => void,
    weight?: { value?: number; set: (n?: number) => void },
) {
    const tr = studio.tr.bind(studio),
        doc = anchor.ownerDocument,
        win = anchor.win;
    const panel = doc.body.createDiv({ cls: "fs-picker" });
    panel.setAttribute("popover", "manual");
    panel.setAttr("role", "dialog");
    panel.setAttr("aria-label", tr("选择字体", "Choose fonts"));
    const search = panel.createEl("input", {
        type: "search",
        placeholder: tr("搜索或输入字体家族名…", "Search or enter a font family…"),
    });
    search.setAttr("aria-label", tr("搜索字体", "Search fonts"));
    search.maxLength = 256;
    const list = panel.createDiv({ cls: "fs-picker-list" });
    if (weight) {
        const row = panel.createEl("label", { cls: "fs-picker-weight", text: tr("字重", "Weight") });
        const field = row.createEl("input", { type: "number" });
        field.min = "1";
        field.max = "1000";
        field.placeholder = tr("跟随默认", "Inherit");
        field.value = weight.value?.toString() ?? "";
        field.onchange = () => {
            if (!field.value || field.validity.valid)
                weight.set(field.value ? field.valueAsNumber : undefined);
        };
    }
    let local: string[] = [],
        loading = false;
    const choices = studio.state.fonts.map(
        (f) => ({ kind: "library", hash: f.id, name: f.fontName + " · " + f.fontStyle }) as Choice,
    );
    function addOption(c: Choice, manual = false) {
        const checked = selected().some((v) => sameChoice(v, c));
        const b = list.createEl("button", { type: "button", cls: "fs-option" });
        b.setAttr("aria-pressed", String(checked));
        const mark = b.createSpan();
        setIcon(mark, checked ? "check" : "plus");
        b.createSpan({ text: manual ? tr("使用「", "Use “") + c.name + tr("」", "”") : c.name });
        b.onclick = () => {
            toggle(c);
            render();
            search.focus();
        };
    }
    function render() {
        list.empty();
        const query = search.value.trim(),
            key = query.toLocaleLowerCase();
        function group(title: string, options: Choice[]) {
            const rows = options.filter((c) => c.name.toLocaleLowerCase().includes(key));
            if (!rows.length) return;
            list.createDiv({ cls: "fs-picker-label", text: title });
            rows.forEach((c) => addOption(c));
        }
        group(tr("已导入字体", "Imported fonts"), choices);
        group(
            tr("系统字体", "System fonts"),
            local.map((name) => ({ kind: "local", name })),
        );
        if (query && !local.some((f) => f.toLowerCase() === key))
            addOption({ kind: "local", name: query }, true);
        if (!list.childElementCount)
            list.createDiv({
                cls: "fs-picker-label",
                text: loading
                    ? tr("正在读取系统字体…", "Reading system fonts…")
                    : tr(
                          "输入系统字体名称，或从下方字体库导入文件。",
                          "Enter a family name or import a file in the font library.",
                      ),
            });
    }
    function position() {
        const r = anchor.getBoundingClientRect(),
            width = Math.min(Math.max(r.width, 240), win.innerWidth - 16);
        panel.style.width = width + "px";
        panel.style.left = Math.max(8, Math.min(r.left, win.innerWidth - width - 8)) + "px";
        const below = win.innerHeight - r.bottom - 8,
            above = r.top - 8;
        const up = below < 230 && above > below;
        panel.style.maxHeight = Math.min(330, Math.max(80, up ? above : below)) + "px";
        panel.style.top = up ? "auto" : r.bottom + 4 + "px";
        panel.style.bottom = up ? win.innerHeight - r.top + 4 + "px" : "auto";
    }
    const outside = (ev: PointerEvent) => {
        if (!ev.composedPath().includes(panel) && !ev.composedPath().includes(anchor)) close();
    };
    const escape = (ev: KeyboardEvent) => {
        if (ev.key === "Escape") {
            ev.preventDefault();
            ev.stopPropagation();
            close();
            anchor.focus();
        }
    };
    function close() {
        panel.remove();
        anchor.setAttr("aria-expanded", "false");
        doc.removeEventListener("pointerdown", outside, true);
        doc.removeEventListener("keydown", escape, true);
        win.removeEventListener("resize", position);
        doc.removeEventListener("scroll", position, true);
    }
    search.oninput = render;
    search.onkeydown = (ev) => {
        if (ev.key === "Enter" && !ev.isComposing) {
            ev.preventDefault();
            list.querySelector("button")?.click();
        }
    };
    anchor.setAttr("aria-expanded", "true");
    panel.showPopover?.();
    position();
    render();
    search.focus();
    doc.addEventListener("pointerdown", outside, true);
    doc.addEventListener("keydown", escape, true);
    win.addEventListener("resize", position);
    doc.addEventListener("scroll", position, true);
    if (Platform.isDesktopApp) {
        loading = true;
        render();
        void studio
            .systemFonts(win)
            .then((f) => {
                local = f;
            })
            .catch(() => {})
            .finally(() => {
                loading = false;
                if (panel.isConnected) render();
            });
    }
    return close;
}
