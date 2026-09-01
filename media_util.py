"""多模态素材编码与 H3 标签打包。

素材包同时保存：
- 紧凑槽位（与官方 Ref2VA 一致：跳过空位，Picture N = 第 N 张有效参考）
- llama 用的缩略图 / 抽帧 / wav
- @ 引用清单（<Picture N> / <Video N> / <Audio N>）
"""

import io
import base64
import wave

import torch
import numpy as np
from PIL import Image


PACK_SLOTS = (
    [("first_frame", "IMAGE"), ("last_frame", "IMAGE")]
    + [(f"ref_image_{i}", "IMAGE") for i in range(9)]
    + [(f"ref_video_{i}", "IMAGE") for i in range(3)]
    + [(f"ref_video_audio_{i}", "AUDIO") for i in range(3)]
    + [(f"ref_audio_{i}", "AUDIO") for i in range(3)]
)
PACK_SLOT_NAMES = [name for name, _ in PACK_SLOTS]
PACK_SLOT_TYPES = tuple(kind for _, kind in PACK_SLOTS)

# 旧工作流 / 解包兼容别名
SLOT_ALIASES = {
    "首帧图": "first_frame",
    "尾帧图": "last_frame",
}
for i in range(1, 10):
    SLOT_ALIASES[f"参考图{i}"] = f"ref_image_{i - 1}"
for i in range(1, 4):
    SLOT_ALIASES[f"参考视频{i}"] = f"ref_video_{i - 1}"
    SLOT_ALIASES[f"参考视频音轨{i}"] = f"ref_video_audio_{i - 1}"
    SLOT_ALIASES[f"参考音频{i}"] = f"ref_audio_{i - 1}"

MAX_REF_IMAGES = 9
MAX_REF_VIDEOS = 3
MAX_REF_AUDIOS = 3


def empty_bundle():
    return {
        "image_parts": [],
        "audio_parts": [],
        "reference_text": "",
        "mode_hint": "T2VA",
        "has_visual": False,
        "manifest": {"version": 1, "mode": "T2VA", "items": []},
        "slots": {},
        "active_outputs": [],
    }


def collect_sequence(values, max_count):
    """从 list / dict / Autogrow 映射顺序收集，遇空即停。兼容 ref_video_0（0-based）。"""
    if values is None:
        return []
    if isinstance(values, dict):
        values = sorted_autogrow_values(values)
    out = []
    for item in list(values or [])[:max_count]:
        if item is None:
            break
        out.append(item)
    return out


def collect_named_sequence(kwargs, prefix, max_count):
    """按 ref_image_0 / 参考图1 顺序收集，遇 None 停止。"""
    out = []
    for i in range(max_count):
        v = kwargs.get(f"{prefix}{i}")
        if v is None:
            v = kwargs.get(f"{prefix}{i + 1}")  # 旧 1-based 中文名
        if v is None:
            break
        out.append(v)
    return out


def unwrap_media(value):
    """ComfyUI 有时把单路输入包成 [value]。"""
    while isinstance(value, (list, tuple)) and len(value) == 1:
        value = value[0]
    return value


def _as_autogrow_mapping(values):
    """把 Autogrow 入参规范成 {slot_key: value}；IMAGE 张量不当可迭代拆开。"""
    if values is None:
        return {}
    if isinstance(values, dict):
        return values
    # torch.Tensor / IMAGE batch：有 shape，不能 enumerate 成帧列表当多路输入
    if hasattr(values, "shape") and not isinstance(values, (list, tuple)):
        return {"0": values}
    if isinstance(values, (list, tuple)):
        return {str(i): v for i, v in enumerate(values)}
    items = getattr(values, "items", None)
    if callable(items):
        try:
            return dict(items())
        except Exception:
            pass
    return {"0": values}


def sorted_autogrow_items(values):
    """与 T8 core.sorted_autogrow_items 相同：跳过 None，按槽位 key 排序。"""
    mapping = _as_autogrow_mapping(values)
    if not mapping:
        return []

    def sort_key(item):
        key = str(item[0])
        try:
            return int(key.rsplit("_", 1)[-1])
        except ValueError:
            return 10_000

    output = []
    for key, value in sorted(mapping.items(), key=sort_key):
        value = unwrap_media(value)
        if value is None:
            continue
        try:
            ordinal = int(str(key).rsplit("_", 1)[-1])
        except ValueError:
            ordinal = len(output)
        output.append((ordinal, value))
    return output


def sorted_autogrow_values(values):
    return [value for _, value in sorted_autogrow_items(values)]


def collect_autogrow(group, extra=None, prefix=""):
    """合并 Autogrow dict 与可能被展平的 ref_video_0 / ref_videos.ref_video_0。"""
    merged = dict(_as_autogrow_mapping(group))
    for key, value in (extra or {}).items():
        leaf = str(key).split(".")[-1]
        if not prefix or not leaf.startswith(prefix):
            continue
        suffix = leaf[len(prefix):]
        if not suffix.isdigit() or value is None:
            continue
        merged[leaf] = value
    return sorted_autogrow_values(merged)


def slots_to_autogrow(slots, prefix, max_count):
    data = {}
    for i in range(max_count):
        key = f"{prefix}{i}"
        if slots.get(key) is not None:
            data[key] = slots[key]
    return data or None


def normalize_slot_key(name):
    return SLOT_ALIASES.get(name, name)


def tensor_to_pil(tensor):
    """ComfyUI IMAGE 张量 [B,H,W,C] float(0-1) -> PIL（取首帧）。"""
    if tensor is None:
        return None
    if not hasattr(tensor, "shape"):
        return None
    arr = tensor[0].detach().cpu().numpy()
    arr = np.clip(arr, 0.0, 1.0)
    arr = (arr * 255.0).astype(np.uint8)
    return Image.fromarray(arr)


def scale_pil(pil, max_side):
    w, h = pil.size
    if max(w, h) <= max_side:
        return pil
    scale = max_side / float(max(w, h))
    return pil.resize((int(w * scale), int(h * scale)), Image.LANCZOS)


def pil_to_data_url(pil, max_side=1024):
    pil = scale_pil(pil, max_side)
    buf = io.BytesIO()
    pil.save(buf, format="JPEG", quality=90)
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/jpeg;base64,{b64}"


def sample_frames(tensor, max_frames):
    """视频张量 [B,H,W,C] -> 至多 max_frames 张 PIL（均匀抽帧）。"""
    if tensor is None or not hasattr(tensor, "shape"):
        return []
    total = int(tensor.shape[0])
    max_frames = max(1, int(max_frames))
    if total <= 0:
        return []
    if total <= max_frames:
        idxs = list(range(total))
    elif max_frames == 1:
        idxs = [0]
    else:
        idxs = [int(round(i * (total - 1) / (max_frames - 1))) for i in range(max_frames)]
    return [tensor_to_pil(tensor[i:i + 1]) for i in idxs]


def audio_to_wav_base64(audio):
    """ComfyUI AUDIO 字典 -> wav base64 字符串。"""
    if audio is None or not isinstance(audio, dict):
        return None
    waveform = audio.get("waveform")
    if waveform is None:
        return None
    sr = int(audio.get("sample_rate", 44100) or 44100)
    w = waveform[0]
    if w.dim() == 1:
        w = w.unsqueeze(0)
    channels, _ = w.shape
    pcm = (w.clamp(-1.0, 1.0).detach().cpu().numpy() * 32767.0).astype(np.int16)
    pcm = np.ascontiguousarray(pcm.T)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(int(channels))
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(pcm.tobytes())
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _is_image_tensor(value):
    return value is not None and hasattr(value, "shape") and len(getattr(value, "shape", ())) == 4


def sample_video_frames(video, max_frames):
    """从 IMAGE 帧序列张量 [B,H,W,C] 均匀抽帧，返回 PIL 列表。"""
    if video is None or not _is_image_tensor(video):
        return []
    return [pil for pil in sample_frames(video, max_frames) if pil is not None]


def _append_image_part(parts, pil, max_side):
    if pil is None:
        return
    parts.append({
        "type": "image_url",
        "image_url": {"url": pil_to_data_url(pil, max_side)},
    })


def _append_audio_part(parts, audio):
    b64 = audio_to_wav_base64(audio)
    if not b64:
        return False
    parts.append({
        "type": "input_audio",
        "input_audio": {"data": b64, "format": "wav"},
    })
    return True


def _present(values):
    return [item for item in values if item is not None]


def build_manifest_and_mode(first_frame, last_frame, ref_images, videos, video_audios, audios):
    """Picture/Video/Audio N = 有效参考的紧凑顺序号（与官方 Ref2VA / T8 一致）。"""
    items = []
    has_ref = bool(
        _present(ref_images) or _present(videos) or _present(video_audios) or _present(audios)
    )
    if has_ref:
        for index, image in enumerate(_present(ref_images), start=1):
            slot = index - 1
            items.append({
                "kind": "Picture",
                "index": index,
                "token": f"<Picture {index}>",
                "label": f"参考图{index}",
                "source_input": f"ref_image_{slot}",
            })
        for index, video in enumerate(_present(videos), start=1):
            slot = index - 1
            soundtrack = None
            if index - 1 < len(video_audios):
                soundtrack = video_audios[index - 1]
            if video is None and soundtrack is None:
                continue
            if video is not None:
                if soundtrack is not None:
                    items.append({
                        "kind": "Audio",
                        "index": index,
                        "token": f"<Audio {index}>",
                        "label": f"参考视频{index}音轨",
                        "source_input": f"ref_video_audio_{slot}",
                    })
                items.append({
                    "kind": "Video",
                    "index": index,
                    "token": f"<Video {index}>",
                    "label": f"参考视频{index}",
                    "source_input": f"ref_video_{slot}",
                })
            elif soundtrack is not None:
                items.append({
                    "kind": "Audio",
                    "index": index,
                    "token": f"<Audio {index}>",
                    "label": f"参考视频{index}音轨",
                    "source_input": f"ref_video_audio_{slot}",
                })
        for index, audio in enumerate(_present(audios), start=1):
            slot = index - 1
            items.append({
                "kind": "Audio",
                "index": index,
                "token": f"<Audio {index}>",
                "label": f"参考音频{index}",
                "source_input": f"ref_audio_{slot}",
            })
        mode = "Ref2VA" if (_present(ref_images) or _present(videos)) else "T2VA"
        return {"version": 1, "mode": mode, "items": items}, mode

    if first_frame is not None:
        items.append({
            "kind": "Picture",
            "index": 1,
            "token": "<Picture 1>",
            "label": "首帧",
            "source_input": "first_frame",
        })
    if last_frame is not None:
        index = 2 if first_frame is not None else 1
        items.append({
            "kind": "Picture",
            "index": index,
            "token": f"<Picture {index}>",
            "label": "尾帧",
            "source_input": "last_frame",
        })
    if first_frame is not None and last_frame is not None:
        mode = "FL2VA"
    elif first_frame is not None:
        mode = "I2VA"
    elif last_frame is not None:
        mode = "L2VA"
    else:
        mode = "T2VA"
    return {"version": 1, "mode": mode, "items": items}, mode


def active_output_names(slots, manifest=None):
    """解包节点应暴露的输出口；首尾帧固定，其余按实际槽位紧凑列出。"""
    slots = slots or {}
    names = ["first_frame", "last_frame"]
    for i in range(MAX_REF_IMAGES):
        key = f"ref_image_{i}"
        if slots.get(key) is not None:
            names.append(key)
        else:
            break
    for i in range(MAX_REF_VIDEOS):
        vkey = f"ref_video_{i}"
        akey = f"ref_video_audio_{i}"
        if slots.get(vkey) is not None or slots.get(akey) is not None:
            if slots.get(vkey) is not None:
                names.append(vkey)
            if slots.get(akey) is not None:
                names.append(akey)
        else:
            break
    for i in range(MAX_REF_AUDIOS):
        key = f"ref_audio_{i}"
        if slots.get(key) is not None:
            names.append(key)
        else:
            break
    return names


def build_bundle(first_frame=None, last_frame=None, ref_images=None, videos=None,
                 video_audios=None, audios=None, max_side=1024, max_frames=4):
    ref_images = collect_sequence(ref_images, MAX_REF_IMAGES)
    videos = collect_sequence(videos, MAX_REF_VIDEOS)
    video_audios = collect_sequence(video_audios, MAX_REF_VIDEOS)
    audios = collect_sequence(audios, MAX_REF_AUDIOS)

    slots = {}
    if first_frame is not None:
        slots["first_frame"] = first_frame
    if last_frame is not None:
        slots["last_frame"] = last_frame
    for i, image in enumerate(ref_images):
        slots[f"ref_image_{i}"] = image
    for i, video in enumerate(videos):
        slots[f"ref_video_{i}"] = video
    for i, audio in enumerate(video_audios):
        slots[f"ref_video_audio_{i}"] = audio
    for i, audio in enumerate(audios):
        slots[f"ref_audio_{i}"] = audio

    manifest, mode_hint = build_manifest_and_mode(
        first_frame, last_frame, ref_images, videos, video_audios, audios
    )

    image_parts = []
    audio_parts = []
    label_lines = []
    token_to_label = {item["token"]: item["label"] for item in manifest["items"]}

    if mode_hint in ("I2VA", "FL2VA", "L2VA"):
        if first_frame is not None:
            _append_image_part(image_parts, tensor_to_pil(first_frame), max_side)
            label_lines.append(f"- <Picture 1>：{token_to_label.get('<Picture 1>', '首帧')}")
        if last_frame is not None:
            token = "<Picture 2>" if first_frame is not None else "<Picture 1>"
            _append_image_part(image_parts, tensor_to_pil(last_frame), max_side)
            label_lines.append(f"- {token}：{token_to_label.get(token, '尾帧')}")
    else:
        for index, image in enumerate(ref_images, start=1):
            _append_image_part(image_parts, tensor_to_pil(image), max_side)
            label_lines.append(f"- <Picture {index}>：参考图{index}")

        for index, video in enumerate(videos, start=1):
            soundtrack = video_audios[index - 1] if index - 1 < len(video_audios) else None
            if video is None and soundtrack is None:
                continue
            if video is not None:
                frames = sample_video_frames(video, max_frames)
                for pil in frames:
                    _append_image_part(image_parts, pil, max_side)
                extra = "（已附抽帧图像，自上而下按时间顺序）" if frames else "（未能抽帧，仅保留原始视频供解包）"
                if soundtrack is not None:
                    if _append_audio_part(audio_parts, soundtrack):
                        label_lines.append(f"- <Audio {index}>：参考视频{index}音轨")
                label_lines.append(f"- <Video {index}>：参考视频{index}{extra}")
            elif soundtrack is not None:
                if _append_audio_part(audio_parts, soundtrack):
                    label_lines.append(f"- <Audio {index}>：参考视频{index}音轨")

        for index, audio in enumerate(audios, start=1):
            if _append_audio_part(audio_parts, audio):
                label_lines.append(f"- <Audio {index}>：参考音频{index}")

    has_visual = bool(image_parts)
    active_outputs = active_output_names(slots, manifest)
    return {
        "image_parts": image_parts,
        "audio_parts": audio_parts,
        "reference_text": "\n".join(label_lines),
        "mode_hint": mode_hint,
        "has_visual": has_visual,
        "manifest": manifest,
        "slots": slots,
        "active_outputs": active_outputs,
    }


def unpack_bundle(bundle):
    data = bundle if isinstance(bundle, dict) else empty_bundle()
    slots = data.get("slots") or {}
    out = []
    for name, _ in PACK_SLOTS:
        value = slots.get(name)
        if value is None:
            alias = normalize_slot_key(name)
            value = slots.get(alias)
        out.append(value)
    return tuple(out)


def bundle_media_counts(bundle):
    """返回 (图像 part 数, 音频 part 数)，供上下文预算估算。"""
    if not bundle or not isinstance(bundle, dict):
        return 0, 0
    return len(bundle.get("image_parts") or []), len(bundle.get("audio_parts") or [])


def build_llm_user_content(bundle, text, *, include_audio=True):
    """组装 llama.cpp 多模态 user message：图/音在前，文本在后。"""
    parts = []
    if bundle and isinstance(bundle, dict):
        parts.extend(bundle.get("image_parts") or [])
        if include_audio:
            parts.extend(bundle.get("audio_parts") or [])
    text = (text or "").strip()
    if text:
        parts.append({"type": "text", "text": text})
    elif not parts:
        parts.append({"type": "text", "text": ""})
    return parts
