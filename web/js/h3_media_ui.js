import { app } from "../../../scripts/app.js";

const PACK_NODE = "H3ReferenceMedia";
const UNPACK_NODE = "H3MediaUnpack";
const PROMPT_NODE = "H3PromptBox";
const MANIFEST_WIDGET = "素材清单";

const LEGACY_REF_PATTERN = /^(参考图\d+|参考视频\d+|参考视频音轨\d+|参考音频\d+)$/;
const FIXED_UNPACK_OUTPUTS = ["first_frame", "last_frame"];

/** 与 media_util.PACK_SLOTS / Python 解包返回顺序一致；执行时按名称映射到此下标 */
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

function inputLeafName(name) {
    return String(name || "").split(".").pop();
}

function findInput(node, name) {
    return node?.inputs?.find((input) => inputLeafName(input.name) === name || input.name === name) || null;
}

function inputLinkId(input) {
    if (!input) return null;
    if (input.link != null && input.link !== -1) return input.link;
    const links = input.links;
    if (Array.isArray(links)) {
        const first = links.find((id) => id != null && id !== -1);
        return first ?? null;
    }
    return null;
}

/** 只读判断：input 上挂着仍存在于图中、且指向本节点的 link。绝不改线、不删口。 */
function isInputWired(node, input) {
    if (!input || !node) return false;
    const linkId = inputLinkId(input);
    if (linkId == null) return false;
    const link = graphLink(graphOf(node), linkId);
    if (!link) return false;
    return String(targetId(link)) === String(node.id);
}

function originNode(node, inputName) {
    const input = typeof inputName === "string" ? findInput(node, inputName) : inputName;
    if (!isInputWired(node, input)) return null;
    const link = graphLink(graphOf(node), inputLinkId(input));
    return link ? graphNode(graphOf(node), originId(link)) : null;
}

function isSetNode(node) {
    const cls = nodeClass(node);
    const title = String(node?.title || "");
    return cls === "SetNode" || cls.endsWith("SetNode") || /^Set[_ ]/i.test(title);
}

function isGetNode(node) {
    const cls = nodeClass(node);
    const title = String(node?.title || "");
    return cls === "GetNode" || cls.endsWith("GetNode") || /^Get[_ ]/i.test(title);
}

function tunnelName(node) {
    if (!node) return "";
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
    if (typeof getNode.findSetter === "function") {
        try {
            const setter = getNode.findSetter(graphOf(getNode));
            if (setter) return setter;
        } catch (_) { /* ignore */ }
    }
    const name = tunnelName(getNode);
    if (!name) return null;
    return graphNodes(graphOf(getNode)).find((node) => isSetNode(node) && tunnelName(node) === name) || null;
}

function firstUpstream(node) {
    for (const input of node?.inputs || []) {
        const origin = originNode(node, input);
        if (origin) return origin;
    }
    return null;
}

function hookTunnelWidgets(node) {
    if (!node || node.__h3CzTunnelHooked) return;
    if (!isSetNode(node) && !isGetNode(node)) return;
    node.__h3CzTunnelHooked = true;
    const targets = (node.widgets || []).filter((widget) =>
        /^(Constant|constant|value|name)$/i.test(String(widget?.name || ""))
    );
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

/** 仅加载/创建时清旧中文口；连线过程中绝不对打包节点 removeInput */
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
        return walkUpstream(originNode(node, node.inputs[0]), visited);
    }
    if (isGetNode(node)) return walkUpstream(findSetterForGet(node), visited);
    if (isSetNode(node)) return walkUpstream(firstUpstream(node), visited);
    const bundle = findInput(node, "bundle") || findInput(node, "素材包");
    if (bundle) return walkUpstream(originNode(node, bundle), visited);
    return null;
}

function findUpstreamPack(unpackNode) {
    const bundleInput = findInput(unpackNode, "bundle") || findInput(unpackNode, "素材包");
    if (!bundleInput) return null;
    return walkUpstream(originNode(unpackNode, bundleInput), new Set());
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
    // 打包侧接了哪个口，解包就显示哪个（只读，不改打包 Autogrow）
    connectedRefImageSlots(packNode).forEach((slot) => names.push(`ref_image_${slot}`));
    const videos = connectedRefVideoSlots(packNode);
    const videoAudios = connectedRefVideoAudioSlots(packNode);
    for (const slot of [...new Set([...videos, ...videoAudios])].sort((a, b) => a - b)) {
        if (videos.includes(slot)) names.push(`ref_video_${slot}`);
        if (videoAudios.includes(slot)) names.push(`ref_video_audio_${slot}`);
    }
    connectedRefAudioSlots(packNode).forEach((slot) => names.push(`ref_audio_${slot}`));
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
        const origin = originNode(
            unpackNode,
            findInput(unpackNode, "bundle") || findInput(unpackNode, "素材包")
        );
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

function sortNamesByPackSlots(names) {
    const order = new Map(PACK_SLOT_NAMES.map((name, index) => [name, index]));
    return [...new Set(names)].sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999));
}

function retargetUnpackOutputLinks(node, oldOutputs, newOutputs) {
    const graph = graphOf(node);
    if (!graph) return;
    const newIndex = new Map(newOutputs.map((output, index) => [output.name, index]));
    const links = graph.links instanceof Map
        ? [...graph.links.values()]
        : Array.isArray(graph.links)
            ? graph.links
            : Object.values(graph.links || {});

    for (const link of links) {
        if (!link || String(link.origin_id ?? link.originId ?? link[1]) !== String(node.id)) continue;
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

    for (let i = (node.outputs?.length ?? 0) - 1; i >= 0; i--) {
        const output = node.outputs[i];
        if (desiredSet.has(output.name)) continue;
        try {
            if (outputHasLinks(output) && typeof node.disconnectOutput === "function") {
                node.disconnectOutput(i);
            }
        } catch (_) { /* ignore */ }
        node.removeOutput(i);
    }

    for (const name of desired) {
        if (!node.outputs?.some((output) => output.name === name)) {
            node.addOutput(name, outputType(name));
        }
    }

    const byName = new Map((node.outputs || []).map((output) => [output.name, output]));
    const ordered = desired.map((name) => byName.get(name)).filter(Boolean);
    for (const output of node.outputs || []) {
        if (!desiredSet.has(output.name)) ordered.push(output);
    }

    retargetUnpackOutputLinks(node, oldOutputs, ordered);
    node.outputs = ordered;
    for (const output of node.outputs || []) {
        output.type = outputType(output.name);
        output.hidden = false;
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
    return Boolean(
        canvas.connecting_links?.length
        || canvas.connecting_output
        || canvas.connecting_input
        || canvas.dragging_canvas
        || canvas.pointer_is_down
    );
}

function refreshMediaNodes({ stripLegacy = false } = {}) {
    if (isCanvasBusy()) return;
    const graph = app.canvas?.getCurrentGraph?.() || app.canvas?.graph || app.graph;
    for (const node of graph?._nodes || graph?.nodes || []) {
        if (stripLegacy && isPackNode(node)) stripLegacyPackInputs(node);
        if (isUnpackNode(node)) syncUnpackNodeOutputs(node);
    }
}

let refreshTimer = null;
function queueRefresh(options = {}) {
    if (refreshTimer != null) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
        refreshTimer = null;
        if (isCanvasBusy()) {
            queueRefresh(options);
            return;
        }
        refreshMediaNodes(options);
        // Autogrow 写完 link 后再认一次，只刷新解包显示
        setTimeout(() => {
            if (!isCanvasBusy()) refreshMediaNodes();
        }, 120);
    }, 30);
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
        queueRefresh({ stripLegacy: true });
    });
    wrapNodeMethod(nodeTypeClass, "onConfigure", function () {
        stripLegacyPackInputs(this);
        queueRefresh({ stripLegacy: true });
    });
    wrapNodeMethod(nodeTypeClass, "onConnectionsChange", function () {
        // 只驱动解包刷新，绝不改打包口上的线
        queueRefresh();
    });
}

function hookGraphConnections() {
    const LGraph = app.graph?.constructor || globalThis.LiteGraph?.LGraph;
    if (!LGraph?.prototype || LGraph.prototype.__h3CzMediaConnHooked) return;
    const original = LGraph.prototype.connectionChange;
    LGraph.prototype.connectionChange = function (...args) {
        const result = typeof original === "function" ? original.apply(this, args) : undefined;
        queueRefresh();
        return result;
    };
    LGraph.prototype.__h3CzMediaConnHooked = true;
}

app.__h3CzSyncUnpackOutputs = () => refreshMediaNodes();

app.registerExtension({
    name: "CZToolkit.H3Media.UI",

    async setup() {
        hookGraphConnections();
        hookGraphToPrompt();
        app.api?.addEventListener?.("graphLoaded", () => queueRefresh({ stripLegacy: true }));
        queueRefresh({ stripLegacy: true });
    },

    nodeCreated(node) {
        if (isSetNode(node) || isGetNode(node)) {
            hookTunnelWidgets(node);
            queueRefresh();
            return;
        }
        if (isPackNode(node) || isUnpackNode(node)) queueRefresh({ stripLegacy: true });
    },

    loadedGraphNode(node) {
        if (isSetNode(node) || isGetNode(node)) {
            hookTunnelWidgets(node);
            queueRefresh();
            return;
        }
        if (isPackNode(node) || isUnpackNode(node)) queueRefresh({ stripLegacy: true });
    },

    async beforeRegisterNodeDef(nodeTypeClass, nodeData) {
        const type = String(nodeData?.name || "");
        if (type === PACK_NODE) wrapPackHooks(nodeTypeClass);
        if (type === UNPACK_NODE) {
            wrapNodeMethod(nodeTypeClass, "onNodeCreated", function () {
                const keep = new Set(FIXED_UNPACK_OUTPUTS);
                for (let i = (this.outputs?.length ?? 0) - 1; i >= 0; i--) {
                    if (!keep.has(this.outputs[i]?.name)) this.removeOutput(i);
                }
                for (const name of FIXED_UNPACK_OUTPUTS) {
                    if (!this.outputs?.some((output) => output.name === name)) {
                        this.addOutput(name, outputType(name));
                    }
                }
                queueRefresh();
            });
            wrapNodeMethod(nodeTypeClass, "onConnectionsChange", () => queueRefresh());
            wrapNodeMethod(nodeTypeClass, "onConfigure", () => queueRefresh({ stripLegacy: true }));
        }
        if (/SetNode$/i.test(type) || /GetNode$/i.test(type)) {
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

console.log("[CZ-Toolkit] H3 Media UI loaded");
