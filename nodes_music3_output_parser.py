"""Music3 输出解析节点：把 LLM 返回的 JSON 拆成 Caption + Lyrics 两路。"""

from __future__ import annotations

import json
import re


_CODE_FENCE_RE = re.compile(r"```(?:json)?\s*([\s\S]*?)\s*```", re.IGNORECASE)
_HEADING_RE = re.compile(r"(?im)^\s*###\s*([A-Za-z ]+)\s*$")
_LYRIC_TAG_RE = re.compile(r"\[([^\]\r\n]{1,120})\]")


def _strip_code_fence(text: str) -> str:
    if not isinstance(text, str):
        return ""
    m = _CODE_FENCE_RE.search(text)
    if m:
        return m.group(1).strip()
    return text.strip()


def _parse_json_object(text: str) -> dict | None:
    cleaned = _strip_code_fence(text or "")
    try:
        parsed = json.loads(cleaned)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        # 尝试找到第一个 { 开始到最后一个 } 结束
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start == -1 or end == -1 or end <= start:
            return None
        try:
            parsed = json.loads(cleaned[start : end + 1])
            return parsed if isinstance(parsed, dict) else None
        except json.JSONDecodeError:
            return None


def _heading_section(text: str, heading: str, following: str | None = None) -> str:
    if not text:
        return ""
    # 兼容两种：### Heading 或 Heading 本身
    if following:
        pattern = (
            rf"(?is)(?:^|\n)\s*(?:###\s*)?{re.escape(heading)}\s*(?:###\s*)?.*?\n"
            rf"(.*?)(?=(?:^|\n)\s*(?:###\s*)?{re.escape(following)}\s*(?:###\s*)?|\Z)"
        )
    else:
        pattern = rf"(?is)(?:^|\n)\s*(?:###\s*)?{re.escape(heading)}\s*(?:###\s*)?(.*?)(?=\Z)"
    m = re.search(pattern, text)
    return m.group(1).strip() if m else ""


def _make_caption(global_metadata: str, vocal_details: str, arrangement: str) -> str:
    return (
        "### Global Metadata\n\n"
        f"{str(global_metadata or '').strip()}\n\n"
        "### Vocal Details\n\n"
        f"{str(vocal_details or '').strip()}\n\n"
        "### Arrangement\n\n"
        f"{str(arrangement or '').strip()}"
    ).strip()


def _extract_lyric_tags(lyrics: str) -> list[str]:
    tags: list[str] = []
    for raw in _LYRIC_TAG_RE.findall(str(lyrics or "")):
        tag = "[" + re.sub(r"\s+", " ", raw).strip() + "]"
        if tag not in tags:
            tags.append(tag)
    return tags


def _lyric_leakage(lyrics: str, caption: str) -> list[str]:
    """如果 Caption 里意外包含较长歌词行，返回命中片段；否则空列表。"""
    if not lyrics:
        return []
    normalized_caption = re.sub(r"\s+", " ", str(caption or "")).lower()
    leaks: list[str] = []
    for line in str(lyrics or "").splitlines():
        line = re.sub(r"\[[^\]]+\]", "", line).strip()
        normalized = re.sub(r"\s+", " ", line).lower()
        if len(normalized) >= 20 and normalized in normalized_caption:
            leaks.append(line[:80])
    return leaks[:3]


def _validate_generated_lyrics(lyrics: str) -> str:
    text = str(lyrics or "").strip()
    if not text:
        raise RuntimeError("LLM 没有生成歌词（generated_lyrics 为空）。")
    if not _extract_lyric_tags(text):
        raise RuntimeError("LLM 生成的歌词缺少 [Verse]/[Chorus] 等 Music3 段落标签。")
    lyric_body = re.sub(r"\[[^\]]+\]", "", text).strip()
    if len(lyric_body) < 12:
        raise RuntimeError("LLM 生成的歌词正文过短。")
    return text


def _parse_compiler_output(text: str) -> dict:
    parsed = _parse_json_object(text or "")
    if isinstance(parsed, dict):
        global_metadata = str(parsed.get("global_metadata") or parsed.get("Global Metadata") or "").strip()
        vocal_details = str(parsed.get("vocal_details") or parsed.get("Vocal Details") or "").strip()
        arrangement = str(parsed.get("arrangement") or parsed.get("Arrangement") or "").strip()
        generated_lyrics = str(parsed.get("generated_lyrics") or "").strip()
        if global_metadata and vocal_details and arrangement:
            return {
                "caption": _make_caption(global_metadata, vocal_details, arrangement),
                "global_metadata": global_metadata,
                "vocal_details": vocal_details,
                "arrangement": arrangement,
                "generated_lyrics": generated_lyrics,
            }

    # 兜底：尝试从 heading 文本里抽
    cleaned = _strip_code_fence(text or "")
    global_metadata = _heading_section(cleaned, "Global Metadata", "Vocal Details")
    vocal_details = _heading_section(cleaned, "Vocal Details", "Arrangement")
    arrangement = _heading_section(cleaned, "Arrangement", None)
    caption = _make_caption(global_metadata, vocal_details, arrangement) if all((global_metadata, vocal_details, arrangement)) else ""
    return {"caption": caption, "generated_lyrics": ""}


class Music3OutputParser:
    """把 LLM 的 Music3 JSON 输出拆为 Caption + Lyrics。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "LLM生成文本": ("STRING", {"forceInput": True, "default": ""}),
            },
            "optional": {
                "用户歌词": (
                    "STRING",
                    {
                        "forceInput": True,
                        "default": "",
                        "tooltip": "接「Music3 提示词包装」的「歌词」输出口。非空则以用户歌词为准；留空则使用 LLM 的 generated_lyrics。",
                    },
                ),
                "校验/严格模式（出错直接报错）": ("BOOLEAN", {"default": True}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("音乐描述（Caption）", "歌词（Lyrics）")
    FUNCTION = "parse"
    CATEGORY = "CZ/Music3"

    def parse(self, **kwargs):
        llm_text = kwargs.get("LLM生成文本", "")
        user_lyrics = str(kwargs.get("用户歌词", "") or "")
        strict = bool(kwargs.get("校验/严格模式（出错直接报错）", True))

        result = _parse_compiler_output(llm_text)
        caption = str(result.get("caption") or "").strip()
        generated_lyrics = str(result.get("generated_lyrics") or "").strip()

        if not caption:
            raise RuntimeError("无法从 LLM 输出中解析到有效的 Music3 Caption（Global Metadata / Vocal Details / Arrangement 缺失）。")

        has_user_lyrics = bool(user_lyrics.strip())
        if has_user_lyrics:
            lyrics_out = user_lyrics.strip()
            if strict and not _extract_lyric_tags(lyrics_out):
                raise RuntimeError("用户歌词缺少 [Verse]/[Chorus] 等 Music3 段落标签。")
            # 即使用户提供歌词，也检测 Caption 是否泄露歌词正文（防模型乱写）
            leaks = _lyric_leakage(lyrics_out, caption)
            if strict and leaks:
                raise RuntimeError(f"Caption 中疑似泄露了用户歌词正文（命中：{leaks}）。请重跑或检查系统提示词。")
            return (caption, lyrics_out)

        # 无用户歌词：使用 LLM 生成歌词
        if strict:
            lyrics_out = _validate_generated_lyrics(generated_lyrics)
        else:
            lyrics_out = generated_lyrics.strip()
        leaks = _lyric_leakage(lyrics_out, caption)
        if strict and leaks:
            raise RuntimeError(f"Caption 中疑似泄露了生成歌词正文（命中：{leaks}）。")
        return (caption, lyrics_out)

