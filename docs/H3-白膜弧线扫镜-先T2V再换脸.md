# H3：白膜弧线扫镜四人 → 先 T2V 再换脸

> 目的：记录本需求、已踩坑、工具对比结论，以及当前认定的主方案（先 15s 一镜 T2V 锁结构，再换脸）。  
> 环境：家用 **4090 24GB / 64GB 内存**；编排曾试 Easy-Media / TimelineDirector / MiniMaxH3 Director。  
> 记录日期：2026-09-07；换脸实操定稿补记 **2026-09-08**（见 §4.5）。  

---

## 1. 需求（目标成片）

### 1.1 画面

- Blender **白膜**已做出调度参考：四人站成微弧，**摄像机带弧度从右向左**依次扫脸特写，最后拉远四人同框。
- 扫镜过程会出现 **半脸 + 半脸** 的过渡帧（正常，不应当成硬切点）。
- 总长约 **15s**：每人特写约 **3s** × 4，远景约 **3s**。
- **一镜到底、不切镜**（结构遍）；四人皆为 **成年女性**。
- 姿势（**从左到右**）：
  1. 双手持枪，平举，瞄准前方  
  2. 双手持枪，下垂身前  
  3. 双手持枪，枪口向上，举在脸旁  
  4. **单手**持枪，平举，瞄准前方  
- 参考图：**只有人脸，无衣服** → 衣服必须靠提示词写死，且跨段/两遍一致。
- 服装方向：偏性感、可持枪站桩（见文末附录当前定稿）。

### 1.2 声音

- 需要 **约 15s 连续感背景音乐**。
- 用户侧 **没有现成 BGM**，希望由 **H3 生成**（不是锁外部音轨）。

### 1.3 身份

- 最终四人脸要换成指定参考脸。
- 结构遍可接受「临时脸」；身份放在第二遍。

---

## 2. 约束与现象

| 项 | 说明 |
|----|------|
| 显存 | **0.7MP + 二采** 基本跑不动；**0.4 单采** 可跑 |
| 长参考 | 「4 脸图 + 整段白膜 + 约 15s」一次进条件太重 |
| 参考强度 | 视频参考写强（如 `fully_preserved`）→ 运镜好但 **白膜材质渗出**；写弱 → 白膜少了，**运镜也丢** |
| 多段 | 无视频只靠提示词 → **控不住弧线机位**；有视频但整段 15s 挂每段 → 又重又易污染 |
| 段间背景 | 每段只挂脸、场景靠模型编 → 易出现 **段 1/段 2 完全换景** |
| 生成配乐 | H3 **按段采样**，很难得到像成品一样一条 master 配乐；context 只能尽量续声 |
| 整段换脸 | 15s **一次挂 4 张脸**不可靠：半脸过渡无硬绑定，易串身份 → 应按时间窗挂脸（见 §4.4） |

---

## 3. 尝试过、效果不好的做法

### 3.1 单遍：15s + 多参考硬扛

- 4 张脸 + 整段白膜一次生成。  
- 结果：卡、显存/内存顶满；4090 上不现实作为主路径。

### 3.2 Easy-Media：多段 R2V（脸 + 白膜同时进）

排法曾对齐为：

- 任务轨 5 段 R2V（约 3s × 5）  
- 视频轨白膜 **切成与任务对齐的 5 段**（不要整条 15s 挂每段）  
- 段 1 `shot`，段 2–5 `context`（扫镜换人 **不用** `context_swap`）  
- 无外部 BGM → **不锁音频**，靠 context + 提示词续配乐  

仍突出的问题：

- 运镜强弱与白膜污染是一根绳两端。  
- 半脸过渡处硬切会接不上；即便 context，**环境仍易漂**。  
- 只有脸图时衣服/场景全靠文案，多段一致性差。  
- Easy-Media Project 的 dual / context 像素域重建等，比官方单段更吃资源（另见对话中的实现对比，不在此展开）。

### 3.3 其它编排包（对照，非主路径）

| 包 | 和本需求的关系 |
|----|----------------|
| **Easy-Media** | 多轨 + 项目落盘/选片强；锁 BGM 方便，但用户要的是 **H3 生成乐**；R2V 多段同时锁脸+白膜易翻车 |
| **TimelineDirector** | 青色 GEN 框只有一个；多段靠「素材分段 + 有限分段展开/采样」，不是多个框；长链合并偏吃内存；无选片/单段重跑弱 |
| **MiniMaxH3 Director** | r2v 素材组清晰；**r2v 不会像 Easy-Media 视频轨那样自动按窗裁白膜**，短白膜多需自切；v2v/rv2v 偏改源片 |

任务类型选择结论（改脸结构片之前）：

- 要「白膜管机位、图管脸」→ 偏 **r2v**，不是 v2v/rv2v。  
- v2v/rv2v 更像改源片，白膜外观更容易被保真抄进去。

---

## 4. 当前主方案：先 T2V，再换脸

### 4.1 为何改方案

用户确认：**15s T2V 跑得动**。  
因此不必在「第一遍」就同时死磕四张脸 + 白膜 + 多段接缝。

| 遍 | 目标 | 做法 |
|----|------|------|
| **1. 结构遍** | 同一场景、一镜弧线、姿势/衣服、连续感配乐 | **一条 15s T2V**（可不挂脸；可选弱白膜只助运镜） |
| **2. 身份遍** | 换成指定女性脸 | 底片作源 → **rv2v**（源片 + 人脸图）；保运镜/身体/衣服/场景/乐，**只换脸** |

优点：

- 场景与运镜在一遍里连续，减轻「段间换背景」。  
- 配乐更可能一条龙（相对多段生成音）。  
- 换脸与结构解耦，提示词打架少。  

注意：

- 两遍耗时约为近两倍。  
- rv2v 是 H3「参考改视频」，不是专用换脸插件，脸会好很多但不保证像素级贴合。  
- 第二遍勿把源片脸 `fully_preserved` 抄回去；写清面部以 Picture 为准。

### 4.2 结构遍提示词要点（T2VA）

- 字段：`integrated_multimodal_description` / `overall_soundscape` / `non_diegetic_music`  
- **只有 `[Shot 1]`**，用 `From 00:00… to 00:03…` 写时间推进，**不要** `[Shot 2]` 切镜  
- 扫镜顺序（摄像机从右往左）：**D → C → B → A**，再拉远  
- 左→右站位：**A B C D**（姿势见 §1.1）  
- 明确 **four armed adult women**、同一仓库场景句贯穿  

### 4.3 结构遍完整提示词（定稿，可直接粘贴）

> 模式：文生 / T2VA；时长约 15s；本遍**不挂人脸图**。可选另挂弱白膜仅助运镜（非本提示词必填）。

```text
integrated_multimodal_description:
[Shot 1] The target video is a single continuous live-action take with no cuts, in a cool desaturated cinematic look inside one consistent cold concrete warehouse corridor with simple pillars, matte grey floor, and soft overhead practicals; shallow depth of field on faces during the move, then deeper focus on the wide end. Four armed adult women stand in a shallow arc facing camera-left-of-forward, left to right as <Subject A>, <Subject B>, <Subject C>, and <Subject D>, and they remain in the same place for the whole shot. <Subject A> (leftmost) wears a fitted black leather crop jacket worn open over a low-cut black bodysuit, with high-waisted black slim pants and heeled ankle boots; she holds a pistol with both hands, arms extended level, aiming forward. <Subject B> wears a snug olive satin blouse with the top buttons undone and sleeves rolled, tucked into dark high-rise skinny jeans with a slim belt; she holds a pistol with both hands hanging down in front of the body, muzzle lowered. <Subject C> wears a cropped navy hoodie zipped only halfway over a black sports-bra top, with dark cargo pants sitting low on the hips and a tactical harness strap across the torso; she holds a pistol with both hands, muzzle pointed upward, gun raised beside the face. <Subject D> (rightmost) wears a tailored charcoal blazer worn closed with nothing but a deep plunging black lace camisole beneath, paired with a short black pencil skirt and sheer black tights; she holds a pistol in one hand only, arm extended level, aiming forward. From 00:00.000 to 00:03.000, a close-up trucks left at moderate speed with small-to-medium amplitude along a matching slight arc, first framing <Subject D> clearly. From 00:03.000 to 00:06.000, the same unbroken truck continues left onto <Subject C>, with brief transitional frames that may show adjacent half-faces. From 00:06.000 to 00:09.000, it continues onto <Subject B> the same way. From 00:09.000 to 00:12.000, it continues onto leftmost <Subject A>. From 00:12.000 to 00:15.000, without cutting, the camera pulls back to a wide frame that holds all four women in the arc, each keeping the exact outfit and pistol pose above, still in the same warehouse. No dialogue.

overall_soundscape:
Quiet warehouse air tone with soft cloth and grip handling under the music; no hard silence resets.

non_diegetic_music:
A continuous dark cinematic underscore with low pulses and soft synth pads, steady tempo, no vocals, playing unbroken from the first frame to the last.
```

时间轴对照：

| 时间 | 画面 |
|------|------|
| 0–3s | 特写最右 D（单手平举） |
| 3–6s | 继续左扫到 C（枪口朝上举脸旁） |
| 6–9s | 继续到 B（双手枪下垂） |
| 9–12s | 继续到最左 A（双手平举） |
| 12–15s | 不切镜拉远，四人同框 |

### 4.4 换脸遍要点（rv2v）

- 源：结构遍成片  
- 文案：保留机位、身体、衣服、场景、音乐；仅替换面部身份  

#### 不推荐：整段 15s 一次挂 4 张脸

- 扫镜有 **半脸 + 半脸** 过渡；参考脸与画面人物 **没有按像素/时间的硬绑定**。  
- 一窗同时挂 4 张脸时，模型容易在过渡帧把身份 **串到错误一侧**，或广角前几人脸混用。  
- 结论：**整段一次换脸不可靠**，不要当主路径。

#### 推荐：按时间窗分段换脸

按约 3s 一窗切（与扫镜时段对齐），每窗 **少挂脸**。切点、挂图、参数与提示词定稿见 **§4.5**。

| 时间窗（约） | 画面 | 挂脸 |
|--------------|------|------|
| 段1 | 最右特写 D | 只挂 D |
| 段2 | C 特写 | 只挂 C |
| 段3 | B 特写 | 只挂 B |
| 段4 | A 特写 | 只挂 A |
| 段5 | 四人广角同框 | 挂四张 A/B/C/D |

- 段与段 **首尾相接，中间不留空**；半脸过渡落在某一段内部，不要切在对半正中。  
- 切点要 **偏晚**：下一主角已明显占主导（约 70%+），上一人只剩画幅边缘一条。  
- Easy-Media 上用 **v2v** + **`context_swap`** + **锁定结构成片视频轨**，不要用结构遍那套弱参考 r2v。

### 4.5 Easy-Media 换脸遍实操定稿（2026-09-08）

> 前提：结构遍 15s T2VA 已跑通，运镜符合要求。本遍只换脸。  
> 站位左→右 A B C D；摄像机右→左扫：D → C → B → A → 拉远。

#### 4.5.1 半脸怎么切（原则）

```text
开场 ── 正特写 ── 邻人刚露边 ── 对半 ── 下一主已主导、上一人只剩边 ── 正特写 …
                                      ↑ 建议切点（偏晚）
                              ↑ 不要切这里
```

- **不要**切在两人各一半。  
- **不要**切在「下一人刚露出一点点」（上一人还很大时挂下一张脸，容易把上一人也换掉）。  
- **要**切在类似：C 已完整占主导，D 只在右侧剩一条边（用户已确认的示意）。  
- D→C、C→B、B→A 三段过渡用同一规则。  
- 时间轴连续铺满，**中间不空一段**；空了反而要补洞。

#### 4.5.2 五段：切到哪儿、挂什么图

时长以结构成片为准（约 3s×4 + 3s 远景）；下表「约」秒数为参照，**以画面主导关系为准微调**。

| 段 | 源片裁切（怎么认切点） | 挂参考图 | 任务目标 |
|----|------------------------|----------|----------|
| **1** | 从开场 → 到 **C 已占主导、D 只剩右边缘**（含该帧或紧前一帧） | **只挂 D** | 换最右人特写脸 |
| **2** | 从段1切点 **下一帧接着** → 到 **B 已占主导、C 只剩右边缘** | **只挂 C** | 换第三人特写脸 |
| **3** | 从段2切点接着 → 到 **A 已占主导、B 只剩右边缘** | **只挂 B** | 换第二人特写脸 |
| **4** | 从段3切点接着 → 到 **明显开始拉远 / 四人将同框之前**（A 仍为主或刚开始变宽） | **只挂 A** | 换最左人特写脸 |
| **5** | 从拉远开始 → 片尾（四人同框） | **挂四张：A、B、C、D**（顺序与站位一致更清晰） | 广角四人脸对齐 |

说明：

- 「4+5」：特写扫完四人用段1–4；远景单独段5，**只有段5 才挂四张脸**（段4 不要提前挂四张）。  
- 视频轨：优先 **整条结构成片铺满并锁定**；任务窗吃重叠部分。若坚持外切短片，短片起止必须与上表切点一致，且仍锁定/按源片编辑，勿当弱参考。  
- 智能切成「一大段特写 + 一段全景」**不要用**：大特写段仍要四张脸，显存与串脸问题会回来。

#### 4.5.3 Easy-Media / Project 参数

| 项 | 设置 |
|----|------|
| 任务类型 | 每段 **v2v**（视频编辑；有脸图时实际为 vi2v）。**不要**用 r2v（弱参考会丢运镜） |
| 衔接 | 五段均为 **`context_swap`**（角色替换上下文）。不要用 `context`（偏保原身份） |
| 视频轨 | 结构遍成片；轨道 **`audio_locked: true`（锁定）**，让源片驱动时间线/运镜/尽量保留配乐 |
| 分辨率 | 4090：优先 **0.4MP 单采**；二采按本机能力 |
| 只跑一段试 | Project：`segment_start_number = 1`，`segment_count = 1`；确认后再 `2,1` … |
| `project_save` | 试跑可用 `new` 对比；定稿可 `override` |
| 工作流串法 | `多轨编辑器 → 多轨提示词增强到项目（可选）→ 多轨项目` |

结构遍 vs 身份遍（勿混用）：

| | 结构遍 | 换脸遍 |
|--|--------|--------|
| 视频 | 弱参考 / 可不挂 | **源片，强保运镜** |
| 典型任务 | t2v / r2v（白膜） | **v2v** |
| 衔接 | 扫镜多用 context | **context_swap** |

#### 4.5.4 各段用户提示词（可直接粘贴）

每段任务里，该段挂的脸图即为本段的 `<Picture 1>`（段5 为 `<Picture 1>`…`<Picture 4>` 对应 A/B/C/D）。  
短中文可交给 LLM 扩写，但 **「强保 Video、只换主脸、边缘邻脸不动」不可删**。

**段1（挂 D）**

```text
Edit the source video. Fully preserve camera truck/pan from right toward left, framing, body pose, clothing, scene, lighting, and music from the source.
Replace only the face of the primary subject who is mainly framed (the woman currently dominating the close-up) with the face from <Picture 1>.
Do not keep the source video face identity for that primary subject.
If a second person begins to appear at the left edge near the end, leave that edge face unchanged; do not replace it with <Picture 1>.
```

**段2（挂 C）**

```text
Continue editing the same unbroken source take. Fully preserve the ongoing leftward camera move, framing, body, clothing, scene, lighting, and music from the source.
Replace only the face of the primary subject now dominating the frame with the face from <Picture 1>.
Do not keep the source face identity for that primary subject.
If a remnant of the previous person remains on the right edge at the start, keep that edge face as in the source; do not turn it into <Picture 1>.
Near the end, if the next person appears only at the left edge, leave that edge face unchanged.
```

**段3（挂 B）**

```text
Continue editing the same unbroken source take. Fully preserve the ongoing leftward camera move, framing, body, clothing, scene, lighting, and music from the source.
Replace only the face of the primary subject now dominating the frame with the face from <Picture 1>.
Do not keep the source face identity for that primary subject.
If a remnant of the previous person remains on the right edge at the start, keep that edge face as in the source; do not turn it into <Picture 1>.
Near the end, if the next person appears only at the left edge, leave that edge face unchanged.
```

**段4（挂 A）**

```text
Continue editing the same unbroken source take. Fully preserve the ongoing leftward camera move, framing, body, clothing, scene, lighting, and music from the source.
Replace only the face of the primary subject now dominating the frame (leftmost woman in the arc) with the face from <Picture 1>.
Do not keep the source face identity for that primary subject.
If a remnant of the previous person remains on the right edge at the start, keep that edge face as in the source; do not turn it into <Picture 1>.
Do not pull back to a wide four-shot in this segment; keep the close-up / near-close framing of the source for this window.
```

**段5（挂 A、B、C、D 四张）**

```text
Edit the source video wide ending. Fully preserve the pull-back camera move, the four-woman arc staging, bodies, outfits, warehouse scene, lighting, and music from the source.
Replace the four faces to match the reference pictures: leftmost <Picture 1> (A), then <Picture 2> (B), <Picture 3> (C), rightmost <Picture 4> (D).
Do not keep the source face identities. Do not change clothing, poses, or camera path.
```

中文意图备忘（扩写用，勿只留一句「换成图1」）：

- 保源片运镜/身体/衣服/场景/乐；只换当前主脸。  
- 画幅边缘邻脸保持源片，不要改成当前 Picture。  
- 禁止强保源片面部身份。

#### 4.5.5 用 LLM 自动写提示词（可选）

不必手动拷回：可一次排队串进工作流。

```text
多轨编辑器.TRACKS_INFO
  → 多轨提示词增强到项目（easy multitrackPromptEnhanceToProject）
  → TRACKS_INFO（已写回）
  → 多轨项目
```

| 项 | 说明 |
|----|------|
| 节点 | `easy multitrackPromptEnhanceToProject`（多轨提示词增强到项目） |
| 本地模型口 | 需另装 **ComfyUI-llama-cpp_vlm**，接其 `llama_cpp_instruct_adv` / Llama-cpp Model Loader |
| 插件地址 | https://github.com/lihaoyun6/ComfyUI-llama-cpp_vlm |
| 增强范围 | 「增强到项目」为 **纯文本** 逐段增强；不自动拿视频帧做视觉反推 |
| 单段增强器 | `easy multiTrackPromptEnhancer` 可接 Task Output 的图/视频，但 **不自动写回**；要全自动写回用「增强到项目」 |
| Easy-Use | **无**内置 llama.cpp 调用；仅可能注册模型目录 |
| CZ-Toolkit LLM | 可接 Task Output 的系统/用户 **STRING** 做纯文本扩写；多模态要 `H3_MEDIA_BUNDLE`，与 Task Output 图列表不直接兼容 |
| 内置系统提示词 | MiniMax 格式下是给 LLM 的写法指南；**MultiTrack Project 直接生成时真正进模型的是用户提示词** |

编辑器里用户提示词可先写短意图，但须含「保运镜、只换主脸、边缘不换」；再交给增强器扩写。

---

## 5. 实施检查清单

结构遍（T2V）

- [ ] 时长约 15s，一镜，无切镜标记  
- [ ] 同一场景写死；四人女性；姿势左→右 1–4；扫镜右→左  
- [ ] 衣服提示词完整（无服装参考图）  
- [ ] 配乐写在 `non_diegetic_music`，贯穿全片  
- [ ] 0.4MP 单采先跑通；确认本机 15s T2V 稳定  

换脸遍（Easy-Media v2v，见 §4.5）

- [ ] 源片为结构遍成片；视频轨 **锁定**  
- [ ] 任务类型 **v2v**；衔接全程 **`context_swap`**  
- [ ] 五段首尾相接无空隙；切点 **偏晚**（下一主已主导，上一人只剩边）  
- [ ] 段1–4 各只挂一张脸（D→C→B→A）；段5 挂四张  
- [ ] 不用智能切「一大段特写+全景」；不用整段一次四脸；不用 r2v 弱参考换脸  
- [ ] 提示词：强保运镜/身体/衣服/场景；只换主脸；边缘邻脸不换；禁止强保源片脸  
- [ ] 先 `segment_count=1` 跑通段1再往后  
- [ ] 可选：增强到项目 + [llama-cpp_vlm](https://github.com/lihaoyun6/ComfyUI-llama-cpp_vlm)  
- [ ] 拼回/成片后检查过渡帧是否串脸、衣服场景是否被带跑  

---

## 6. 附录：当前服装定稿（偏性感、可持枪）

从左到右：

| 人 | 服装 | 姿势 |
|----|------|------|
| A 最左 | 敞开黑皮短夹克 + 低领黑连体衣 + 高腰黑裤 + 高跟短靴 | 双手平举瞄准 |
| B | 修身橄榄缎面衬衫（领口解开）+ 高腰紧身深牛仔 | 双手枪下垂身前 |
| C | 半拉藏青短款卫衣 + 黑运动内衣式上装 + 低腰工装裤 + 战术背带 | 双手枪口朝上举脸旁 |
| D 最右 | 炭灰修身西装外套 + 深 V 黑蕾丝吊带 + 黑色短裙 + 黑丝 | 单手平举瞄准 |

英文服装短语以 §4.3 提示词正文为准。

---

## 7. 后续可选项（未采纳为主路径）

- 结构遍也挂 **弱白膜** 只控机位（若纯 T2V 弧线不够稳）。  
- 结构遍仍多段 + context（仅当单条 15s 偶发不稳时回退）。  
- 外部 BGM 锁轨（用户当前明确要 H3 出乐，故不作主方案）。  

---

## 8. 观察记录

| 日期 | 备注 |
|------|------|
| 2026-09-07 | 整理本文；主方案定为 15s T2V → rv2v 换脸；用户确认 15s T2V 可跑。 |
| 2026-09-07 | 纳入结构遍完整英文 T2V 提示词（女性 + 偏性感服装 + 一镜到底）。 |
| 2026-09-07 | 换脸：整段一次挂 4 脸不可靠；改为按时间窗分段挂脸（特写单脸、广角四脸）。 |
| 2026-09-08 | 结构遍 T2VA 运镜已通。Easy-Media 换脸踩坑：整段四脸跑不动；短片+r2v/弱参考丢运镜；未锁视频轨/用 context 导致参考乱、段1出全景。 |
| 2026-09-08 | 定稿 §4.5：v2v + context_swap + 锁视频轨；切点偏晚；段1–4 单脸、段5 四脸；英文提示词；LLM 用增强到项目，依赖 https://github.com/lihaoyun6/ComfyUI-llama-cpp_vlm 。 |
