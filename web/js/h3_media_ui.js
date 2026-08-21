/**
 * H3 素材包 / 解包 — 解包输出口显示/隐藏。
 *
 * 1. first_frame / last_frame 常显
 * 2. 其余口跟上游素材包实际接线（直连 / Set-Get / Reroute）
 * 3. 不碰打包 Autogrow
 * 4. 执行时按口名 remap 到 Python 固定 PACK_SLOTS 下标
 *
 * 控制台可跑：window.__h3CzDebugMedia() 查看认线结果
 */
import { app } from "../../../scripts/app.js";

const PACK_NODE = "H3ReferenceMedia";
const UNPACK_NODE = "H3MediaUnpack";
const PROMPT_NODE = "H3PromptBox";
const MANIFEST_WIDGET = "素材清单";

const FIXED_UNPACK_OUTPUTS = ["first_frame", "last_frame"];

const PACK_SLOT_OUTPUTS = [
    ["first_frame", "IMAGE"],
    ["last_frame", "IMAGE"],
    ...Array.from({ length: 9 }, (_, i) => [`ref_image_${i}`, "IMAGE"]),
    ...Array.from({ length: 3 }, (_, i) => [`ref_video_${i}`, "IMAGE"]),
    ...Array.from({ length: 3 }, (_, i) => [`ref_video_audio_${i}`, "AUDIO"]),
    ...Array.from({ length: 3 }, (_, i) => [`ref_audio_${i}`, "AUDIO"]),
];
const PACK_SLOT_NAMES = PACK_SLOT_OUTPUTS.map(([name]) => name);

function outputType(name) {
    const found = PACK_SLOT_OUTPUTS.find(([n]) => n === name);
    if (found) return found[1];
    if (String(name).includes("audio")) return "AUDIO";
    return "IMAGE";
}

function nodeClass(node) {
    return String(node?.comfyClass || node?.type || node?.constructor?.comfyClass || "");
}

function isNodeClass(node, expected) {
    return [node?.comfyClass, node?.type, node?.constructor?.comfyClass, node?.constructor?.type]
        .map((value) => String(value || ""))
        .filter(Boolean)
        .some((value) => value === expected || value.endsWith(expected));
}

function isPackNode(node) {
    if (!node) return false;
    if (isNodeClass(node, PACK_NODE)) return true;
    const title = String(node.title || "");
    if (title === "H3 参考素材" || title.includes("参考素材")) return true;
    // 输出是素材包类型
    const out0 = node.outputs?.[0];
    if (out0 && /H3_MEDIA_BUNDLE|素材包/.test(String(out0.type || out0.name || ""))) return true;
    return false;
}

function isUnpackNode(node) {
    if (!node) return false;
    if (isNodeClass(node, UNPACK_NODE)) return true;
    const title = String(node.title || "");
    return title === "H3 素材解包" || title.includes("素材解包");
}

function graphOf(node) {
    return node?.graph || app.canvas?.getCurrentGraph?.() || app.canvas?.graph || app.graph || null;
}

function graphLinks(graph) {
    const links = graph?.links;
    if (links instanceof Map) return [...links.values()].filter(Boolean);
    if (links instanceof Set) return [...links.values()].filter(Boolean);
    if (Array.isArray(links)) return links.filter(Boolean);
    if (links && typeof links[Symbol.iterator] === "function" && typeof links !== "string") {
        try { return [...links].filter(Boolean); } catch (_) { /* ignore */ }
    }
    if (links && typeof links === "object") return Object.values(links).filter(Boolean);
    return [];
}

function graphLink(graph, id) {
    if (id == null || id === -1) return null;
    if (typeof id === "object") return id;
    if (graph?.links instanceof Map) return graph.links.get(id) || graph.links.get(String(id)) || null;
    return graph?.links?.[id] || graph?.links?.[String(id)]
        || graphLinks(graph).find((link) => String(link?.id) === String(id))
        || null;
}

function graphNode(graph, id) {
    if (id == null) return null;
    return graph?.getNodeById?.(id)
        || (graph?.nodes instanceof Map ? graph.nodes.get(id) || graph.nodes.get(String(id)) : null)
        || graph?._nodes_by_id?.[id]
        || (graph?._nodes_by_id instanceof Map
            ? graph._nodes_by_id.get(id) || graph._nodes_by_id.get(String(id))
            : null)
        || graph?.nodes?.find?.((node) => String(node?.id) === String(id))
        || graph?._nodes?.find?.((node) => String(node?.id) === String(id))
        || null;
}

function graphNodes(graph) {
    const g = graph || app.canvas?.graph || app.graph;
    if (!g) return [];
    if (Array.isArray(g._nodes)) return g._nodes;
    if (Array.isArray(g.nodes)) return g.nodes;
    return [];
}

function originId(link) {
    return link?.origin_id ?? link?.originId ?? link?.[1] ?? null;
}

function targetId(link) {
    return link?.target_id ?? link?.targetId ?? link?.[3] ?? null;
}

function targetSlotValue(link) {
    return link?.target_slot ?? link?.targetSlot ?? link?.[4] ?? null;
}

function inputLeafName(inputOrName) {
    const name = typeof inputOrName === "string" ? inputOrName : inputOrName?.name;
    return String(name || "").split(".").pop();
}

function findInput(node, name) {
    return (node?.inputs || []).find((input) =>
        input?.name === name || inputLeafName(input) === name
    ) || null;
}

function findBundleInput(node) {
    return findInput(node, "bundle")
        || findInput(node, "素材包")
        || (node?.inputs || []).find((input) => {
            const leaf = inputLeafName(input);
            const type = String(input?.type || "");
            return /^(bundle|素材包)$/i.test(leaf)
                || /H3_MEDIA_BUNDLE/i.test(type)
                || /素材包|bundle/i.test(String(input?.name || ""));
        })
        || null;
}

/** 对齐 prompt_box：不过滤奇怪形态，只在取值后再判 -1 */
function inputLinkId(input) {
    if (!input) return null;
    if (input.link != null && input.link !== -1) return input.link;
    const links = input.links;
    if (links == null) return null;
    if (Array.isArray(links)) {
        const first = links.find((id) => id != null && id !== -1);
        return first ?? null;
    }
    if (links instanceof Set || links instanceof Map) {
        for (const id of links.values()) {
            if (id != null && id !== -1) return id;
        }
        return null;
    }
    if (typeof links?.[Symbol.iterator] === "function" && typeof links !== "string") {
        for (const id of links) {
            if (id != null && id !== -1) return id;
        }
    }
    return null;
}

/**
 * 对齐 prompt_box.originNode：先 link id，再按下标/口名在 graph 里找。
 * 不要求先 isInputWired（Autogrow 常把校验搞挂）。
 */
function originNode(node, inputName) {
    const graph = graphOf(node);
    const input = typeof inputName === "string" ? findInput(node, inputName) : inputName;
    if (!input || !node) return null;

    const linkRef = inputLinkId(input);
    let link = graphLink(graph, linkRef);
    if (!link && graph) {
        const inputIndex = node.inputs?.indexOf(input);
        const leaf = inputLeafName(input);
        link = graphLinks(graph).find((candidate) => {
            if (String(targetId(candidate)) !== String(node.id)) return false;
            const rawSlot = targetSlotValue(candidate);
            const slot = Number(rawSlot);
            return slot === inputIndex
                || String(rawSlot) === String(input.name)
                || String(rawSlot) === String(leaf)
                || (linkRef != null && String(candidate?.id) === String(linkRef));
        }) || null;
    }
    return link ? graphNode(graph, originId(link)) : null;
}

function isInputWired(node, input) {
    if (!input || !node) return false;
    if (inputLinkId(input) != null) return true;
    return Boolean(originNode(node, input));
}

function isSetNode(node) {
    if (!node) return false;
    const cls = nodeClass(node);
    const title = String(node?.title || "");
    // KJNodes: SetNode；Easy-Use: easy setNode
    if (/setnode/i.test(cls)) return true;
    if (/^set([_\s]|$)/i.test(cls)) return true;
    if (/^Set([_\s]|$)/i.test(title)) return true;
    return false;
}

function isGetNode(node) {
    if (!node) return false;
    const cls = nodeClass(node);
    const title = String(node?.title || "");
    // KJNodes: GetNode；Easy-Use: easy getNode
    if (/getnode/i.test(cls)) return true;
    if (/^get([_\s]|$)/i.test(cls)) return true;
    if (/^Get([_\s]|$)/i.test(title)) return true;
    if (typeof node.findSetter === "function" && node.widgets?.length) return true;
    return false;
}

/** KJNodes / Easy-Use 都把隧道名放在 widgets[0]（通常叫 Constant） */
function tunnelName(node) {
    if (!node) return "";
    const w0 = node.widgets?.[0];
    if (w0 != null && String(w0.value ?? "").trim()) return String(w0.value).trim();
    const widgets = node.widgets || [];
    const named = widgets.find((item) => /^(Constant|constant|value|name)$/i.test(String(item?.name || "")));
    if (named != null && String(named.value ?? "").trim()) return String(named.value).trim();
    const titleMatch = String(node.title || "").match(/^(?:Set|Get)[_\s]+(.+)$/i);
    if (titleMatch?.[1]) return titleMatch[1].trim();
    for (const widget of widgets) {
        if (typeof widget?.value === "string" && widget.value.trim()) return widget.value.trim();
    }
    return "";
}

function findSetterForGet(getNode) {
    if (!getNode) return null;

    // KJNodes / Easy-Use 自带 findSetter
    if (typeof getNode.findSetter === "function") {
        try {
            const setter = getNode.findSetter(graphOf(getNode) || getNode.graph);
            if (setter) return setter;
        } catch (_) { /* ignore */ }
    }

    const name = tunnelName(getNode);
    if (!name) return null;

    const graphs = [];
    const pushGraph = (g) => {
        if (g && !graphs.includes(g)) graphs.push(g);
    };
    pushGraph(graphOf(getNode));
    pushGraph(getNode.graph);
    pushGraph(app.canvas?.getCurrentGraph?.());
    pushGraph(app.canvas?.graph);
    pushGraph(app.graph);
    // 子图时往上找（KJNodes 支持跨层 Set）
    let parent = getNode.graph;
    for (let i = 0; i < 6 && parent; i++) {
        pushGraph(parent);
        parent = parent.rootGraph && parent.rootGraph !== parent
            ? parent.rootGraph
            : (parent.parent || null);
    }

    for (const g of graphs) {
        for (const node of graphNodes(g)) {
            if (!isSetNode(node)) continue;
            if (tunnelName(node) === name) return node;
        }
    }
    return null;
}

function firstUpstream(node) {
    for (const input of node?.inputs || []) {
        const origin = originNode(node, input);
        if (origin) return origin;
    }
    // Set 节点有时 input.link 空，但 graph 里有指向它的线
    const graph = graphOf(node);
    for (const link of graphLinks(graph)) {
        if (String(targetId(link)) !== String(node.id)) continue;
        const origin = graphNode(graph, originId(link));
        if (origin) return origin;
    }
    return null;
}

function hookTunnelWidgets(node) {
    if (!node || node.__h3CzTunnelHooked) return;
    if (!isSetNode(node) && !isGetNode(node)) return;
    node.__h3CzTunnelHooked = true;

    const targets = [];
    const seen = new Set();
    const add = (widget) => {
        if (!widget || seen.has(widget)) return;
        seen.add(widget);
        targets.push(widget);
    };
    add(node.widgets?.[0]);
    for (const widget of node.widgets || []) {
        if (/^(Constant|constant|value|name)$/i.test(String(widget?.name || ""))) add(widget);
    }

    for (const widget of targets) {
        if (widget.__h3CzTunnelCb) continue;
        widget.__h3CzTunnelCb = true;
        const previous = widget.callback;
        widget.callback = function (...args) {
            const result = typeof previous === "function" ? previous.apply(this, args) : undefined;
            queueRefresh();
            return result;
        };
    }
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function walkUpstream(node, visited = new Set()) {
    if (!node || visited.has(String(node.id))) return null;
    visited.add(String(node.id));
    if (isPackNode(node)) return node;
    if (/reroute/i.test(nodeClass(node)) && node.inputs?.[0]) {
        return walkUpstream(originNode(node, node.inputs[0]), visited);
    }
    if (isGetNode(node)) return walkUpstream(findSetterForGet(node), visited);
    if (isSetNode(node)) return walkUpstream(firstUpstream(node), visited);
    const bundle = findBundleInput(node);
    if (bundle) return walkUpstream(originNode(node, bundle), visited);
    return null;
}

function findUpstreamPack(unpackNode) {
    if (!unpackNode) return null;

    // 1) 素材包 / bundle 口（中英文都试）
    for (const key of ["素材包", "bundle"]) {
        const origin = originNode(unpackNode, key);
        const pack = walkUpstream(origin, new Set());
        if (pack) return pack;
    }

    const bundleInput = findBundleInput(unpackNode);
    if (bundleInput) {
        const pack = walkUpstream(originNode(unpackNode, bundleInput), new Set());
        if (pack) return pack;
    }

    // 2) 任意已接入口往上爬
    for (const input of unpackNode.inputs || []) {
        const pack = walkUpstream(originNode(unpackNode, input), new Set());
        if (pack) return pack;
    }

    // 3) 纯扫 graph：谁连进解包
    const graph = graphOf(unpackNode);
    for (const link of graphLinks(graph)) {
        if (String(targetId(link)) !== String(unpackNode.id)) continue;
        const pack = walkUpstream(graphNode(graph, originId(link)), new Set());
        if (pack) return pack;
    }

    // 4) 图里只有一个打包节点时兜底用它（调试期也有用）
    const packs = graphNodes(graph).filter(isPackNode);
    if (packs.length === 1) return packs[0];

    return null;
}

function parseManifest(node) {
    const widget = node?.widgets?.find((item) => item.name === MANIFEST_WIDGET);
    const raw = widget?.value;
    if (!raw) return null;
    try {
        return typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
        return null;
    }
}

function leafToSlotName(leaf) {
    const name = String(leaf || "");
    if (PACK_SLOT_NAMES.includes(name)) return name;
    if (name === "首帧图") return "first_frame";
    if (name === "尾帧图") return "last_frame";
    let m;
    if ((m = name.match(/^参考图(\d+)$/))) return `ref_image_${Number(m[1]) - 1}`;
    if ((m = name.match(/^参考视频音轨(\d+)$/))) return `ref_video_audio_${Number(m[1]) - 1}`;
    if ((m = name.match(/^参考视频(\d+)$/))) return `ref_video_${Number(m[1]) - 1}`;
    if ((m = name.match(/^参考音频(\d+)$/))) return `ref_audio_${Number(m[1]) - 1}`;
    if ((m = name.match(/^ref_image_(\d+)$/))) return `ref_image_${m[1]}`;
    if ((m = name.match(/^ref_video_audio_(\d+)$/))) return `ref_video_audio_${m[1]}`;
    if ((m = name.match(/^ref_video_(\d+)$/))) return `ref_video_${m[1]}`;
    if ((m = name.match(/^ref_audio_(\d+)$/))) return `ref_audio_${m[1]}`;
    return null;
}

/**
 * 收集打包节点已接线槽位。三路并用：
 * A) input.link  B) originNode 能解析  C) graph.links 指向本节点
 */
function activeSlotNamesFromPack(packNode) {
    const active = new Set();
    if (!packNode) return active;
    const graph = graphOf(packNode);

    const addInput = (input) => {
        if (!input) return;
        const slot = leafToSlotName(inputLeafName(input));
        if (slot) active.add(slot);
    };

    for (const input of packNode.inputs || []) {
        if (inputLinkId(input) != null) addInput(input);
        else if (originNode(packNode, input)) addInput(input);
    }

    for (const link of graphLinks(graph)) {
        if (String(targetId(link)) !== String(packNode.id)) continue;

        // 优先：哪个 input 挂着这个 link id
        const byLink = (packNode.inputs || []).find((input) =>
            String(inputLinkId(input)) === String(link?.id)
        );
        if (byLink) {
            addInput(byLink);
            continue;
        }

        const rawSlot = targetSlotValue(link);
        const idx = Number(rawSlot);
        if (Number.isFinite(idx) && packNode.inputs?.[idx]) {
            addInput(packNode.inputs[idx]);
        }
        if (typeof rawSlot === "string") {
            const slot = leafToSlotName(inputLeafName(rawSlot));
            if (slot) active.add(slot);
        }
    }

    return active;
}

function activeSlotNamesFromManifest(manifest) {
    const active = new Set();
    for (const item of manifest?.items || []) {
        const src = item?.source_input;
        if (src && PACK_SLOT_NAMES.includes(src)) active.add(src);
    }
    return active;
}

function desiredUnpackOutputs(unpackNode) {
    const desired = [...FIXED_UNPACK_OUTPUTS];
    const pack = findUpstreamPack(unpackNode);
    let active = new Set();

    if (pack) {
        active = activeSlotNamesFromPack(pack);
    } else {
        const origin = originNode(unpackNode, findBundleInput(unpackNode))
            || originNode(unpackNode, "素材包")
            || originNode(unpackNode, "bundle");
        if (origin && isNodeClass(origin, PROMPT_NODE)) {
            active = activeSlotNamesFromManifest(parseManifest(origin));
        }
    }

    for (const name of PACK_SLOT_NAMES) {
        if (FIXED_UNPACK_OUTPUTS.includes(name)) continue;
        if (active.has(name)) desired.push(name);
    }
    return [...new Set(desired)];
}

function sortNamesByPackSlots(names) {
    const order = new Map(PACK_SLOT_NAMES.map((name, index) => [name, index]));
    return [...new Set(names)].sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999));
}

function outputHasLinks(output) {
    const links = output?.links;
    if (links == null) return false;
    if (Array.isArray(links)) return links.length > 0;
    if (typeof links === "object") return Object.keys(links).length > 0;
    return Boolean(links);
}

function retargetUnpackOutputLinks(node, oldOutputs, newOutputs) {
    const graph = graphOf(node);
    if (!graph) return;
    const newIndex = new Map(newOutputs.map((output, index) => [output.name, index]));
    for (const link of graphLinks(graph)) {
        if (!link || String(originId(link)) !== String(node.id)) continue;
        const oldSlot = Number(link.origin_slot ?? link.originSlot ?? link[2] ?? -1);
        const name = oldOutputs[oldSlot]?.name;
        if (!name || !newIndex.has(name)) continue;
        const next = newIndex.get(name);
        if (link.origin_slot != null) link.origin_slot = next;
        if (link.originSlot != null) link.originSlot = next;
        if (Array.isArray(link)) link[2] = next;
    }
}

function syncUnpackNodeOutputs(node) {
    if (!isUnpackNode(node)) return;

    const desired = sortNamesByPackSlots(desiredUnpackOutputs(node));
    const desiredSet = new Set(desired);
    const oldOutputs = [...(node.outputs || [])];
    const current = (node.outputs || []).map((o) => o.name).join("|");

    if (current === desired.join("|")) {
        for (const output of node.outputs || []) {
            output.type = outputType(output.name);
            output.hidden = false;
        }
        return;
    }

    for (let i = (node.outputs?.length ?? 0) - 1; i >= 0; i--) {
        const output = node.outputs[i];
        if (desiredSet.has(output?.name)) continue;
        try {
            if (outputHasLinks(output) && typeof node.disconnectOutput === "function") {
                node.disconnectOutput(i);
            }
        } catch (_) { /* ignore */ }
        try {
            node.removeOutput(i);
        } catch (_) { /* ignore */ }
    }

    for (const name of desired) {
        if (!node.outputs?.some((output) => output.name === name)) {
            try {
                node.addOutput(name, outputType(name));
            } catch (_) { /* ignore */ }
        }
    }

    // 若 addOutput 被前端吞掉，直接写 outputs 数组兜底
    let byName = new Map((node.outputs || []).map((output) => [output.name, output]));
    for (const name of desired) {
        if (byName.has(name)) continue;
        const created = { name, type: outputType(name), links: null, slot_index: byName.size };
        node.outputs = [...(node.outputs || []), created];
        byName.set(name, created);
    }

    byName = new Map((node.outputs || []).map((output) => [output.name, output]));
    const ordered = desired.map((name) => byName.get(name)).filter(Boolean);

    retargetUnpackOutputLinks(node, oldOutputs, ordered);
    node.outputs = ordered;
    for (const output of node.outputs || []) {
        output.type = outputType(output.name);
        output.hidden = false;
        output.name = output.name;
    }

    node.setDirtyCanvas?.(true, true);
    try {
        node.setSize?.(node.computeSize?.());
    } catch (_) { /* ignore */ }
}

function remapUnpackSlotsInPrompt(promptResult) {
    const output = promptResult?.output;
    if (!output) return promptResult;
    const graph = app.canvas?.getCurrentGraph?.() || app.canvas?.graph || app.graph;

    for (const nodePrompt of Object.values(output)) {
        if (!nodePrompt?.inputs) continue;
        for (const value of Object.values(nodePrompt.inputs)) {
            if (!Array.isArray(value) || value.length < 2) continue;
            const srcNode = graphNode(graph, value[0]);
            if (!isUnpackNode(srcNode)) continue;
            const name = srcNode.outputs?.[Number(value[1])]?.name;
            if (!name) continue;
            const pyIndex = PACK_SLOT_NAMES.indexOf(name);
            if (pyIndex >= 0 && pyIndex !== Number(value[1])) value[1] = pyIndex;
        }
    }
    return promptResult;
}

function hookGraphToPrompt() {
    if (app.__h3CzGraphToPromptHooked) return;
    const original = app.graphToPrompt;
    if (typeof original !== "function") return;
    app.graphToPrompt = async function (...args) {
        const result = await original.apply(this, args);
        return remapUnpackSlotsInPrompt(result);
    };
    app.__h3CzGraphToPromptHooked = true;
}

function isCanvasBusy() {
    const canvas = app.canvas;
    if (!canvas) return false;
    if (Array.isArray(canvas.connecting_links) && canvas.connecting_links.length > 0) return true;
    if (canvas.connecting_output || canvas.connecting_input) return true;
    const connector = canvas.linkConnector;
    if (connector) {
        // 不同前端版本：可能是方法、布尔值，或根本没有
        if (typeof connector.isConnecting === "function") {
            try {
                if (connector.isConnecting()) return true;
            } catch (_) { /* ignore */ }
        } else if (connector.isConnecting === true) {
            return true;
        }
        if (connector.renderLinks?.length > 0) return true;
        if (connector.state?.connecting) return true;
    }
    return false;
}

function refreshMediaNodes() {
    if (isCanvasBusy()) return;
    const graph = app.canvas?.getCurrentGraph?.() || app.canvas?.graph || app.graph;
    const nodes = graph?._nodes || graph?.nodes || [];
    for (const node of nodes) {
        if (isUnpackNode(node)) syncUnpackNodeOutputs(node);
    }
}

let refreshTimer = null;
function queueRefresh() {
    if (refreshTimer != null) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
        refreshTimer = null;
        if (isCanvasBusy()) {
            refreshTimer = setTimeout(() => queueRefresh(), 150);
            return;
        }
        refreshMediaNodes();
    }, 100);
}

function hookPointerUpRefresh() {
    if (app.__h3CzPointerUpHooked) return;
    app.__h3CzPointerUpHooked = true;
    const flush = () => setTimeout(() => queueRefresh(), 60);
    window.addEventListener("pointerup", flush, true);
    window.addEventListener("mouseup", flush, true);
}

/** 任意连线变化都刷新（不依赖节点 hooks 是否挂上） */
function hookGraphConnectionChange() {
    if (app.__h3CzConnHooked) return;
    const tryHook = () => {
        const LGraph = globalThis.LiteGraph?.LGraph;
        if (!LGraph?.prototype || LGraph.prototype.__h3CzConnHooked) {
            if (!LGraph) setTimeout(tryHook, 500);
            return;
        }
        LGraph.prototype.__h3CzConnHooked = true;
        const original = LGraph.prototype.connectionChange;
        LGraph.prototype.connectionChange = function (...args) {
            const result = typeof original === "function" ? original.apply(this, args) : undefined;
            queueRefresh();
            return result;
        };
        app.__h3CzConnHooked = true;
    };
    tryHook();
}

function wrapNodeMethod(nodeTypeClass, method, after) {
    const proto = nodeTypeClass.prototype;
    const flag = `__h3CzMediaUiWrapped_${method}`;
    if (proto[flag]) return;
    proto[flag] = true;
    const original = proto[method];
    proto[method] = function (...args) {
        const result = typeof original === "function" ? original.apply(this, args) : undefined;
        after.apply(this, args);
        return result;
    };
}

function wrapPackHooks(nodeTypeClass) {
    wrapNodeMethod(nodeTypeClass, "onNodeCreated", () => queueRefresh());
    wrapNodeMethod(nodeTypeClass, "onConfigure", () => queueRefresh());
    wrapNodeMethod(nodeTypeClass, "onConnectionsChange", function (side) {
        const OUTPUT = globalThis.LiteGraph?.OUTPUT ?? 2;
        if (side === OUTPUT || side === "output") return;
        queueRefresh();
    });
}

app.__h3CzSyncUnpackOutputs = () => refreshMediaNodes();

/** 控制台调试：__h3CzDebugMedia() */
app.__h3CzDebugMedia = window.__h3CzDebugMedia = function __h3CzDebugMedia() {
    const graph = app.canvas?.getCurrentGraph?.() || app.canvas?.graph || app.graph;
    const nodes = graphNodes(graph);
    const packs = nodes.filter(isPackNode);
    const unpacks = nodes.filter(isUnpackNode);
    const report = unpacks.map((u) => {
        const pack = findUpstreamPack(u);
        const active = pack ? [...activeSlotNamesFromPack(pack)] : [];
        const via = (() => {
            const origin = originNode(u, findBundleInput(u))
                || originNode(u, "素材包")
                || originNode(u, "bundle")
                || firstUpstream(u);
            return {
                originId: origin?.id ?? null,
                originType: nodeClass(origin),
                originTitle: origin?.title ?? null,
                isGet: isGetNode(origin),
                isSet: isSetNode(origin),
                tunnel: isGetNode(origin) || isSetNode(origin) ? tunnelName(origin) : "",
                setterId: isGetNode(origin) ? findSetterForGet(origin)?.id ?? null : null,
            };
        })();
        return {
            unpackId: u.id,
            unpackTitle: u.title,
            via,
            packId: pack?.id ?? null,
            packTitle: pack?.title ?? null,
            packInputs: (pack?.inputs || []).map((input) => ({
                name: input.name,
                leaf: inputLeafName(input),
                link: input.link,
                wired: isInputWired(pack, input),
                origin: originNode(pack, input)?.id ?? null,
            })),
            active,
            desired: desiredUnpackOutputs(u),
            outputs: (u.outputs || []).map((o) => o.name),
        };
    });
    console.log("[CZ-Toolkit] H3 media debug", report);
    return report;
};

app.registerExtension({
    name: "CZToolkit.H3Media.UI",

    async setup() {
        hookGraphToPrompt();
        hookPointerUpRefresh();
        hookGraphConnectionChange();
        app.api?.addEventListener?.("graphLoaded", () => {
            setTimeout(() => queueRefresh(), 200);
        });
        queueRefresh();
        console.log("[CZ-Toolkit] H3 Media UI loaded — debug: window.__h3CzDebugMedia()");
    },

    nodeCreated(node) {
        if (isSetNode(node) || isGetNode(node)) {
            hookTunnelWidgets(node);
            queueRefresh();
            return;
        }
        if (isPackNode(node) || isUnpackNode(node)) queueRefresh();
    },

    loadedGraphNode(node) {
        if (isSetNode(node) || isGetNode(node)) {
            hookTunnelWidgets(node);
            queueRefresh();
            return;
        }
        if (isPackNode(node) || isUnpackNode(node)) queueRefresh();
    },

    async beforeRegisterNodeDef(nodeTypeClass, nodeData) {
        const type = String(nodeData?.name || "");
        if (type === PACK_NODE || type.endsWith(PACK_NODE)) wrapPackHooks(nodeTypeClass);
        if (type === UNPACK_NODE || type.endsWith(UNPACK_NODE)) {
            wrapNodeMethod(nodeTypeClass, "onNodeCreated", function () {
                const keep = new Set(FIXED_UNPACK_OUTPUTS);
                for (let i = (this.outputs?.length ?? 0) - 1; i >= 0; i--) {
                    if (!keep.has(this.outputs[i]?.name)) {
                        try { this.removeOutput(i); } catch (_) { /* ignore */ }
                    }
                }
                for (const name of FIXED_UNPACK_OUTPUTS) {
                    if (!this.outputs?.some((output) => output.name === name)) {
                        try { this.addOutput(name, outputType(name)); } catch (_) { /* ignore */ }
                    }
                }
                queueRefresh();
            });
            wrapNodeMethod(nodeTypeClass, "onConnectionsChange", () => queueRefresh());
            wrapNodeMethod(nodeTypeClass, "onConfigure", () => queueRefresh());
        }
        if (/SetNode$/i.test(type) || /GetNode$/i.test(type)
            || /setNode/i.test(type) || /getNode/i.test(type)
            || type === "SetNode" || type === "GetNode") {
            wrapNodeMethod(nodeTypeClass, "onNodeCreated", function () {
                hookTunnelWidgets(this);
                queueRefresh();
            });
            wrapNodeMethod(nodeTypeClass, "onConnectionsChange", function () {
                hookTunnelWidgets(this);
                queueRefresh();
            });
            wrapNodeMethod(nodeTypeClass, "onConfigure", function () {
                hookTunnelWidgets(this);
                queueRefresh();
            });
        }
    },
});
