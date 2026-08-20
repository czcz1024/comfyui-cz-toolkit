"""通用 LLM 生成节点：系统提示词 + 用户消息，可选多模态素材包（图/音）。

接 H3 参考素材时，将 image_parts / audio_parts 送入带 mmproj 的本地模型。
"""

import re

from . import media_util as mdu
from . import models_util as mu


def _strip_thinking(text):
    """剥离思考块：<think>…</think> 完整块、游离的 </think>、未闭合的 <think>。"""
    text = re.sub(r"<think>.*?</think>\s*", "", text, flags=re.DOTALL)
    if "</think>" in text:
        text = text.rsplit("</think>", 1)[1].strip()
    text = re.sub(r"<think>.*$", "", text, flags=re.DOTALL)
    return text.strip()


def _is_h3_lora_user_message(text):
    """H3PromptBuilder 官方 LoRA 模板格式的用户消息（仅文本，不吃图）。"""
    t = (text or "").strip()
    return t.startswith("resolution:") and "original_prompt:" in t


class LLMGenerator:
    """通用本地 LLM 生成；可选接入 H3 素材包让 Qwen+mmproj 看见参考图/视频抽帧。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "模型句柄": ("H3_MODEL_HANDLE",),
                "系统提示词": ("STRING", {"multiline": True, "default": ""}),
                "用户消息": ("STRING", {"multiline": True, "default": ""}),
                "温度": ("FLOAT", {"default": 0.7, "min": 0.0, "max": 2.0, "step": 0.05}),
                "top_p": ("FLOAT", {"default": 0.9, "min": 0.0, "max": 1.0, "step": 0.01}),
                "top_k": ("INT", {"default": 40, "min": 0, "max": 100, "step": 1}),
                "重复惩罚": ("FLOAT", {"default": 1.1, "min": 0.0, "max": 2.0, "step": 0.05}),
                "最大输出token": ("INT", {"default": 2048, "min": 64, "max": 8192, "step": 64}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 2147483647, "tooltip": "随机种子，配合右键菜单控制每次是否随机"}),
                "⚡推理后卸载模型": ("BOOLEAN", {"default": False}),
            },
            "optional": {
                "多模态素材": (
                    "H3_MEDIA_BUNDLE",
                    {
                        "tooltip": "来自 H3 参考素材；与 H3PromptBuilder 的用户消息一起使用时，模型可看见参考图/视频抽帧。",
                    },
                ),
            },
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("生成文本", "原始响应")
    FUNCTION = "generate"
    CATEGORY = "CZ/LLM"

    def generate(self, **kwargs):
        模型句柄 = kwargs["模型句柄"]
        系统提示词 = kwargs["系统提示词"]
        用户消息 = kwargs["用户消息"]
        温度 = kwargs["温度"]
        top_p = kwargs["top_p"]
        top_k = kwargs["top_k"]
        重复惩罚 = kwargs["重复惩罚"]
        最大输出token = kwargs["最大输出token"]
        seed = int(kwargs["seed"])
        auto_unload = kwargs["⚡推理后卸载模型"]
        多模态素材 = kwargs.get("多模态素材")

        llm = mu.load_model(模型句柄)
        seed = mu.set_seed(llm, seed)

        system_content = 系统提示词.strip() if 系统提示词 else ""
        bundle = 多模态素材 if isinstance(多模态素材, dict) else None

        if bundle and _is_h3_lora_user_message(用户消息):
            print(
                "[CZ-Toolkit] LLMGenerator：检测到官方 LoRA 模板用户消息，已忽略多模态素材（该 LoRA 仅吃文本）。"
            )
            bundle = None

        n_images, n_audio = mdu.bundle_media_counts(bundle)
        has_media = n_images > 0 or n_audio > 0
        mmproj_file = 模型句柄.get("mmproj_file", "None")
        if has_media and (not mmproj_file or mmproj_file == "None"):
            raise RuntimeError(
                "已接入多模态素材，但模型加载器未选择 mmproj。"
                "请在 LLM 模型加载器中选择与基座配套的 mmproj，并将对话处理器设为 Qwen3.8 / Qwen3-VL 等视觉处理器。"
            )

        user_content = mdu.build_llm_user_content(bundle, 用户消息)
        if has_media:
            print(
                f"[CZ-Toolkit] LLMGenerator：送入 {n_images} 张图像"
                + (f"、{n_audio} 段音频" if n_audio else "")
            )

        n_ctx = int(模型句柄.get("n_ctx", 8192))
        img_max = int(模型句柄.get("image_max_tokens", 1024))
        est_total = (
            len(system_content) // 3
            + len(用户消息) // 3
            + n_images * img_max
            + n_audio * 256
            + int(最大输出token)
        )
        if est_total > n_ctx:
            raise ValueError(
                f"上下文预算不足：估算约 {est_total} token > 上下文长度 {n_ctx}。"
                f"请减少输入文本/参考图数量，或在加载器把「上下文长度」调到 ≥ {est_total}。"
            )

        messages = [
            {"role": "system", "content": system_content},
            {"role": "user", "content": user_content},
        ]

        gen_kwargs = dict(
            max_tokens=int(最大输出token),
            temperature=float(温度),
            top_p=float(top_p),
            top_k=int(top_k),
            repeat_penalty=float(重复惩罚),
            seed=seed,
        )
        lora_active = mu.get_lora_active()
        if lora_active:
            gen_kwargs["active_loras"] = [lora_active]

        try:
            resp = llm.create_chat_completion(messages=messages, **gen_kwargs)
        except Exception as e:
            msg = str(e).lower()
            if "context" in msg and ("exceed" in msg or "overflow" in msg or "too large" in msg):
                raise RuntimeError(
                    f"推理时上下文溢出（{e}）。请在加载器增大「上下文长度」，或减少输入文本/参考图。"
                ) from e
            raise RuntimeError(f"本地模型推理失败：{e}") from e

        raw = (resp["choices"][0]["message"]["content"] or "").strip()
        text = _strip_thinking(raw)

        if auto_unload:
            mu.unload()
        else:
            mu.clear_kv_cache(llm, 模型句柄.get("handler_name", "None"))

        return (text, raw)
