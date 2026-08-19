from .nodes_lora import H3LoraSelector
from .nodes_loader import H3ModelLoader
from .nodes_media import H3ReferenceMedia, H3MediaUnpack
from .nodes_generator import H3PromptGenerator
from .nodes_prompt_box import H3PromptBox
from .nodes_recive_and_edit import ReciveAndEdit

NODE_CLASS_MAPPINGS = {
    "H3LoraSelector": H3LoraSelector,
    "H3ModelLoader": H3ModelLoader,
    "H3ReferenceMedia": H3ReferenceMedia,
    "H3MediaUnpack": H3MediaUnpack,
    "H3PromptBox": H3PromptBox,
    "H3PromptGenerator": H3PromptGenerator,
    "ReciveAndEdit": ReciveAndEdit,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "H3LoraSelector": "H3 LoRA 选择器",
    "H3ModelLoader": "H3 模型加载器",
    "H3ReferenceMedia": "H3 参考素材",
    "H3MediaUnpack": "H3 素材解包",
    "H3PromptBox": "H3 提示词框（可@）",
    "H3PromptGenerator": "H3 提示词生成（核心）",
    "ReciveAndEdit": "接收并编辑",
}

WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
