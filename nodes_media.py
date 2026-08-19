"""H3 参考素材打包 / 解包。

打包：官方 Image to Video（首尾帧）+ Reference to Video（参考图/视频/音轨/音频）槽位并集。
解包：原样拆回对应类型，接到官方或社区生视频节点，效果等同直接接线。
"""

from . import media_util as mdu


class H3ReferenceMedia:
    """把图片/视频/音频打包成 H3 素材包，供提示词框、llama 生成、解包共用。"""

    @classmethod
    def INPUT_TYPES(cls):
        req = {
            "图像最大边长": ("INT", {"default": 1024, "min": 256, "max": 2048, "step": 64}),
            "视频最大帧数": ("INT", {"default": 4, "min": 1, "max": 16, "step": 1}),
        }
        opt = {
            "首帧图": ("IMAGE",),
            "尾帧图": ("IMAGE",),
        }
        for i in range(1, 10):
            opt[f"参考图{i}"] = ("IMAGE",)
        for i in range(1, 4):
            opt[f"参考视频{i}"] = ("IMAGE",)
            opt[f"参考视频音轨{i}"] = ("AUDIO",)
            opt[f"参考音频{i}"] = ("AUDIO",)
        return {"required": req, "optional": opt}

    RETURN_TYPES = ("H3_MEDIA_BUNDLE",)
    RETURN_NAMES = ("素材包",)
    FUNCTION = "build"
    CATEGORY = "CZ/H3"
    DESCRIPTION = "打包官方首尾帧 + Ref2VA 素材；输出给提示词框 / llama / 解包节点。"

    def build(self, 图像最大边长, 视频最大帧数, **kwargs):
        bundle = mdu.build_bundle(
            first_frame=kwargs.get("首帧图"),
            last_frame=kwargs.get("尾帧图"),
            ref_images=[kwargs.get(f"参考图{i}") for i in range(1, 10)],
            videos=[kwargs.get(f"参考视频{i}") for i in range(1, 4)],
            video_audios=[kwargs.get(f"参考视频音轨{i}") for i in range(1, 4)],
            audios=[kwargs.get(f"参考音频{i}") for i in range(1, 4)],
            max_side=int(图像最大边长),
            max_frames=int(视频最大帧数),
        )
        return (bundle,)


class H3MediaUnpack:
    """把素材包拆回官方对应类型的独立输出口。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "素材包": ("H3_MEDIA_BUNDLE",),
            }
        }

    RETURN_TYPES = mdu.PACK_SLOT_TYPES
    RETURN_NAMES = tuple(mdu.PACK_SLOT_NAMES)
    FUNCTION = "unpack"
    CATEGORY = "CZ/H3"
    DESCRIPTION = "原样透传打包时的图/视频/音频，接到官方或社区 H3 生视频节点。"

    def unpack(self, 素材包):
        return mdu.unpack_bundle(素材包)
