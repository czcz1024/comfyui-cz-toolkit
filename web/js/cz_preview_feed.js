/**
 * CZ 预览历史侧边栏 v2
 * ─────────────────────────────────────────────────────────────────────────────
 * 监听 executed 事件，收集所有节点输出：
 *   images  → 图片（type: temp = Preview Image, type: output = Save Image）
 *   videos  → 视频（AnimateDiff / VHS / WanVideo / MiniMax 等）
 *   audio   → 音频
 *   text    → 纯文本（Show Text / Preview Text / 任意 STRING 输出）
 *   gifs    → GIF / WEBP 动画，或被各家节点塞进来的 mp4/webm
 *
 * 每个条目进缩略图列表，点击打开 lightbox：
 *   - 图片：全屏展示
 *   - 视频：<video> 播放器
 *   - 音频：<audio> 播放器
 *   - 文本：可滚动文本框
 *
 * lightbox 打开时，新条目到来根据「跟随最新」决定是否自动切换。
 *
 * 设置（存 localStorage，立即生效）：
 *   CZ.PreviewFeed.FollowLatest  boolean  默认 true
 *   CZ.PreviewFeed.MaxItems      number   默认 300
 *   CZ.PreviewFeed.Columns       1-6      默认 2
 */

import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

// ─────────────────────────────────────────────────────────────────────────────
// 设置
// ─────────────────────────────────────────────────────────────────────────────

const SK = "CZ.PreviewFeed";
const DEFAULTS = { FollowLatest: true, MaxItems: 300, Columns: 2, ShowImage: true, ShowVideo: true, ShowAudio: true, ShowText: true };

function gs(k) {
    try { const v = localStorage.getItem(`${SK}.${k}`); return v === null ? DEFAULTS[k] : JSON.parse(v); }
    catch { return DEFAULTS[k]; }
}
function ss(k, v) { try { localStorage.setItem(`${SK}.${k}`, JSON.stringify(v)); } catch {} }

// ─────────────────────────────────────────────────────────────────────────────
// URL 构造
// ─────────────────────────────────────────────────────────────────────────────

function apiBase(path) {
    return typeof api.apiURL === "function" ? api.apiURL(path) : path;
}

function mediaUrl(file) {
    const p = new URLSearchParams({ filename: file.filename, type: file.type || "output" });
    if (file.subfolder) p.set("subfolder", file.subfolder);
    return `${apiBase("/view")}?${p}`;
}

const VIDEO_EXT = /\.(mp4|webm|mov|mkv|avi|m4v|ogv)$/i;
const AUDIO_EXT = /\.(mp3|wav|ogg|flac|m4a|aac|wma|opus)$/i;

function fileExt(file) {
    const name = String(file?.filename || file?.name || "");
    const i = name.lastIndexOf(".");
    return i >= 0 ? name.slice(i).toLowerCase() : "";
}

function fileMime(file) {
    return String(file?.format || file?.mime || file?.content_type || "").toLowerCase();
}

/** VHS / MiniMax / Save Video 常把 mp4 塞进 gifs，不能按桶名当图片。 */
function detectKind(file) {
    const mime = fileMime(file);
    const ext = fileExt(file);
    if (
        mime.startsWith("video/")
        || mime.includes("h264")
        || ["mp4", "webm", "mov", "mkv"].includes(mime)
        || VIDEO_EXT.test(ext)
    ) return "video";
    if (mime.startsWith("audio/") || AUDIO_EXT.test(ext)) return "audio";
    return "image";
}

function videoMime(file) {
    const mime = fileMime(file);
    if (mime.startsWith("video/")) return mime === "video/h264" ? "video/mp4" : mime;
    const ext = fileExt(file);
    if (ext === ".webm") return "video/webm";
    if (ext === ".mov") return "video/quicktime";
    if (ext === ".mkv") return "video/x-matroska";
    if (ext === ".ogv") return "video/ogg";
    return "video/mp4";
}

function asFileList(value) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object" && value.filename) return [value];
    return [];
}

function collectMediaFiles(output) {
    const seen = new Set();
    const files = [];
    for (const bucket of [
        output.images, output.gifs,
        output.videos, output.video, output.VIDEO,
        output.audio, output.audios, output.AUDIO,
    ]) {
        for (const file of asFileList(bucket)) {
            if (!file?.filename) continue;
            const key = `${file.type || "output"}|${file.subfolder || ""}|${file.filename}`;
            if (seen.has(key)) continue;
            seen.add(key);
            files.push(file);
        }
    }
    return files;
}

// ─────────────────────────────────────────────────────────────────────────────
// 条目类型
// kind: "image" | "video" | "audio" | "text" | "unknown"
// ─────────────────────────────────────────────────────────────────────────────

let feedItems = [];
let _id = 0;

/** 从 output 对象里提取各类型条目 */
function extractItems(output, nodeId, promptId) {
    const ts = Date.now();
    const items = [];
    const show = {
        image: gs("ShowImage"),
        video: gs("ShowVideo"),
        audio: gs("ShowAudio"),
        text: gs("ShowText"),
    };

    for (const file of collectMediaFiles(output)) {
        const kind = detectKind(file);
        if (!show[kind]) continue;
        items.push({
            id: ++_id,
            kind,
            url: mediaUrl(file),
            file,
            mime: kind === "video" ? videoMime(file) : "",
            label: file.filename,
            ts,
            nodeId,
            promptId,
        });
    }

    // ── 文本 ──
    if (gs("ShowText")) {
        // ComfyUI 文本节点典型格式：{ text: ["...", "..."] } 或 { text: "..." }
        const rawText = output.text ?? output.texts ?? output.string ?? output.STRING;
        if (rawText != null) {
            const lines = Array.isArray(rawText) ? rawText : [String(rawText)];
            const joined = lines.join("\n");
            if (joined.trim()) {
                items.push({ id: ++_id, kind: "text", url: null, file: null, label: joined.slice(0, 80).replace(/\n/g, "↵"), text: joined, ts, nodeId, promptId });
            }
        }
    }

    return items;
}

function addToFeed(items) {
    if (!items.length) return false;
    feedItems = [...feedItems, ...items];
    const max = gs("MaxItems");
    if (feedItems.length > max) feedItems = feedItems.slice(feedItems.length - max);
    return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// DOM 工具
// ─────────────────────────────────────────────────────────────────────────────

function el(tag, style, ...children) {
    const e = document.createElement(tag);
    if (style) Object.assign(e.style, style);
    e.append(...children);
    return e;
}

function btn(text, style, onClick) {
    const b = el("button", {
        padding: "4px 10px", borderRadius: "6px", border: "0",
        background: "rgba(255,255,255,.1)", color: "#fff",
        cursor: "pointer", fontSize: "12px", lineHeight: "1.4",
        ...style,
    });
    b.textContent = text;
    b.addEventListener("click", (e) => { e.stopPropagation(); onClick(e); });
    return b;
}

// ─────────────────────────────────────────────────────────────────────────────
// Lightbox
// ─────────────────────────────────────────────────────────────────────────────

const lightbox = (() => {
    let overlay = null;
    let body = null;       // 内容区（图/视频/音频/文本会放在这里）
    let counter = null;
    let followBtn = null;
    let navL = null, navR = null;
    let currentIdx = -1;
    let keyHandler = null;

    const isOpen = () => overlay?.isConnected;

    function refreshFollow() {
        if (!followBtn) return;
        const f = gs("FollowLatest");
        followBtn.textContent = f ? "🔒 跟随最新" : "📌 停留当前";
        followBtn.style.background = f ? "rgba(46,181,112,.28)" : "rgba(255,255,255,.1)";
    }

    /** 根据条目类型渲染内容区 */
    function renderBody(item) {
        if (!body) return;
        body.innerHTML = "";

        if (item.kind === "image") {
            const img = document.createElement("img");
            Object.assign(img.style, {
                maxWidth: "calc(100vw - 80px)", maxHeight: "calc(100vh - 120px)",
                objectFit: "contain", borderRadius: "6px",
                userSelect: "none",
            });
            img.src = item.url;
            body.appendChild(img);
            return;
        }

        if (item.kind === "video") {
            const video = document.createElement("video");
            Object.assign(video.style, {
                maxWidth: "calc(100vw - 80px)", maxHeight: "calc(100vh - 120px)",
                borderRadius: "6px", background: "#000",
            });
            video.controls = true;
            video.autoplay = true;
            video.loop = true;
            video.playsInline = true;
            video.preload = "auto";
            video.setAttribute("playsinline", "");
            video.src = item.url;
            video.addEventListener("error", () => {
                body.innerHTML = "";
                const wrap = el("div", {
                    display: "flex", flexDirection: "column", alignItems: "center",
                    gap: "12px", padding: "24px", color: "#ccc",
                });
                const msg = el("div", { fontSize: "14px" });
                msg.textContent = "浏览器无法内嵌播放该视频，可下载后用本地播放器打开";
                const link = document.createElement("a");
                link.href = item.url;
                link.download = item.label || "video.mp4";
                link.textContent = "下载视频";
                Object.assign(link.style, { color: "#8cb4ff", fontSize: "13px" });
                wrap.append(msg, link);
                body.appendChild(wrap);
            }, { once: true });
            body.appendChild(video);
            return;
        }

        if (item.kind === "audio") {
            const wrap = el("div", {
                display: "flex", flexDirection: "column", alignItems: "center",
                gap: "16px", padding: "32px",
            });
            const icon = el("div", { fontSize: "64px" });
            icon.textContent = "🎵";
            const audio = document.createElement("audio");
            audio.src = item.url;
            audio.controls = true;
            audio.autoplay = true;
            Object.assign(audio.style, { width: "min(480px, calc(100vw - 80px))" });
            const label = el("div", { color: "#aaa", fontSize: "13px", maxWidth: "480px", textAlign: "center", wordBreak: "break-all" });
            label.textContent = item.label;
            wrap.append(icon, audio, label);
            body.appendChild(wrap);
            return;
        }

        if (item.kind === "text") {
            const pre = document.createElement("pre");
            Object.assign(pre.style, {
                maxWidth: "min(800px, calc(100vw - 80px))",
                maxHeight: "calc(100vh - 200px)",
                overflowY: "auto",
                background: "rgba(0,0,0,.6)",
                border: "1px solid rgba(255,255,255,.15)",
                borderRadius: "8px",
                padding: "20px 24px",
                color: "#e8e8e8",
                fontSize: "14px",
                lineHeight: "1.7",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                userSelect: "text",
            });
            pre.textContent = item.text;

            const copyBtn = btn("📋 复制", { marginTop: "12px", fontSize: "13px" }, () => {
                navigator.clipboard?.writeText(item.text).catch(() => {});
                copyBtn.textContent = "✅ 已复制";
                setTimeout(() => { copyBtn.textContent = "📋 复制"; }, 1500);
            });
            copyBtn.style.display = "block";

            const wrap = el("div", { display: "flex", flexDirection: "column", alignItems: "center", gap: "0" }, pre, copyBtn);
            body.appendChild(wrap);
            return;
        }

        // unknown
        const msg = el("div", { color: "#888", fontSize: "14px" });
        msg.textContent = "（无法预览此类型）";
        body.appendChild(msg);
    }

    function showAt(idx) {
        if (!feedItems.length) return;
        currentIdx = Math.max(0, Math.min(feedItems.length - 1, idx));
        const item = feedItems[currentIdx];
        renderBody(item);
        if (counter) {
            const kindLabel = { image: "图片", video: "视频", audio: "音频", text: "文本" }[item.kind] ?? item.kind;
            counter.textContent = `${currentIdx + 1} / ${feedItems.length}  [${kindLabel}]  ${item.nodeId ? `节点 ${item.nodeId}` : ""}`;
        }
        if (navL) navL.style.opacity = currentIdx > 0 ? "1" : "0.3";
        if (navR) navR.style.opacity = currentIdx < feedItems.length - 1 ? "1" : "0.3";
    }

    function close() {
        if (keyHandler) { document.removeEventListener("keydown", keyHandler); keyHandler = null; }
        overlay?.remove();
        overlay = body = counter = followBtn = navL = navR = null;
        currentIdx = -1;
    }

    function open(idx) {
        close();

        overlay = el("div", {
            position: "fixed", inset: "0", zIndex: "99999",
            background: "rgba(0,0,0,.9)",
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
        });

        // 顶部工具栏
        counter = el("span", { color: "#ccc", fontSize: "12px", flex: "1", minWidth: "0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });
        followBtn = btn("", {}, () => { ss("FollowLatest", !gs("FollowLatest")); refreshFollow(); });
        refreshFollow();
        const jumpBtn = btn("⏭ 最新", {}, () => showAt(feedItems.length - 1));
        const closeBtn = btn("✕", { background: "transparent" }, () => close());

        const toolbar = el("div", {
            position: "absolute", top: "0", left: "0", right: "0",
            display: "flex", alignItems: "center", gap: "8px",
            padding: "10px 16px", background: "rgba(0,0,0,.6)", zIndex: "1",
        }, counter, followBtn, jumpBtn, closeBtn);

        // 内容区
        body = el("div", {
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            marginTop: "52px", padding: "8px",
            maxWidth: "100%", maxHeight: "calc(100vh - 60px)",
        });

        // 导航箭头
        function makeNav(text, dir) {
            const b = el("button", {
                position: "absolute", [dir < 0 ? "left" : "right"]: "8px",
                top: "50%", transform: "translateY(-50%)",
                fontSize: "32px", lineHeight: "1",
                background: "rgba(0,0,0,.45)", color: "#fff",
                border: "0", borderRadius: "50%",
                width: "52px", height: "52px",
                cursor: "pointer", transition: "opacity .15s",
                zIndex: "2",
            });
            b.textContent = text;
            b.addEventListener("click", (e) => { e.stopPropagation(); showAt(currentIdx + dir); });
            return b;
        }
        navL = makeNav("‹", -1);
        navR = makeNav("›", 1);

        overlay.append(toolbar, navL, body, navR);
        document.body.appendChild(overlay);

        overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

        keyHandler = (e) => {
            if (!isOpen()) return;
            // Ctrl / Meta 组合键不拦截，让 Ctrl+Enter（queue）等快捷键正常冒泡到 ComfyUI
            if (e.ctrlKey || e.metaKey) return;
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
            if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); showAt(currentIdx - 1); }
            if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); showAt(currentIdx + 1); }
        };
        document.addEventListener("keydown", keyHandler);

        showAt(idx);
    }

    function onNewItems() {
        if (!isOpen()) return;
        if (gs("FollowLatest")) showAt(feedItems.length - 1);
        else {
            // 只刷新计数器和箭头状态
            if (counter) {
                const item = feedItems[currentIdx];
                if (item) {
                    const kl = { image: "图片", video: "视频", audio: "音频", text: "文本" }[item.kind] ?? item.kind;
                    counter.textContent = `${currentIdx + 1} / ${feedItems.length}  [${kl}]  ${item.nodeId ? `节点 ${item.nodeId}` : ""}`;
                }
            }
            if (navR) navR.style.opacity = currentIdx < feedItems.length - 1 ? "1" : "0.3";
        }
    }

    return { open, close, isOpen, onNewItems };
})();

// ─────────────────────────────────────────────────────────────────────────────
// 缩略图工具
// ─────────────────────────────────────────────────────────────────────────────

const KIND_ICON = { image: "🖼️", video: "🎞️", audio: "🎵", text: "📝", unknown: "❓" };
const KIND_COLOR = { image: "#1a1a2e", video: "#1a2010", audio: "#1e1a2e", text: "#1a1e2e", unknown: "#1a1a1a" };

const thumbCache = new Map();
const thumbPending = new Map();
const THUMB_CACHE_MAX = 80;

function cacheThumb(url, dataUrl) {
    if (thumbCache.has(url)) thumbCache.delete(url);
    thumbCache.set(url, dataUrl);
    while (thumbCache.size > THUMB_CACHE_MAX) {
        const oldest = thumbCache.keys().next().value;
        thumbCache.delete(oldest);
    }
}

/** 从视频里截一帧做成缩略图；失败则回退到图标。 */
function captureVideoFrame(url, _mime, onFrame, onFail) {
    if (thumbCache.has(url)) {
        onFrame(thumbCache.get(url));
        return;
    }
    if (thumbPending.has(url)) {
        thumbPending.get(url).push({ onFrame, onFail });
        return;
    }
    thumbPending.set(url, [{ onFrame, onFail }]);

    const video = document.createElement("video");
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.setAttribute("playsinline", "");
    video.setAttribute("muted", "");
    Object.assign(video.style, {
        position: "fixed", left: "-9999px", top: "0",
        width: "160px", height: "90px", opacity: "0", pointerEvents: "none",
    });

    let done = false;
    const finish = (dataUrl) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        video.removeAttribute("src");
        video.load();
        video.remove();
        const waiters = thumbPending.get(url) || [{ onFrame, onFail }];
        thumbPending.delete(url);
        if (dataUrl) cacheThumb(url, dataUrl);
        for (const w of waiters) {
            if (dataUrl) w.onFrame(dataUrl);
            else w.onFail?.();
        }
    };

    const grab = () => {
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (!w || !h) return false;
        const canvas = document.createElement("canvas");
        const max = 480;
        const scale = Math.min(1, max / Math.max(w, h));
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        try {
            const ctx = canvas.getContext("2d");
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
            if (!dataUrl || dataUrl.length < 100) return false;
            finish(dataUrl);
            return true;
        } catch {
            return false;
        }
    };

    const seekToFrame = () => {
        if (done) return;
        const dur = Number.isFinite(video.duration) ? video.duration : 0;
        const t = dur > 0.4 ? Math.min(0.5, dur * 0.08) : 0.001;
        if (Math.abs((video.currentTime || 0) - t) < 0.0005) {
            if (!grab()) finish(null);
            return;
        }
        try { video.currentTime = t; }
        catch { if (!grab()) finish(null); }
    };
    video.addEventListener("seeked", () => {
        if (done) return;
        if (!grab()) requestAnimationFrame(() => { if (!grab()) finish(null); });
    });
    video.addEventListener("loadeddata", seekToFrame);
    video.addEventListener("loadedmetadata", seekToFrame);
    video.addEventListener("error", () => finish(null));
    const timer = setTimeout(() => { if (!grab()) finish(null); }, 8000);

    document.body.appendChild(video);
    video.src = url;
    video.load();
}

function mediaFillStyle() {
    return {
        position: "absolute", inset: "0",
        width: "100%", height: "100%",
        objectFit: "cover", display: "block",
    };
}

function fillVideoThumb(slot, item) {
    const applyFrame = (dataUrl) => {
        slot.innerHTML = "";
        const img = document.createElement("img");
        img.src = dataUrl;
        Object.assign(img.style, mediaFillStyle());
        slot.appendChild(img);
    };

    if (thumbCache.has(item.url)) {
        applyFrame(thumbCache.get(item.url));
        return;
    }

    const placeholder = el("div", {
        position: "absolute", inset: "0",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "#888", fontSize: "28px",
    });
    placeholder.textContent = "🎞️";
    slot.appendChild(placeholder);

    captureVideoFrame(
        item.url,
        item.mime || videoMime(item.file),
        applyFrame,
        () => {
            const video = document.createElement("video");
            Object.assign(video.style, mediaFillStyle());
            video.muted = true;
            video.playsInline = true;
            video.preload = "auto";
            video.src = item.url;
            video.addEventListener("loadeddata", () => {
                const dur = Number.isFinite(video.duration) ? video.duration : 0;
                const t = dur > 0.4 ? Math.min(0.5, dur * 0.08) : 0.001;
                try { video.currentTime = t; } catch { /* keep first decoded frame */ }
            });
            video.addEventListener("error", () => showIconFallback(slot, item));
            slot.innerHTML = "";
            slot.appendChild(video);
        },
    );
}

function buildThumb(item, idx) {
    // 宽由列数决定，高用 1:1 跟宽走；绝对定位媒体，避免 grid 把格子压扁
    const wrap = el("div", {
        position: "relative", width: "100%", height: "auto",
        aspectRatio: "1", overflow: "hidden",
        alignSelf: "start",
        borderRadius: "6px", cursor: "pointer",
        background: KIND_COLOR[item.kind] ?? "#1a1a1a",
        border: "1px solid #333", transition: "border-color .15s",
    });
    wrap.title = `#${idx + 1} · ${item.kind} · ${item.nodeId ? "节点" + item.nodeId : ""}\n${item.label}`;

    const slot = el("div", { position: "absolute", inset: "0" });
    wrap.appendChild(slot);

    if (item.kind === "image") {
        const img = document.createElement("img");
        img.src = item.url;
        img.loading = "lazy";
        Object.assign(img.style, mediaFillStyle());
        img.addEventListener("error", () => showIconFallback(slot, item));
        slot.appendChild(img);
    } else if (item.kind === "video") {
        fillVideoThumb(slot, item);
        showPlayOverlay(wrap);
    } else {
        showIconFallback(slot, item);
    }

    // 类型角标
    const badge = el("div", {
        position: "absolute", bottom: "3px", right: "5px",
        fontSize: "10px", color: "rgba(255,255,255,.7)",
        background: "rgba(0,0,0,.45)", borderRadius: "4px",
        padding: "1px 4px", lineHeight: "1.4", pointerEvents: "none",
    });
    badge.textContent = item.kind === "text" ? "txt" : item.file?.type === "temp" ? "prev" : item.kind.slice(0, 3);
    wrap.appendChild(badge);

    wrap.addEventListener("click", () => lightbox.open(idx));
    wrap.addEventListener("mouseenter", () => { wrap.style.borderColor = "#5b9cff"; });
    wrap.addEventListener("mouseleave", () => { wrap.style.borderColor = "#333"; });

    return wrap;
}

function showIconFallback(container, item) {
    container.innerHTML = "";
    const icon = el("div", {
        position: "absolute", inset: "0", display: "flex",
        flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: "6px", padding: "6px",
    });
    const emoji = el("span", { fontSize: "28px" });
    emoji.textContent = KIND_ICON[item.kind] ?? "❓";
    const lbl = el("span", { fontSize: "9px", color: "#888", textAlign: "center", wordBreak: "break-all", lineHeight: "1.3" });
    lbl.textContent = item.label.slice(0, 40);
    icon.append(emoji, lbl);
    container.appendChild(icon);
}

function showPlayOverlay(wrap) {
    const overlay = el("div", {
        position: "absolute", inset: "0",
        display: "flex", alignItems: "center", justifyContent: "center",
        pointerEvents: "none",
        background: "rgba(0,0,0,.18)",
    });
    const disc = el("div", {
        width: "34px", height: "34px", borderRadius: "50%",
        background: "rgba(0,0,0,.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "#fff", fontSize: "15px", paddingLeft: "3px",
        lineHeight: "1",
    });
    disc.textContent = "▶";
    overlay.appendChild(disc);
    wrap.appendChild(overlay);
}

// ─────────────────────────────────────────────────────────────────────────────
// 事件处理
// ─────────────────────────────────────────────────────────────────────────────

let renderSidebar = null;

function handleExecuted({ detail }) {
    const output = detail?.output;
    const nodeId = detail?.node;
    const promptId = detail?.prompt_id;
    if (!output || typeof output !== "object") return;

    const fresh = extractItems(output, nodeId, promptId);
    if (!addToFeed(fresh)) return;

    lightbox.onNewItems();
    renderSidebar?.();
}

// ─────────────────────────────────────────────────────────────────────────────
// 侧边栏 UI
// ─────────────────────────────────────────────────────────────────────────────

let sidebarEl = null;
let gridEl = null;

function buildSidebarUI(container) {
    // 同一个 container 第二次 render 时直接复用
    if (sidebarEl && sidebarEl.isConnected && container.contains(sidebarEl)) {
        renderSidebar?.();
        return;
    }

    container.innerHTML = "";
    Object.assign(container.style, {
        display: "flex", flexDirection: "column", height: "100%", overflow: "hidden",
    });

    // ── 顶部工具栏 ──────────────────────────────────────────────────────────
    const header = el("div", {
        display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px",
        padding: "8px 10px", borderBottom: "1px solid rgba(255,255,255,.1)",
        fontSize: "12px", color: "#bbb", flexShrink: "0",
    });

    const titleSpan = el("span", { fontWeight: "700", color: "#ddd", marginRight: "2px" });
    titleSpan.textContent = "预览历史";

    // 跟随最新 复选框
    const followLabel = el("label", { display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" });
    const followChk = document.createElement("input");
    followChk.type = "checkbox";
    followChk.checked = gs("FollowLatest");
    followChk.addEventListener("change", () => ss("FollowLatest", followChk.checked));
    const followTxt = el("span", {});
    followTxt.textContent = "跟随最新";
    followLabel.append(followChk, followTxt);

    // 列数
    const colLabel = el("label", { display: "flex", alignItems: "center", gap: "3px" });
    const colTxt = el("span", {});
    colTxt.textContent = "列:";
    const colInput = document.createElement("input");
    colInput.type = "number"; colInput.min = "1"; colInput.max = "6"; colInput.step = "1";
    colInput.value = gs("Columns");
    Object.assign(colInput.style, {
        width: "36px", fontSize: "11px", background: "#222", color: "#ddd",
        border: "1px solid #444", borderRadius: "4px", padding: "1px 3px",
    });
    colInput.addEventListener("change", () => {
        const v = Math.max(1, Math.min(6, parseInt(colInput.value) || 2));
        colInput.value = v;
        ss("Columns", v);
        renderSidebar?.();
    });
    colLabel.append(colTxt, colInput);

    // 计数
    const countSpan = el("span", { color: "#666", fontSize: "11px" });

    // 清空
    const clearBtn = btn("清空", { marginLeft: "auto", background: "rgba(255,60,60,.15)", color: "#f99" }, () => {
        if (!feedItems.length || confirm("清空所有预览历史？")) {
            feedItems = [];
            lightbox.close();
            renderSidebar?.();
        }
    });

    header.append(titleSpan, followLabel, colLabel, countSpan, clearBtn);

    // ── 类型过滤行 ──────────────────────────────────────────────────────────
    const filterRow = el("div", {
        display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px",
        padding: "5px 10px 6px", borderBottom: "1px solid rgba(255,255,255,.08)",
        fontSize: "11px", color: "#aaa", flexShrink: "0",
    });
    const filterTitle = el("span", { color: "#666" });
    filterTitle.textContent = "监听:";
    filterRow.appendChild(filterTitle);

    for (const [key, emoji, label] of [
        ["ShowImage", "🖼️", "图片"],
        ["ShowVideo", "🎞️", "视频"],
        ["ShowAudio", "🎵", "音频"],
        ["ShowText",  "📝", "文本"],
    ]) {
        const lbl = el("label", { display: "flex", alignItems: "center", gap: "3px", cursor: "pointer" });
        const chk = document.createElement("input");
        chk.type = "checkbox";
        chk.checked = gs(key);
        chk.addEventListener("change", () => { ss(key, chk.checked); });
        const txt = el("span", {});
        txt.textContent = `${emoji}${label}`;
        lbl.append(chk, txt);
        filterRow.appendChild(lbl);
    }

    // ── 缩略图网格 ──────────────────────────────────────────────────────────
    // minHeight:0 让 flex 子项形成滚动视口；行高按内容（正方形），多了滚动而不是均分压扁
    gridEl = el("div", {
        flex: "1 1 0%", minHeight: "0",
        overflowY: "auto", overflowX: "hidden", padding: "8px",
        display: "grid", gap: "6px",
        alignContent: "start", alignItems: "start",
        gridAutoRows: "max-content",
        justifyItems: "stretch",
    });

    function updateGrid() {
        const cols = gs("Columns");
        gridEl.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
        gridEl.innerHTML = "";
        countSpan.textContent = feedItems.length ? `${feedItems.length} 条` : "";

        if (!feedItems.length) {
            const empty = el("div", {
                gridColumn: "1 / -1", color: "#555", fontSize: "12px",
                textAlign: "center", padding: "28px 0",
            });
            empty.textContent = "等待生成结果…";
            gridEl.appendChild(empty);
            return;
        }

        // 最新排最上
        [...feedItems].reverse().forEach((item, revIdx) => {
            const trueIdx = feedItems.length - 1 - revIdx;
            gridEl.appendChild(buildThumb(item, trueIdx));
        });
    }

    renderSidebar = updateGrid;
    updateGrid();

    sidebarEl = el("div", {
        display: "flex", flexDirection: "column",
        height: "100%", minHeight: "0", overflow: "hidden",
    }, header, filterRow, gridEl);
    container.appendChild(sidebarEl);
}

// ─────────────────────────────────────────────────────────────────────────────
// 注册
// ─────────────────────────────────────────────────────────────────────────────

app.registerExtension({
    name: "CZToolkit.PreviewFeed",

    async setup() {
        api.addEventListener("executed", handleExecuted);

        app.extensionManager.registerSidebarTab({
            id: "cz-preview-feed",
            icon: "pi pi-images",
            title: "预览历史",
            tooltip: "CZ 预览历史 — 图片 / 视频 / 音频 / 文本，点击查看大图",
            type: "custom",
            render(el) { buildSidebarUI(el); },
            destroy() { renderSidebar = null; },
        });
    },
});

console.log("[CZ-Toolkit] PreviewFeed loaded");
