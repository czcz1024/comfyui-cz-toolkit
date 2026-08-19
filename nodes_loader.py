"""H3 模型加载器：进程内 llama_cpp 加载 GGUF + mmproj，接 LoRA，缓存复用。"""

from . import models_util as mu


class H3ModelLoader:
    """加载本地 GGUF（可带 mmproj 多模态、LoRA 适配器），输出模型句柄供生成节点复用。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "基座GGUF": (mu.list_gguf_models(),),
                "mmproj文件": (mu.list_mmproj(), {"default": "None"}),
                "对话处理器": (mu.CHAT_HANDLERS, {"default": "None"}),
                "GPU层数": ("INT", {"default": -1, "min": -1, "max": 200, "step": 1,
                                    "tooltip": "-1=全部层进 GPU（最快）；0=纯 CPU；显存不够时往下调。"}),
                "上下文长度": ("INT", {"default": 8192, "min": 512, "max": 131072, "step": 512}),
                "显存限制GB": ("FLOAT", {"default": -1.0, "min": -1.0, "max": 999.0, "step": 0.5,
                                         "tooltip": mu.VRAM_TOOLTIP}),
                "思考模式": ("BOOLEAN", {"default": False, "tooltip": mu.THINK_MODE_TOOLTIP}),
                "图像最小token": ("INT", {"default": 256, "min": 64, "max": 4096, "step": 64}),
                "图像最大token": ("INT", {"default": 1024, "min": 64, "max": 4096, "step": 64}),
                "Qwen3.8推理强度": (mu.QWEN38_REASONING_OPTIONS, {
                    "default": "关闭",
                    "tooltip": mu.QWEN38_REASONING_TOOLTIP,
                }),
            },
            "optional": {
                "LoRA配置": ("H3_LORA_CONFIG",),
            },
        }

    RETURN_TYPES = ("H3_MODEL_HANDLE",)
    RETURN_NAMES = ("模型句柄",)
    FUNCTION = "load"
    CATEGORY = "CZ/LLM"

    def load(self, 基座GGUF, mmproj文件, 对话处理器, GPU层数, 上下文长度, 显存限制GB,
             思考模式, 图像最小token, 图像最大token, LoRA配置=None, **kwargs):
        lora = None
        if LoRA配置:
            cfg = LoRA配置[0] if isinstance(LoRA配置, (tuple, list)) else LoRA配置
            if cfg:
                lora = {"file": cfg["file"], "scale": cfg.get("scale", 1.0)}
        handle = {
            "model_file": 基座GGUF,
            "mmproj_file": mmproj文件 if mmproj文件 != "None" else "None",
            "handler_name": mu._normalize_handler_name(对话处理器),
            "n_gpu_layers": int(GPU层数),
            "n_ctx": int(上下文长度),
            "vram_limit_gb": float(显存限制GB),
            "think_mode": bool(思考模式),
            "reasoning_effort": mu.normalize_qwen38_reasoning_effort(
                kwargs.get("Qwen3.8推理强度", "关闭")
            ),
            "image_min_tokens": int(图像最小token),
            "image_max_tokens": int(图像最大token),
            "lora": lora,
        }
        # 立即加载并缓存，供后续生成节点复用
        mu.load_model(handle)
        return (handle,)
