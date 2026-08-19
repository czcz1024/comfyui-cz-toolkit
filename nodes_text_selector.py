"""多路文本选择器：动态多输入，每路从多行文本中选择一行输出，支持合并。"""

import json
import random

MAX_SLOTS = 10


class TextSelector:

    @classmethod
    def INPUT_TYPES(s):
        required = {
            "seed": ("INT", {"default": 0, "min": 0, "max": 0xFFFFFFFFFFFFFFFF}),
            "separator": ("STRING", {"default": ","}),
            "selections": ("STRING", {"default": "{}", "multiline": False}),
        }
        optional = {}
        for i in range(1, MAX_SLOTS + 1):
            optional[f"text_{i}"] = ("STRING", {"forceInput": True})
        return {
            "required": required,
            "optional": optional,
        }

    RETURN_TYPES = tuple(["STRING"] * (MAX_SLOTS + 1))
    RETURN_NAMES = tuple(["merged"] + [f"out_{i}" for i in range(1, MAX_SLOTS + 1)])
    FUNCTION = "select"
    CATEGORY = "CZ/Text"

    @classmethod
    def VALIDATE_INPUTS(cls, **kwargs):
        return True

    def select(self, seed=0, separator=",", selections="{}", **kwargs):
        try:
            sel = json.loads(selections)
        except (json.JSONDecodeError, TypeError):
            sel = {}

        rng = random.Random(seed)
        outputs = []
        for i in range(1, MAX_SLOTS + 1):
            text_val = kwargs.get(f"text_{i}")
            choice = sel.get(str(i), "无")
            if text_val is None or choice == "无":
                outputs.append("")
                continue
            lines = [l for l in text_val.split("\n") if l.strip()]
            if not lines:
                outputs.append("")
            elif choice == "随机":
                outputs.append(rng.choice(lines))
            elif choice in lines:
                outputs.append(choice)
            else:
                outputs.append(rng.choice(lines) if lines else "")

        non_empty = [r for r in outputs if r]
        merged = separator.join(non_empty)
        return tuple([merged] + outputs)
