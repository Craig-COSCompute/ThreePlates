/* Three Plates: bring-your-own-key AI.
 *
 * The app talks to one AI provider that the visitor chooses, straight from the browser,
 * with the visitor's own API key. The key is kept in this browser's localStorage only:
 * it never goes into backups and is only ever sent to the chosen provider.
 *
 * Two wire formats cover every preset:
 *   - "anthropic": Anthropic's Messages API (Claude)
 *   - "openai":    the OpenAI-style /chat/completions API (OpenAI, Gemini, Groq, OpenRouter, others)
 *
 * The client mirrors the small `sample()` surface the app was written against:
 *   sample(input, { onText, signal, images })  -> { text, truncated }
 *   sample.json(input, opts)                    -> parsed JSON value
 *   sample.limits()                             -> { maxPromptBytes, images? }
 * Errors reject with { code, message, text? }.
 */
(function () {
  "use strict";

  const STORAGE_KEY = "three-plates-ai";

  const PRESETS = {
    gemini: {
      label: "Google Gemini (free tier)", wire: "openai",
      base: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-flash-latest", vision: true,
      keyUrl: "https://aistudio.google.com/apikey",
      note: "Free key from Google AI Studio, no card needed. The free tier has daily limits, and Google may use free-tier prompts to improve its products.",
    },
    groq: {
      label: "Groq (free tier)", wire: "openai",
      base: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", vision: false,
      keyUrl: "https://console.groq.com/keys",
      note: "Free key, no card needed. Fast open models with a daily request limit. Can't read photos with the default model.",
    },
    openrouter: {
      label: "OpenRouter (free models)", wire: "openai",
      base: "https://openrouter.ai/api/v1", model: "meta-llama/llama-3.3-70b-instruct:free", vision: false,
      keyUrl: "https://openrouter.ai/keys",
      note: "One key for many models. Models ending in :free cost nothing but have low daily limits. Tap Load models to pick another.",
    },
    anthropic: {
      label: "Claude (Anthropic)", wire: "anthropic",
      base: "https://api.anthropic.com", model: "claude-sonnet-5-5", vision: true,
      keyUrl: "https://console.anthropic.com/settings/keys",
      note: "Pay as you go. Best results for structured lists and recipes.",
    },
    openai: {
      label: "OpenAI", wire: "openai",
      base: "https://api.openai.com/v1", model: "gpt-5-mini", vision: true,
      keyUrl: "https://platform.openai.com/api-keys",
      note: "Pay as you go.",
    },
    custom: {
      label: "Other (OpenAI-compatible)", wire: "openai",
      base: "", model: "", vision: false, keyUrl: "",
      note: "Any provider with an OpenAI-style /chat/completions endpoint that allows requests from web pages. This includes models running on your own computer, like Ollama at http://localhost:11434/v1.",
    },
  };

  const SYSTEM = "You are the meal-planning assistant inside Three Plates, a family dinner planner. Follow the requested output format exactly.";
  const SYSTEM_JSON = SYSTEM + " Reply with only the requested JSON: no code fences, no explanations.";

  /* ---------- settings ---------- */
  function load() {
    try {
      const c = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return c && typeof c === "object" ? c : null;
    } catch { return null; }
  }
  function save(cfg) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); return true; } catch { return false; }
  }
  function clear() { try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ } }
  /* https only, plus http://localhost for models running on your own machine (for example Ollama) */
  function validBase(b) { return /^https:\/\/[^\s]+$/.test(b || "") || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(b || ""); }
  function isReady(cfg) { return !!(cfg && cfg.model && cfg.base && validBase(cfg.base) && (cfg.key || /^http:\/\/(localhost|127\.0\.0\.1)/.test(cfg.base))); }
  function wireOf(cfg) { return (PRESETS[cfg.provider] || PRESETS.custom).wire; }
  const trimBase = (b) => String(b || "").trim().replace(/\/+$/, "");

  /* ---------- errors ---------- */
  async function httpError(res) {
    let msg = "";
    try {
      const j = await res.json();
      const e = j && (j.error || j);
      msg = typeof e === "string" ? e : (e && (e.message || e.msg)) || "";
    } catch { /* not JSON */ }
    const s = res.status;
    const code = s === 401 || s === 403 ? "auth" : s === 429 ? "rate_limited" : s === 404 ? "bad_model" : s === 400 || s === 422 ? "bad_request" : "upstream_error";
    return { code, status: s, message: String(msg || res.statusText || "Request failed").slice(0, 300) };
  }
  function netError(e, text) {
    if (e && e.name === "AbortError") return { code: "cancelled", message: "Stopped", text };
    if (e && e.code) return e;
    return { code: "network", message: "Couldn't reach the AI provider. It may block requests from web pages, or you may be offline.", text };
  }

  /* ---------- images ---------- */
  async function toJpeg(blob) {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.getContext("2d").drawImage(bmp, 0, 0, w, h);
    if (bmp.close) bmp.close();
    return c.toDataURL("image/jpeg", 0.85).split(",")[1];
  }

  /* ---------- streaming ---------- */
  async function readStream(res, onEvent) {
    const type = res.headers.get("content-type") || "";
    if (!res.body || !type.includes("event-stream")) { onEvent(await res.json(), true); return; }
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
        try { onEvent(JSON.parse(data), false); } catch { /* keep-alive or partial line */ }
      }
    }
  }

  /* ---------- request builders ---------- */
  function normalizeTurns(input) {
    if (typeof input === "string") return [{ role: "user", content: input }];
    if (Array.isArray(input) && input.length) return input.map((t) => ({ role: t.role === "assistant" ? "assistant" : "user", content: String(t.content || "") }));
    throw { code: "invalid_request", message: "Nothing to send." };
  }

  async function callAnthropic(cfg, turns, system, images, opts, emit) {
    const messages = turns.map((t) => ({ role: t.role, content: t.content }));
    if (images.length) {
      const last = messages[messages.length - 1];
      last.content = images.map((data) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } })).concat([{ type: "text", text: last.content }]);
    }
    const res = await fetch(trimBase(cfg.base) + "/v1/messages", {
      method: "POST", signal: opts.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": cfg.key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({ model: cfg.model, max_tokens: 16000, system, messages, stream: true }),
    });
    if (!res.ok) throw await httpError(res);
    let truncated = false;
    await readStream(res, (ev, whole) => {
      if (whole) { emit((ev.content || []).map((b) => b.text || "").join("")); truncated = ev.stop_reason === "max_tokens"; return; }
      if (ev.type === "content_block_delta" && ev.delta && typeof ev.delta.text === "string") emit(ev.delta.text);
      if (ev.type === "message_delta" && ev.delta && ev.delta.stop_reason === "max_tokens") truncated = true;
      if (ev.type === "error") throw { code: "upstream_error", message: (ev.error && ev.error.message) || "The provider reported an error." };
    });
    return truncated;
  }

  async function callOpenAI(cfg, turns, system, images, opts, emit) {
    const messages = [{ role: "system", content: system }].concat(turns.map((t) => ({ role: t.role, content: t.content })));
    if (images.length) {
      const last = messages[messages.length - 1];
      last.content = [{ type: "text", text: last.content }].concat(images.map((data) => ({ type: "image_url", image_url: { url: "data:image/jpeg;base64," + data } })));
    }
    const res = await fetch(trimBase(cfg.base) + "/chat/completions", {
      method: "POST", signal: opts.signal,
      headers: { "content-type": "application/json", authorization: "Bearer " + cfg.key },
      body: JSON.stringify({ model: cfg.model, messages, stream: true }),
    });
    if (!res.ok) throw await httpError(res);
    let truncated = false;
    await readStream(res, (ev, whole) => {
      if (ev.error) throw { code: "upstream_error", message: String(ev.error.message || ev.error).slice(0, 300) };
      const ch = ev.choices && ev.choices[0];
      if (!ch) return;
      if (whole) { emit((ch.message && ch.message.content) || ""); truncated = ch.finish_reason === "length"; return; }
      if (ch.delta && typeof ch.delta.content === "string") emit(ch.delta.content);
      if (ch.finish_reason === "length") truncated = true;
    });
    return truncated;
  }

  /* ---------- tolerant JSON ---------- */
  function parseLoose(text) {
    const t = String(text || "").trim();
    try { return JSON.parse(t); } catch { /* fall through */ }
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) { try { return JSON.parse(fence[1].trim()); } catch { /* fall through */ } }
    const start = t.search(/[[{]/), end = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
    if (start >= 0 && end > start) { try { return JSON.parse(t.slice(start, end + 1)); } catch { /* fall through */ } }
    throw { code: "invalid_json", message: "The answer wasn't valid JSON.", text: t };
  }

  /* ---------- client ---------- */
  function makeClient(cfg) {
    if (!isReady(cfg)) return null;
    async function run(input, opts, system) {
      opts = opts || {};
      const turns = normalizeTurns(input);
      const files = opts.images ? [].concat(opts.images instanceof FileList ? [...opts.images] : opts.images) : [];
      if (files.length && !cfg.vision) throw { code: "images_unavailable", message: "This model can't read photos." };
      let images = [];
      try { images = await Promise.all(files.slice(0, 4).map(toJpeg)); }
      catch { throw { code: "image_rejected", message: "That photo couldn't be read." }; }
      let text = "";
      const emit = (delta) => {
        if (!delta) return;
        text += delta;
        if (opts.onText) { try { opts.onText({ text, delta }); } catch (e) { console.warn(e); } }
      };
      let truncated;
      try {
        truncated = wireOf(cfg) === "anthropic"
          ? await callAnthropic(cfg, turns, system, images, opts, emit)
          : await callOpenAI(cfg, turns, system, images, opts, emit);
      } catch (e) { throw netError(e, text || undefined); }
      if (!text.trim()) throw { code: "empty_completion", message: "The AI sent back an empty answer." };
      return { text, truncated: !!truncated };
    }
    const sample = (input, opts) => run(input, opts, SYSTEM);
    sample.json = async (input, opts) => parseLoose((await run(input, opts, SYSTEM_JSON)).text);
    sample.limits = async () => ({
      maxPromptBytes: 262144,
      images: cfg.vision ? { maxCount: 4, maxInputBytes: 20 * 1024 * 1024, mediaTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"] } : undefined,
    });
    return sample;
  }

  /* List the models a key can use (most providers support GET /models). */
  async function listModels(cfg) {
    const base = trimBase(cfg.base);
    const anth = wireOf(cfg) === "anthropic";
    let res;
    try {
      res = await fetch(base + (anth ? "/v1/models?limit=100" : "/models"), {
        headers: anth
          ? { "x-api-key": cfg.key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" }
          : { authorization: "Bearer " + cfg.key },
      });
    } catch (e) { throw netError(e); }
    if (!res.ok) throw await httpError(res);
    const j = await res.json();
    const ids = (Array.isArray(j.data) ? j.data : Array.isArray(j.models) ? j.models : [])
      .map((m) => String(m.id || m.name || "").replace(/^models\//, "")).filter(Boolean);
    const free = ids.filter((id) => id.endsWith(":free"));
    return (cfg.provider === "openrouter" && free.length ? free : ids).sort();
  }

  async function test(cfg) {
    const client = makeClient(cfg);
    if (!client) throw { code: "no_key", message: "Fill in the key and model first." };
    const r = await client("Reply with exactly one word: ready");
    return r.text.trim().slice(0, 60);
  }

  window.TPAI = { PRESETS, load, save, clear, isReady, validBase, makeClient, listModels, test };
})();
