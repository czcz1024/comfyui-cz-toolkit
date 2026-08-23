from .constants import node_id
from .nodes_lora import LLMLoraSelector
from .nodes_loader import LLMModelLoader
from .nodes_generator import H3PromptBuilder
from .nodes_llm_generator import LLMGenerator
from .nodes_prompt_box import H3PromptBox
from .nodes_recive_and_edit import ReciveAndEdit
from .nodes_text_selector import TextSelector
from .nodes_prompt_selector import PromptSelector, _scan_prompts, _NONE
from .nodes_music3_prompt_builder import Music3PromptBuilder
from .nodes_music3_output_parser import Music3OutputParser

from aiohttp import web
import server

try:
    from comfy_api.latest import ComfyExtension, io

    COMFY_API_AVAILABLE = True
except ImportError:
    ComfyExtension = None  # type: ignore
    io = None  # type: ignore
    COMFY_API_AVAILABLE = False

try:
    from .nodes_media_v3 import H3ReferenceMedia as H3ReferenceMediaV3
    from .nodes_media_v3 import H3MediaUnpack as H3MediaUnpackV3
    from .nodes_media_v3 import V3_AVAILABLE
except ImportError:
    H3ReferenceMediaV3 = None  # type: ignore
    H3MediaUnpackV3 = None  # type: ignore
    V3_AVAILABLE = False

from .nodes_media import H3ReferenceMedia, H3MediaUnpack

@server.PromptServer.instance.routes.get("/cz-toolkit/list-prompts")
async def _list_prompts(request):
    prompts = _scan_prompts()
    options = [_NONE] + prompts
    return web.json_response({"options": options})


_LEGACY_NODE_CLASS_MAPPINGS = {
    node_id("LLMLoraSelector"): LLMLoraSelector,
    node_id("LLMModelLoader"): LLMModelLoader,
    node_id("H3PromptBox"): H3PromptBox,
    node_id("H3PromptBuilder"): H3PromptBuilder,
    node_id("LLMGenerator"): LLMGenerator,
    node_id("ReciveAndEdit"): ReciveAndEdit,
    node_id("TextSelector"): TextSelector,
    node_id("PromptSelector"): PromptSelector,
    node_id("Music3PromptBuilder"): Music3PromptBuilder,
    node_id("Music3OutputParser"): Music3OutputParser,
}

_LEGACY_DISPLAY_NAME_MAPPINGS = {
    node_id("LLMLoraSelector"): "LLM LoRA 选择器",
    node_id("LLMModelLoader"): "LLM 模型加载器",
    node_id("H3ReferenceMedia"): "H3 参考素材",
    node_id("H3MediaUnpack"): "H3 素材解包",
    node_id("H3PromptBox"): "H3 提示词框（可@）",
    node_id("H3PromptBuilder"): "H3 参数包装",
    node_id("LLMGenerator"): "LLM 通用生成",
    node_id("ReciveAndEdit"): "接收并编辑",
    node_id("TextSelector"): "多路文本选择器",
    node_id("PromptSelector"): "系统提示词选择器",
    node_id("Music3PromptBuilder"): "Music3 提示词包装（选择题节奏向导）",
    node_id("Music3OutputParser"): "Music3 输出解析（Caption+Lyrics）",
}

WEB_DIRECTORY = "./web"


def _register_legacy_nodes():
    import nodes as comfy_nodes

    rel = __name__
    nodes_to_register = dict(_LEGACY_NODE_CLASS_MAPPINGS)
    if not V3_AVAILABLE:
        nodes_to_register[node_id("H3ReferenceMedia")] = H3ReferenceMedia
        nodes_to_register[node_id("H3MediaUnpack")] = H3MediaUnpack

    for registered_id, node_cls in nodes_to_register.items():
        if registered_id in comfy_nodes.NODE_CLASS_MAPPINGS:
            continue
        comfy_nodes.NODE_CLASS_MAPPINGS[registered_id] = node_cls
        node_cls.RELATIVE_PYTHON_MODULE = rel
        display = _LEGACY_DISPLAY_NAME_MAPPINGS.get(registered_id)
        if display is not None:
            comfy_nodes.NODE_DISPLAY_NAME_MAPPINGS[registered_id] = display


if COMFY_API_AVAILABLE:

    class CZToolkitExtension(ComfyExtension):
        async def on_load(self):
            _register_legacy_nodes()

        async def get_node_list(self) -> list[type[io.ComfyNode]]:
            if V3_AVAILABLE and H3ReferenceMediaV3 is not None and H3MediaUnpackV3 is not None:
                return [H3ReferenceMediaV3, H3MediaUnpackV3]
            return []

    async def comfy_entrypoint() -> CZToolkitExtension:
        return CZToolkitExtension()

    NODE_CLASS_MAPPINGS = None
    NODE_DISPLAY_NAME_MAPPINGS = None

    __all__ = ["WEB_DIRECTORY", "comfy_entrypoint"]

else:
    NODE_CLASS_MAPPINGS = dict(_LEGACY_NODE_CLASS_MAPPINGS)
    NODE_CLASS_MAPPINGS[node_id("H3ReferenceMedia")] = H3ReferenceMedia
    NODE_CLASS_MAPPINGS[node_id("H3MediaUnpack")] = H3MediaUnpack
    NODE_DISPLAY_NAME_MAPPINGS = dict(_LEGACY_DISPLAY_NAME_MAPPINGS)

    comfy_entrypoint = None

    __all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
