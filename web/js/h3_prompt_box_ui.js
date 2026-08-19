import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const NODE_TYPE = "H3PromptBox";
const PACK_NODE = "H3ReferenceMedia";
const PROMPT_WIDGET = "H3提示词";
const MANIFEST_WIDGET = "素材清单";
const TOKEN_PATTERN = /<(?:Picture|Video|Audio)\s+\d+>/g;
const CHIP_CLASS = "h3-fusion-reference-chip";

let activeMenu = null;

function nodeClass(node) {
    return String(node?.comfyClass || node?.type || node?.constructor?.comfyClass || "");
}

function isNodeClass(node, expected) {
    const values = [node?.comfyClass, node?.type, node?.constructor?.comfyClass, node?.constructor?.type]
        .map((value) => String(value || ""))
        .filter(Boolean);
    return values.some((value) => value === expected || value.endsWith(expected));
}

function isPackNode(node) {
    return isNodeClass(node, PACK_NODE) || String(node?.title || "") === "H3 参考素材";
}

function widget(node, name) {
    return node?.widgets?.find((item) => item.name === name) || null;
}

function graphOf(node) {
    return node?.graph
        || app.canvas?.getCurrentGraph?.()
        || app.canvas?.graph
        || app.graph
        || null;
}

function graphLinks(graph) {
    const links = graph?.links;
    if (links instanceof Map) return [...links.values()];
    if (links instanceof Set) return [...links.values()];
    if (Array.isArray(links)) return links.filter(Boolean);
    if (links && typeof links[Symbol.iterator] === "function" && typeof links !== "string") {
        return [...links].filter(Boolean);
    }
    return links && typeof links === "object" ? Object.values(links).filter(Boolean) : [];
}

function graphLink(graph, id) {
    if (id == null) return null;
    if (typeof id === "object") return id;
    if (graph?.links instanceof Map) return graph.links.get(id) || graph.links.get(String(id)) || null;
    return graph?.links?.[id] || graph?.links?.[String(id)] || graphLinks(graph).find((link) => String(link?.id) === String(id)) || null;
}

function graphNode(graph, id) {
    if (id == null) return null;
    return graph?.getNodeById?.(id)
        || (graph?.nodes instanceof Map ? graph.nodes.get(id) || graph.nodes.get(String(id)) : null)
        || graph?._nodes_by_id?.[id]
        || (graph?._nodes_by_id instanceof Map ? graph._nodes_by_id.get(id) || graph._nodes_by_id.get(String(id)) : null)
        || graph?.nodes?.find?.((node) => String(node?.id) === String(id))
        || graph?._nodes?.find((node) => String(node?.id) === String(id))
        || null;
}

function originId(link) {
    return link?.origin_id ?? link?.originId ?? link?.[1] ?? null;
}

function originSlot(link) {
    return Number(link?.origin_slot ?? link?.originSlot ?? link?.[2] ?? 0);
}

function targetId(link) {
    return link?.target_id ?? link?.targetId ?? link?.[3] ?? null;
}

function targetSlot(link) {
    return Number(link?.target_slot ?? link?.targetSlot ?? link?.[4] ?? 0);
}

function targetSlotValue(link) {
    return link?.target_slot ?? link?.targetSlot ?? link?.[4] ?? null;
}

function escapeRegExp(value) {
    return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function inputLeafName(input) {
    return String(input?.name || "").split(".").pop();
}

function findInput(node, name) {
    return (node?.inputs || []).find((input) => input?.name === name || inputLeafName(input) === name) || null;
}

function inputLinkId(input) {
    if (!input) return null;
    if (input.link != null) return input.link;
    const links = input.links;
    if (links == null) return null;
    if (Array.isArray(links)) return links[0] ?? null;
    if (links instanceof Set || links instanceof Map) return links.values().next().value ?? null;
    if (typeof links?.[Symbol.iterator] === "function" && typeof links !== "string") {
        return links[Symbol.iterator]().next().value ?? null;
    }
    return links;
}

function originNode(node, inputName) {
    const graph = graphOf(node);
    const input = typeof inputName === "string" ? findInput(node, inputName) : inputName;
    const linkRef = inputLinkId(input);
    let link = graphLink(graph, linkRef);
    if (!link && graph && node && input) {
        const inputIndex = node.inputs?.indexOf(input);
        link = graphLinks(graph).find((candidate) => {
            if (String(targetId(candidate)) !== String(node.id)) return false;
            const rawSlot = targetSlotValue(candidate);
            const slot = Number(rawSlot);
            return slot === inputIndex
                || String(rawSlot) === String(input.name)
                || String(rawSlot) === String(inputLeafName(input));
        }) || null;
    }
    return link ? graphNode(graph, originId(link)) : null;
}

function connectedInput(node, name) {
    return Boolean(originNode(node, name));
}

function connectedByExactPrefix(node, prefix) {
    const pattern = new RegExp(`^${escapeRegExp(prefix)}(\\d+)$`);
    return (node?.inputs || [])
        .map((input) => {
            const match = inputLeafName(input).match(pattern);
            if (!match) return null;
            const origin = originNode(node, input.name);
            return origin ? { input, slot: Number(match[1]), origin } : null;
        })
        .filter(Boolean)
        .sort((a, b) => a.slot - b.slot);
}

function walkUpstream(node, visited = new Set()) {
    if (!node || visited.has(String(node.id))) return node;
    visited.add(String(node.id));
    if (isPackNode(node)) return node;
    if (/reroute/i.test(nodeClass(node)) && node.inputs?.[0]) {
        return walkUpstream(originNode(node, node.inputs[0].name), visited);
    }
    const bundle = findInput(node, "素材包");
    if (bundle) return walkUpstream(originNode(node, "素材包"), visited);
    return node;
}

function findPackNode(start) {
    return walkUpstream(originNode(start, "素材包"), new Set());
}

function upstreamPreviewNode(node, visited = new Set()) {
    if (!node || visited.has(String(node.id))) return node;
    visited.add(String(node.id));
    const images = node.imgs || node.images;
    if (Array.isArray(images) && images.length) return node;
    if (/reroute/i.test(nodeClass(node)) && node.inputs?.[0]) {
        return upstreamPreviewNode(originNode(node, node.inputs[0].name), visited);
    }
    return node;
}

function viewUrl(path) {
    if (typeof api.apiURL === "function") return api.apiURL(path);
    if (typeof api.apiURL === "string" && api.apiURL) return `${api.apiURL.replace(/\/$/, "")}${path}`;
    return path;
}

function firstPreview(node) {
    const source = upstreamPreviewNode(node);
    const output = app.nodeOutputs?.[String(source?.id)]?.images;
    const file = Array.isArray(output) && output.length ? output[0] : null;
    if (file?.filename) {
        const params = new URLSearchParams({ filename: file.filename, type: file.type || "output", rand: String(Date.now()) });
        if (file.subfolder) params.set("subfolder", file.subfolder);
        return `${viewUrl("/view")}?${params.toString()}`;
    }
    const imageWidget = source?.widgets?.find((item) => item?.name === "image") || source?.widgets?.[0];
    const filename = String(imageWidget?.value || source?.widgets_values?.[0] || "").trim();
    if (filename && (source?.type === "LoadImage" || source?.comfyClass === "LoadImage")) {
        const params = new URLSearchParams({ filename, type: "input", rand: String(Date.now()) });
        return `${viewUrl("/view")}?${params.toString()}`;
    }
    const image = source?.imgs?.[0] || source?.images?.[0];
    if (typeof image === "string") return image;
    return image?.src || image?.currentSrc || "";
}

function packManifest(pack) {
    if (!pack || !isPackNode(pack)) return { version: 1, target: "", mode: "T2VA", items: [] };
    const type = nodeClass(pack);
    const images = connectedByExactPrefix(pack, "参考图");
    const videos = connectedByExactPrefix(pack, "参考视频");
    const soundtracks = connectedByExactPrefix(pack, "参考视频音轨");
    const audios = connectedByExactPrefix(pack, "参考音频");
    const soundtrackBySlot = new Map(soundtracks.map((entry) => [entry.slot, entry]));
    const hasRef = images.length || videos.length || soundtracks.length || audios.length;
    const items = [];

    if (hasRef) {
        images.forEach((entry, offset) => {
            const index = offset + 1;
            items.push({
                kind: "Picture", index, token: `<Picture ${index}>`,
                label: `参考图${entry.slot}`, source_input: entry.input.name, src: firstPreview(entry.origin),
            });
        });
        let audioIndex = 0;
        videos.forEach((entry, offset) => {
            const videoIndex = offset + 1;
            const soundtrack = soundtrackBySlot.get(entry.slot);
            if (soundtrack) {
                audioIndex += 1;
                items.push({
                    kind: "Audio", index: audioIndex, token: `<Audio ${audioIndex}>`,
                    label: `参考视频${entry.slot}音轨`, source_input: soundtrack.input.name, src: "",
                });
                soundtrackBySlot.delete(entry.slot);
            }
            items.push({
                kind: "Video", index: videoIndex, token: `<Video ${videoIndex}>`,
                label: `参考视频${entry.slot}`, source_input: entry.input.name, src: firstPreview(entry.origin),
            });
        });
        [...soundtrackBySlot.values()].sort((a, b) => a.slot - b.slot).forEach((entry) => {
            audioIndex += 1;
            items.push({
                kind: "Audio", index: audioIndex, token: `<Audio ${audioIndex}>`,
                label: `参考视频${entry.slot}音轨`, source_input: entry.input.name, src: "",
            });
        });
        audios.forEach((entry) => {
            audioIndex += 1;
            items.push({
                kind: "Audio", index: audioIndex, token: `<Audio ${audioIndex}>`,
                label: `参考音频${entry.slot}`, source_input: entry.input.name, src: "",
            });
        });
        const mode = images.length || videos.length ? "Ref2VA" : "T2VA";
        return { version: 1, target: type, mode, items };
    }

    const first = originNode(pack, "首帧图");
    const last = originNode(pack, "尾帧图");
    if (first) items.push({ kind: "Picture", index: 1, token: "<Picture 1>", label: "首帧", source_input: "首帧图", src: firstPreview(first) });
    if (last) {
        const index = first ? 2 : 1;
        items.push({ kind: "Picture", index, token: `<Picture ${index}>`, label: "尾帧", source_input: "尾帧图", src: firstPreview(last) });
    }
    const mode = first && last ? "FL2VA" : first ? "I2VA" : last ? "L2VA" : "T2VA";
    return { version: 1, target: type, mode, items };
}

function serializableManifest(manifest) {
    return {
        version: 1,
        target: manifest.target,
        mode: manifest.mode,
        items: manifest.items.map(({ src, ...item }) => item),
    };
}

function setWidgetValue(node, target, value) {
    if (!target || String(target.value ?? "") === String(value)) return;
    target.value = value;
    target.callback?.(value);
    const index = node.widgets?.indexOf(target) ?? -1;
    if (index >= 0) {
        node.widgets_values ??= [];
        node.widgets_values[index] = value;
    }
}

function hideWidget(target) {
    if (!target || target.__h3FusionPromptHidden) return;
    target.__h3FusionPromptHidden = true;
    target.computeSize = () => [0, -4];
    const element = target.inputEl || target.element || target.domElement || target.inputElement;
    if (element?.style) element.style.display = "none";
}

function textFromEditor(editor) {
    let result = "";
    function walk(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            result += node.nodeValue || "";
            return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        if (node.classList?.contains(CHIP_CLASS)) {
            result += node.dataset.token || node.textContent || "";
            return;
        }
        if (node.tagName === "BR") {
            result += "\n";
            return;
        }
        [...node.childNodes].forEach(walk);
        if (["DIV", "P"].includes(node.tagName) && node !== editor) result += "\n";
    }
    walk(editor);
    return result.replace(/\n+$/, "");
}

function mediaEmoji(kind) {
    return kind === "Picture" ? "🖼️" : kind === "Video" ? "🎞️" : "🎵";
}

function createChip(item) {
    const chip = document.createElement("span");
    chip.className = CHIP_CLASS;
    chip.dataset.token = item.token;
    chip.contentEditable = "false";
    Object.assign(chip.style, {
        display: "inline-flex", alignItems: "center", gap: "6px", margin: "1px 4px", padding: "3px 9px 3px 5px",
        borderRadius: "9px", border: "1px solid #5b9cff", background: "rgba(42, 88, 150, .62)", color: "#f5f9ff",
        verticalAlign: "middle", whiteSpace: "nowrap", userSelect: "all",
    });
    if (item.src) {
        const image = document.createElement("img");
        image.src = item.src;
        Object.assign(image.style, { width: "28px", height: "28px", borderRadius: "6px", objectFit: "cover" });
        chip.appendChild(image);
    } else {
        const icon = document.createElement("span");
        icon.textContent = mediaEmoji(item.kind);
        chip.appendChild(icon);
    }
    const token = document.createElement("span");
    token.textContent = item.token;
    chip.appendChild(token);
    return chip;
}

function renderEditor(node, value) {
    const state = node.__h3FusionPromptState;
    if (!state) return;
    const editor = state.editor;
    const byToken = new Map(state.manifest.items.map((item) => [item.token, item]));
    editor.replaceChildren();
    const text = String(value || "");
    let offset = 0;
    for (const match of text.matchAll(TOKEN_PATTERN)) {
        if (match.index > offset) editor.appendChild(document.createTextNode(text.slice(offset, match.index)));
        const item = byToken.get(match[0]);
        if (item) editor.appendChild(createChip(item));
        else {
            const stale = document.createElement("span");
            stale.textContent = match[0];
            stale.title = "该素材当前未接入 H3 参考素材";
            Object.assign(stale.style, { color: "#ff8c8c", textDecoration: "underline wavy" });
            editor.appendChild(stale);
        }
        offset = match.index + match[0].length;
    }
    if (offset < text.length) editor.appendChild(document.createTextNode(text.slice(offset)));
    if (!editor.childNodes.length) editor.appendChild(document.createElement("br"));
}

function editorNeedsChipHydration(state, text) {
    const validTokens = new Set(state.manifest.items.map((item) => item.token));
    const expected = (String(text || "").match(TOKEN_PATTERN) || []).filter((token) => validTokens.has(token));
    const actual = [...state.editor.querySelectorAll(`.${CHIP_CLASS}`)]
        .map((chip) => chip.dataset.token || chip.textContent || "");
    return expected.length !== actual.length || expected.some((token, index) => token !== actual[index]);
}

function syncPrompt(node) {
    const state = node.__h3FusionPromptState;
    if (!state) return;
    setWidgetValue(node, state.promptWidget, textFromEditor(state.editor));
    node.setDirtyCanvas?.(true, true);
    app.graph?.setDirtyCanvas?.(true, true);
}

function mentionRange(editor) {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !editor.contains(selection.anchorNode) || selection.anchorNode?.nodeType !== Node.TEXT_NODE) return null;
    const text = (selection.anchorNode.nodeValue || "").slice(0, selection.anchorOffset);
    const match = text.match(/@([^\s@]*)$/u);
    if (!match) return null;
    const range = document.createRange();
    range.setStart(selection.anchorNode, selection.anchorOffset - match[0].length);
    range.setEnd(selection.anchorNode, selection.anchorOffset);
    return { range, query: match[1].toLowerCase() };
}

function closeMenu() {
    activeMenu?.element?.remove();
    activeMenu = null;
}

function selectMenuRow(index) {
    if (!activeMenu) return;
    activeMenu.index = (index + activeMenu.items.length) % activeMenu.items.length;
    activeMenu.rows.forEach((row, rowIndex) => {
        row.style.background = rowIndex === activeMenu.index ? "rgba(46, 181, 112, .24)" : "transparent";
    });
    activeMenu.rows[activeMenu.index]?.scrollIntoView?.({ block: "nearest" });
}

function insertReference(node, item) {
    const state = node.__h3FusionPromptState;
    const mention = mentionRange(state?.editor);
    if (!state || !mention) return;
    mention.range.deleteContents();
    const chip = createChip(item);
    const space = document.createTextNode(" ");
    mention.range.insertNode(space);
    mention.range.insertNode(chip);
    const selection = window.getSelection();
    const caret = document.createRange();
    caret.setStartAfter(space);
    caret.collapse(true);
    selection.removeAllRanges();
    selection.addRange(caret);
    syncPrompt(node);
    closeMenu();
    state.editor.focus();
}

function showMenu(node) {
    const state = node.__h3FusionPromptState;
    const mention = mentionRange(state?.editor);
    if (!state || !mention) {
        closeMenu();
        return;
    }
    const items = state.manifest.items.filter((item) => {
        const haystack = `${item.label} ${item.token} ${item.kind}`.toLowerCase();
        return !mention.query || haystack.includes(mention.query);
    });
    closeMenu();
    if (!items.length) return;

    const element = document.createElement("div");
    Object.assign(element.style, {
        position: "fixed", width: "360px", maxWidth: "calc(100vw - 16px)", maxHeight: "360px", overflowY: "auto",
        padding: "8px", borderRadius: "14px", background: "rgba(28, 30, 33, .98)", color: "#f4f4f4",
        boxShadow: "0 18px 48px rgba(0, 0, 0, .48)", border: "1px solid rgba(255, 255, 255, .12)", zIndex: "100000",
    });
    const rows = items.map((item, index) => {
        const row = document.createElement("button");
        row.type = "button";
        Object.assign(row.style, {
            display: "flex", alignItems: "center", gap: "12px", width: "100%", border: "0", borderRadius: "10px",
            padding: "9px", color: "inherit", background: "transparent", cursor: "pointer", textAlign: "left", fontSize: "14px",
        });
        const preview = document.createElement("div");
        Object.assign(preview.style, {
            width: "54px", height: "54px", flex: "0 0 54px", display: "grid", placeItems: "center", overflow: "hidden",
            borderRadius: "8px", background: "rgba(255, 255, 255, .1)", fontSize: "23px",
        });
        if (item.src) {
            const image = document.createElement("img");
            image.src = item.src;
            Object.assign(image.style, { width: "100%", height: "100%", objectFit: "cover" });
            preview.appendChild(image);
        } else preview.textContent = mediaEmoji(item.kind);
        const label = document.createElement("span");
        label.textContent = `${item.label}  →  ${item.token}`;
        row.append(preview, label);
        row.addEventListener("pointerenter", () => selectMenuRow(index));
        row.addEventListener("pointerdown", (event) => {
            event.preventDefault();
            event.stopPropagation();
            insertReference(node, item);
        });
        element.appendChild(row);
        return row;
    });
    document.body.appendChild(element);
    const caret = mention.range.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    const left = Math.max(8, Math.min(window.innerWidth - rect.width - 8, caret.left));
    let top = caret.bottom + 8;
    if (top + rect.height > window.innerHeight - 8) top = Math.max(8, caret.top - rect.height - 8);
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
    activeMenu = { element, rows, items, index: 0, node };
    selectMenuRow(0);
}

function refreshNode(node) {
    const state = node.__h3FusionPromptState;
    if (!state) return;
    const pack = findPackNode(node);
    const manifest = packManifest(isPackNode(pack) ? pack : null);
    const serialized = JSON.stringify(serializableManifest(manifest));
    let currentText = textFromEditor(state.editor);
    const storedText = String(state.promptWidget.value || "");
    const sourceText = storedText !== currentText ? storedText : currentText;
    state.manifest = manifest;
    setWidgetValue(node, state.manifestWidget, serialized);
    const manifestChanged = serialized !== String(state.renderedManifestKey || "");
    if (manifestChanged || sourceText !== currentText || editorNeedsChipHydration(state, sourceText)) {
        renderEditor(node, sourceText);
        currentText = textFromEditor(state.editor);
    }
    state.renderedManifestKey = serialized;

    const counts = { Picture: 0, Video: 0, Audio: 0 };
    manifest.items.forEach((item) => { counts[item.kind] += 1; });
    if (!isPackNode(pack)) state.status.textContent = "请将「H3 参考素材」的素材包接到本节点（可经提示词框透传）";
    else if (!manifest.items.length) state.status.textContent = `已接素材包｜${manifest.mode}｜当前没有可引用素材`;
    else state.status.textContent = `已同步素材｜图片 ${counts.Picture}｜视频 ${counts.Video}｜音频 ${counts.Audio}`;

    const stale = [...new Set((currentText.match(TOKEN_PATTERN) || []).filter((token) => !manifest.items.some((item) => item.token === token)))];
    state.warning.textContent = stale.length ? `⚠️ 已失效素材标记：${stale.join("、")}` : "输入 @ 选择已接入参考素材的图 / 视频 / 音频";
    state.warning.style.color = stale.length ? "#ff9d8f" : "#8f9aa8";
    node.setDirtyCanvas?.(true, true);
}

function setupPromptNode(node) {
    if (nodeClass(node) !== NODE_TYPE || node.__h3FusionPromptState) return;
    const promptWidget = widget(node, PROMPT_WIDGET);
    const manifestWidget = widget(node, MANIFEST_WIDGET);
    if (!promptWidget || !manifestWidget || !node.addDOMWidget) return;
    hideWidget(promptWidget);
    hideWidget(manifestWidget);

    const container = document.createElement("div");
    Object.assign(container.style, { width: "100%", height: "100%", minHeight: "390px", boxSizing: "border-box", padding: "8px" });
    const panel = document.createElement("div");
    Object.assign(panel.style, {
        display: "grid", gridTemplateRows: "auto 1fr auto", width: "100%", height: "100%", minHeight: "370px",
        border: "1px solid rgba(255, 255, 255, .18)", borderRadius: "11px", background: "rgba(15, 16, 18, .72)", overflow: "hidden",
    });
    const status = document.createElement("div");
    Object.assign(status.style, { padding: "9px 12px", font: "12px/1.4 sans-serif", color: "#a9d7ff", borderBottom: "1px solid rgba(255,255,255,.08)" });
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.spellcheck = false;
    Object.assign(editor.style, {
        minHeight: "290px", padding: "14px", outline: "none", overflowY: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word",
        color: "#f1f1f1", font: "14px/1.65 sans-serif", caretColor: "#ffffff",
    });
    const warning = document.createElement("div");
    Object.assign(warning.style, { padding: "8px 12px", font: "12px/1.4 sans-serif", borderTop: "1px solid rgba(255,255,255,.08)" });
    panel.append(status, editor, warning);
    container.appendChild(panel);
    const domWidget = node.addDOMWidget("h3_fusion_prompt_editor", "H3_PROMPT_EDITOR", container, {
        serialize: false,
        hideOnZoom: false,
        getValue: () => textFromEditor(editor),
        setValue: (value) => renderEditor(node, value),
        getMinHeight: () => 390,
    });
    if (domWidget) {
        domWidget.options ??= {};
        domWidget.options.minNodeSize = [520, 500];
    }
    node.__h3FusionPromptState = {
        promptWidget, manifestWidget, container, editor, status, warning, domWidget,
        manifest: { version: 1, target: "", mode: "T2VA", items: [] },
        renderedManifestKey: "",
    };
    renderEditor(node, promptWidget.value || "");
    editor.addEventListener("input", () => { syncPrompt(node); showMenu(node); });
    editor.addEventListener("click", () => showMenu(node));
    editor.addEventListener("keydown", (event) => {
        if ((event.ctrlKey || event.metaKey) && ["c", "v", "x", "a"].includes(event.key.toLowerCase())) event.stopPropagation();
        if (!activeMenu || activeMenu.node !== node) return;
        if (event.key === "ArrowDown") { event.preventDefault(); selectMenuRow(activeMenu.index + 1); }
        else if (event.key === "ArrowUp") { event.preventDefault(); selectMenuRow(activeMenu.index - 1); }
        else if (event.key === "Enter") { event.preventDefault(); insertReference(node, activeMenu.items[activeMenu.index]); }
        else if (event.key === "Escape") { event.preventDefault(); closeMenu(); }
    });
    editor.addEventListener("paste", (event) => {
        event.preventDefault();
        event.stopPropagation();
        document.execCommand("insertText", false, event.clipboardData?.getData("text/plain") || "");
    });
    ["pointerdown", "pointermove", "dblclick", "wheel"].forEach((name) => container.addEventListener(name, (event) => event.stopPropagation()));
    node.setSize?.([Math.max(Number(node.size?.[0]) || 0, 540), Math.max(Number(node.size?.[1]) || 0, 540)]);
    refreshNode(node);
}

function refreshAll() {
    const graph = graphOf(null);
    graph?.findNodesByType?.(NODE_TYPE)?.forEach((node) => {
        setupPromptNode(node);
        refreshNode(node);
    });
}

function wrapRefresh(proto, method, delay = 0) {
    const original = proto[method];
    if (original?.__h3FusionPromptRefreshWrapped) return;
    const wrapped = function () {
        const result = original?.apply(this, arguments);
        setTimeout(refreshAll, delay);
        return result;
    };
    wrapped.__h3FusionPromptRefreshWrapped = true;
    proto[method] = wrapped;
}

document.addEventListener("pointerdown", (event) => {
    const outsideOwn = activeMenu && !activeMenu.element.contains(event.target);
    if (outsideOwn) closeMenu();
}, true);

app.registerExtension({
    name: "CZToolkit.H3PromptBox.UI",
    async setup() {
        api.addEventListener("hot_reload_update", () => [50, 250, 1000].forEach((delay) => setTimeout(refreshAll, delay)));
        api.addEventListener("executed", () => setTimeout(refreshAll, 50));
    },
    nodeCreated(node) {
        if (nodeClass(node) === NODE_TYPE) setTimeout(() => setupPromptNode(node), 20);
    },
    loadedGraphNode(node) {
        if (nodeClass(node) === NODE_TYPE) setTimeout(() => setupPromptNode(node), 50);
    },
    async beforeRegisterNodeDef(nodeTypeClass, nodeData) {
        const type = String(nodeData?.name || "");
        if (![NODE_TYPE, PACK_NODE, "H3MediaUnpack", "H3PromptGenerator"].includes(type)) return;
        wrapRefresh(nodeTypeClass.prototype, "onConnectionsChange", 0);
        wrapRefresh(nodeTypeClass.prototype, "onConfigure", 50);
        if (type === NODE_TYPE) {
            const created = nodeTypeClass.prototype.onNodeCreated;
            nodeTypeClass.prototype.onNodeCreated = function () {
                const result = created?.apply(this, arguments);
                this.color = "#181520";
                this.bgcolor = "#1c1923";
                setTimeout(() => setupPromptNode(this), 20);
                return result;
            };
            const serialized = nodeTypeClass.prototype.onSerialize;
            nodeTypeClass.prototype.onSerialize = function () {
                refreshNode(this);
                syncPrompt(this);
                return serialized?.apply(this, arguments);
            };
        }
    },
});

console.log("[CZ-Toolkit] H3 PromptBox UI loaded");
