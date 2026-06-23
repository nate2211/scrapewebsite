const STORAGE_KEY = "scrapewebsite.request.logs.v1";

let installed = false;
let originalFetch = null;
let originalXHROpen = null;
let originalXHRSend = null;
let originalXHRSetRequestHeader = null;
let performanceObserver = null;

const listeners = new Set();

const DEFAULT_OPTIONS = {
    captureFetch: true,
    captureXHR: true,
    captureResourceTiming: true,
    maxLogs: 500,
    maxBodyPreview: 2500,
    maxResponsePreview: 5000,
};

let activeOptions = { ...DEFAULT_OPTIONS };

function nowIso() {
    return new Date().toISOString();
}

function safeRandomId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
        return crypto.randomUUID();
    }

    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function truncate(value, max = 2500) {
    if (value === null || value === undefined) return null;

    const text =
        typeof value === "string" ? value : safeJsonStringify(value, "[unserializable]");

    if (text.length <= max) return text;

    return `${text.slice(0, max)}\n\n...[truncated ${text.length - max} chars]`;
}

function safeJsonStringify(value, fallback = "") {
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return fallback;
    }
}

function headersToObject(headers) {
    const out = {};

    if (!headers) return out;

    try {
        if (headers instanceof Headers) {
            headers.forEach((value, key) => {
                out[key] = maskSensitiveHeader(key, value);
            });
            return out;
        }

        if (Array.isArray(headers)) {
            for (const [key, value] of headers) {
                out[key] = maskSensitiveHeader(key, value);
            }
            return out;
        }

        if (typeof headers === "object") {
            for (const [key, value] of Object.entries(headers)) {
                out[key] = maskSensitiveHeader(key, value);
            }
            return out;
        }
    } catch {
        return out;
    }

    return out;
}

function maskSensitiveHeader(key, value) {
    const lower = String(key).toLowerCase();

    if (
        lower.includes("authorization") ||
        lower.includes("cookie") ||
        lower.includes("token") ||
        lower.includes("secret") ||
        lower.includes("key")
    ) {
        return "[masked]";
    }

    return value;
}

function bodyPreview(body) {
    if (!body) return null;

    if (typeof body === "string") {
        return truncate(body, activeOptions.maxBodyPreview);
    }

    if (body instanceof URLSearchParams) {
        return truncate(body.toString(), activeOptions.maxBodyPreview);
    }

    if (typeof FormData !== "undefined" && body instanceof FormData) {
        const form = {};

        for (const [key, value] of body.entries()) {
            form[key] =
                value instanceof File
                    ? `[file name=${value.name} size=${value.size} type=${value.type}]`
                    : String(value);
        }

        return truncate(form, activeOptions.maxBodyPreview);
    }

    if (body instanceof Blob) {
        return `[blob size=${body.size} type=${body.type}]`;
    }

    if (body instanceof ArrayBuffer) {
        return `[arraybuffer bytes=${body.byteLength}]`;
    }

    return "[unreadable request body]";
}

function readLogs() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function writeLogs(logs) {
    try {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(logs.slice(0, activeOptions.maxLogs))
        );
    } catch {
        // Storage may be full or blocked. Keep live listeners working.
    }
}

function emit(entry) {
    const logs = [entry, ...readLogs()].slice(0, activeOptions.maxLogs);
    writeLogs(logs);

    for (const listener of listeners) {
        listener(entry, logs);
    }

    window.dispatchEvent(
        new CustomEvent("scrapewebsite:request-log", {
            detail: entry,
        })
    );
}

async function getResponsePreview(response) {
    try {
        const cloned = response.clone();
        const contentType = cloned.headers.get("content-type") || "";

        if (
            contentType.includes("application/json") ||
            contentType.includes("text/") ||
            contentType.includes("application/xml") ||
            contentType.includes("application/xhtml")
        ) {
            const text = await cloned.text();
            return truncate(text, activeOptions.maxResponsePreview);
        }

        return `[body skipped content-type=${contentType || "unknown"}]`;
    } catch (error) {
        return `[response preview unavailable: ${error.message}]`;
    }
}

function getFetchUrl(input) {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.toString();
    if (input && typeof input.url === "string") return input.url;
    return "[unknown fetch url]";
}

function getFetchMethod(input, init) {
    if (init?.method) return init.method.toUpperCase();
    if (input && typeof input.method === "string") return input.method.toUpperCase();
    return "GET";
}

function installFetchRecorder() {
    if (!window.fetch || originalFetch) return;

    originalFetch = window.fetch.bind(window);

    window.fetch = async function recordedFetch(input, init = {}) {
        const id = safeRandomId();
        const startedAtPerf = performance.now();
        const url = getFetchUrl(input);
        const method = getFetchMethod(input, init);

        const baseEntry = {
            id,
            source: "fetch",
            phase: "complete",
            url,
            method,
            requestHeaders: headersToObject(init?.headers),
            requestBodyPreview: bodyPreview(init?.body),
            startedAt: nowIso(),
            status: null,
            ok: false,
            durationMs: null,
            responseHeaders: {},
            responsePreview: null,
            error: null,
        };

        try {
            const response = await originalFetch(input, init);
            const durationMs = Math.round(performance.now() - startedAtPerf);

            const entry = {
                ...baseEntry,
                status: response.status,
                statusText: response.statusText,
                ok: response.ok,
                durationMs,
                responseHeaders: headersToObject(response.headers),
                responsePreview: await getResponsePreview(response),
            };

            emit(entry);
            return response;
        } catch (error) {
            const durationMs = Math.round(performance.now() - startedAtPerf);

            emit({
                ...baseEntry,
                durationMs,
                error: error.message || "Fetch failed",
            });

            throw error;
        }
    };
}

function installXHRRecorder() {
    if (!window.XMLHttpRequest || originalXHROpen) return;

    originalXHROpen = XMLHttpRequest.prototype.open;
    originalXHRSend = XMLHttpRequest.prototype.send;
    originalXHRSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

    XMLHttpRequest.prototype.open = function recordedOpen(method, url, ...rest) {
        this.__scrapeRecorder = {
            id: safeRandomId(),
            source: "xhr",
            method: String(method || "GET").toUpperCase(),
            url: String(url || "[unknown xhr url]"),
            requestHeaders: {},
            startedAt: null,
            startedAtPerf: null,
        };

        return originalXHROpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.setRequestHeader = function recordedSetHeader(key, value) {
        if (this.__scrapeRecorder) {
            this.__scrapeRecorder.requestHeaders[key] = maskSensitiveHeader(key, value);
        }

        return originalXHRSetRequestHeader.call(this, key, value);
    };

    XMLHttpRequest.prototype.send = function recordedSend(body) {
        const meta = this.__scrapeRecorder || {
            id: safeRandomId(),
            source: "xhr",
            method: "GET",
            url: "[unknown xhr url]",
            requestHeaders: {},
        };

        meta.startedAt = nowIso();
        meta.startedAtPerf = performance.now();
        meta.requestBodyPreview = bodyPreview(body);

        this.addEventListener("loadend", () => {
            const contentType = this.getResponseHeader("content-type") || "";
            let preview = null;

            try {
                if (
                    typeof this.responseText === "string" &&
                    (contentType.includes("application/json") ||
                        contentType.includes("text/") ||
                        contentType.includes("application/xml") ||
                        contentType === "")
                ) {
                    preview = truncate(this.responseText, activeOptions.maxResponsePreview);
                } else {
                    preview = `[body skipped content-type=${contentType || "unknown"}]`;
                }
            } catch {
                preview = "[response preview unavailable]";
            }

            emit({
                id: meta.id,
                source: "xhr",
                phase: "complete",
                url: meta.url,
                method: meta.method,
                requestHeaders: meta.requestHeaders,
                requestBodyPreview: meta.requestBodyPreview,
                startedAt: meta.startedAt,
                status: this.status || null,
                statusText: this.statusText || "",
                ok: this.status >= 200 && this.status < 300,
                durationMs: Math.round(performance.now() - meta.startedAtPerf),
                responseHeaders: {},
                responsePreview: preview,
                error: this.status === 0 ? "XHR failed, blocked, or canceled" : null,
            });
        });

        return originalXHRSend.call(this, body);
    };
}

function installPerformanceRecorder() {
    if (!("PerformanceObserver" in window) || performanceObserver) return;

    try {
        performanceObserver = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                if (entry.initiatorType === "fetch" || entry.initiatorType === "xmlhttprequest") {
                    continue;
                }

                emit({
                    id: safeRandomId(),
                    source: "resource",
                    phase: "timing",
                    url: entry.name,
                    method: "GET",
                    startedAt: nowIso(),
                    status: null,
                    ok: true,
                    durationMs: Math.round(entry.duration || 0),
                    transferSize: entry.transferSize || null,
                    encodedBodySize: entry.encodedBodySize || null,
                    decodedBodySize: entry.decodedBodySize || null,
                    initiatorType: entry.initiatorType,
                    responsePreview: null,
                    error: null,
                });
            }
        });

        performanceObserver.observe({
            type: "resource",
            buffered: true,
        });
    } catch {
        performanceObserver = null;
    }
}

export function installRequestRecorder(options = {}) {
    if (installed) return;

    activeOptions = {
        ...DEFAULT_OPTIONS,
        ...options,
    };

    installed = true;

    if (activeOptions.captureFetch) installFetchRecorder();
    if (activeOptions.captureXHR) installXHRRecorder();
    if (activeOptions.captureResourceTiming) installPerformanceRecorder();
}

export function subscribeToRequestLogs(listener) {
    listeners.add(listener);

    return () => {
        listeners.delete(listener);
    };
}

export function getRequestLogs() {
    return readLogs();
}

export function clearRequestLogs() {
    writeLogs([]);

    for (const listener of listeners) {
        listener(null, []);
    }

    window.dispatchEvent(
        new CustomEvent("scrapewebsite:request-log-clear", {
            detail: [],
        })
    );
}

export function exportRequestLogs() {
    const logs = readLogs();
    const blob = new Blob([JSON.stringify(logs, null, 2)], {
        type: "application/json",
    });

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = `scrapewebsite-request-logs-${Date.now()}.json`;
    anchor.click();

    URL.revokeObjectURL(url);
}