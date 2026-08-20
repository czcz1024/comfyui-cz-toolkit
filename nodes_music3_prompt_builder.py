"""Music3 提示词包装节点：把“选择题风格”的节奏/拍子/律动等约束
编译成 LLM 可用的 system prompt + user message（供 `LLMGenerator` 跑）。

这是“填空题 → 选择题”的关键：用户不需要手写 BPM/结构，节点会把下拉项翻译成
更接近 Music3 结构化 Caption 的显式约束。
"""

from __future__ import annotations

import json
import re


_LYRIC_TAG_RE = re.compile(r"\[([^\]\r\n]{1,120})\]")


def _extract_lyric_tags(lyrics: str) -> list[str]:
    """提取如 [Verse] / [Chorus] 的标签（去重，保留方括号）。"""
    tags: list[str] = []
    for raw in _LYRIC_TAG_RE.findall(str(lyrics or "")):
        tag = "[" + re.sub(r"\s+", " ", raw).strip() + "]"
        if tag not in tags:
            tags.append(tag)
    return tags


def _strip_control_text(s: str) -> str:
    return str(s or "").strip()


MUSIC3_SYSTEM_PROMPT = r"""
You are the MiniMax Music 3 Structured Caption and lyrics compiler.

Turn a concise music request and optional lyrics into a fresh, generation-oriented Music 3 caption.
Work privately: first form a Music Brief, resolve constraints, and then create a coherent timeline.
Never reveal reference IDs, routing scores, template content, or chain of thought.

Hard rules, in priority order:
1. Preserve explicit user requirements and exclusions. Then preserve section-local bracketed lyric tags.
2. When source lyrics are supplied (non-empty), they are immutable private analysis material:
   never quote, paraphrase, summarize, translate, or repeat them in the caption.
   Return "generated_lyrics" as an empty string (the caller will preserve the original lyrics text).
   Only bracketed tags may become section-level arrangement directives.
3. When source lyrics are absent (empty) and the request is vocal music, create a complete original lyric in "generated_lyrics".
   Use Music3 bracketed section tags such as [Intro], [Verse], [Pre-Chorus], [Chorus], [Bridge], and [Outro].
   Do not put lyrics into any caption field.
4. When the request is instrumental or forbids vocals, "generated_lyrics" must be an empty string and
   "vocal_details" must describe the lead melodic instrument or texture.
5. Do not reverse a specified vocal gender, tempo constraint, required instrument, or prohibition.
6. Do not fabricate exact BPM, key, scale, vocalist identity, or technical production claims.
   Use a range or qualitative description unless explicitly supplied or clearly justified by the controls.
7. References are inspiration only. Do not copy sentences, distinctive phrases, exact instrument lifecycles, or full structures.
   Synthesize a new result.
8. Make an audible section-by-section arrangement: explain entrances, exits, intensification, groove changes,
   transitions, and texture lifecycle. Do not return a static equipment list.

Return JSON only (no markdown fences), with exactly these keys:
{
  "global_metadata": "...",
  "vocal_details": "...",
  "arrangement": "...",
  "generated_lyrics": "complete tagged lyrics when source lyrics are absent and vocals are wanted; otherwise an empty string",
  "music_brief": "short non-sensitive summary of preserved user constraints only",
  "validation": "short confirmation of constraint, lyric-tag, and structure checks"
}

The three caption fields must render as exactly these headings when assembled by the caller:
Global Metadata, Vocal Details, Arrangement.

Never put a song title or any hidden reasoning into caption fields.
""".strip()


# ---- 选择题选项（用户看到的中文标签） ----

STYLE_OPTIONS = [
    "自动识别",
    "东亚现代流行（C-pop/J-pop/R&B/说唱融合）",
    "东亚抒情与国风（华语/日系抒情、原声或管弦）",
    "电影感流行抒情（Orchestral Pop Ballad）",
    "电子、合成器与氛围流行（Synth/Ambient Pop）",
    "嘻哈/说唱（Hip-hop / Rap / Trap）",
    "爵士/摇摆/大乐队（Jazz / Swing / Big Band）",
    "传统声乐/音乐剧/舞台（Stage Vocal / Musical Theatre）",
    "摇滚/金属（Rock / Metal）",
    "当代民谣与原声（Indie Folk / Singer-Songwriter）",
    "自定义",
]

Vocal_OPTIONS = [
    "自动识别",
    "纯器乐｜禁止人声与歌词",
    "单人女声",
    "单人男声",
    "男女对唱",
    "双女声和声",
    "双男声和声",
    "混声主唱与合唱团",
    "说唱主唱",
    "念白/旁白与音乐",
    "自定义",
]

Tempo_OPTIONS = [
    "自动识别",
    "慢速｜60–78 BPM",
    "中慢｜79–96 BPM",
    "中快｜97–115 BPM",
    "快速｜116–132 BPM",
    "高速｜133–155 BPM",
    "极高速｜156–180 BPM",
    "自定义",
]

Meter_OPTIONS = [
    "自动识别",
    "4/4",
    "3/4",
    "6/8",
    "自由节拍/无固定律动",
    "自定义",
]

Groove_OPTIONS = [
    "自动识别",
    "平稳流行律动",
    "Swing摇摆律动",
    "Shuffle切分律动",
    "四拍踩底舞曲律动",
    "Trap切分与Hi-hat滚奏",
    "Funk切分与贝斯主导",
    "拉丁/波萨律动",
    "摇滚直拍与强反拍",
    "自由节奏/氛围脉冲",
    "自定义",
]

MoodArc_OPTIONS = [
    "自动识别",
    "克制铺陈 → 温暖释放 → 余韵收束",
    "脆弱低语 → 渐强 → 宣言式高潮",
    "平静神秘 → 紧张堆叠 → 史诗爆发",
    "忧伤回望 → 希望抬升 → 治愈落地",
    "明亮轻快 → 律动推进 → 庆祝式收尾",
    "暗涌压迫 → 强烈对抗 → 决绝收束",
    "浪漫亲密 → 宽阔抒情 → 温柔回落",
    "热血蓄力 → 高能副歌 → 胜利定格",
    "自定义",
]

Structure_OPTIONS = [
    "自动识别",
    "完整歌曲（Verse/Chorus/Bridge 全展开）",
    "主歌副歌为主（多次回副歌）",
    "EDM 起承转合（Build/Drop/Breakdown）",
    "说唱结构（Rap Verse/Hook 交替）",
    "抒情循环式氛围（单段循环）",
    "自定义",
]

OutputLanguage_OPTIONS = ["英文（Music 3推荐）", "中文", "双语：英文为主、中文注释"]


# ---- 选择题翻译为 LLM 可读约束（尽量英文，减少歧义） ----

STYLE_MAP = {
    "自动识别": "",
    "东亚现代流行（C-pop/J-pop/R&B/说唱融合）": "East Asian modern pop (C-pop/J-pop fused with R&B and rap)",
    "东亚抒情与国风（华语/日系抒情、原声或管弦）": "East Asian ballad and heritage (Chinese/Japanese lyrical style, acoustic or orchestral)",
    "电影感流行抒情（Orchestral Pop Ballad）": "cinematic pop ballad with orchestral pop language",
    "电子、合成器与氛围流行（Synth/Ambient Pop）": "electronic synth and ambient pop (atmospheric, textural)",
    "嘻哈/说唱（Hip-hop / Rap / Trap）": "hip-hop / rap / trap energy",
    "爵士/摇摆/大乐队（Jazz / Swing / Big Band）": "jazz swing / big band style",
    "传统声乐/音乐剧/舞台（Stage Vocal / Musical Theatre）": "traditional vocal / musical theatre / stage performance",
    "摇滚/金属（Rock / Metal）": "rock or metal heavy tone (guitar-forward or heavy ensemble)",
    "当代民谣与原声（Indie Folk / Singer-Songwriter）": "contemporary indie folk / singer-songwriter",
    "自定义": "",
}

Vocal_MAP = {
    "自动识别": "",
    "纯器乐｜禁止人声与歌词": "instrumental only; no lead vocals; no lyrics",
    "单人女声": "female lead vocals (singer-songwriter tone or expressive pop vocals)",
    "单人男声": "male lead vocals",
    "男女对唱": "male-female duet vocals",
    "双女声和声": "two female harmony vocals",
    "双男声和声": "two male harmony vocals",
    "混声主唱与合唱团": "mixed choir and lead vocals",
    "说唱主唱": "rap rhythmic vocal delivery",
    "念白/旁白与音乐": "spoken word / narration integrated with music",
    "自定义": "",
}

TEMPO_MAP = {
    "自动识别": "",
    "慢速｜60–78 BPM": "approximately 60–78 BPM",
    "中慢｜79–96 BPM": "approximately 79–96 BPM",
    "中快｜97–115 BPM": "approximately 97–115 BPM",
    "快速｜116–132 BPM": "approximately 116–132 BPM",
    "高速｜133–155 BPM": "approximately 133–155 BPM",
    "极高速｜156–180 BPM": "approximately 156–180 BPM",
    "自定义": "",
}

METER_MAP = {
    "自动识别": "",
    "4/4": "4/4 time",
    "3/4": "3/4 time",
    "6/8": "6/8 time",
    "自由节拍/无固定律动": "free rhythm; no strict meter",
    "自定义": "",
}

GROOVE_MAP = {
    "自动识别": "",
    "平稳流行律动": "steady pop groove with clear rhythmic pulse",
    "Swing摇摆律动": "swing groove with a swung feel",
    "Shuffle切分律动": "shuffle rhythm with swung subdivision",
    "四拍踩底舞曲律动": "four-on-the-floor dance pulse (kick-driven)",
    "Trap切分与Hi-hat滚奏": "trap-style syncopation with hi-hat rolls",
    "Funk切分与贝斯主导": "funk syncopation; bass-led groove",
    "拉丁/波萨律动": "latin/bossa rhythm with light syncopation",
    "摇滚直拍与强反拍": "rock straight feel with strong backbeat",
    "自由节奏/氛围脉冲": "free rhythm / ambient pulse groove",
    "自定义": "",
}


MOODARC_MAP = {
    "自动识别": "",
    "克制铺陈 → 温暖释放 → 余韵收束": "a restrained buildup that warms up and releases into an emotionally settling ending",
    "脆弱低语 → 渐强 → 宣言式高潮": "soft vulnerability that gradually intensifies into a declarative climax",
    "平静神秘 → 紧张堆叠 → 史诗爆发": "calm mystery that stacks tension into an epic burst",
    "忧伤回望 → 希望抬升 → 治愈落地": "melancholic reflection moving upward into hopeful healing",
    "明亮轻快 → 律动推进 → 庆祝式收尾": "bright and light mood, rhythm pushing forward into a celebratory closure",
    "暗涌压迫 → 强烈对抗 → 决绝收束": "dark pressure that confronts strongly then resolves firmly",
    "浪漫亲密 → 宽阔抒情 → 温柔回落": "romantic intimacy that opens up into wide lyrical expression and gently falls back",
    "热血蓄力 → 高能副歌 → 胜利定格": "building heat into high-energy choruses, finishing with a triumphant freeze",
    "自定义": "",
}


STRUCTURE_MAP = {
    "自动识别": "",
    "完整歌曲（Verse/Chorus/Bridge 全展开）": "Intro → Verse → Pre-Chorus → Chorus → Verse → Chorus → Bridge → Final Chorus → Outro",
    "主歌副歌为主（多次回副歌）": "Intro → Verse → Chorus → Verse → Chorus → Outro",
    "EDM 起承转合（Build/Drop/Breakdown）": "Intro → Build → Drop → Breakdown → Final Drop → Outro",
    "说唱结构（Rap Verse/Hook 交替）": "Intro → Rap Verse → Hook → Rap Verse → Hook → Bridge → Final Hook → Outro",
    "抒情循环式氛围（单段循环）": "single-loop atmosphere development with evolving textures",
    "自定义": "",
}


OUTPUT_LANGUAGE_MAP = {
    "英文（Music 3推荐）": "English",
    "中文": "Simplified Chinese (keep the final heading names in English when assembled)",
    "双语：英文为主、中文注释": "English main caption with concise Simplified Chinese notes in parentheses when helpful",
}


class Music3PromptBuilder:
    """Music3 参数包装（选择题版节奏/拍子向导）。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "原始音乐需求": ("STRING", {"multiline": True, "default": "你想要的音乐风格/情绪/场景；比如：温暖的女声流行，副歌要逐步扩张，结尾温柔收束。"}),
                "歌词": (
                    "STRING",
                    {
                        "multiline": True,
                        "default": "",
                        "tooltip": "留空=LLM 自动生成带 [Verse]/[Chorus] 等标签的完整歌词；有内容则原样保留，并从「歌词」输出口透传给解析节点。",
                    },
                ),
                "风格大类": (STYLE_OPTIONS, {"default": "自动识别"}),
                "人声配置": (Vocal_OPTIONS, {"default": "自动识别"}),
                "速度": (Tempo_OPTIONS, {"default": "自动识别"}),
                "拍号/律动": (Meter_OPTIONS, {"default": "自动识别"}),
                "核心律动（Groove）": (Groove_OPTIONS, {"default": "自动识别"}),
                "情绪弧": (MoodArc_OPTIONS, {"default": "自动识别"}),
                "歌曲结构": (Structure_OPTIONS, {"default": "自动识别"}),
                "目标曲长（影响资源/文本密度）": ("STRING", {"multiline": False, "default": "自动识别", "tooltip": "例如：30–60秒 / 1–2分钟 / 4–5分钟；不想填就写自动识别。"}),
                "输出语言": (OutputLanguage_OPTIONS, {"default": "英文（Music 3推荐）"}),
            },
            "optional": {
                "外部歌词": (
                    "STRING",
                    {
                        "forceInput": True,
                        "default": "",
                        "tooltip": "可选。接入后与本节点「歌词」文本框合并；合并结果从「歌词」输出口输出。",
                    },
                ),
                "自定义节奏描述（当“速度=自定义”才用）": ("STRING", {"forceInput": True, "default": ""}),
                "自定义拍号描述（当“拍号/律动=自定义”才用）": ("STRING", {"forceInput": True, "default": ""}),
                "自定义律动描述（当“核心律动=自定义”才用）": ("STRING", {"forceInput": True, "default": ""}),
                "自定义人声描述（当“人声配置=自定义”才用）": ("STRING", {"forceInput": True, "default": ""}),
                "自定义情绪弧描述（当“情绪弧=自定义”才用）": ("STRING", {"forceInput": True, "default": ""}),
                "自定义结构描述（当“歌曲结构=自定义”才用）": ("STRING", {"forceInput": True, "default": ""}),
                "额外约束（可选）": ("STRING", {"forceInput": True, "multiline": True, "default": ""}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING", "STRING")
    RETURN_NAMES = ("系统提示词", "用户消息", "歌词")
    FUNCTION = "build"
    CATEGORY = "CZ/Music3"

    def build(self, **kwargs):
        request = _strip_control_text(kwargs.get("原始音乐需求", ""))
        lyric_parts = [
            _strip_control_text(kwargs.get("歌词", "")),
            _strip_control_text(kwargs.get("外部歌词", "")),
        ]
        lyrics = "\n".join(part for part in lyric_parts if part)

        if not request:
            raise ValueError("原始音乐需求不能为空。")

        style_sel = kwargs.get("风格大类", "自动识别")
        vocal_sel = kwargs.get("人声配置", "自动识别")
        tempo_sel = kwargs.get("速度", "自动识别")
        meter_sel = kwargs.get("拍号/律动", "自动识别")
        groove_sel = kwargs.get("核心律动（Groove）", "自动识别")
        mood_sel = kwargs.get("情绪弧", "自动识别")
        structure_sel = kwargs.get("歌曲结构", "自动识别")
        output_language_sel = kwargs.get("输出语言", "英文（Music 3推荐）")
        custom_target_len = _strip_control_text(kwargs.get("目标曲长（影响资源/文本密度）", "自动识别"))

        # 自定义字段
        custom_tempo = _strip_control_text(kwargs.get("自定义节奏描述（当“速度=自定义”才用）", ""))
        custom_meter = _strip_control_text(kwargs.get("自定义拍号描述（当“拍号/律动=自定义”才用）", ""))
        custom_groove = _strip_control_text(kwargs.get("自定义律动描述（当“核心律动=自定义”才用）", ""))
        custom_vocal = _strip_control_text(kwargs.get("自定义人声描述（当“人声配置=自定义”才用）", ""))
        custom_mood = _strip_control_text(kwargs.get("自定义情绪弧描述（当“情绪弧=自定义”才用）", ""))
        custom_structure = _strip_control_text(kwargs.get("自定义结构描述（当“歌曲结构=自定义”才用）", ""))
        extra_system = _strip_control_text(kwargs.get("额外约束（可选）", ""))

        tempo_instruction = TEMPO_MAP.get(tempo_sel, "") or (custom_tempo if tempo_sel == "自定义" else "")
        meter_instruction = METER_MAP.get(meter_sel, "") or (custom_meter if meter_sel == "自定义" else "")
        groove_instruction = GROOVE_MAP.get(groove_sel, "") or (custom_groove if groove_sel == "自定义" else "")
        vocal_instruction = Vocal_MAP.get(vocal_sel, "") or (custom_vocal if vocal_sel == "自定义" else "")
        mood_instruction = MOODARC_MAP.get(mood_sel, "") or (custom_mood if mood_sel == "自定义" else "")
        structure_instruction = STRUCTURE_MAP.get(structure_sel, "") or (custom_structure if structure_sel == "自定义" else "")
        style_instruction = STYLE_MAP.get(style_sel, "")

        controls = {
            "style": style_instruction,
            "vocal_details_request": vocal_instruction,
            "tempo": tempo_instruction,
            "meter": meter_instruction,
            "groove": groove_instruction,
            "mood_arc": mood_instruction,
            "song_structure": structure_instruction,
            "target_duration_hint": custom_target_len,
        }
        # 去掉空值，避免 LLM 误解为“显式要求为空”
        controls = {k: v for k, v in controls.items() if _strip_control_text(v)}

        if extra_system:
            controls["extra_constraints"] = extra_system

        lyric_tags = _extract_lyric_tags(lyrics)

        lyrics_mode = "SOURCE LYRICS PROVIDED" if lyrics else "NO SOURCE LYRICS"
        if "纯器乐" in vocal_sel or "禁止人声与歌词" in vocal_sel:
            lyrics_mode += " (instrumental request)"

        output_language = output_language_sel
        language_instruction = OUTPUT_LANGUAGE_MAP.get(output_language, "English")

        system_content = MUSIC3_SYSTEM_PROMPT
        user_content = (
            "USER MUSIC REQUEST:\n"
            f"{request}\n\n"
            "EXPLICIT CONTROL PANEL (interpretable constraints only):\n"
            f"{json.dumps(controls, ensure_ascii=False, indent=2)}\n\n"
            f"LYRIC SECTION TAGS ONLY (must be honored as local arrangement directives): {', '.join(lyric_tags) if lyric_tags else 'none'}\n"
            f"LYRICS MODE: {lyrics_mode}\n\n"
            "SOURCE LYRICS FOR PRIVATE HIGH-LEVEL MOOD ANALYSIS ONLY.\n"
            "Never quote, paraphrase, summarize, translate, or repeat them in the caption:\n"
            f"{lyrics if lyrics else '[no lyrics supplied]'}\n\n"
            f"OUTPUT LANGUAGE: {language_instruction}\n\n"
            "Always return the required JSON object. The caller assembles the caption headings and chooses source vs generated lyrics."
        )

        return (system_content, user_content, lyrics)

