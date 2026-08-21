import { app } from "../../../scripts/app.js";

const PACK_NODE = "H3ReferenceMedia";
const UNPACK_NODE = "H3MediaUnpack";
const PROMPT_NODE = "H3PromptBox";
const MANIFEST_WIDGET = "素材清单";

const LEGACY_REF_PATTERN = /^(参考图\d+|参考视频\d+|参考视频音轨\d+|参考音频\d+)$/;
const FIXED_UNPACK_OUTPUTS = ["first_frame", "last_frame"];

/** 必须与 media_util.PACK_SLOTS / nodes_media_v3._unpack_outputs 顺序完全一致，否则执行时下标错位会吐 None */
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
    return [node?.comfyClass, node?.type, node?.constructor?.comfyClass]
        .map((value) => String(value || ""))
        .some((value) => value === expected || value.endsWith(expected));
}

function isPackNode(node) {
    return isNodeClass(node, PACK_NODE) || String(node?.title || "") === "H3 参考素材";
}

function isUnpackNode(node) {
    return isNodeClass(node, UNPACK_NODE) || String(node?.title || "") === "H3 素材解包";
}

function graphOf(node) {
    return node?.graph || app.canvas?.getCurrentGraph?.() || app.canvas?.graph || app.graph || null;
}

function graphLink(graph, id) {
    if (id == null || id === -1) return null;
    if (typeof id === "object") return id;
    if (graph?.links instanceof Map) return graph.links.get(id) || graph.links.get(String(id)) || null;
    const links = graph?.links;
    const list = links instanceof Map ? [...links.values()] : Array.isArray(links) ? links : Object.values(links || {});
    return graph?.links?.[id] || graph?.links?.[String(id)] || list.find((link) => String(link?.id) === String(id)) || null;
}

function graphNode(graph, id) {
    if (id == null) return null;
    return graph?.getNodeById?.(id)
        || graph?._nodes_by_id?.[id]
        || graph?.nodes?.find?.((node) => String(node?.id) === String(id))
        || graph?._nodes?.find?.((node) => String(node?.id) === String(id))
        || null;
}

function originId(link) {
    return link?.origin_id ?? link?.originId ?? link?.[1] ?? null;
}

function targetId(link) {
    return link?.target_id ?? link?.targetId ?? link?.[3] ?? null;
}

function targetSlot(link) {
    return Number(link?.target_slot ?? link?.targetSlot ?? link?.[4] ?? -1);
}

function inputLeafName(name) {
    return String(name || "").split(".").pop();
}

function findInput(node, name) {
    return node?.inputs?.find((input) => inputLeafName(input.name) === name || input.name === name) || null;
}

function inputLinkId(input) {
    if (!input) return null;
    // LiteGraph 断开后常把 link 设成 -1
    if (input.link != null && input.link !== -1) return input.link;
    const links = input.links;
    if (links == null) return null;
    if (Array.isArray(links)) {
        const first = links.find((id) => id != null && id !== -1);
        return first ?? null;
    }
    return null;
}

/** 只认 input 上真实有效的 link，不做 slot 回退（Autogrow 增删口时回退会误判） */
function isInputWired(node, input) {
    if (!input || !node) return false;
    const graph = graphOf(node);
    const linkId = inputLinkId(input);
    if (linkId == null) return false;
    const link = graphLink(graph, linkId);
    if (!link) return false;
    if (String(targetId(link)) !== String(node.id)) return false;
    const inputIndex = node.inputs?.indexOf(input);
    if (inputIndex < 0) return false;
    return targetSlot(link) === inputIndex;
}

function originNode(node, inputName) {
    const graph = graphOf(node);
    const input = findInput(node, inputName);
    if (!isInputWired(node, input)) return null;
    const link = graphLink(graph, inputLinkId(input));
    return link ? graphNode(graph, originId(link)) : null;
}

function graphNodes(graph) {
    const g = graph || app.canvas?.graph || app.graph;
    if (!g) return [];
    if (Array.isArray(g._nodes)) return g._nodes;
    if (Array.isArray(g.nodes)) return g.nodes;
    return [];
}

function isSetNode(node) {
    const cls = nodeClass(node);
    return cls === "SetNode" || cls.endsWith("SetNode") || /^Set[_ ]/.test(String(node?.title || ""));
}

function isGetNode(node) {
    const cls = nodeClass(node);
    return cls === "GetNode" || cls.endsWith("GetNode") || /^Get[_ ]/.test(String(node?.title || ""));
}

function tunnelName(node) {
    const widget = (node?.widgets || []).find((item) => /^(Constant|constant)$/i.test(item.name));
    return String(widget?.value ?? "").trim();
}

function findSetterForGet(getNode) {
    if (typeof getNode?.findSetter === "function") {
        try {
            const setter = getNode.findSetter(graphOf(getNode));
            if (setter) return setter;
        } catch (_) { /* KJNodes 偶发 graph 未就绪 */ }
    }
    const name = tunnelName(getNode);
    if (!name) return null;
    return graphNodes(graphOf(getNode)).find((node) => isSetNode(node) && tunnelName(node) === name) || null;
}

function firstUpstream(node) {
    for (const input of node?.inputs || []) {
        const origin = originNode(node, input.name);
        if (origin) return origin;
    }
    return null;
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function connectedByExactPrefix(node, prefix) {
    const pattern = new RegExp(`^${escapeRegExp(prefix)}(\\d+)$`);
    return (node?.inputs || [])
        .map((input) => {
            const match = inputLeafName(input.name).match(pattern);
            if (!match) return null;
            return isInputWired(node, input) ? Number(match[1]) : null;
        })
        .filter((slot) => slot != null)
        .sort((a, b) => a - b);
}

function isV3PackNode(node) {
    return node?.widgets?.some((widget) => widget.name === "image_max_side")
        || (node?.inputs || []).some((input) => /^ref_image_\d+$/.test(inputLeafName(input.name)));
}

function isLegacyRefInput(name) {
    return LEGACY_REF_PATTERN.test(inputLeafName(name));
}

function stripLegacyPackInputs(node) {
    if (!isPackNode(node) || !isV3PackNode(node)) return false;

    let changed = false;
    for (let i = (node.inputs?.length ?? 0) - 1; i >= 0; i--) {
        const input = node.inputs[i];
        if (!isLegacyRefInput(input.name)) continue;
        if (inputLinkId(input) != null) continue;
        node.removeInput(i);
        changed = true;
    }
    if (changed) node.setDirtyCanvas?.(true, true);
    return changed;
}

function walkUpstream(node, visited = new Set()) {
    if (!node || visited.has(String(node.id))) return null;
    visited.add(String(node.id));
    if (isPackNode(node)) return node;
    if (/reroute/i.test(nodeClass(node)) && node.inputs?.[0]) {
        return walkUpstream(originNode(node, node.inputs[0].name), visited);
    }
    if (isGetNode(node)) return walkUpstream(findSetterForGet(node), visited);
    if (isSetNode(node)) return walkUpstream(firstUpstream(node), visited);
    const bundle = findInput(node, "bundle") || findInput(node, "素材包");
    if (bundle) return walkUpstream(originNode(node, bundle.name), visited);
    return null;
}

function findUpstreamPack(unpackNode) {
    const bundleInput = findInput(unpackNode, "bundle") || findInput(unpackNode, "素材包");
    if (!bundleInput) return null;
    return walkUpstream(originNode(unpackNode, bundleInput.name), new Set());
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

function connectedRefImageSlots(node) {
    const modern = connectedByExactPrefix(node, "ref_image_");
    if (modern.length) return modern;
    return connectedByExactPrefix(node, "参考图").map((slot) => slot - 1);
}

function connectedRefVideoSlots(node) {
    const modern = connectedByExactPrefix(node, "ref_video_");
    if (modern.length) return modern;
    return connectedByExactPrefix(node, "参考视频").map((slot) => slot - 1);
}

function connectedRefVideoAudioSlots(node) {
    const modern = connectedByExactPrefix(node, "ref_video_audio_");
    if (modern.length) return modern;
    return connectedByExactPrefix(node, "参考视频音轨").map((slot) => slot - 1);
}

function connectedRefAudioSlots(node) {
    const modern = connectedByExactPrefix(node, "ref_audio_");
    if (modern.length) return modern;
    return connectedByExactPrefix(node, "参考音频").map((slot) => slot - 1);
}

function dynamicOutputsFromPack(packNode) {
    if (!packNode) return [];

    const names = [];
    const refImages = connectedRefImageSlots(packNode);
    const refVideos = connectedRefVideoSlots(packNode);
    const refVideoAudios = connectedRefVideoAudioSlots(packNode);
    const refAudios = connectedRefAudioSlots(packNode);

    refImages.forEach((slot) => names.push(`ref_image_${slot}`));
    for (const slot of [...new Set([...refVideos, ...refVideoAudios])].sort((a, b) => a - b)) {
        if (refVideos.includes(slot)) names.push(`ref_video_${slot}`);
        if (refVideoAudios.includes(slot)) names.push(`ref_video_audio_${slot}`);
    }
    refAudios.forEach((slot) => names.push(`ref_audio_${slot}`));
    return names;
}

function outputsFromManifest(manifest) {
    const names = [];
    const seen = new Set(FIXED_UNPACK_OUTPUTS);
    for (const item of manifest?.items || []) {
        const src = item?.source_input;
        if (!src || seen.has(src) || FIXED_UNPACK_OUTPUTS.includes(src)) continue;
        seen.add(src);
        names.push(src);
    }
    return names;
}

function desiredUnpackOutputs(unpackNode) {
    const desired = [...FIXED_UNPACK_OUTPUTS];
    const pack = findUpstreamPack(unpackNode);
    if (pack) {
        desired.push(...dynamicOutputsFromPack(pack));
    } else {
        const graph = graphOf(unpackNode);
        const bundleInput = findInput(unpackNode, "bundle") || findInput(unpackNode, "素材包");
        const link = graphLink(graph, inputLinkId(bundleInput));
        const origin = link ? graphNode(graph, originId(link)) : null;
        if (origin && isNodeClass(origin, PROMPT_NODE)) {
            desired.push(...outputsFromManifest(parseManifest(origin)));
        }
    }
    return [...new Set(desired)];
}

function outputHasLinks(output) {
    const links = output?.links;
    if (links == null) return false;
    if (Array.isArray(links)) return links.length > 0;
    if (typeof links === "object") return Object.keys(links).length > 0;
    return Boolean(links);
}

function ensureUnpackSlotOutputs(node) {
    // 缺的补上；多余的（非 schema）才删。顺序必须与 Python 一致。
    const have = new Map((node.outputs || []).map((output, index) => [output.name, { output, index }]));

    for (let i = 0; i < PACK_SLOT_OUTPUTS.length; i++) {
        const [name, type] = PACK_SLOT_OUTPUTS[i];
        const existing = have.get(name);
        if (!existing) {
            node.addOutput(name, type);
            continue;
        }
        existing.output.type = type;
        existing.output.name = name;
    }

    for (let i = (node.outputs?.length ?? 0) - 1; i >= 0; i--) {
        const name = node.outputs[i]?.name;
        if (PACK_SLOT_NAMES.includes(name)) continue;
        if (!outputHasLinks(node.outputs[i])) node.removeOutput(i);
    }

    // 按 PACK_SLOTS 稳态重排（连同 links 一起挪，避免下标错位）
    const byName = new Map((node.outputs || []).map((output) => [output.name, output]));
    const ordered = [];
    for (const [name] of PACK_SLOT_OUTPUTS) {
        const output = byName.get(name);
        if (output) ordered.push(output);
    }
    for (const output of node.outputs || []) {
        if (!PACK_SLOT_NAMES.includes(output.name)) ordered.push(output);
    }
    node.outputs = ordered;
}

function syncUnpackNodeOutputs(node) {
    if (!isUnpackNode(node)) return;

    ensureUnpackSlotOutputs(node);
    const desired = new Set(desiredUnpackOutputs(node));

    for (const output of node.outputs || []) {
        const name = output.name;
        const keepVisible = FIXED_UNPACK_OUTPUTS.includes(name)
            || desired.has(name)
            || outputHasLinks(output);
        // 隐藏未使用口，但不删除——删除会打乱与 Python 返回值的下标对齐
        output.hidden = !keepVisible;
    }

    node.setDirtyCanvas?.(true, true);
    node.setSize?.(node.computeSize?.() || node.size);
}

function isCanvasBusy() {
    const canvas = app.canvas;
    if (!canvas) return false;
    return Boolean(
        canvas.connecting_links?.length
        || canvas.connecting_output
        || canvas.connecting_input
        || canvas.dragging_canvas
        || canvas.graph_mouse_mode
        || canvas.pointer_is_down
    );
}

function refreshMediaNodes({ allowStripLegacy = false } = {}) {
    if (isCanvasBusy()) return;
    const graph = app.canvas?.getCurrentGraph?.() || app.canvas?.graph || app.graph;
    for (const node of graph?._nodes || graph?.nodes || []) {
        // 连线拖拽时不要动打包口，否则 Autogrow（尤其 video）会把线吸回去
        if (allowStripLegacy && isPackNode(node)) stripLegacyPackInputs(node);
        if (isUnpackNode(node)) syncUnpackNodeOutputs(node);
    }
}

let refreshTimer = null;
function queueRefresh(options) {
    if (refreshTimer != null) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
        refreshTimer = null;
        if (isCanvasBusy()) {
            queueRefresh(options);
            return;
        }
        refreshMediaNodes(options);
        requestAnimationFrame(() => {
            if (!isCanvasBusy()) refreshMediaNodes(options);
        });
    }, 40);
}

function wrapNodeMethod(nodeTypeClass, method, after) {
    const proto = nodeTypeClass.prototype;
    const flag = `__h3CzMediaUiWrapped_${method}`;
    if (proto[flag]) return;
    proto[flag] = true;
    const original = proto[method];
    proto[method] = function (...args) {
        const result = typeof original === "function" ? original.apply(this, args) : undefined;
        after.call(this, args);
        return result;
    };
}

function wrapPackHooks(nodeTypeClass) {
    wrapNodeMethod(nodeTypeClass, "onNodeCreated", function () {
        stripLegacyPackInputs(this);
        queueRefresh({ allowStripLegacy: true });
    });
    wrapNodeMethod(nodeTypeClass, "onConfigure", function () {
        stripLegacyPackInputs(this);
        queueRefresh({ allowStripLegacy: true });
    });
    wrapNodeMethod(nodeTypeClass, "onConnectionsChange", function () {
        // 只刷新解包可见性，绝不在连线过程中 removeInput
        queueRefresh({ allowStripLegacy: false });
    });
}

function hookGraphConnections() {
    const LGraph = app.graph?.constructor || globalThis.LiteGraph?.LGraph;
    if (!LGraph?.prototype || LGraph.prototype.__h3CzMediaConnHooked) return;
    const original = LGraph.prototype.connectionChange;
    LGraph.prototype.connectionChange = function (...args) {
        const result = typeof original === "function" ? original.apply(this, args) : undefined;
        queueRefresh({ allowStripLegacy: false });
        return result;
    };
    LGraph.prototype.__h3CzMediaConnHooked = true;
}

app.__h3CzStripLegacyPackInputs = () => refreshMediaNodes({ allowStripLegacy: true });
app.__h3CzSyncUnpackOutputs = () => refreshMediaNodes({ allowStripLegacy: false });

app.registerExtension({
    name: "CZToolkit.H3Media.UI",

    async setup() {
        hookGraphConnections();
        app.api?.addEventListener?.("graphLoaded", () => queueRefresh({ allowStripLegacy: true }));
        queueRefresh({ allowStripLegacy: true });
    },

    nodeCreated(node) {
        if (isPackNode(node) || isUnpackNode(node)) queueRefresh({ allowStripLegacy: true });
    },

    loadedGraphNode(node) {
        if (isPackNode(node) || isUnpackNode(node)) queueRefresh({ allowStripLegacy: true });
    },

    async beforeRegisterNodeDef(nodeTypeClass, nodeData) {
        const type = String(nodeData?.name || "");
        if (type === PACK_NODE) wrapPackHooks(nodeTypeClass);
        if (type === UNPACK_NODE || type === "SetNode" || type === "GetNode") {
            wrapNodeMethod(nodeTypeClass, "onConnectionsChange", () => queueRefresh({ allowStripLegacy: false }));
            wrapNodeMethod(nodeTypeClass, "onConfigure", () => queueRefresh({ allowStripLegacy: true }));
        }
    },
});

console.log("[CZ-Toolkit] H3 Media UI loaded");
