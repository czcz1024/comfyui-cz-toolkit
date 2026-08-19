"""LLM LoRA 选择器：从 models/LLM 下拉选 GGUF LoRA（按元信息/命名自动区分），输出可连线的 LoRA 配置。"""

import os
from . import models_util as mu


class LLMLoraSelector:
    """选一个 GGUF LoRA 适配器（含权重），输出给模型加载器。"""

    @classmethod
    def INPUT_TYPES(cls):
        models = mu.list_lora_gguf()
        return {
            "required": {
                "LoRA模型": (["None"] + models, {"default": "None"}),
                "权重scale": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 2.0, "step": 0.05}),
            }
        }

    RETURN_TYPES = ("H3_LORA_CONFIG",)
    RETURN_NAMES = ("LoRA配置",)
    FUNCTION = "select"
    CATEGORY = "CZ/LLM"

    def select(self, LoRA模型, 权重scale):
        if not LoRA模型 or LoRA模型 == "None":
            return (None,)
        return ({
            "file": LoRA模型,
            "scale": float(权重scale),
        },)
