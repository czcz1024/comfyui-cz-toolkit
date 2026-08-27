/**
 * 图形化 FACS AU 选脸器 v2
 * - 每个 AU 有强度 0–5（对应 FACS A–E；0=无）
 * - 预制表情使用文献常用 AU 组合 + 强度
 * - 输出英文自然语言（H3）；AU 代号仅作备忘
 */
(function (global) {
  const INTENSITY_LABEL = ["无", "微(A)", "轻(B)", "中(C)", "强(D)", "极(E)"];
  const INTENSITY_EN = ["", "slightly", "lightly", "moderately", "strongly", "maximally"];

  /** 常用可动画面部 AU（含头部朝向部分） */
  const AU_DEFS = [
    { id: "AU1", zh: "内眉上提", en: "inner brows raised", group: "眉" },
    { id: "AU2", zh: "外眉上提", en: "outer brows raised", group: "眉" },
    { id: "AU4", zh: "皱眉下压", en: "brows lowered and drawn together", group: "眉" },
    { id: "AU5", zh: "上眼睑上提", en: "upper eyelids raised", group: "眼" },
    { id: "AU6", zh: "提颊（眼轮匝）", en: "cheeks raised", group: "眼" },
    { id: "AU7", zh: "眼睑收紧", en: "eyelids tightened", group: "眼" },
    { id: "AU9", zh: "皱鼻", en: "nose wrinkled", group: "鼻" },
    { id: "AU10", zh: "上唇上提", en: "upper lip raised", group: "嘴" },
    { id: "AU11", zh: "鼻唇沟加深", en: "nasolabial furrows deepened", group: "嘴" },
    { id: "AU12", zh: "嘴角上扬", en: "lip corners pulled up", group: "嘴" },
    { id: "AU13", zh: "尖嘴角上提", en: "sharp lip-corner pull", group: "嘴" },
    { id: "AU14", zh: "酒窝/嘴角收紧", en: "dimplers / lip corners tightened", group: "嘴" },
    { id: "AU15", zh: "嘴角下压", en: "lip corners pulled down", group: "嘴" },
    { id: "AU16", zh: "下唇下压", en: "lower lip depressed", group: "嘴" },
    { id: "AU17", zh: "下巴上提", en: "chin raised", group: "嘴" },
    { id: "AU18", zh: "噘嘴", en: "lips puckered", group: "嘴" },
    { id: "AU20", zh: "唇横向拉伸", en: "lips stretched sideways", group: "嘴" },
    { id: "AU22", zh: "唇漏斗状", en: "lips funneled", group: "嘴" },
    { id: "AU23", zh: "嘴唇收紧", en: "lips tightened", group: "嘴" },
    { id: "AU24", zh: "嘴唇紧抿", en: "lips pressed together", group: "嘴" },
    { id: "AU25", zh: "双唇分开", en: "lips parted", group: "嘴" },
    { id: "AU26", zh: "下颌下落", en: "jaw dropped", group: "嘴" },
    { id: "AU27", zh: "张大嘴", en: "mouth stretched wide open", group: "嘴" },
    { id: "AU28", zh: "吸唇", en: "lips sucked in", group: "嘴" },
    { id: "AU41", zh: "眼睑下垂", en: "upper lids drooping", group: "眼" },
    { id: "AU42", zh: "眯成缝", en: "eyes narrowed to slits", group: "眼" },
    { id: "AU43", zh: "闭眼", en: "eyes closed", group: "眼" },
    { id: "AU44", zh: "挤眼", en: "eyes squinted", group: "眼" },
    { id: "AU45", zh: "眨眼", en: "blinking", group: "眼" },
    { id: "AU46", zh: "单眨眼(右)", en: "winking with the right eye", group: "眼" },
    { id: "AU51", zh: "头左转", en: "head turned left", group: "头" },
    { id: "AU52", zh: "头右转", en: "head turned right", group: "头" },
    { id: "AU53", zh: "抬头", en: "head tilted up", group: "头" },
    { id: "AU54", zh: "低头", en: "head tilted down", group: "头" },
    { id: "AU55", zh: "头左倾", en: "head tilted left", group: "头" },
    { id: "AU56", zh: "头右倾", en: "head tilted right", group: "头" },
  ];

  /**
   * 预制表情
   * cat: basic=基本情绪 | drama=文戏复合 | tech=口型辅助
   * 复合项参考 EMFACS 混码 + 表演常用「内心外化」组合（示意夸张，可再调强度）
   */
  const PRESETS = [
    // —— 基本情绪 ——
    { zh: "微笑(开心)", cat: "basic", tip: "真笑 Duchenne: AU6+AU12", map: { AU6: 4, AU12: 5 } },
    { zh: "轻笑", cat: "basic", tip: "轻 AU12", map: { AU12: 2 } },
    { zh: "大笑", cat: "basic", tip: "AU6+AU12+开口", map: { AU6: 5, AU12: 5, AU25: 4, AU26: 4 } },
    { zh: "悲伤", cat: "basic", tip: "AU1+AU4+AU15", map: { AU1: 4, AU4: 3, AU15: 5 } },
    { zh: "惊讶", cat: "basic", tip: "眉全抬+瞪眼+落颌", map: { AU1: 5, AU2: 5, AU5: 5, AU26: 4 } },
    { zh: "恐惧", cat: "basic", tip: "眉内提并拢+瞪眼+唇横拉", map: { AU1: 4, AU2: 3, AU4: 3, AU5: 5, AU20: 5, AU26: 3 } },
    { zh: "愤怒", cat: "basic", tip: "眉下压+紧睑+紧唇", map: { AU4: 5, AU5: 4, AU7: 4, AU23: 4 } },
    { zh: "厌恶", cat: "basic", tip: "皱鼻+上唇上提", map: { AU9: 5, AU10: 5, AU25: 3 } },
    { zh: "轻蔑", cat: "basic", tip: "单侧 AU14 冷笑", map: { AU14: 5 } },

    // —— 文戏复合：难直说的内心 ——
    { zh: "礼节假笑", cat: "drama", tip: "社交笑：只有嘴角、无提颊（非真开心）", map: { AU12: 3 } },
    { zh: "强颜欢笑", cat: "drama", tip: "嘴在笑、眉眼仍悲：AU12 + AU1/AU15", map: { AU12: 4, AU1: 3, AU15: 2 } },
    { zh: "含泪微笑", cat: "drama", tip: "苦乐交加：真笑痕迹 + 悲眉 + 下撇", map: { AU6: 2, AU12: 3, AU1: 4, AU4: 2, AU15: 3 } },
    { zh: "忍住哭", cat: "drama", tip: "泪在眼眶：斜眉 + 下巴顶住 + 紧抿", map: { AU1: 4, AU4: 3, AU17: 4, AU24: 4, AU7: 2 } },
    { zh: "欲言又止", cat: "drama", tip: "话到嘴边咽回去：微启又抿 + 内眉轻提", map: { AU1: 2, AU25: 2, AU24: 3, AU17: 2 } },
    { zh: "压抑怒火", cat: "drama", tip: "表面平静、下压眉与紧唇泄露怒", map: { AU4: 3, AU7: 3, AU23: 4, AU24: 3 } },
    { zh: "冷笑", cat: "drama", tip: "轻蔑+单侧上扬，带刺", map: { AU14: 4, AU10: 2 } },
    { zh: "讥讽笑", cat: "drama", tip: "笑里藏刀：嘴角笑 + 单侧收紧", map: { AU12: 3, AU14: 4 } },
    { zh: "尴尬笑", cat: "drama", tip: "讪笑：浅笑 + 紧唇 + 略低头", map: { AU12: 2, AU24: 3, AU1: 2, AU54: 3 } },
    { zh: "羞愧", cat: "drama", tip: "不敢抬眼：低头 + 内眉 + 抿唇 + 眼睑沉", map: { AU54: 4, AU1: 3, AU24: 3, AU41: 3 } },
    { zh: "愧疚", cat: "drama", tip: "歉疚自责：悲眉 + 下撇 + 微低头", map: { AU1: 4, AU4: 2, AU15: 3, AU54: 2 } },
    { zh: "紧张焦虑", cat: "drama", tip: "心虚发慌：眉形不稳 + 眼睑紧张 + 唇横绷", map: { AU1: 3, AU2: 2, AU4: 2, AU5: 3, AU7: 2, AU20: 3 } },
    { zh: "警惕怀疑", cat: "drama", tip: "打量对方：微皱眉 + 紧睑盯视", map: { AU4: 3, AU7: 4, AU5: 2 } },
    { zh: "失望", cat: "drama", tip: "心沉下去：内眉 + 嘴角下 + 眼皮沉", map: { AU1: 3, AU15: 4, AU41: 3 } },
    { zh: "无奈苦笑", cat: "drama", tip: "拿你没办法：浅笑与下撇同时在", map: { AU12: 2, AU15: 3, AU1: 2, AU41: 2 } },
    { zh: "心疼不忍", cat: "drama", tip: "看对方受苦：斜眉 + 轻蹙 + 微下撇", map: { AU1: 4, AU4: 2, AU15: 2, AU7: 2 } },
    { zh: "柔情", cat: "drama", tip: "温软爱意：浅提颊浅笑 + 眼睑柔", map: { AU6: 2, AU12: 3, AU43: 2, AU7: 1 } },
    { zh: "恳求", cat: "drama", tip: "求你：眉上扬恳求形 + 微下撇 + 睁眼", map: { AU1: 4, AU2: 2, AU5: 3, AU15: 2 } },
    { zh: "倔强不服", cat: "drama", tip: "嘴硬：皱眉 + 下巴顶起 + 抿紧", map: { AU4: 4, AU17: 4, AU24: 4 } },
    { zh: "错愕难以置信", cat: "drama", tip: "惊讶里带皱眉：不是单纯吃惊", map: { AU1: 4, AU2: 4, AU4: 2, AU5: 4, AU26: 3 } },
    { zh: "惊恐压抑", cat: "drama", tip: "怕但不肯叫出：恐惧眉眼 + 死死抿唇", map: { AU1: 3, AU2: 2, AU4: 3, AU5: 4, AU20: 3, AU24: 4 } },
    { zh: "嫌恶克制", cat: "drama", tip: "恶心但要体面：轻皱鼻 + 抿住上唇冲动", map: { AU9: 3, AU10: 2, AU24: 3, AU7: 2 } },
    { zh: "算计冷眼", cat: "drama", tip: "心里打鼓、脸上淡：紧睑 + 单侧收 + 微眯", map: { AU7: 3, AU14: 3, AU41: 2, AU4: 1 } },
    { zh: "疲惫倦怠", cat: "drama", tip: "心累：眼皮沉 + 轻下撇 + 微低头", map: { AU41: 4, AU15: 2, AU54: 2, AU1: 1 } },
    { zh: "释然", cat: "drama", tip: "松一口气：眉眼松开 + 浅笑", map: { AU12: 2, AU43: 2, AU6: 1 } },
    { zh: "痛楚隐忍", cat: "drama", tip: "身体/心里疼但不喊：蹙眉皱鼻 + 顶颌抿唇", map: { AU4: 4, AU9: 2, AU17: 4, AU24: 4, AU7: 3 } },
    { zh: "慌乱", cat: "drama", tip: "方寸大乱：高眉瞪眼 + 唇绷 + 微张", map: { AU1: 4, AU2: 4, AU5: 4, AU20: 3, AU26: 2 } },
    { zh: "挑衅", cat: "drama", tip: "故意惹你：皱眉瞪视 + 一侧嘴角", map: { AU4: 3, AU5: 3, AU14: 4 } },
    { zh: "失神恍惚", cat: "drama", tip: "魂不在焉：眼睑沉 + 唇微启", map: { AU41: 4, AU25: 2, AU5: 1 } },
    { zh: "矛盾纠结", cat: "drama", tip: "又想又怕：悲眉与浅笑、下撇同时在", map: { AU1: 3, AU4: 3, AU12: 2, AU15: 3 } },
    { zh: "嫉妒酸意", cat: "drama", tip: "不是单纯怒：皱眉 + 轻蔑侧嘴 + 紧唇", map: { AU4: 3, AU14: 3, AU7: 2, AU23: 2 } },
    { zh: "心动羞涩", cat: "drama", tip: "喜欢但害臊：浅笑 + 微低头 + 眼柔", map: { AU12: 3, AU6: 2, AU54: 2, AU43: 2 } },
    { zh: "决意咬牙", cat: "drama", tip: "横下一条心：眉压 + 咬肌感紧唇 + 顶颌", map: { AU4: 3, AU23: 4, AU17: 3, AU7: 2 } },
    { zh: "心虚回避", cat: "drama", tip: "说谎/隐瞒：目光下沉 + 假浅笑 + 紧唇", map: { AU54: 3, AU12: 2, AU24: 2, AU1: 2 } },
    { zh: "感动欲泣", cat: "drama", tip: "被打动：内眉上提 + 轻笑 + 顶住下巴", map: { AU1: 4, AU6: 2, AU12: 2, AU17: 3, AU7: 2 } },

    // —— 口型辅助 ——
    { zh: "紧抿", cat: "tech", tip: "AU23+AU24", map: { AU23: 4, AU24: 4 } },
    { zh: "微张待言", cat: "tech", tip: "话要出口：双唇分开", map: { AU25: 3 } },
    { zh: "张颌开口", cat: "tech", tip: "落颌开口（可叠表情）", map: { AU26: 4 } },
    { zh: "清空", cat: "tech", tip: "全部强度归零", map: {} },
  ];

  const PRESET_CAT_LABEL = {
    basic: "基本情绪",
    drama: "文戏复合（内心）",
    tech: "口型 / 清空",
  };

  /** @type {Record<string, number>} AU id → 0..5 */
  let intensities = {};
  let targetShotId = null;
  let onInsert = null;

  function level(id) {
    return Math.max(0, Math.min(5, Number(intensities[id]) || 0));
  }

  function setLevel(id, v) {
    v = Math.max(0, Math.min(5, Number(v) || 0));
    if (v <= 0) delete intensities[id];
    else intensities[id] = v;
  }

  function activeList() {
    return AU_DEFS.filter((a) => level(a.id) > 0);
  }

  function faceHostHtml() {
    return `<div class="au-face-stage" id="au-face-stage">
      <canvas id="au-face-canvas" width="280" height="320" aria-hidden="true"></canvas>
    </div>
    <div class="au-face-caption" id="au-face-caption">示意脸 · 夸张可读，非写实</div>`;
  }

  function matchedPresetName() {
    const keys = Object.keys(intensities);
    if (!keys.length) return "中性";
    for (const p of PRESETS) {
      if (p.zh === "清空") continue;
      const mk = Object.keys(p.map);
      if (mk.length !== keys.length) continue;
      if (mk.every((k) => intensities[k] === p.map[k])) return p.zh;
    }
    return "自定义";
  }

  function ensureFaceHost() {
    const host = document.getElementById("au-face-host");
    if (!host) return null;
    if (!document.getElementById("au-face-canvas")) {
      host.innerHTML = faceHostHtml();
    }
    return document.getElementById("au-face-canvas");
  }

  /** Canvas 夸张示意：优先让基本情绪一眼可辨 */
  function applyFace() {
    const canvas = ensureFaceHost();
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width;
    const H = canvas.height;
    const t = (id) => level(id) / 5;

    const yaw = (t("AU52") - t("AU51")) * 42;
    const pitch = (t("AU53") - t("AU54")) * 28;
    const roll = (t("AU56") - t("AU55")) * 22;
    const stage = document.getElementById("au-face-stage");
    if (stage) {
      stage.style.transform = `perspective(520px) rotateY(${yaw}deg) rotateX(${pitch}deg) rotateZ(${roll}deg)`;
    }
    const cap = document.getElementById("au-face-caption");
    if (cap) cap.textContent = `示意：${matchedPresetName()} · 夸张可读`;

    ctx.clearRect(0, 0, W, H);
    ctx.save();
    // 轻微随 pitch/yaw 平移五官，增强立体感
    ctx.translate(yaw * 0.35, -pitch * 0.45);

    const cx = W / 2;
    const cy = 148;
    const hx = 86;
    const hy = 108;

    // 头
    const skin = ctx.createRadialGradient(cx - 20, cy - 40, 20, cx, cy, 120);
    skin.addColorStop(0, "#f6d7bc");
    skin.addColorStop(1, "#c9956e");
    ctx.beginPath();
    ctx.ellipse(cx, cy, hx, hy, 0, 0, Math.PI * 2);
    ctx.fillStyle = skin;
    ctx.fill();
    ctx.strokeStyle = "#8a6a4a";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 愤怒/用力：脸颊潮红
    const angerFlush = Math.max(t("AU4") * 0.35, t("AU23") * 0.2);
    if (angerFlush > 0.05) {
      ctx.fillStyle = `rgba(200,60,50,${0.12 + angerFlush * 0.25})`;
      ctx.beginPath();
      ctx.ellipse(cx - 48, cy + 10, 22, 16, 0, 0, Math.PI * 2);
      ctx.ellipse(cx + 48, cy + 10, 22, 16, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // 提颊腮红
    if (t("AU6") > 0) {
      const op = 0.18 + t("AU6") * 0.45;
      const by = cy + 8 - t("AU6") * 10;
      ctx.fillStyle = `rgba(232,120,110,${op})`;
      ctx.beginPath();
      ctx.ellipse(cx - 52, by, 18 + t("AU6") * 6, 12, 0, 0, Math.PI * 2);
      ctx.ellipse(cx + 52, by, 18 + t("AU6") * 6, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      // 鱼尾纹
      ctx.strokeStyle = `rgba(120,70,50,${0.25 + t("AU6") * 0.4})`;
      ctx.lineWidth = 1.2;
      [-1, 1].forEach((side) => {
        const ex = cx + side * 58;
        const ey = cy - 18;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.moveTo(ex, ey + i * 4);
          ctx.quadraticCurveTo(ex + side * 10, ey + i * 4 + 2, ex + side * 16, ey + i * 4 - 2);
          ctx.stroke();
        }
      });
    }

    // —— 眉（情绪关键特征）——
    // AU1 内眉上、AU2 外眉上、AU4 下压并拢
    const drawBrow = (side) => {
      const s = side; // -1 left, +1 right
      const baseInnerX = cx + s * 12;
      const baseOuterX = cx + s * 58;
      const baseY = cy - 52;
      const innerY =
        baseY - t("AU1") * 22 - t("AU2") * 6 + t("AU4") * 18;
      const outerY =
        baseY - t("AU2") * 20 - t("AU1") * 4 + t("AU4") * 10;
      const pullIn = t("AU4") * 14; // 并拢
      const innerX = baseInnerX - s * pullIn;
      const outerX = baseOuterX;
      const midX = (innerX + outerX) / 2;
      // 恐惧/悲伤：内高外低；愤怒：内低外略高；惊讶：整体抬高拱起
      const midY = Math.min(innerY, outerY) - t("AU2") * 6 - t("AU1") * 4 + t("AU4") * 2;

      ctx.strokeStyle = "#3a281c";
      ctx.lineWidth = 5.5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(innerX, innerY);
      ctx.quadraticCurveTo(midX, midY - 4, outerX, outerY);
      ctx.stroke();
    };
    drawBrow(-1);
    drawBrow(1);

    // 眉间竖纹（愤怒 AU4）
    if (t("AU4") > 0.2) {
      ctx.strokeStyle = `rgba(90,50,40,${0.35 + t("AU4") * 0.5})`;
      ctx.lineWidth = 1.5;
      const gx = cx;
      const gy = cy - 58 + t("AU4") * 8;
      ctx.beginPath();
      ctx.moveTo(gx - 4, gy - 8);
      ctx.lineTo(gx - 2, gy + 10);
      ctx.moveTo(gx + 4, gy - 8);
      ctx.lineTo(gx + 2, gy + 10);
      ctx.stroke();
    }

    // —— 眼 ——
    const drawEye = (side, closeExtra) => {
      const ex = cx + side * 36;
      const ey = cy - 28;
      let rx = 16 + t("AU5") * 4 - t("AU7") * 2;
      let ry =
        10 +
        t("AU5") * 10 -
        t("AU7") * 7 -
        t("AU6") * 3 -
        t("AU41") * 6 -
        t("AU42") * 7 -
        t("AU44") * 5;
      if (t("AU43") > 0.15 || t("AU45") > 0.45) {
        ry = Math.min(ry, 1.5);
      }
      ry *= 1 - closeExtra;
      ry = Math.max(1.2, Math.min(20, ry));
      rx = Math.max(8, rx);

      if (ry < 2.2) {
        ctx.strokeStyle = "#3a281c";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(ex - rx, ey);
        ctx.quadraticCurveTo(ex, ey + 2, ex + rx, ey);
        ctx.stroke();
        return;
      }

      ctx.beginPath();
      ctx.ellipse(ex, ey, rx, ry, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.strokeStyle = "#5a4030";
      ctx.lineWidth = 1.2;
      ctx.stroke();

      const irisR = Math.min(rx * 0.55, ry * 0.75, 7);
      ctx.beginPath();
      ctx.arc(ex, ey + t("AU7") * 1.5, irisR, 0, Math.PI * 2);
      ctx.fillStyle = "#2a1c14";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ex - 1.5, ey - 1 + t("AU7") * 1.5, 2, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();

      // 下眼睑紧张 AU7
      if (t("AU7") > 0.2) {
        ctx.strokeStyle = `rgba(80,40,30,${0.4 + t("AU7") * 0.4})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(ex - rx * 0.85, ey + ry * 0.55);
        ctx.quadraticCurveTo(ex, ey + ry * 0.95, ex + rx * 0.85, ey + ry * 0.55);
        ctx.stroke();
      }
    };
    drawEye(-1, 0);
    drawEye(1, t("AU46") > 0.2 ? t("AU46") : 0);

    // —— 鼻 + 厌恶皱鼻 ——
    const nz = t("AU9");
    ctx.fillStyle = nz > 0 ? "#c07a5a" : "#c9956e";
    ctx.strokeStyle = "#8a6a4a";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 18 - nz * 4);
    ctx.lineTo(cx - 12 - nz * 6, cy + 18 + nz * 4);
    ctx.quadraticCurveTo(cx, cy + 26 + nz * 6, cx + 12 + nz * 6, cy + 18 + nz * 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    if (nz > 0.15) {
      ctx.strokeStyle = `rgba(90,45,35,${0.35 + nz * 0.5})`;
      ctx.lineWidth = 1.6;
      for (let i = 0; i < 3; i++) {
        const yy = cy - 6 + i * 7;
        ctx.beginPath();
        ctx.moveTo(cx - 16 - nz * 4, yy);
        ctx.quadraticCurveTo(cx, yy - 3 - nz * 2, cx + 16 + nz * 4, yy);
        ctx.stroke();
      }
    }

    // 鼻唇沟 AU11 / 微笑
    const nlf = Math.max(t("AU11"), t("AU12") * 0.55, t("AU10") * 0.4);
    if (nlf > 0.1) {
      ctx.strokeStyle = `rgba(120,70,55,${0.2 + nlf * 0.45})`;
      ctx.lineWidth = 1.5;
      [-1, 1].forEach((s) => {
        ctx.beginPath();
        ctx.moveTo(cx + s * 14, cy + 8);
        ctx.quadraticCurveTo(cx + s * (28 + nlf * 10), cy + 28, cx + s * (36 + nlf * 8), cy + 48);
        ctx.stroke();
      });
    }

    // —— 嘴（各情绪口型拉开差距）——
    const smile = t("AU12") + t("AU13") * 0.75;
    const frown = t("AU15");
    const openJaw = Math.max(t("AU26") * 0.9, t("AU27") * 1.15);
    const part = t("AU25");
    const open = Math.max(openJaw, part * 0.5);
    const stretch = t("AU20");
    const pucker = Math.max(t("AU18"), t("AU22") * 0.8, t("AU28") * 0.55);
    const press = Math.max(t("AU23"), t("AU24"));
    const upper = t("AU10");
    const lower = t("AU16");
    const chin = t("AU17");
    const dimple = t("AU14");
    // 轻蔑：仅 AU14 时做单侧（右侧）冷笑
    const unilateral = dimple > 0.2 && smile < 0.15 && frown < 0.15 && open < 0.2;

    const my = cy + 48 - chin * 6 + lower * 4;
    let halfW = 20 + stretch * 22 - pucker * 12 - press * 8 + smile * 8 + openJaw * 4;
    halfW = Math.max(7, Math.min(48, halfW));

    const cornerLY = my - smile * 16 + frown * 14 - (unilateral ? 0 : dimple * 4);
    const cornerRY = my - smile * 16 + frown * 14 - dimple * (unilateral ? 18 : 4);
    const midY = my + smile * 14 - frown * 12 + open * 2;
    const drop = openJaw * 36 + part * 10 + upper * 8;

    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (open > 0.28 || upper > 0.35) {
      // 张口 / 厌恶露齿：上唇线 + 口腔
      const topL = cornerLY - 2 - upper * 14;
      const topR = cornerRY - 2 - upper * 14;
      const topM = midY - 4 - upper * 10 - (openJaw > 0.5 && stretch < 0.3 ? 6 : 0);
      // 惊讶：更圆的 O；恐惧：扁宽
      const bot = my + Math.max(drop, 8);
      const oHalf = stretch > 0.35 ? halfW : openJaw > 0.4 && stretch < 0.25 ? halfW * 0.72 : halfW;

      ctx.beginPath();
      ctx.moveTo(cx - oHalf, topL);
      ctx.quadraticCurveTo(cx, topM, cx + oHalf, topR);
      ctx.quadraticCurveTo(cx + oHalf * 0.3, bot, cx, bot);
      ctx.quadraticCurveTo(cx - oHalf * 0.3, bot, cx - oHalf, topL);
      ctx.closePath();
      ctx.fillStyle = "#4a2030";
      ctx.fill();
      ctx.strokeStyle = "#7a3a3a";
      ctx.lineWidth = 2;
      ctx.stroke();

      // 厌恶：上排牙
      if (upper > 0.35) {
        ctx.fillStyle = "#f0e6d8";
        ctx.fillRect(cx - oHalf * 0.55, topM + 2, oHalf * 1.1, 5 + upper * 4);
      }
      // 惊讶/大笑舌头暗示
      if (openJaw > 0.45 && smile > 0.3) {
        ctx.fillStyle = "#c45a6a";
        ctx.beginPath();
        ctx.ellipse(cx, bot - 10, 8, 5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (press > 0.35) {
      // 愤怒紧唇 / 抿嘴
      ctx.strokeStyle = "#6a3030";
      ctx.lineWidth = 3.2 + press * 2.5;
      ctx.beginPath();
      ctx.moveTo(cx - halfW * 0.65, my);
      ctx.lineTo(cx + halfW * 0.65, my);
      ctx.stroke();
      if (t("AU23") > 0.3) {
        ctx.strokeStyle = `rgba(90,40,40,${0.4 + t("AU23") * 0.4})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(cx - halfW * 0.5, my - 4);
        ctx.lineTo(cx + halfW * 0.5, my - 4);
        ctx.moveTo(cx - halfW * 0.5, my + 4);
        ctx.lineTo(cx + halfW * 0.5, my + 4);
        ctx.stroke();
      }
    } else if (pucker > 0.3) {
      ctx.strokeStyle = "#7a3a3a";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(cx, my + 2, 7 + pucker * 2, 6 + pucker * 3, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (unilateral) {
      // 轻蔑：左侧近乎平，右侧上提冷笑
      ctx.strokeStyle = "#7a3a3a";
      ctx.lineWidth = 3.4;
      ctx.beginPath();
      ctx.moveTo(cx - 18, my + 2);
      ctx.quadraticCurveTo(cx - 2, my + 4, cx + 6, my);
      ctx.quadraticCurveTo(cx + 18, my - 12 - dimple * 6, cx + 26, my - 8 - dimple * 8);
      ctx.stroke();
      // 右侧酒窝
      ctx.strokeStyle = `rgba(140,70,60,${0.35 + dimple * 0.4})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx + 34, my - 2, 5, 0.2, Math.PI * 1.1);
      ctx.stroke();
    } else {
      // 开闭口微笑 / 悲伤
      ctx.strokeStyle = "#7a3a3a";
      ctx.lineWidth = 3.6;
      ctx.beginPath();
      ctx.moveTo(cx - halfW, cornerLY);
      ctx.quadraticCurveTo(cx, midY, cx + halfW, cornerRY);
      ctx.stroke();
      if (dimple > 0.2 && !unilateral) {
        ctx.strokeStyle = `rgba(140,70,60,${0.3 + dimple * 0.4})`;
        ctx.lineWidth = 1.4;
        [-1, 1].forEach((s) => {
          ctx.beginPath();
          ctx.arc(cx + s * (halfW + 8), my - 2, 5, s > 0 ? 0.3 : 2.2, s > 0 ? 2.2 : 5.5);
          ctx.stroke();
        });
      }
    }

    ctx.restore();
  }

  function phraseFor(au, lv) {
    const adv = INTENSITY_EN[lv] || "";
    const base = au.en;
    if (!adv) return base;
    // "slightly cheeks raised" → "cheeks slightly raised" 简单处理
    if (base.includes(" ")) {
      const [first, ...rest] = base.split(" ");
      // inner brows raised → inner brows slightly raised
      if (rest.length >= 1) return `${rest.slice(0, -1).concat([adv, rest[rest.length - 1]]).join(" ").replace(/^\s/, first + " ")}`.replace(/^(\S+)\s/, first + " ");
    }
    return `${adv} ${base}`;
  }

  function describeEn() {
    const items = activeList();
    if (!items.length) return "";
    const parts = items.map((a) => {
      const lv = level(a.id);
      const adv = INTENSITY_EN[lv];
      // 更自然：moderately raised cheeks
      let en = a.en;
      if (adv) {
        // 把副词插在最后一个动词性词前
        const words = en.split(" ");
        if (words.length >= 2) {
          words.splice(words.length - 1, 0, adv);
          en = words.join(" ");
        } else en = `${adv} ${en}`;
      }
      return en;
    });
    if (parts.length === 1) return `with ${parts[0]}`;
    if (parts.length === 2) return `with ${parts[0]} and ${parts[1]}`;
    return `with ${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
  }

  function describeAuCodes() {
    return activeList()
      .map((a) => `${a.id}:${level(a.id)}`)
      .join(" + ");
  }

  function renderChips(root) {
    const groups = {};
    AU_DEFS.forEach((a) => {
      (groups[a.group] = groups[a.group] || []).push(a);
    });
    root.innerHTML = Object.keys(groups)
      .map((g) => {
        const rows = groups[g]
          .map((a) => {
            const lv = level(a.id);
            return `<div class="au-row ${lv > 0 ? "on" : ""}" data-au-row="${a.id}">
              <div class="au-row-lab">
                <strong>${a.id}</strong>
                <span>${a.zh}</span>
              </div>
              <input type="range" min="0" max="5" step="1" value="${lv}" data-au-range="${a.id}" />
              <span class="au-lv" data-au-lv="${a.id}">${INTENSITY_LABEL[lv]}</span>
            </div>`;
          })
          .join("");
        return `<div class="au-group"><div class="au-group-title">${g}</div>${rows}</div>`;
      })
      .join("");
  }

  function updateSummary() {
    const enEl = document.getElementById("au-desc-en");
    const codeEl = document.getElementById("au-desc-codes");
    if (!enEl || !codeEl) return;
    enEl.textContent = describeEn() || "（全部强度为 0）";
    codeEl.textContent = describeAuCodes() || "—";
  }

  function refreshUiOnly() {
    applyFace();
    updateSummary();
    document.querySelectorAll("[data-au-lv]").forEach((el) => {
      const id = el.dataset.auLv;
      const lv = level(id);
      el.textContent = INTENSITY_LABEL[lv];
      const row = el.closest(".au-row");
      if (row) row.classList.toggle("on", lv > 0);
    });
    document.querySelectorAll("[data-au-range]").forEach((el) => {
      const id = el.dataset.auRange;
      const lv = level(id);
      if (Number(el.value) !== lv) el.value = String(lv);
    });
  }

  function refresh() {
    const host = document.getElementById("au-chip-host");
    if (host) renderChips(host);
    applyFace();
    updateSummary();
  }

  function open(shotId, insertFn) {
    targetShotId = shotId;
    onInsert = insertFn;
    const modal = document.getElementById("au-modal");
    if (!modal) return;
    modal.hidden = false;
    ensureFaceHost();
    refresh();
  }

  function close() {
    const modal = document.getElementById("au-modal");
    if (modal) modal.hidden = true;
    targetShotId = null;
  }

  function presetButtonsHtml() {
    const order = ["basic", "drama", "tech"];
    return order
      .map((cat) => {
        const items = PRESETS.filter((p) => p.cat === cat);
        if (!items.length) return "";
        const btns = items
          .map(
            (p) =>
              `<button type="button" class="m3td-btn au-preset-btn" title="${p.tip}" data-au-preset="${encodeURIComponent(JSON.stringify(p.map))}">${p.zh}</button>`
          )
          .join("");
        return `<div class="au-preset-group"><div class="au-preset-group-title">${PRESET_CAT_LABEL[cat] || cat}</div><div class="au-preset-group-btns">${btns}</div></div>`;
      })
      .join("");
  }

  function bind() {
    const modal = document.getElementById("au-modal");
    if (!modal || modal.dataset.bound) return;
    modal.dataset.bound = "1";

    modal.addEventListener("input", (e) => {
      const range = e.target.closest("[data-au-range]");
      if (!range) return;
      setLevel(range.dataset.auRange, range.value);
      refreshUiOnly();
    });

    modal.addEventListener("click", (e) => {
      if (e.target === modal || e.target.closest("[data-au-close]")) {
        close();
        return;
      }
      const preset = e.target.closest("[data-au-preset]");
      if (preset) {
        try {
          intensities = JSON.parse(decodeURIComponent(preset.dataset.auPreset || "%7B%7D"));
        } catch {
          intensities = {};
        }
        refresh();
        return;
      }
      if (e.target.closest("[data-au-insert]")) {
        const en = describeEn();
        if (!en) return;
        const withCodes = document.getElementById("au-include-codes")?.checked;
        let phrase = en;
        if (withCodes) phrase += ` [${describeAuCodes()}]`;
        const text = `her face shows ${phrase.replace(/^with /, "")}`;
        if (typeof onInsert === "function") onInsert(targetShotId, text, phrase);
        close();
      }
      if (e.target.closest("[data-au-insert-while-saying]")) {
        const en = describeEn();
        if (!en) return;
        const withCodes = document.getElementById("au-include-codes")?.checked;
        let phrase = en;
        if (withCodes) phrase += ` [${describeAuCodes()}]`;
        const text = `says ${phrase},`;
        if (typeof onInsert === "function") onInsert(targetShotId, text, phrase);
        close();
      }
    });
  }

  global.AuPicker = {
    open,
    close,
    bind,
    AU_DEFS,
    PRESETS,
    presetButtonsHtml,
  };
})(window);
