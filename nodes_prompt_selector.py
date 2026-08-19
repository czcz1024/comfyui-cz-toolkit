"""系统提示词选择器：从 prompts/ 目录及子目录加载 .txt 文件，选择后输出文本内容。

用户可以自行往 prompts/ 目录及子目录添加、修改 .txt 文件。
目录结构示例：
  prompts/
    h3/official/h3_system.txt       → 显示为 "h3/official/h3_system"
    h3/t8/t8_产品广告.txt           → 显示为 "h3/t8/t8_产品广告"
    krea2/my_prompt.txt             → 显示为 "krea2/my_prompt"
"""

import os

_HERE = os.path.dirname(__file__)
_PROMPTS_DIR = os.path.join(_HERE, "prompts")

_NONE = "无（不使用）"


def _scan_prompts():
    """递归扫描 prompts/ 下所有 .txt 文件，返回相对路径列表（不含扩展名），用 / 分隔。"""
    if not os.path.isdir(_PROMPTS_DIR):
        return []
    names = []
    for root, _dirs, files in os.walk(_PROMPTS_DIR):
        for f in sorted(files):
            if f.lower().endswith(".txt"):
                rel = os.path.relpath(os.path.join(root, f), _PROMPTS_DIR)
                rel = rel.replace("\\", "/")
                name = rel[:-4]  # 去掉 .txt
                names.append(name)
    return sorted(names)


def _read_prompt(name):
    """读取指定提示词文件内容。name 是相对路径（不含 .txt）。"""
    path = os.path.join(_PROMPTS_DIR, name + ".txt")
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    except Exception as e:
        return f"[错误] 无法读取 {name}.txt: {e}"


class PromptSelector:

    @classmethod
    def INPUT_TYPES(s):
        prompts = _scan_prompts()
        options = [_NONE] + prompts
        return {
            "required": {
                "prompt_file": (options, {"default": _NONE}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("system_prompt",)
    FUNCTION = "select"
    CATEGORY = "CZ/Text"

    def select(self, prompt_file=_NONE):
        if prompt_file == _NONE:
            return ("",)
        content = _read_prompt(prompt_file)
        return (content,)
