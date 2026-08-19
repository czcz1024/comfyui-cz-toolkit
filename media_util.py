"""多模态素材编码与 H3 标签打包。

素材包同时保存：
- 原始槽位（解包后接到官方/社区 H3 节点，效果等同直接接线）
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
    [("首帧图", "IMAGE"), ("尾帧图", "IMAGE")]
    + [(f"参考图{i}", "IMAGE") for i in range(1, 10)]
    + [(f"参考视频{i}", "IMAGE") for i in range(1, 4)]
    + [(f"参考视频音轨{i}", "AUDIO") for i in range(1, 4)]
    + [(f"参考音频{i}", "AUDIO") for i in range(1, 4)]
)
PACK_SLOT_NAMES = [name for name, _ in PACK_SLOTS]
PACK_SLOT_TYPES = tuple(kind for _, kind in PACK_SLOTS)


def empty_bundle():
    return {
        "image_parts": [],
        "audio_parts": [],
        "reference_text": "",
        "mode_hint": "T2VA",
        "has_visual": False,
        "manifest": {"version": 1, "mode": "T2VA", "items": []},
        "slots": {name: None for name in PACK_SLOT_NAMES},
    }


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
    """编号规则与提示词框 @ 菜单一致：两套口不混编。"""
    items = []
    has_ref = bool(_present(ref_images) or _present(videos) or _present(video_audios) or _present(audios))
    if has_ref:
        pic_n = 0
        for slot, image in enumerate(ref_images, start=1):
            if image is None:
                continue
            pic_n += 1
            items.append({
                "kind": "Picture",
                "index": pic_n,
                "token": f"<Picture {pic_n}>",
                "label": f"参考图{slot}",
                "source_input": f"参考图{slot}",
            })
        audio_n = 0
        vid_n = 0
        for slot, video in enumerate(videos, start=1):
            soundtrack = video_audios[slot - 1] if slot - 1 < len(video_audios) else None
            if video is None and soundtrack is None:
                continue
            if video is not None:
                vid_n += 1
                if soundtrack is not None:
                    audio_n += 1
                    items.append({
                        "kind": "Audio",
                        "index": audio_n,
                        "token": f"<Audio {audio_n}>",
                        "label": f"参考视频{slot}音轨",
                        "source_input": f"参考视频音轨{slot}",
                    })
                items.append({
                    "kind": "Video",
                    "index": vid_n,
                    "token": f"<Video {vid_n}>",
                    "label": f"参考视频{slot}",
                    "source_input": f"参考视频{slot}",
                })
            elif soundtrack is not None:
                audio_n += 1
                items.append({
                    "kind": "Audio",
                    "index": audio_n,
                    "token": f"<Audio {audio_n}>",
                    "label": f"参考视频{slot}音轨",
                    "source_input": f"参考视频音轨{slot}",
                })
        for slot, audio in enumerate(audios, start=1):
            if audio is None:
                continue
            audio_n += 1
            items.append({
                "kind": "Audio",
                "index": audio_n,
                "token": f"<Audio {audio_n}>",
                "label": f"参考音频{slot}",
                "source_input": f"参考音频{slot}",
            })
        mode = "Ref2VA" if (_present(ref_images) or _present(videos)) else "T2VA"
        return {"version": 1, "mode": mode, "items": items}, mode

    if first_frame is not None:
        items.append({
            "kind": "Picture",
            "index": 1,
            "token": "<Picture 1>",
            "label": "首帧",
            "source_input": "首帧图",
        })
    if last_frame is not None:
        index = 2 if first_frame is not None else 1
        items.append({
            "kind": "Picture",
            "index": index,
            "token": f"<Picture {index}>",
            "label": "尾帧",
            "source_input": "尾帧图",
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


def build_bundle(first_frame=None, last_frame=None, ref_images=None, videos=None,
                 video_audios=None, audios=None, max_side=1024, max_frames=4):
    ref_images = list(ref_images or [])[:9]
    videos = list(videos or [])[:3]
    video_audios = list(video_audios or [])[:3]
    audios = list(audios or [])[:3]
    ref_images += [None] * (9 - len(ref_images))
    videos += [None] * (3 - len(videos))
    video_audios += [None] * (3 - len(video_audios))
    audios += [None] * (3 - len(audios))

    slots = {name: None for name in PACK_SLOT_NAMES}
    slots["首帧图"] = first_frame
    slots["尾帧图"] = last_frame
    for i in range(9):
        slots[f"参考图{i + 1}"] = ref_images[i]
    for i in range(3):
        slots[f"参考视频{i + 1}"] = videos[i]
        slots[f"参考视频音轨{i + 1}"] = video_audios[i]
        slots[f"参考音频{i + 1}"] = audios[i]

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
        pic_n = 0
        for slot, image in enumerate(ref_images, start=1):
            if image is None:
                continue
            pic_n += 1
            _append_image_part(image_parts, tensor_to_pil(image), max_side)
            label_lines.append(f"- <Picture {pic_n}>：参考图{slot}")

        vid_n = 0
        audio_n = 0
        for slot, video in enumerate(videos, start=1):
            soundtrack = video_audios[slot - 1]
            if video is None and soundtrack is None:
                continue
            if video is not None:
                vid_n += 1
                frames = sample_video_frames(video, max_frames)
                for pil in frames:
                    _append_image_part(image_parts, pil, max_side)
                extra = "（已附抽帧图像，自上而下按时间顺序）" if frames else "（未能抽帧，仅保留原始视频供解包）"
                if soundtrack is not None:
                    audio_n += 1
                    if _append_audio_part(audio_parts, soundtrack):
                        label_lines.append(f"- <Audio {audio_n}>：参考视频{slot}音轨")
                    else:
                        audio_n -= 1
                label_lines.append(f"- <Video {vid_n}>：参考视频{slot}{extra}")
            elif soundtrack is not None:
                audio_n += 1
                if _append_audio_part(audio_parts, soundtrack):
                    label_lines.append(f"- <Audio {audio_n}>：参考视频{slot}音轨")
                else:
                    audio_n -= 1

        for slot, audio in enumerate(audios, start=1):
            if audio is None:
                continue
            if _append_audio_part(audio_parts, audio):
                audio_n += 1
                label_lines.append(f"- <Audio {audio_n}>：参考音频{slot}")

    has_visual = bool(image_parts)
    return {
        "image_parts": image_parts,
        "audio_parts": audio_parts,
        "reference_text": "\n".join(label_lines),
        "mode_hint": mode_hint,
        "has_visual": has_visual,
        "manifest": manifest,
        "slots": slots,
    }


def unpack_bundle(bundle):
    data = bundle if isinstance(bundle, dict) else empty_bundle()
    slots = data.get("slots") or {}
    return tuple(slots.get(name) for name in PACK_SLOT_NAMES)
