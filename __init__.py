from .nodes_lora import LLMLoraSelector
from .nodes_loader import LLMModelLoader
from .nodes_media import H3ReferenceMedia, H3MediaUnpack
from .nodes_generator import H3PromptBuilder
from .nodes_llm_generator import LLMGenerator
from .nodes_prompt_box import H3PromptBox
from .nodes_recive_and_edit import ReciveAndEdit
from .nodes_text_selector import TextSelector
from .nodes_prompt_selector import PromptSelector, _scan_prompts, _NONE

from aiohttp import web
import server

@server.PromptServer.instance.routes.get("/cz-toolkit/list-prompts")
async def _list_prompts(request):
    prompts = _scan_prompts()
    options = [_NONE] + prompts
    return web.json_response({"options": options})

NODE_CLASS_MAPPINGS = {
    "LLMLoraSelector": LLMLoraSelector,
    "LLMModelLoader": LLMModelLoader,
    "H3ReferenceMedia": H3ReferenceMedia,
    "H3MediaUnpack": H3MediaUnpack,
    "H3PromptBox": H3PromptBox,
    "H3PromptBuilder": H3PromptBuilder,
    "LLMGenerator": LLMGenerator,
    "ReciveAndEdit": ReciveAndEdit,
    "TextSelector": TextSelector,
    "PromptSelector": PromptSelector,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "LLMLoraSelector": "LLM LoRA 选择器",
    "LLMModelLoader": "LLM 模型加载器",
    "H3ReferenceMedia": "H3 参考素材",
    "H3MediaUnpack": "H3 素材解包",
    "H3PromptBox": "H3 提示词框（可@）",
    "H3PromptBuilder": "H3 参数包装",
    "LLMGenerator": "LLM 通用生成",
    "ReciveAndEdit": "接收并编辑",
    "TextSelector": "多路文本选择器",
    "PromptSelector": "系统提示词选择器",
}

WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
