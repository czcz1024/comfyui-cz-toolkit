"""接收并编辑：接收上游文本，可手动编辑后输出。"""


class ReciveAndEdit:
    def __init__(self):
        self.cached_string = ""

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "update_switch": ("BOOLEAN", {"default": True, "label_on": "更新", "label_off": "保持"}),
                "cache_string": ("STRING", {"default": "", "multiline": True})
            },
            "optional": {
                "input_string": ("STRING", {"forceInput": True, "default": ""})
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("OUTPUT",)
    FUNCTION = "process_cache"
    CATEGORY = "CZ/LLM"
    OUTPUT_NODE = True

    def process_cache(self, update_switch, input_string=None, cache_string=None):
        if update_switch and input_string is not None and input_string.strip() != '':
            self.cached_string = input_string
            cache_string = input_string

        return {"result": (cache_string,), "ui": {"text": cache_string}}
