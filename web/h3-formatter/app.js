/**
 * H3 提示词排版台 · HTML Lab
 * - 模式：T2VA / I2VA / FL2VA / L2VA / Ref2VA
 * - Ref：先定义引用(Picture/Video/Audio)，再定义 Subject（绑定 / @）
 * - 分镜：画面、运镜、对白、画内声等字段 → 排版成官方句式
 */

const STORAGE_KEY = "h3-prompt-formatter-lab-v5";
const IS_EMBED = (() => {
  try {
    return new URLSearchParams(location.search).has("embed") || window.parent !== window;
  } catch (_) {
    return false;
  }
})();
if (IS_EMBED) document.documentElement.classList.add("embed");

let __comfySyncTimer = null;
function notifyComfyParent() {
  if (!IS_EMBED) return;
  clearTimeout(__comfySyncTimer);
  __comfySyncTimer = setTimeout(() => {
    try {
      const out = buildFormatterOutput(state);
      const formPayload = {
        ...state,
        linkedBundle: linkedBundle || null,
      };
      window.parent.postMessage(
        {
          type: "h3-formatter-sync",
          form_state: JSON.stringify(formPayload),
          duration: out.duration,
          prompt: out.prompt,
          prompt_pack_json: JSON.stringify(out.prompt_pack),
        },
        "*"
      );
    } catch (err) {
      console.warn("[h3-formatter] notifyComfy failed", err);
    }
  }, 80);
}

const MODES = [
  { id: "t2va", label: "T2VA", format: "base", hint: "纯文生 · 三字段 · 无对齐句、无参考标签。" },
  { id: "i2va", label: "I2VA", format: "base", hint: "首帧生 · 三字段 · 固定首行对齐句 · 仅 <Picture 1>。" },
  { id: "fl2va", label: "FL2VA", format: "base", hint: "首尾帧 · 三字段 · 固定对齐模板 · <Picture 1/2>。" },
  { id: "l2va", label: "L2VA", format: "base", hint: "尾帧生 · 三字段 · 固定对齐模板 · <Picture 1> 落在最后一镜。" },
  { id: "ref2va", label: "Ref2VA", format: "ref", hint: "六字段。先定义引用，再定义 Subject；改片/续拍用任务类型多选。" },
];

const TASK_TYPES = [
  { id: "keyframe completion", zh: "关键帧", group: "visual" },
  { id: "reference generation", zh: "参考生成", group: "visual" },
  { id: "video editing", zh: "视频编辑", group: "visual" },
  { id: "video continuation", zh: "视频续拍", group: "visual" },
  { id: "audio reuse", zh: "音频复用", group: "audio" },
  { id: "audio reference", zh: "音频参考", group: "audio" },
];

const BIND_ASPECTS = [
  { id: "appearance", zh: "外观/人脸", en: "appearance" },
  { id: "clothing", zh: "服装", en: "clothing" },
  { id: "motion", zh: "动作/运动", en: "motion" },
  { id: "voice", zh: "音色", en: "voice timbre" },
  { id: "scene", zh: "场景", en: "scene" },
  { id: "style", zh: "风格", en: "style" },
  { id: "other", zh: "其他", en: "features" },
];

/**
 * 引用用途：按 Picture / Video / Audio 分套（对齐官方 Ref2VA 角色）
 * standalone=true → subject_definitions / retention 单独成行
 */
const REF_ROLES = {
  picture: [
    { id: "subject_only", zh: "仅供 Subject 引用", standalone: false },
    { id: "keyframe", zh: "关键帧/构图锚点（单独成行）", standalone: true },
    { id: "storyboard", zh: "分镜/构图规划（单独成行）", standalone: true },
  ],
  video: [
    { id: "subject_only", zh: "仅供 Subject 抽取画面", standalone: false },
    { id: "source_edit", zh: "源视频·剪辑/续拍（单独成行）", standalone: true },
    { id: "structure", zh: "运镜/剪辑节奏参考（单独成行）", standalone: true },
  ],
  audio: [
    { id: "timbre", zh: "音色/语气参考（单独成行）", standalone: true },
    { id: "copy_track", zh: "音轨复制/复用（单独成行）", standalone: true },
    { id: "sfx_ambience", zh: "音效/环境声参考（单独成行）", standalone: true },
    { id: "music", zh: "配乐参考（单独成行）", standalone: true },
  ],
};

/** 旧 role → 新 role（按 kind） */
function migrateRefRole(kind, role) {
  const list = REF_ROLES[kind] || REF_ROLES.picture;
  if (list.some((o) => o.id === role)) return role;
  if (kind === "picture") {
    if (role === "source") return "keyframe";
    return "subject_only";
  }
  if (kind === "video") {
    if (role === "source" || role === "keyframe") return "source_edit";
    return "source_edit";
  }
  if (kind === "audio") {
    if (role === "source" || role === "keyframe" || role === "subject_only") return "timbre";
    return "timbre";
  }
  return list[0].id;
}

function defaultRoleForKind(kind) {
  if (kind === "video") return "source_edit";
  if (kind === "audio") return "timbre";
  return "subject_only";
}

function roleMeta(kind, roleId) {
  const list = REF_ROLES[kind] || REF_ROLES.picture;
  const id = migrateRefRole(kind, roleId);
  return list.find((o) => o.id === id) || list[0];
}

function roleOptionsHtml(kind, selected) {
  const list = REF_ROLES[kind] || REF_ROLES.picture;
  const cur = migrateRefRole(kind, selected);
  return list
    .map((o) => `<option value="${o.id}" ${o.id === cur ? "selected" : ""}>${escapeHtml(o.zh)}</option>`)
    .join("");
}

function refNotePlaceholder(kind, role) {
  const r = migrateRefRole(kind, role);
  if (kind === "audio") {
    if (r === "timbre") return "例：is the voice-timbre reference for <Subject 1> (S1).";
    if (r === "copy_track") return "例：is reused as the target video's dialogue/music track.";
    if (r === "sfx_ambience") return "例：is an ambience / SFX reference for the café scene.";
    if (r === "music") return "例：is a non-diegetic score reference.";
  }
  if (kind === "video") {
    if (r === "source_edit") return "例：is the source video being edited / continued.";
    if (r === "structure") return "例：provides camera movement and cut pacing reference.";
    return "例：provides motion / appearance for a Subject（可不单独成行）";
  }
  if (r === "keyframe") return "例：is the first-frame / last-frame / composition anchor for [Shot 1].";
  if (r === "storyboard") return "例：is a storyboard reference for [Shot 1] and [Shot 2].";
  return "例：年轻女子半身照（仅给 Subject 用）";
}

/* —— H3_MEDIA_BUNDLE → 引用卡 —— */
/** @type {null | { mode_hint: string, manifest: { version?: number, mode?: string, items: any[] } }} */
let linkedBundle = null;

function demoMediaBundle() {
  return {
    mode_hint: "Ref2VA",
    manifest: {
      version: 1,
      mode: "Ref2VA",
      items: [
        { kind: "Picture", index: 1, token: "<Picture 1>", label: "参考图1", source_input: "ref_image_0" },
        { kind: "Picture", index: 2, token: "<Picture 2>", label: "参考图2", source_input: "ref_image_1" },
        { kind: "Video", index: 1, token: "<Video 1>", label: "参考视频1", source_input: "ref_video_0" },
        { kind: "Audio", index: 1, token: "<Audio 1>", label: "参考音频1", source_input: "ref_audio_0" },
      ],
    },
  };
}

function defaultRoleFromBundleItem(item) {
  const src = String(item.source_input || "");
  const kind = String(item.kind || "").toLowerCase();
  if (kind === "picture") {
    if (src === "first_frame" || src === "last_frame" || src === "首帧图" || src === "尾帧图") return "keyframe";
    return "subject_only";
  }
  if (kind === "video") {
    return "source_edit";
  }
  if (kind === "audio") {
    if (/video_audio/i.test(src)) return "copy_track";
    return "timbre";
  }
  return defaultRoleForKind(kind);
}

function noteSeedFromBundleItem(item) {
  const label = String(item.label || "").trim();
  const kind = String(item.kind || "").toLowerCase();
  const src = String(item.source_input || "");
  const role = defaultRoleFromBundleItem(item);
  if (kind === "audio" && role === "timbre") {
    return label ? `is the voice-timbre reference (${label}).` : "is a voice-timbre reference.";
  }
  if (kind === "video" && role === "source_edit") {
    return label ? `is the source video (${label}) for editing or continuation.` : "is the source video for editing or continuation.";
  }
  if (kind === "picture" && role === "keyframe") {
    if (src === "last_frame" || src === "尾帧图") {
      return label ? `is the last-frame / end-composition anchor (${label}).` : "is the last-frame / end-composition anchor.";
    }
    if (src === "first_frame" || src === "首帧图") {
      return label ? `is the first-frame / composition anchor (${label}).` : "is the first-frame / composition anchor.";
    }
    return label ? `is a keyframe / composition anchor (${label}).` : "is a keyframe / composition anchor.";
  }
  return label ? `(from media bundle: ${label})` : "";
}

/** 统一 source_input 键，便于合并对齐 */
function normalizeSourceKey(src) {
  const s = String(src || "").trim();
  if (!s) return "";
  if (s === "首帧图" || s === "first_frame") return "first_frame";
  if (s === "尾帧图" || s === "last_frame") return "last_frame";
  let m;
  if ((m = s.match(/^参考图(\d+)$/))) return `ref_image_${Number(m[1]) - 1}`;
  if ((m = s.match(/^参考视频音轨(\d+)$/))) return `ref_video_audio_${Number(m[1]) - 1}`;
  if ((m = s.match(/^参考视频(\d+)$/))) return `ref_video_${Number(m[1]) - 1}`;
  if ((m = s.match(/^参考音频(\d+)$/))) return `ref_audio_${Number(m[1]) - 1}`;
  if ((m = s.match(/^(ref_image|ref_video_audio|ref_video|ref_audio)_(\d+)$/))) return `${m[1]}_${m[2]}`;
  return s;
}

function ensureRefModeScaffold() {
  if (!state.taskTypes.length) state.taskTypes = ["reference generation"];
  if (!state.subjects.length) {
    state.subjects = [{
      id: uid(),
      name: "",
      text: "",
      binds: [],
      retain: "fully_preserved",
      retainNote: "",
    }];
  }
}

/**
 * 根据素材包 manifest 增量合并引用卡（不整表重建）。
 * - 按 source_input 对齐：保留用户已填的 note / role / retain / retainNote
 * - 新槽位追加；断开的包内槽位对应卡删除；手加卡（无 sourceInput）一律保留
 * - 有 ref_* → 强制 Ref2VA；否则按首/尾帧判 I2VA / FL2VA / L2VA / T2VA
 */
function applyMediaBundle(bundle, { replaceMatching = true } = {}) {
  if (!bundle || !bundle.manifest) throw new Error("素材包无效：缺少 manifest");
  const items = Array.isArray(bundle.manifest.items) ? bundle.manifest.items : [];

  const hasRefAssets = items.some((it) => /^ref_/.test(normalizeSourceKey(it.source_input)));
  const hasFirst = items.some((it) => normalizeSourceKey(it.source_input) === "first_frame");
  const hasLast = items.some((it) => normalizeSourceKey(it.source_input) === "last_frame");

  // 模式：除首尾帧外只要有素材 → Ref；否则按首尾帧
  if (hasRefAssets) state.mode = "ref2va";
  else if (hasFirst && hasLast) state.mode = "fl2va";
  else if (hasFirst) state.mode = "i2va";
  else if (hasLast) state.mode = "l2va";
  else {
    const hint = String(bundle.mode_hint || bundle.manifest.mode || "").toUpperCase();
    if (hint === "REF2VA") state.mode = "ref2va";
    else if (hint === "I2VA") state.mode = "i2va";
    else if (hint === "FL2VA") state.mode = "fl2va";
    else if (hint === "L2VA") state.mode = "l2va";
    else state.mode = "t2va";
  }

  if (state.mode === "ref2va") ensureRefModeScaffold();

  const bySource = new Map();
  (state.refs || []).forEach((r) => {
    const key = normalizeSourceKey(r.sourceInput);
    if (key) bySource.set(key, r);
  });

  const activeKeys = new Set();
  let added = 0;
  let updated = 0;

  items.forEach((item) => {
    const kind = String(item.kind || "Picture").toLowerCase();
    if (!["picture", "video", "audio"].includes(kind)) return;
    const sourceInput = normalizeSourceKey(item.source_input || `${kind}_${item.index}`);
    if (!sourceInput) return;
    activeKeys.add(sourceInput);

    const existing = bySource.get(sourceInput);
    if (existing && replaceMatching) {
      // 只同步包侧元数据；用户填写一律保留
      existing.kind = kind;
      existing.bundleToken = item.token || existing.bundleToken || "";
      existing.bundleLabel = item.label || existing.bundleLabel || "";
      existing.sourceInput = sourceInput;
      if (!existing.role) existing.role = defaultRoleFromBundleItem(item);
      existing.role = migrateRefRole(kind, existing.role);
      if (!String(existing.note || "").trim()) existing.note = noteSeedFromBundleItem(item);
      if (!existing.retain) existing.retain = defaultRetainForRef(existing);
      updated += 1;
      return;
    }
    if (existing) return;

    const role = defaultRoleFromBundleItem(item);
    const ref = {
      id: uid(),
      kind,
      role,
      note: noteSeedFromBundleItem(item),
      retain: defaultRetainForRef({ kind, role }),
      retainNote: "",
      sourceInput,
      bundleToken: item.token || "",
      bundleLabel: item.label || "",
    };
    state.refs.push(ref);
    bySource.set(sourceInput, ref);
    added += 1;
  });

  // 包内曾识别、现已断开的卡 → 删掉；无 sourceInput 的手加卡保留
  let removed = 0;
  state.refs = (state.refs || []).filter((r) => {
    const key = normalizeSourceKey(r.sourceInput);
    if (!key) return true;
    if (activeKeys.has(key)) return true;
    removed += 1;
    return false;
  });

  // 清理 Subject 里指向已删引用的 binds
  if (removed && Array.isArray(state.subjects)) {
    const alive = new Set((state.refs || []).map((r) => r.id));
    state.subjects.forEach((s) => {
      if (!Array.isArray(s.binds)) return;
      s.binds = s.binds.filter((b) => !b.refId || alive.has(b.refId));
    });
  }

  const modeLabel = modeMeta(state).label;
  linkedBundle = {
    mode_hint: modeLabel,
    manifest: {
      version: bundle.manifest.version || 1,
      mode: modeLabel,
      items: items.map((it) => ({
        kind: it.kind,
        index: it.index,
        token: it.token,
        label: it.label,
        source_input: normalizeSourceKey(it.source_input) || it.source_input,
      })),
    },
  };
  return { added, updated, removed, total: items.length, mode: state.mode };
}

/** 清空所有「由素材包识别出来」的引用卡（保留手加卡） */
function clearBundleLinkedRefs() {
  const before = (state.refs || []).length;
  state.refs = (state.refs || []).filter((r) => !normalizeSourceKey(r.sourceInput));
  const removed = before - state.refs.length;
  if (removed && Array.isArray(state.subjects)) {
    const alive = new Set(state.refs.map((r) => r.id));
    state.subjects.forEach((s) => {
      if (!Array.isArray(s.binds)) return;
      s.binds = s.binds.filter((b) => !b.refId || alive.has(b.refId));
    });
  }
  linkedBundle = null;
  return { added: 0, updated: 0, removed, total: 0, mode: state.mode };
}

function renderBundleStatus() {
  const el = document.getElementById("bundle-status");
  const slot = document.getElementById("slot-media-bundle");
  if (!el) return;
  if (!linkedBundle) {
    el.textContent = IS_EMBED
      ? "未连接素材包 · 接好后点「识别」同步引用"
      : "未连接素材包（Lab 可用「加载示例包」演示）";
    el.classList.remove("has-bundle");
    if (slot) slot.classList.remove("active");
    return;
  }
  const items = linkedBundle.manifest?.items || [];
  const counts = { Picture: 0, Video: 0, Audio: 0 };
  items.forEach((it) => {
    if (counts[it.kind] != null) counts[it.kind] += 1;
  });
  el.textContent = `已连接 · ${linkedBundle.mode_hint || "?"} · 图${counts.Picture} 视频${counts.Video} 音频${counts.Audio}`;
  el.classList.add("has-bundle");
  if (slot) slot.classList.add("active");
}

const CAM_MOTIONS = [
  { zh: "固定镜头", en: "The camera holds a static shot", noAmpSpeed: true },
  { zh: "推镜 Push In", en: "The camera pushes in" },
  { zh: "拉镜 Pull Out", en: "The camera pulls out" },
  { zh: "变焦推进 Zoom In", en: "The camera zooms in" },
  { zh: "变焦拉远 Zoom Out", en: "The camera zooms out" },
  { zh: "左摇 Pan Left", en: "The camera pans left" },
  { zh: "右摇 Pan Right", en: "The camera pans right" },
  { zh: "左移 Truck Left", en: "The camera trucks left" },
  { zh: "右移 Truck Right", en: "The camera trucks right" },
  { zh: "上仰 Tilt Up", en: "The camera tilts up" },
  { zh: "下俯 Tilt Down", en: "The camera tilts down" },
  { zh: "升 Pedestal Up", en: "The camera pedestals up" },
  { zh: "降 Pedestal Down", en: "The camera pedestals down" },
  { zh: "环绕 Arc", en: "The camera moves in an arc around the subject" },
  { zh: "跟拍 Tracking", en: "The camera tracks the moving subject" },
  { zh: "轻微晃动", en: "The camera shakes slightly", noAmpSpeed: true },
  { zh: "剧烈晃动", en: "The camera shakes strongly", noAmpSpeed: true },
  { zh: "POV", en: "The camera shows a POV shot", noAmpSpeed: true },
  { zh: "顺时针翻滚", en: "The camera rolls clockwise" },
  { zh: "逆时针翻滚", en: "The camera rolls counterclockwise" },
];

const CAM_AMPS = [
  { zh: "（默认/中等）", en: "" },
  { zh: "小幅", en: "with small amplitude" },
  { zh: "大幅", en: "with large amplitude" },
];

const CAM_SPEEDS = [
  { zh: "（默认/正常）", en: "" },
  { zh: "慢速", en: "at slow speed" },
  { zh: "快速", en: "at fast speed" },
];

/** 镜内时间模板（单镜不切，控制先后） */
const TIMING_PRESETS = [
  {
    zh: "前 2 秒保持",
    en: "For the first two seconds, she holds this expression and remains still.",
  },
  {
    zh: "约 2 秒后变化",
    en: "Then, at about the two-second mark, her expression shifts.",
  },
  {
    zh: "短暂停顿后",
    en: "After a brief pause,",
  },
  {
    zh: "逐渐变化",
    en: "Her expression gradually shifts from a calm, neutral look to",
  },
  {
    zh: "保持到片尾",
    en: "She holds that expression through the final frames.",
  },
  {
    zh: "镜头固定 + 等人动",
    en: "The camera holds a static shot as she begins still, then",
  },
];

/** 风格快捷芯片 */
const STYLE_CHIPS = [
  { zh: "写实电影", en: "Live-action, cinematic" },
  { zh: "写实", en: "Live-action" },
  { zh: "2D 动画", en: "2D-animated" },
  { zh: "3D CG", en: "3D CG" },
  { zh: "黏土动画", en: "claymation" },
  { zh: "水彩", en: "watercolor" },
  { zh: "复古胶片", en: "vintage film" },
];

const LANGS = [
  { zh: "英文", en: "English" },
  { zh: "中文", en: "Chinese" },
  { zh: "日文", en: "Japanese" },
  { zh: "韩文", en: "Korean" },
  { zh: "粤语", en: "Cantonese" },
  { zh: "不明", en: "unclear" },
];

/** retention_analysis · 画面/可见内容（官方固定英文值） */
const VISUAL_RETAIN = [
  { id: "fully_preserved", zh: "强引用 · 完全保留" },
  { id: "partially_preserved", zh: "部分保留" },
  { id: "attribute_transfer", zh: "属性转移" },
  { id: "weak_reference", zh: "弱引用" },
];

/** retention_analysis · 音频 */
const AUDIO_RETAIN = [
  { id: "fully_copy", zh: "完整复制" },
  { id: "partially_copy", zh: "部分复制" },
  { id: "reference", zh: "音频参考（不复制信号）" },
  { id: "weak_reference", zh: "弱引用" },
];

const PACK_VERSION = 1;

function nullOrText(value) {
  const t = String(value ?? "").trim();
  return t ? t : null;
}

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

function emptyDialogue() {
  return {
    id: uid(),
    speaker: "",
    lang: "English",
    text: "",
    offScreen: false,
    scenetrans: false,
    cutoff: false,
  };
}

function emptyShot(start, end) {
  return {
    id: uid(),
    start,
    end,
    body: "",
  };
}

function composeBodyFromLegacy(raw) {
  const parts = [];
  const visual = String(raw.visual || raw.text || "").trim();
  const camera = String(raw.camera || "").trim();
  const diegetic = String(raw.diegeticSound || "").trim();
  const screen = String(raw.screenText || "").trim();
  if (visual) parts.push(visual);
  if (camera) parts.push(camera.endsWith(".") ? camera : camera + ".");
  if (screen) parts.push(`On-screen text reading "${screen}" is visible.`);
  if (diegetic) parts.push(diegetic.endsWith(".") ? diegetic : diegetic + ".");
  const map = new Map();
  (raw.dialogues || []).forEach((d) => {
    if (!String(d.text || "").trim()) return;
    const base = stripSpeakerSx(d.speaker) || "a speaker";
    if (!map.has(base)) map.set(base, `S${map.size + 1}`);
    const clause = buildDialogueClause(d, map);
    if (clause) parts.push(clause);
  });
  // 旧单句对白
  if (!(raw.dialogues || []).length && (raw.dialogueText || raw.dialogueSpeaker)) {
    const d = {
      ...emptyDialogue(),
      speaker: stripSpeakerSx(raw.dialogueSpeaker || ""),
      lang: raw.dialogueLang || "English",
      text: raw.dialogueText || "",
    };
    const m = new Map();
    const base = stripSpeakerSx(d.speaker) || "a speaker";
    m.set(base, "S1");
    const clause = buildDialogueClause(d, m);
    if (clause) parts.push(clause);
  }
  return parts.join(" ").trim();
}

function defaultShots() {
  const a = emptyShot(0, 3);
  a.body =
    "a medium-wide shot frames a woman by a rainy train window. The camera pushes in with small amplitude at slow speed. Rain taps the glass; distant carriage rumble. the quiet, breathy young woman (S1) says: <d>[English] I get off at the next station.</d>";
  const b = emptyShot(3, 6);
  b.body = "a close-up as she turns toward the aisle.";
  return [a, b];
}

function defaultState() {
  return {
    mode: "t2va",
    duration: 6,
    shots: defaultShots(),
    selectedShotId: null,
    refs: [],
    subjects: [],
    taskTypes: ["reference generation"],
    soundscape: "Steady rain taps against the glass. Soft carriage rumble continues underneath.",
    music: "N/A",
    summaryBody: "",
    styleOpening: "",
    collapsed: {},
  };
}

function modeMeta(state) {
  return MODES.find((m) => m.id === state.mode) || MODES[0];
}
function isRef(state) {
  return modeMeta(state).format === "ref";
}

function capitalizeKind(kind) {
  return { picture: "Picture", video: "Video", audio: "Audio", subject: "Subject" }[kind] || kind;
}

/** 按类型分别编号：Picture 1.. / Video 1.. / Audio 1.. */
function refTag(state, refId) {
  const ref = state.refs.find((r) => r.id === refId);
  if (!ref) return null;
  const same = state.refs.filter((r) => r.kind === ref.kind);
  const idx = same.findIndex((r) => r.id === refId) + 1;
  return `<${capitalizeKind(ref.kind)} ${idx}>`;
}

/** 同类型内的 1-based 序号 */
function refKindIndex(state, refId) {
  const ref = state.refs.find((r) => r.id === refId);
  if (!ref) return 0;
  const same = state.refs.filter((r) => r.kind === ref.kind);
  return same.findIndex((r) => r.id === refId) + 1;
}

/** 与 Comfy 素材包槽位的对应提示：ref_image_0 ↔ Picture 1 */
function refSlotLabel(state, refId) {
  const ref = state.refs.find((r) => r.id === refId);
  if (!ref) return "";
  const idx0 = refKindIndex(state, refId) - 1;
  const expected =
    ref.kind === "picture"
      ? `ref_image_${idx0}`
      : ref.kind === "video"
        ? `ref_video_${idx0}`
        : ref.kind === "audio"
          ? `ref_audio_${idx0}`
          : "";
  const wired = normalizeSourceKey(ref.sourceInput);
  if (wired && wired !== "first_frame" && wired !== "last_frame") {
    if (wired === expected) return wired;
    return `${wired} → 现第${idx0 + 1}（期望 ${expected}）`;
  }
  if (wired === "first_frame") return "first_frame · 首帧";
  if (wired === "last_frame") return "last_frame · 尾帧";
  return expected ? `应对接 ${expected}` : "";
}

/** 在同类型引用中上移/下移（交换位置，从而交换 Picture/Video/Audio 编号） */
function moveRefAmongKind(refId, dir) {
  const ref = state.refs.find((r) => r.id === refId);
  if (!ref) return false;
  const sameIds = state.refs.filter((r) => r.kind === ref.kind).map((r) => r.id);
  const pos = sameIds.indexOf(refId);
  const swapWith = dir < 0 ? pos - 1 : pos + 1;
  if (swapWith < 0 || swapWith >= sameIds.length) return false;
  const otherId = sameIds[swapWith];
  const i = state.refs.findIndex((r) => r.id === refId);
  const j = state.refs.findIndex((r) => r.id === otherId);
  if (i < 0 || j < 0) return false;
  const tmp = state.refs[i];
  state.refs[i] = state.refs[j];
  state.refs[j] = tmp;
  return true;
}

function subjectTag(state, subjectId) {
  const idx = state.subjects.findIndex((s) => s.id === subjectId) + 1;
  return idx > 0 ? `<Subject ${idx}>` : null;
}

function allMentionItems(state) {
  const items = [];
  state.refs.forEach((r) => {
    const tag = refTag(state, r.id);
    items.push({
      id: r.id,
      kind: r.kind,
      tag,
      label: `${tag} ${r.note ? "· " + oneLine(r.note) : ""}`,
      insert: tag,
    });
  });
  state.subjects.forEach((s) => {
    const tag = subjectTag(state, s.id);
    items.push({
      id: s.id,
      kind: "subject",
      tag,
      label: `${tag} ${s.name ? "· " + s.name : ""}`,
      insert: tag,
    });
  });
  return items;
}

function syncShotEnds(state) {
  const shots = state.shots;
  for (let i = 0; i < shots.length; i++) {
    if (i === 0) shots[i].start = 0;
    else shots[i].start = Number(shots[i - 1].end) || 0;
    if (shots[i + 1]) {
      if (Number(shots[i].end) <= Number(shots[i].start)) {
        shots[i].end = Number(shots[i].start) + 0.5;
      }
    } else {
      shots[i].end = Number(state.duration) || shots[i].end;
    }
  }
}

function formatTime(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const mm = Math.floor(s / 60);
  const rem = s - mm * 60;
  const whole = Math.floor(rem);
  const ms = Math.round((rem - whole) * 1000);
  return `${String(mm).padStart(2, "0")}:${String(whole).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

function normalizeShot(raw) {
  const base = emptyShot(0, 1);
  if (!raw || typeof raw !== "object") return base;
  let shot = { ...base, ...raw, id: raw.id || uid() };
  if (typeof shot.body === "string" && shot.body.trim()) {
    // already freeform
  } else {
    shot.body = composeBodyFromLegacy(raw);
  }
  // 清理旧字段，避免再次拼装
  delete shot.visual;
  delete shot.camera;
  delete shot.dialogues;
  delete shot.diegeticSound;
  delete shot.screenText;
  delete shot.dialogueSpeaker;
  delete shot.dialogueLang;
  delete shot.dialogueText;
  delete shot.text;
  return shot;
}

function stripSpeakerSx(s) {
  return String(s || "")
    .replace(/\s*\(S\d+\)\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 从各镜正文里收集说话人，按出现顺序编 (S1)(S2)… */
function speakerIdMap(state) {
  const map = new Map();
  const re =
    /([^.\n]+?)\s+(?:says|sings)(?:\s+in\s+an\s+off-screen\s+voiceover)?\s*:|([^.\n]+?)\s+(?:say|shout|sing)\s+together\s*,/gi;
  state.shots.forEach((shot) => {
    const body = String(shot.body || "");
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(body))) {
      const base = stripSpeakerSx(m[1] || m[2]);
      if (!base) continue;
      if (!map.has(base)) map.set(base, `S${map.size + 1}`);
    }
  });
  return map;
}

function formatSpeakerForOutput(speaker, map) {
  const base = stripSpeakerSx(speaker) || "a speaker";
  const sx = map.get(base) || "S1";
  return `${base} (${sx})`;
}

/** 合唱/齐声：两人拆开各编号，或单组短语给复合 (S1,S2) */
function formatSpeakerForTogether(speaker, map) {
  const raw = stripSpeakerSx(speaker) || "the speakers";
  const parts = raw
    .split(/\s*(?:&|\/|、|\band\b|\b和\b)\s*/i)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    const ids = parts.map((p) => {
      if (!map.has(p)) map.set(p, `S${map.size + 1}`);
      return map.get(p);
    });
    return `${parts.join(" and ")} (${ids.join(",")})`;
  }
  if (!map.has(raw)) map.set(raw, `S${map.size + 1}`);
  const a = map.get(raw);
  const bNum = Number(String(a).replace(/\D/g, "")) + 1;
  const b = `S${bNum}`;
  // 组短语占一个 map 键，显示复合 ID
  return `${raw} (${a},${b})`;
}

/** 把正文里「名字 says/sings/…together」统一成带 (Sx) 的形式 */
function applySpeakerIdsToBody(body, map) {
  let out = String(body || "");
  out = out.replace(
    /([^.\n]+?)\s+(says|sings)(\s+in\s+an\s+off-screen\s+voiceover)?\s*:/gi,
    (full, who, verb, off) => {
      const base = stripSpeakerSx(who);
      if (!base) return full;
      const sx = map.get(base) || "S1";
      return `${base} (${sx}) ${String(verb).toLowerCase()}${off || ""}:`;
    }
  );
  out = out.replace(/([^.\n]+?)\s+(say|shout|sing)\s+together\s*,/gi, (full, who, verb) => {
    const existing = String(who).match(/\(S\d+(?:,\s*S\d+)+\)/i);
    if (existing) {
      const base = stripSpeakerSx(who);
      return `${base} ${existing[0]} ${String(verb).toLowerCase()} together,`;
    }
    return `${formatSpeakerForTogether(who, map)} ${String(verb).toLowerCase()} together,`;
  });
  return out;
}

function draftRetainNoteFromBinds(state, subject) {
  const parts = (subject.binds || [])
    .map((b) => {
      const tag = refTag(state, b.refId);
      if (!tag) return null;
      return `${aspectEn(b.aspect)} from ${tag}`;
    })
    .filter(Boolean);
  if (!parts.length) return "the defined characteristics are retained.";
  const join =
    parts.length === 1 ? parts[0] : parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];
  return `${join} are retained.`;
}

/* ============================ 拼装 ============================ */

function buildAlignment(state) {
  const dur = Number(state.duration).toFixed(2);
  const lastN = Math.max(1, state.shots.length);
  switch (state.mode) {
    case "i2va":
      return "For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.";
    case "fl2va":
      return `How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot ${lastN}) aligns with the ${dur}-second mark of the target video.`;
    case "l2va":
      return `How the reference pictures align with the target video — <Picture 1> (from [Shot ${lastN}]) aligns with the ${dur}-second mark of the target video.`;
    default:
      return "";
  }
}

function aspectEn(id) {
  return BIND_ASPECTS.find((a) => a.id === id)?.en || "features";
}

function buildSubjectLine(state, subject, index) {
  const tag = `<Subject ${index + 1}>`;
  const name = String(subject.name || "").trim();
  const note = String(subject.text || "").trim();
  const binds = (subject.binds || [])
    .map((b) => {
      const rtag = refTag(state, b.refId);
      if (!rtag) return null;
      return `whose ${aspectEn(b.aspect)} comes from ${rtag}`;
    })
    .filter(Boolean);

  if (binds.length && name) {
    const join =
      binds.length === 1 ? binds[0] : binds.slice(0, -1).join(", ") + " and " + binds[binds.length - 1];
    const extra = note ? ` ${note}` : "";
    return `${tag} is the ${name} ${join}.${extra}`;
  }
  if (binds.length) {
    const join =
      binds.length === 1 ? binds[0] : binds.slice(0, -1).join(", ") + " and " + binds[binds.length - 1];
    return `${tag} is the subject ${join}.${note ? " " + note : ""}`;
  }
  if (note) return `${tag} ${note.startsWith("is ") ? note : "is " + note}`;
  if (name) return `${tag} is ${name}.`;
  return `${tag} is (请填写定义).`;
}

function isStandaloneRef(r) {
  if (!r) return false;
  if (r.standalone === true) return true;
  const meta = roleMeta(r.kind, r.role);
  return !!meta.standalone;
}

function defaultRetainForRef(r) {
  if (!r) return "fully_preserved";
  if (r.kind === "audio") {
    const role = migrateRefRole("audio", r.role);
    if (role === "copy_track") return "fully_copy";
    if (role === "music" || role === "sfx_ambience") return "reference";
    return "reference"; // timbre
  }
  if (r.kind === "video") {
    const role = migrateRefRole("video", r.role);
    if (role === "structure") return "weak_reference";
    if (role === "source_edit") return "partially_preserved";
    return "fully_preserved";
  }
  return "fully_preserved";
}

/** 分镜正文里是否出现某个官方标签 */
function shotSearchText(shot) {
  return String(shot.body || "");
}

function shotsContainingTag(state, tag) {
  if (!tag) return [];
  const re = new RegExp(tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const hits = [];
  state.shots.forEach((shot, i) => {
    if (re.test(shotSearchText(shot))) hits.push(i + 1);
  });
  return hits;
}

function formatAppearsIn(shotNums) {
  if (!shotNums.length) return "";
  return `appears in ${shotNums.map((n) => `[Shot ${n}]`).join(", ")}`;
}

/** Subject：按分镜里实际出现的 <Subject N> 自动汇总 */
function autoAppearForSubject(state, subjectIndex0) {
  const tag = `<Subject ${subjectIndex0 + 1}>`;
  const hits = shotsContainingTag(state, tag);
  if (hits.length) return formatAppearsIn(hits);
  // 尚未在分镜里写标签时，不强行猜镜号
  return "";
}

/**
 * 独立引用行：
 * - Picture 关键帧：优先「出现的第一镜 first frame」
 * - 其它：有镜号则 appears in；音频常无括号
 */
function autoAppearForRef(state, ref) {
  const tag = refTag(state, ref.id);
  const hits = shotsContainingTag(state, tag);
  const role = migrateRefRole(ref.kind, ref.role);
  if (ref.kind === "picture" && (role === "keyframe" || role === "storyboard")) {
    const n = hits[0] || 1;
    if (role === "storyboard") {
      return hits.length
        ? hits.map((n) => `[Shot ${n}]`).join(", ")
        : `[Shot ${n}]`;
    }
    return `[Shot ${n}] first frame`;
  }
  if (hits.length) return formatAppearsIn(hits);
  if (ref.kind === "video" && role === "structure") return "cut and pacing structure";
  if (ref.kind === "video" && role === "source_edit") return "source timeline";
  if (ref.kind === "audio" && role === "timbre") return "voice timbre";
  if (ref.kind === "audio" && role === "copy_track") return "copied audio";
  return "";
}

function retainOptionsHtml(kind, selected) {
  const list = kind === "audio" ? AUDIO_RETAIN : VISUAL_RETAIN;
  const cur = selected || (kind === "audio" ? "reference" : "fully_preserved");
  return list
    .map((o) => `<option value="${o.id}" ${o.id === cur ? "selected" : ""}>${escapeHtml(o.zh)} · ${o.id}</option>`)
    .join("");
}

function buildRetentionLine(tag, appear, marker, note, emptyHint) {
  const paren = String(appear || "").trim();
  const head = paren ? `${tag} (${paren})` : tag;
  const body = String(note || "").trim() || emptyHint;
  return `${head}: ${marker} - ${body}`;
}

function buildStandaloneRefLines(state) {
  const lines = [];
  state.refs.forEach((r) => {
    if (!isStandaloneRef(r)) return;
    const tag = refTag(state, r.id);
    const note = String(r.note || "").trim();
    const role = migrateRefRole(r.kind, r.role);
    if (note) {
      lines.push(`${tag} ${note.startsWith("is ") ? note : "is " + note}`);
      return;
    }
    if (r.kind === "video" && role === "source_edit") {
      lines.push(`${tag} is the source video for editing or continuation.`);
    } else if (r.kind === "video" && role === "structure") {
      lines.push(`${tag} provides camera movement and cut-pacing reference.`);
    } else if (r.kind === "audio" && role === "timbre") {
      lines.push(`${tag} is a voice-timbre reference for a target speaker (bind to Subject / Sx in the note).`);
    } else if (r.kind === "audio" && role === "copy_track") {
      lines.push(`${tag} is an audio track to be copied or partially reused.`);
    } else if (r.kind === "audio" && role === "sfx_ambience") {
      lines.push(`${tag} is an ambience / sound-effect reference.`);
    } else if (r.kind === "audio" && role === "music") {
      lines.push(`${tag} is a music / score reference.`);
    } else if (r.kind === "picture" && role === "keyframe") {
      lines.push(`${tag} is a keyframe / composition anchor.`);
    } else if (r.kind === "picture" && role === "storyboard") {
      lines.push(`${tag} is a storyboard reference for shot planning.`);
    } else {
      lines.push(`${tag} is (请填写定义).`);
    }
  });
  return lines;
}

function buildDefsBlock(state) {
  const subj = state.subjects.map((s, i) => buildSubjectLine(state, s, i));
  const refs = buildStandaloneRefLines(state);
  // 官方：Subject 定义行通常在素材定义相关说明里；这里 Subject 在前，独立 ref 在后
  const all = [...subj, ...refs].filter(Boolean);
  return all.length ? all.join("\n") : "(none)";
}

function selectedTaskTypes(state) {
  const list = (state.taskTypes || []).filter(Boolean);
  return list.length ? list : ["reference generation"];
}

function buildSummary(state) {
  const types = selectedTaskTypes(state);
  const prefix = `[${types.join(" + ")}] `;
  let body = String(state.summaryBody || "").trim();
  if (types.includes("video editing")) {
    const head = "The target video is an edited version of <Video 1>.";
    if (!body) body = `${head} (补充改动说明)`;
    else if (!/^The target video is an edited version of/i.test(body)) body = `${head} ${body}`;
  } else if (types.includes("video continuation")) {
    if (!body) body = "The target video continues from the end of <Video 1>. (补充续拍内容)";
  } else if (!body) {
    body = "The target video uses the defined references. (一句话概括)";
  }
  return prefix + body;
}

function buildRetention(state) {
  const lines = [];
  state.subjects.forEach((s, i) => {
    const marker = s.retain || "fully_preserved";
    const appear = autoAppearForSubject(state, i);
    lines.push(buildRetentionLine(`<Subject ${i + 1}>`, appear, marker, s.retainNote, "(请填写保留说明)"));
  });
  state.refs.forEach((r) => {
    if (!isStandaloneRef(r)) return;
    const tag = refTag(state, r.id);
    const marker = r.retain || defaultRetainForRef(r);
    const appear = autoAppearForRef(state, r);
    lines.push(buildRetentionLine(tag, appear, marker, r.retainNote, "(请填写保留说明)"));
  });
  return lines.length ? lines.join("\n") : "(none)";
}

function buildDialogueClause(d, map) {
  const text = String(d.text || "").trim();
  if (!text) return "";
  const lang = String(d.lang || "English").trim();
  const mode = d.mode || "says";
  let clause;
  if (mode === "sings") {
    const who = formatSpeakerForOutput(d.speaker, map);
    clause = `${who} sings: <d>[${lang}] ${text}</d>`;
  } else if (mode === "say_together" || mode === "shout_together" || mode === "sing_together") {
    const who = formatSpeakerForTogether(d.speaker, map);
    const verb = mode === "shout_together" ? "shout" : mode === "sing_together" ? "sing" : "say";
    clause = `${who} ${verb} together, <d>[${lang}] ${text}</d>`;
  } else if (d.offScreen) {
    const who = formatSpeakerForOutput(d.speaker, map);
    clause = `${who} says in an off-screen voiceover: <d>[${lang}] ${text}</d> The corresponding on-screen character's lips remain completely closed.`;
  } else {
    const who = formatSpeakerForOutput(d.speaker, map);
    clause = `${who} says: <d>[${lang}] ${text}</d>`;
  }
  if (d.scenetrans) {
    clause = `<scenetrans> ${clause} The speech continues seamlessly across the cut. <scenetrans>`;
  }
  if (d.cutoff) {
    clause = `${clause} <cutoff>`;
  }
  return clause;
}

function composeCamSentence(motionEn, ampEn, speedEn, noAmpSpeed) {
  let t = String(motionEn || "").trim();
  if (!t) return "";
  if (!noAmpSpeed) {
    if (ampEn) t += ` ${ampEn}`;
    if (speedEn) t += ` ${speedEn}`;
  }
  if (!/[.!?]$/.test(t)) t += ".";
  return t;
}

function buildShotLine(shot, index, speakerMap, opts = {}) {
  const map = speakerMap || speakerIdMap({ shots: [shot] });
  let body = applySpeakerIdsToBody(String(shot.body || "").trim(), map);

  // 基础模式：整体风格拼在 [Shot 1] 正文开头（官方 T2VA/I2VA…）
  if (index === 0 && opts.inlineStyle) {
    const st = String(opts.inlineStyle).trim();
    if (st) {
      const styleBit = st.endsWith(",") ? st : st.replace(/\.$/, "") + ",";
      // 若正文已以风格开头则不重复
      const head = body.slice(0, Math.min(body.length, styleBit.length + 8)).toLowerCase();
      if (!head.includes(st.slice(0, Math.min(12, st.length)).toLowerCase())) {
        body = body ? `${styleBit} ${body}` : styleBit.replace(/,$/, ".");
      }
    }
  }

  body = body.replace(/,\s*,/g, ",").replace(/^,\s*/, "").trim() || "(empty)";
  if (index === 0) return `[Shot 1] ${body}`;
  const t = formatTime(shot.start);
  const needsCut = !/^(the camera cuts to|the shot cuts to|the shot transitions to|the shot changes to|the shot switches to)\b/i.test(body);
  if (needsCut) body = `the camera cuts to ${body}`;
  return `[Shot ${index + 1}] At ${t}, ${body}`;
}

function shotBuildOpts(state) {
  // Ref：风格在 Shot1 之前单独成句；基础模式：内联到 Shot1
  if (isRef(state)) return {};
  return { inlineStyle: state.styleOpening || "" };
}

function buildDetailedBody(state) {
  const map = speakerIdMap(state);
  const opts = shotBuildOpts(state);
  const shotLines = state.shots.map((s, i) => buildShotLine(s, i, map, opts)).join("\n");
  if (!isRef(state)) return shotLines;
  const style = String(state.styleOpening || "").trim();
  return style ? `${style}\n${shotLines}` : shotLines;
}

function assemble(state) {
  const meta = modeMeta(state);
  const map = speakerIdMap(state);
  const opts = shotBuildOpts(state);
  const shotLines = state.shots.map((s, i) => buildShotLine(s, i, map, opts)).join("\n");
  const detailed = buildDetailedBody(state);
  const sound = String(state.soundscape || "").trim() || "N/A";
  const music = String(state.music || "").trim() || "N/A";

  if (meta.format === "base") {
    const align = buildAlignment(state);
    const parts = [];
    if (align) parts.push(align, "");
    parts.push(`integrated_multimodal_description:\n${shotLines}`);
    parts.push("");
    parts.push(`overall_soundscape: ${sound}`);
    parts.push("");
    parts.push(`non_diegetic_music: ${music}`);
    return {
      full: parts.join("\n"),
      sections: {
        alignment: align,
        integrated_multimodal_description: shotLines,
        overall_soundscape: sound,
        non_diegetic_music: music,
      },
      shots: state.shots.map((s, i) => ({ name: `shot_${i + 1}`, text: buildShotLine(s, i, map, opts) })),
    };
  }

  const sections = {
    subject_definitions: buildDefsBlock(state),
    summary: buildSummary(state),
    retention_analysis: buildRetention(state),
    detailed_description: detailed,
    overall_soundscape: sound,
    non_diegetic_music: music,
  };
  const full = [
    `subject_definitions:\n${sections.subject_definitions}`,
    `summary:\n${sections.summary}`,
    `retention_analysis:\n${sections.retention_analysis}`,
    `detailed_description:\n${sections.detailed_description}`,
    `overall_soundscape:\n${sections.overall_soundscape}`,
    `non_diegetic_music:\n${sections.non_diegetic_music}`,
  ].join("\n\n");

  return {
    full,
    sections,
    shots: state.shots.map((s, i) => ({ name: `shot_${i + 1}`, text: buildShotLine(s, i, map, opts) })),
  };
}

/** 节点输出：duration / prompt 直连；其余打进 prompt_pack */
function buildFormatterOutput(state) {
  const packed = assemble(state);
  const meta = modeMeta(state);
  const map = speakerIdMap(state);
  const opts = shotBuildOpts(state);
  const align = nullOrText(buildAlignment(state));
  const style = nullOrText(state.styleOpening);

  const shots = state.shots.map((s, i) => ({
    index: i,
    cutTime: i === 0 ? null : formatTime(s.start),
    body: applySpeakerIdsToBody(s.body || "", map),
    raw: buildShotLine(s, i, map, opts),
  }));

  const duration = Number(Number(state.duration).toFixed(2));
  const prompt = packed.full;
  const prompt_pack = {
    packVersion: PACK_VERSION,
    mode: meta.label,
    structured: {
      referenceHeader: meta.format === "base" ? align : null,
      globalStyle: isRef(state) ? style : null,
      summary: isRef(state) ? nullOrText(buildSummary(state)) : null,
      subjectDefinitions: isRef(state) ? nullOrText(buildDefsBlock(state)) : null,
      retentionAnalysis: isRef(state) ? nullOrText(buildRetention(state)) : null,
      shots,
      overallSoundscape: nullOrText(state.soundscape) || null,
      nonDiegeticMusic: nullOrText(state.music) || null,
    },
  };

  return { duration, prompt, prompt_pack };
}

/* —— state —— */
let state = loadState();
let mentionCtx = null; // { el, start, end }

function hydrateStateFromObject(raw) {
  if (!raw || typeof raw !== "object") return defaultState();
  // 兼容导出包 { format, state } 或裸 state
  if (raw.state && typeof raw.state === "object" && (raw.format || raw.version || raw.packVersion)) {
    raw = raw.state;
  }
  const merged = { ...defaultState(), ...raw };
  if (!MODES.some((m) => m.id === merged.mode)) merged.mode = "t2va";
  merged.shots = (Array.isArray(merged.shots) && merged.shots.length ? merged.shots : defaultShots()).map(normalizeShot);
  merged.refs = Array.isArray(merged.refs) ? merged.refs : [];
  merged.refs = merged.refs.map((r) => {
    const kind = r.kind || "picture";
    const role = migrateRefRole(kind, r.role || defaultRoleForKind(kind));
    const next = { ...r, kind, role };
    if (!next.retain || (kind === "audio" && !AUDIO_RETAIN.some((v) => v.id === next.retain)) || (kind !== "audio" && !VISUAL_RETAIN.some((v) => v.id === next.retain))) {
      next.retain = defaultRetainForRef(next);
    }
    return next;
  });
  merged.subjects = Array.isArray(merged.subjects) ? merged.subjects : [];
  if (Array.isArray(raw.defs) && raw.defs.length && !merged.refs.length && !merged.subjects.length) {
    raw.defs.forEach((d) => {
      if (d.kind === "subject") merged.subjects.push({ id: d.id || uid(), name: "", text: d.text || "", binds: [] });
      else merged.refs.push({ id: d.id || uid(), kind: d.kind || "picture", note: d.text || "", role: "subject_only" });
    });
  }
  if (!Array.isArray(merged.taskTypes) || !merged.taskTypes.length) merged.taskTypes = ["reference generation"];
  merged.styleOpening = merged.styleOpening || "";
  merged.soundscape = merged.soundscape ?? "";
  merged.music = merged.music ?? "";
  merged.summaryBody = merged.summaryBody ?? "";
  merged.duration = Number(merged.duration) || 6;
  merged.collapsed = merged.collapsed && typeof merged.collapsed === "object" ? merged.collapsed : {};
  if (raw.linkedBundle && raw.linkedBundle.manifest) {
    linkedBundle = {
      mode_hint: raw.linkedBundle.mode_hint || "",
      manifest: raw.linkedBundle.manifest,
    };
  }
  return merged;
}

function loadState() {
  // Comfy 嵌入：状态由节点 form_state widget 注入，勿抢 localStorage
  if (IS_EMBED) return defaultState();
  try {
    const raw = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ||
        localStorage.getItem("h3-prompt-formatter-lab-v4") ||
        localStorage.getItem("h3-prompt-formatter-lab-v3") ||
        "null"
    );
    return hydrateStateFromObject(raw);
  } catch {
    return defaultState();
  }
}

function saveState() {
  const payload = { ...state, linkedBundle: linkedBundle || null };
  if (!IS_EMBED) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }
  notifyComfyParent();
}

/** 导出表单 JSON（可再加载；附带当前输出快照方便核对） */
function buildExportPayload() {
  const out = buildFormatterOutput(state);
  return {
    format: "h3-prompt-formatter-lab",
    version: 1,
    savedAt: new Date().toISOString(),
    state: {
      mode: state.mode,
      duration: state.duration,
      styleOpening: state.styleOpening || "",
      soundscape: state.soundscape || "",
      music: state.music || "",
      summaryBody: state.summaryBody || "",
      taskTypes: Array.isArray(state.taskTypes) ? state.taskTypes : [],
      refs: (state.refs || []).map((r) => ({
        id: r.id,
        kind: r.kind,
        role: r.role,
        note: r.note || "",
        retain: r.retain,
        retainNote: r.retainNote || "",
        sourceInput: r.sourceInput || null,
        bundleToken: r.bundleToken || null,
        bundleLabel: r.bundleLabel || null,
      })),
      linkedBundle: linkedBundle
        ? {
            mode_hint: linkedBundle.mode_hint,
            manifest: linkedBundle.manifest,
          }
        : null,
      subjects: state.subjects || [],
      shots: (state.shots || []).map((s) => ({
        id: s.id,
        start: s.start,
        end: s.end,
        body: s.body || "",
      })),
      selectedShotId: state.selectedShotId || null,
      collapsed: state.collapsed && typeof state.collapsed === "object" ? { ...state.collapsed } : {},
    },
    output: {
      duration: out.duration,
      mode: out.prompt_pack.mode,
      prompt: out.prompt,
      prompt_pack: out.prompt_pack,
    },
  };
}

function downloadJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function importStateFromJsonText(text) {
  const data = JSON.parse(text);
  state = hydrateStateFromObject(data);
  saveState();
  render();
}

/**
 * 输入校验：error 必须处理；warn 建议处理
 * 不自动改稿，只报告
 */
function validateState(st) {
  const errors = [];
  const warnings = [];
  const dur = Number(st.duration);
  const shots = Array.isArray(st.shots) ? st.shots : [];
  const meta = modeMeta(st);

  if (!Number.isFinite(dur)) errors.push("总时长不是有效数字");
  else {
    if (dur < 4) errors.push(`总时长 ${dur}s 低于 H3 常用下限 4s`);
    if (dur > 15) warnings.push(`总时长 ${dur}s 超过常用 15s（部分链路可更长，请确认）`);
    // 两位小数友好提示
    if (Math.round(dur * 100) / 100 !== dur) warnings.push("总时长建议保留两位小数");
  }

  if (!shots.length) errors.push("至少需要 1 个 Shot");

  shots.forEach((s, i) => {
    const start = Number(s.start);
    const end = Number(s.end);
    const label = `Shot ${i + 1}`;
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      errors.push(`${label} 起止时间无效`);
      return;
    }
    if (i === 0 && Math.abs(start) > 0.001) errors.push("Shot 1 必须从 0.00s 开始（官方：首镜不加 At 时间戳）");
    if (end <= start) errors.push(`${label} 结束时间必须大于开始时间`);
    if (i > 0) {
      const prev = shots[i - 1];
      const prevEnd = Number(prev.end);
      if (Math.abs(start - prevEnd) > 0.02) {
        errors.push(`${label} 切点 ${formatTime(start)} 应紧接上一镜结束 ${formatTime(prevEnd)}`);
      }
      if (start <= Number(prev.start)) errors.push(`${label} 切点必须严格递增`);
      if (dur && start >= dur - 0.001) errors.push(`${label} 切点 ${formatTime(start)} 必须小于总时长 ${dur}s`);
    }
    const body = String(s.body || "").trim();
    if (!body) errors.push(`${label} 正文为空`);
    else if (body.length < 12) warnings.push(`${label} 正文过短，可能缺少构图/动作/声音信息`);
  });

  if (shots.length) {
    const lastEnd = Number(shots[shots.length - 1].end);
    if (Number.isFinite(dur) && Math.abs(lastEnd - dur) > 0.05) {
      warnings.push(`最后一镜结束 ${lastEnd}s 与总时长 ${dur}s 不一致（拖时间轴或改时长可对齐）`);
    }
  }

  if (!String(st.styleOpening || "").trim()) {
    warnings.push(meta.format === "ref" ? "未填开场风格句（Ref 写在 [Shot 1] 前）" : "未填整体风格（将拼到 Shot 1 开头）");
  }

  if (!String(st.soundscape || "").trim()) warnings.push("overall_soundscape 为空（拼装时会写成 N/A）");
  if (!String(st.music || "").trim()) warnings.push("non_diegetic_music 为空（拼装时会写成 N/A）");

  if (isRef(st)) {
    if (!st.refs.length && !st.subjects.length) errors.push("Ref2VA 至少需要一条引用或一个 Subject");
    if (!Array.isArray(st.taskTypes) || !st.taskTypes.length) warnings.push("未选择 summary 任务类型");
    if (!String(st.summaryBody || "").trim()) warnings.push("summary 正文为空");
    st.subjects.forEach((s, i) => {
      if (!String(s.text || "").trim() && !(s.binds || []).length) {
        warnings.push(`Subject ${i + 1} 缺少说明与绑定`);
      }
      if (!String(s.retainNote || "").trim()) warnings.push(`Subject ${i + 1} 未填保留说明`);
    });
    // 正文里用到的标签是否已定义
    const allBody = shots.map((s) => s.body || "").join("\n");
    const used = [...allBody.matchAll(/<(Subject|Picture|Video|Audio)\s+(\d+)>/gi)];
    used.forEach((m) => {
      const kind = m[1];
      const n = Number(m[2]);
      if (kind.toLowerCase() === "subject") {
        if (n < 1 || n > st.subjects.length) errors.push(`正文引用了未定义的 <Subject ${n}>`);
      } else {
        const same = st.refs.filter((r) => r.kind === kind.toLowerCase());
        if (n < 1 || n > same.length) errors.push(`正文引用了未定义的 <${kind} ${n}>`);
      }
    });
  } else if (st.mode === "i2va" || st.mode === "fl2va" || st.mode === "l2va") {
    // 对齐句由拼装自动生成；提醒素材侧
    warnings.push(`${meta.label} 需要对应参考图接入生成链路（排版台只写对齐句，不挂真图）`);
  }

  // scenetrans 成对粗检
  const fullText = shots.map((s) => s.body || "").join("\n");
  const stCount = (fullText.match(/<scenetrans>/gi) || []).length;
  if (stCount === 1) warnings.push("<scenetrans> 通常应在相邻两镜各出现一次（成对）");
  if (stCount % 2 === 1 && stCount > 1) warnings.push(`<scenetrans> 出现 ${stCount} 次（奇数），请检查是否成对`);

  return { errors, warnings, ok: !errors.length };
}

function renderValidatePanel(result, { forceShow = false, expand = false } = {}) {
  const panel = document.getElementById("validate-panel");
  const summary = document.getElementById("validate-summary");
  const block = document.getElementById("block-validate");
  if (!panel) return;

  const setSummary = (text, kind) => {
    if (!summary) return;
    summary.textContent = text;
    summary.classList.remove("is-err", "is-warn", "is-ok");
    if (kind) summary.classList.add(kind);
  };

  if (!result) {
    panel.innerHTML = `<div class="vp-ok">点击工具栏「校验」检查时长、切点、缺项等</div>`;
    panel.classList.remove("has-errors", "ok-only");
    block?.classList.remove("has-errors", "ok-only");
    setSummary("未检查 · 点工具栏「校验」", null);
    return;
  }

  const { errors, warnings, ok } = result;
  if (!forceShow && ok && !warnings.length) {
    // 静默通过：仍更新摘要，保留面板内容简短
  }

  panel.hidden = false;
  panel.classList.toggle("has-errors", !!errors.length);
  panel.classList.toggle("ok-only", ok && !warnings.length);
  block?.classList.toggle("has-errors", !!errors.length);
  block?.classList.toggle("ok-only", ok && !warnings.length);

  let html = `<div class="vp-title">校验 ${ok ? (warnings.length ? "通过（有建议）" : "通过") : "未通过"}</div>`;
  if (ok && !warnings.length) html += `<div class="vp-ok">未见明显问题</div>`;
  errors.forEach((m) => {
    html += `<div class="vp-err">· ${escapeHtml(m)}</div>`;
  });
  warnings.forEach((m) => {
    html += `<div class="vp-warn">· ${escapeHtml(m)}</div>`;
  });
  panel.innerHTML = html;

  if (!ok) {
    setSummary(`未通过 · ${errors.length} 错误 / ${warnings.length} 建议`, "is-err");
  } else if (warnings.length) {
    setSummary(`通过 · ${warnings.length} 条建议`, "is-warn");
  } else {
    setSummary("通过 · 未见明显问题", "is-ok");
  }

  // 点校验后自动展开，方便看结果
  if (expand && state.collapsed?.validate) {
    state.collapsed.validate = false;
    applyCollapsedState();
  }
}

function runValidate({ silentOk = false } = {}) {
  const result = validateState(state);
  renderValidatePanel(result, { forceShow: true, expand: true });
  if (!result.ok) {
    setStatus(`校验未通过：${result.errors.length} 错误 / ${result.warnings.length} 建议`);
  } else if (result.warnings.length) {
    setStatus(`校验通过，${result.warnings.length} 条建议`);
  } else {
    setStatus(silentOk ? "就绪" : "校验通过");
  }
  return result;
}

function setStatus(msg) {
  const el = document.getElementById("status-line");
  if (el) el.textContent = msg;
}

function oneLine(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}
function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/\n/g, " ");
}

/* —— render —— */
const SEC_CIRCLED = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧"];

/** 按当前可见区块重排 ①②③… */
function renumberSections() {
  const secs = [...document.querySelectorAll(".work-left .block.collapsible[data-sec]")].filter(
    (el) => !el.hidden
  );
  secs.forEach((el, i) => {
    const num = el.querySelector("[data-sec-num]");
    if (num) num.textContent = SEC_CIRCLED[i] || `${i + 1}.`;
  });
}

function applyCollapsedState() {
  if (!state.collapsed || typeof state.collapsed !== "object") state.collapsed = {};
  document.querySelectorAll(".block.collapsible[data-sec]").forEach((el) => {
    const key = el.dataset.sec;
    const collapsed = !!state.collapsed[key];
    el.classList.toggle("collapsed", collapsed);
    const head = el.querySelector("[data-collapse-toggle]");
    if (head) head.setAttribute("aria-expanded", collapsed ? "false" : "true");
  });
}

function toggleSectionCollapse(secKey) {
  if (!secKey) return;
  if (!state.collapsed || typeof state.collapsed !== "object") state.collapsed = {};
  state.collapsed[secKey] = !state.collapsed[secKey];
  applyCollapsedState();
  saveState();
}

function render() {
  syncShotEnds(state);
  renderModes();
  renderTaskTypes();
  renderHint();
  renderBundleStatus();
  renderRefs();
  renderSubjects();
  renderStyleField();
  applyCollapsedState();
  renumberSections();
  renderRuler();
  renderShots();
  renderSound();
  renderPreview();
  renderOutputSlots();
  saveState();
}

function renderModes() {
  document.getElementById("mode-tabs").innerHTML = MODES.map(
    (m) =>
      `<button type="button" class="task-tab ${state.mode === m.id ? "on" : ""}" data-mode="${m.id}">${m.label}</button>`
  ).join("");
  document.getElementById("total-duration").value = state.duration;
}

function renderTaskTypes() {
  const row = document.getElementById("task-types");
  const show = isRef(state);
  row.hidden = !show;
  if (!show) {
    row.innerHTML = "";
    return;
  }
  const selected = new Set(selectedTaskTypes(state));
  const chip = (t) =>
    `<button type="button" class="tt-chip ${selected.has(t.id) ? "on" : ""}" data-tt="${t.id}" title="${escapeAttr(t.id)}">${t.zh}<span class="tt-en">${t.id}</span></button>`;
  row.innerHTML = `
    <div class="taskbar-label"><strong>任务类型</strong><span class="muted">写入 summary 方括号前缀 · 可多选</span></div>
    <div class="taskbar-groups">
      <div class="taskbar-group"><span class="taskbar-group-title">画面 / 视频</span><div class="taskbar-chips">${TASK_TYPES.filter((t) => t.group === "visual").map(chip).join("")}</div></div>
      <div class="taskbar-group"><span class="taskbar-group-title">音频</span><div class="taskbar-chips">${TASK_TYPES.filter((t) => t.group === "audio").map(chip).join("")}</div></div>
    </div>`;
}

function renderHint() {
  const m = modeMeta(state);
  let extra = isRef(state) ? ` 当前多选：[${selectedTaskTypes(state).join(" + ")}]` : "";
  document.getElementById("mode-hint").textContent = `${m.label} — ${m.hint}${extra}`;
}

function renderRefs() {
  const block = document.getElementById("block-refs");
  block.hidden = !isRef(state);
  if (!isRef(state)) return;

  const list = document.getElementById("refs-list");
  if (!state.refs.length) {
    list.innerHTML = `<div class="muted">先添加 Picture / Video / Audio。编号按类型排列（&lt;Picture 1&gt; ↔ ref_image_0）。可用上移/下移调整顺序。</div>`;
    return;
  }

  list.innerHTML = state.refs
    .map((r) => {
      const tag = refTag(state, r.id);
      const kindIdx = refKindIndex(state, r.id);
      const slotLabel = refSlotLabel(state, r.id);
      const same = state.refs.filter((x) => x.kind === r.kind);
      const posInKind = same.findIndex((x) => x.id === r.id);
      const canUp = posInKind > 0;
      const canDown = posInKind >= 0 && posInKind < same.length - 1;
      const role = migrateRefRole(r.kind, r.role || defaultRoleForKind(r.kind));
      r.role = role;
      const showRetain = isStandaloneRef(r);
      const retain = r.retain || defaultRetainForRef(r);
      const appearHint = autoAppearForRef(state, r);
      return `<div class="def-card ref-card" data-ref="${r.id}">
        <div class="def-side">
          <div class="ref-badge">
            <span class="ref-num">#${kindIdx}</span>
            <span class="tag">${tag}</span>
          </div>
          <div class="ref-slot" title="与 H3 参考素材节点槽位对应">${escapeHtml(slotLabel)}</div>
          <div class="ref-kind-locked" title="类型在添加时已确定，不可更改；需换类型请删除后重加">${escapeHtml(capitalizeKind(r.kind))}</div>
          <select data-ref-role="${r.id}" title="用途（随类型变化）">
            ${roleOptionsHtml(r.kind, role)}
          </select>
          <div class="ref-move">
            <button type="button" class="m3td-btn" data-ref-up="${r.id}" title="上移（交换编号）" ${canUp ? "" : "disabled"}>上移</button>
            <button type="button" class="m3td-btn" data-ref-down="${r.id}" title="下移（交换编号）" ${canDown ? "" : "disabled"}>下移</button>
          </div>
        </div>
        <div class="subj-body">
          <textarea data-ref-note="${r.id}" placeholder="${escapeAttr(refNotePlaceholder(r.kind, role))}">${escapeHtml(r.note || "")}</textarea>
          ${
            showRetain
              ? `<div class="retain-block">
            <div class="retain-head"><span class="muted">retention_analysis · 保真度（单独成行才写入）</span></div>
            <select data-ref-retain="${r.id}" title="保真度标记">${retainOptionsHtml(r.kind, retain)}</select>
            <div class="appear-auto muted">出现镜号（自动）：${appearHint ? escapeHtml(appearHint) : "分镜里尚未写到本标签"}</div>
            <textarea data-ref-retain-note="${r.id}" rows="1" placeholder="保留说明（写入冒号后）">${escapeHtml(r.retainNote || "")}</textarea>
          </div>`
              : `<div class="muted" style="font-size:11px">仅供 Subject 引用时，保真度写在 Subject 卡上，不单独输出本引用的 retention 行。</div>`
          }
        </div>
        <button type="button" class="m3td-btn" data-del-ref="${r.id}">删</button>
      </div>`;
    })
    .join("");
}

function renderStyleField() {
  const styleEl = document.getElementById("style-opening");
  const styleWrap = document.getElementById("wrap-style-opening");
  const title = document.getElementById("style-opening-title");
  const hint = document.getElementById("style-opening-hint");
  const label = document.getElementById("style-opening-label");
  const chips = document.getElementById("style-chips");
  if (!styleEl || !styleWrap) return;
  styleWrap.hidden = false;
  styleEl.value = state.styleOpening || "";
  if (chips) {
    chips.innerHTML = STYLE_CHIPS.map(
      (c) =>
        `<button type="button" class="tt-chip${state.styleOpening === c.en ? " on" : ""}" data-style-chip="${escapeAttr(c.en)}">${escapeHtml(c.zh)}</button>`
    ).join("");
  }
  if (isRef(state)) {
    if (title) title.textContent = "开场风格 · detailed_description";
    if (hint) hint.textContent = "写在 [Shot 1] 之前 · 1～2 句英文";
    if (label) label.textContent = "开场风格";
    styleEl.placeholder = "例：The target video uses a quiet realistic indoor style with soft window light.";
  } else {
    if (title) title.textContent = "整体风格";
    if (hint) hint.textContent = "自动拼到 [Shot 1] 正文开头";
    if (label) label.textContent = "整体风格";
    styleEl.placeholder = "例：Live-action, cinematic";
  }
}

function renderSubjects() {
  const block = document.getElementById("block-subjects");
  block.hidden = !isRef(state);

  if (!isRef(state)) return;

  const list = document.getElementById("subjects-list");

  if (!state.subjects.length) {
    list.innerHTML = `<div class="muted">添加 Subject 后，用「绑定引用」选择外观来自哪张图、动作来自哪段视频；也可在说明里打 @ 插入标签。</div>`;
  } else {
    list.innerHTML = state.subjects
      .map((s, i) => {
        const tag = `<Subject ${i + 1}>`;
        const binds = (s.binds || [])
          .map(
            (b, bi) => `<div class="bind-row" data-bind-subj="${s.id}" data-bind-i="${bi}">
            <select data-bind-aspect="${s.id}" data-bind-i="${bi}">
              ${BIND_ASPECTS.map((a) => `<option value="${a.id}" ${b.aspect === a.id ? "selected" : ""}>${a.zh}</option>`).join("")}
            </select>
            <span class="muted">←</span>
            <select data-bind-ref="${s.id}" data-bind-i="${bi}">
              <option value="">（选引用）</option>
              ${state.refs.map((r) => {
                const tag = refTag(state, r.id);
                const kindZh = { picture: "图", video: "视频", audio: "音频" }[r.kind] || "";
                const note = r.note ? ` · ${oneLine(r.note)}` : "";
                return `<option value="${r.id}" ${b.refId === r.id ? "selected" : ""}>${escapeHtml(tag)} ${kindZh}${escapeHtml(note)}</option>`;
              }).join("")}
            </select>
            <button type="button" class="m3td-btn" data-del-bind="${s.id}" data-bind-i="${bi}">×</button>
          </div>`
          )
          .join("");

        return `<div class="def-card subj-card" data-subj="${s.id}">
          <div class="def-side">
            <div class="tag">${tag}</div>
            <button type="button" class="m3td-btn" data-del-subj="${s.id}">删</button>
          </div>
          <div class="subj-body">
            <input type="text" data-subj-name="${s.id}" value="${escapeAttr(s.name || "")}" placeholder="简称（如 young woman / white Samoyed）" />
            <div class="bind-block">
              <div class="bind-head">
                <span class="muted">绑定引用（人脸←图1、服装←图2…）</span>
                <button type="button" class="m3td-btn" data-add-bind="${s.id}" ${state.refs.length ? "" : "disabled"}>＋ 绑定</button>
              </div>
              ${binds || `<div class="muted" style="font-size:11px">尚未绑定。也可在下方说明里用 @ 插入 &lt;Picture N&gt;</div>`}
            </div>
            <div class="at-row">
              <textarea data-subj-text="${s.id}" rows="2" placeholder="补充说明（可 @ 插入引用标签）">${escapeHtml(s.text || "")}</textarea>
              <button type="button" class="m3td-btn at-btn" data-at-target="subj-text:${s.id}">@</button>
            </div>
            <div class="retain-block">
              <div class="retain-head">
                <span class="muted">retention_analysis · 保真度</span>
                <button type="button" class="m3td-btn" data-draft-retain="${s.id}" title="根据绑定生成保留说明">根据绑定生成</button>
              </div>
              <select data-subj-retain="${s.id}" title="保真度标记">${retainOptionsHtml("subject", s.retain || "fully_preserved")}</select>
              <div class="appear-auto muted">出现镜号（自动）：${(() => {
                const a = autoAppearForSubject(state, i);
                return a ? escapeHtml(a) : "分镜里用 @ 插入本 Subject 后自动汇总";
              })()}</div>
              <textarea data-subj-retain-note="${s.id}" rows="1" placeholder="保留说明（例：appearance from &lt;Picture 1&gt; and clothing from &lt;Picture 2&gt; are retained.）">${escapeHtml(s.retainNote || "")}</textarea>
            </div>
          </div>
        </div>`;
      })
      .join("");
  }

  document.getElementById("summary-body").value = state.summaryBody || "";
}

function renderRuler() {
  const el = document.getElementById("timeline-ruler");
  const dur = Math.max(0.5, Number(state.duration) || 6);
  const ticks = [];
  for (let t = 0; t <= dur + 0.001; t += 1) {
    ticks.push(`<div class="tick" style="left:${(t / dur) * 100}%"><span>${t}s</span></div>`);
  }
  el.innerHTML = `<div class="fill" style="width:100%"></div>${ticks.join("")}`;
  renderTimelineTrack();
}

function renderTimelineTrack() {
  const el = document.getElementById("timeline-track");
  if (!el) return;
  const dur = Math.max(0.5, Number(state.duration) || 6);
  el.innerHTML = state.shots
    .map((s, i) => {
      const left = (Number(s.start) / dur) * 100;
      const width = Math.max(1.5, ((Number(s.end) - Number(s.start)) / dur) * 100);
      const on = state.selectedShotId === s.id ? "on" : "";
      return `<div class="tl-seg ${on}" data-tl-shot="${s.id}" style="left:${left}%;width:${width}%">
        <span class="tl-label">S${i + 1}</span>
        <i class="tl-handle" data-tl-resize="${s.id}" title="拖动改切点"></i>
      </div>`;
    })
    .join("");
}

function renderShots() {
  const root = document.getElementById("shot-list");
  const dur = Math.max(0.5, Number(state.duration) || 6);
  root.innerHTML = state.shots
    .map((s, i) => {
      const left = (Number(s.start) / dur) * 100;
      const width = Math.max(2, ((Number(s.end) - Number(s.start)) / dur) * 100);
      const selected = state.selectedShotId === s.id ? "selected" : "";
      return `<div class="shot-card ${selected}" data-shot="${s.id}">
        <div class="shot-bar">
          <span class="drag-handle" draggable="true" data-drag-shot="${s.id}" title="拖动重排">⋮⋮</span>
          <span class="idx">Shot ${i + 1}</span>
          <label>起 <input type="number" step="0.01" min="0" data-shot-start="${s.id}" value="${Number(s.start).toFixed(2)}" ${i === 0 ? "disabled" : ""} /></label>
          <label>止 <input type="number" step="0.01" min="0" data-shot-end="${s.id}" value="${Number(s.end).toFixed(2)}" /></label>
          <div class="seg-vis"><i style="left:${left}%;width:${width}%"></i></div>
          <div class="shot-tools">
            <button type="button" class="m3td-btn" data-move-shot="${s.id}" data-dir="-1" ${i === 0 ? "disabled" : ""}>↑</button>
            <button type="button" class="m3td-btn" data-move-shot="${s.id}" data-dir="1" ${i >= state.shots.length - 1 ? "disabled" : ""}>↓</button>
            <button type="button" class="m3td-btn" data-del-shot="${s.id}" ${state.shots.length <= 1 ? "disabled" : ""}>删</button>
          </div>
        </div>
        <div class="shot-fields">
          <div class="shot-toolbar">
            <span class="muted">插入工具</span>
            <button type="button" class="m3td-btn" data-tool="cam" data-shot-id="${s.id}">运镜</button>
            <button type="button" class="m3td-btn" data-tool="timing" data-shot-id="${s.id}">镜内时间</button>
            <button type="button" class="m3td-btn" data-tool="dlg" data-shot-id="${s.id}">对白/合唱</button>
            <button type="button" class="m3td-btn" data-tool="sfx" data-shot-id="${s.id}">画内声</button>
            <button type="button" class="m3td-btn" data-tool="au" data-shot-id="${s.id}">表情 AU</button>
            ${
              isRef(state)
                ? `<button type="button" class="m3td-btn" data-tool="at" data-shot-id="${s.id}" data-at-target="shot-body:${s.id}">@ 引用</button>`
                : ""
            }
            <span class="muted shot-toolbar-hint">点工具插入到光标处 · 可自由改写正文</span>
          </div>
          <div class="tool-panel" data-tool-panel="${s.id}" hidden></div>
          <textarea class="shot-body" data-shot-body="${s.id}" rows="5" placeholder="本镜正文（自由书写）。用上方工具插入运镜 / 对白 / 画内声${isRef(state) ? " / @引用" : ""}…&#10;同场景连续推拉摇移：写在同一 Shot 里，不要为此新开 Shot。">${escapeHtml(s.body || "")}</textarea>
        </div>
      </div>`;
    })
    .join("");
}

function getShotBodyEl(shotId) {
  return document.querySelector(`[data-shot-body="${shotId}"]`);
}

function insertIntoShotBody(shotId, text, { wrapSpace = true } = {}) {
  const el = getShotBodyEl(shotId);
  const shot = state.shots.find((s) => s.id === shotId);
  if (!el || !shot) return;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const before = el.value.slice(0, start);
  const after = el.value.slice(end);
  let bit = String(text || "");
  if (wrapSpace) {
    const padL = before && !/\s$/.test(before) ? " " : "";
    const padR = after && !/^\s/.test(after) ? " " : "";
    // 句子末通常补句号感：若插入运镜句已有句号则不加
    bit = padL + bit + padR;
  }
  el.value = before + bit + after;
  shot.body = el.value;
  const caret = (before + bit).length;
  el.focus();
  el.setSelectionRange(caret, caret);
  saveState();
  renderPreview();
  renderOutputSlots();
  setStatus("已插入到正文光标处");
}

function closeToolPanels() {
  document.querySelectorAll(".tool-panel").forEach((p) => {
    p.hidden = true;
    p.innerHTML = "";
  });
}

function openCamTool(shotId) {
  const panel = document.querySelector(`[data-tool-panel="${shotId}"]`);
  if (!panel) return;
  closeToolPanels();
  panel.hidden = false;
  panel.innerHTML = `<div class="tool-panel-inner">
    <div class="tool-panel-title">运镜增强 · 类型 + 幅度 + 速度（官方三维）</div>
    <div class="shot-grid-3">
      <label class="stack-field"><span>运动类型</span>
        <select data-cam-motion>
          ${CAM_MOTIONS.map((m, i) => `<option value="${i}">${escapeHtml(m.zh)}</option>`).join("")}
        </select>
      </label>
      <label class="stack-field"><span>幅度</span>
        <select data-cam-amp>
          ${CAM_AMPS.map((a, i) => `<option value="${i}">${escapeHtml(a.zh)}</option>`).join("")}
        </select>
      </label>
      <label class="stack-field"><span>速度</span>
        <select data-cam-speed>
          ${CAM_SPEEDS.map((s, i) => `<option value="${i}">${escapeHtml(s.zh)}</option>`).join("")}
        </select>
      </label>
    </div>
    <div class="cam-preview muted" data-cam-preview></div>
    <label class="stack-field"><span>可选：动作目标（接在句末）</span>
      <input type="text" data-cam-toward placeholder="toward the folded letter in her hands" />
    </label>
    <div class="tool-panel-actions">
      <button type="button" class="m3td-btn" data-cam-insert>插入运镜句</button>
      <button type="button" class="m3td-btn" data-tool-close>关闭</button>
    </div>
  </div>`;

  const syncPreview = () => {
    const mi = Number(panel.querySelector("[data-cam-motion]")?.value || 0);
    const ai = Number(panel.querySelector("[data-cam-amp]")?.value || 0);
    const si = Number(panel.querySelector("[data-cam-speed]")?.value || 0);
    const motion = CAM_MOTIONS[mi] || CAM_MOTIONS[0];
    let t = composeCamSentence(motion.en, CAM_AMPS[ai]?.en, CAM_SPEEDS[si]?.en, motion.noAmpSpeed);
    const toward = (panel.querySelector("[data-cam-toward]")?.value || "").trim();
    if (toward && t) t = t.replace(/\.$/, "") + " " + toward.replace(/^\.?/, "").replace(/\.$/, "") + ".";
    const prev = panel.querySelector("[data-cam-preview]");
    if (prev) prev.textContent = t ? `预览：${t}` : "";
  };
  panel.querySelectorAll("select, [data-cam-toward]").forEach((el) => {
    el.addEventListener("input", syncPreview);
    el.addEventListener("change", syncPreview);
  });
  syncPreview();

  panel.onclick = (e) => {
    if (e.target.closest("[data-cam-insert]")) {
      const mi = Number(panel.querySelector("[data-cam-motion]")?.value || 0);
      const ai = Number(panel.querySelector("[data-cam-amp]")?.value || 0);
      const si = Number(panel.querySelector("[data-cam-speed]")?.value || 0);
      const motion = CAM_MOTIONS[mi] || CAM_MOTIONS[0];
      let t = composeCamSentence(motion.en, CAM_AMPS[ai]?.en, CAM_SPEEDS[si]?.en, motion.noAmpSpeed);
      const toward = (panel.querySelector("[data-cam-toward]")?.value || "").trim();
      if (toward && t) t = t.replace(/\.$/, "") + " " + toward.replace(/\.$/, "") + ".";
      if (!t) return;
      insertIntoShotBody(shotId, t);
      closeToolPanels();
      return;
    }
    if (e.target.closest("[data-tool-close]")) closeToolPanels();
  };
}

function openTimingTool(shotId) {
  const panel = document.querySelector(`[data-tool-panel="${shotId}"]`);
  if (!panel) return;
  closeToolPanels();
  panel.hidden = false;
  panel.innerHTML = `<div class="tool-panel-inner">
    <div class="tool-panel-title">镜内时间 · 同一 Shot 内先后（不切镜）</div>
    <div class="tool-chip-row">
      ${TIMING_PRESETS.map(
        (p) =>
          `<button type="button" class="tt-chip" data-insert-timing="${escapeAttr(p.en)}" title="${escapeAttr(p.en)}">${escapeHtml(p.zh)}</button>`
      ).join("")}
    </div>
    <div class="shot-grid-2">
      <label class="stack-field"><span>前 N 秒保持</span>
        <input type="number" data-timing-hold min="0.5" max="14" step="0.5" value="2" />
      </label>
      <label class="stack-field"><span>约第 N 秒变化</span>
        <input type="number" data-timing-at min="0.5" max="14" step="0.5" value="2" />
      </label>
    </div>
    <div class="tool-panel-actions">
      <button type="button" class="m3td-btn" data-timing-insert-hold>插入「前 N 秒保持」</button>
      <button type="button" class="m3td-btn" data-timing-insert-at>插入「约第 N 秒」</button>
      <button type="button" class="m3td-btn" data-tool-close>关闭</button>
    </div>
  </div>`;
  panel.onclick = (e) => {
    const chip = e.target.closest("[data-insert-timing]");
    if (chip) {
      insertIntoShotBody(shotId, chip.dataset.insertTiming);
      closeToolPanels();
      return;
    }
    if (e.target.closest("[data-timing-insert-hold]")) {
      const n = Number(panel.querySelector("[data-timing-hold]")?.value || 2);
      const label = n === 1 ? "one second" : n === 2 ? "two seconds" : `${n} seconds`;
      insertIntoShotBody(
        shotId,
        `For the first ${label}, she holds this expression and remains still.`
      );
      closeToolPanels();
      return;
    }
    if (e.target.closest("[data-timing-insert-at]")) {
      const n = Number(panel.querySelector("[data-timing-at]")?.value || 2);
      const label = n === 1 ? "one-second" : n === 2 ? "two-second" : `${n}-second`;
      insertIntoShotBody(shotId, `Then, at about the ${label} mark,`);
      closeToolPanels();
      return;
    }
    if (e.target.closest("[data-tool-close]")) closeToolPanels();
  };
}

function openDlgTool(shotId) {
  const panel = document.querySelector(`[data-tool-panel="${shotId}"]`);
  if (!panel) return;
  closeToolPanels();
  panel.hidden = false;
  const subjectOpts = state.subjects
    .map((s, i) => {
      const insert = isRef(state) ? `<Subject ${i + 1}>` : s.name || `Subject ${i + 1}`;
      return `<option value="${escapeAttr(insert)}"></option>`;
    })
    .join("");
  panel.innerHTML = `<div class="tool-panel-inner">
    <div class="tool-panel-title">对白 / 唱 / 合唱（写入正文后可再改）</div>
    <div class="shot-grid-2">
      <label class="stack-field"><span>方式</span>
        <select data-dlg-tool-mode>
          <option value="says">说 says</option>
          <option value="sings">唱 sings</option>
          <option value="say_together">齐声 say together</option>
          <option value="shout_together">齐喊 shout together</option>
          <option value="sing_together">齐唱 sing together</option>
        </select>
      </label>
      <label class="stack-field"><span>语言</span>
        <select data-dlg-tool-lang>${LANGS.map((l) => `<option value="${escapeAttr(l.en)}">${escapeHtml(l.zh)}</option>`).join("")}</select>
      </label>
    </div>
    <label class="stack-field"><span>说话人 <span class="muted">合唱可写「the woman and the man」或组名「the two children」</span></span>
      <input type="text" list="dlg-tool-speakers" data-dlg-tool-speaker placeholder="the young woman / the woman and the man" />
      <datalist id="dlg-tool-speakers">${subjectOpts}</datalist>
    </label>
    <label class="stack-field"><span>台词 / 歌词原文</span>
      <input type="text" data-dlg-tool-text placeholder="原文，不翻译" />
    </label>
    <div class="dlg-flags">
      <label><input type="checkbox" data-dlg-tool-off /> 旁白 off-screen（仅「说」）</label>
      <label><input type="checkbox" data-dlg-tool-scenetrans /> 跨切点 &lt;scenetrans&gt;</label>
      <label><input type="checkbox" data-dlg-tool-cutoff /> 片尾 &lt;cutoff&gt;</label>
    </div>
    <div class="tool-panel-actions">
      <button type="button" class="m3td-btn" data-dlg-tool-insert>插入</button>
      <button type="button" class="m3td-btn" data-tool-close>关闭</button>
    </div>
  </div>`;
  panel.onclick = (e) => {
    if (e.target.closest("[data-dlg-tool-insert]")) {
      const speaker = panel.querySelector("[data-dlg-tool-speaker]")?.value || "";
      const lang = panel.querySelector("[data-dlg-tool-lang]")?.value || "English";
      const text = panel.querySelector("[data-dlg-tool-text]")?.value || "";
      const mode = panel.querySelector("[data-dlg-tool-mode]")?.value || "says";
      if (!String(text).trim()) {
        setStatus("请先填写台词");
        return;
      }
      const d = {
        ...emptyDialogue(),
        speaker: stripSpeakerSx(speaker),
        lang,
        text: text.trim(),
        mode,
        offScreen: mode === "says" && !!panel.querySelector("[data-dlg-tool-off]")?.checked,
        scenetrans: !!panel.querySelector("[data-dlg-tool-scenetrans]")?.checked,
        cutoff: !!panel.querySelector("[data-dlg-tool-cutoff]")?.checked,
      };
      const probeBody =
        mode.includes("together")
          ? `${d.speaker || "the speakers"} say together, <d>[${lang}] ${d.text}</d>`
          : mode === "sings"
            ? `${d.speaker || "a speaker"} sings: <d>[${lang}] ${d.text}</d>`
            : `${d.speaker || "a speaker"} says: <d>[${lang}] ${d.text}</d>`;
      const probe = {
        shots: state.shots.map((s) =>
          s.id === shotId ? { ...s, body: `${s.body || ""} ${probeBody}` } : s
        ),
      };
      const map = speakerIdMap(probe);
      const clause = buildDialogueClause(d, map);
      insertIntoShotBody(shotId, clause);
      closeToolPanels();
      return;
    }
    if (e.target.closest("[data-tool-close]")) closeToolPanels();
  };
}

function openAuTool(shotId) {
  if (!window.AuPicker) {
    setStatus("AU 选脸器未加载");
    return;
  }
  // 先聚焦正文，便于记住光标；打开后再插入
  const el = getShotBodyEl(shotId);
  if (el) el.focus();
  AuPicker.open(shotId, (sid, text) => {
    insertIntoShotBody(sid, text);
    setStatus("已插入 AU 表情英文描述");
  });
}

function openSfxTool(shotId) {
  const panel = document.querySelector(`[data-tool-panel="${shotId}"]`);
  if (!panel) return;
  closeToolPanels();
  panel.hidden = false;
  const presets = [
    "Rain taps against the glass.",
    "Soft footsteps approach from behind.",
    "A low carriage rumble continues underneath.",
    "Wind rustles through the leaves.",
  ];
  panel.innerHTML = `<div class="tool-panel-inner">
    <div class="tool-panel-title">插入画内声</div>
    <div class="tool-chip-row">
      ${presets.map((p) => `<button type="button" class="tt-chip" data-insert-sfx="${escapeAttr(p)}">${escapeHtml(p)}</button>`).join("")}
    </div>
    <label class="stack-field"><span>或手写</span>
      <input type="text" data-sfx-custom placeholder="脚步、雨声、道具撞击…" />
    </label>
    <div class="tool-panel-actions">
      <button type="button" class="m3td-btn" data-sfx-insert-custom>插入手写</button>
      <button type="button" class="m3td-btn" data-tool-close>关闭</button>
    </div>
  </div>`;
  panel.onclick = (e) => {
    const chip = e.target.closest("[data-insert-sfx]");
    if (chip) {
      insertIntoShotBody(shotId, chip.dataset.insertSfx);
      closeToolPanels();
      return;
    }
    if (e.target.closest("[data-sfx-insert-custom]")) {
      let t = (panel.querySelector("[data-sfx-custom]")?.value || "").trim();
      if (!t) return;
      if (!/[.!?]$/.test(t)) t += ".";
      insertIntoShotBody(shotId, t);
      closeToolPanels();
      return;
    }
    if (e.target.closest("[data-tool-close]")) closeToolPanels();
  };
}

function renderSound() {
  document.getElementById("soundscape").value = state.soundscape || "";
  document.getElementById("music").value = state.music || "";
}

function renderPreview() {
  const out = buildFormatterOutput(state);
  document.getElementById("preview-body").textContent = out.prompt;
  const meta = modeMeta(state);
  document.getElementById("preview-meta").textContent =
    `${out.prompt_pack.mode} · ${meta.format === "ref" ? "六字段" : "三字段"} · ${state.shots.length} 镜 · ${out.duration}s`;

  // 若已经校验过，随编辑刷新结果（不强制展开）
  const vp = document.getElementById("validate-panel");
  if (vp?.querySelector(".vp-title")) renderValidatePanel(validateState(state), { forceShow: true });

  updateAppearHints();
}

/** 不重绘整卡，只刷新「出现镜号（自动）」提示，避免打字时丢焦点 */
function updateAppearHints() {
  if (!isRef(state)) return;
  state.subjects.forEach((s, i) => {
    const el = document.querySelector(`[data-subj="${s.id}"] .appear-auto`);
    if (!el) return;
    const a = autoAppearForSubject(state, i);
    el.textContent = a ? `出现镜号（自动）：${a}` : "出现镜号（自动）：分镜里用 @ 插入本 Subject 后自动汇总";
  });
  state.refs.forEach((r) => {
    if (!isStandaloneRef(r)) return;
    const el = document.querySelector(`[data-ref="${r.id}"] .appear-auto`);
    if (!el) return;
    const a = autoAppearForRef(state, r);
    el.textContent = a ? `出现镜号（自动）：${a}` : "出现镜号（自动）：分镜里尚未写到本标签";
  });
}

function renderOutputSlots() {
  const el = document.getElementById("output-slots");
  if (!el) return;
  el.innerHTML = [
    `<div class="cz-slot number active"><i></i><span>duration · FLOAT</span></div>`,
    `<div class="cz-slot string active"><i></i><span>prompt · STRING</span></div>`,
    `<div class="cz-slot custom active"><i></i><span>prompt_pack · H3_PROMPT_PACK</span></div>`,
  ].join("");
}

/* —— @ mention —— */
function resolveMentionTarget(targetKey) {
  const colon = String(targetKey || "").indexOf(":");
  if (colon < 0) return { type: "", id: "", el: null };
  const type = targetKey.slice(0, colon);
  const id = targetKey.slice(colon + 1);
  let el = null;
  if (type === "subj-text") el = document.querySelector(`[data-subj-text="${CSS.escape ? CSS.escape(id) : id}"]`);
  else if (type === "shot-visual" || type === "shot-body") {
    el =
      document.querySelector(`[data-shot-body="${CSS.escape ? CSS.escape(id) : id}"]`) ||
      document.querySelector(`[data-shot-visual="${CSS.escape ? CSS.escape(id) : id}"]`);
  } else if (type === "summary") {
    el = document.getElementById("summary-body");
  }
  return { type, id, el };
}

function placeMentionMenu(anchorBtn, menu) {
  const rect = anchorBtn.getBoundingClientRect();
  const menuW = Math.min(320, window.innerWidth - 16);
  const menuH = Math.min(240, window.innerHeight - 16);
  let left = rect.left;
  let top = rect.bottom + 4;
  if (left + menuW > window.innerWidth - 8) left = Math.max(8, window.innerWidth - menuW - 8);
  if (top + Math.min(180, menuH) > window.innerHeight - 8) {
    top = Math.max(8, rect.top - 4 - Math.min(180, menuH));
  }
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${top}px`;
  menu.style.zIndex = "100000";
}

function openMentionMenu(anchorBtn, targetKey, evt) {
  if (evt) {
    evt.preventDefault();
    evt.stopPropagation();
  }
  if (!isRef(state)) {
    setStatus("仅 Ref2VA 可 @ 插入引用/Subject 标签");
    return;
  }
  const menu = document.getElementById("mention-menu");
  if (!menu) {
    setStatus("@ 菜单节点缺失");
    return;
  }
  // 确保挂在 body，避免被 overflow 裁切
  if (menu.parentElement !== document.body) document.body.appendChild(menu);

  const items = allMentionItems(state);
  if (!items.length) {
    setStatus("还没有可 @ 的引用/Subject，请先添加");
    return;
  }
  const { type, id, el } = resolveMentionTarget(targetKey);
  if (!el) {
    setStatus(`@ 找不到输入框（${targetKey}）`);
    console.warn("[h3-formatter] mention target missing", targetKey);
    return;
  }

  mentionCtx = { el, type, id };
  menu.hidden = false;
  menu.innerHTML = items
    .map((it) => `<button type="button" data-insert="${escapeAttr(it.insert)}">${escapeHtml(it.label)}</button>`)
    .join("");
  placeMentionMenu(anchorBtn, menu);
  setStatus(`选择要插入的标签（${items.length}）`);
}

function insertMention(text) {
  if (!mentionCtx?.el) return;
  const el = mentionCtx.el;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const before = el.value.slice(0, start);
  const after = el.value.slice(end);
  const pad = before && !/\s$/.test(before) ? " " : "";
  el.value = before + pad + text + " " + after;

  if (el.dataset.shotBody) {
    const shot = state.shots.find((s) => s.id === el.dataset.shotBody);
    if (shot) shot.body = el.value;
  }
  if (el.dataset.subjText) {
    const s = state.subjects.find((x) => x.id === el.dataset.subjText);
    if (s) s.text = el.value;
  }
  if (el.id === "summary-body" || mentionCtx.type === "summary") {
    state.summaryBody = el.value;
  }

  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.focus();
  const caret = Math.min((before + pad + text + " ").length, el.value.length);
  try {
    el.setSelectionRange(caret, caret);
  } catch (_) { /* ignore */ }
  hideMention();
  saveState();
  renderPreview();
  setStatus(`已插入 ${text}`);
}

function hideMention() {
  const menu = document.getElementById("mention-menu");
  if (menu) {
    menu.hidden = true;
    menu.innerHTML = "";
  }
  mentionCtx = null;
}

/* —— events —— */
function bind() {
  const bindCollapse = (root) => {
    if (!root) return;
    root.addEventListener("click", (e) => {
      if (e.target.closest("[data-no-collapse]")) return;
      if (e.target.closest("button.m3td-btn") && !e.target.closest("[data-collapse-toggle]")) return;
      const head = e.target.closest("[data-collapse-toggle]");
      if (!head) return;
      const block = head.closest(".block.collapsible[data-sec]");
      if (!block) return;
      toggleSectionCollapse(block.dataset.sec);
    });
    root.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const head = e.target.closest("[data-collapse-toggle]");
      if (!head) return;
      e.preventDefault();
      const block = head.closest(".block.collapsible[data-sec]");
      if (block) toggleSectionCollapse(block.dataset.sec);
    });
  };
  bindCollapse(document.querySelector(".work-left"));
  bindCollapse(document.querySelector(".work-right"));

  document.getElementById("mode-tabs").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-mode]");
    if (!btn) return;
    state.mode = btn.dataset.mode;
    if (isRef(state)) {
      if (!state.taskTypes.length) state.taskTypes = ["reference generation"];
      if (!state.refs.length) {
        state.refs = [{ id: uid(), kind: "picture", note: "", role: "subject_only" }];
      }
      if (!state.subjects.length) {
        state.subjects = [{
          id: uid(),
          name: "",
          text: "",
          binds: [],
          retain: "fully_preserved",
          retainNote: "",
        }];
      }
    } else {
      hideMention();
    }
    setStatus(`模式：${modeMeta(state).label}`);
    render();
  });

  document.getElementById("task-types").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-tt]");
    if (!btn) return;
    const id = btn.dataset.tt;
    const set = new Set(selectedTaskTypes(state));
    if (set.has(id)) {
      if (set.size > 1) set.delete(id);
    } else set.add(id);
    state.taskTypes = [...set];
    setStatus(`任务类型：[${state.taskTypes.join(" + ")}]`);
    render();
  });

  document.getElementById("total-duration").addEventListener("change", (e) => {
    let v = Number(e.target.value);
    if (!Number.isFinite(v) || v < 0.5) v = 6;
    state.duration = Math.round(v * 100) / 100;
    const last = state.shots[state.shots.length - 1];
    if (last) last.end = state.duration;
    render();
  });

  document.getElementById("btn-demo-bundle").addEventListener("click", () => {
    linkedBundle = demoMediaBundle();
    renderBundleStatus();
    setStatus("已加载示例素材包 · 再点「从素材包识别引用」");
  });

  document.getElementById("btn-import-bundle").addEventListener("click", () => {
    // 向 Comfy 父页要最新接线再识别，避免用过期的 linkedBundle
    if (IS_EMBED) {
      window.parent.postMessage({ type: "h3-formatter-request-import" }, "*");
      setStatus("正在按当前接线同步引用…");
      return;
    }
    if (!linkedBundle) {
      setStatus("请先连接素材包，或点「加载示例包」");
      return;
    }
    try {
      const r = applyMediaBundle(linkedBundle);
      saveState();
      render();
      const bits = [`模式 ${modeMeta(state).label}`];
      if (r.added) bits.push(`新增 ${r.added}`);
      if (r.updated) bits.push(`保留更新 ${r.updated}`);
      if (r.removed) bits.push(`移除断开 ${r.removed}`);
      if (!r.added && !r.updated && !r.removed) bits.push("无变化");
      setStatus(`识别完成 · ${bits.join(" · ")}（已填内容会保留）`);
    } catch (err) {
      setStatus(`识别失败：${err?.message || err}`);
    }
  });

  document.querySelector("#block-refs .defs-toolbar").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-add-ref]");
    if (!btn) return;
    const kind = btn.dataset.addRef;
    state.refs.push({
      id: uid(),
      kind,
      note: "",
      role: defaultRoleForKind(kind),
      retain: defaultRetainForRef({ kind, role: defaultRoleForKind(kind) }),
      retainNote: "",
    });
    render();
  });

  document.getElementById("refs-list").addEventListener("input", (e) => {
    const t = e.target;
    if (t.matches("[data-ref-note]")) {
      const r = state.refs.find((x) => x.id === t.dataset.refNote);
      if (r) r.note = t.value;
      saveState();
      renderPreview();
      renderOutputSlots();
    }
    if (t.matches("[data-ref-retain-note]")) {
      const r = state.refs.find((x) => x.id === t.dataset.refRetainNote);
      if (r) r.retainNote = t.value;
      saveState();
      renderPreview();
      renderOutputSlots();
    }
  });
  document.getElementById("refs-list").addEventListener("change", (e) => {
    const t = e.target;
    if (t.matches("[data-ref-role]")) {
      const r = state.refs.find((x) => x.id === t.dataset.refRole);
      if (r) {
        r.role = t.value;
        // 换用途时给更贴切的默认保真度（用户已手改过可仍覆盖为默认——更一致）
        r.retain = defaultRetainForRef(r);
      }
      render();
    }
    if (t.matches("[data-ref-retain]")) {
      const r = state.refs.find((x) => x.id === t.dataset.refRetain);
      if (r) r.retain = t.value;
      saveState();
      renderPreview();
      renderOutputSlots();
    }
  });
  document.getElementById("refs-list").addEventListener("click", (e) => {
    const up = e.target.closest("[data-ref-up]");
    if (up && !up.disabled) {
      if (moveRefAmongKind(up.dataset.refUp, -1)) {
        setStatus(`已上移 · ${refTag(state, up.dataset.refUp) || ""}`);
        render();
      }
      return;
    }
    const down = e.target.closest("[data-ref-down]");
    if (down && !down.disabled) {
      if (moveRefAmongKind(down.dataset.refDown, 1)) {
        setStatus(`已下移 · ${refTag(state, down.dataset.refDown) || ""}`);
        render();
      }
      return;
    }
    const del = e.target.closest("[data-del-ref]");
    if (!del) return;
    const id = del.dataset.delRef;
    state.refs = state.refs.filter((r) => r.id !== id);
    state.subjects.forEach((s) => {
      s.binds = (s.binds || []).filter((b) => b.refId !== id);
    });
    render();
  });

  document.getElementById("btn-add-subject").addEventListener("click", () => {
    state.subjects.push({
      id: uid(),
      name: "",
      text: "",
      binds: [],
      retain: "fully_preserved",
      retainNote: "",
    });
    render();
  });

  document.getElementById("subjects-list").addEventListener("input", (e) => {
    const t = e.target;
    if (t.matches("[data-subj-name]")) {
      const s = state.subjects.find((x) => x.id === t.dataset.subjName);
      if (s) s.name = t.value;
      saveState();
      renderPreview();
      renderOutputSlots();
    }
    if (t.matches("[data-subj-text]")) {
      const s = state.subjects.find((x) => x.id === t.dataset.subjText);
      if (s) s.text = t.value;
      saveState();
      renderPreview();
      renderOutputSlots();
    }
    if (t.matches("[data-subj-retain-note]")) {
      const s = state.subjects.find((x) => x.id === t.dataset.subjRetainNote);
      if (s) s.retainNote = t.value;
      saveState();
      renderPreview();
      renderOutputSlots();
    }
  });

  document.getElementById("subjects-list").addEventListener("change", (e) => {
    const t = e.target;
    if (t.matches("[data-subj-retain]")) {
      const s = state.subjects.find((x) => x.id === t.dataset.subjRetain);
      if (s) s.retain = t.value;
      saveState();
      renderPreview();
      renderOutputSlots();
    }
    if (t.matches("[data-bind-aspect]") || t.matches("[data-bind-ref]")) {
      const sid = t.dataset.bindAspect || t.dataset.bindRef;
      const i = Number(t.dataset.bindI);
      const s = state.subjects.find((x) => x.id === sid);
      if (!s || !s.binds[i]) return;
      if (t.matches("[data-bind-aspect]")) s.binds[i].aspect = t.value;
      if (t.matches("[data-bind-ref]")) s.binds[i].refId = t.value;
      render();
    }
  });

  document.getElementById("subjects-list").addEventListener("click", (e) => {
    const add = e.target.closest("[data-add-bind]");
    if (add) {
      const s = state.subjects.find((x) => x.id === add.dataset.addBind);
      if (!s) return;
      s.binds = s.binds || [];
      s.binds.push({ aspect: "appearance", refId: state.refs[0]?.id || "" });
      render();
      return;
    }
    const delB = e.target.closest("[data-del-bind]");
    if (delB) {
      const s = state.subjects.find((x) => x.id === delB.dataset.delBind);
      if (!s) return;
      s.binds.splice(Number(delB.dataset.bindI), 1);
      render();
      return;
    }
    const delS = e.target.closest("[data-del-subj]");
    if (delS) {
      state.subjects = state.subjects.filter((x) => x.id !== delS.dataset.delSubj);
      render();
      return;
    }
    const draft = e.target.closest("[data-draft-retain]");
    if (draft) {
      const s = state.subjects.find((x) => x.id === draft.dataset.draftRetain);
      if (!s) return;
      s.retainNote = draftRetainNoteFromBinds(state, s);
      setStatus("已根据绑定生成保留说明");
      render();
      return;
    }
    const at = e.target.closest("[data-at-target]");
    if (at) {
      openMentionMenu(at, at.dataset.atTarget, e);
      return;
    }
  });

  document.getElementById("summary-body").addEventListener("input", (e) => {
    state.summaryBody = e.target.value;
    saveState();
    renderPreview();
    renderOutputSlots();
  });

  document.getElementById("style-opening").addEventListener("input", (e) => {
    state.styleOpening = e.target.value;
    saveState();
    renderPreview();
    renderOutputSlots();
    const chips = document.getElementById("style-chips");
    if (chips) {
      chips.querySelectorAll("[data-style-chip]").forEach((btn) => {
        btn.classList.toggle("on", btn.dataset.styleChip === state.styleOpening);
      });
    }
  });

  document.getElementById("wrap-style-opening")?.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-style-chip]");
    if (!chip) return;
    e.preventDefault();
    state.styleOpening = chip.dataset.styleChip || "";
    const styleEl = document.getElementById("style-opening");
    if (styleEl) styleEl.value = state.styleOpening;
    saveState();
    renderStyleField();
    renderPreview();
    renderOutputSlots();
    setStatus(`风格：${state.styleOpening}`);
  });

  document.getElementById("btn-add-shot").addEventListener("click", () => {
    syncShotEnds(state);
    const last = state.shots[state.shots.length - 1];
    const MAX = 15;
    const CHUNK = 2;
    let dur = Math.max(0.5, Number(state.duration) || 6);

    if (!last) {
      state.shots.push(emptyShot(0, dur));
      setStatus("已加 Shot 1");
      render();
      return;
    }

    // 优先：延长总时长，在末尾追加新段（最后一段原先已贴齐 duration）
    if (dur + 0.5 <= MAX) {
      const add = Math.min(CHUNK, MAX - dur);
      const newDur = Math.round((dur + add) * 100) / 100;
      state.shots.push(emptyShot(dur, newDur));
      state.duration = newDur;
      setStatus(`已加 Shot ${state.shots.length}（总时长 → ${newDur}s）`);
      render();
      return;
    }

    // 已到上限：把最后一段劈成两半
    const span = Number(last.end) - Number(last.start);
    if (span < 1) {
      setStatus("总时长已满且最后一段过短，无法再加段");
      return;
    }
    const mid = Math.round((Number(last.start) + span / 2) * 100) / 100;
    const end = Number(last.end);
    last.end = mid;
    state.shots.push(emptyShot(mid, end));
    setStatus(`已加 Shot ${state.shots.length}（从末段对半拆出）`);
    render();
  });

  const shotRoot = document.getElementById("shot-list");

  function moveShot(id, dir) {
    const i = state.shots.findIndex((s) => s.id === id);
    const j = i + Number(dir);
    if (i < 0 || j < 0 || j >= state.shots.length) return;
    const tmp = state.shots[i];
    state.shots[i] = state.shots[j];
    state.shots[j] = tmp;
    const durs = state.shots.map((s) => Math.max(0.2, Number(s.end) - Number(s.start)));
    let t = 0;
    state.shots.forEach((s, idx) => {
      s.start = t;
      s.end = t + durs[idx];
      t = s.end;
    });
    state.duration = t;
    render();
  }

  shotRoot.addEventListener("input", (e) => {
    const t = e.target;
    if (t.matches("[data-shot-body]")) {
      const shot = state.shots.find((s) => s.id === t.dataset.shotBody);
      if (shot) shot.body = t.value;
      saveState();
      renderPreview();
      renderOutputSlots();
    }
  });

  shotRoot.addEventListener("change", (e) => {
    const t = e.target;
    if (t.matches("[data-shot-start]")) {
      const shot = state.shots.find((s) => s.id === t.dataset.shotStart);
      if (shot) shot.start = Number(t.value);
      render();
    }
    if (t.matches("[data-shot-end]")) {
      const shot = state.shots.find((s) => s.id === t.dataset.shotEnd);
      if (shot) shot.end = Number(t.value);
      const idx = state.shots.indexOf(shot);
      if (idx >= 0 && state.shots[idx + 1]) state.shots[idx + 1].start = Number(shot.end);
      if (idx === state.shots.length - 1) state.duration = Number(shot.end);
      render();
    }
  });

  shotRoot.addEventListener("click", (e) => {
    const del = e.target.closest("[data-del-shot]");
    if (del) {
      state.shots = state.shots.filter((s) => s.id !== del.dataset.delShot);
      render();
      return;
    }
    const move = e.target.closest("[data-move-shot]");
    if (move) {
      moveShot(move.dataset.moveShot, move.dataset.dir);
      return;
    }
    const tool = e.target.closest("[data-tool]");
    if (tool) {
      const sid = tool.dataset.shotId;
      const kind = tool.dataset.tool;
      if (kind === "cam") openCamTool(sid);
      else if (kind === "timing") openTimingTool(sid);
      else if (kind === "dlg") openDlgTool(sid);
      else if (kind === "sfx") openSfxTool(sid);
      else if (kind === "au") openAuTool(sid);
      else if (kind === "at") openMentionMenu(tool, tool.dataset.atTarget || `shot-body:${sid}`, e);
      return;
    }
    const at = e.target.closest("[data-at-target]");
    if (at && !at.matches("[data-tool]")) {
      openMentionMenu(at, at.dataset.atTarget, e);
      return;
    }
    const card = e.target.closest("[data-shot]");
    if (card && !e.target.closest(".tool-panel") && !e.target.closest("textarea") && !e.target.closest("input")) {
      state.selectedShotId = card.dataset.shot;
      document.querySelectorAll(".shot-card").forEach((c) => c.classList.toggle("selected", c.dataset.shot === state.selectedShotId));
      renderTimelineTrack();
    }
  });

  // 分镜卡片把手：拖拽重排
  let dragShotId = null;
  shotRoot.addEventListener("dragstart", (e) => {
    const handle = e.target.closest("[data-drag-shot]");
    if (!handle) return;
    dragShotId = handle.dataset.dragShot;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", dragShotId);
  });
  shotRoot.addEventListener("dragover", (e) => {
    const card = e.target.closest("[data-shot]");
    if (!card || !dragShotId) return;
    e.preventDefault();
    card.classList.add("drag-over");
  });
  shotRoot.addEventListener("dragleave", (e) => {
    const card = e.target.closest("[data-shot]");
    if (card) card.classList.remove("drag-over");
  });
  shotRoot.addEventListener("drop", (e) => {
    const card = e.target.closest("[data-shot]");
    if (!card || !dragShotId) return;
    e.preventDefault();
    card.classList.remove("drag-over");
    const from = state.shots.findIndex((s) => s.id === dragShotId);
    const to = state.shots.findIndex((s) => s.id === card.dataset.shot);
    dragShotId = null;
    if (from < 0 || to < 0 || from === to) return;
    const [item] = state.shots.splice(from, 1);
    state.shots.splice(to, 0, item);
    const durs = state.shots.map((s) => Math.max(0.2, Number(s.end) - Number(s.start)));
    let t = 0;
    state.shots.forEach((s, idx) => {
      s.start = t;
      s.end = t + durs[idx];
      t = s.end;
    });
    state.duration = t;
    render();
  });

  // 时间轴：拖右缘改切点
  const track = document.getElementById("timeline-track");
  let resizeCtx = null;
  track.addEventListener("pointerdown", (e) => {
    const handle = e.target.closest("[data-tl-resize]");
    const seg = e.target.closest("[data-tl-shot]");
    if (handle) {
      const shot = state.shots.find((s) => s.id === handle.dataset.tlResize);
      if (!shot) return;
      const idx = state.shots.indexOf(shot);
      resizeCtx = { shotId: shot.id, idx, startX: e.clientX, origEnd: Number(shot.end) };
      track.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    if (seg) {
      state.selectedShotId = seg.dataset.tlShot;
      renderTimelineTrack();
      document.querySelectorAll(".shot-card").forEach((c) => c.classList.toggle("selected", c.dataset.shot === state.selectedShotId));
    }
  });
  track.addEventListener("pointermove", (e) => {
    if (!resizeCtx) return;
    const dur = Math.max(0.5, Number(state.duration) || 6);
    const rect = track.getBoundingClientRect();
    const dx = e.clientX - resizeCtx.startX;
    const dSec = (dx / rect.width) * dur;
    const shot = state.shots[resizeCtx.idx];
    if (!shot) return;
    const minEnd = Number(shot.start) + 0.2;
    let newEnd = Math.round((resizeCtx.origEnd + dSec) * 100) / 100;
    if (resizeCtx.idx < state.shots.length - 1) {
      const next = state.shots[resizeCtx.idx + 1];
      const maxEnd = Number(next.end) - 0.2;
      newEnd = Math.min(Math.max(newEnd, minEnd), maxEnd);
      shot.end = newEnd;
      next.start = newEnd;
    } else {
      newEnd = Math.max(newEnd, minEnd);
      shot.end = newEnd;
      state.duration = newEnd;
      document.getElementById("total-duration").value = state.duration;
    }
    renderTimelineTrack();
    if (resizeCtx.idx === state.shots.length - 1) {
      document.getElementById("total-duration").value = state.duration;
    }
  });
  track.addEventListener("pointerup", () => {
    if (!resizeCtx) return;
    resizeCtx = null;
    render();
  });
  track.addEventListener("pointercancel", () => {
    resizeCtx = null;
  });

  document.getElementById("soundscape").addEventListener("input", (e) => {
    state.soundscape = e.target.value;
    saveState();
    renderPreview();
    renderOutputSlots();
  });
  document.getElementById("music").addEventListener("input", (e) => {
    state.music = e.target.value;
    saveState();
    renderPreview();
    renderOutputSlots();
  });

  document.getElementById("mention-menu").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-insert]");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    insertMention(btn.dataset.insert);
  });

  // 用 pointerdown 关闭，避免与「打开菜单」的同一次 click 打架
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (!document.getElementById("mention-menu") || document.getElementById("mention-menu").hidden) return;
      if (e.target.closest("#mention-menu")) return;
      if (e.target.closest("[data-at-target]") || e.target.closest('[data-tool="at"]')) return;
      hideMention();
    },
    true
  );

  // summary 上的 @（subjects 区块外也兜底）
  document.getElementById("btn-summary-at")?.addEventListener("click", (e) => {
    openMentionMenu(e.currentTarget, "summary:body", e);
  });

  document.getElementById("btn-copy-full").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(buildFormatterOutput(state).prompt);
      setStatus("已复制全文");
    } catch {
      setStatus("复制失败，请手动选中预览区");
    }
  });

  document.getElementById("btn-validate").addEventListener("click", () => {
    runValidate();
  });

  document.getElementById("btn-save-json").addEventListener("click", () => {
    const payload = buildExportPayload();
    const mode = payload.output?.mode || state.mode || "h3";
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    downloadJson(`h3-formatter-${mode}-${stamp}.json`, payload);
    setStatus("已导出 JSON");
  });

  document.getElementById("btn-load-json").addEventListener("click", () => {
    document.getElementById("json-file-input")?.click();
  });

  document.getElementById("json-file-input").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      importStateFromJsonText(text);
      runValidate({ silentOk: true });
      setStatus(`已加载：${file.name}`);
    } catch (err) {
      setStatus(`加载失败：${err?.message || "JSON 无效"}`);
      console.error(err);
    }
  });

  document.getElementById("btn-reset").addEventListener("click", () => {
    state = defaultState();
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem("h3-prompt-formatter-lab-v4");
    localStorage.removeItem("h3-prompt-formatter-lab-v3");
    renderValidatePanel(null);
    setStatus("已重置");
    render();
  });
}

bind();
if (window.AuPicker) {
  AuPicker.bind();
  const presets = document.getElementById("au-presets");
  if (presets) presets.innerHTML = AuPicker.presetButtonsHtml();
}
render();

/* —— Comfy 父页面桥 —— */
window.addEventListener("message", (event) => {
  const data = event?.data;
  if (!data || data.type !== "h3-formatter-parent") return;
  if (data.action === "setState") {
    try {
      const raw = typeof data.form_state === "string" ? JSON.parse(data.form_state || "{}") : data.form_state;
      state = hydrateStateFromObject(raw || {});
      renderValidatePanel(null);
      render();
      notifyComfyParent();
    } catch (err) {
      console.warn("[h3-formatter] setState failed", err);
    }
    return;
  }
  if (data.action === "setBundle") {
    const wantImport = Boolean(data.autoImport);
    linkedBundle = data.bundle || null;
    renderBundleStatus();
    if (!wantImport) return;

    try {
      let r;
      if (!linkedBundle || !linkedBundle.manifest) {
        r = clearBundleLinkedRefs();
      } else {
        r = applyMediaBundle(linkedBundle);
      }
      saveState();
      render();
      const bits = [`模式 ${modeMeta(state).label}`];
      if (r.added) bits.push(`+${r.added}`);
      if (r.updated) bits.push(`~${r.updated}`);
      if (r.removed) bits.push(`-${r.removed}`);
      if (!r.added && !r.updated && !r.removed) bits.push("无变化");
      setStatus(`已同步引用 · ${bits.join(" · ")}`);
    } catch (err) {
      setStatus(`识别失败：${err?.message || err}`);
    }
    return;
  }
  if (data.action === "ping") {
    window.parent.postMessage({ type: "h3-formatter-ready" }, "*");
  }
});

if (IS_EMBED) {
  window.parent.postMessage({ type: "h3-formatter-ready" }, "*");
  notifyComfyParent();
}
