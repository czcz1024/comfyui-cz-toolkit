# ComfyUI-CZ-Toolkit

个人对 ComfyUI 的自定义改造：本地 LLM 推理、MiniMax H3 提示词编排、文本工具节点，以及预览历史侧边栏。

详细节点说明见 **[H3节点使用说明.html](./H3节点使用说明.html)**（浏览器打开）。

---

## 安装

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/czcz1024/comfyui-cz-toolkit.git ComfyUI-CZ-Toolkit
```

安装依赖（需要 GPU 版 llama-cpp-python，见下方说明）：

```bash
pip install Pillow numpy
```

**llama-cpp-python（GPU 版）**

PyPI 版本滞后，Qwen3 等新模型需要 JamePeng 的构建版：

1. 从 [JamePeng/llama-cpp-python Releases](https://github.com/JamePeng/llama-cpp-python/releases) 下载与你的 Python / CUDA 版本匹配的 `.whl`
2. `pip install --upgrade --force-reinstall 下载的文件.whl`

**ComfyUI 版本**

- **H3 参考素材 / 素材解包** 使用 ComfyUI V3 API（`comfy_api.latest`）+ 原生 **Autogrow**，槽位命名与官方 Ref2VA / T8 一致（`ref_image_0` …）。
- 若 ComfyUI 过旧、无 V3 API，会自动回退 Legacy 媒体节点（仅首个槽位，无 Autogrow）。
- 升级插件后请 **完全重启 ComfyUI**，并 **Ctrl+F5** 硬刷新浏览器。

---

## 节点一览

### CZ/LLM — 本地 LLM 推理

| 节点 | 类名 | 说明 |
|---|---|---|
| **LLM 模型加载器** | `LLMModelLoader` | 打包 GGUF / mmproj / LoRA 参数；不占显存，真正加载在生成节点 |
| **LLM LoRA 选择器** | `LLMLoraSelector` | 从 `models/LLM` 选择 GGUF LoRA，输出给加载器 |
| **LLM 通用生成** | `LLMGenerator` | 系统提示词 + 用户消息 → 本地推理；有图才加载 mmproj；可选加载前释放 Comfy 模型 |

### CZ/H3 — MiniMax H3 提示词与素材

| 节点 | 类名 | 说明 |
|---|---|---|
| **H3 参数包装** | `H3PromptBuilder` | 组装 H3 系统提示词 + 用户消息（模式/时长/宽高/版本），不碰模型 |
| **H3 参考素材** | `H3ReferenceMedia` | Autogrow 打包首尾帧 + Ref2VA 素材（`ref_image_0` …） |
| **H3 素材解包** | `H3MediaUnpack` | 拆回官方/T8 对应口；首尾帧固定，参考类口按实际接入动态显示 |
| **H3 提示词框（可@）** | `H3PromptBox` | `@` 插入 `<Picture N>` 等标签，带素材缩略图 |

### CZ/Text — 文本工具

| 节点 | 类名 | 说明 |
|---|---|---|
| **系统提示词选择器** | `PromptSelector` | 从 `prompts/**/*.txt` 下拉选文件，输出系统提示词 |
| **多路文本选择器** | `TextSelector` | 多路 STRING 输入，每路下拉选一行，支持合并 |
| **接收并编辑** | `ReciveAndEdit` | 接收上游文本，可手动改再输出 |

### 侧边栏 — 预览历史（CZ PreviewFeed）

- 监听 `executed`，收集图片 / 视频 / 音频 / 文本输出
- 缩略图网格 + 全屏查看；**跟随最新**可开关
- **Ctrl+Enter** 不被拦截；方向键翻页不影响 Canvas

---

## 推荐接线（H3 写提示词）

```
LLM LoRA 选择器 ──→ LLM 模型加载器 ──→ LLM 通用生成
                                              ↑ 系统提示词、用户消息
H3 参考素材 ──→ H3 参数包装 ──────────────────┘
         │              ↑ 可选：PromptSelector → 额外系统提示词
         ├──→ H3 提示词框（可@）── 原始视频需求
         ├──→ LLM 通用生成（多模态素材，视觉模型必接）
         └──→ H3 素材解包 ──→ 官方 / T8 Ref2VA 节点
```

**图生 / Ref2VA 要点**

- 加载器选 **视觉 GGUF + mmproj**
- `LLMGenerator` 的 **多模态素材** 与 **用户消息** 都要接，模型才能看见图
- 解包 `ref_image_0` 等与官方 `ref_image_0` **1:1 对齐**
- `@` 菜单里 `<Picture N>` 为**紧凑顺序号**（与官方 Ref2VA / T8 一致）

---

## 依赖

- ComfyUI（新版前端，支持侧边栏扩展；媒体节点需 V3 API）
- llama-cpp-python（GPU 版，见安装说明）
- Pillow、numpy

---

## 参考与致谢

| 项目 | 作者 | 说明 |
|---|---|---|
| [ComfyUI-llama_Dapao](https://github.com/paolaoshi/ComfyUI-llama_Dapao) | paolaoshi (大炮) | 本地多模态 llama 推理架构来源 |
| [comfyui-minimax-h3-prompt-enhancer-T8](https://github.com/T8mars/comfyui-minimax-h3-prompt-enhancer-T8) | T8mars (贞贞/T8) | H3 提示词模板与风格预设参考 |
| [MiniMax-H3-Prompt-Rewriter-ComfyUI](https://github.com/pytraveler/MiniMax-H3-Prompt-Rewriter-ComfyUI) | pytraveler | H3 LoRA 重写节点设计参考 |

---

## 许可

MIT
