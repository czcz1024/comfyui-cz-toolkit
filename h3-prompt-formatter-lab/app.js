/**
 * H3 提示词排版台 · HTML Lab
 * - 模式：T2VA / I2VA / FL2VA / L2VA / Ref2VA
 * - Ref：先定义引用(Picture/Video/Audio)，再定义 Subject（绑定 / @）
 * - 分镜：画面、运镜、对白、画内声等字段 → 排版成官方句式
 */

const STORAGE_KEY = "h3-prompt-formatter-lab-v5";

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

const CAM_PRESETS = [
  { zh: "（自选/手写）", en: "" },
  { zh: "固定镜头", en: "The camera holds a static shot" },
  { zh: "小幅慢速推镜", en: "The camera pushes in with small amplitude at slow speed" },
  { zh: "小幅慢速拉镜", en: "The camera pulls out with small amplitude at slow speed" },
  { zh: "左摇", en: "The camera pans left" },
  { zh: "右摇", en: "The camera pans right" },
  { zh: "左移", en: "The camera trucks left" },
  { zh: "右移", en: "The camera trucks right" },
  { zh: "上仰", en: "The camera tilts up" },
  { zh: "下俯", en: "The camera tilts down" },
  { zh: "跟拍移动主体", en: "The camera tracks the moving subject" },
  { zh: "变焦推进", en: "The camera zooms in" },
  { zh: "变焦拉远", en: "The camera zooms out" },
  { zh: "环绕", en: "The camera moves in an arc around the subject" },
  { zh: "轻微晃动", en: "The camera shakes slightly" },
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

const FIELD_LABEL_ZH = {
  form_state: "表单状态",
  full_prompt: "完整提示词",
  alignment: "开头对齐句",
  integrated_multimodal_description: "视听一体描述（时间线正文）",
  overall_soundscape: "整体环境声",
  non_diegetic_music: "非叙事配乐（观众层）",
  subject_definitions: "主体/素材定义",
  summary: "任务摘要",
  retention_analysis: "保真度分析",
  detailed_description: "逐镜详细描述",
};

function fieldLabel(key) {
  if (/^shot_\d+$/.test(key)) return `${key} · 第 ${key.slice(5)} 镜`;
  const zh = FIELD_LABEL_ZH[key];
  return zh ? `${key} · ${zh}` : key;
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
  const re = /([^.\n]+?)\s+says(?:\s+in\s+an\s+off-screen\s+voiceover)?\s*:/gi;
  state.shots.forEach((shot) => {
    const body = String(shot.body || "");
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(body))) {
      const base = stripSpeakerSx(m[1]);
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

/** 把正文里「名字 says:」统一成带 (Sx) 的形式（已有则改编号） */
function applySpeakerIdsToBody(body, map) {
  return String(body || "").replace(
    /([^.\n]+?)\s+says(\s+in\s+an\s+off-screen\s+voiceover)?\s*:/gi,
    (full, who, off) => {
      const base = stripSpeakerSx(who);
      if (!base) return full;
      const sx = map.get(base) || "S1";
      return `${base} (${sx}) says${off || ""}:`;
    }
  );
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
  if (r.kind === "video" || r.kind === "audio") return true;
  if (r.role === "keyframe" || r.role === "source" || r.standalone === true) return true;
  return false;
}

function defaultRetainForRef(r) {
  if (r?.kind === "audio") return "reference";
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
  if (ref.kind === "picture" && ref.role === "keyframe") {
    const n = hits[0] || 1;
    return `[Shot ${n}] first frame`;
  }
  if (hits.length) return formatAppearsIn(hits);
  if (ref.kind === "video") return "cut and pacing structure";
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
  // 仅当引用需要单独成行（如源视频、关键帧图）时输出；纯被 Subject 引用的图可不单独列。
  const lines = [];
  state.refs.forEach((r) => {
    if (!isStandaloneRef(r)) return;
    const tag = refTag(state, r.id);
    const note = String(r.note || "").trim();
    if (r.kind === "video" && !note) {
      lines.push(`${tag} is the source video for the target video.`);
    } else if (r.kind === "audio" && !note) {
      lines.push(`${tag} is an audio reference.`);
    } else {
      lines.push(note ? `${tag} ${note.startsWith("is ") ? note : "is " + note}` : `${tag} is (请填写定义).`);
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
  const who = formatSpeakerForOutput(d.speaker, map);
  let clause;
  if (d.offScreen) {
    clause = `${who} says in an off-screen voiceover: <d>[${lang}] ${text}</d> The corresponding on-screen character's lips remain completely closed.`;
  } else {
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

/* —— state —— */
let state = loadState();
let mentionCtx = null; // { el, start, end }

function loadState() {
  try {
    const raw = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ||
        localStorage.getItem("h3-prompt-formatter-lab-v4") ||
        localStorage.getItem("h3-prompt-formatter-lab-v3") ||
        "null"
    );
    if (!raw || typeof raw !== "object") return defaultState();
    const merged = { ...defaultState(), ...raw };
    if (!MODES.some((m) => m.id === merged.mode)) merged.mode = "t2va";
    merged.shots = (Array.isArray(merged.shots) && merged.shots.length ? merged.shots : defaultShots()).map(normalizeShot);
    merged.refs = Array.isArray(merged.refs) ? merged.refs : [];
    merged.subjects = Array.isArray(merged.subjects) ? merged.subjects : [];
    // 迁移旧 defs
    if (Array.isArray(raw.defs) && raw.defs.length && !merged.refs.length && !merged.subjects.length) {
      raw.defs.forEach((d) => {
        if (d.kind === "subject") merged.subjects.push({ id: d.id || uid(), name: "", text: d.text || "", binds: [] });
        else merged.refs.push({ id: d.id || uid(), kind: d.kind || "picture", note: d.text || "", role: "subject_only" });
      });
    }
    if (!Array.isArray(merged.taskTypes) || !merged.taskTypes.length) merged.taskTypes = ["reference generation"];
    merged.styleOpening = merged.styleOpening || "";
    return merged;
  } catch {
    return defaultState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
function render() {
  syncShotEnds(state);
  renderModes();
  renderTaskTypes();
  renderHint();
  renderRefs();
  renderSubjects();
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
    list.innerHTML = `<div class="muted">先添加 Picture / Video / Audio。编号按类型自动排（Picture 1、Video 1…）。采样时你再把对应口接到真正素材。</div>`;
    return;
  }

  list.innerHTML = state.refs
    .map((r) => {
      const tag = refTag(state, r.id);
      const role = r.role || (r.kind === "picture" ? "subject_only" : "source");
      const showRetain = isStandaloneRef(r);
      const retain = r.retain || defaultRetainForRef(r);
      const appearHint = autoAppearForRef(state, r);
      return `<div class="def-card ref-card" data-ref="${r.id}">
        <div class="def-side">
          <div class="tag">${tag}</div>
          <select data-ref-kind="${r.id}">
            ${["picture", "video", "audio"].map((k) => `<option value="${k}" ${r.kind === k ? "selected" : ""}>${capitalizeKind(k)}</option>`).join("")}
          </select>
          <select data-ref-role="${r.id}" title="用途">
            <option value="subject_only" ${role === "subject_only" ? "selected" : ""}>仅供 Subject 引用</option>
            <option value="keyframe" ${role === "keyframe" ? "selected" : ""}>关键帧/构图锚点（单独成行）</option>
            <option value="source" ${role === "source" ? "selected" : ""}>源视频/独立素材（单独成行）</option>
          </select>
        </div>
        <div class="subj-body">
          <textarea data-ref-note="${r.id}" placeholder="说明这是什么素材（例：年轻女子半身照 / 咖啡馆源视频 / 女主音色）">${escapeHtml(r.note || "")}</textarea>
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
  const label = document.getElementById("style-opening-label");
  if (!styleEl || !styleWrap || !label) return;
  styleWrap.hidden = false;
  styleEl.value = state.styleOpening || "";
  if (isRef(state)) {
    label.innerHTML =
      'detailed_description 开场风格句<span class="muted"> · 写在 [Shot 1] <strong>之前</strong>，1～2 句英文</span>';
    styleEl.placeholder = "例：The target video uses a quiet realistic indoor style with soft window light.";
  } else {
    label.innerHTML =
      '整体风格<span class="muted"> · 自动拼到 [Shot 1] <strong>正文开头</strong>（T2VA / I2VA / FL2VA / L2VA）</span>';
    styleEl.placeholder = "例：Live-action, cinematic";
  }
}

function renderSubjects() {
  const block = document.getElementById("block-subjects");
  block.hidden = !isRef(state);
  renderStyleField();

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
            <button type="button" class="m3td-btn" data-tool="dlg" data-shot-id="${s.id}">对白</button>
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

function openCamTool(shotId, anchor) {
  const panel = document.querySelector(`[data-tool-panel="${shotId}"]`);
  if (!panel) return;
  closeToolPanels();
  panel.hidden = false;
  panel.innerHTML = `<div class="tool-panel-inner">
    <div class="tool-panel-title">选择运镜（插入英文句）</div>
    <div class="tool-chip-row">
      ${CAM_PRESETS.filter((c) => c.en)
        .map(
          (c) =>
            `<button type="button" class="tt-chip" data-insert-cam="${escapeAttr(c.en)}">${escapeHtml(c.zh)}</button>`
        )
        .join("")}
    </div>
    <label class="stack-field"><span>或手写运镜句</span>
      <input type="text" data-cam-custom placeholder="The camera pushes in with small amplitude at slow speed" />
    </label>
    <div class="tool-panel-actions">
      <button type="button" class="m3td-btn" data-cam-insert-custom>插入手写</button>
      <button type="button" class="m3td-btn" data-tool-close>关闭</button>
    </div>
  </div>`;
  panel.onclick = (e) => {
    const chip = e.target.closest("[data-insert-cam]");
    if (chip) {
      let t = chip.dataset.insertCam;
      if (t && !/[.!?]$/.test(t)) t += ".";
      insertIntoShotBody(shotId, t);
      closeToolPanels();
      return;
    }
    if (e.target.closest("[data-cam-insert-custom]")) {
      const inp = panel.querySelector("[data-cam-custom]");
      let t = (inp?.value || "").trim();
      if (!t) return;
      if (!/[.!?]$/.test(t)) t += ".";
      insertIntoShotBody(shotId, t);
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
    <div class="tool-panel-title">插入对白（生成官方句式后写入正文，可再改）</div>
    <div class="shot-grid-2">
      <label class="stack-field"><span>说话人</span>
        <input type="text" list="dlg-tool-speakers" data-dlg-tool-speaker placeholder="the young woman 或 &lt;Subject 1&gt;" />
        <datalist id="dlg-tool-speakers">${subjectOpts}</datalist>
      </label>
      <label class="stack-field"><span>语言</span>
        <select data-dlg-tool-lang>${LANGS.map((l) => `<option value="${escapeAttr(l.en)}">${escapeHtml(l.zh)}</option>`).join("")}</select>
      </label>
    </div>
    <label class="stack-field"><span>台词原文</span>
      <input type="text" data-dlg-tool-text placeholder="原文台词，不翻译" />
    </label>
    <div class="dlg-flags">
      <label><input type="checkbox" data-dlg-tool-off /> 旁白 off-screen</label>
      <label><input type="checkbox" data-dlg-tool-scenetrans /> 跨切点 &lt;scenetrans&gt;</label>
      <label><input type="checkbox" data-dlg-tool-cutoff /> 片尾 &lt;cutoff&gt;</label>
    </div>
    <div class="tool-panel-actions">
      <button type="button" class="m3td-btn" data-dlg-tool-insert>插入对白</button>
      <button type="button" class="m3td-btn" data-tool-close>关闭</button>
    </div>
  </div>`;
  panel.onclick = (e) => {
    if (e.target.closest("[data-dlg-tool-insert]")) {
      const speaker = panel.querySelector("[data-dlg-tool-speaker]")?.value || "";
      const lang = panel.querySelector("[data-dlg-tool-lang]")?.value || "English";
      const text = panel.querySelector("[data-dlg-tool-text]")?.value || "";
      if (!String(text).trim()) {
        setStatus("请先填写台词");
        return;
      }
      const d = {
        ...emptyDialogue(),
        speaker: stripSpeakerSx(speaker),
        lang,
        text: text.trim(),
        offScreen: !!panel.querySelector("[data-dlg-tool-off]")?.checked,
        scenetrans: !!panel.querySelector("[data-dlg-tool-scenetrans]")?.checked,
        cutoff: !!panel.querySelector("[data-dlg-tool-cutoff]")?.checked,
      };
      // 预览用当前全片 map + 本句
      const probe = {
        shots: state.shots.map((s) =>
          s.id === shotId ? { ...s, body: `${s.body || ""} ${d.speaker || "a speaker"} says: <d>[${lang}] ${d.text}</d>` } : s
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
  const packed = assemble(state);
  document.getElementById("preview-body").textContent = packed.full;
  const meta = modeMeta(state);
  document.getElementById("preview-meta").textContent =
    `${meta.format === "ref" ? "六字段" : "三字段"} · ${state.shots.length} 段 · ${Number(state.duration).toFixed(2)}s`;

  const outs = [{ name: "full_prompt", snip: packed.full }];
  Object.entries(packed.sections || {}).forEach(([k, v]) => {
    if (!v) return;
    outs.push({ name: k, snip: String(v) });
  });
  packed.shots.forEach((s) => outs.push({ name: s.name, snip: s.text }));

  document.getElementById("outputs-list").innerHTML = outs
    .map(
      (o) =>
        `<div class="out-row"><code>${escapeHtml(fieldLabel(o.name))}</code><span class="snip" title="${escapeAttr(o.snip)}">${escapeHtml(oneLine(o.snip))}</span></div>`
    )
    .join("");

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
  const packed = assemble(state);
  const names = ["full_prompt", ...Object.keys(packed.sections || {}), ...packed.shots.map((s) => s.name)];
  document.getElementById("output-slots").innerHTML = [...new Set(names)]
    .slice(0, 12)
    .map((n) => `<div class="cz-slot string active"><i></i><span>${escapeHtml(fieldLabel(n))}</span></div>`)
    .join("");
}

/* —— @ mention —— */
function openMentionMenu(anchorBtn, targetKey) {
  if (!isRef(state)) {
    setStatus("仅 Ref2VA 可 @ 插入引用/Subject 标签");
    return;
  }
  const menu = document.getElementById("mention-menu");
  const items = allMentionItems(state);
  if (!items.length) {
    setStatus("还没有可 @ 的引用/Subject");
    return;
  }
  const [type, id] = targetKey.split(":");
  let el = null;
  if (type === "subj-text") el = document.querySelector(`[data-subj-text="${id}"]`);
  if (type === "shot-visual" || type === "shot-body") el = document.querySelector(`[data-shot-body="${id}"]`) || document.querySelector(`[data-shot-visual="${id}"]`);
  if (!el) return;

  mentionCtx = { el, type, id };
  menu.hidden = false;
  menu.innerHTML = items
    .map((it) => `<button type="button" data-insert="${escapeAttr(it.insert)}">${escapeHtml(it.label)}</button>`)
    .join("");

  const rect = anchorBtn.getBoundingClientRect();
  menu.style.left = `${Math.min(rect.left, window.innerWidth - 260)}px`;
  menu.style.top = `${rect.bottom + 4}px`;
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
  // 同步到 state（shot body / subject text）
  if (el.dataset.shotBody) {
    const shot = state.shots.find((s) => s.id === el.dataset.shotBody);
    if (shot) shot.body = el.value;
  }
  if (el.dataset.subjText) {
    const s = state.subjects.find((x) => x.id === el.dataset.subjText);
    if (s) s.text = el.value;
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.focus();
  hideMention();
}

function hideMention() {
  const menu = document.getElementById("mention-menu");
  menu.hidden = true;
  menu.innerHTML = "";
  mentionCtx = null;
}

/* —— events —— */
function bind() {
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

  document.querySelector("#block-refs .defs-toolbar").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-add-ref]");
    if (!btn) return;
    const kind = btn.dataset.addRef;
    state.refs.push({
      id: uid(),
      kind,
      note: "",
      role: kind === "picture" ? "subject_only" : "source",
      retain: kind === "audio" ? "reference" : "fully_preserved",
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
    if (t.matches("[data-ref-kind]")) {
      const r = state.refs.find((x) => x.id === t.dataset.refKind);
      if (r) {
        r.kind = t.value;
        if (!r.retain || (r.kind === "audio" && !AUDIO_RETAIN.some((v) => v.id === r.retain)) || (r.kind !== "audio" && !VISUAL_RETAIN.some((v) => v.id === r.retain))) {
          r.retain = defaultRetainForRef(r);
        }
      }
      render();
    }
    if (t.matches("[data-ref-role]")) {
      const r = state.refs.find((x) => x.id === t.dataset.refRole);
      if (r) r.role = t.value;
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
      openMentionMenu(at, at.dataset.atTarget);
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
      if (kind === "cam") openCamTool(sid, tool);
      else if (kind === "dlg") openDlgTool(sid);
      else if (kind === "sfx") openSfxTool(sid);
      else if (kind === "au") openAuTool(sid);
      else if (kind === "at") openMentionMenu(tool, tool.dataset.atTarget || `shot-body:${sid}`);
      return;
    }
    const at = e.target.closest("[data-at-target]");
    if (at && !at.matches("[data-tool]")) {
      openMentionMenu(at, at.dataset.atTarget);
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
    insertMention(btn.dataset.insert);
  });

  document.addEventListener("click", (e) => {
    if (e.target.closest("#mention-menu") || e.target.closest("[data-at-target]")) return;
    hideMention();
  });

  document.getElementById("btn-copy-full").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(assemble(state).full);
      setStatus("已复制全文");
    } catch {
      setStatus("复制失败，请手动选中预览区");
    }
  });

  document.getElementById("btn-reset").addEventListener("click", () => {
    state = defaultState();
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem("h3-prompt-formatter-lab-v4");
    localStorage.removeItem("h3-prompt-formatter-lab-v3");
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
