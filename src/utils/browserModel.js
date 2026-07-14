import { fallbackResearchAnswer } from "./browserResearch";

export const DEFAULT_BROWSER_MODEL = "Qwen2.5-0.5B-Instruct-q4f16_1-MLC";

let sharedEngine = null;
let sharedModelId = "";
let loadingPromise = null;

export function getBrowserModelCapabilities() {
    return {
        webGpu: typeof navigator !== "undefined" && Boolean(navigator.gpu),
        webAssembly: typeof WebAssembly !== "undefined",
        cacheStorage: typeof caches !== "undefined",
        indexedDb: typeof indexedDB !== "undefined",
    };
}

export async function loadBrowserModel({
    modelId = DEFAULT_BROWSER_MODEL,
    onProgress,
} = {}) {
    if (sharedEngine && sharedModelId === modelId) return sharedEngine;
    if (loadingPromise) return loadingPromise;

    const capabilities = getBrowserModelCapabilities();
    if (!capabilities.webGpu) {
        throw new Error("WebGPU is not available in this browser. Use the built-in workspace summary or open the app in a WebGPU-capable Chromium browser.");
    }

    loadingPromise = (async () => {
        const webllm = await import("@mlc-ai/web-llm");
        const engine = await webllm.CreateMLCEngine(modelId, {
            initProgressCallback(progress) {
                onProgress?.({
                    progress: Number(progress?.progress || 0),
                    text: progress?.text || "Loading local model…",
                    timeElapsed: progress?.timeElapsed || 0,
                });
            },
        });

        sharedEngine = engine;
        sharedModelId = modelId;
        return engine;
    })();

    try {
        return await loadingPromise;
    } finally {
        loadingPromise = null;
    }
}

export async function unloadBrowserModel() {
    try {
        await sharedEngine?.unload?.();
    } catch {
        // Ignore model cleanup failures.
    }
    sharedEngine = null;
    sharedModelId = "";
}

export function getLoadedBrowserModel() {
    return {
        loaded: Boolean(sharedEngine),
        modelId: sharedModelId,
    };
}

export async function askBrowserModel({
    question,
    context,
    workspace,
    history = [],
    modelId = DEFAULT_BROWSER_MODEL,
    maxTokens = 900,
}) {
    if (!sharedEngine || sharedModelId !== modelId) {
        if (!getBrowserModelCapabilities().webGpu) {
            return {
                source: "workspace-summary",
                text: fallbackResearchAnswer(question, workspace),
            };
        }
        await loadBrowserModel({ modelId });
    }

    const messages = [
        {
            role: "system",
            content:
                "You are the ScrapeWebsite Browser Lab assistant. Analyze only the supplied research workspace. Distinguish observed evidence from inference. Do not claim that a product is authentic from images or metadata alone. Do not suggest bypassing access controls, CAPTCHAs, authentication, rate limits, or private endpoints. Prefer concise findings with exact URLs and JSON fields when available.",
        },
        ...history.slice(-3).map((item) => ({
            role: item.role === "assistant" ? "assistant" : "user",
            content: String(item.content || "").slice(0, 800),
        })),
        {
            role: "user",
            content: `WORKSPACE CONTEXT:\n${String(context || "").slice(0, 7_500)}\n\nQUESTION:\n${String(question || "").slice(0, 1_000)}`,
        },
    ];

    const completion = await sharedEngine.chat.completions.create({
        messages,
        temperature: 0.15,
        top_p: 0.9,
        max_tokens: Math.min(Number(maxTokens || 600), 600),
    });

    return {
        source: "webllm",
        modelId: sharedModelId,
        text: completion?.choices?.[0]?.message?.content || "The local model returned an empty response.",
        usage: completion?.usage || null,
    };
}
