"""H3 提示词向导（表单）——中文表单 → 官方合规 H3 提示词。

拼装 / 校验 / 预览全部在前端 JS（web/js/h3_prompt_wizard.js）完成，
本节点 Python 端只是 7 个字段的直通壳，execute() 不做任何逻辑。
"""


class H3PromptWizard:
    """中文表单 → 官方合规 H3 提示词（纯字符串拼装，不接 LLM）。

    7 个 STRING 输出对齐 T8 增强节点的 7 个输入框：
      subject_definitions / summary / retention_analysis / detailed_description /
      integrated_multimodal_description / overall_soundscape / non_diegetic_music
    基础模式（T2VA/I2VA/FL2VA/L2VA）只填前 3 个，其余置空。
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "form_state": (
                    "STRING",
                    {
                        "multiline": True,
                        "default": "{}",
                        "tooltip": "由节点界面自动维护的表单状态 JSON，请勿手改。",
                    },
                ),
                "subject_definitions": ("STRING", {"multiline": True, "default": ""}),
                "summary": ("STRING", {"multiline": True, "default": ""}),
                "retention_analysis": ("STRING", {"multiline": True, "default": ""}),
                "detailed_description": ("STRING", {"multiline": True, "default": ""}),
                "integrated_multimodal_description": ("STRING", {"multiline": True, "default": ""}),
                "overall_soundscape": ("STRING", {"multiline": True, "default": ""}),
                "non_diegetic_music": ("STRING", {"multiline": True, "default": ""}),
            },
        }

    RETURN_TYPES = ("STRING",) * 7
    RETURN_NAMES = (
        "subject_definitions",
        "summary",
        "retention_analysis",
        "detailed_description",
        "integrated_multimodal_description",
        "overall_soundscape",
        "non_diegetic_music",
    )
    FUNCTION = "pass_through"
    CATEGORY = "CZ/H3"
    DESCRIPTION = (
        "中文表单 → 官方合规 H3 提示词。基础四模式(T2VA/I2VA/FL2VA/L2VA)输出 "
        "integrated_multimodal_description / overall_soundscape / non_diegetic_music 三字段；"
        "Ref2VA 六段式二期开放。"
    )

    def pass_through(self, **kwargs):
        return (
            str(kwargs.get("subject_definitions") or ""),
            str(kwargs.get("summary") or ""),
            str(kwargs.get("retention_analysis") or ""),
            str(kwargs.get("detailed_description") or ""),
            str(kwargs.get("integrated_multimodal_description") or ""),
            str(kwargs.get("overall_soundscape") or ""),
            str(kwargs.get("non_diegetic_music") or ""),
        )
