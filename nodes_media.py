"""H3 参考素材打包 / 解包（Legacy 回退，无 comfy_api 时使用）。"""

from . import media_util as mdu


class H3ReferenceMedia:
    @classmethod
    def INPUT_TYPES(cls):
        req = {
            "图像最大边长": ("INT", {"default": 1024, "min": 256, "max": 2048, "step": 64}),
            "视频最大帧数": ("INT", {"default": 4, "min": 1, "max": 16, "step": 1}),
        }
        opt = {
            "first_frame": ("IMAGE",),
            "last_frame": ("IMAGE",),
            "ref_image_0": ("IMAGE",),
            "ref_video_0": ("IMAGE",),
            "ref_video_audio_0": ("AUDIO",),
            "ref_audio_0": ("AUDIO",),
        }
        return {"required": req, "optional": opt}

    RETURN_TYPES = ("H3_MEDIA_BUNDLE",)
    RETURN_NAMES = ("素材包",)
    FUNCTION = "build"
    CATEGORY = "CZ/H3"
    DESCRIPTION = "Legacy 回退：请升级 ComfyUI 以使用 T8 同款 Autogrow。"

    @classmethod
    def VALIDATE_INPUTS(cls, **kwargs):
        return True

    def build(self, 图像最大边长, 视频最大帧数, **kwargs):
        bundle = mdu.build_bundle(
            first_frame=kwargs.get("first_frame"),
            last_frame=kwargs.get("last_frame"),
            ref_images=mdu.collect_named_sequence(kwargs, "ref_image_", mdu.MAX_REF_IMAGES),
            videos=mdu.collect_named_sequence(kwargs, "ref_video_", mdu.MAX_REF_VIDEOS),
            video_audios=mdu.collect_named_sequence(kwargs, "ref_video_audio_", mdu.MAX_REF_VIDEOS),
            audios=mdu.collect_named_sequence(kwargs, "ref_audio_", mdu.MAX_REF_AUDIOS),
            max_side=int(图像最大边长),
            max_frames=int(视频最大帧数),
        )
        return (bundle,)


class H3MediaUnpack:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"素材包": ("H3_MEDIA_BUNDLE",)}}

    RETURN_TYPES = mdu.PACK_SLOT_TYPES
    RETURN_NAMES = tuple(mdu.PACK_SLOT_NAMES)
    FUNCTION = "unpack"
    CATEGORY = "CZ/H3"
    DESCRIPTION = "Legacy 回退解包。"

    def unpack(self, 素材包):
        return mdu.unpack_bundle(素材包)
