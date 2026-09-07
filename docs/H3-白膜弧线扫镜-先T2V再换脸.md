# H3：白膜弧线扫镜四人 → 先 T2V 再换脸

> 目的：记录本需求、已踩坑、工具对比结论，以及当前认定的主方案（先 15s 一镜 T2V 锁结构，再 rv2v 换脸）。  
> 环境：家用 **4090 24GB / 64GB 内存**；编排曾试 Easy-Media / TimelineDirector / MiniMaxH3 Director。  
> 记录日期：2026-09-07  

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

按约 3s 一窗切（与扫镜时段对齐），每窗 **少挂脸**：

| 时间窗（约） | 画面 | 挂脸 |
|--------------|------|------|
| 0–3s | 最右特写 D | 只挂 D |
| 3–6s | C 特写（可含半脸过渡） | 主挂 C；过渡窗必要时只挂当前主脸 |
| 6–9s | B 特写 | 只挂 B |
| 9–12s | A 特写 | 只挂 A |
| 12–15s | 四人广角同框 | **再挂四张**（A/B/C/D） |

- 挂图顺序与扫镜一致：先最右脸（D），再 C、B、A；广角段四张。  
- 半脸过渡不要硬切到「刚好对半」；切在某一侧已占主导的帧附近更稳。  
- 各窗成片再按时间拼回；结构遍已锁机位/衣服/场景/乐，拼回主要对齐时间轴即可。

---

## 5. 实施检查清单

结构遍（T2V）

- [ ] 时长约 15s，一镜，无切镜标记  
- [ ] 同一场景写死；四人女性；姿势左→右 1–4；扫镜右→左  
- [ ] 衣服提示词完整（无服装参考图）  
- [ ] 配乐写在 `non_diegetic_music`，贯穿全片  
- [ ] 0.4MP 单采先跑通；确认本机 15s T2V 稳定  

换脸遍（rv2v）

- [ ] 源片为结构遍成片  
- [ ] **按时间窗分段换脸**；不采用整段一次挂 4 脸  
- [ ] 特写窗只挂当前主脸；广角窗再挂四张  
- [ ] 人脸图与 A/B/C/D（及扫镜时段）对应正确  
- [ ] 提示词禁止强保源片面部  
- [ ] 检查衣服/场景是否被第二遍带跑  
- [ ] 各窗拼回后检查过渡帧身份是否串脸 

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
