import { app } from "../../../scripts/app.js";

const MAX_SLOTS = 10;

app.registerExtension({
  name: "CZToolkit.TextSelector",

  async beforeRegisterNodeDef(nodeType, nodeData, _app) {
    if (nodeData.name !== "TextSelector") return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments);
      this._tsReady = false;
      this._tsSelections = {};
      setTimeout(() => this._tsSync(), 0);
    };

    nodeType.prototype._tsGetSelectionsWidget = function () {
      return this.widgets?.find(w => w.name === "selections");
    };

    nodeType.prototype._tsFlushSelections = function () {
      const w = this._tsGetSelectionsWidget();
      if (w) w.value = JSON.stringify(this._tsSelections);
    };

    // ── 核心同步 ────────────────────────────────────────────────────
    nodeType.prototype._tsSync = function () {
      this._tsReady = true;

      // 已连接的最大编号
      let maxConnected = 0;
      for (const inp of this.inputs || []) {
        if (inp.name.startsWith("text_") && inp.link != null) {
          const num = parseInt(inp.name.replace("text_", ""));
          if (num > maxConnected) maxConnected = num;
        }
      }
      const keep = Math.min(Math.max(maxConnected + 1, 1), MAX_SLOTS);

      // ── input：移除多余未连接的，补上缺少的 ──────────────────────
      for (let i = (this.inputs?.length ?? 0) - 1; i >= 0; i--) {
        const name = this.inputs[i].name;
        if (!name.startsWith("text_")) continue;
        const num = parseInt(name.replace("text_", ""));
        if (num > keep && this.inputs[i].link == null) {
          this.removeInput(i);
        }
      }
      for (let n = 1; n <= keep; n++) {
        if (!this.inputs?.find(x => x.name === `text_${n}`)) {
          this.addInput(`text_${n}`, "STRING");
        }
      }

      // ── select widget：移除多余的，补上缺少的 ─────────────────────
      if (this.widgets) {
        for (let i = this.widgets.length - 1; i >= 0; i--) {
          const wname = this.widgets[i].name;
          if (!wname || !wname.startsWith("select_")) continue;
          const num = parseInt(wname.replace("select_", ""));
          if (num > keep) {
            this.widgets.splice(i, 1);
            delete this._tsSelections[String(num)];
          }
        }
      }
      for (let n = 1; n <= keep; n++) {
        if (!this.widgets?.find(x => x.name === `select_${n}`)) {
          const savedVal = this._tsSelections[String(n)] || "无";
          const that = this;
          const idx = n;
          this.addWidget("combo", `select_${n}`, savedVal, function (v) {
            that._tsSelections[String(idx)] = v;
            that._tsFlushSelections();
          }, {
            values: ["无", "随机"],
            serialize: false,
          });
        }
      }

      // ── output：merged 始终在 index 0，不动它 ─────────────────────
      // 移除多余的 out_N（> keep 且无连线）
      for (let i = (this.outputs?.length ?? 0) - 1; i >= 0; i--) {
        const oname = this.outputs[i].name;
        if (!oname.startsWith("out_")) continue;
        const num = parseInt(oname.replace("out_", ""));
        if (num > keep) {
          const hasLink = this.outputs[i].links && this.outputs[i].links.length > 0;
          if (!hasLink) this.removeOutput(i);
        }
      }
      // 补上缺少的 out_N
      for (let n = 1; n <= keep; n++) {
        if (!this.outputs?.find(x => x.name === `out_${n}`)) {
          this.addOutput(`out_${n}`, "STRING");
        }
      }

      // ── 排序 input ────────────────────────────────────────────────
      if (this.inputs) {
        this.inputs.sort((a, b) => {
          if (!a.name.startsWith("text_")) return 1;
          if (!b.name.startsWith("text_")) return -1;
          return parseInt(a.name.replace("text_", "")) - parseInt(b.name.replace("text_", ""));
        });
      }

      // ── 排序 output：merged 在最前，out_1/2/3... 按编号 ───────────
      if (this.outputs) {
        this.outputs.sort((a, b) => {
          if (a.name === "merged") return -1;
          if (b.name === "merged") return 1;
          if (!a.name.startsWith("out_")) return 1;
          if (!b.name.startsWith("out_")) return -1;
          return parseInt(a.name.replace("out_", "")) - parseInt(b.name.replace("out_", ""));
        });
      }

      // 隐藏 selections widget
      const selW = this._tsGetSelectionsWidget();
      if (selW) selW.hidden = true;

      this._tsFlushSelections();
      this._tsRefreshCombos();
      this.setSize(this.computeSize());
      this.setDirtyCanvas(true, true);
    };

    // ── 连接变化 ──────────────────────────────────────────────────
    const onConnectionsChange = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function (side, slotIdx, connected, linkInfo, ioSlot) {
      onConnectionsChange?.apply(this, arguments);
      if (this._tsReady) this._tsSync();
    };

    // ── 读取上游文本 ──────────────────────────────────────────────
    nodeType.prototype._tsReadUpstream = function (slotIdx) {
      const inp = this.inputs?.find(x => x.name === `text_${slotIdx}`);
      if (!inp || inp.link == null) return null;
      const link = app.graph.links[inp.link];
      if (!link) return null;
      const srcNode = app.graph.getNodeById(link.origin_id);
      if (!srcNode) return null;

      for (const sw of srcNode.widgets || []) {
        if (typeof sw.value === "string" && sw.value.length > 0) {
          const t = (sw.type || "").toLowerCase();
          const n = (sw.name || "").toLowerCase();
          if (
            t === "customtext" || t === "text" || t === "string" ||
            t === "converted-widget" ||
            n === "text" || n === "string" || n === "value" ||
            n === "multiline" || n === "content" ||
            n === "cache_string" || n === "input_string"
          ) return sw.value;
        }
      }
      for (const sw of srcNode.widgets || [])
        if (typeof sw.value === "string" && sw.value.includes("\n")) return sw.value;
      for (const sw of srcNode.widgets || [])
        if (typeof sw.value === "string" && sw.value.trim().length > 0) return sw.value;
      return null;
    };

    // ── 刷新下拉框选项 ───────────────────────────────────────────
    nodeType.prototype._tsRefreshCombos = function () {
      for (const inp of (this.inputs || []).filter(x => x.name.startsWith("text_"))) {
        const num = parseInt(inp.name.replace("text_", ""));
        const w = this.widgets?.find(x => x.name === `select_${num}`);
        if (!w) continue;
        const textVal = this._tsReadUpstream(num);
        if (textVal == null) {
          w.options.values = ["无", "随机"];
          if (!["无", "随机"].includes(w.value)) w.value = "无";
          continue;
        }
        const lines = textVal.split("\n").filter(l => l.trim());
        const prev = w.value;
        w.options.values = ["无", "随机", ...lines];
        if (!w.options.values.includes(prev)) w.value = "无";
      }
    };

    const onMouseDown = nodeType.prototype.onMouseDown;
    nodeType.prototype.onMouseDown = function (e, localPos, graphCanvas) {
      this._tsRefreshCombos();
      return onMouseDown?.apply(this, arguments);
    };

    const onExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (output) {
      onExecuted?.apply(this, arguments);
      this._tsRefreshCombos();
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      onConfigure?.apply(this, arguments);
      setTimeout(() => {
        const selW = this._tsGetSelectionsWidget();
        if (selW && selW.value) {
          try { this._tsSelections = JSON.parse(selW.value); }
          catch (e) { this._tsSelections = {}; }
        }
        for (const [k, v] of Object.entries(this._tsSelections)) {
          const w = this.widgets?.find(x => x.name === `select_${k}`);
          if (w) w.value = v;
        }
        this._tsSync();
      }, 500);
    };
  },
});

console.log("[CZ-Toolkit] TextSelector loaded");
