# ComfyUI-CZ-Toolkit

个人对 ComfyUI 的自定义改造，包含本地 LLM 推理、MiniMax H3 提示词编排、通用工具节点以及一个预览历史侧边栏。

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

---

## 节点一览

### CZ/LLM — 本地 LLM 推理

| 节点 | 说明 |
|---|---|
| **H3 模型加载器** | 加载本地 GGUF 模型（可带 mmproj 多模态、LoRA 适配器），缓存复用避免重复加载 |
| **H3 LoRA 选择器** | 从 `models/LLM` 下选 GGUF LoRA 文件，输出给模型加载器 |
| **H3 提示词生成（核心）** | 调用本地 llama_cpp 推理，生成 MiniMax H3 格式的英文提示词；支持思考模式、Qwen3 推理强度、风格预设 |
| **H3 参考素材** | 把图像/视频/音频打包成素材包（支持首尾帧 I2VA/FL2VA、Ref2VA 多参考） |
| **H3 素材解包** | 把素材包拆回各类型独立输出，连接官方或社区生视频节点 |
| **H3 提示词框（可@）** | 写 H3 提示词时用 `@` 插入 `<Picture N>` / `<Video N>` / `<Audio N>` 标记，实时显示素材缩略图 |
| **接收并编辑** | 接收上游文本后可手动修改再输出；开关控制是否用上游值覆盖 |

### 侧边栏扩展

**预览历史（CZ PreviewFeed）**

- 监听 `executed` 事件，自动收集所有节点的输出结果，包括：
  - 图片（Preview Image / Save Image）
  - 视频（AnimateDiff / VHS / WanVideo 等）
  - 音频
  - 纯文本（Show Text / Preview Text 等）
- 缩略图网格，点击打开全屏查看器
- **跟随最新**：大图打开时，队列里每完成一张自动切换；可一键切换为停留当前
- **Ctrl+Enter** 不被拦截，可直接在查看大图时按快捷键 queue 下一次生成
- 方向键 ← → 翻页，不影响后台 Canvas 节点跳转
- 支持复制文本输出

---

## 依赖

- ComfyUI（新版前端，支持 `extensionManager.registerSidebarTab`）
- llama-cpp-python（GPU 版，见安装说明）
- Pillow
- numpy

---

## 许可

MIT
