"""H3 参数包装节点：把 H3 专用参数（模式、时长、比例、提示词版本等）
组装成系统提示词 + 用户消息两个 STRING，连接到通用 LLMGenerator。

不做推理，不接触模型。
"""

import os
import re

from . import media_util as mdu

_HERE = os.path.dirname(__file__)
_PROMPTS_DIR = os.path.join(_HERE, "prompts")

_TASK_MARKER = re.compile(r"^Task:\s*([A-Za-z0-9]+)[^\n]*\.", re.MULTILINE)


def _read_prompt_file(name):
    path = os.path.join(_PROMPTS_DIR, name)
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    except Exception as e:
        print(f"[CZ-Toolkit] 警告：无法读取 {name}（{e}），将使用空提示词。")
        return ""


def _split_system_prompt(text):
    if not text:
        return "", {}
    matches = list(_TASK_MARKER.finditer(text))
    if not matches:
        return text.strip(), {}
    core = text[:matches[0].start()].rstrip()
    tasks = {}
    for i, m in enumerate(matches):
        name = m.group(1).upper()
        if name.startswith("REF"):
            name = "Ref2VA"
        elif name in ("T2VA", "I2VA", "FL2VA", "L2VA"):
            pass
        else:
            continue
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        tasks[name] = text[m.start():end].strip()
    return core, tasks


SYSTEM_FULL = _read_prompt_file(os.path.join("h3", "official", "h3_system.txt"))
SYSTEM_LITE = _read_prompt_file(os.path.join("h3", "official", "h3_system_lite.txt")) or SYSTEM_FULL
_CORE_FULL, _TASKS_FULL = _split_system_prompt(SYSTEM_FULL)
_CORE_LITE, _TASKS_LITE = _split_system_prompt(SYSTEM_LITE)

H3_LORA_TEMPLATE = _read_prompt_file(os.path.join("h3", "official", "h3_lora_template.txt")).strip()

ASPECT_OPTIONS = ["16:9", "9:16", "1:1", "4:3", "3:4"]
MODE_OPTIONS = ["自动识别", "T2VA", "I2VA", "FL2VA", "L2VA", "Ref2VA"]
VERSION_OPTIONS = ["精简（小模型推荐）", "完整（云端契约）", "官方LoRA模板(T2VA)"]
LORA_VERSION = "官方LoRA模板(T2VA)"


def _build_system(version, mode, extra_system=""):
    """组合系统提示词：core（按版本）+ 当前模式 Task 段 + 外部传入的额外提示词。"""
    if version == LORA_VERSION:
        return H3_LORA_TEMPLATE or SYSTEM_LITE or SYSTEM_FULL

    if version == "完整（云端契约）":
        core, tasks = _CORE_FULL, _TASKS_FULL
    else:
        core, tasks = _CORE_LITE, _TASKS_LITE

    parts = [core] if core else []
    task = tasks.get(mode, "")
    if task:
        parts.append(task)
    if extra_system and extra_system.strip():
        parts.append(extra_system.strip())
    return "\n\n".join(parts) if parts else SYSTEM_LITE or SYSTEM_FULL


class H3PromptBuilder:
    """把 H3 专用参数组装成系统提示词 + 用户消息，连接到 LLMGenerator。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "原始视频需求": ("STRING", {"multiline": True, "default": "在此写你的视频想法：剧情 / 动作 / 镜头 / 声音。"}),
                "提示词版本": (VERSION_OPTIONS, {"default": "精简（小模型推荐）"}),
                "H3模式": (MODE_OPTIONS, {"default": "自动识别"}),
                "目标时长": ("INT", {"default": 5, "min": 1, "max": 120, "step": 1}),
                "视频比例": (ASPECT_OPTIONS, {"default": "16:9"}),
            },
            "optional": {
                "额外系统提示词": ("STRING", {"forceInput": True}),
                "参考素材": ("H3_MEDIA_BUNDLE",),
            },
        }

    RETURN_TYPES = ("H3_MEDIA_BUNDLE", "STRING", "STRING", "STRING")
    RETURN_NAMES = ("素材包", "系统提示词", "用户消息", "识别模式")
    FUNCTION = "build"
    CATEGORY = "CZ/H3"

    def build(self, **kwargs):
        原始视频需求 = kwargs["原始视频需求"]
        提示词版本 = kwargs["提示词版本"]
        H3模式 = kwargs["H3模式"]
        目标时长 = kwargs["目标时长"]
        视频比例 = kwargs["视频比例"]
        extra_system = kwargs.get("额外系统提示词", "")
        参考素材 = kwargs.get("参考素材")

        is_lora_mode = 提示词版本 == LORA_VERSION

        # 模式解析
        mode = H3模式
        if is_lora_mode:
            mode = "T2VA"
        elif mode == "自动识别":
            if 参考素材 and 参考素材.get("mode_hint"):
                mode = 参考素材.get("mode_hint") or "T2VA"
            else:
                mode = "T2VA"

        # 系统提示词组装
        if is_lora_mode:
            system_content = H3_LORA_TEMPLATE or SYSTEM_LITE or SYSTEM_FULL
        else:
            system_content = _build_system(提示词版本, mode, extra_system)

        # 用户消息组装
        if is_lora_mode:
            user_text = (
                f"resolution: {视频比例}\n"
                f"duration: {目标时长}s\n"
                f"original_prompt: {原始视频需求.strip()}"
            )
        else:
            user_text = (
                f"【任务模式】{mode}\n"
                f"【目标时长】{目标时长} 秒\n"
                f"【视频比例】{视频比例}\n\n"
                f"【视频需求】\n{原始视频需求}\n"
            )
            if 参考素材 and 参考素材.get("reference_text"):
                user_text += "\n【参考素材】\n" + 参考素材["reference_text"] + "\n"

        bundle = 参考素材 if isinstance(参考素材, dict) else mdu.empty_bundle()
        return (bundle, system_content, user_text, mode)
