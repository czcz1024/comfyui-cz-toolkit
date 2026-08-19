"""通用 LLM 生成节点：接收系统提示词 + 用户消息，调用本地 GGUF 模型推理。

不包含任何 H3 / 视频专用逻辑，纯文本对话。
"""

import re
import random

from . import models_util as mu


def _strip_thinking(text):
    """剥离思考块：<think>…</think> 完整块、游离的 </think>、未闭合的 <think>。"""
    text = re.sub(r"<think>.*?</think>\s*", "", text, flags=re.DOTALL)
    if "</think>" in text:
        text = text.rsplit("</think>", 1)[1].strip()
    text = re.sub(r"<think>.*$", "", text, flags=re.DOTALL)
    return text.strip()


class LLMGenerator:
    """通用本地 LLM 文本生成。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "模型句柄": ("H3_MODEL_HANDLE",),
                "系统提示词": ("STRING", {"multiline": True, "default": "", "forceInput": True}),
                "用户消息": ("STRING", {"multiline": True, "default": ""}),
                "温度": ("FLOAT", {"default": 0.7, "min": 0.0, "max": 2.0, "step": 0.05}),
                "top_p": ("FLOAT", {"default": 0.9, "min": 0.0, "max": 1.0, "step": 0.01}),
                "top_k": ("INT", {"default": 40, "min": 0, "max": 100, "step": 1}),
                "重复惩罚": ("FLOAT", {"default": 1.1, "min": 0.0, "max": 2.0, "step": 0.05}),
                "最大输出token": ("INT", {"default": 2048, "min": 64, "max": 8192, "step": 64}),
                "🎲随机种子": ("INT", {"default": 0, "min": 0, "max": 2147483647, "step": 1}),
                "🔀随机化": ("BOOLEAN", {"default": False}),
                "⚡推理后卸载模型": ("BOOLEAN", {"default": False}),
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
        seed_input = kwargs["🎲随机种子"]
        randomize = kwargs["🔀随机化"]
        auto_unload = kwargs["⚡推理后卸载模型"]

        llm = mu.load_model(模型句柄)

        if randomize:
            seed = random.randint(0, 2_147_483_647)
        else:
            seed = int(seed_input)
        seed = mu.set_seed(llm, seed)

        system_content = 系统提示词.strip() if 系统提示词 else ""
        user_content = [{"type": "text", "text": 用户消息.strip()}]

        n_ctx = int(模型句柄.get("n_ctx", 8192))
        est_total = len(system_content) // 3 + len(用户消息) // 3 + int(最大输出token)
        if est_total > n_ctx:
            raise ValueError(
                f"上下文预算不足：估算约 {est_total} token > 上下文长度 {n_ctx}。"
                f"请减少输入文本长度，或在加载器把「上下文长度」调到 ≥ {est_total}。"
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
                    f"推理时上下文溢出（{e}）。请在加载器增大「上下文长度」，或减少输入文本。"
                ) from e
            raise RuntimeError(f"本地模型推理失败：{e}") from e

        raw = (resp["choices"][0]["message"]["content"] or "").strip()
        text = _strip_thinking(raw)

        if auto_unload:
            mu.unload()
        else:
            mu.clear_kv_cache(llm, 模型句柄.get("handler_name", "None"))

        return (text, raw)
