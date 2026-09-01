"""模型加载与缓存工具。

整合 Dapao 的进程内 llama_cpp 加载形式 + Rewriter 的 GGUF LoRA 双 API 加载，
提供模块级缓存（按配置命中则复用）、自动卸载，以及 seed 复位（修复随机种子不生效）。

复刻来源（仅复用算法结构，已在本地重写）：
- ComfyUI-llama_Dapao/nodes.py 的 _load_model / DapaoLlamaStorage / chat handler 映射
- MiniMax-H3-Prompt-Rewriter 的 gguf_engine.py 的 LoRA 双 API 探测
- ComfyUI-llama_Dapao/gguf_layers.py 的 GGUF 元信息读取
"""

import os
import gc
import inspect
import struct
import re
import sys
import datetime
import folder_paths
import comfy.model_management as mm

try:
    import llama_cpp
    from llama_cpp import Llama
except Exception:
    llama_cpp = None
    Llama = None

try:
    from llama_cpp.llama_chat_format import (
        Llava15ChatHandler, Llava16ChatHandler, MoondreamChatHandler,
        NanoLlavaChatHandler, Llama3VisionAlphaChatHandler, MiniCPMv26ChatHandler,
    )
except Exception:
    Llava15ChatHandler = Llava16ChatHandler = MoondreamChatHandler = None
    NanoLlavaChatHandler = Llama3VisionAlphaChatHandler = MiniCPMv26ChatHandler = None

try:
    from llama_cpp.llama_chat_format import MTMDChatHandler  # noqa: F401
    _MTMD = True
except Exception:
    _MTMD = False

try:
    from llama_cpp.llama_chat_format import Gemma3ChatHandler
except Exception:
    Gemma3ChatHandler = None

try:
    from llama_cpp.llama_chat_format import Gemma4ChatHandler
except Exception:
    if _MTMD:
        Gemma4ChatHandler = MTMDChatHandler
    else:
        Gemma4ChatHandler = None

try:
    from llama_cpp.llama_chat_format import Qwen25VLChatHandler
except Exception:
    Qwen25VLChatHandler = None

try:
    from llama_cpp.llama_chat_format import Qwen3VLChatHandler
except Exception:
    Qwen3VLChatHandler = None

try:
    from llama_cpp.llama_chat_format import Qwen36ChatHandler
except Exception:
    Qwen36ChatHandler = None

try:
    from llama_cpp.llama_chat_format import Qwen35ChatHandler
except Exception:
    Qwen35ChatHandler = None

try:
    from llama_cpp.llama_chat_format import GLM46VChatHandler, GLM41VChatHandler
except Exception:
    GLM46VChatHandler = None
    GLM41VChatHandler = None

try:
    from llama_cpp.llama_chat_format import LFM2VLChatHandler
except Exception:
    LFM2VLChatHandler = None

try:
    from llama_cpp.llama_chat_format import GraniteDoclingChatHandler
except Exception:
    GraniteDoclingChatHandler = None

try:
    from llama_cpp.llama_chat_format import (
        Jinja2ChatFormatter,
        chat_formatter_to_chat_completion_handler,
    )
except Exception:
    Jinja2ChatFormatter = None
    chat_formatter_to_chat_completion_handler = None


# 可用对话处理器列表（与 Dapao 保持一致顺序，并保留本节点已有的 Qwen3.6）
CHAT_HANDLERS = [
    "None",
    "LLaVA-1.5", "LLaVA-1.6", "Moondream2", "nanoLLaVA", "llama3-Vision-Alpha",
    "MiniCPM-v2.6", "MiniCPM-v4.5", "MiniCPM-v4.5-Thinking",
    "Gemma3", "Gemma4",
    "Qwen2.5-VL",
    "Qwen3.8",
    "Qwen3-VL", "Qwen3-VL-Thinking",
    "Qwen3.6", "Qwen3.6-Thinking",
    "Qwen3.5", "Qwen3.5-Thinking",
    "GLM-4.6V", "GLM-4.6V-Thinking", "GLM-4.1V-Thinking",
    "LFM2-VL",
    "Granite-Docling",
]

_QWEN_HANDLER_ARCH = {
    "Qwen2.5-VL": "qwen2vl",
    "Qwen3.8": "qwen35",
    "Qwen3-VL": "qwen3vl",
    "Qwen3-VL-Thinking": "qwen3vl",
    "Qwen3.6": "qwen35",
    "Qwen3.6-Thinking": "qwen35",
    "Qwen3.5": "qwen35",
    "Qwen3.5-Thinking": "qwen35",
}
_QWEN_ARCH_HANDLER = {
    "qwen2vl": "Qwen2.5-VL",
    "qwen3vl": "Qwen3-VL",
    # Qwen3.8/3.6/3.5 的 GGUF 架构标识均为 qwen35
    "qwen35": "Qwen3.8 / Qwen3.6 / Qwen3.5",
    "qwen36": "Qwen3.6",
}

_QWEN38_MIN_LLAMA_CPP_VERSION = (0, 3, 47)
QWEN38_REASONING_OPTIONS = ["关闭", "自动", "低", "中等", "高"]
_QWEN38_REASONING_VALUES = {
    "关闭": "off",
    "自动": "xhigh",
    "低": "low",
    "中等": "medium",
    "高": "xhigh",
    # 兼容旧工作流 / 参考节点的英文原值
    "off": "off",
    "xhigh": "xhigh",
    "medium": "medium",
    "low": "low",
}
VRAM_TOOLTIP = (
    "仅当「GPU层数」为 -1 时生效。-1=尝试全部放入 GPU，最快但可能因显存不足失败；"
    "填写数值=只将部分模型层放入 GPU，其余使用系统内存。"
    "参考起点：8GB 显卡填 6，12GB 填 10，16GB 填 13，24GB 填 20，32GB 填 24-28。"
    "请为 ComfyUI、mmproj 和上下文缓存预留约 2GB。"
)
THINK_MODE_TOOLTIP = (
    "开启后模型会先输出思考过程（仅 Thinking 系列 / Qwen3.8 有效）。"
    "Qwen3.8 还须把「Qwen3.8推理强度」设为低/中等/高/自动，两者同时开才会思考。"
    "官方 H3 LoRA 改写请关闭。"
)
QWEN38_REASONING_TOOLTIP = (
    "仅 Qwen3.8 生效。关闭=不思考；自动/高=模型最高档（xhigh）；低/中等=降低思考强度。"
    "要真正思考，还须打开「思考模式」。改此参数会重新加载模型。"
)
_QWEN_KV_CLEAR_HANDLERS = {
    "Qwen3.8", "Qwen3.5", "Qwen3.5-Thinking",
    "Qwen3.6", "Qwen3.6-Thinking",
    "Qwen3-VL", "Qwen3-VL-Thinking",
}


def _ensure_cz_llm_folder():
    """只注册 CZ 默认 LLM 目录，不覆盖或合并其它插件注册的 llm/LLM 路径。"""
    llm_dir = os.path.join(folder_paths.models_dir, "LLM")
    os.makedirs(llm_dir, exist_ok=True)
    folder_paths.add_model_folder_path("LLM", llm_dir, is_default=True)
    if "LLM" in folder_paths.folder_names_and_paths:
        paths, exts = folder_paths.folder_names_and_paths["LLM"]
        folder_paths.folder_names_and_paths["LLM"] = (paths, exts | {".gguf"})


_ensure_cz_llm_folder()


def _llm_full_path(filename):
    path = folder_paths.get_full_path("LLM", filename) or folder_paths.get_full_path("llm", filename)
    if not path:
        for key in folder_paths.folder_names_and_paths:
            if str(key).lower() != "llm":
                continue
            path = folder_paths.get_full_path(key, filename)
            if path:
                break
    if not path:
        raise FileNotFoundError(
            f"找不到 LLM 文件: {filename}。请检查 extra_model_paths.yaml 的 llm/LLM 路径。"
        )
    return path


def _llama_cpp_version():
    if llama_cpp is None:
        return "未知"
    return str(getattr(llama_cpp, "__version__", "未知"))


def _version_tuple(version):
    numbers = re.findall(r"\d+", str(version))
    if len(numbers) < 3:
        return None
    return tuple(int(number) for number in numbers[:3])


def normalize_qwen38_reasoning_effort(value):
    if value is None:
        return "off"
    try:
        return _QWEN38_REASONING_VALUES[str(value)]
    except KeyError as error:
        raise ValueError(f"未知 Qwen3.8 推理强度：{value}") from error


def _validate_qwen38_backend():
    version = _llama_cpp_version()
    parsed = _version_tuple(version)
    if parsed is not None and parsed < _QWEN38_MIN_LLAMA_CPP_VERSION:
        raise RuntimeError(
            "Qwen3.8 需要支持 MTP/NextN 张量的新版 llama-cpp-python。"
            f"当前版本为 {version}，最低需要 0.3.47；旧版会在加载时缺少 "
            "blk.64.ssm_conv1d.weight。请从 JamePeng/llama-cpp-python Releases "
            "安装与 Python、操作系统和 CUDA 匹配的 0.3.47+ wheel，然后重启 ComfyUI。"
            f"当前 Python：{sys.executable}"
        )


def _warn_qwen38_thinking_combo(think_mode, reasoning_effort):
    if think_mode and reasoning_effort == "off":
        print("[CZ-Toolkit] 提示：Qwen3.8「思考模式」已开，但「Qwen3.8推理强度」为关闭，"
              "实际不会思考。请改成低 / 中等 / 高 / 自动。")
    elif (not think_mode) and reasoning_effort != "off":
        print("[CZ-Toolkit] 提示：Qwen3.8推理强度已设，但「思考模式」关闭，"
              "实际不会思考。请同时打开思考模式。")


def _normalize_handler_name(handler_name):
    return "Qwen3.8" if handler_name == "Qwen3-8B" else handler_name


def qwen38_thinking_active(handle):
    """Qwen3.8 且思考模式与推理强度均已开启。"""
    if _normalize_handler_name(handle.get("handler_name", "None")) != "Qwen3.8":
        return False
    if not handle.get("think_mode", False):
        return False
    return normalize_qwen38_reasoning_effort(handle.get("reasoning_effort", "off")) != "off"


# ── 模块级缓存 ────────────────────────────────────────────────────────────────
class _ModelCache:
    def __init__(self):
        self.llm = None
        self.chat_handler = None
        self.config = None
        self.lora_active = None  # modern API: {"name", "scale"}

    def clean(self):
        if self.chat_handler is not None and hasattr(self.chat_handler, "close"):
            try:
                self.chat_handler.close()
            except Exception:
                pass
        if self.llm is not None and hasattr(self.llm, "close"):
            try:
                self.llm.close()
            except Exception:
                pass
        self.llm = None
        self.chat_handler = None
        self.config = None
        self.lora_active = None


CACHE = _ModelCache()


# ── GGUF 元信息读取（复刻 Dapao/gguf_layers.py）────────────────────────────────
def _read_u32(f):
    return struct.unpack("<I", f.read(4))[0]


def _read_u64(f):
    return struct.unpack("<Q", f.read(8))[0]


def _read_string(f):
    length = _read_u64(f)
    return f.read(length).decode("utf-8")


def _read_value(f):
    t = _read_u32(f)
    if t == 0:
        return struct.unpack("<B", f.read(1))[0]
    if t == 1:
        return struct.unpack("<b", f.read(1))[0]
    if t == 2:
        return struct.unpack("<H", f.read(2))[0]
    if t == 3:
        return struct.unpack("<h", f.read(2))[0]
    if t == 4:
        return struct.unpack("<I", f.read(4))[0]
    if t == 5:
        return struct.unpack("<i", f.read(4))[0]
    if t == 6:
        return struct.unpack("<f", f.read(4))[0]
    if t == 7:
        return struct.unpack("<?", f.read(1))[0]
    if t == 8:
        return _read_string(f)
    if t == 9:
        at = _read_u32(f)
        count = _read_u64(f)
        return [_read_value_of_type(f, at) for _ in range(count)]
    if t == 10:
        return struct.unpack("<Q", f.read(8))[0]
    if t == 11:
        return struct.unpack("<q", f.read(8))[0]
    if t == 12:
        return struct.unpack("<d", f.read(8))[0]
    raise ValueError(f"Unknown GGUF value type: {t}")


def _read_value_of_type(f, at):
    if at == 0:
        return struct.unpack("<B", f.read(1))[0]
    if at == 1:
        return struct.unpack("<b", f.read(1))[0]
    if at == 2:
        return struct.unpack("<H", f.read(2))[0]
    if at == 3:
        return struct.unpack("<h", f.read(2))[0]
    if at == 4:
        return struct.unpack("<I", f.read(4))[0]
    if at == 5:
        return struct.unpack("<i", f.read(4))[0]
    if at == 6:
        return struct.unpack("<f", f.read(4))[0]
    if at == 7:
        return struct.unpack("<?", f.read(1))[0]
    if at == 8:
        return _read_string(f)
    if at == 10:
        return struct.unpack("<Q", f.read(8))[0]
    if at == 11:
        return struct.unpack("<q", f.read(8))[0]
    if at == 12:
        return struct.unpack("<d", f.read(8))[0]
    raise ValueError(f"Unknown GGUF array item type: {at}")


def _get_gguf_metadata(file_path, keys):
    wanted = set(keys)
    if not wanted:
        return {}
    meta = {}
    try:
        with open(file_path, "rb") as f:
            if f.read(4) != b"GGUF":
                return {}
            _read_u32(f)
            _read_u64(f)
            kv = _read_u64(f)
            for _ in range(kv):
                key = _read_string(f)
                value = _read_value(f)
                if key in wanted:
                    meta[key] = value
                    if len(meta) == len(wanted):
                        break
    except Exception:
        return {}
    return meta


def get_gguf_model_info(file_path):
    arch = _get_gguf_metadata(file_path, {"general.architecture"}).get("general.architecture")
    if not arch:
        return {"architecture": None, "dimension": None}
    dim_key = "clip.vision.projection_dim" if arch == "clip" else f"{arch}.embedding_length"
    dim = _get_gguf_metadata(file_path, {dim_key}).get(dim_key)
    return {"architecture": arch, "dimension": dim}


def get_layer_count(file_path):
    info = get_gguf_model_info(file_path)
    arch = info["architecture"]
    if not arch:
        return None
    key = f"{arch}.block_count"
    val = _get_gguf_metadata(file_path, {key}).get(key)
    return int(val) if val is not None else None


def _validate_multimodal_pair(model_path, model_file, handler_name, mmproj_path, mmproj_file):
    if not mmproj_path or handler_name == "None":
        return
    model_info = get_gguf_model_info(model_path)
    mmproj_info = get_gguf_model_info(mmproj_path)
    model_arch = model_info["architecture"]
    expected = _QWEN_HANDLER_ARCH.get(handler_name)
    if expected and model_arch and model_arch != expected:
        recommended = _QWEN_ARCH_HANDLER.get(model_arch)
        rec = f"，该主模型应选择「{recommended}」" if recommended else ""
        raise ValueError(
            f"模型与对话处理器不匹配：「{model_file}」架构 {model_arch}，"
            f"处理器「{handler_name}」要求 {expected}{rec}。"
        )
    md = model_info["dimension"]
    pd = mmproj_info["dimension"]
    if md is not None and pd is not None and int(md) != int(pd):
        raise ValueError(
            f"主模型与 mmproj 不匹配：「{model_file}」维度 {md}，"
            f"「{mmproj_file}」维度 {pd}。请选择同系列同参数规模的 mmproj。"
        )


# ── Chat handler 构造 ─────────────────────────────────────────────────────────
def _jinja_raise_exception(message):
    raise ValueError(message)


def _jinja_strftime_now(format_string="%Y-%m-%d %H:%M:%S"):
    return datetime.datetime.now().strftime(format_string)


def _patch_chat_handler_template_globals(chat_handler):
    if chat_handler is None:
        return
    extra = getattr(chat_handler, "extra_template_arguments", None)
    if not isinstance(extra, dict):
        return
    extra.setdefault("raise_exception", _jinja_raise_exception)
    extra.setdefault("strftime_now", _jinja_strftime_now)


def _apply_chat_template_override(chat_handler, chat_template_override):
    if not chat_template_override or not hasattr(chat_handler, "chat_template"):
        return
    try:
        from jinja2.sandbox import ImmutableSandboxedEnvironment
    except ImportError:
        return
    chat_handler.chat_template = ImmutableSandboxedEnvironment(
        trim_blocks=True,
        lstrip_blocks=True,
    ).from_string(chat_template_override)


def _create_multimodal_handler(handler_class, mmproj_path, **kwargs):
    try:
        return handler_class(mmproj_path=mmproj_path, **kwargs)
    except TypeError as error:
        message = str(error)
        if "mmproj_path" not in message and "clip_model_path" not in message:
            raise
        return handler_class(clip_model_path=mmproj_path, **kwargs)


def _adapt_qwen38_chat_template(chat_template):
    if not chat_template or "<|image_pad|>" not in chat_template:
        return chat_template
    pattern = (
        r"\{\{-?\s*(['\"])<\|vision_start\|><\|image_pad\|><\|vision_end\|>\1\s*-?\}\}"
    )
    replacement = (
        "{{- '<|vision_start|>' }}"
        "{%- if item.image_url is string %}"
        "{{- item.image_url }}"
        "{%- else %}"
        "{{- item.image_url.url }}"
        "{%- endif %}"
        "{{- '<|vision_end|>' }}"
    )
    adapted, count = re.subn(pattern, replacement, chat_template)
    if count == 0:
        raise RuntimeError(
            "Qwen3.8 聊天模板包含 <|image_pad|>，但无法适配当前 llama.cpp 多模态处理器。"
        )
    return adapted


def _create_qwen38_mm_handler(
    mmproj_path, *, enable_thinking, preserve_thinking, reasoning_effort,
    chat_template_override, image_min_tokens, image_max_tokens,
):
    if Qwen35ChatHandler is None:
        raise RuntimeError("Qwen3.8 需要 Qwen35ChatHandler，请升级 llama-cpp-python。")
    mtmd_kwargs = {"verbose": False}
    if _MTMD:
        mtmd_kwargs["image_min_tokens"] = image_min_tokens
        mtmd_kwargs["image_max_tokens"] = image_max_tokens
    candidates = [
        {
            "enable_thinking": enable_thinking,
            "preserve_thinking": preserve_thinking,
            "add_vision_id": True,
            **mtmd_kwargs,
        },
        {
            "enable_thinking": enable_thinking,
            "preserve_thinking": preserve_thinking,
            **mtmd_kwargs,
        },
        {
            "enable_thinking": enable_thinking,
            "add_vision_id": True,
            **mtmd_kwargs,
        },
        {"enable_thinking": enable_thinking, **mtmd_kwargs},
    ]
    last_error = None
    for kwargs in candidates:
        try:
            handler = _create_multimodal_handler(Qwen35ChatHandler, mmproj_path, **kwargs)
            handler.extra_template_arguments["reasoning_effort"] = reasoning_effort
            _patch_chat_handler_template_globals(handler)
            _apply_chat_template_override(handler, chat_template_override)
            return handler
        except TypeError as error:
            last_error = error
    raise last_error or RuntimeError("创建 Qwen3.8 多模态处理器失败。")


def _create_qwen38_text_handler(llm, *, enable_thinking, preserve_thinking, reasoning_effort):
    if Jinja2ChatFormatter is None or chat_formatter_to_chat_completion_handler is None:
        raise RuntimeError("当前 llama-cpp-python 不支持 Qwen3.8 聊天模板，请升级 llama-cpp-python。")
    metadata = getattr(llm, "metadata", {}) or {}
    chat_template = metadata.get("tokenizer.chat_template")
    if not chat_template:
        raise RuntimeError("Qwen3.8 GGUF 缺少 tokenizer.chat_template。")
    model = getattr(llm, "_model", None)

    def token_text(token_id):
        if token_id == -1 or model is None or not hasattr(model, "token_get_text"):
            return ""
        return model.token_get_text(token_id)

    stop_token_ids = [
        token_id
        for token_id in (llm.token_eos(), llm.token_eot())
        if token_id != -1
    ] or None
    formatter = Jinja2ChatFormatter(
        template=chat_template,
        eos_token=token_text(llm.token_eos()),
        bos_token=token_text(llm.token_bos()),
        stop_token_ids=stop_token_ids,
    )

    def qwen38_formatter(*, messages, **kwargs):
        kwargs.update(
            enable_thinking=enable_thinking,
            preserve_thinking=preserve_thinking,
            reasoning_effort=reasoning_effort,
        )
        return formatter(messages=messages, **kwargs)

    return chat_formatter_to_chat_completion_handler(qwen38_formatter)


def build_chat_handler(handler_name, mmproj_path, think_mode, img_min, img_max):
    if not mmproj_path or handler_name in ("None", "Qwen3.8"):
        return None
    kwargs = {"clip_model_path": mmproj_path, "verbose": False}
    ch = None
    if handler_name in ("Qwen3-VL", "Qwen3-VL-Thinking"):
        if Qwen3VLChatHandler is None:
            raise RuntimeError("Qwen3VLChatHandler 未找到，请升级 llama-cpp-python")
        kwargs["force_reasoning"] = think_mode
        kwargs["image_max_tokens"] = img_max
        kwargs["image_min_tokens"] = img_min
        ch = Qwen3VLChatHandler(**kwargs)
    elif handler_name == "Qwen2.5-VL":
        if Qwen25VLChatHandler is None:
            raise RuntimeError("Qwen25VLChatHandler 未找到，请升级 llama-cpp-python")
        if _MTMD:
            kwargs["image_max_tokens"] = img_max
            kwargs["image_min_tokens"] = img_min
        ch = Qwen25VLChatHandler(**kwargs)
    elif handler_name in ("Qwen3.6", "Qwen3.6-Thinking", "Qwen3.5", "Qwen3.5-Thinking"):
        # Qwen3.6 在 llama-cpp-python 中未单独立 handler，官方映射 qwen3.6 -> Qwen35ChatHandler
        handler_cls = Qwen36ChatHandler or Qwen35ChatHandler
        if handler_cls is None:
            raise RuntimeError("Qwen36/Qwen35ChatHandler 未找到，请升级 llama-cpp-python")
        kwargs["enable_thinking"] = think_mode
        if _MTMD:
            kwargs["image_max_tokens"] = img_max
            kwargs["image_min_tokens"] = img_min
        ch = handler_cls(**kwargs)
    elif handler_name in ("MiniCPM-v4.5", "MiniCPM-v4.5-Thinking"):
        kwargs["enable_thinking"] = think_mode
        if _MTMD:
            kwargs["image_max_tokens"] = img_max
            kwargs["image_min_tokens"] = img_min
        ch = MiniCPMv26ChatHandler(**kwargs)
    elif handler_name == "Gemma3":
        if Gemma3ChatHandler is None:
            raise RuntimeError("Gemma3ChatHandler 未找到，请升级 llama-cpp-python")
        if _MTMD:
            kwargs["image_max_tokens"] = img_max
            kwargs["image_min_tokens"] = img_min
        ch = Gemma3ChatHandler(**kwargs)
    elif handler_name == "Gemma4":
        if Gemma4ChatHandler is None:
            raise RuntimeError("Gemma4ChatHandler 未找到，请升级 llama-cpp-python")
        kwargs["enable_thinking"] = think_mode
        if _MTMD:
            kwargs["image_max_tokens"] = img_max
            kwargs["image_min_tokens"] = img_min
        ch = Gemma4ChatHandler(**kwargs)
    elif handler_name in ("GLM-4.6V", "GLM-4.6V-Thinking"):
        if GLM46VChatHandler is None:
            raise RuntimeError("GLM46VChatHandler 未找到，请升级 llama-cpp-python")
        kwargs["enable_thinking"] = think_mode
        if _MTMD:
            kwargs["image_max_tokens"] = img_max
            kwargs["image_min_tokens"] = img_min
        ch = GLM46VChatHandler(**kwargs)
    elif handler_name == "GLM-4.1V-Thinking":
        if GLM41VChatHandler is None:
            raise RuntimeError("GLM41VChatHandler 未找到，请升级 llama-cpp-python")
        kwargs["enable_thinking"] = think_mode
        if _MTMD:
            kwargs["image_max_tokens"] = img_max
            kwargs["image_min_tokens"] = img_min
        ch = GLM41VChatHandler(**kwargs)
    elif handler_name == "LFM2-VL":
        if LFM2VLChatHandler is None:
            raise RuntimeError("LFM2VLChatHandler 未找到，请升级 llama-cpp-python")
        if _MTMD:
            kwargs["image_max_tokens"] = img_max
            kwargs["image_min_tokens"] = img_min
        ch = LFM2VLChatHandler(**kwargs)
    elif handler_name == "Granite-Docling":
        if GraniteDoclingChatHandler is None:
            raise RuntimeError("GraniteDoclingChatHandler 未找到，请升级 llama-cpp-python")
        if _MTMD:
            kwargs["image_max_tokens"] = img_max
            kwargs["image_min_tokens"] = img_min
        ch = GraniteDoclingChatHandler(**kwargs)
    elif handler_name == "LLaVA-1.5":
        if Llava15ChatHandler is None:
            raise RuntimeError("Llava15ChatHandler 未找到，请升级 llama-cpp-python")
        ch = Llava15ChatHandler(**kwargs)
    elif handler_name == "LLaVA-1.6":
        if Llava16ChatHandler is None:
            raise RuntimeError("Llava16ChatHandler 未找到，请升级 llama-cpp-python")
        ch = Llava16ChatHandler(**kwargs)
    elif handler_name == "Moondream2":
        if MoondreamChatHandler is None:
            raise RuntimeError("MoondreamChatHandler 未找到，请升级 llama-cpp-python")
        ch = MoondreamChatHandler(**kwargs)
    elif handler_name == "nanoLLaVA":
        if NanoLlavaChatHandler is None:
            raise RuntimeError("NanoLlavaChatHandler 未找到，请升级 llama-cpp-python")
        ch = NanoLlavaChatHandler(**kwargs)
    elif handler_name == "llama3-Vision-Alpha":
        if Llama3VisionAlphaChatHandler is None:
            raise RuntimeError("Llama3VisionAlphaChatHandler 未找到，请升级 llama-cpp-python")
        ch = Llama3VisionAlphaChatHandler(**kwargs)
    elif handler_name == "MiniCPM-v2.6":
        if MiniCPMv26ChatHandler is None:
            raise RuntimeError("MiniCPMv26ChatHandler 未找到，请升级 llama-cpp-python")
        ch = MiniCPMv26ChatHandler(**kwargs)
    return ch


# ── LoRA 双 API 探测 ───────────────────────────────────────────────────────────
def _lora_api():
    """返回 (api, legacy_has_scale)：modern=load_lora 动态加载；legacy=构造时 lora_path。"""
    LlamaCls = getattr(__import__("llama_cpp", fromlist=["Llama"]), "Llama", None)
    if LlamaCls is None:
        return "", False
    if callable(getattr(LlamaCls, "load_lora", None)):
        return "modern", False
    try:
        params = inspect.signature(LlamaCls.__init__).parameters
    except (TypeError, ValueError):
        return "legacy", False
    if "lora_path" not in params:
        return "", False
    return "legacy", "lora_scale" in params


# ── 模型加载（惰性 + 缓存）─────────────────────────────────────────────────────
def _resolve_paths(model_file, mmproj_file):
    model_path = _llm_full_path(model_file) if model_file and model_file != "None" else None
    mmproj_path = None
    if mmproj_file and mmproj_file != "None":
        mmproj_path = _llm_full_path(mmproj_file)
    return model_path, mmproj_path


def _compute_n_gpu_layers(model_path, mmproj_path, vram_limit_gb):
    if vram_limit_gb == -1:
        return -1
    layer_count = get_layer_count(model_path) or 32
    model_size_gb = os.path.getsize(model_path) * 1.55 / (1024 ** 3)
    layer_size_gb = model_size_gb / layer_count
    if mmproj_path:
        mmproj_size_gb = os.path.getsize(mmproj_path) * 1.55 / (1024 ** 3)
        return max(1, int((vram_limit_gb - mmproj_size_gb) / layer_size_gb))
    return max(1, int(vram_limit_gb / layer_size_gb))


def _reraise_model_load_error(load_error, model_path, mmproj_path, n_gpu_layers, vram_limit_gb):
    """把 llama.cpp 的“文件加载失败”转成可操作的显存提示；其它错误原样抛出。"""
    if not (isinstance(load_error, ValueError) and "Failed to load model from file" in str(load_error)):
        raise load_error
    try:
        model_size_gb = os.path.getsize(model_path) / (1024 ** 3)
    except OSError:
        model_size_gb = None
    try:
        mmproj_size_gb = os.path.getsize(mmproj_path) / (1024 ** 3) if mmproj_path else 0.0
    except OSError:
        mmproj_size_gb = None
    size_parts = []
    if model_size_gb is not None:
        size_parts.append(f"主模型文件约 {model_size_gb:.1f} GB")
    if mmproj_size_gb is not None and mmproj_size_gb > 0:
        size_parts.append(f"mmproj约 {mmproj_size_gb:.1f} GB")
    size_hint = "，".join(size_parts) + "。" if size_parts else ""
    estimated = (
        (model_size_gb or 0.0) * 1.55 + (mmproj_size_gb or 0.0) * 1.55
        if model_size_gb is not None and mmproj_size_gb is not None
        else None
    )
    estimate_hint = (
        f"粗略加载预算约 {estimated:.1f} GB（还未计入上下文缓存）。"
        if estimated is not None else ""
    )
    if n_gpu_layers == -1:
        raise RuntimeError(
            f"模型加载失败：{size_hint}{estimate_hint}"
            "当前「显存限制GB」为 -1 且「GPU层数」为 -1，表示尝试全部放入 GPU；"
            "这通常是显存不足，而不是提示词或图片输入错误。"
            "请把「显存限制GB」改成实际剩余显存的一部分（新手可先填 8），"
            "让模型自动部分卸载到系统内存后重试；显存有余量时再逐步提高。"
            "同时确认主模型与 mmproj 来自同一模型系列。"
        ) from load_error
    raise RuntimeError(
        f"模型加载失败：{size_hint}{estimate_hint}"
        f"当前显存预算为 {vram_limit_gb:.1f} GB（n_gpu_layers={n_gpu_layers}）。"
        "如果显卡还有空余，请适当提高显存预算或 GPU 层数；如果仍然显存不足，请降低预算，"
        "并关闭其他占用显存的节点或程序。若调整后仍失败，再检查 GGUF 下载完整性、"
        "CUDA 后端和主模型/mmproj 配对。"
    ) from load_error


def load_model(handle):
    """依据 handle 配置加载（或复用）模型，返回 Llama 实例。handle 由加载器节点产出。"""
    if Llama is None:
        raise RuntimeError(
            "未找到 llama-cpp-python。请按 README 安装 GPU 版。"
            "Qwen3.8 需要 JamePeng llama-cpp-python 0.3.47+。"
        )
    model_file = handle["model_file"]
    mmproj_file = handle.get("mmproj_file", "None")
    handler_name = _normalize_handler_name(handle.get("handler_name", "None"))
    n_gpu_layers = handle.get("n_gpu_layers", -1)
    n_ctx = handle.get("n_ctx", 8192)
    vram_limit_gb = handle.get("vram_limit_gb", -1)
    think_mode = handle.get("think_mode", False)
    img_min = handle.get("image_min_tokens", 256)
    img_max = handle.get("image_max_tokens", 1024)
    reasoning_effort = normalize_qwen38_reasoning_effort(handle.get("reasoning_effort", "off"))
    lora = handle.get("lora")

    model_path, mmproj_path = _resolve_paths(model_file, mmproj_file)
    if not model_path:
        raise ValueError("基座 GGUF 模型未选择或不存在。")

    if handler_name == "Qwen3.8":
        _validate_qwen38_backend()

    _validate_multimodal_pair(model_path, model_file, handler_name, mmproj_path, mmproj_file)

    if vram_limit_gb != -1 and n_gpu_layers == -1:
        n_gpu_layers = _compute_n_gpu_layers(model_path, mmproj_path, vram_limit_gb)

    api, legacy_has_scale = _lora_api() if lora else ("", False)
    lora_file = lora["file"] if lora else None
    # legacy API 把 scale 固化在构造参数里 → 必须进缓存 key；modern API scale 是 per-call 的 → 不进 key
    lora_scale_key = (
        float(lora.get("scale", 1.0)) if (lora and api == "legacy" and legacy_has_scale) else None
    )

    # 缓存命中：配置完全一致则复用
    key = (model_file, mmproj_file, handler_name, n_gpu_layers, n_ctx,
           think_mode, img_min, img_max, reasoning_effort, lora_file, lora_scale_key)
    if CACHE.config == key and CACHE.llm is not None:
        # modern API：scale 是生成时透传的，缓存命中也要刷新当前 scale
        if lora and api == "modern" and CACHE.lora_active is not None:
            CACHE.lora_active["scale"] = float(lora.get("scale", 1.0))
        print("[CZ-Toolkit] 复用已加载模型")
        return CACHE.llm

    # 否则卸载旧模型再加载
    if handler_name == "Qwen3.8":
        _warn_qwen38_thinking_combo(think_mode, reasoning_effort)
    layer_count = get_layer_count(model_path) or 32
    if n_gpu_layers != -1 and n_gpu_layers < layer_count:
        print(
            f"[CZ-Toolkit] 性能提示：当前仅 {n_gpu_layers}/{layer_count} 层在 GPU，"
            "其余层由 CPU 计算，速度会明显下降。"
            "可提高「显存限制GB」，或把「GPU层数」设为 -1 尝试全进 GPU。"
        )
    unload()

    chat_handler = build_chat_handler(handler_name, mmproj_path, think_mode, img_min, img_max)
    _patch_chat_handler_template_globals(chat_handler)
    kwargs = {
        "model_path": model_path,
        "chat_handler": chat_handler,
        "n_gpu_layers": n_gpu_layers,
        "n_ctx": n_ctx,
        "verbose": False,
    }

    if api == "legacy" and lora:
        kwargs["lora_path"] = _llm_full_path(lora["file"])
        if legacy_has_scale:
            kwargs["lora_scale"] = float(lora.get("scale", 1.0))
        else:
            print("[CZ-Toolkit] 警告：当前 llama-cpp-python 的 legacy API 不支持 lora_scale，"
                  "「权重scale」将被忽略。升级到支持 load_lora 的版本可启用 per-call scale。")

    llm = None
    try:
        llm = Llama(**kwargs)

        if handler_name == "Qwen3.8":
            chat_template = (getattr(llm, "metadata", {}) or {}).get("tokenizer.chat_template")
            if not chat_template:
                raise RuntimeError("Qwen3.8 GGUF 缺少 tokenizer.chat_template。")
            enable_thinking = think_mode and reasoning_effort != "off"
            if mmproj_path:
                chat_handler = _create_qwen38_mm_handler(
                    mmproj_path,
                    enable_thinking=enable_thinking,
                    preserve_thinking=False,
                    reasoning_effort=reasoning_effort,
                    chat_template_override=_adapt_qwen38_chat_template(chat_template),
                    image_min_tokens=img_min,
                    image_max_tokens=img_max,
                )
            else:
                chat_handler = _create_qwen38_text_handler(
                    llm,
                    enable_thinking=enable_thinking,
                    preserve_thinking=False,
                    reasoning_effort=reasoning_effort,
                )
            llm.chat_handler = chat_handler

        # MTMD 提前初始化（与 Dapao 一致），避免缓存无效处理器
        if chat_handler is not None and hasattr(chat_handler, "_init_mtmd_context"):
            try:
                chat_handler._init_mtmd_context(llm)
            except ValueError as gpu_err:
                if not getattr(chat_handler, "use_gpu", False):
                    raise
                print("[CZ-Toolkit] GPU 视觉编码器初始化失败，改用 CPU 重试")
                chat_handler.use_gpu = False
                try:
                    chat_handler._init_mtmd_context(llm)
                except ValueError as cpu_err:
                    raise ValueError(
                        "多模态投影加载失败："
                        f"主模型「{model_file}」，mmproj「{mmproj_file}」。"
                        "请确认两者来自同一模型系列和参数规模，且 GGUF 文件完整。"
                    ) from cpu_err
    except Exception as load_error:
        if chat_handler is not None and hasattr(chat_handler, "close"):
            try:
                chat_handler.close()
            except Exception:
                pass
        if llm is not None and hasattr(llm, "close"):
            try:
                llm.close()
            except Exception:
                pass
        _reraise_model_load_error(
            load_error, model_path, mmproj_path, n_gpu_layers, vram_limit_gb
        )

    lora_active = None
    if api == "modern" and lora:
        lora_path = _llm_full_path(lora["file"])
        name = os.path.splitext(os.path.basename(lora["file"]))[0] or "adapter"
        llm.load_lora(name, lora_path)
        lora_active = {"name": name, "scale": float(lora.get("scale", 1.0))}

    CACHE.llm = llm
    CACHE.chat_handler = chat_handler
    CACHE.config = key
    CACHE.lora_active = lora_active
    extra = ""
    if handler_name == "Qwen3.8":
        extra = f"  handler=Qwen3.8  think={think_mode}  reasoning={reasoning_effort}"
    print(f"[CZ-Toolkit] 模型已加载: {model_file}  n_gpu_layers={n_gpu_layers}{extra}")
    return llm


def model_supports_audio(llm):
    """当前已加载模型（mmproj + chat handler）是否支持 input_audio。"""
    handler = getattr(llm, "chat_handler", None)
    if handler is None:
        return False
    if hasattr(handler, "_init_mtmd_context") and getattr(handler, "mtmd_ctx", None) is None:
        try:
            handler._init_mtmd_context(llm)
        except Exception:
            return False
    return bool(getattr(handler, "is_support_audio", False))


def set_seed(llm, seed):
    """修复随机种子：每次生成前显式复位 RNG，确保相同 seed + 相同输入可复现。"""
    seed = int(seed)
    fn = getattr(llm, "set_seed", None)
    if callable(fn):
        fn(seed)
    return seed


def get_lora_active():
    return CACHE.lora_active


def clear_kv_cache(llm, handler_name):
    if _normalize_handler_name(handler_name) not in _QWEN_KV_CLEAR_HANDLERS:
        return
    try:
        llm.n_tokens = 0
        llm._ctx.memory_clear(True)
        if llm.is_hybrid and llm._hybrid_cache_mgr is not None:
            llm._hybrid_cache_mgr.clear()
    except Exception:
        pass


def unload():
    """自动卸载：释放模型显存（对应「推理后卸载模型」开关）。"""
    CACHE.clean()
    try:
        mm.soft_empty_cache()
    except Exception:
        pass
    gc.collect()


# ── 模型下拉列表 ──────────────────────────────────────────────────────────────
def is_lora_adapter(file_path):
    """按 GGUF 元信息判断是否 LoRA 适配器（adapter 型 GGUF）。"""
    try:
        meta = _get_gguf_metadata(file_path, {"general.type", "adapter.type"})
        if meta.get("general.type") == "adapter" or "adapter.type" in meta:
            return True
    except Exception:
        pass
    return False


def _llm_filename_list():
    names = []
    seen = set()
    for key in list(folder_paths.folder_names_and_paths):
        if str(key).lower() != "llm":
            continue
        try:
            for f in folder_paths.get_filename_list(key):
                if f not in seen:
                    seen.add(f)
                    names.append(f)
        except Exception:
            continue
    return names


def list_lora_gguf():
    """列出 LoRA 适配器：GGUF 元信息确认，或文件名含 lora 关键字（启发式）。"""
    out = []
    for f in _llm_filename_list():
        if not f.lower().endswith(".gguf") or "mmproj" in f.lower():
            continue
        try:
            full = folder_paths.get_full_path("LLM", f) or folder_paths.get_full_path("llm", f)
            if full and (is_lora_adapter(full) or "lora" in f.lower()):
                out.append(f)
        except Exception:
            continue
    return out


def list_gguf_models():
    """列出基座 GGUF（排除 mmproj 与 LoRA 适配器）。"""
    lora_set = set(list_lora_gguf())
    files = [
        f for f in _llm_filename_list()
        if f.lower().endswith(".gguf") and "mmproj" not in f.lower() and f not in lora_set
    ]
    return sorted(files) or ["None"]


def list_mmproj():
    files = [
        f for f in _llm_filename_list()
        if "mmproj" in f.lower() and f.lower().endswith(".gguf")
    ]
    return ["None"] + sorted(files)
