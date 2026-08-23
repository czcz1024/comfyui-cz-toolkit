import { app } from "../../../scripts/app.js";

app.registerExtension({
    name: "CZToolkit.ReciveAndEdit",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeType.comfyClass == "CzReciveAndEdit") {
            const onExecuted = nodeType.prototype.onExecuted;
            nodeType.prototype.onExecuted = function (message) {
                var txt = message.text.join("");
                onExecuted?.apply(this, arguments);
                if (this.widgets.length > 0) {
                    const pos = this.widgets.findIndex((w) => w.name === "cache_string");
                    if (pos !== -1) {
                        this.widgets[pos].value = txt;
                    }
                }
            }
        }
    }
});
