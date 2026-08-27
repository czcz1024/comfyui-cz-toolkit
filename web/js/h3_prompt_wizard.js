/* ============================================================================
 * CZ-Toolkit · H3 提示词向导（表单）前端
 * ----------------------------------------------------------------------------
 * 中文表单 → 官方合规 H3 提示词（纯字符串拼装，不接 LLM）。
 * 词库与拼装引擎移植自 h3-wizard/dict.js（基础四模式子集），
 * 校验规则对齐 Dapao 审计：切点严格递增且 < 总时长、时长两位小数等。
 *
 * 节点接线：
 *   CzH3PromptWizard
 *     ─ form_state（隐藏 STRING widget，存整个表单 state JSON，负责序列化）
 *     ─ 7 个字段 STRING widget（subject_definitions ... non_diegetic_music）
 *       基础模式只填 integrated/overall/non_diegetic 三个，其余置空。
 * ==========================================================================*/

import { app } from "../../../scripts/app.js";

const NODE_TYPE = "CzH3PromptWizard";
const FORM_WIDGET = "form_state";
const FIELD_WIDGETS = [
  "subject_definitions",
  "summary",
  "retention_analysis",
  "detailed_description",
  "integrated_multimodal_description",
  "overall_soundscape",
  "non_diegetic_music",
];

/* ============================ 词库（dict.js 子集） ============================ */

const MODES = [
  { id: "t2va", name: "T2VA", kind: "base", desc: "纯文本生成完整视听时间线" },
  { id: "i2va", name: "I2VA", kind: "base", desc: "从首帧出发向前发展" },
  { id: "fl2va", name: "FL2VA", kind: "base", desc: "首尾帧之间连续插值路径" },
  { id: "l2va", name: "L2VA", kind: "base", desc: "推断开场并收敛到尾帧" },
  { id: "ref2va", name: "Ref2VA", kind: "ref", desc: "参考素材驱动六段式生成" },
];

const STYLES = [
  { zh: "写实电影", en: "Live-action, cinematic" },
  { zh: "实拍纪录", en: "Live-action documentary" },
  { zh: "2D 动画", en: "2D-animated" },
  { zh: "3D CG", en: "3D CG" },
  { zh: "黏土动画", en: "claymation" },
  { zh: "水彩", en: "watercolor" },
  { zh: "复古胶片", en: "vintage film" },
  { zh: "日式动画", en: "2D anime with cel shading" },
  { zh: "自定义…", en: "" },
];
const STYLE_CUSTOM_ZH = "自定义…";

const SHOT_SIZES = [
  { zh: "大特写", en: "an extreme close-up" },
  { zh: "特写", en: "a close-up" },
  { zh: "中近景", en: "a medium close-up" },
  { zh: "中景", en: "a medium shot" },
  { zh: "中全景", en: "a medium-wide shot" },
  { zh: "全景", en: "a wide shot" },
  { zh: "远景", en: "an extreme wide shot" },
];

const CAM_TYPES = [
  { zh: "变焦推进", en: "zooms in" },
  { zh: "变焦拉远", en: "zooms out" },
  { zh: "推镜", en: "pushes in" },
  { zh: "拉镜", en: "pulls out" },
  { zh: "左摇", en: "pans left" },
  { zh: "右摇", en: "pans right" },
  { zh: "左移", en: "trucks left" },
  { zh: "右移", en: "trucks right" },
  { zh: "上仰", en: "tilts up" },
  { zh: "下俯", en: "tilts down" },
  { zh: "升镜", en: "pedestals up" },
  { zh: "降镜", en: "pedestals down" },
  { zh: "环绕", en: "moves in an arc around the subject" },
  { zh: "跟拍", en: "tracks the moving subject" },
  { zh: "固定", en: "holds a static shot" },
  { zh: "轻微晃动", en: "shakes slightly" },
  { zh: "强烈晃动", en: "shakes strongly" },
  { zh: "主观视角", en: "presents a POV" },
  { zh: "顺时针滚转", en: "rolls clockwise" },
  { zh: "逆时针滚转", en: "rolls counterclockwise" },
];

const CAM_AMP = [
  { zh: "（默认）", en: "" },
  { zh: "小幅度", en: "with small amplitude" },
  { zh: "大幅度", en: "with large amplitude" },
];

const CAM_SPEED = [
  { zh: "（默认）", en: "" },
  { zh: "慢速", en: "at slow speed" },
  { zh: "快速", en: "at fast speed" },
];

const CUT_PHRASES = [
  { zh: "硬切", en: "the camera cuts to" },
  { zh: "切换", en: "the shot switches to" },
  { zh: "转场", en: "the shot transitions to" },
  { zh: "叠化", en: "the shot cross-dissolves to" },
  { zh: "淡入淡出", en: "the shot fades to" },
];

const ACTION_VERBS = [
  { zh: "说道", en: "says" },
  { zh: "喊道", en: "shouts" },
  { zh: "低声说", en: "whispers" },
  { zh: "问道", en: "asks" },
  { zh: "回答", en: "replies" },
  { zh: "嘟囔", en: "mutters" },
];

const SOUND_CHIPS = [
  { zh: "雨声", en: "Steady rain taps against surfaces" },
  { zh: "风声", en: "Soft wind moves through the space" },
  { zh: "街道车流", en: "Distant traffic passes in a low continuous rumble" },
  { zh: "室内底噪", en: "Quiet indoor room tone continues underneath" },
  { zh: "脚步", en: "Footsteps land with clear physical weight" },
  { zh: "布料摩擦", en: "Fabric rustles softly with movement" },
  { zh: "呼吸", en: "Close breathing remains audible" },
  { zh: "笑声", en: "Brief laughter breaks through the ambience" },
  { zh: "咖啡馆", en: "Low café ambience and soft dish clinks continue" },
  { zh: "火车轨道", en: "Train wheels produce a steady metallic rhythm" },
];

const MUSIC_CHIPS = [
  { zh: "无钢琴慢板", en: "Sparse piano notes at a slow tempo" },
  { zh: "弦乐铺底", en: "Sustained low strings gradually increase in volume before fading out" },
  { zh: "原声吉他", en: "A soft acoustic-guitar pattern at a moderate tempo, joined by sparse upright-bass notes" },
  { zh: "大提琴+钢琴", en: "Sustained cello notes at a slow tempo with widely spaced piano tones, gradually decreasing in volume" },
  { zh: "电子脉冲", en: "A low electronic pulse at a slow tempo" },
  { zh: "无配乐", en: "N/A" },
];

const LANGS = [
  { zh: "中文", en: "Chinese" },
  { zh: "英文", en: "English" },
  { zh: "日文", en: "Japanese" },
  { zh: "韩文", en: "Korean" },
  { zh: "粤语", en: "Cantonese" },
  { zh: "不明", en: "unclear" },
];

/* ---- Ref2VA 词库（dict.js 移植） ---- */

const TASK_TYPES = [
  { id: "keyframe completion", zh: "关键帧补全", en: "Keyframe completion" },
  { id: "reference generation", zh: "参考生成", en: "Reference generation" },
  { id: "video editing", zh: "视频编辑", en: "Video editing" },
  { id: "video continuation", zh: "视频续写", en: "Video continuation" },
  { id: "audio reuse", zh: "音频复用", en: "Audio reuse" },
  { id: "audio reference", zh: "音频参考", en: "Audio reference" },
];

const RETAIN_VISUAL = [
  { id: "fully_preserved", zh: "完全保留（强引用）", en: "fully_preserved" },
  { id: "partially_preserved", zh: "部分保留", en: "partially_preserved" },
  { id: "attribute_transfer", zh: "属性迁移", en: "attribute_transfer" },
  { id: "weak_reference", zh: "弱引用", en: "weak_reference" },
];

const RETAIN_AUDIO = [
  { id: "fully_copy", zh: "完整拷贝", en: "fully_copy" },
  { id: "partially_copy", zh: "部分拷贝", en: "partially_copy" },
  { id: "reference", zh: "参考（不拷贝）", en: "reference" },
  { id: "weak_reference", zh: "弱引用", en: "weak_reference" },
];

const AUDIO_ROLE_DEFAULT_RETAIN = {
  full_copy: "fully_copy",
  partial_copy: "partially_copy",
  timbre: "reference",
  music_style: "reference",
  dialogue_sfx: "reference",
  beat: "partially_copy",
};

const REF_KINDS = [
  { id: "subject", tag: "Subject", zh: "主体" },
  { id: "picture", tag: "Picture", zh: "图片" },
  { id: "video", tag: "Video", zh: "视频" },
  { id: "audio", tag: "Audio", zh: "音频" },
];

const SUBJECT_TYPES = [
  { id: "person", zh: "人物", en: "person" },
  { id: "animal", zh: "动物", en: "animal" },
  { id: "object", zh: "物体/道具", en: "object" },
  { id: "scene", zh: "场景/环境", en: "scene/environment" },
  { id: "costume", zh: "服装/造型", en: "costume/look" },
  { id: "style", zh: "画风/特效", en: "style/VFX" },
  { id: "action", zh: "动作/表情/姿势", en: "action/expression/pose" },
];

const PICTURE_ROLES = [
  { id: "source_only", zh: "仅作主体来源（不进 retention）", en: "" },
  { id: "first_frame", zh: "首帧", en: "the first frame of" },
  { id: "last_frame", zh: "尾帧", en: "the last frame of" },
  { id: "keyframe", zh: "中间关键帧", en: "a keyframe of" },
  { id: "composition", zh: "构图锚点", en: "a composition anchor for" },
  { id: "storyboard", zh: "分镜/故事板", en: "a storyboard reference for" },
];

const VIDEO_ROLES = [
  { id: "source_only", zh: "仅作动作来源（不进 retention）", en: "" },
  { id: "edit_source", zh: "剪辑源视频", en: "the source video for the target video edit" },
  { id: "continuation", zh: "续写起点", en: "the continuation source that the target video extends from" },
  { id: "structure", zh: "运镜/剪辑/节奏结构参考", en: "a structural reference for camera movement, cuts, rhythm, or temporal structure" },
];

const AUDIO_ROLES = [
  { id: "full_copy", zh: "整段音频拷贝", en: "the complete audio track to be reused" },
  { id: "partial_copy", zh: "部分音频拷贝", en: "a partial audio layer to be reused" },
  { id: "timbre", zh: "音色/说话方式参考", en: "the voice-timbre and delivery reference" },
  { id: "music_style", zh: "配乐风格参考", en: "a background-music style reference" },
  { id: "dialogue_sfx", zh: "对白/歌词/音效内容", en: "a dialogue, lyric, or sound-effect reference" },
  { id: "beat", zh: "节拍/节奏连续性", en: "a beat, rhythm, or audio-continuity reference" },
];

/* 常用英文句式库：点击复制，粘贴到对应 EN 框。给不熟悉英文的用户"抄作业"。 */
const PHRASES = [
  { cat: "场景", en: "A young woman sits by the rain-streaked window of a moving train at night" },
  { cat: "场景", en: "The morning light pours into a small kitchen while a kettle comes to a boil" },
  { cat: "场景", en: "An empty subway platform stretches under flickering fluorescent lights" },
  { cat: "场景", en: "A cluttered desk under a warm desk lamp, papers scattered across the surface" },
  { cat: "场景", en: "A narrow alley in the rain, neon signs reflecting off wet pavement" },
  { cat: "动作", en: "She looks up slowly toward the camera" },
  { cat: "动作", en: "He unfolds the letter along its original creases" },
  { cat: "动作", en: "She stands up from the chair and walks toward the door" },
  { cat: "动作", en: "He turns his head sharply at the sound" },
  { cat: "动作", en: "She wipes the fog from the window with her sleeve" },
  { cat: "光线", en: "Warm low-angle light falls across her face" },
  { cat: "光线", en: "Cold blue moonlight filters through the window" },
  { cat: "光线", en: "Harsh overhead light casts long shadows on the wall" },
  { cat: "运镜", en: "toward her face" },
  { cat: "运镜", en: "away from the window" },
  { cat: "运镜", en: "following him as he walks" },
  { cat: "细节", en: "Her breath fogs slightly in the cold air" },
  { cat: "细节", en: "His fingers tap nervously on the table" },
  { cat: "细节", en: "The letter trembles slightly in her hands" },
  { cat: "情绪", en: "A faint smile crosses her face before she looks away" },
  { cat: "情绪", en: "Tears well up but do not fall" },
  { cat: "情绪", en: "He freezes mid-step, eyes widening" },
];

/* ============================ 工具函数 ============================ */

function pad2(n) {
  return String(Math.floor(n)).padStart(2, "0");
}

function formatDuration(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  return s.toFixed(2);
}

function formatTimestamp(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const mm = Math.floor(s / 60);
  const rem = s - mm * 60;
  const ss = Math.floor(rem);
  const mmm = Math.round((rem - ss) * 1000);
  return `${pad2(mm)}:${pad2(ss)}.${String(mmm).padStart(3, "0")}`;
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function hasCJK(text) {
  return /[\u4e00-\u9fff]/.test(String(text || ""));
}

function syncSelectEn(list, zh) {
  const hit = list.find((x) => x.zh === zh);
  return hit ? hit.en : "";
}

function optionsHtml(list, selectedZh) {
  return list
    .map((item) => `<option value="${esc(item.zh)}" ${item.zh === selectedZh ? "selected" : ""}>${esc(item.zh)}</option>`)
    .join("");
}

function resolveStyleEn(state) {
  if (state.styleZh === STYLE_CUSTOM_ZH || !(state.styleEn || "").trim()) {
    return (state.styleCustomEn || state.styleCustomZh || "").trim() || "Live-action, cinematic";
  }
  return String(state.styleEn).trim();
}

/* ============================ 拼装引擎（dict.js 移植） ============================ */

function cameraSentence(typeEn, ampEn, speedEn, targetEn) {
  if (!typeEn) return "";
  if (typeEn === "holds a static shot") {
    return targetEn ? `The camera holds a static shot as ${targetEn}.` : "The camera holds a static shot.";
  }
  const parts = ["The camera", typeEn];
  if (ampEn) parts.push(ampEn);
  if (speedEn) parts.push(speedEn);
  let sentence = parts.join(" ");
  if (targetEn) sentence += ` ${targetEn}`;
  return sentence.replace(/\s+/g, " ").trim() + (sentence.endsWith(".") ? "" : ".");
}

function buildAlignInstruction(state) {
  const mode = state.mode;
  const dur = formatDuration(state.duration);
  if (mode === "i2va") {
    return "For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.";
  }
  if (mode === "fl2va") {
    const n = Math.max(1, state.shots.length);
    return `How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot ${n}) aligns with the ${dur}-second mark of the target video.`;
  }
  if (mode === "l2va") {
    const n = Math.max(1, state.shots.length);
    return `How the reference pictures align with the target video — <Picture 1> (from [Shot ${n}]) aligns with the ${dur}-second mark of the target video.`;
  }
  return "";
}

function dialogBlock(d, refs) {
  if (!d || !String(d.text || "").trim()) return "";
  const lang = d.lang || "Chinese";
  const sid = d.speakerId || "S1";
  // Ref 模式：说话人绑定已定义 Subject → 输出 <Subject N> (Sx)
  const subj = d.subjectId && refs ? refs.find((x) => x.id === d.subjectId) : null;
  const subjLabel = subj ? labelOf(subj, refs) : "";
  const who = subjLabel || (d.whoEn || d.whoZh || "The speaker").trim();
  const voiceover = !!d.voiceover;
  const action = voiceover ? "says in an off-screen voiceover" : (d.actionEn || "says");
  let line = `${who} (${sid})`;
  line += ` ${action}: <d>[${lang}] ${String(d.text).trim()}</d>`;
  if (voiceover) line += " while his or her lips remain completely closed";
  if (d.crossCut) line += "; the audio continues seamlessly across the cut";
  return line + ".";
}

function buildShotBody(shot, index, opts = {}) {
  const n = index + 1;
  const size = shot.sizeEn || "a medium shot";
  const stylePrefix = opts.stylePrefix || "";
  const scene = shot.sceneEn || shot.sceneZh || "";
  const action = shot.actionEn || shot.actionZh || "";
  const diegetic = shot.diegeticSoundEn || shot.diegeticSoundZh || "";
  const cam = cameraSentence(shot.camTypeEn, shot.camAmpEn, shot.camSpeedEn, shot.camTargetEn || shot.camTargetZh || "");
  const onscreen = (shot.onscreenText || "").trim();
  const cut = shot.cutEn || "the camera cuts to";

  const sceneClause =
    /(?:^|\s)(?:the|a|an|she|he|they|it|we|i|you)\s+\S+\s+(?:is|are|was|were|sits|stands|walks|enters|holds|lifts|turns|opens|begins|remains|trembles|moves|looks|stares|wipes|steps|leans|reaches|nods|shakes|smiles|stops|freezes|sighs)\b/i.test(scene || "") ||
    /[a-z]\s+(?:is|are|sits|stands|walks|enters|holds|lifts|turns|opens|begins|remains)\b/i.test(scene || "");
  let head;
  if (n === 1) {
    head = sceneClause
      ? `[Shot 1] ${stylePrefix}${size}. ${scene}`
      : `[Shot 1] ${stylePrefix}${size} frames ${scene || "the scene"}`;
    head = head.replace(/\s+/g, " ").trim();
  } else {
    head = sceneClause
      ? `[Shot ${n}] At ${formatTimestamp(shot.time)}, ${cut} ${size}. ${scene}`
      : `[Shot ${n}] At ${formatTimestamp(shot.time)}, ${cut} ${size} of ${scene || "the next beat"}`;
    head = head.replace(/\s+/g, " ").trim();
  }

  const bits = [head];
  if (action) bits.push(action.replace(/\.*$/, ""));
  if (cam) bits.push(cam.replace(/\.*$/, ""));
  if (diegetic) bits.push(diegetic.replace(/\.*$/, ""));
  if (onscreen) bits.push(`On-screen text reading "${onscreen}" is clearly visible`);
  (shot.dialogs || []).forEach((d) => {
    const blk = dialogBlock(d, opts.refs);
    if (blk) bits.push(blk.replace(/\.*$/, ""));
  });
  let body = bits.join(". ").replace(/\.\s*\./g, ".").trim();
  if (!body.endsWith(".")) body += ".";
  return body;
}

function joinSoundscape(state) {
  if (state.soundSilent) return "N/A";
  const chips = (state.soundChipEns || []).filter(Boolean);
  const free = (state.soundEn || state.soundZh || "").trim();
  const parts = [...chips];
  if (free) parts.push(free);
  if (!parts.length) return "Quiet ambient room tone continues throughout the video.";
  return parts.map((p) => p.replace(/\.*$/, "")).join(". ") + ".";
}

function joinMusic(state) {
  if (state.musicNA) return "N/A";
  if (state.musicChipEn === "N/A") return "N/A";
  const chip = (state.musicChipEn || "").trim();
  const free = (state.musicEn || state.musicZh || "").trim();
  const parts = [];
  if (chip) parts.push(chip);
  if (free) parts.push(free);
  if (!parts.length) return "N/A";
  return parts.map((p) => p.replace(/\.*$/, "")).join(". ") + ".";
}

function assembleBase(state) {
  const align = buildAlignInstruction(state);
  const style = resolveStyleEn(state);
  const opening = (state.openingEn || state.openingZh || "").trim();
  const shotTexts = (state.shots || []).map((shot, i) => {
    const stylePrefix = i === 0 ? `${style}, ` : "";
    const s = { ...shot };
    if (i === 0 && opening && !(s.sceneEn || s.sceneZh)) {
      s.sceneEn = opening;
    } else if (i === 0 && opening) {
      s.sceneEn = `${opening}${s.sceneEn || s.sceneZh ? "; " + (s.sceneEn || s.sceneZh) : ""}`;
    }
    return buildShotBody(s, i, { stylePrefix });
  });
  const integrated = shotTexts.join(" ");
  const sound = joinSoundscape(state);
  const music = joinMusic(state);

  const sections = [];
  if (align) sections.push({ key: "align", title: "对齐指令", body: align });
  sections.push({ key: "integrated_multimodal_description", title: "integrated_multimodal_description", body: `integrated_multimodal_description: ${integrated}` });
  sections.push({ key: "overall_soundscape", title: "overall_soundscape", body: `overall_soundscape: ${sound}` });
  sections.push({ key: "non_diegetic_music", title: "non_diegetic_music", body: `non_diegetic_music: ${music}` });

  const parts = [];
  if (align) parts.push(align, "");
  parts.push(`integrated_multimodal_description: ${integrated}`, "", `overall_soundscape: ${sound}`, "", `non_diegetic_music: ${music}`);
  const full = parts.join("\n");

  return { sections, full };
}

/* ============================ Ref2VA 拼装（dict.js 移植，简化版） ============================ */

function labelOf(ref, refs) {
  const kind = REF_KINDS.find((k) => k.id === ref.kind) || REF_KINDS[0];
  const list = (refs || []).filter((x) => x.kind === ref.kind);
  const idx = list.indexOf(ref) + 1;
  return `<${kind.tag} ${idx > 0 ? idx : ref.index || 1}>`;
}

function orderedRefsForOutput(refs) {
  const list = refs || [];
  const order = { subject: 0, picture: 1, video: 2, audio: 3 };
  return list.slice().sort((a, b) => order[a.kind] - order[b.kind] || 0);
}

// retention_analysis 单行（官方格式，ref-en.txt §4）：
//   <Subject 1> (appears in [Shot 1], [Shot 3]): fully_preserved - ...
//   <Picture 2> ([Shot 1] first frame): fully_preserved - ...
//   <Video 1> (cut and pacing structure): weak_reference - ...
//   <Audio 1>: fully_copy - ...
function retainLineOf(r, refs) {
  const label = labelOf(r, refs);
  const marker =
    r.retain ||
    (r.kind === "audio"
      ? AUDIO_ROLE_DEFAULT_RETAIN[r.audioRole] || "reference"
      : "fully_preserved");
  const noteRaw = (r.retainEn || r.retainZh || "the defined characteristics are retained").trim();
  const note = noteRaw.replace(/\.*$/, "") + ".";
  const appear = (r.appear || "").trim();
  let position = "";
  if (r.kind === "subject") {
    position = ` (appears in ${appear || "[Shot 1]"})`;
  } else if (r.kind === "picture") {
    // 未填时按角色给默认：first/last frame → "<shotMap> first/last frame"
    const defaultPos =
      r.pictureRole === "first_frame" || r.pictureRole === "last_frame"
        ? `${r.shotMap || "[Shot 1]"} ${r.pictureRole === "first_frame" ? "first" : "last"} frame`
        : "";
    const pos = appear || defaultPos;
    if (pos) position = ` (${pos})`;
  } else if (r.kind === "video") {
    if (appear) position = ` (${appear})`;
  }
  return `${label}${position}: ${marker} - ${note}`;
}

function sourceClauseFromIds(r, refs) {
  // 来源引用（旧版兼容）：<Picture N> / <Video N> 多选 → "in <Picture 1> and <Video 1>"
  const ids = (r.sourceFromIds || []).filter(Boolean);
  const labels = ids
    .map((id) => refs.find((x) => x.id === id))
    .filter(Boolean)
    .map((x) => labelOf(x, refs));
  if (!labels.length) return "";
  if (labels.length === 1) return `in ${labels[0]}`;
  return `in ${labels.slice(0, -1).join(" and ")} and ${labels[labels.length - 1]}`;
}

function sourceClauseFromParts(r, refs) {
  // subject 多素材引用（官方 §2.1）："whose appearance comes from <Picture 1> and whose clothes come from <Picture 2>"
  // desc 留空时退化为 "in <Picture N>"
  const parts = (r.parts || [])
    .map((p) => ({ src: refs.find((x) => x.id === p.srcId), desc: String(p.desc || "").trim() }))
    .filter((p) => p.src);
  if (!parts.length) return "";
  const clauses = parts.map((p) => {
    const label = labelOf(p.src, refs);
    return p.desc ? `whose ${p.desc} comes from ${label}` : `in ${label}`;
  });
  if (clauses.length === 1) return clauses[0];
  return clauses.slice(0, -1).join(" and ") + " and " + clauses[clauses.length - 1];
}

function buildRefDefinition(r, refs) {
  const all = refs || [r];
  const label = labelOf(r, all);
  const pick = (en, zh) => (en || zh || "").trim();

  if (r.kind === "subject") {
    const type = SUBJECT_TYPES.find((t) => t.id === r.subjectType) || SUBJECT_TYPES[0];
    const who = pick(r.whoEn, r.whoZh) || `a ${type.en}`;
    const look = pick(r.lookEn, r.lookZh);
    let body = who;
    // parts（多素材引用）优先，旧版 sourceFromIds 回退
    const partClause = sourceClauseFromParts(r, all);
    if (partClause) body += ` ${partClause}`;
    else {
      const source = sourceClauseFromIds(r, all);
      if (source) body += ` ${source}`;
    }
    if (look) body += `, with ${look}`;
    return `${label} is ${body}.`.replace(/\s+/g, " ").replace(/\s+\./, ".");
  }

  if (r.kind === "picture") {
    if (r.pictureRole === "source_only") return null;
    const role = PICTURE_ROLES.find((t) => t.id === r.pictureRole) || PICTURE_ROLES[1];
    const shots = (r.shotMap || "[Shot 1]").trim();
    const shown = pick(r.shownEn, r.shownZh);
    let body = `${role.en} ${shots}`;
    if (shown) body += `, showing ${shown}`;
    return `${label} is ${body}.`;
  }

  if (r.kind === "video") {
    if (r.videoRole === "source_only") return null;
    const role = VIDEO_ROLES.find((t) => t.id === r.videoRole) || VIDEO_ROLES[1];
    const note = pick(r.noteEn, r.noteZh);
    return note ? `${label} is ${role.en}; ${note}.` : `${label} is ${role.en}.`;
  }

  if (r.kind === "audio") {
    const role = AUDIO_ROLES.find((t) => t.id === r.audioRole) || AUDIO_ROLES[2];
    const note = pick(r.noteEn, r.noteZh);
    // 绑定了目标说话人时写 <Subject N> (Sx)
    const boundSubj = r.boundSubjectId ? all.find((x) => x.id === r.boundSubjectId) : null;
    const speaker = boundSubj ? ` for ${labelOf(boundSubj, all)} (${r.speakerId || "S1"})` : "";
    let body = `${role.en}${speaker}`;
    if (note) body += `, ${note}`;
    return `${label} is ${body}.`;
  }
  return "";
}

function assembleRef(state) {
  const refs = state.refs || [];
  // 音频 → 主体 说话人绑定反向（Audio 定义里带 boundSubjectId）
  const ordered = orderedRefsForOutput(refs);
  const defs = ordered.map((r) => buildRefDefinition(r, refs)).filter(Boolean);

  const tasks = (state.taskTypes || []).filter(Boolean);
  const taskPrefix = tasks.length ? `[${tasks.join(" + ")}] ` : "[reference generation] ";
  const summaryBody = (state.summaryEn || state.summaryZh || "The target video uses the defined references.").trim();
  const summary = `${taskPrefix}${summaryBody}`;

  const retLines = ordered
    .filter((r) => {
      if (r.kind === "picture" && r.pictureRole === "source_only") return false;
      if (r.kind === "video" && r.videoRole === "source_only") return false;
      return true;
    })
    .map((r) => retainLineOf(r, refs));

  // Ref2VA：风格在 [Shot 1] 之前一两句建立；detail 逐镜描述
  const style = resolveStyleEn(state);
  const styleLine = `The target video is in a ${style} style.`;
  const shotTexts = (state.shots || []).map((shot, i) =>
    buildShotBody(shot, i, { stylePrefix: "", refs: refs })
  );
  const detailed = [styleLine, ...shotTexts].join("\n");

  const sound = joinSoundscape(state);
  const music = joinMusic(state);

  const sections = [
    { key: "subject_definitions", title: "subject_definitions", body: `subject_definitions:\n${defs.join("\n") || "(none)"}` },
    { key: "summary", title: "summary", body: `summary:\n${summary}` },
    { key: "retention_analysis", title: "retention_analysis", body: `retention_analysis:\n${retLines.join("\n") || "(none)"}` },
    { key: "detailed_description", title: "detailed_description", body: `detailed_description:\n${detailed}` },
    { key: "overall_soundscape", title: "overall_soundscape", body: `overall_soundscape:\n${sound}` },
    { key: "non_diegetic_music", title: "non_diegetic_music", body: `non_diegetic_music:\n${music}` },
  ];

  const full = sections.map((s) => s.body).join("\n\n");
  return { sections, full };
}

function assemble(state) {
  const mode = MODES.find((m) => m.id === state.mode);
  if (mode && mode.kind === "ref") return assembleRef(state);
  return assembleBase(state);
}

/* ============================ 校验器（对齐 Dapao 审计） ============================ */

function validate(state) {
  const errors = [];
  const warnings = [];
  const dur = Number(state.duration) || 0;
  if (dur <= 0) errors.push({ field: "duration", msg: "请填写有效的视频时长（秒）" });

  if (state.styleZh === STYLE_CUSTOM_ZH) {
    const custom = (state.styleCustomEn || state.styleCustomZh || "").trim();
    if (!custom) errors.push({ field: "styleCustom", msg: "已选「自定义…」风格，请填写自定义风格描述" });
    if (hasCJK(state.styleCustomEn || "")) warnings.push({ field: "styleCustomEn", msg: "「自定义风格」填了中文：最终提示词会含中文，H3 官方要求英文，可自行翻译" });
  }

  const shots = state.shots || [];
  if (!shots.length) errors.push({ field: "shots", msg: "至少需要一个镜头" });

  let prev = -1;
  shots.forEach((s, i) => {
    if (i === 0) return;
    const t = Number(s.time);
    if (Number.isNaN(t) || t <= 0) {
      errors.push({ field: `shot-${i}-time`, msg: `镜头 ${i + 1} 需要填写切镜时间` });
    } else if (t <= prev) {
      errors.push({ field: `shot-${i}-time`, msg: `镜头 ${i + 1} 的切镜时间必须严格递增（当前 ${t} ≤ 上一镜 ${prev}）` });
    } else if (dur > 0 && t >= dur) {
      errors.push({ field: `shot-${i}-time`, msg: `镜头 ${i + 1} 的切镜时间 ${t} 必须小于总时长 ${dur}s` });
    }
    if (!Number.isNaN(t)) prev = t;
  });

  shots.forEach((s, i) => {
    if (hasCJK(s.sceneEn || "")) warnings.push({ field: `shot-${i}-sceneEn`, msg: `镜头 ${i + 1}「场景」填了中文：最终提示词会含中文，可自行翻译` });
    if (hasCJK(s.actionEn || "")) warnings.push({ field: `shot-${i}-actionEn`, msg: `镜头 ${i + 1}「动作」填了中文：最终提示词会含中文，可自行翻译` });
    if (hasCJK(s.diegeticSoundEn || "")) warnings.push({ field: `shot-${i}-dsoundEn`, msg: `镜头 ${i + 1}「画内声音」填了中文：最终提示词会含中文，可自行翻译` });
    (s.dialogs || []).forEach((d, di) => {
      if (String(d.text || "").trim() && !d.lang) {
        errors.push({ field: `shot-${i}-dialog-${di}`, msg: `镜头 ${i + 1} 对白 ${di + 1} 需要选择语言` });
      }
    });
  });

  if (hasCJK(state.openingEn || "")) warnings.push({ field: "openingEn", msg: "「开场构图」填了中文：最终提示词会含中文，可自行翻译" });
  if (hasCJK(state.soundEn || "")) warnings.push({ field: "soundEn", msg: "「环境声补充」填了中文：最终提示词会含中文，可自行翻译" });
  if (hasCJK(state.musicEn || "")) warnings.push({ field: "musicEn", msg: "「配乐补充」填了中文：最终提示词会含中文，可自行翻译" });

  /* ---- Ref2VA 校验（对齐官方硬约束） ---- */
  if (state.mode === "ref2va") {
    const refs = state.refs || [];
    if (!refs.length) errors.push({ field: "refs", msg: "Ref2VA 至少需要一条参考素材" });
    if (!(state.taskTypes || []).length) errors.push({ field: "taskTypes", msg: "请至少选择一个任务类型（summary 前缀）" });
    if (!(state.summaryEn || state.summaryZh || "").trim()) errors.push({ field: "summaryEn", msg: "请填写 summary 概括（会自动加 [任务类型] 前缀）" });

    const nPic = refs.filter((r) => r.kind === "picture" && r.pictureRole !== "source_only").length;
    const nVid = refs.filter((r) => r.kind === "video" && r.videoRole !== "source_only").length;
    const nAud = refs.filter((r) => r.kind === "audio").length;
    if (nPic > 9) errors.push({ field: "refs", msg: `图片素材超过上限：${nPic} > 9` });
    if (nVid > 3) errors.push({ field: "refs", msg: `视频素材超过上限：${nVid} > 3` });
    if (nAud > 3) errors.push({ field: "refs", msg: `音频素材超过上限：${nAud} > 3` });
    if (refs.length > 12) errors.push({ field: "refs", msg: `素材总数超过上限：${refs.length} > 12` });
    const hasVisual = refs.some((r) => r.kind !== "audio");
    if (nAud > 0 && !hasVisual) errors.push({ field: "refs", msg: "音频不能是唯一媒体（至少需要一张图/视频/主体）" });

    refs.forEach((r, i) => {
      if (hasCJK(r.whoEn || "")) warnings.push({ field: `ref-${i}-whoEn`, msg: `素材 ${i + 1}「是谁」填了中文：最终提示词会含中文，可自行翻译` });
      if (hasCJK(r.lookEn || "")) warnings.push({ field: `ref-${i}-lookEn`, msg: `素材 ${i + 1}「外观」填了中文：最终提示词会含中文，可自行翻译` });
      if (hasCJK(r.shownEn || "")) warnings.push({ field: `ref-${i}-shownEn`, msg: `素材 ${i + 1}「画面内容」填了中文：最终提示词会含中文，可自行翻译` });
      if (hasCJK(r.noteEn || "")) warnings.push({ field: `ref-${i}-noteEn`, msg: `素材 ${i + 1}「说明」填了中文：最终提示词会含中文，可自行翻译` });
      if (hasCJK(r.retainEn || "")) warnings.push({ field: `ref-${i}-retainEn`, msg: `素材 ${i + 1}「保留说明」填了中文：最终提示词会含中文，可自行翻译` });
      if (hasCJK(r.appear || "")) warnings.push({ field: `ref-${i}-appear`, msg: `素材 ${i + 1}「出现位置」应写英文镜头标签` });
      if (r.kind === "subject" && r.appear && !/\[\s*Shot\b/i.test(r.appear)) {
        warnings.push({ field: `ref-${i}-appear`, msg: `素材 ${i + 1}「出现位置」建议形如 "[Shot 1], [Shot 3]"` });
      }
      // subject 缺谁
      if (r.kind === "subject" && !(r.whoEn || r.whoZh || "").trim()) {
        errors.push({ field: `ref-${i}-whoEn`, msg: `素材 ${i + 1}（${labelOf(r, refs)}）需要填写「是谁」` });
      }
      // picture 只作来源时无定义行，但 retention 中也会被过滤 —— 提示用户
      if (r.kind === "picture" && r.pictureRole === "source_only" && !r.shotMap) {
        warnings.push({ field: `ref-${i}-shotmap`, msg: `素材 ${i + 1} 选了「仅作主体来源」，将不会单独出现在输出中` });
      }
      // 引用未定义的来源
      (r.sourceFromIds || []).forEach((srcId) => {
        if (!refs.some((x) => x.id === srcId)) {
          errors.push({ field: `ref-${i}-sources`, msg: `素材 ${i + 1} 引用了不存在的来源素材` });
        }
      });
    });

    if (hasCJK(state.summaryEn || "")) warnings.push({ field: "summaryEn", msg: "「summary 概括」填了中文：最终提示词会含中文，可自行翻译（自动加 [任务类型] 前缀）" });
  }

  return { errors, warnings };
}

/* ============================ 状态 ============================ */

function emptyShot(time = 0) {
  return {
    time,
    sizeZh: "中景",
    sizeEn: "a medium shot",
    camTypeZh: "固定",
    camTypeEn: "holds a static shot",
    camAmpZh: "（默认）",
    camAmpEn: "",
    camSpeedZh: "（默认）",
    camSpeedEn: "",
    camTargetZh: "",
    camTargetEn: "",
    cutZh: "硬切",
    cutEn: "the camera cuts to",
    sceneZh: "",
    sceneEn: "",
    actionZh: "",
    actionEn: "",
    diegeticSoundZh: "",
    diegeticSoundEn: "",
    onscreenText: "",
    dialogs: [],
  };
}

function emptyDialog() {
  return {
    speakerId: "S1",
    whoZh: "",
    whoEn: "",
    actionZh: "说道",
    actionEn: "says",
    lang: "Chinese",
    text: "",
    voiceover: false,
    crossCut: false,
    subjectId: "", // Ref 模式：绑定已定义 Subject 素材 id
  };
}

let __refSeq = 0;
function emptyRef(kind = "subject") {
  __refSeq += 1;
  return {
    id: `ref${__refSeq}_${Date.now().toString(36)}`,
    kind,
    subjectType: "person",
    whoZh: "",
    whoEn: "",
    lookZh: "",
    lookEn: "",
    sourceFromIds: [], // 旧版来源引用（兼容：无 parts 时回退拼 "in <Picture N>"）
    parts: [], // subject 多素材引用片段：[{ srcId, desc }]，desc 填素材提供什么
    pictureRole: "first_frame",
    shotMap: "[Shot 1]",
    shownZh: "",
    shownEn: "",
    videoRole: "edit_source",
    noteZh: "",
    noteEn: "",
    audioRole: "timbre",
    boundSubjectId: "", // audio 绑定目标主体
    speakerId: "",
    appear: "", // retention 出现位置，如 "[Shot 1], [Shot 3]"
    retain: "", // retention 标记 id（按类型取默认）
    retainZh: "",
    retainEn: "",
    retainNoteZh: "",
    retainNoteEn: "",
  };
}

function defaultState() {
  return {
    mode: "t2va",
    duration: 6,
    styleZh: "写实电影",
    styleEn: "Live-action, cinematic",
    styleCustomZh: "",
    styleCustomEn: "",
    openingZh: "",
    openingEn: "",
    shots: [emptyShot(0)],
    soundChipEns: [],
    soundChipZhs: [],
    soundZh: "",
    soundEn: "",
    soundSilent: false,
    musicChipZh: "无钢琴慢板",
    musicChipEn: "Sparse piano notes at a slow tempo",
    musicZh: "",
    musicEn: "",
    musicNA: false,
    refs: [],
    taskTypes: ["reference generation"],
    summaryZh: "",
    summaryEn: "",
  };
}

function mergeState(saved) {
  const base = defaultState();
  if (!saved || typeof saved !== "object") return base;
  const merged = Object.assign(base, saved);
  if (!Array.isArray(merged.shots) || !merged.shots.length) merged.shots = [emptyShot(0)];
  merged.shots = merged.shots.map((s) => Object.assign(emptyShot(0), s));
  merged.shots.forEach((s) => {
    if (!Array.isArray(s.dialogs)) s.dialogs = [];
    s.dialogs = s.dialogs.map((d) => Object.assign(emptyDialog(), d));
  });
  if (!Array.isArray(merged.soundChipEns)) merged.soundChipEns = [];
  if (!Array.isArray(merged.soundChipZhs)) merged.soundChipZhs = [];
  if (!Array.isArray(merged.refs)) merged.refs = [];
  merged.refs = merged.refs.map((r) => Object.assign(emptyRef(r.kind || "subject"), r));
  merged.refs.forEach((r) => {
    if (!Array.isArray(r.sourceFromIds)) r.sourceFromIds = [];
    // 旧版 sourceFromIds → parts 迁移：parts 缺失或为空但有旧引用时，迁成 desc 留空的片段（拼装走 "in <Picture N>" 兼容）
    if (!Array.isArray(r.parts) || (!r.parts.length && r.sourceFromIds.length)) {
      r.parts = r.sourceFromIds.map((id) => ({ srcId: id, desc: "" }));
    }
    r.parts = r.parts
      .filter((p) => p && typeof p === "object")
      .map((p) => ({ srcId: p.srcId || "", desc: p.desc || "" }));
  });
  if (!Array.isArray(merged.taskTypes)) merged.taskTypes = [];

  /* 旧双框数据迁移（单框模式）：en 为空时用旧 zh 备注兜底，然后丢弃 zh */
  const migrate = (obj, pairs) =>
    pairs.forEach(([en, zh]) => {
      if (!String(obj[en] || "").trim() && String(obj[zh] || "").trim()) obj[en] = obj[zh];
      obj[zh] = "";
    });
  migrate(merged, [
    ["styleCustomEn", "styleCustomZh"],
    ["openingEn", "openingZh"],
    ["soundEn", "soundZh"],
    ["musicEn", "musicZh"],
    ["summaryEn", "summaryZh"],
  ]);
  merged.shots.forEach((s) =>
    migrate(s, [
      ["sceneEn", "sceneZh"],
      ["actionEn", "actionZh"],
      ["diegeticSoundEn", "diegeticSoundZh"],
      ["camTargetEn", "camTargetZh"],
    ])
  );
  merged.shots.forEach((s) => (s.dialogs || []).forEach((d) => migrate(d, [["whoEn", "whoZh"]])));
  merged.refs.forEach((r) =>
    migrate(r, [
      ["whoEn", "whoZh"],
      ["lookEn", "lookZh"],
      ["shownEn", "shownZh"],
      ["noteEn", "noteZh"],
      ["retainEn", "retainZh"],
    ])
  );
  return merged;
}

let state = defaultState();

/* ============================ 表单渲染 ============================ */

// 单框字段：写什么语言就拼什么语言（中/英均可，原样进最终提示词）
function fieldHtml(label, name, value, placeholder, rows = 2) {
  return `
    <div class="h3wz-field h3wz-col">
      <label>${esc(label)}</label>
      <textarea data-${name} rows="${rows}" placeholder="${esc(placeholder || "用中文或英文填写，内容会原样拼进提示词")}">${esc(value || "")}</textarea>
    </div>`;
}

function shotCardHtml(s, i) {
  const isFirst = i === 0;
  const dialogs = (s.dialogs || [])
    .map((d, di) => dialogHtml(i, d, di))
    .join("");
  return `
    <div class="h3wz-shot" data-shot="${i}">
      <div class="h3wz-shot-head">
        <span class="h3wz-shot-title">[Shot ${i + 1}]${isFirst ? " · 无时间戳" : ""}</span>
        <button type="button" class="h3wz-btn h3wz-btn-del" data-del-shot="${i}" ${state.shots.length === 1 ? "disabled" : ""}>删除本镜</button>
      </div>
      <div class="h3wz-grid-2">
        ${isFirst ? "" : `
          <div class="h3wz-field">
            <label>切镜时间（秒，自动转 MM:SS.mmm）</label>
            <input type="number" min="0.01" step="0.001" data-shot-time="${i}" value="${esc(s.time)}" />
          </div>
          <div class="h3wz-field">
            <label>切镜方式</label>
            <select data-shot-cut="${i}">${optionsHtml(CUT_PHRASES, s.cutZh)}</select>
          </div>`}
        ${isFirst ? `
          <div class="h3wz-field">
            <label>景别</label>
            <select data-shot-size="${i}">${optionsHtml(SHOT_SIZES, s.sizeZh)}</select>
          </div>
          <div class="h3wz-field">
            <label>运镜类型</label>
            <select data-shot-cam="${i}">${optionsHtml(CAM_TYPES, s.camTypeZh)}</select>
          </div>` : `
          <div class="h3wz-field">
            <label>景别</label>
            <select data-shot-size="${i}">${optionsHtml(SHOT_SIZES, s.sizeZh)}</select>
          </div>
          <div class="h3wz-field">
            <label>运镜类型</label>
            <select data-shot-cam="${i}">${optionsHtml(CAM_TYPES, s.camTypeZh)}</select>
          </div>`}
      </div>
      <div class="h3wz-grid-3">
        <div class="h3wz-field">
          <label>幅度</label>
          <select data-shot-amp="${i}">${optionsHtml(CAM_AMP, s.camAmpZh)}</select>
        </div>
        <div class="h3wz-field">
          <label>速度</label>
          <select data-shot-speed="${i}">${optionsHtml(CAM_SPEED, s.camSpeedZh)}</select>
        </div>
        <div class="h3wz-field">
          <label>运镜目标（可选，镜头推向/拉向什么）</label>
          <input data-shot-camtarget-en="${i}" value="${esc(s.camTargetEn || "")}" placeholder="如：toward her face（推向她的脸）" />
        </div>
      </div>
      <div class="h3wz-grid-2">
        ${fieldHtml("画面 / 主体 / 环境", `shot-scene-en-${i}`, s.sceneEn, "这一镜的画面里有什么，如：女子坐在雨窗边")}
        ${fieldHtml("动作与反应", `shot-action-en-${i}`, s.actionEn, "发生什么动作，如：她缓缓抬眼看向镜头")}
        ${fieldHtml("本镜画内声音（角色听得到）", `shot-dsound-en-${i}`, s.diegeticSoundEn, "这一镜能听到的环境声/动作声，如：站台嘈杂与列车进站声")}
        <div class="h3wz-field">
          <label>画面可见文字（原文原样保留，不翻译）</label>
          <input data-shot-onscreen="${i}" value="${esc(s.onscreenText || "")}" placeholder="如：营业中" />
        </div>
      </div>
      <div class="h3wz-dialogs" data-dialogs="${i}">${dialogs || '<div class="h3wz-hint">还没有对白。</div>'}</div>
      <button type="button" class="h3wz-btn h3wz-btn-add" data-add-dialog="${i}">+ 加对白</button>
    </div>`;
}

function dialogHtml(si, d, di) {
  return `
    <div class="h3wz-dialog" data-dialog="${si}-${di}">
      <div class="h3wz-dialog-head">
        <span>对白 ${di + 1}（列表顺序 = 说话顺序）</span>
        <button type="button" class="h3wz-btn h3wz-btn-del" data-del-dialog="${si}-${di}">删除</button>
      </div>
      <div class="h3wz-grid-3">
      <div class="h3wz-field">
        <label>说话人 ID</label>
        <select data-d-speaker="${si}-${di}">
          <option value="S1" ${d.speakerId === "S1" ? "selected" : ""}>S1</option>
          <option value="S2" ${d.speakerId === "S2" ? "selected" : ""}>S2</option>
          <option value="S3" ${d.speakerId === "S3" ? "selected" : ""}>S3</option>
        </select>
      </div>
      ${state.mode === "ref2va" ? `
      <div class="h3wz-field">
        <label>绑定主体（Ref 模式，输出 &lt;Subject N&gt; (Sx)）</label>
        <select data-d-subj="${si}-${di}">
          <option value="">（不绑定，用下方描述）</option>
          ${(state.refs || [])
            .filter((r) => r.kind === "subject")
            .map((r) => `<option value="${esc(r.id)}" ${r.id === d.subjectId ? "selected" : ""}>${labelOf(r, state.refs)} · ${esc(r.whoZh || r.whoEn || "主体")}</option>`)
            .join("")}
        </select>
      </div>` : ""}
      <div class="h3wz-field">
        <label>发声动作</label>
        <select data-d-action="${si}-${di}">${optionsHtml(ACTION_VERBS, d.actionZh)}</select>
      </div>
      <div class="h3wz-field">
        <label>语言</label>
        <select data-d-lang="${si}-${di}">${optionsHtml(LANGS, d.lang)}</select>
      </div>
      </div>
      <div class="h3wz-field">
        <label>说话人描述（可选，空则用 The speaker）</label>
        <input data-d-whoen="${si}-${di}" value="${esc(d.whoEn || "")}" placeholder="如：a young woman with a quiet voice / 嗓音轻柔的年轻女子" />
      </div>
      <div class="h3wz-field">
        <label>台词原文（原语言保留，不翻译）</label>
        <textarea rows="2" data-d-text="${si}-${di}" placeholder="下一站我就下车。">${esc(d.text || "")}</textarea>
      </div>
      <div class="h3wz-checks">
        <label><input type="checkbox" data-d-vo="${si}-${di}" ${d.voiceover ? "checked" : ""} /> 画外旁白（自动加 lips closed）</label>
        <label><input type="checkbox" data-d-cross="${si}-${di}" ${d.crossCut ? "checked" : ""} /> 对白跨切镜延续</label>
      </div>
    </div>`;
}

function renderShots(root) {
  const list = root.querySelector(".h3wz-shot-list");
  if (list) list.innerHTML = (state.shots || []).map((s, i) => shotCardHtml(s, i)).join("");
}

/* ---- Ref2VA 素材/Subject 卡片 ---- */

// subject 引用片段：@ 选素材 + 填它提供什么 → "whose face comes from <Picture 1>"
function subjectPartsHtml(r, i) {
  const materials = (state.refs || []).filter((x) => x.kind !== "subject" && x.id !== r.id);
  if (!materials.length) {
    return `<div class="h3wz-field">
      <label>引用片段（@ 选素材，拼成 whose … comes from &lt;Picture N&gt;）</label>
      <div class="h3wz-hint" style="font-size:12px;color:#9aa3af;">（还没有素材可引用，先在上方「引用元素」区添加图片/视频/音频）</div>
    </div>`;
  }
  const brief = (m) => String(m.shownEn || m.noteEn || m.shownZh || m.noteZh || "").trim();
  const rows = (r.parts || [])
    .map(
      (p, pi) => `
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;">
        <span style="color:#2b6cb0;font-weight:700;flex-shrink:0;">@</span>
        <select data-ref-part-src="${i}|${pi}" style="flex:1;min-width:130px;">
          <option value="">（选择素材…）</option>
          ${materials
            .map(
              (m) =>
                `<option value="${esc(m.id)}" ${m.id === p.srcId ? "selected" : ""}>${labelOf(m, state.refs)}${brief(m) ? ` · ${esc(brief(m))}` : ""}</option>`
            )
            .join("")}
        </select>
        <input data-ref-part-desc="${i}|${pi}" value="${esc(p.desc || "")}" placeholder="提供什么，如 face / 面部" style="flex:1.2;min-width:110px;" />
        <button type="button" class="h3wz-btn h3wz-btn-del" data-del-part="${i}|${pi}" style="flex-shrink:0;">删</button>
      </div>`
    )
    .join("");
  return `<div class="h3wz-field">
    <label>引用片段（@ 选素材 + 填它提供什么，自动拼成 whose … comes from &lt;Picture N&gt;）</label>
    ${rows || `<div class="h3wz-hint" style="font-size:12px;color:#9aa3af;">（还没有引用片段，点下面「+ 添加引用」）</div>`}
    <button type="button" class="h3wz-btn h3wz-btn-add" data-add-part="${i}" style="margin-top:4px;">+ 添加引用（@ 素材）</button>
  </div>`;
}

function refCardHtml(r, i) {
  const isAudio = r.kind === "audio";
  const retainList = isAudio ? RETAIN_AUDIO : RETAIN_VISUAL;
  const retainZh =
    r.retain ||
    (isAudio ? AUDIO_ROLE_DEFAULT_RETAIN[r.audioRole] || "reference" : "fully_preserved");
  const retainLabel = retainList.find((x) => x.id === retainZh)?.zh || retainZh;
  const field = (label, attr, value, placeholder) => `
    <div class="h3wz-field">
      <label>${esc(label)}</label>
      <input data-${attr} value="${esc(value || "")}" placeholder="${esc(placeholder || "用中文或英文填写")}" />
    </div>`;
  const kindZh = REF_KINDS.find((k) => k.id === r.kind)?.zh || "";
  const headLabel = r.kind === "subject" ? "Subject 定义" : kindZh;
  return `
    <div class="h3wz-ref" data-ref="${i}" style="border:1px solid #d8dee6;border-radius:8px;padding:8px 10px;margin-bottom:8px;background:#fbfcfe;">
      <div class="h3wz-ref-head" style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <span style="font-weight:700;color:#2d3748;font-size:13px;">${labelOf(r, state.refs)} · ${headLabel}</span>
        <button type="button" class="h3wz-btn h3wz-btn-del" data-del-ref="${i}">删除</button>
      </div>
      ${r.kind === "subject" ? `
      <div class="h3wz-grid-2">
        <div class="h3wz-field">
          <label>主体类别</label>
          <select data-ref-subjtype="${i}">${SUBJECT_TYPES.map((t) => `<option value="${t.id}" ${t.id === r.subjectType ? "selected" : ""}>${t.zh}</option>`).join("")}</select>
        </div>
      </div>
      <div class="h3wz-grid-2">
        ${field("是谁（主体指代，如 the young woman）", `ref-whoen-${i}`, r.whoEn, "如：the young woman / 那个年轻女子")}
        ${field("外观特征（保持一致的样貌）", `ref-looken-${i}`, r.lookEn, "如：long dark hair, blue cardigan / 黑色长发、蓝色开衫")}
      </div>
      ${subjectPartsHtml(r, i)}` : ""}
      ${r.kind === "picture" ? `
      <div class="h3wz-grid-3">
        <div class="h3wz-field">
          <label>角色</label>
          <select data-ref-picrole="${i}">${PICTURE_ROLES.map((t) => `<option value="${t.id}" ${t.id === r.pictureRole ? "selected" : ""}>${t.zh}</option>`).join("")}</select>
        </div>
        <div class="h3wz-field">
          <label>对应镜头</label>
          <input data-ref-shotmap="${i}" value="${esc(r.shotMap || "")}" placeholder="[Shot 1]" />
        </div>
        ${field("画面内容（这张图里显示了什么）", `ref-shownen-${i}`, r.shownEn, "如：a woman seated beside a café window / 咖啡馆窗边坐着的女子")}
      </div>` : ""}
      ${r.kind === "video" ? `
      <div class="h3wz-grid-2">
        <div class="h3wz-field">
          <label>角色</label>
          <select data-ref-vidrole="${i}">${VIDEO_ROLES.map((t) => `<option value="${t.id}" ${t.id === r.videoRole ? "selected" : ""}>${t.zh}</option>`).join("")}</select>
        </div>
        ${field("说明（这条视频素材的用途/内容）", `ref-noten-${i}`, r.noteEn, "如：original footage shot handheld / 手持拍摄的原始素材")}
      </div>` : ""}
      ${r.kind === "audio" ? `
      <div class="h3wz-grid-3">
        <div class="h3wz-field">
          <label>角色</label>
          <select data-ref-audrole="${i}">${AUDIO_ROLES.map((t) => `<option value="${t.id}" ${t.id === r.audioRole ? "selected" : ""}>${t.zh}</option>`).join("")}</select>
        </div>
        <div class="h3wz-field">
          <label>绑定目标主体（音色给谁）</label>
          <select data-ref-boundsubj="${i}">
            <option value="">（不绑定）</option>
            ${(state.refs || [])
              .filter((x) => x.kind === "subject" && x.id !== r.id)
              .map((s) => `<option value="${esc(s.id)}" ${s.id === r.boundSubjectId ? "selected" : ""}>${labelOf(s, state.refs)} · ${esc(s.whoZh || s.whoEn || "主体")}</option>`)
              .join("")}
          </select>
        </div>
        ${field("说明（这段音频是什么/用途）", `ref-noten-${i}`, r.noteEn, "如：spoken English vocal layer / 英文人声层")}
      </div>` : ""}
      <div class="h3wz-ref-retain" style="border-top:1px dashed #d8dee6;margin-top:8px;padding-top:6px;">
        <div style="font-size:12px;color:#6b7280;margin-bottom:4px;">retention_analysis（保真度）${isAudio ? "· 音频标记" : "· 可见内容标记"}</div>
        <div class="h3wz-grid-3">
          ${isAudio ? "" : `<div class="h3wz-field">
            <label>${r.kind === "subject" ? "出现位置（可选，自动拼 appears in）" : r.kind === "picture" ? "位置描述（可选）" : "结构描述（可选）"}</label>
            <input data-ref-appear="${i}" value="${esc(r.appear || "")}" placeholder="${r.kind === "subject" ? "如：[Shot 1], [Shot 3]" : r.kind === "picture" ? "如：[Shot 1] first frame" : "如：cut and pacing structure"}" />
          </div>`}
          <div class="h3wz-field">
            <label>保留标记</label>
            <select data-ref-retain="${i}">${retainList.map((x) => `<option value="${x.id}" ${x.id === retainZh ? "selected" : ""}>${x.zh}</option>`).join("")}</select>
          </div>
          <div class="h3wz-field">
            <label>保留说明（哪些特征保持不变）</label>
            <input data-ref-retainen="${i}" value="${esc(r.retainEn || "")}" placeholder="如：the dark hair and blue cardigan are retained / 黑发与蓝开衫保持不变" />
          </div>
        </div>
        <div style="font-size:11px;color:#9aa3af;margin-top:2px;">当前标记：<b>${esc(retainLabel)}</b> · 预览行：<code>${esc(retainLineOf(r, state.refs))}</code></div>
      </div>
    </div>`;
}

function renderRefs(root) {
  const matList = root.querySelector(".h3wz-mat-list");
  if (matList) {
    const mats = (state.refs || []).filter((x) => x.kind !== "subject");
    matList.innerHTML = mats.map((r) => refCardHtml(r, state.refs.indexOf(r))).join("");
  }
  const subjList = root.querySelector(".h3wz-subj-list");
  if (subjList) {
    const subjs = (state.refs || []).filter((x) => x.kind === "subject");
    subjList.innerHTML = subjs.map((r) => refCardHtml(r, state.refs.indexOf(r))).join("");
  }
}

function renderStatic(root) {
  const modeTrigger = root.querySelector("[data-mode-trigger]");
  const cur = MODES.find((m) => m.id === state.mode) || MODES[0];
  if (modeTrigger && cur) {
    modeTrigger.dataset.value = cur.id;
    modeTrigger.innerHTML = `<span>${cur.name}</span><span style="color:#9aa3af;font-size:10px;">▾</span>`;
  }
  const modeHint = root.querySelector("[data-mode-hint]");
  if (modeHint && cur) modeHint.textContent = `${cur.name} · ${cur.desc}`;

  const styleSel = root.querySelector("[data-style]");
  if (styleSel) styleSel.innerHTML = optionsHtml(STYLES, state.styleZh);

  const musicSel = root.querySelector("[data-music-chip]");
  if (musicSel) musicSel.innerHTML = optionsHtml(MUSIC_CHIPS, state.musicChipZh);

  const soundChips = root.querySelector(".h3wz-sound-chips");
  if (soundChips) {
    soundChips.innerHTML = SOUND_CHIPS.map((c) => {
      const on = (state.soundChipZhs || []).includes(c.zh);
      return `<button type="button" class="h3wz-chip ${on ? "on" : ""}" data-sound-chip="${esc(c.zh)}">${esc(c.zh)}</button>`;
    }).join("");
  }

  const phrases = root.querySelector(".h3wz-phrases-body");
  if (phrases) {
    phrases.innerHTML = PHRASES.map(
      (p, idx) => `<button type="button" class="h3wz-phrase" data-phrase="${idx}">${esc(p.cat)} · ${esc(p.en)}</button>`
    ).join("");
  }

  /* 回填静态字段（恢复工作流/切换模式后保持表单与 state 一致） */
  const setVal = (sel, value) => {
    const el = root.querySelector(sel);
    if (el) el.value = value ?? "";
  };
  const setChecked = (sel, value) => {
    const el = root.querySelector(sel);
    if (el) el.checked = !!value;
  };
  setVal("[data-duration]", state.duration);
  setVal("[data-style-custom-en]", state.styleCustomEn);
  setVal("[data-opening-en]", state.openingEn);
  setVal("[data-sound-en]", state.soundEn);
  setVal("[data-music-en]", state.musicEn);
  setChecked("[data-sound-silent]", state.soundSilent);
  setChecked("[data-music-na]", state.musicNA);

  /* Ref2VA 区块显隐 */
  const secRef = root.querySelector(".h3wz-sec-ref");
  const isRef = state.mode === "ref2va";
  if (secRef) secRef.style.display = isRef ? "" : "none";

  /* 任务类型 chips */
  const taskChips = root.querySelector(".h3wz-task-chips");
  if (taskChips) {
    taskChips.innerHTML = TASK_TYPES.map((t) => {
      const on = (state.taskTypes || []).includes(t.id);
      return `<button type="button" class="h3wz-chip ${on ? "on" : ""}" data-task-chip="${esc(t.id)}" title="${esc(t.en)}">${esc(t.zh)}</button>`;
    }).join("");
  }
  setVal("[data-summary-en]", state.summaryEn);

  renderRefs(root);
  renderShots(root); // Ref 模式下对话框有"绑定主体"下拉，需随 refs/mode 重绘
}

/* ============================ 收集与同步 ============================ */

function collectFromDom(root) {
  const q = (sel) => root.querySelector(sel);
  const qa = (sel) => [...root.querySelectorAll(sel)];

  const mode = q("[data-mode-trigger]");
  if (mode) state.mode = mode.dataset.value || state.mode;
  const duration = q("[data-duration]");
  if (duration) state.duration = Number(duration.value) || state.duration;

  const style = q("[data-style]");
  if (style) {
    state.styleZh = style.value;
    if (state.styleZh !== STYLE_CUSTOM_ZH) state.styleEn = syncSelectEn(STYLES, state.styleZh);
  }
  const styleCustomEn = q("[data-style-custom-en]");
  if (styleCustomEn) {
    state.styleCustomEn = styleCustomEn.value;
    state.styleCustomZh = ""; // 单框模式：旧 zh 备注不再参与拼装
  }
  if (state.styleZh === STYLE_CUSTOM_ZH) state.styleEn = (state.styleCustomEn || "").trim();
  const openingEn = q("[data-opening-en]");
  if (openingEn) {
    state.openingEn = openingEn.value;
    state.openingZh = "";
  }

  state.shots.forEach((s, i) => {
    const time = q(`[data-shot-time="${i}"]`);
    if (time) s.time = Number(time.value) || 0;
    const cut = q(`[data-shot-cut="${i}"]`);
    if (cut) {
      s.cutZh = cut.value;
      s.cutEn = syncSelectEn(CUT_PHRASES, cut.value);
    }
    const size = q(`[data-shot-size="${i}"]`);
    if (size) {
      s.sizeZh = size.value;
      s.sizeEn = syncSelectEn(SHOT_SIZES, size.value);
    }
    const cam = q(`[data-shot-cam="${i}"]`);
    if (cam) {
      s.camTypeZh = cam.value;
      s.camTypeEn = syncSelectEn(CAM_TYPES, cam.value);
    }
    const amp = q(`[data-shot-amp="${i}"]`);
    if (amp) {
      s.camAmpZh = amp.value;
      s.camAmpEn = syncSelectEn(CAM_AMP, amp.value);
    }
    const speed = q(`[data-shot-speed="${i}"]`);
    if (speed) {
      s.camSpeedZh = speed.value;
      s.camSpeedEn = syncSelectEn(CAM_SPEED, speed.value);
    }
    const camTargetEn = q(`[data-shot-camtarget-en="${i}"]`);
    if (camTargetEn) {
      s.camTargetEn = camTargetEn.value;
      s.camTargetZh = "";
    }
    const sceneEn = q(`[data-shot-scene-en-${i}]`);
    if (sceneEn) {
      s.sceneEn = sceneEn.value;
      s.sceneZh = "";
    }
    const actionEn = q(`[data-shot-action-en-${i}]`);
    if (actionEn) {
      s.actionEn = actionEn.value;
      s.actionZh = "";
    }
    const dsoundEn = q(`[data-shot-dsound-en-${i}]`);
    if (dsoundEn) {
      s.diegeticSoundEn = dsoundEn.value;
      s.diegeticSoundZh = "";
    }
    const onscreen = q(`[data-shot-onscreen="${i}"]`);
    if (onscreen) s.onscreenText = onscreen.value;

    (s.dialogs || []).forEach((d, di) => {
      const speaker = q(`[data-d-speaker="${i}-${di}"]`);
      if (speaker) d.speakerId = speaker.value;
      const subj = q(`[data-d-subj="${i}-${di}"]`);
      if (subj) d.subjectId = subj.value;
      const action = q(`[data-d-action="${i}-${di}"]`);
      if (action) {
        d.actionZh = action.value;
        d.actionEn = syncSelectEn(ACTION_VERBS, action.value);
      }
      const lang = q(`[data-d-lang="${i}-${di}"]`);
      if (lang) d.lang = lang.value;
      const whoEn = q(`[data-d-whoen="${i}-${di}"]`);
      if (whoEn) {
        d.whoEn = whoEn.value;
        d.whoZh = "";
      }
      const text = q(`[data-d-text="${i}-${di}"]`);
      if (text) d.text = text.value;
      const vo = q(`[data-d-vo="${i}-${di}"]`);
      if (vo) d.voiceover = vo.checked;
      const cross = q(`[data-d-cross="${i}-${di}"]`);
      if (cross) d.crossCut = cross.checked;
    });
  });

  const soundSilent = q("[data-sound-silent]");
  if (soundSilent) state.soundSilent = soundSilent.checked;
  const soundEn = q("[data-sound-en]");
  if (soundEn) {
    state.soundEn = soundEn.value;
    state.soundZh = "";
  }
  const musicChip = q("[data-music-chip]");
  if (musicChip) {
    state.musicChipZh = musicChip.value;
    state.musicChipEn = syncSelectEn(MUSIC_CHIPS, musicChip.value);
  }
  const musicNA = q("[data-music-na]");
  if (musicNA) state.musicNA = musicNA.checked;
  const musicEn = q("[data-music-en]");
  if (musicEn) {
    state.musicEn = musicEn.value;
    state.musicZh = "";
  }

  /* ---- Ref2VA ---- */
  const taskChips = qa("[data-task-chip]");
  if (taskChips.length) {
    state.taskTypes = taskChips.filter((c) => c.classList.contains("on")).map((c) => c.dataset.taskChip);
  }
  const summaryEn = q("[data-summary-en]");
  if (summaryEn) {
    state.summaryEn = summaryEn.value;
    state.summaryZh = "";
  }

  state.refs.forEach((r, i) => {
    const subjType = q(`[data-ref-subjtype="${i}"]`);
    if (subjType) r.subjectType = subjType.value;
    const get = (attr) => {
      const el = q(`[data-${attr}-${i}]`);
      return el ? el.value : undefined;
    };
    const whoEn = get("ref-whoen");
    if (whoEn !== undefined) {
      r.whoEn = whoEn;
      r.whoZh = "";
    }
    const lookEn = get("ref-looken");
    if (lookEn !== undefined) {
      r.lookEn = lookEn;
      r.lookZh = "";
    }
    const picRole = q(`[data-ref-picrole="${i}"]`);
    if (picRole) r.pictureRole = picRole.value;
    const shotMap = q(`[data-ref-shotmap="${i}"]`);
    if (shotMap) r.shotMap = shotMap.value;
    const shownEn = get("ref-shownen");
    if (shownEn !== undefined) {
      r.shownEn = shownEn;
      r.shownZh = "";
    }
    const vidRole = q(`[data-ref-vidrole="${i}"]`);
    if (vidRole) r.videoRole = vidRole.value;
    const audRole = q(`[data-ref-audrole="${i}"]`);
    if (audRole) r.audioRole = audRole.value;
    const boundSubj = q(`[data-ref-boundsubj="${i}"]`);
    if (boundSubj) r.boundSubjectId = boundSubj.value;
    const noteEn = get("ref-noten");
    if (noteEn !== undefined) {
      r.noteEn = noteEn;
      r.noteZh = "";
    }
    // subject 引用片段（parts）：@ 选素材 + 提供什么
    qa(`[data-ref-part-src^="${i}|"]`).forEach((sel) => {
      const pi = Number(sel.dataset.refPartSrc.split("|")[1]);
      if (!r.parts) r.parts = [];
      r.parts[pi] = Object.assign({ srcId: "", desc: "" }, r.parts[pi] || {});
      r.parts[pi].srcId = sel.value;
    });
    qa(`[data-ref-part-desc^="${i}|"]`).forEach((sel) => {
      const pi = Number(sel.dataset.refPartDesc.split("|")[1]);
      if (!r.parts) r.parts = [];
      r.parts[pi] = Object.assign({ srcId: "", desc: "" }, r.parts[pi] || {});
      r.parts[pi].desc = sel.value;
    });
    const appear = q(`[data-ref-appear="${i}"]`);
    if (appear) r.appear = appear.value;
    const retain = q(`[data-ref-retain="${i}"]`);
    if (retain) r.retain = retain.value;
    const retainEn = q(`[data-ref-retainen="${i}"]`);
    if (retainEn) {
      r.retainEn = retainEn.value;
      r.retainZh = "";
    }
  });
}

/* ============================ 节点集成 ============================ */

function widget(node, name) {
  return node?.widgets?.find((item) => item.name === name) || null;
}

function hideWidget(target) {
  if (!target || target.__h3WzHidden) return;
  target.__h3WzHidden = true;
  target.computeSize = () => [0, -4];
  const element = target.inputEl || target.element || target.domElement || target.inputElement;
  if (element?.style) element.style.display = "none";
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

function syncWidgets(node) {
  const root = node.__h3WzState?.root;
  if (root) collectFromDom(root);
  setWidgetValue(node, widget(node, FORM_WIDGET), JSON.stringify(state));
  const { sections } = assemble(state);
  const byKey = Object.fromEntries(sections.map((s) => [s.key, s.body]));
  FIELD_WIDGETS.forEach((name) => {
    setWidgetValue(node, widget(node, name), byKey[name] || "");
  });
}

function refreshPreview(node) {
  const st = node.__h3WzState;
  if (!st) return;
  if (st.root) collectFromDom(st.root);

  const { errors, warnings } = validate(state);
  const errBox = st.errors;
  if (errors.length || warnings.length) {
    const errHtml = errors.map((e) => `⛔ ${esc(e.msg)}`).join("<br>");
    const warnHtml = warnings.map((w) => `⚠️ ${esc(w.msg)}`).join("<br>");
    errBox.innerHTML = [errHtml, warnHtml].filter(Boolean).join("<br>");
    errBox.style.display = "block";
  } else {
    errBox.style.display = "none";
    errBox.innerHTML = "";
  }

  const { sections, full } = assemble(state);
  st.preview.textContent = full || "（填写内容后这里显示完整提示词）";

  const mode = MODES.find((m) => m.id === state.mode);
  st.status.textContent = errors.length
    ? `⛔ ${errors.length} 处错误`
    : warnings.length
      ? `⚠️ ${warnings.length} 处中文待翻译`
      : `✓ ${mode ? mode.name : ""} · ${formatDuration(state.duration)}s · ${state.shots.length} 镜`;
  st.status.style.color = errors.length ? "#ff7a7a" : warnings.length ? "#ffc46b" : "#7adfa0";
}

function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  return Promise.reject(new Error("剪贴板不可用"));
}

function toast(node, msg) {
  const st = node.__h3WzState;
  if (!st) return;
  st.status.textContent = msg;
  st.status.style.color = "#9fd0ff";
  setTimeout(() => refreshPreview(node), 1600);
}

function setupNode(node) {
  if (String(node?.comfyClass || node?.type || "") !== NODE_TYPE || node.__h3WzState) return;
  const formWidget = widget(node, FORM_WIDGET);
  if (!formWidget || !node.addDOMWidget) return;
  FIELD_WIDGETS.forEach((name) => hideWidget(widget(node, name)));
  hideWidget(formWidget);

  try {
    const saved = JSON.parse(String(formWidget.value || "{}") || "{}");
    state = mergeState(saved);
  } catch (_) {
    state = defaultState();
  }

  const container = document.createElement("div");
  Object.assign(container.style, {
    width: "100%", height: "100%", minHeight: "560px", boxSizing: "border-box",
    background: "#ffffff", color: "#1f2328", display: "flex", flexDirection: "column",
    font: "13px/1.5 system-ui, sans-serif", borderRadius: "10px", overflow: "hidden",
    border: "1px solid #d8dee6",
  });

  container.innerHTML = `
    <div class="h3wz-header" style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:#f2f5f9;border-bottom:1px solid #d8dee6;flex-wrap:wrap;">
      <span data-mode-wrap style="position:relative;display:inline-block;">
        <button type="button" data-mode-trigger title="生成模式" style="padding:3px 8px;border:1px solid #c6cfdb;border-radius:6px;background:#fff;color:#1f2328;cursor:pointer;font:inherit;display:inline-flex;align-items:center;gap:6px;min-width:90px;justify-content:space-between;"></button>
      </span>
      <span data-mode-hint style="font-size:12px;color:#4a5568;background:#eef2f7;padding:3px 8px;border-radius:6px;line-height:1.4;"></span>
      <label style="display:flex;align-items:center;gap:4px;color:#4a5568;font-size:12px;">时长(s)
        <input type="number" data-duration min="0.5" step="0.01" value="6" style="width:64px;padding:3px 6px;border:1px solid #c6cfdb;border-radius:6px;" />
      </label>
      <button type="button" class="h3wz-btn" data-toggle-body>收起表单</button>
      <button type="button" class="h3wz-btn" data-copy-all>复制全部</button>
      <span class="h3wz-status" style="font-size:12px;font-weight:600;margin-left:auto;"></span>
    </div>
    <div class="h3wz-body" style="flex:1;overflow:hidden;display:flex;flex-direction:row;min-height:0;">
      <div class="h3wz-form-col" style="flex:1;overflow-y:auto;padding:10px 12px;display:flex;flex-direction:column;gap:12px;min-width:0;">
      <section class="h3wz-sec h3wz-sec-ref" style="display:none;border:1px solid #c8d8f0;border-radius:8px;padding:8px 10px;background:#f7fafd;">
        <div class="h3wz-sec-title" style="font-weight:700;margin-bottom:4px;color:#2d3748;">① 参考素材 + Subject 定义（Ref2VA · 自动编号）</div>
        <div style="font-size:12px;color:#6b7280;margin-bottom:6px;">
          素材（图片/视频/音频）是「引用元素」，先定义素材，再定义 Subject 引用它们。一个 Subject 可引用多个素材（如：脸来自图1、衣服来自图2）。输出时 Subject 定义行自动排在素材定义行之前（对齐官方 subject_definitions）。图片 ≤ 9 · 视频 ≤ 3 · 音频 ≤ 3 · 总数 ≤ 12。
        </div>
        <div style="font-size:12px;font-weight:600;color:#2d3748;margin:6px 0 4px;">引用元素（素材）</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;">
          <button type="button" class="h3wz-btn h3wz-btn-add" data-add-mat="picture">+ 加图片</button>
          <button type="button" class="h3wz-btn h3wz-btn-add" data-add-mat="video">+ 加视频</button>
          <button type="button" class="h3wz-btn h3wz-btn-add" data-add-mat="audio">+ 加音频</button>
        </div>
        <div class="h3wz-mat-list" style="display:flex;flex-direction:column;gap:8px;"></div>
        <div style="font-size:12px;font-weight:600;color:#2d3748;margin:10px 0 4px;">Subject 定义（引用上方素材）</div>
        <button type="button" class="h3wz-btn h3wz-btn-add" data-add-subj style="margin-bottom:6px;">+ 加 Subject</button>
        <div class="h3wz-subj-list" style="display:flex;flex-direction:column;gap:8px;"></div>
      </section>
      <section class="h3wz-sec">
        <div class="h3wz-sec-title" style="font-weight:700;margin-bottom:6px;color:#2d3748;">② 整体设定</div>
        <div class="h3wz-grid-2">
          <div class="h3wz-field">
            <label>画面风格（写入 [Shot 1] 开头）</label>
            <select data-style style="width:100%"></select>
          </div>
          <div class="h3wz-field">
            <label>自定义风格（选「自定义…」时必填）</label>
            <input data-style-custom-en style="width:100%" placeholder="如：Cyberpunk neon night / 赛博朋克霓虹夜" />
          </div>
        </div>
        <div class="h3wz-grid-2">
          <div class="h3wz-field">
            <label>开场构图与场景（会拼到 [Shot 1] 开头）</label>
            <textarea data-opening-en rows="2" style="width:100%" placeholder="如：雨夜列车窗边，中全景框住一位年轻女子"></textarea>
          </div>
        </div>
        <details class="h3wz-phrases" style="margin-top:6px;">
          <summary style="cursor:pointer;color:#2b6cb0;font-size:12px;">📋 常用英文句式（点击复制 → 粘贴到对应输入框）</summary>
          <div class="h3wz-phrases-body" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;"></div>
        </details>
      </section>
      <section class="h3wz-sec">
        <div class="h3wz-sec-title" style="font-weight:700;margin-bottom:6px;color:#2d3748;">③ 分镜时间线（第一镜无时间戳，后续切镜递增）</div>
        <div class="h3wz-shot-list" style="display:flex;flex-direction:column;gap:10px;"></div>
        <button type="button" class="h3wz-btn h3wz-btn-add" data-add-shot style="margin-top:6px;">+ 加一个镜头</button>
      </section>
      <section class="h3wz-sec">
        <div class="h3wz-sec-title" style="font-weight:700;margin-bottom:6px;color:#2d3748;">④ 声音与配乐</div>
        <div class="h3wz-field">
          <label>环境声芯片（可多选，写入 overall_soundscape）</label>
          <div class="h3wz-sound-chips" style="display:flex;flex-wrap:wrap;gap:6px;"></div>
        </div>
        <label class="h3wz-checks" style="margin-top:4px;"><input type="checkbox" data-sound-silent /> 全程静音（N/A）</label>
        <div class="h3wz-field">
          <label>环境声补充（可选，写这镜之外的全局环境声）</label>
          <textarea data-sound-en rows="2" style="width:100%" placeholder="如：雨点打在车窗，远处有模糊人声"></textarea>
        </div>
        <div class="h3wz-grid-2">
          <div class="h3wz-field">
            <label>配乐预设（写入 non_diegetic_music）</label>
            <select data-music-chip style="width:100%"></select>
          </div>
          <div class="h3wz-field">
            <label>配乐补充（可选，写配器/速度/节奏/动态）</label>
            <textarea data-music-en rows="2" style="width:100%" placeholder="如：慢速钢琴，大提琴铺底后淡出"></textarea>
          </div>
        </div>
        <label class="h3wz-checks"><input type="checkbox" data-music-na /> 强制无配乐（N/A）</label>
      </section>
      <section class="h3wz-sec h3wz-sec-ref" style="display:none;border:1px solid #c8d8f0;border-radius:8px;padding:8px 10px;background:#f7fafd;">
        <div class="h3wz-sec-title" style="font-weight:700;margin-bottom:4px;color:#2d3748;">⑤ 任务类型 + summary（自动生成方括号前缀）</div>
        <div class="h3wz-field">
          <label>任务类型（可多选，自动拼成 [A + B] 前缀）</label>
          <div class="h3wz-task-chips" style="display:flex;flex-wrap:wrap;gap:6px;"></div>
        </div>
        <div class="h3wz-field">
          <label>summary 概括（一句话，自动加 [任务类型] 前缀）</label>
          <textarea data-summary-en rows="2" style="width:100%" placeholder="如：目标视频里，<Subject 1> 中的女子走过 <Subject 2> 场景并回眸微笑"></textarea>
        </div>
        <div style="font-size:12px;color:#6b7280;">详述（detailed_description）由 ① 风格 + ② 分镜时间线自动拼出；对白可绑定主体输出 &lt;Subject N&gt; (Sx)。</div>
      </section>
      </div>
      <div class="h3wz-preview-col" style="width:min(340px,38%);flex-shrink:0;border-left:1px solid #d8dee6;background:#fbfcfe;display:flex;flex-direction:column;overflow:hidden;min-width:0;">
        <div style="display:flex;align-items:center;gap:6px;padding:8px 12px;background:#f2f5f9;border-bottom:1px solid #e8edf3;flex-shrink:0;">
          <span style="font-weight:600;color:#2d3748;font-size:12px;">最终提示词（点击可复制）</span>
          <button type="button" class="h3wz-btn" data-toggle-preview style="margin-left:auto;">收起预览</button>
        </div>
        <div class="h3wz-errors" style="display:none;padding:8px 12px;font-size:12px;line-height:1.5;border-bottom:1px solid #e8edf3;flex-shrink:0;"></div>
        <pre class="h3wz-preview" style="margin:0;padding:10px 12px;white-space:pre-wrap;word-break:break-word;font:12px/1.6 Consolas, monospace;flex:1;overflow-y:auto;user-select:all;"></pre>
      </div>
    </div>`;

  const body = container.querySelector(".h3wz-body");
  const formCol = container.querySelector(".h3wz-form-col");
  const preview = container.querySelector(".h3wz-preview");
  const errors = container.querySelector(".h3wz-errors");
  const status = container.querySelector(".h3wz-status");
  const root = container;

  node.__h3WzState = { root, body, formCol, preview, errors, status, container };

  renderStatic(root);
  renderShots(root);
  bindEvents(node);

  const domWidget = node.addDOMWidget("h3_prompt_wizard_panel", "H3_PROMPT_WIZARD", container, {
    serialize: false,
    hideOnZoom: false,
    getValue: () => JSON.stringify(state),
    setValue: () => {},
    getMinHeight: () => 560,
  });
  if (domWidget) {
    domWidget.options ??= {};
    domWidget.options.minNodeSize = [560, 640];
  }

  syncWidgets(node);
  refreshPreview(node);
  node.setSize?.([Math.max(Number(node.size?.[0]) || 0, 600), Math.max(Number(node.size?.[1]) || 0, 680)]);
}

/* ============================ 自实现下拉（脱离 <select>） ============================ */

let __modeDropdownEl = null;

function closeModeDropdown() {
  if (__modeDropdownEl && __modeDropdownEl.parentNode) {
    __modeDropdownEl.parentNode.removeChild(__modeDropdownEl);
  }
  __modeDropdownEl = null;
  document.removeEventListener("mousedown", onDocMousedown, true);
  document.removeEventListener("keydown", onDocKeydown, true);
  window.removeEventListener("scroll", closeModeDropdown, true);
  window.removeEventListener("resize", closeModeDropdown, true);
}

function onDocMousedown(e) {
  if (__modeDropdownEl && !__modeDropdownEl.contains(e.target) && !(e.target instanceof HTMLElement && e.target.closest("[data-mode-trigger]"))) {
    closeModeDropdown();
  }
}

function onDocKeydown(e) {
  if (e.key === "Escape") closeModeDropdown();
}

function toggleModeDropdown(trigger) {
  if (__modeDropdownEl) { closeModeDropdown(); return; }
  const rect = trigger.getBoundingClientRect();
  const dd = document.createElement("div");
  dd.dataset.modeDropdown = "1";
  Object.assign(dd.style, {
    position: "fixed", top: `${rect.bottom + 2}px`, left: `${rect.left}px`,
    minWidth: `${rect.width}px`, zIndex: "99999",
    background: "#ffffff", border: "1px solid #c6cfdb", borderRadius: "8px",
    boxShadow: "0 6px 20px rgba(0,0,0,0.15)", padding: "4px 0",
    font: "13px/1.5 system-ui, sans-serif", color: "#1f2328",
    maxHeight: "320px", overflowY: "auto",
  });
  dd.innerHTML = MODES.map((m) => {
    const active = m.id === state.mode;
    return `<div data-mode-opt="${m.id}" style="padding:6px 12px;cursor:pointer;background:${active ? "#eef2f7" : "#fff"};color:#1f2328;display:flex;align-items:center;gap:8px;">
      <span style="font-weight:${active ? 600 : 500};">${m.name}</span>
      <span style="color:#6b7280;font-size:12px;">· ${esc(m.desc)}</span>
    </div>`;
  }).join("");
  document.body.appendChild(dd);
  __modeDropdownEl = dd;

  dd.addEventListener("mousedown", (e) => {
    const item = e.target instanceof HTMLElement ? e.target.closest("[data-mode-opt]") : null;
    if (!item) return;
    e.preventDefault();
    e.stopPropagation();
    const id = item.dataset.modeOpt;
    if (id && id !== state.mode) {
      state.mode = id;
      const root = trigger.__h3WzNode?.__h3WzState?.root;
      if (root) renderStatic(root);
      if (trigger.__h3WzNode) {
        syncWidgets(trigger.__h3WzNode);
        refreshPreview(trigger.__h3WzNode);
      }
    }
    closeModeDropdown();
  });

  /* 滚动/缩放/外部点击/Esc 关闭 */
  setTimeout(() => {
    document.addEventListener("mousedown", onDocMousedown, true);
    document.addEventListener("keydown", onDocKeydown, true);
    window.addEventListener("scroll", closeModeDropdown, true);
    window.addEventListener("resize", closeModeDropdown, true);
  }, 0);
}

/* ============================ 事件 ============================ */

function bindEvents(node) {
  const st = node.__h3WzState;
  const root = st.root;

  const refresh = () => {
    syncWidgets(node);
    refreshPreview(node);
  };

  /* 让自实现下拉能反查 node 主体（调 syncWidgets/refreshPreview） */
  const modeTrigger = root.querySelector("[data-mode-trigger]");
  if (modeTrigger) modeTrigger.__h3WzNode = node;

  root.addEventListener("input", (event) => {
    const target = event.target;
    if (target.matches("textarea, input[type=text], input[type=number]")) refresh();
  });

  root.addEventListener("change", (event) => {
    const target = event.target;
    if (target.matches("select, input[type=checkbox]")) {
      if (target.matches("[data-style]")) {
        // 切到自定义时清掉旧 styleEn，交给 collectFromDom 重算
        if (target.value === STYLE_CUSTOM_ZH) {
          state.styleEn = "";
        }
      }
      refresh();
    }
  });

  /* 模式自实现下拉（脱离原生 <select> 避免主题染色） */
  root.addEventListener("click", (event) => {
    const t = event.target;
    if (!(t instanceof HTMLElement)) return;
    if (t.closest("[data-mode-trigger]")) {
      event.stopPropagation();
      toggleModeDropdown(t.closest("[data-mode-trigger]"));
    }
  });

  root.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    /* 折叠/展开 */
    if (target.matches("[data-toggle-body]")) {
      const collapsed = st.formCol.style.display === "none";
      st.formCol.style.display = collapsed ? "" : "none";
      target.textContent = collapsed ? "收起表单" : "展开表单";
      return;
    }
    if (target.matches("[data-toggle-preview]")) {
      const collapsed = st.preview.style.display === "none";
      st.preview.style.display = collapsed ? "" : "none";
      target.textContent = collapsed ? "收起预览" : "展开预览";
      return;
    }

    /* 复制全部 */
    if (target.matches("[data-copy-all]")) {
      const { full } = assemble(state);
      if (!full) return;
      copyText(full).then(() => toast(node, "✓ 已复制全部提示词")).catch(() => toast(node, "复制失败"));
      return;
    }
    /* 复制预览（点击预览区复制当前段落） */
    if (target.matches(".h3wz-preview")) {
      copyText(st.preview.textContent).then(() => toast(node, "✓ 已复制预览")).catch(() => toast(node, "复制失败"));
      return;
    }

    /* 常用句式复制 */
    if (target.matches("[data-phrase]")) {
      const idx = Number(target.dataset.phrase);
      const phrase = PHRASES[idx];
      if (phrase) copyText(phrase.en).then(() => toast(node, `✓ 已复制：${phrase.en}`)).catch(() => toast(node, "复制失败"));
      return;
    }

    /* 环境声芯片 */
    if (target.matches("[data-sound-chip]")) {
      const zh = target.dataset.soundChip;
      const chip = SOUND_CHIPS.find((c) => c.zh === zh);
      const zhs = new Set(state.soundChipZhs || []);
      const ens = new Set(state.soundChipEns || []);
      if (zhs.has(zh)) {
        zhs.delete(zh);
        if (chip) ens.delete(chip.en);
      } else {
        zhs.add(zh);
        if (chip) ens.add(chip.en);
      }
      state.soundChipZhs = [...zhs];
      state.soundChipEns = [...ens];
      target.classList.toggle("on");
      refresh();
      return;
    }

    /* 镜头增删 */
    if (target.matches("[data-add-shot]")) {
      const last = state.shots[state.shots.length - 1];
      const t = Math.min((Number(state.duration) || 6) - 0.5, (Number(last && last.time) || 0) + 2);
      state.shots.push(emptyShot(Math.max(0.5, t)));
      renderShots(root);
      refresh();
      return;
    }
    if (target.matches("[data-del-shot]")) {
      if (state.shots.length <= 1) return;
      state.shots.splice(Number(target.dataset.delShot), 1);
      state.shots[0].time = 0;
      renderShots(root);
      refresh();
      return;
    }

    /* 对白增删 */
    if (target.matches("[data-add-dialog]")) {
      const i = Number(target.dataset.addDialog);
      state.shots[i].dialogs = state.shots[i].dialogs || [];
      state.shots[i].dialogs.push(emptyDialog());
      renderShots(root);
      refresh();
      return;
    }
    if (target.matches("[data-del-dialog]")) {
      const [si, di] = target.dataset.delDialog.split("-").map(Number);
      if (state.shots[si]) state.shots[si].dialogs.splice(di, 1);
      renderShots(root);
      refresh();
      return;
    }

    /* 任务类型 chips */
    if (target.matches("[data-task-chip]")) {
      const id = target.dataset.taskChip;
      const list = state.taskTypes || [];
      if (list.includes(id)) {
        state.taskTypes = list.filter((x) => x !== id);
      } else {
        list.push(id);
        state.taskTypes = list;
      }
      target.classList.toggle("on");
      refresh();
      return;
    }

    /* Ref2VA 素材 / Subject / 引用片段增删 */
    if (target.matches("[data-add-mat]")) {
      state.refs = state.refs || [];
      state.refs.push(emptyRef(target.dataset.addMat));
      renderRefs(root);
      renderShots(root); // 对话框"绑定主体"下拉依赖 refs
      refresh();
      return;
    }
    if (target.matches("[data-add-subj]")) {
      state.refs = state.refs || [];
      state.refs.push(emptyRef("subject"));
      renderRefs(root);
      renderShots(root);
      refresh();
      return;
    }
    if (target.matches("[data-add-part]")) {
      const i = Number(target.dataset.addPart);
      const r = state.refs[i];
      if (!r) return;
      if (!Array.isArray(r.parts)) r.parts = [];
      r.parts.push({ srcId: "", desc: "" });
      renderRefs(root);
      refresh();
      return;
    }
    if (target.matches("[data-del-part]")) {
      const [ri, pi] = target.dataset.delPart.split("|").map(Number);
      const r = state.refs[ri];
      if (!r || !Array.isArray(r.parts)) return;
      r.parts.splice(pi, 1);
      renderRefs(root);
      refresh();
      return;
    }
    if (target.matches("[data-del-ref]")) {
      if (!state.refs || !state.refs.length) return;
      const i = Number(target.dataset.delRef);
      const removed = state.refs[i];
      state.refs.splice(i, 1);
      // 清理其他 subject 的 parts 里指向被删素材的悬空引用
      if (removed && removed.kind !== "subject") {
        state.refs.forEach((x) => {
          if (Array.isArray(x.parts)) x.parts = x.parts.filter((p) => p.srcId !== removed.id);
        });
      }
      renderRefs(root);
      renderShots(root); // 对话框"绑定主体"下拉依赖 refs
      refresh();
      return;
    }
  });

  ["pointerdown", "pointermove", "dblclick", "wheel"].forEach((name) =>
    root.addEventListener(name, (event) => event.stopPropagation())
  );
}

/* ============================ 注册扩展 ============================ */

app.registerExtension({
  name: "CZToolkit.H3PromptWizard.UI",
  nodeCreated(node) {
    if (String(node?.comfyClass || node?.type || "") === NODE_TYPE) setTimeout(() => setupNode(node), 20);
  },
  loadedGraphNode(node) {
    if (String(node?.comfyClass || node?.type || "") === NODE_TYPE) setTimeout(() => setupNode(node), 60);
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
      if (this.__h3WzState) {
        syncWidgets(this);
        refreshPreview(this);
      }
      return serialized?.apply(this, arguments);
    };
    const configured = nodeTypeClass.prototype.onConfigure;
    nodeTypeClass.prototype.onConfigure = function () {
      const result = configured?.apply(this, arguments);
      if (this.__h3WzState) {
        try {
          const saved = JSON.parse(String(widget(this, FORM_WIDGET)?.value || "{}") || "{}");
          state = mergeState(saved);
        } catch (_) {
          /* 保留当前 state */
        }
        renderStatic(this.__h3WzState.root);
        renderShots(this.__h3WzState.root);
        syncWidgets(this);
        refreshPreview(this);
      }
      return result;
    };
  },
});

console.log("[CZ-Toolkit] H3 Prompt Wizard UI loaded");
