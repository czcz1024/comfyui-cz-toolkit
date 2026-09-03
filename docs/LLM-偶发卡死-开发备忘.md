# LLM 偶发卡死 — 现象、结论与后续开发备忘

> 目的：把「本地 Qwen 生成偶发 GPU 空转、只能杀 ComfyUI」这件事的调查、已做改动、**未证实的根因** 和后续切口写清楚，方便对照新日志继续改。  
> 节点：`LLMModelLoader` / `LLMGenerator`（`nodes_loader.py`、`nodes_llm_generator.py`、`models_util.py`）  
> 记录日期：2026-09-03（后续观察请在文末「观察记录」追加）

**本文不是结案报告。** 卡死本身尚未从 llama.cpp/CUDA 上禁掉；已做的是减诱发、方便对照日志。

---

## 1. 原始现象（用户描述）

- 模型：Qwen3.8（进程内 `llama-cpp-python` / JamePeng），家用 **4090 24GB**。
- 输入：纯文本，**不接图**；加载器 **思考模式关闭**；「Qwen3.8推理强度」常为 **自动**。
- 工作流：LLM 改提示词 → 接续生图或生视频；LLM 上开着 **推理后卸载**。
- 行为：同一提示词多数几次几秒内结束；**偶发** GPU 一直忙、节点不结束。
- 取消：ComfyUI「结束任务」**停不了**，只能杀整个 ComfyUI 进程。
- 规律：**刚重启 ComfyUI 后第一次几乎不出现**；完整跑过一轮「LLM → 生图/视频」再排队、又从 LLM 开始时更容易撞上。卡死时 GPU 在转，像已经过了加载、卡在推理。

---

## 2. 已排除 / 弱相关

| 猜测 | 为何不太像 |
|------|------------|
| 思考把 token 吃光、看起来像卡住 | 思考模式关着时 `qwen38_thinking_active` 为 False，`max_tokens` 即「最终答案token」。4090 上跑满 2048 通常几十秒会停，不像必须杀进程。 |
| LLM「完成后卸载」没卸干净导致下一发 KV/hybrid 还在 | 卸载发生在 **本次 LLM 成功结束之后**。卡在 `create_chat_completion` 里时卸载根本不会跑。成功路径会 `Llama.close()`，下一发应是新实例。 |
| 显存 OOM | 一般会报加载失败，不是 GPU 空转永不返回。 |
| 加载器节点比生成节点先知道「有没有图」 | Comfy 倒着选要跑的节点，**顺着**先跑上游。有没有图只有生成节点执行时才知道。 |

「自动」在代码里映射为 `xhigh`（与「高」相同），思考关着仍会把 `reasoning_effort=xhigh` 塞进聊天模板。最多是加重因子，**不像必须杀进程的主因**。

---

## 3. 当前最吻合的因果（未用调用栈证实）

**主因倾向：同一进程里 llama.cpp CUDA 与 Comfy/PyTorch 生图抢 GPU。**

1. llama.cpp **不走** `model_management` 加载路径。Comfy **不会**因为 llama 显存不够去卸 Checkpoint/视频模型。
2. 第一发：卡干净，LLM 正常；卸 LLM 后生图/视频占上显存，Comfy **默认驻留**这些权重。
3. 第二发 LLM：`Llama(...)` 在 **碎片化、已被 PyTorch 占过的 CUDA** 上跑 Qwen3.8（架构 `qwen35`，混合注意力 + MTP/NextN）。偶发 prefill/decode **kernel 不返回**，GPU 仍忙，Python 回不来。
4. 结束任务只设 Python 中断标志，**没有**接到 llama 的 `abort_callback`，所以取消无效。这是卡死后的体验问题，不是用户最在意的「别卡」。

次要诱发（改代码前更明显）：

- 加载器立刻按 UI 挂 **mmproj**，纯文本也走多模态 handler。
- 进程内反复复用同一 `Llama` 时 hybrid/KV 变脏（用户开卸载后这条变弱）。

独立 `llama-server`（T8 主路径）生成质量和权重显存与对齐参数后的进程内方案 **基本同一量级**；它的优势是 **另一进程、可杀子进程、躲开 PyTorch 显存池**。CZ 未切到 server，避免重写运行时。

---

## 4. 已落地的代码（按时间）

### 4.1 流式进度 + 生成前清 KV

- 提交意图：避免「慢跑但界面没字」被误判成卡死；中断后再跑时清 hybrid/KV。
- `LLMGenerator`：`stream=True`，控制台打 tok/s；生成前后 `clear_kv_cache`。
- **不阻止** 当次 CUDA 假死；假死时往往 **一个 token 都没有**。

### 4.2 延迟加载 + 无图不挂 mmproj

- **加载器**只产出句柄 + 路径检查，**不** `Llama(...)`。
- **生成节点**根据本次输入决定 `use_mmproj`：有图，或 mmproj 元数据支持音频且本次有音频，才挂 mmproj；无图且音频会被忽略 → 纯文本加载。
- 缓存：已加载带 mmproj 的实例，下一枪纯文本 **复用、不降级重载**。
- 「推理后卸载」仍在生成结束时 `unload()`。
- 加载失败报在生成节点。

关键日志：

- `本次无图像且无可用音频，不加载 mmproj`
- `模型已加载: ... mmproj=None` 或 `复用已加载模型`

### 4.3 加载前释放 Comfy 模型（开关 + 阈值）

llama 不会在显存不够时让 Comfy 自动腾位，所以要 **可选、主动卸**。

| 控件 | 默认 | 行为 |
|------|------|------|
| `⚡加载前释放Comfy模型` | 关 | 开了才考虑卸生图/视频等 Comfy 模型 |
| `释放阈值GB` | 20 | 空闲显存 **低于** 该值才 `unload_all_models` + `soft_empty_cache`；**-1** = 开关开了就卸 |

实现：`models_util.release_comfy_models_if_needed`，在 `load_model` **之前**调用。

日志：

- `空闲显存约 X GB ≥ 阈值，跳过释放`
- `已释放 Comfy 模型，给 LLM 腾显存`

与 `⚡推理后卸载模型` 方向相反：一个卸 Comfy 给 LLM，一个卸 LLM 给后面生图。LLM→生图→再 LLM 时建议 **两个都开**，阈值 4090 上先用 20。

---

## 5. 明确没做（下一轮候选）

按「别卡死」优先，不是「卡了能取消」优先：

1. 思考关着时模板强制 `reasoning_effort=off`，不要传 `xhigh`。
2. 加载 llama 时关掉易诱发 hybrid 假死的路径（CUDA graph / MTP，需对照当前 JamePeng API）。
3. `Llama.close()` / 清 KV 失败打日志，不要静默 `pass`。
4. `_reraise_model_load_error`：`Failed to load model from file` 被一律说成显存不足，会盖掉 `unknown model architecture: 'qwen3vl'` 等真因。
5. `abort_callback` + 墙钟超时：改善取消，**不保证不卡**。
6. 可选 `llama-server` 后端：隔离 CUDA；工作量大，仅当 4.3 验证后仍卡再考虑。

无显卡机器：JamePeng 当前几乎没有 CPU 专用 wheel；架构不支持时（如旧后端 + `qwen3vl`）与卡死无关。

---

## 6. 晚上对照实验（请把控制台贴回）

环境：4090，拉最新代码，**完全重启** ComfyUI。生成节点：释放 Comfy **开**、阈值 **20**、推理后卸载 **开**；纯文本不接图。

| 步骤 | 期望 |
|------|------|
| 重启后第一次只跑 LLM | 可能跳过释放；`mmproj=None`；几秒出结果 |
| 同一工作流跑完生图/视频后再排队 | 第二次 LLM 前应「已释放 Comfy 模型」 |
| 仍假死 | 见下节分类 |

**假死分类（决定下一刀砍哪）：**

| 日志 | 含义 | 下一刀 |
|------|------|--------|
| 有「已释放」+ 已加载，停在「开始生成」、无 tok/s | 释放后仍卡在 prefill/CUDA | 关 MTP/graph、关模板 xhigh、或 llama 版本 |
| 第二次仍跳过释放，然后卡 | 阈值太低或 `get_free_memory` 偏大 | 降阈值或改 -1 |
| 有 tok/s 一直涨到 max_tokens | 不是假死 | 查思考/上限 |
| 第一次重启就卡 | 不像 PyTorch 残留 | 纯 llama/qwen35 问题 |

请记下：是否释放、mmproj、思考=True/False、卡在哪一行、大概等了多久、`nvidia-smi` 是否一直满载。

---

## 7. 关键代码入口

| 点 | 位置 |
|----|------|
| 延迟加载 / 缓存是否挂 mmproj | `load_model(..., use_mmproj=)` |
| 句柄侧是否支持音频（不先加载） | `handle_supports_audio` |
| 释放 Comfy | `release_comfy_models_if_needed` |
| 流式生成 | `_run_chat_completion` |
| 思考是否开启 | `qwen38_thinking_active`；「自动」→ `xhigh` 见 `_QWEN38_REASONING_VALUES` |

---

## 8. 观察记录（以后往这里追加）

### 2026-09-03

- 代码：延迟 mmproj、加载前释放 Comfy（默认关，阈值 20）已提交 GitHub。
- 实机：4090 上尚未用本开关对照验证卡死是否减少。

### （模板）

- 日期：
- 开关 / 阈值 / 是否推理后卸载：
- 第几次排队、中间有没有生图/视频：
- 控制台关键行（复制）：
- 结果：正常 / 假死（无 token） / 假死（有过 token）
- 结论或下一步：
