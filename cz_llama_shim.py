"""内存安全补丁：修复 fork 版 llama_cpp 在释放 LoRA 适配器时的访问违例 / 悬垂指针。

背景（comfyui-cz-toolkit 的 qwen3.6 + GGUF LoRA 生成场景）：
fork (JamePeng/llama-cpp-python 0.3.47) 的 LlamaModel.close() 顺序是
「先 llama_model_free(model) 释放模型 → 再 unload_all_loras() 释放 LoRA 适配器」。
但 LoRA 适配器内部仍引用已释放的模型上下文，导致 llama_adapter_lora_free(adapter)
访问悬垂指针 → OSError: exception: access violation reading 0x38 / 0xFFFFFFFFFFFFFFFF。
此外 LlamaLoraAdapter.free() 在底层释放抛违例时不置空 self.adapter，__del__ 时再释放二次崩溃。

本模块仅在内存中打补丁，不改动 llama_cpp 包文件：
- LlamaModel.close：先释放 LoRA 适配器（模型仍存活，释放合法），再走原 close() 释放模型；
  并加 _cz_closed 幂等标志，避免 CACHE.clean() 与对象 __del__ 两次 close。
- LlamaLoraAdapter.free：释放前先置空 self.adapter，杜绝悬垂指针二次释放；
  并吞掉访问违例作为收尾安全网。
由 models_util.py 在模块加载时调用一次。各方法用 _cz_shimmed / _cz_closed 防重复安装。
"""

def _install_llama_cleanup_shim():
    try:
        import llama_cpp
        from llama_cpp import _internals
    except Exception:
        return

    # ── LlamaLoraAdapter.free：释放前先置空，杜绝悬垂指针二次释放 ──
    LlamaLoraAdapter = getattr(_internals, "LlamaLoraAdapter", None)
    if LlamaLoraAdapter is not None and not getattr(LlamaLoraAdapter, "_cz_shimmed", False):
        def _safe_adapter_free(self):
            adapter = getattr(self, "adapter", None)
            if adapter is None:
                self.path = None
                return
            # 先置空：即使底层释放抛访问违例，也不会留下悬垂指针导致二次释放
            self.adapter = None
            try:
                llama_cpp.llama_adapter_lora_free(adapter)
            except OSError:
                pass  # 访问违例：适配器底层内存已在别处释放，收尾忽略即可
            except Exception:
                pass
            self.path = None

        LlamaLoraAdapter.free = _safe_adapter_free
        LlamaLoraAdapter._cz_shimmed = True

    # ── LlamaModel.close：先释放 LoRA 适配器，再释放模型（修正 fork 的错误顺序）──
    LlamaModel = getattr(_internals, "LlamaModel", None)
    if LlamaModel is not None and not getattr(LlamaModel, "_cz_shimmed", False):
        _orig_model_close = LlamaModel.close

        def _safe_model_close(self):
            if getattr(self, "_cz_closed", False):
                return
            self._cz_closed = True
            # fork 的 close() 先释放模型再释放适配器 → 适配器悬垂 → 访问违例。
            # 这里在模型仍存活时先释放适配器（释放合法），再走原 close() 释放模型。
            try:
                registry = getattr(self, "_lora_registry", None)
                if registry:
                    self.unload_all_loras()
            except OSError:
                pass
            except Exception:
                pass
            try:
                _orig_model_close(self)
            except OSError:
                pass

        LlamaModel.close = _safe_model_close
        LlamaModel._cz_shimmed = True
