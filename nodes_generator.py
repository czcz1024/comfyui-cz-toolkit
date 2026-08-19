"""H3 提示词生成（核心节点）。

整合 T8 的 H3 提示词模板（外置 prompts/）+ Dapao 的本地 llama_cpp 推理形式：
- 系统提示词：多行文本 widget（默认留空 = 由「提示词版本 + H3模式 + 风格预设」动态组合；
  填了则作为用户覆盖，但仍会追加当前模式的 Task 段以保证输出格式）
- 动态 Task 注入：h3_system.txt / h3_system_lite.txt 按 "Task: XXX." 标记拆分为
  core + 各任务段，只注入当前 H3模式 对应的一段（小模型友好，省上下文）
- 修复随机种子：每次生成前显式 set_seed + 透传 seed，可关闭随机化以复现
- 自动卸载模型：推理后释放显存
- 剥离 thinking 块：思考模式产出的 <think>…</think> 不进最终提示词，原始响应单独输出
"""

import os
import re
import json
import random

from . import models_util as mu

_HERE = os.path.dirname(__file__)
_PROMPTS_DIR = os.path.join(_HERE, "prompts")

_TASK_MARKER = re.compile(r"^Task:\s*([A-Za-z0-9]+)[^\n]*\.", re.MULTILINE)


def _read_prompt_file(name):
    """读取 prompts 下文件，失败时兜底为空串（不炸 ComfyUI 启动）。"""
    path = os.path.join(_PROMPTS_DIR, name)
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    except Exception as e:
        print(f"[CZ-Toolkit] 警告：无法读取 {name}（{e}），将使用空提示词。")
        return ""


def _split_system_prompt(text):
    """把完整提示词拆成 (core, {mode: task_section})。

    按 "Task: <NAME>." 行切分；无标记则整体作为 core。兼容 T8 升级后直接覆盖文件。
    """
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


# 加载外置 H3 系统提示词（T8 契约，可整体替换）——导入期容错
SYSTEM_FULL = _read_prompt_file("h3_system.txt")
SYSTEM_LITE = _read_prompt_file("h3_system_lite.txt") or SYSTEM_FULL
_CORE_FULL, _TASKS_FULL = _split_system_prompt(SYSTEM_FULL)
_CORE_LITE, _TASKS_LITE = _split_system_prompt(SYSTEM_LITE)
_KNOWN_TASKS = sorted({*_TASKS_FULL, *_TASKS_LITE})

# 官方 H3-Prompt-Rewriter LoRA 的固定 system prompt（lightx2v prompt_template.py 原文，
# 该 LoRA 按此措辞训练，改动会降低改写质量，故单独成文件、逐字保留）
H3_LORA_TEMPLATE = _read_prompt_file("h3_lora_template.txt").strip()

# 加载风格预设（失败则退化为空预设）
try:
    with open(os.path.join(_PROMPTS_DIR, "styles.json"), "r", encoding="utf-8") as _f:
        STYLES = json.load(_f)
except Exception as _e:
    print(f"[CZ-Toolkit] 警告：无法读取 styles.json（{_e}），仅保留空预设。")
    STYLES = {"无（仅核心规则）": "Creative preset: none. Apply only the H3 core contract and the user's own requested style."}

STYLE_NAMES = list(STYLES.keys())

ASPECT_OPTIONS = ["16:9", "9:16", "1:1", "4:3", "3:4"]
MODE_OPTIONS = ["自动识别", "T2VA", "I2VA", "FL2VA", "L2VA", "Ref2VA"]
VERSION_OPTIONS = ["精简（小模型推荐）", "完整（云端契约）", "官方LoRA模板(T2VA)"]
LORA_VERSION = "官方LoRA模板(T2VA)"


def build_system_prompt(version, mode, style_name):
    """组合系统提示词：core（按版本）+ 当前模式 Task 段 + 风格预设。

    官方LoRA模板(T2VA) 为特例：直接返回 LoRA 训练时的固定 system prompt，
    不追加 Task 段、不叠加风格（该模板本身完整且不可改词）。
    """
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
    preset = STYLES.get(style_name, "")
    if preset:
        parts.append(preset)
    return "\n\n".join(parts) if parts else SYSTEM_LITE or SYSTEM_FULL


def _strip_thinking(text):
    """剥离思考块：<think>…</think> 完整块、游离的 </think>、未闭合的 <think>。"""
    text = re.sub(r"<think>.*?</think>\s*", "", text, flags=re.DOTALL)
    if "</think>" in text:
        text = text.rsplit("</think>", 1)[1].strip()
    text = re.sub(r"<think>.*$", "", text, flags=re.DOTALL)
    return text.strip()


class H3PromptGenerator:
    """用本地 GGUF 模型把视频需求编译为 MiniMax H3 提示词。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "模型句柄": ("H3_MODEL_HANDLE",),
                "提示词版本": (VERSION_OPTIONS, {"default": "精简（小模型推荐）"}),
                "系统提示词": ("STRING", {"multiline": True, "default": ""}),
                "原始视频需求": ("STRING", {"multiline": True, "default": "在此写你的视频想法：剧情 / 动作 / 镜头 / 声音。"}),
                "H3模式": (MODE_OPTIONS, {"default": "自动识别"}),
                "风格预设": (STYLE_NAMES, {"default": STYLE_NAMES[0]}),
                "目标时长": ("INT", {"default": 5, "min": 1, "max": 120, "step": 1}),
                "视频比例": (ASPECT_OPTIONS, {"default": "16:9"}),
                "温度": ("FLOAT", {"default": 0.7, "min": 0.0, "max": 2.0, "step": 0.05}),
                "top_p": ("FLOAT", {"default": 0.9, "min": 0.0, "max": 1.0, "step": 0.01}),
                "top_k": ("INT", {"default": 40, "min": 0, "max": 100, "step": 1}),
                "重复惩罚": ("FLOAT", {"default": 1.1, "min": 0.0, "max": 2.0, "step": 0.05}),
                "最大输出token": ("INT", {"default": 2048, "min": 64, "max": 8192, "step": 64}),
                "🎲随机种子": ("INT", {"default": 0, "min": 0, "max": 2147483647, "step": 1}),
                "🔀随机化": ("BOOLEAN", {"default": False}),
                "⚡推理后卸载模型": ("BOOLEAN", {"default": False}),
            },
            "optional": {
                "参考素材": ("H3_MEDIA_BUNDLE",),
            },
        }

    RETURN_TYPES = ("STRING", "STRING", "STRING")
    RETURN_NAMES = ("H3提示词", "识别模式", "原始响应")
    FUNCTION = "generate"
    CATEGORY = "CZ/LLM"

    def generate(self, **kwargs):
        模型句柄 = kwargs["模型句柄"]
        提示词版本 = kwargs["提示词版本"]
        系统提示词 = kwargs["系统提示词"]
        原始视频需求 = kwargs["原始视频需求"]
        H3模式 = kwargs["H3模式"]
        风格预设 = kwargs["风格预设"]
        目标时长 = kwargs["目标时长"]
        视频比例 = kwargs["视频比例"]
        温度 = kwargs["温度"]
        top_p = kwargs["top_p"]
        top_k = kwargs["top_k"]
        重复惩罚 = kwargs["重复惩罚"]
        最大输出token = kwargs["最大输出token"]
        seed_input = kwargs["🎲随机种子"]
        randomize = kwargs["🔀随机化"]
        auto_unload = kwargs["⚡推理后卸载模型"]
        参考素材 = kwargs.get("参考素材")

        # 官方 LoRA 模板模式：仅 T2VA 文本改写（官方明确不吃图/视频/音频参考）
        is_lora_mode = 提示词版本 == LORA_VERSION

        # 1) 确保模型已加载（按句柄命中缓存，否则惰性加载）
        llm = mu.load_model(模型句柄)

        # 2) 种子：随机化则每次随机；否则固定 seed 并显式复位 RNG（修复 seed 失效）
        if randomize:
            seed = random.randint(0, 2_147_483_647)
        else:
            seed = int(seed_input)
        seed = mu.set_seed(llm, seed)

        # 3) 任务模式解析
        mode = H3模式
        if is_lora_mode:
            mode = "T2VA"  # 官方 LoRA 仅训练了 T2VA 改写
        elif mode == "自动识别":
            if 参考素材 and 参考素材.get("mode_hint"):
                mode = 参考素材.get("mode_hint") or "T2VA"
            else:
                mode = "T2VA"

        # 4) 组装系统提示词 + 用户消息
        if is_lora_mode:
            # 官方 LoRA 模式：system 用官方固定模板（LoRA 按此措辞训练，改动即降级）；
            # 输入严格按官方格式 resolution/duration/original_prompt 拼装；
            # LoRA 仅吃文本（不吃参考图/音频），参考素材一律不附带
            system_content = (系统提示词.strip() if 系统提示词 and 系统提示词.strip()
                              else (H3_LORA_TEMPLATE or SYSTEM_LITE or SYSTEM_FULL))
            if 模型句柄.get("think_mode"):
                print("[CZ-Toolkit] 警告：官方 LoRA 训练要求 enable_thinking=False，"
                      "建议在模型加载器把「思考模式」关闭，否则模型会先输出大段推理再写结果。")
            user_text = (
                f"resolution: {视频比例}\n"
                f"duration: {目标时长}s\n"
                f"original_prompt: {原始视频需求.strip()}"
            )
            user_content = [{"type": "text", "text": user_text}]
        else:
            # 留空 → 版本 + 模式 Task 段 + 风格预设动态组合；非空 → 用户覆盖 + 追加模式 Task 段
            if 系统提示词 and 系统提示词.strip():
                task = _TASKS_LITE.get(mode) or _TASKS_FULL.get(mode)
                system_content = 系统提示词.strip()
                if task:
                    system_content += "\n\n" + task
            else:
                system_content = build_system_prompt(提示词版本, mode, 风格预设)

            user_text = (
                f"【任务模式】{mode}\n"
                f"【目标时长】{目标时长} 秒\n"
                f"【视频比例】{视频比例}\n\n"
                f"【视频需求】\n{原始视频需求}\n"
            )
            if 参考素材 and 参考素材.get("reference_text"):
                user_text += "\n【参考素材】\n" + 参考素材["reference_text"] + "\n"

            user_content = [{"type": "text", "text": user_text}]
            if 参考素材:
                user_content += 参考素材.get("image_parts", []) + 参考素材.get("audio_parts", [])

        # 5) 上下文预算校验（估算，超限直接给可操作报错，避免深层溢出）
        n_ctx = int(模型句柄.get("n_ctx", 8192))
        img_max_tokens = int(模型句柄.get("image_max_tokens", 1024))
        n_images = sum(1 for p in user_content if p.get("type") == "image_url")
        est_sys = len(system_content) // 3
        est_user = len(user_text) // 3
        est_media = n_images * img_max_tokens
        est_total = est_sys + est_user + est_media + int(最大输出token)
        if est_total > n_ctx:
            raise ValueError(
                f"上下文预算不足：估算约 {est_total} token > 上下文长度 {n_ctx}。"
                f"请任选其一：减少参考图/视频帧数量、在加载器降低「图像最大token」（当前 {img_max_tokens}），"
                f"或把「上下文长度」调到 ≥ {est_total}。"
            )

        messages = [
            {"role": "system", "content": system_content},
            {"role": "user", "content": user_content},
        ]

        # 6) 推理
        gen_kwargs = dict(
            max_tokens=int(最大输出token),
            temperature=float(温度),
            top_p=float(top_p),
            top_k=int(top_k),
            repeat_penalty=float(重复惩罚),
            seed=seed,
        )
        lora_active = mu.get_lora_active()
        if lora_active:
            gen_kwargs["active_loras"] = [lora_active]

        try:
            resp = llm.create_chat_completion(messages=messages, **gen_kwargs)
        except Exception as e:
            msg = str(e).lower()
            if "context" in msg and ("exceed" in msg or "overflow" in msg or "too large" in msg):
                raise RuntimeError(
                    f"推理时上下文溢出（{e}）。请在加载器增大「上下文长度」，或减少素材数量。"
                ) from e
            raise RuntimeError(f"本地模型推理失败：{e}") from e

        raw = (resp["choices"][0]["message"]["content"] or "").strip()
        text = _strip_thinking(raw)

        # 7) 自动卸载（可选）；Qwen 系列下次推理前需清 KV cache
        if auto_unload:
            mu.unload()
        else:
            mu.clear_kv_cache(llm, 模型句柄.get("handler_name", "None"))

        return (text, mode, raw)
