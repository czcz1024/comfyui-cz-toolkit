import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const NODE_TYPE = "CzH3PromptFormatter";
const PACK_NODE = "CzH3ReferenceMedia";
const FORM_WIDGET = "form_state";
const PROMPT_WIDGET = "prompt";
const PACK_JSON_WIDGET = "prompt_pack_json";
const HIDDEN_WIDGETS = [FORM_WIDGET, PROMPT_WIDGET, PACK_JSON_WIDGET];

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

function setWidgetValue(node, target, value) {
  if (!target) return;
  if (String(target.value ?? "") === String(value)) return;
  target.value = value;
  target.callback?.(value);
  const index = node.widgets?.indexOf(target) ?? -1;
  if (index >= 0) {
    node.widgets_values ??= [];
    node.widgets_values[index] = value;
  }
}

function hideWidget(target) {
  if (!target || target.__h3FmtHidden) return;
  target.__h3FmtHidden = true;
  target.hidden = true;
  target.origType ??= target.type;
  target.origComputeSize ??= target.computeSize;
  // Comfy / LiteGraph：转为 converted-widget 后不再画 name 与控件
  target.type = "converted-widget";
  target.computeSize = () => [0, -4];
  // 禁止画布再画标签（部分 FLOAT 仍会画 name）
  if (typeof target.draw === "function") {
    target.origDraw ??= target.draw;
    target.draw = () => {};
  }
  const element = target.inputEl || target.element || target.domElement || target.inputElement;
  if (element?.style) {
    element.style.display = "none";
    element.style.height = "0";
    element.style.overflow = "hidden";
  }
  // FLOAT 等可能带联动控件
  if (Array.isArray(target.linkedWidgets)) {
    for (const linked of target.linkedWidgets) hideWidget(linked);
  }
}

function graphOf(node) {
  return node?.graph
    || app.canvas?.getCurrentGraph?.()
    || app.canvas?.graph
    || app.graph
    || null;
}

function graphLinks(graph) {
  const g = graph || app.canvas?.graph || app.graph;
  if (!g) return [];
  if (Array.isArray(g.links)) return g.links.filter(Boolean);
  if (g.links && typeof g.links === "object") return Object.values(g.links).filter(Boolean);
  return [];
}

function graphNode(graph, id) {
  if (id == null) return null;
  const g = graph || app.canvas?.graph || app.graph;
  if (!g) return null;
  if (typeof g.getNodeById === "function") return g.getNodeById(id) || null;
  const nodes = Array.isArray(g._nodes) ? g._nodes : Array.isArray(g.nodes) ? g.nodes : [];
  return nodes.find((n) => String(n.id) === String(id)) || null;
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

function graphLink(graph, linkRef) {
  if (linkRef == null) return null;
  const g = graph || app.canvas?.graph || app.graph;
  if (!g) return null;
  if (typeof g.getLink === "function") {
    try {
      return g.getLink(linkRef) || null;
    } catch (_) { /* ignore */ }
  }
  const links = graphLinks(g);
  return links.find((l) => String(l?.id ?? l?.[0]) === String(linkRef)) || null;
}

function inputLeafName(input) {
  const name = String(input?.name || "");
  const leaf = name.includes(".") ? name.split(".").pop() : name;
  return leaf || name;
}

function findInput(node, name) {
  return (node?.inputs || []).find((input) => {
    const full = String(input?.name || "");
    const leaf = inputLeafName(input);
    return full === name || leaf === name;
  }) || null;
}

function inputLinkId(input) {
  if (!input) return null;
  const pick = (id) => (id != null && id !== -1 ? id : null);
  if (input.link != null) return pick(input.link);
  const links = input.links;
  if (links == null) return null;
  if (Array.isArray(links)) {
    for (const id of links) {
      const got = pick(id);
      if (got != null) return got;
    }
    return null;
  }
  if (links instanceof Set || links instanceof Map) {
    for (const id of links.values()) {
      const got = pick(id);
      if (got != null) return got;
    }
    return null;
  }
  if (typeof links?.[Symbol.iterator] === "function" && typeof links !== "string") {
    for (const id of links) {
      const got = pick(id);
      if (got != null) return got;
    }
    return null;
  }
  return pick(links);
}

function originNode(node, inputName) {
  const graph = graphOf(node);
  const input = typeof inputName === "string" ? findInput(node, inputName) : inputName;
  if (!input || !node) return null;

  const linkRef = inputLinkId(input);
  let link = graphLink(graph, linkRef);

  // 禁止「仅按下标」认线：空的 first_frame 在槽位压缩后容易把尾帧的线误认成首帧
  if (!link && graph) {
    const leaf = inputLeafName(input);
    link = graphLinks(graph).find((candidate) => {
      if (String(targetId(candidate)) !== String(node.id)) return false;
      const rawSlot = targetSlotValue(candidate);
      if (String(rawSlot) === String(input.name) || String(rawSlot) === String(leaf)) return true;
      // 仅当本口自己挂着这条 link id 时，才允许用下标对齐
      if (linkRef != null && String(candidate?.id ?? candidate?.[0]) === String(linkRef)) {
        const inputIndex = node.inputs?.indexOf(input);
        return Number(rawSlot) === inputIndex;
      }
      return false;
    }) || null;
  }

  return link ? graphNode(graph, originId(link)) : null;
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
  const item = (node?.widgets || []).find((w) => /^(Constant|constant)$/i.test(w.name));
  return String(item?.value ?? "").trim();
}

function findSetterForGet(getNode) {
  if (typeof getNode?.findSetter === "function") {
    try {
      const setter = getNode.findSetter(graphOf(getNode));
      if (setter) return setter;
    } catch (_) { /* ignore */ }
  }
  const name = tunnelName(getNode);
  if (!name) return null;
  return graphNodes(graphOf(getNode)).find((n) => isSetNode(n) && tunnelName(n) === name) || null;
}

function firstUpstream(node) {
  for (const input of node?.inputs || []) {
    const origin = originNode(node, input.name);
    if (origin) return origin;
  }
  return null;
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function leafToSlotName(leaf) {
  const name = String(leaf || "");
  if (name === "first_frame" || name === "首帧图") return "first_frame";
  if (name === "last_frame" || name === "尾帧图") return "last_frame";
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

/** 一条连线只归属一个输入口：优先「谁挂着这条 link id」 */
function resolveLinkTargetInput(pack, link) {
  if (!pack || !link) return null;
  const linkId = link?.id ?? link?.[0];
  const byOwner = (pack.inputs || []).find((input) => {
    const owned = inputLinkId(input);
    return owned != null && String(owned) === String(linkId);
  });
  if (byOwner) return byOwner;

  const rawSlot = targetSlotValue(link);
  if (rawSlot != null && rawSlot !== "") {
    const asName = String(rawSlot);
    const looksNumeric = /^\d+$/.test(asName);
    if (!looksNumeric) {
      const byName = findInput(pack, asName) || findInput(pack, inputLeafName(asName));
      if (byName) return byName;
      const slot = leafToSlotName(inputLeafName(asName));
      if (slot) {
        const found = (pack.inputs || []).find((inp) => leafToSlotName(inputLeafName(inp)) === slot);
        if (found) return found;
      }
    }
  }

  const idx = Number(rawSlot);
  if (Number.isFinite(idx) && pack.inputs?.[idx]) {
    const input = pack.inputs[idx];
    const owned = inputLinkId(input);
    // 必须本口已经挂着这条 link —— 空的首帧/尾帧口不得按下标抢 ref 的线
    if (owned != null && String(owned) === String(linkId)) return input;
  }
  return null;
}

function collectPackWires(pack) {
  const graph = graphOf(pack);
  const bySlot = new Map();
  const claim = (slot, input, origin) => {
    if (!slot || !origin || bySlot.has(slot)) return;
    bySlot.set(slot, { slot, input, origin });
  };

  for (const link of graphLinks(graph)) {
    if (String(targetId(link)) !== String(pack.id)) continue;
    const input = resolveLinkTargetInput(pack, link);
    if (!input) continue;
    const slot = leafToSlotName(inputLeafName(input));
    if (!slot) continue;
    const origin = graphNode(graph, originId(link));
    if (origin) claim(slot, input, origin);
  }

  for (const input of pack.inputs || []) {
    const slot = leafToSlotName(inputLeafName(input));
    if (!slot || bySlot.has(slot)) continue;
    const linkRef = inputLinkId(input);
    if (linkRef == null) continue;
    const link = graphLink(graph, linkRef);
    if (!link) continue;
    const origin = graphNode(graph, originId(link));
    if (origin) claim(slot, input, origin);
  }

  return bySlot;
}

function slotsByPrefix(wires, prefix) {
  const re = new RegExp(`^${escapeRegExp(prefix)}(\\d+)$`);
  return [...wires.entries()]
    .map(([slot, entry]) => {
      const match = slot.match(re);
      return match ? { ...entry, index: Number(match[1]) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.index - b.index);
}

function walkUpstream(node, visited = new Set()) {
  if (!node || visited.has(String(node.id))) return node;
  visited.add(String(node.id));
  if (isPackNode(node)) return node;
  if (/reroute/i.test(nodeClass(node)) && node.inputs?.[0]) {
    return walkUpstream(originNode(node, node.inputs[0].name), visited);
  }
  if (isGetNode(node)) return walkUpstream(findSetterForGet(node), visited);
  if (isSetNode(node)) return walkUpstream(firstUpstream(node), visited);
  for (const name of ["素材包", "media_bundle", "参考素材"]) {
    if (findInput(node, name)) return walkUpstream(originNode(node, name), visited);
  }
  return node;
}

function findPackNode(start) {
  for (const name of ["media_bundle", "素材包", "参考素材"]) {
    const origin = originNode(start, name);
    if (origin) return walkUpstream(origin, new Set());
  }
  return null;
}

function viewUrl(path) {
  if (typeof api.apiURL === "function") return api.apiURL(path);
  if (typeof api.apiURL === "string" && api.apiURL) return `${api.apiURL.replace(/\/$/, "")}${path}`;
  return path;
}

function isLoadImageNode(node) {
  return nodeClass(node) === "LoadImage" || String(node?.comfyClass || "") === "LoadImage";
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

function previewSourceKey(origin) {
  const source = upstreamPreviewNode(origin);
  if (!source) return "";
  const output = app.nodeOutputs?.[String(source.id)]?.images;
  const file = Array.isArray(output) && output.length ? output[0] : null;
  if (file?.filename) {
    return `exec:${source.id}:${file.type || "output"}:${file.subfolder || ""}:${file.filename}`;
  }
  if (isLoadImageNode(source)) {
    const imageWidget = source.widgets?.find((item) => item?.name === "image") || source.widgets?.[0];
    const filename = String(imageWidget?.value || source.widgets_values?.[0] || "").trim();
    return filename ? `load:${filename}` : "";
  }
  const image = source.imgs?.[0] || source.images?.[0];
  if (typeof image === "string") return `img:${image.slice(0, 120)}`;
  if (image?.src) return `img:${image.src.slice(0, 120)}`;
  return `node:${source.id}`;
}

function previewUrlFromKey(filename, type, subfolder) {
  const params = new URLSearchParams({ filename, type: type || "output", rand: String(Date.now()) });
  if (subfolder) params.set("subfolder", subfolder);
  return `${viewUrl("/view")}?${params.toString()}`;
}

function firstPreview(origin) {
  const source = upstreamPreviewNode(origin);
  const output = app.nodeOutputs?.[String(source?.id)]?.images;
  const file = Array.isArray(output) && output.length ? output[0] : null;
  if (file?.filename) {
    return previewUrlFromKey(file.filename, file.type || "output", file.subfolder);
  }
  const imageWidget = source?.widgets?.find((item) => item?.name === "image") || source?.widgets?.[0];
  const filename = String(imageWidget?.value || source?.widgets_values?.[0] || "").trim();
  if (filename && isLoadImageNode(source)) {
    return previewUrlFromKey(filename, "input", "");
  }
  const image = source?.imgs?.[0] || source?.images?.[0];
  if (typeof image === "string") return image;
  return image?.src || image?.currentSrc || "";
}

function packManifest(pack) {
  if (!pack || !isPackNode(pack)) return { version: 1, target: "", mode: "T2VA", items: [] };
  const type = nodeClass(pack);
  const wires = collectPackWires(pack);
  const items = [];

  const images = slotsByPrefix(wires, "ref_image_");
  const videos = slotsByPrefix(wires, "ref_video_");
  const soundtracks = slotsByPrefix(wires, "ref_video_audio_");
  const audios = slotsByPrefix(wires, "ref_audio_");
  const hasRef = images.length || videos.length || soundtracks.length || audios.length;

  if (hasRef) {
    images.forEach((entry, idx) => {
      const index = idx + 1;
      items.push({
        kind: "Picture", index, token: `<Picture ${index}>`,
        label: `参考图${index}`, source_input: entry.slot || entry.input?.name || `ref_image_${entry.index}`,
        src: firstPreview(entry.origin), previewKey: previewSourceKey(entry.origin),
      });
    });
    const soundtrackBySlot = new Map(soundtracks.map((entry) => [entry.index, entry]));
    videos.forEach((entry, idx) => {
      const index = idx + 1;
      const soundtrack = soundtrackBySlot.get(entry.index);
      if (soundtrack) {
        items.push({
          kind: "Audio", index, token: `<Audio ${index}>`,
          label: `参考视频${index}音轨`,
          source_input: soundtrack.slot || soundtrack.input?.name || `ref_video_audio_${soundtrack.index}`,
          src: "", previewKey: "",
        });
        soundtrackBySlot.delete(entry.index);
      }
      items.push({
        kind: "Video", index, token: `<Video ${index}>`,
        label: `参考视频${index}`,
        source_input: entry.slot || entry.input?.name || `ref_video_${entry.index}`,
        src: firstPreview(entry.origin), previewKey: previewSourceKey(entry.origin),
      });
    });
    [...soundtrackBySlot.values()].sort((a, b) => a.index - b.index).forEach((entry, idx) => {
      const index = videos.length + idx + 1;
      items.push({
        kind: "Audio", index, token: `<Audio ${index}>`,
        label: `参考视频${index}音轨`,
        source_input: entry.slot || entry.input?.name || `ref_video_audio_${entry.index}`,
        src: "", previewKey: "",
      });
    });
    audios.forEach((entry, idx) => {
      const index = idx + 1;
      items.push({
        kind: "Audio", index, token: `<Audio ${index}>`,
        label: `参考音频${index}`,
        source_input: entry.slot || entry.input?.name || `ref_audio_${entry.index}`,
        src: "", previewKey: "",
      });
    });
    const mode = "Ref2VA";
    return { version: 1, target: type, mode, items };
  }

  const first = wires.get("first_frame");
  const last = wires.get("last_frame");
  if (first) {
    items.push({
      kind: "Picture", index: 1, token: "<Picture 1>", label: "首帧", source_input: "first_frame",
      src: firstPreview(first.origin), previewKey: previewSourceKey(first.origin),
    });
  }
  if (last) {
    const index = first ? 2 : 1;
    items.push({
      kind: "Picture", index, token: `<Picture ${index}>`, label: "尾帧", source_input: "last_frame",
      src: firstPreview(last.origin), previewKey: previewSourceKey(last.origin),
    });
  }
  const mode = first && last ? "FL2VA" : first ? "I2VA" : last ? "L2VA" : "T2VA";
  return { version: 1, target: type, mode, items };
}

function serializableManifest(manifest) {
  return {
    version: 1,
    target: manifest.target,
    mode: manifest.mode,
    items: (manifest.items || []).map(({ src, previewKey, ...item }) => item),
  };
}

function formatterIframeUrl() {
  try {
    return new URL("../h3-formatter/index.html?embed=1", import.meta.url).href;
  } catch (_) {
    return "/extensions/ComfyUI-CZ-Toolkit/h3-formatter/index.html?embed=1";
  }
}

function postToIframe(st, payload) {
  const win = st?.iframe?.contentWindow;
  if (!win) return;
  win.postMessage({ type: "h3-formatter-parent", ...payload }, "*");
}

function syncBundleToIframe(node, { autoImport = false, force = false } = {}) {
  const st = node.__h3FmtState;
  if (!st?.ready) return;
  const pack = findPackNode(node);
  if (!pack || !isPackNode(pack)) {
    // 仅更新「未连接」状态；不自动清卡（要点「识别」才同步）
    postToIframe(st, { action: "setBundle", autoImport: false, bundle: null });
    st.bundleKey = "";
    return;
  }
  const manifest = serializableManifest(packManifest(pack));
  const key = JSON.stringify(manifest);
  if (!force && key === st.bundleKey && !autoImport) return;
  st.bundleKey = key;
  postToIframe(st, {
    action: "setBundle",
    autoImport: Boolean(autoImport),
    bundle: {
      mode_hint: manifest.mode || "",
      manifest,
    },
  });
}

function applySyncFromIframe(node, data) {
  if (!data || data.type !== "h3-formatter-sync") return;
  const formW = widget(node, FORM_WIDGET);
  const promptW = widget(node, PROMPT_WIDGET);
  const packW = widget(node, PACK_JSON_WIDGET);
  if (typeof data.form_state === "string") setWidgetValue(node, formW, data.form_state);
  if (typeof data.prompt === "string") setWidgetValue(node, promptW, data.prompt);
  if (typeof data.prompt_pack_json === "string") setWidgetValue(node, packW, data.prompt_pack_json);
}

function onIframeMessage(event) {
  const data = event?.data;
  if (!data || typeof data !== "object") return;
  const nodes = graphNodes(app.canvas?.graph || app.graph);
  for (const node of nodes) {
    const st = node.__h3FmtState;
    if (!st?.iframe || event.source !== st.iframe.contentWindow) continue;
    if (data.type === "h3-formatter-ready") {
      st.ready = true;
      const formW = widget(node, FORM_WIDGET);
      const raw = String(formW?.value || "").trim();
      if (raw && raw !== "{}") {
        postToIframe(st, { action: "setState", form_state: raw });
      }
      syncBundleToIframe(node, { force: true, autoImport: false });
      return;
    }
    if (data.type === "h3-formatter-request-import") {
      // 仅按钮「识别」触发真正同步引用卡 / 模式
      syncBundleToIframe(node, { force: true, autoImport: true });
      return;
    }
    if (data.type === "h3-formatter-sync") {
      applySyncFromIframe(node, data);
      return;
    }
  }
}

function setupNode(node) {
  if (String(node?.comfyClass || node?.type || "") !== NODE_TYPE || node.__h3FmtState) return;
  if (!node.addDOMWidget) return;

  HIDDEN_WIDGETS.forEach((name) => hideWidget(widget(node, name)));

  // 隐藏后立刻重算节点高度，避免标签仍占位叠在 DOM 面板上
  try {
    node.setSize?.(node.computeSize?.() || node.size);
  } catch (_) { /* ignore */ }

  const container = document.createElement("div");
  Object.assign(container.style, {
    width: "100%",
    height: "100%",
    minHeight: "640px",
    boxSizing: "border-box",
    overflow: "hidden",
    borderRadius: "8px",
    border: "1px solid #30384a",
    background: "#11141b",
  });

  const iframe = document.createElement("iframe");
  iframe.src = formatterIframeUrl();
  iframe.title = "H3 提示词排版台";
  Object.assign(iframe.style, {
    width: "100%",
    height: "100%",
    minHeight: "640px",
    border: "0",
    display: "block",
    background: "#11141b",
  });
  iframe.setAttribute("allow", "clipboard-read; clipboard-write");
  container.appendChild(iframe);

  node.__h3FmtState = {
    container,
    iframe,
    ready: false,
    bundleKey: "",
  };

  const domWidget = node.addDOMWidget("h3_prompt_formatter_panel", "H3_PROMPT_FORMATTER", container, {
    serialize: false,
    hideOnZoom: false,
    getValue: () => String(widget(node, FORM_WIDGET)?.value || "{}"),
    setValue: () => {},
    getMinHeight: () => 640,
  });
  if (domWidget) {
    domWidget.options ??= {};
    domWidget.options.minNodeSize = [720, 720];
  }

  // DOM 面板加上后再藏一次，防止 Comfy 重建 FLOAT 标签
  HIDDEN_WIDGETS.forEach((name) => {
    const w = widget(node, name);
    if (w) {
      w.__h3FmtHidden = false;
      hideWidget(w);
    }
  });
  try {
    node.setSize?.(node.computeSize?.() || node.size);
  } catch (_) { /* ignore */ }

  ["pointerdown", "pointermove", "dblclick", "wheel"].forEach((name) =>
    container.addEventListener(name, (event) => event.stopPropagation())
  );

  node.setSize?.([
    Math.max(Number(node.size?.[0]) || 0, 780),
    Math.max(Number(node.size?.[1]) || 0, 760),
  ]);
}

function refreshFormatterNodes() {
  const graph = app.canvas?.graph || app.graph;
  for (const node of graphNodes(graph)) {
    if (nodeClass(node) !== NODE_TYPE || !node.__h3FmtState) continue;
    // 接线变化只刷新「已连接」状态，不自动改引用卡 / 模式
    syncBundleToIframe(node, { force: true, autoImport: false });
  }
}

if (!window.__h3FmtMessageBound) {
  window.__h3FmtMessageBound = true;
  window.addEventListener("message", onIframeMessage);
}

app.registerExtension({
  name: "CZToolkit.H3PromptFormatter.UI",
  nodeCreated(node) {
    if (String(node?.comfyClass || node?.type || "") === NODE_TYPE) {
      setTimeout(() => setupNode(node), 20);
    }
  },
  loadedGraphNode(node) {
    if (String(node?.comfyClass || node?.type || "") === NODE_TYPE) {
      setTimeout(() => setupNode(node), 60);
    }
  },
  async beforeRegisterNodeDef(nodeTypeClass, nodeData) {
    const type = String(nodeData?.name || "");
    if (type !== NODE_TYPE) return;

    const created = nodeTypeClass.prototype.onNodeCreated;
    nodeTypeClass.prototype.onNodeCreated = function () {
      const result = created?.apply(this, arguments);
      setTimeout(() => setupNode(this), 20);
      return result;
    };

    const serialized = nodeTypeClass.prototype.onSerialize;
    nodeTypeClass.prototype.onSerialize = function () {
      return serialized?.apply(this, arguments);
    };

    const configured = nodeTypeClass.prototype.onConfigure;
    nodeTypeClass.prototype.onConfigure = function () {
      const result = configured?.apply(this, arguments);
      const st = this.__h3FmtState;
      if (st?.ready) {
        const formW = widget(this, FORM_WIDGET);
        postToIframe(st, { action: "setState", form_state: String(formW?.value || "{}") });
        syncBundleToIframe(this, { force: true });
      } else {
        setTimeout(() => setupNode(this), 40);
      }
      return result;
    };

    const connectionsChange = nodeTypeClass.prototype.onConnectionsChange;
    nodeTypeClass.prototype.onConnectionsChange = function () {
      const result = connectionsChange?.apply(this, arguments);
      setTimeout(() => syncBundleToIframe(this, { force: true, autoImport: false }), 30);
      return result;
    };
  },
});

// 素材节点改接线后只刷新「已连接」提示（要点排版台「识别」才改卡）
app.registerExtension({
  name: "CZToolkit.H3PromptFormatter.BundleWatch",
  nodeCreated() {
    setTimeout(refreshFormatterNodes, 200);
  },
  async beforeRegisterNodeDef(nodeTypeClass, nodeData) {
    const type = String(nodeData?.name || "");
    if (type !== PACK_NODE && !String(nodeData?.display_name || "").includes("参考素材")) return;
    const connectionsChange = nodeTypeClass.prototype.onConnectionsChange;
    nodeTypeClass.prototype.onConnectionsChange = function () {
      const result = connectionsChange?.apply(this, arguments);
      setTimeout(refreshFormatterNodes, 40);
      return result;
    };
  },
});
