import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

app.registerExtension({
  name: "CZToolkit.PromptSelector",

  async beforeRegisterNodeDef(nodeType, nodeData, _app) {
    if (nodeData.name !== "PromptSelector") return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments);

      const that = this;
      this.addWidget("button", "🔄 刷新提示词列表", null, async function () {
        try {
          const resp = await api.fetchApi("/cz-toolkit/list-prompts");
          const data = await resp.json();
          const combo = that.widgets?.find(w => w.name === "prompt_file");
          if (combo && data.options) {
            const prev = combo.value;
            combo.options.values = data.options;
            if (!data.options.includes(prev)) combo.value = data.options[0];
            that.setDirtyCanvas(true, true);
          }
        } catch (e) {
          console.error("[CZ-Toolkit] 刷新提示词列表失败:", e);
        }
      });
    };
  },
});

console.log("[CZ-Toolkit] PromptSelector loaded");
