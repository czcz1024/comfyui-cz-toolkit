import { app } from "../../../scripts/app.js";

const PACK_NODE = "H3ReferenceMedia";
const UNPACK_NODE = "H3MediaUnpack";
const PROMPT_NODE = "H3PromptBox";
const MANIFEST_WIDGET = "素材清单";

const LEGACY_REF_PATTERN = /^(参考图\d+|参考视频\d+|参考视频音轨\d+|参考音频\d+)$/;
const FIXED_UNPACK_OUTPUTS = ["first_frame", "last_frame"];

const OUTPUT_ORDER = [
    "first_frame",
    "last_frame",
    ...Array.from({ length: 9 }, (_, i) => `ref_image_${i}`),
    ...Array.from({ length: 3 }, (_, i) => `ref_video_${i}`),
    ...Array.from({ length: 3 }, (_, i) => `ref_video_audio_${i}`),
    ...Array.from({ length: 3 }, (_, i) => `ref_audio_${i}`),
];

const OUTPUT_TYPE = {
    first_frame: "IMAGE",
    last_frame: "IMAGE",
};

function outputType(name) {
    if (OUTPUT_TYPE[name]) return OUTPUT_TYPE[name];
    if (name.includes("audio")) return "AUDIO";
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
    if (id == null) return null;
    if (typeof id === "object") return id;
    if (graph?.links instanceof Map) return graph.links.get(id) || graph.links.get(String(id)) || null;
    const links = graph?.links;
    const list = links instanceof Map ? [...links.values()] : Array.isArray(links) ? links : Object.values(links || {});
    return graph?.links?.[id] || list.find((link) => String(link?.id) === String(id)) || null;
}

function graphNode(graph, id) {
    if (id == null) return null;
    return graph?.getNodeById?.(id)
        || graph?.nodes?.find?.((node) => String(node?.id) === String(id))
        || null;
}

function originId(link) {
    return link?.origin_id ?? link?.originId ?? link?.[1] ?? null;
}

function inputLeafName(name) {
    return String(name || "").split(".").pop();
}

function findInput(node, name) {
    return node?.inputs?.find((input) => inputLeafName(input.name) === name || input.name === name) || null;
}

function inputLinkId(input) {
    if (!input) return null;
    if (input.link != null) return input.link;
    const links = input.links;
    if (Array.isArray(links)) return links[0] ?? null;
    return links ?? null;
}

function originNode(node, inputName) {
    const graph = graphOf(node);
    const input = findInput(node, inputName);
    const link = graphLink(graph, inputLinkId(input));
    return link ? graphNode(graph, originId(link)) : null;
}

function connectedInput(node, name) {
    return Boolean(originNode(node, name));
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
            return connectedInput(node, input.name) ? Number(match[1]) : null;
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
    for (let i = 0; i < 3; i++) {
        const hasVideo = refVideos.includes(i);
        const hasAudio = refVideoAudios.includes(i);
        if (!hasVideo && !hasAudio) break;
        if (hasVideo) names.push(`ref_video_${i}`);
        if (hasAudio) names.push(`ref_video_audio_${i}`);
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

function sortOutputNames(names) {
    const order = new Map(OUTPUT_ORDER.map((name, index) => [name, index]));
    return [...new Set(names)].sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999));
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
    return sortOutputNames(desired);
}

function outputHasLinks(output) {
    const links = output?.links;
    if (links == null) return false;
    if (Array.isArray(links)) return links.length > 0;
    if (typeof links === "object") return Object.keys(links).length > 0;
    return Boolean(links);
}

function syncUnpackNodeOutputs(node) {
    if (!isUnpackNode(node)) return;
    const desired = desiredUnpackOutputs(node);

    for (let i = (node.outputs?.length ?? 0) - 1; i >= 0; i--) {
        const output = node.outputs[i];
        if (desired.includes(output.name)) continue;
        if (!outputHasLinks(output)) node.removeOutput(i);
    }

    for (const name of desired) {
        if (!node.outputs?.some((output) => output.name === name)) {
            node.addOutput(name, outputType(name));
        }
    }

    if (node.outputs?.length) {
        const order = new Map(desired.map((name, index) => [name, index]));
        node.outputs.sort((a, b) => (order.get(a.name) ?? 999) - (order.get(b.name) ?? 999));
    }

    node.setDirtyCanvas?.(true, true);
}

function refreshMediaNodes() {
    const graph = app.canvas?.graph || app.graph;
    for (const node of graph?._nodes || graph?.nodes || []) {
        if (isPackNode(node)) stripLegacyPackInputs(node);
        if (isUnpackNode(node)) syncUnpackNodeOutputs(node);
    }
}

function wrapPackHooks(nodeTypeClass) {
    const wrap = (method) => {
        const original = nodeTypeClass.prototype[method];
        if (!original || original.__h3CzMediaUiWrapped) return;
        nodeTypeClass.prototype[method] = function (...args) {
            const result = original.apply(this, args);
            stripLegacyPackInputs(this);
            refreshMediaNodes();
            requestAnimationFrame(() => {
                stripLegacyPackInputs(this);
                refreshMediaNodes();
            });
            return result;
        };
        nodeTypeClass.prototype[method].__h3CzMediaUiWrapped = true;
    };
    wrap("onNodeCreated");
    wrap("onConfigure");
    wrap("onConnectionsChange");
}

app.__h3CzStripLegacyPackInputs = refreshMediaNodes;
app.__h3CzSyncUnpackOutputs = refreshMediaNodes;

app.registerExtension({
    name: "CZToolkit.H3Media.UI",

    async setup() {
        app.api?.addEventListener?.("graphLoaded", () => refreshMediaNodes());
    },

    nodeCreated(node) {
        if (isPackNode(node) || isUnpackNode(node)) refreshMediaNodes();
    },

    loadedGraphNode(node) {
        if (isPackNode(node) || isUnpackNode(node)) refreshMediaNodes();
    },

    async beforeRegisterNodeDef(nodeTypeClass, nodeData) {
        const type = String(nodeData?.name || "");
        if (type === PACK_NODE) wrapPackHooks(nodeTypeClass);
        if (type === UNPACK_NODE) {
            const wrap = (method) => {
                const original = nodeTypeClass.prototype[method];
                if (!original || original.__h3CzMediaUiWrapped) return;
                nodeTypeClass.prototype[method] = function (...args) {
                    const result = original.apply(this, args);
                    refreshMediaNodes();
                    return result;
                };
                nodeTypeClass.prototype[method].__h3CzMediaUiWrapped = true;
            };
            wrap("onConnectionsChange");
            wrap("onConfigure");
        }
    },
});

console.log("[CZ-Toolkit] H3 Media UI loaded");
