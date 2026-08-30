"""通用 LLM 生成节点：系统提示词 + 用户消息，可选多模态素材包（图/音）。

接 H3 参考素材时，将 image_parts / audio_parts 送入带 mmproj 的本地模型。
"""

import re

from . import media_util as mdu
from . import models_util as mu

_THINK_OPEN = "<" + "think" + ">"
_THINK_CLOSE = "</" + "think" + ">"
_THINK_BLOCK_RE = re.compile(
    rf"{re.escape(_THINK_OPEN)}.*?{re.escape(_THINK_CLOSE)}\s*",
    re.DOTALL,
)
_THINK_OPEN_TAIL_RE = re.compile(rf"{re.escape(_THINK_OPEN)}.*$", re.DOTALL)
_REASONING_BUDGET_MESSAGE = "\n[思考预算已满，开始输出最终答案]\n"
# 强制闭合思考块时额外占用的 token 余量（budget_message + 闭合标签）
_REASONING_BUDGET_OVERHEAD = 128


def _strip_thinking(text, *, require_complete=False):
    """剥离思考块；require_complete 时若未见闭合标签则报错。"""
    original = (text or "").strip()
    if not original:
        return ""

    if require_complete and _THINK_CLOSE not in original:
        raise RuntimeError(
            "模型思考未正常结束（未见闭合思考标签），最终提示词未生成。"
            "请增大「思考预算token」或「最终答案token」，或暂时关闭思考模式。"
        )

    text = _THINK_BLOCK_RE.sub("", original)
    if _THINK_CLOSE in text:
        text = text.rsplit(_THINK_CLOSE, 1)[1].strip()
    elif _THINK_OPEN in text:
        text = _THINK_OPEN_TAIL_RE.sub("", text).strip()
    return text.strip()


def _is_h3_lora_user_message(text):
    """H3PromptBuilder 官方 LoRA 模板格式的用户消息（仅文本，不吃图）。"""
    t = (text or "").strip()
    return t.startswith("resolution:") and "original_prompt:" in t


def _message_content(message):
    if not isinstance(message, dict):
        return ""
    content = message.get("content")
    if isinstance(content, str):
        return content.strip()
    return ""


def _resolve_answer_tokens(kwargs):
    """兼容旧工作流里的「最大输出token」输入名。"""
    if "最终答案token" in kwargs:
        return int(kwargs["最终答案token"])
    if "最大输出token" in kwargs:
        return int(kwargs["最大输出token"])
    return 2048


def _estimate_output_tokens(handle, answer_tokens, thinking_budget_tokens):
    answer_tokens = int(answer_tokens)
    if not mu.qwen38_thinking_active(handle):
        return answer_tokens
    thinking_budget_tokens = int(thinking_budget_tokens)
    if thinking_budget_tokens < 0:
        return answer_tokens
    return thinking_budget_tokens + answer_tokens + _REASONING_BUDGET_OVERHEAD


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
                "最终答案token": (
                    "INT",
                    {
                        "default": 2048,
                        "min": 64,
                        "max": 8192,
                        "step": 64,
                        "tooltip": "最终生成文本的 token 上限（不含思考过程）。非思考模式时即 API 总输出上限。",
                    },
                ),
                "思考预算token": (
                    "INT",
                    {
                        "default": 2048,
                        "min": -1,
                        "max": 8192,
                        "step": 64,
                        "tooltip": "仅 Qwen3.8 且加载器开启思考模式时生效。-1=思考与答案共用「最终答案token」；≥0 为思考阶段单独预算。",
                    },
                ),
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
        最终答案token = _resolve_answer_tokens(kwargs)
        思考预算token = kwargs["思考预算token"]
        seed = int(kwargs["seed"])
        auto_unload = kwargs["⚡推理后卸载模型"]
        多模态素材 = kwargs.get("多模态素材")

        llm = mu.load_model(模型句柄)
        seed = mu.set_seed(llm, seed)

        system_content = 系统提示词.strip() if 系统提示词 else ""
        bundle = 多模态素材 if isinstance(多模态素材, dict) else None
        thinking_active = mu.qwen38_thinking_active(模型句柄)
        separate_thinking_budget = thinking_active and int(思考预算token) >= 0

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
        output_budget = _estimate_output_tokens(模型句柄, 最终答案token, 思考预算token)
        est_total = (
            len(system_content) // 3
            + len(用户消息) // 3
            + n_images * img_max
            + n_audio * 256
            + output_budget
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
            temperature=float(温度),
            top_p=float(top_p),
            top_k=int(top_k),
            repeat_penalty=float(重复惩罚),
            seed=seed,
        )
        if separate_thinking_budget:
            thinking_budget = int(思考预算token)
            answer_budget = int(最终答案token)
            gen_kwargs["max_tokens"] = (
                thinking_budget + answer_budget + _REASONING_BUDGET_OVERHEAD
            )
            gen_kwargs["reasoning_budget"] = thinking_budget
            gen_kwargs["reasoning_start_in_prompt"] = True
            gen_kwargs["reasoning_budget_message"] = _REASONING_BUDGET_MESSAGE
            print(
                f"[CZ-Toolkit] LLMGenerator：Qwen3.8 思考预算={thinking_budget}，"
                f"最终答案上限={answer_budget}，API max_tokens={gen_kwargs['max_tokens']}"
            )
        else:
            gen_kwargs["max_tokens"] = int(最终答案token)

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

        message = resp["choices"][0]["message"]
        raw = _message_content(message)
        if not raw and isinstance(message.get("reasoning_content"), str):
            raw = message["reasoning_content"].strip()
        text = _strip_thinking(raw, require_complete=thinking_active and not separate_thinking_budget)

        if thinking_active and separate_thinking_budget and not text:
            raise RuntimeError(
                "思考已结束，但未解析到最终提示词文本。"
                "请增大「最终答案token」，或检查系统提示词是否要求只输出最终内容。"
            )

        if auto_unload:
            mu.unload()
        else:
            mu.clear_kv_cache(llm, 模型句柄.get("handler_name", "None"))

        return (text, raw)
