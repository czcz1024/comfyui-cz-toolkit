"""QuantFunc LoRA 批处理/单文件节点：自动判断 LoRA 格式，非引擎兼容格式就现场转换
（写入同目录 ``<name>-diff.safetensors``），然后把（可能改过的）路径以
``{"path":, "scale":, "target":"all"}`` 的形式注入 QuantFunc 原生引擎的 LoRA 栈。

设计要点：
  * 转换复用 QuantFunc 官方脚本 ``ComfyUI-QuantFunc/scripts/qf_lora_convert.py`` 的
    ``convert_file``，不自己造轮子——它处理 kohya / Krea-2 BFL 改名、丢掉 text-encoder
    键、保留 dtype，且对 LyCORIS/DoRA/OFT 直接拒绝。
  * 引擎注入走与官方 ``QuantFuncNativeLoRA.apply`` 完全相同的 bridge：读
    ``model.model._qf_lora_stack``（已有栈）、追加新条目、调用 ``model.model._qf_rebuild``
    重建、再 ``adopt_comfy_state_from(model)`` 把上游 Comfy 态（ModelSampling* 等）搬过去。
    这两个属性是 QuantFunc 内部唯一写入点 ``tag_lora_rebuild`` 的契约名，直接读最稳。
  * 幂等：若同目录已存在 ``<name>-diff.safetensors`` 就跳过重转，直接用。
  * QuantFunc 的 LoRA 只有 transformer 的 ``scale``（没有 CLIP），所以 Manager 的
    ``clip_strength`` 被忽略，``model_strength`` 当作 ``scale``。
"""

import os
import re
import sys
import importlib.util

try:
    import folder_paths
except Exception:  # folder_paths 仅在 ComfyUI 运行时可用
    folder_paths = None

# QuantFunc 引擎栈的两个契约属性名（来源：ComfyUI-QuantFunc/qf_modelpatcher.py
# QF_LORA_STACK_ATTR / QF_LORA_REBUILD_ATTR，tag_lora_rebuild 是唯一写入点）
QF_LORA_STACK_ATTR = "_qf_lora_stack"
QF_LORA_REBUILD_ATTR = "_qf_rebuild"

# 缓存的转换模块（首次用到时再加载，避免启动期硬依赖 QuantFunc）
_qfc_module = None
_qfc_module_err = None


def _load_convert_module():
    """定位并加载 QuantFunc 官方转换脚本，返回其 module；找不到时抛清晰错误。"""
    global _qfc_module, _qfc_module_err
    if _qfc_module is not None or _qfc_module_err is not None:
        if _qfc_module_err:
            raise RuntimeError(_qfc_module_err)
        return _qfc_module

    conv_path = None
    # 1) 优先从已加载的 ComfyUI-QuantFunc 包反推脚本路径
    for mod in sys.modules.values():
        f = getattr(mod, "__file__", None)
        if f and "ComfyUI-QuantFunc" in f.replace("\\", "/"):
            cand = os.path.join(os.path.dirname(f), "scripts", "qf_lora_convert.py")
            if os.path.isfile(cand):
                conv_path = cand
                break
    # 2) 兜底：常见安装位置
    if conv_path is None:
        for base in (
            os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "ComfyUI-QuantFunc"),
            "D:/ai/ComfyUI/ComfyUI/custom_nodes/ComfyUI-QuantFunc",
        ):
            cand = os.path.join(base, "scripts", "qf_lora_convert.py")
            if os.path.isfile(cand):
                conv_path = cand
                break

    if conv_path is None:
        _qfc_module_err = (
            "找不到 QuantFunc 的 qf_lora_convert.py（应在 ComfyUI-QuantFunc/scripts/ 下）。"
            "请确认 ComfyUI-QuantFunc 插件已安装。")
        raise RuntimeError(_qfc_module_err)

    try:
        spec = importlib.util.spec_from_file_location("cz_toolkit_qf_lora_convert", conv_path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        _qfc_module = mod
        return mod
    except Exception as e:  # noqa: BLE001
        _qfc_module_err = "加载 qf_lora_convert.py 失败：%r" % e
        raise RuntimeError(_qfc_module_err) from e


def _lora_dirs():
    """返回 ComfyUI 配置里所有已注册的 loras 根目录。

    ComfyUI 的 ``extra_model_paths.yaml``（及内置配置）可以为 ``loras`` 类型注册
    **多个**目录，folder_paths.get_folder_paths 会全部返回。解析相对路径时必须在这些
    目录下逐个查找，不能只认 models/loras。
    """
    dirs = []
    if folder_paths is not None:
        try:
            for d in folder_paths.get_folder_paths("loras"):
                if d and d not in dirs:
                    dirs.append(d)
        except Exception:
            pass
    # 兜底：folder_paths 不可用（如独立测试）时，尝试常见位置
    if not dirs:
        for cand in (os.path.join(os.getcwd(), "models", "loras"),
                     "D:/ai/ComfyUI/ComfyUI/models/loras"):
            if os.path.isdir(cand) and cand not in dirs:
                dirs.append(cand)
    return dirs


def _resolve_lora(name):
    """把 LoRA 名 / 相对路径 / 绝对路径统一解析成真实文件路径。

    兼容三种输入：
      * 绝对路径且存在                → 直接用
      * 相对路径（如 ``krea2/face/x``）→ 在 folder_paths 配置的所有 loras 目录下查找
        （兼容 extra_model_paths.yaml 注册的多个目录）
      * 纯文件名                      → 同上在所有目录下查找
    LoRA Manager 的 Stacker 给的就是相对 models/loras 的路径，必须按多目录配置解析。
    """
    if not name:
        raise RuntimeError("LoRA 名为空")
    # 1) 已是绝对路径（或当前 cwd 下就存在）
    if os.path.isfile(name):
        return os.path.abspath(name)
    # 2) 在所有 loras 根目录下查找（兼容多个 loras 目录的配置）
    norm = name.replace("\\", "/")
    for d in _lora_dirs():
        cand = os.path.join(d, norm)
        if os.path.isfile(cand):
            return cand
    raise RuntimeError("找不到 LoRA 文件：%s（请放到某个 loras 目录，或用完整路径）" % name)


def _diff_path(path):
    """转换产物的命名：同目录、原名加 ``-diff`` 后缀。"""
    d, base = os.path.split(path)
    stem, ext = os.path.splitext(base)
    return os.path.join(d, stem + "-diff" + ext)


def _classify(path):
    """判断一个 LoRA 文件该怎么处理，复用官方转换脚本自己的检测逻辑，避免自造分类走偏。

    返回 (kind, detail)：
      ("refuse", (kind_name, why))     不支持（LyCORIS/DoRA/OFT），转换也没用
      ("error",  msg)                  无法识别 / 无可映射键
      ("ok",     None)                 已是引擎兼容的 diffusers/PEFT 规范名，直接用
      ("convert", fmt)                 kohya 或 Krea-2 BFL，需要转成 -diff
    """
    qfc = _load_convert_module()
    try:
        hdr, _ = qfc._read_st(path)
    except SystemExit as e:  # _read_st 对异常头会 raise SystemExit
        raise RuntimeError("读取 LoRA 头失败：%s" % e) from None
    keys = [k for k in hdr if k != "__metadata__"]

    kind = qfc.unsupported_kind(keys)
    if kind:
        return ("refuse", kind)  # kind = ("LyCORIS (LoHa/LoKr)", why) 等
    fmt = qfc.detect_format(keys)
    if fmt == "lycoris":
        return ("refuse", ("LyCORIS", "该格式不支持，且改名也转不出来"))
    if fmt == "unknown":
        return ("error", "无法识别 LoRA 格式（没有 lora_unet_* / .lora_A/.lora_down 等键）")
    # diffusers / kohya：convert_keys 会告诉我们是否触发 Krea-2 BFL 改名
    try:
        conv, krea2 = qfc.convert_keys(keys, fmt)
    except Exception as e:  # noqa: BLE001
        return ("error", "分析键名出错：%r" % e)
    if krea2:
        return ("convert", "krea2-bfl")
    if fmt == "kohya":
        return ("convert", "kohya/ai-toolkit")
    return ("ok", None)


def _ensure_engine_lora(path, base_model_path=None, force=False):
    """返回一个引擎能直接吃的路径 + 一条状态说明；必要时现场转换。

    base_model_path: kohya 格式的 LoRA 转 diffusers 时，必须拿真实底模当「反推字典」
    （qf_lora_convert.py 的 --model）。不传 → 退回内置词表，对 H3 这类新架构会猜错
    模块名，导致引擎 "no-module" 硬报错。
    force: 强制重转（覆盖已存在的 -diff）。当指定了 base_model 时我们总是重转，
    因为旧的 -diff 很可能就是没带 --model 转出来的坏文件。
    """
    diff = _diff_path(path)
    kind, detail = _classify(path)
    if kind == "refuse":
        name, why = detail
        raise RuntimeError(
            "QuantFunc LoRA 节点：%s 是 %s 格式，官方转换脚本与原生引擎都不支持——请先用训练工具"
            "导出成标准 (A,B) LoRA 再进来。%s" % (os.path.basename(path), name, why))
    if kind == "error":
        raise RuntimeError("QuantFunc LoRA 节点：%s —— %s" % (os.path.basename(path), detail))
    if kind == "ok":
        return path, "已是引擎兼容格式(直接用)"

    need_base = bool(detail and "kohya" in detail)  # kohya/ai-toolkit 才需要 --model
    have_diff = os.path.isfile(diff) and os.path.getsize(diff) > 0

    # 幂等规则：
    #  - 提供了底模 → 无论旧 -diff 存不存在都重转（覆盖可能失准的旧文件）
    #  - 没提供底模 且 没强制 → 旧 -diff 在就跳过（兼容旧行为）
    if have_diff and base_model_path is None and not force:
        return diff, "已存在转换文件(跳过转换)"

    qfc = _load_convert_module()
    try:
        qfc.convert_file(path, diff, verbose=True, model_path=base_model_path)
    except SystemExit as e:
        raise RuntimeError("QuantFunc LoRA 节点：转换 %s 失败 —— %s"
                           % (os.path.basename(path), str(e).strip())) from None
    except Exception as e:  # noqa: BLE001
        raise RuntimeError("QuantFunc LoRA 节点：转换 %s 写出失败 —— %r（检查目录写权限）"
                           % (os.path.basename(path), e)) from e

    if base_model_path:
        note = " (用底模反推模块名)"
    elif need_base:
        note = " (未提供底模：kohya 走内置词表，可能不准！)"
    else:
        note = ""
    return diff, "已转换→%s%s" % (os.path.basename(diff), note)


def _rebuild_with(model, new_entries):
    """把新条目追加进 QuantFunc 引擎 LoRA 栈并重建 patcher（与官方 apply 同款 bridge）。"""
    m = getattr(model, "model", None)
    if m is None:
        raise RuntimeError("QuantFunc LoRA 节点：传入的不是合法 MODEL。")
    rebuild = getattr(m, QF_LORA_REBUILD_ATTR, None)
    if rebuild is None or not callable(rebuild):
        raise RuntimeError(
            "QuantFunc LoRA 节点：这个 MODEL 不是 QuantFunc 原生模型——请接在 QuantFunc Native "
            "Loader 之后。（原生 ComfyUI 模型请用内置 LoraLoaderModelOnly。）")
    stack = list(getattr(m, QF_LORA_STACK_ATTR, []) or [])
    stack.extend(new_entries)
    rebuilt = rebuild(stack)
    # 把上游 Comfy 态（ModelSampling*、set_model_* 等）搬到重建后的 patcher
    return rebuilt.adopt_comfy_state_from(model)


def _parse_lora_syntax(text):
    """解析 ``<lora:name:weight>`` 多行文本，返回 [(path, strength)]。"""
    out = []
    if not text:
        return out
    pat = re.compile(r"<\s*lora\s*:\s*([^:>\s]+)(?:\s*:\s*([-+]?[\d.eE]+))?\s*>")
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = pat.search(line)
        if not m:
            continue
        name = m.group(1)
        w = float(m.group(2)) if m.group(2) else 1.0
        out.append((_resolve_lora(name), w))
    return out


def _entries_from_stack(lora_stack):
    """从 LoRA Manager 的 LORA_STACK（[(path, model_strength, clip_strength), ...]）取条目。

    LoRA Manager 的 Stacker 给出的是相对 models/loras 的路径（如
    ``krea2\\face\\xxx.safetensors``），必须先用 _resolve_lora 解析成绝对路径，
    否则后续 open() 会找不到文件（这个 bug 已在真实 workflow 里爆过）。
    """
    out = []
    if not lora_stack:
        return out
    for item in lora_stack:
        if not item:
            continue
        if isinstance(item, (list, tuple)):
            raw = item[0]
            strength = float(item[1]) if len(item) > 1 else 1.0
        else:
            raw = item
            strength = 1.0
        if not raw:
            continue
        out.append((_resolve_lora(raw), float(strength)))
    return out


def _lora_choices():
    if folder_paths is not None:
        try:
            return list(folder_paths.get_filename_list("loras")) or ["None"]
        except Exception:
            pass
    return ["None"]


def _base_choices():
    """底模下拉：列出 ComfyUI 已注册的 diffusion_models / unet 下的 .safetensors。

    kohya 格式的 LoRA 转 diffusers 时，模块名（下划线↔点号）反推需要一份「真实底模」
    当字典——QuantFunc 的 qf_lora_convert.py 用 --model 读底模的键名来做 100% 准确的反推。
    不传则退回内置词表（corpus-fitted），对 H3 这类新架构会猜错模块名、导致
    "no-module" 硬报错。所以这里把底模列出来给用户选。"""
    out = ["None"]
    seen = set(out)
    if folder_paths is not None:
        for ftype in ("diffusion_models", "unet"):
            try:
                for n in folder_paths.get_filename_list(ftype) or []:
                    if n.lower().endswith(".safetensors") and n not in seen:
                        out.append(n)
                        seen.add(n)
            except Exception:
                pass
    return out


def _resolve_checkpoint(name):
    """把底模名 / 相对路径 / 绝对路径解析成真实文件。兼容 diffusion_models 与 unet 两种注册目录。

    容错：旧工作流的 widget 错位可能把布尔等脏值（如 True）塞进来，这里一律当作「未指定底模」
    而不是抛异常——底模只是 kohya 转换的加分项，不该因为一个下拉值让整个节点跑不起来。
    """
    if not isinstance(name, str):
        return None
    name = name.strip()
    if not name or name == "None":
        return None
    if os.path.isfile(name):
        return os.path.abspath(name)
    if folder_paths is not None:
        for ftype in ("diffusion_models", "unet"):
            try:
                p = folder_paths.get_full_path(ftype, name)
                if p and os.path.isfile(p):
                    return os.path.abspath(p)
            except Exception:
                pass
    raise RuntimeError(
        "QuantFunc LoRA 节点：找不到底模文件 %s（应放在 diffusion_models 或 unet 目录，"
        "或直接给完整路径）。kohya LoRA 转换强烈建议指定底模。" % name)


class QuantFuncLoRAStackLoader:
    """批处理节点：吃 LoRA Manager 的 LORA_STACK（或 <lora:name:weight> 文本兜底），
    逐个判格式、按需转换、注入 QuantFunc 引擎。可连在原生 Loader / 其他 QuantFunc LoRA 之后链式叠加。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
            },
            "optional": {
                "lora_stack": ("LORA_STACK",),
                "lora_syntax": ("STRING", {"multiline": True, "default": "",
                                           "placeholder": "<lora:名称:权重>  每行一个，# 开头为注释"}),
                "幂等跳过": ("BOOLEAN", {"default": True}),
                # ⚠ base_model 必须排在末尾，不要往中间挪。
                # ComfyUI 工作流里 widgets_values 是「按位置」存的数组，往 widget 列表中间插入新项
                # 会让旧工作流的值整体错位——曾把「幂等跳过」的布尔 True 顶到底模下拉上，
                # 前端报 "Value not in list: base_model: True not in (...)" 并整条 prompt 被拒。
                # 放末尾则旧值各就各位，缺失的 base_model 自动走默认 "None"，旧工作流自愈。
                "base_model": (_base_choices(), {"default": "None",
                                   "tooltip": "kohya 格式 LoRA 转换所需的底模（真实 checkpoint）。"
                                              "不传会退回内置词表，H3 等新架构会猜错模块名导致 no-module 报错。"}),
            },
        }

    RETURN_TYPES = ("MODEL", "STRING")
    RETURN_NAMES = ("MODEL", "报告")
    FUNCTION = "apply"
    CATEGORY = "CZ/QuantFunc"

    def apply(self, model, lora_stack=None, lora_syntax="", base_model="None", 幂等跳过=True):
        entries = []          # 最终喂给引擎的 (path, scale) 条目
        report_lines = ["[QuantFunc LoRA 批处理]"]
        idx = 0

        # 整个批处理共享同一个底模：解析一次即可
        try:
            base_path = _resolve_checkpoint(base_model)
        except RuntimeError as e:
            raise RuntimeError("底模解析失败：%s" % e) from None
        if base_path:
            report_lines.append("底模：%s" % os.path.basename(base_path))

        # 来源 1：LoRA Manager 的 LORA_STACK
        stack_items = _entries_from_stack(lora_stack)
        # 来源 2：<lora:name:weight> 文本兜底
        text_items = _parse_lora_syntax(lora_syntax)

        for path, strength in stack_items + text_items:
            idx += 1
            try:
                final, status = _ensure_engine_lora(path, base_model_path=base_path,
                                                   force=(not 幂等跳过))
            except RuntimeError as e:
                raise RuntimeError("第 %d 个 LoRA 处理失败：%s" % (idx, e)) from None
            entries.append({"path": final, "scale": float(strength), "target": "all"})
            report_lines.append("  %d. %s — %s (scale=%.3g)"
                                % (idx, os.path.basename(final), status, float(strength)))

        if not entries:
            report_lines.append("  未添加任何 LoRA（lora_stack 与 lora_syntax 都为空）。")
            return (model, "\n".join(report_lines))

        new_model = _rebuild_with(model, entries)
        report_lines.append("合计注入 %d 个 LoRA。" % len(entries))
        return (new_model, "\n".join(report_lines))


class QuantFuncLoRAConvert:
    """单文件版本：下拉选一个 LoRA，自动判格式、按需转换，注入 QuantFunc 引擎。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "lora_name": (_lora_choices(),),
                "strength": ("FLOAT", {"default": 1.0, "min": -100.0, "max": 100.0, "step": 0.01}),
            },
            "optional": {
                "base_model": (_base_choices(), {"default": "None",
                                   "tooltip": "kohya 格式 LoRA 转换所需的底模（真实 checkpoint）。"
                                              "不传会退回内置词表，H3 等新架构会猜错模块名导致 no-module 报错。"}),
            },
        }

    RETURN_TYPES = ("MODEL", "STRING")
    RETURN_NAMES = ("MODEL", "报告")
    FUNCTION = "apply"
    CATEGORY = "CZ/QuantFunc"

    def apply(self, model, lora_name, strength, base_model="None"):
        if not lora_name or lora_name == "None":
            return (model, "[QuantFunc LoRA 单文件] 未选择 LoRA。")
        try:
            base_path = _resolve_checkpoint(base_model)
        except RuntimeError as e:
            raise RuntimeError("底模解析失败：%s" % e) from None
        path = _resolve_lora(lora_name)
        final, status = _ensure_engine_lora(path, base_model_path=base_path)
        new_model = _rebuild_with(model, [{"path": final, "scale": float(strength), "target": "all"}])
        report = ("[QuantFunc LoRA 单文件]\n  底模：%s\n  %s — %s (scale=%.3g)"
                  % (os.path.basename(base_path) if base_path else "无",
                     os.path.basename(final), status, float(strength)))
        return (new_model, report)
