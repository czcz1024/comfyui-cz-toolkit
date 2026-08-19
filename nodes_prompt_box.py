"""H3 提示词框：写想法时用 @ 插入 <Picture/Video/Audio N>。"""

import re

from . import media_util as mdu


_TOKEN_PATTERN = re.compile(r"<(Picture|Video|Audio)\s+(\d+)>")
_REFERENCE_LIKE_PATTERN = re.compile(r"<\s*(?:Picture|Video|Audio)[^>]*>", re.IGNORECASE)
_LIMITS = {"Picture": 9, "Video": 3, "Audio": 6}


class H3PromptBox:
    """接素材包后，在文本里 @ 引用已接入的图/视频/音频。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "H3提示词": (
                    "STRING",
                    {
                        "multiline": True,
                        "dynamicPrompts": True,
                        "default": "",
                        "placeholder": "写视频想法；键入 @ 选择已接入参考素材的图/视频/音频……",
                    },
                ),
                "素材清单": (
                    "STRING",
                    {
                        "multiline": True,
                        "default": "",
                        "tooltip": "由节点界面根据上游「H3 参考素材」自动维护，无需手改。",
                    },
                ),
            },
            "optional": {
                "素材包": ("H3_MEDIA_BUNDLE",),
            },
        }

    RETURN_TYPES = ("STRING", "H3_MEDIA_BUNDLE")
    RETURN_NAMES = ("H3提示词", "素材包")
    FUNCTION = "build_prompt"
    CATEGORY = "CZ/H3"
    DESCRIPTION = "为 MiniMax H3 编写带 <Picture/Video/Audio N> 标记的提示词；素材来自参考素材节点，不绑定官方生视频节点。"

    def build_prompt(self, **kwargs):
        text = str(kwargs.get("H3提示词") or "").strip()
        bundle = kwargs.get("素材包") or mdu.empty_bundle()
        if not isinstance(bundle, dict):
            bundle = mdu.empty_bundle()
        manifest = bundle.get("manifest") or {"version": 1, "mode": "T2VA", "items": []}
        items = manifest.get("items") if isinstance(manifest, dict) else []
        allowed = {str(item.get("token")) for item in items if isinstance(item, dict)}
        used = {match.group(0) for match in _TOKEN_PATTERN.finditer(text)}
        malformed = sorted(set(_REFERENCE_LIKE_PATTERN.findall(text)) - used)
        if malformed:
            raise ValueError(
                "H3素材标记格式不正确，请使用 <Picture 1>、<Video 1>、<Audio 1>："
                + "、".join(malformed)
            )
        unknown = sorted(used - allowed)
        if unknown:
            raise ValueError("提示词引用了当前素材包没有的素材：" + "、".join(unknown))
        for token in used:
            kind, number = _TOKEN_PATTERN.fullmatch(token).groups()
            if int(number) > _LIMITS[kind]:
                raise ValueError(f"{token} 超出官方上限。")
        return (text, bundle)
