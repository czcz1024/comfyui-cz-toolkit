"""H3 参考素材 / 解包 — ComfyUI V3 + 原生 Autogrow（与 T8 一致）。"""

from __future__ import annotations

from . import media_util as mdu

try:
    from comfy_api.latest import ComfyExtension, io
except ImportError:  # pragma: no cover
    ComfyExtension = None  # type: ignore
    io = None  # type: ignore

CATEGORY = "CZ/H3"
V3_AVAILABLE = io is not None and ComfyExtension is not None


def _ref_image_autogrow(display_name: str = "参考图"):
    return io.Autogrow.Input(
        "ref_images",
        optional=True,
        display_name=display_name,
        template=io.Autogrow.TemplatePrefix(
            input=io.Image.Input("ref_image"),
            prefix="ref_image_",
            min=0,
            max=9,
        ),
    )


def _ref_video_autogrow(display_name: str = "参考视频"):
    return io.Autogrow.Input(
        "ref_videos",
        optional=True,
        display_name=display_name,
        template=io.Autogrow.TemplatePrefix(
            input=io.Image.Input("ref_video", tooltip="IMAGE frame batch at 24fps."),
            prefix="ref_video_",
            min=0,
            max=3,
        ),
    )


def _ref_video_audio_autogrow(display_name: str = "参考视频音轨"):
    return io.Autogrow.Input(
        "ref_video_audios",
        optional=True,
        display_name=display_name,
        template=io.Autogrow.TemplatePrefix(
            input=io.Audio.Input("ref_video_audio"),
            prefix="ref_video_audio_",
            min=0,
            max=3,
        ),
    )


def _ref_audio_autogrow(display_name: str = "参考音频"):
    return io.Autogrow.Input(
        "ref_audios",
        optional=True,
        display_name=display_name,
        template=io.Autogrow.TemplatePrefix(
            input=io.Audio.Input("ref_audio"),
            prefix="ref_audio_",
            min=0,
            max=3,
        ),
    )


def _unpack_outputs():
    outputs = [
        io.Image.Output("first_frame", display_name="首帧图"),
        io.Image.Output("last_frame", display_name="尾帧图"),
    ]
    for i in range(mdu.MAX_REF_IMAGES):
        outputs.append(io.Image.Output(f"ref_image_{i}", display_name=f"ref_image_{i}"))
    for i in range(mdu.MAX_REF_VIDEOS):
        outputs.append(io.Image.Output(f"ref_video_{i}", display_name=f"ref_video_{i}"))
    for i in range(mdu.MAX_REF_VIDEOS):
        outputs.append(io.Audio.Output(f"ref_video_audio_{i}", display_name=f"ref_video_audio_{i}"))
    for i in range(mdu.MAX_REF_AUDIOS):
        outputs.append(io.Audio.Output(f"ref_audio_{i}", display_name=f"ref_audio_{i}"))
    return outputs


if V3_AVAILABLE:

    class H3ReferenceMedia(io.ComfyNode):
        @classmethod
        def define_schema(cls):
            return io.Schema(
                node_id="H3ReferenceMedia",
                display_name="H3 参考素材",
                description="打包官方首尾帧 + Ref2VA 素材；Autogrow 槽位与 T8/官方 Ref2VA 一致。",
                category=CATEGORY,
                inputs=[
                    io.Int.Input("image_max_side", default=1024, min=256, max=2048, step=64, display_name="图像最大边长"),
                    io.Int.Input("video_max_frames", default=4, min=1, max=16, step=1, display_name="视频最大帧数"),
                    io.Image.Input("first_frame", optional=True, display_name="首帧图"),
                    io.Image.Input("last_frame", optional=True, display_name="尾帧图"),
                    _ref_image_autogrow(),
                    _ref_video_autogrow(),
                    _ref_video_audio_autogrow(),
                    _ref_audio_autogrow(),
                ],
                outputs=[
                    io.Custom("H3_MEDIA_BUNDLE").Output("bundle", display_name="素材包"),
                ],
            )

        @classmethod
        def execute(
            cls,
            image_max_side,
            video_max_frames,
            first_frame=None,
            last_frame=None,
            ref_images=None,
            ref_videos=None,
            ref_video_audios=None,
            ref_audios=None,
            **kwargs,
        ):
            bundle = mdu.build_bundle(
                first_frame=first_frame,
                last_frame=last_frame,
                ref_images=mdu.collect_autogrow(ref_images, kwargs, "ref_image_"),
                videos=mdu.collect_autogrow(ref_videos, kwargs, "ref_video_"),
                video_audios=mdu.collect_autogrow(ref_video_audios, kwargs, "ref_video_audio_"),
                audios=mdu.collect_autogrow(ref_audios, kwargs, "ref_audio_"),
                max_side=int(image_max_side),
                max_frames=int(video_max_frames),
            )
            return io.NodeOutput(bundle)

    class H3MediaUnpack(io.ComfyNode):
        @classmethod
        def define_schema(cls):
            return io.Schema(
                node_id="H3MediaUnpack",
                display_name="H3 素材解包",
                description="按素材包内容解包；ref_image_N 与 T8/官方 Ref2VA 命名一致。",
                category=CATEGORY,
                inputs=[
                    io.Custom("H3_MEDIA_BUNDLE").Input("bundle", display_name="素材包"),
                ],
                outputs=_unpack_outputs(),
            )

        @classmethod
        def execute(cls, bundle):
            return io.NodeOutput(*mdu.unpack_bundle(bundle))

else:  # pragma: no cover
    H3ReferenceMedia = None  # type: ignore
    H3MediaUnpack = None  # type: ignore
