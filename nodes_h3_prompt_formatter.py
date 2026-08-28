"""H3 提示词排版台 —— Lab UI 嵌入 Comfy 节点。

拼装在前端（web/h3-formatter + h3_prompt_formatter.js）完成；
本节点 Python 端直通 prompt / prompt_pack，duration 从 form_state 读取；
可选 media_bundle 仅供前端「从素材包识别引用」读连接（execute 不消费）。
"""

from __future__ import annotations

import json
from typing import Any


def _parse_pack(raw: str) -> dict[str, Any]:
    try:
        data = json.loads(raw or "{}")
    except Exception:
        return {
            "packVersion": 1,
            "mode": "T2VA",
            "structured": {},
            "error": "invalid prompt_pack_json",
        }
    if not isinstance(data, dict):
        return {"packVersion": 1, "mode": "T2VA", "structured": {}}
    data.setdefault("packVersion", 1)
    data.setdefault("mode", "T2VA")
    data.setdefault("structured", {})
    return data


def _duration_from_form(form_state: str, pack: dict[str, Any]) -> float:
    try:
        raw = json.loads(form_state or "{}")
        if isinstance(raw, dict):
            # 兼容 { state: {...} } 导出包
            st = raw.get("state") if isinstance(raw.get("state"), dict) else raw
            if isinstance(st, dict) and st.get("duration") is not None:
                return round(float(st["duration"]), 2)
    except Exception:
        pass
    # 兜底：部分旧同步可能把时长写进 pack（一般没有）；默认 6
    _ = pack
    return 6.0


class H3PromptFormatter:
    """五模式 H3 提示词排版：输出 duration + prompt + H3_PROMPT_PACK。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "form_state": (
                    "STRING",
                    {
                        "multiline": True,
                        "default": "{}",
                        "tooltip": "由节点界面自动维护的表单状态 JSON，请勿手改。",
                    },
                ),
                "prompt": (
                    "STRING",
                    {
                        "multiline": True,
                        "default": "",
                        "tooltip": "由界面拼装的完整 H3 提示词。",
                    },
                ),
                "prompt_pack_json": (
                    "STRING",
                    {
                        "multiline": True,
                        "default": "{}",
                        "tooltip": "H3_PROMPT_PACK 的 JSON 序列化，由界面维护。",
                    },
                ),
            },
            "optional": {
                "media_bundle": (
                    "H3_MEDIA_BUNDLE",
                    {
                        "tooltip": "可选。接 H3 参考素材 / 提示词框透传；界面点「从素材包识别引用」。",
                    },
                ),
            },
        }

    RETURN_TYPES = ("FLOAT", "STRING", "H3_PROMPT_PACK")
    RETURN_NAMES = ("duration", "prompt", "prompt_pack")
    FUNCTION = "emit"
    CATEGORY = "CZ/H3"
    DESCRIPTION = (
        "H3 提示词排版台（T2VA / I2VA / FL2VA / L2VA / Ref2VA）。"
        "输出 duration、完整 prompt，以及结构化 H3_PROMPT_PACK；"
        "可选接入 H3_MEDIA_BUNDLE 识别引用卡。"
    )

    def emit(
        self,
        form_state: str,
        prompt: str,
        prompt_pack_json: str,
        media_bundle=None,
    ):
        _ = media_bundle
        pack = _parse_pack(prompt_pack_json)
        dur = _duration_from_form(form_state, pack)
        return (dur, str(prompt or ""), pack)
