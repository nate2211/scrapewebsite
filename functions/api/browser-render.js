import {
    compactError,
    extractPageData,
    json,
    validatePublicUrl,
} from "../_shared/scrapeSecurity.js";

const MAX_TIMEOUT_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 22_000;
const MAX_BODY_BYTES = 2_000_000;

function clamp(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(Math.max(number, min), max);
}

function boolValue(value, fallback = false) {
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
    return fallback;
}

function cleanWorkerUrl(rawUrl) {
    const parsed = validatePublicUrl(rawUrl);
    parsed.hash = "";
    return parsed.toString();
}

function timeoutSignal(timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort("Browser render timed out."), timeoutMs);
    return {
        signal: controller.signal,
        clear: () => clearTimeout(timer),
    };
}

async function readLimitedText(response, limit = MAX_BODY_BYTES) {
    if (!response.body) return "";

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    let bytes = 0;

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value) continue;

            const remaining = limit - bytes;
            if (remaining <= 0) break;

            const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value;
            bytes += chunk.byteLength;
            text += decoder.decode(chunk, { stream: true });

            if (value.byteLength > remaining || bytes >= limit) break;
        }
    } finally {
        try {
            await reader.cancel();
        } catch {
            // Ignore cleanup errors.
        }
    }

    text += decoder.decode();
    return text;
}

function normalizeRenderedPayload(payload, sourceUrl) {
    if (!payload || typeof payload !== "object") return null;

    const rendered = payload.rendered || payload.data || payload.result || payload;
    if (!rendered || typeof rendered !== "object") return null;

    return {
        ...rendered,
        url: rendered.url || rendered.finalUrl || sourceUrl,
        finalUrl: rendered.finalUrl || rendered.url || sourceUrl,
        source: rendered.source || payload.provider || "browser-render",
        challengeDetected: Boolean(
            rendered.challengeDetected ||
            rendered.challenge?.detected ||
            payload.challengeDetected
        ),
    };
}

async function forwardToBrowserWorker(context, body, sourceUrl, timeoutMs) {
    const workerUrl = cleanWorkerUrl(context.env.BROWSER_WORKER_URL);
    const timeout = timeoutSignal(timeoutMs + 2_000);

    try {
        const response = await fetch(workerUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                ...(context.env.BROWSER_WORKER_TOKEN
                    ? { Authorization: `Bearer ${context.env.BROWSER_WORKER_TOKEN}` }
                    : {}),
            },
            body: JSON.stringify({
                ...body,
                url: sourceUrl,
                timeoutMs,
            }),
            signal: timeout.signal,
        });

        const text = await readLimitedText(response);
        let payload;

        try {
            payload = text ? JSON.parse(text) : {};
        } catch {
            throw new Error(`Browser worker returned non-JSON content (HTTP ${response.status}).`);
        }

        if (!response.ok || payload?.ok === false) {
            throw new Error(payload?.error || `Browser worker returned HTTP ${response.status}.`);
        }

        const rendered = normalizeRenderedPayload(payload, sourceUrl);
        if (!rendered) throw new Error("Browser worker response did not contain rendered page data.");

        return json({
            ok: true,
            provider: payload.provider || "cloudflare-browser-run-worker",
            rendered,
            warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
            timestamp: new Date().toISOString(),
        });
    } finally {
        timeout.clear();
    }
}

function cloudflareApiHeaders(context) {
    if (!context.env.CLOUDFLARE_BROWSER_TOKEN) return {};
    return {
        Authorization: `Bearer ${context.env.CLOUDFLARE_BROWSER_TOKEN}`,
        "Content-Type": "application/json",
        Accept: "application/json",
    };
}

async function callBrowserRenderingApi(context, action, requestBody, timeoutMs) {
    const accountId = String(context.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
    if (!accountId) throw new Error("CLOUDFLARE_ACCOUNT_ID is not configured.");

    const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/browser-rendering/${action}`;
    const timeout = timeoutSignal(timeoutMs);

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: cloudflareApiHeaders(context),
            body: JSON.stringify(requestBody),
            signal: timeout.signal,
        });

        const text = await readLimitedText(response);
        let payload = null;

        try {
            payload = text ? JSON.parse(text) : null;
        } catch {
            payload = null;
        }

        if (!response.ok) {
            const message = payload?.errors?.[0]?.message || payload?.error || text.slice(0, 500);
            throw new Error(`${action} returned HTTP ${response.status}${message ? `: ${message}` : ""}`);
        }

        if (payload && payload.success === false) {
            throw new Error(payload?.errors?.[0]?.message || `${action} failed.`);
        }

        return payload?.result ?? payload ?? text;
    } finally {
        timeout.clear();
    }
}

function browserApiHtml(result) {
    if (typeof result === "string") return result;
    if (!result || typeof result !== "object") return "";
    return String(result.content || result.html || result.body || result.result || "");
}

function browserApiLinks(result) {
    const source = Array.isArray(result)
        ? result
        : Array.isArray(result?.links)
            ? result.links
            : Array.isArray(result?.result)
                ? result.result
                : [];

    return source
        .map((item) => typeof item === "string" ? item : item?.href || item?.url)
        .filter(Boolean)
        .slice(0, 500);
}

function detectChallenge(html) {
    const source = String(html || "").slice(0, 500_000);
    const patterns = [
        /cf-chl-/i,
        /challenges\.cloudflare\.com/i,
        /g-recaptcha|recaptcha\/api/i,
        /hcaptcha|h-captcha/i,
        /challenges\.cloudflare\.com\/turnstile|cf-turnstile/i,
        /verify (?:you are|that you are) human/i,
        /security check|checking your browser|attention required/i,
    ];
    return patterns.some((pattern) => pattern.test(source));
}

async function useCloudflareQuickActions(context, body, sourceUrl, timeoutMs) {
    const requestBody = {
        url: sourceUrl,
        gotoOptions: {
            waitUntil: body.waitUntil || "networkidle2",
            timeout: timeoutMs,
        },
    };

    const [contentResult, linksResult] = await Promise.all([
        callBrowserRenderingApi(context, "content", requestBody, timeoutMs),
        callBrowserRenderingApi(context, "links", requestBody, timeoutMs).catch(() => []),
    ]);

    const html = browserApiHtml(contentResult);
    const links = browserApiLinks(linksResult);
    const pageData = extractPageData({
        html,
        url: sourceUrl,
        query: String(body.instruction || body.query || ""),
        mode: String(body.mode || "research"),
        status: 200,
        contentType: "text/html; charset=utf-8",
        truncated: html.length >= MAX_BODY_BYTES,
    });

    return json({
        ok: true,
        provider: "cloudflare-browser-rendering-rest",
        rendered: {
            ...pageData,
            html,
            links: links.length ? links : pageData.links,
            finalUrl: pageData.url,
            source: "cloudflare-browser-rendering-rest",
            challengeDetected: detectChallenge(html),
            network: [],
            shadowLinks: [],
            reactLinks: [],
            apiProbes: [],
        },
        warnings: [
            "The REST quick-action fallback returns rendered HTML and links, but detailed response bodies, open shadow roots, React-owned URLs, and page-session API probes require the companion Browser Run worker.",
        ],
        timestamp: new Date().toISOString(),
    });
}

export async function onRequestOptions() {
    return json({ ok: true });
}

export async function onRequestGet(context) {
    return json({
        ok: true,
        route: "/api/browser-render",
        configured: {
            browserWorker: Boolean(context.env.BROWSER_WORKER_URL),
            cloudflareRest: Boolean(
                context.env.CLOUDFLARE_ACCOUNT_ID &&
                context.env.CLOUDFLARE_BROWSER_TOKEN
            ),
        },
        capabilities: {
            renderedHtml: true,
            screenshot: Boolean(context.env.BROWSER_WORKER_URL),
            networkCapture: Boolean(context.env.BROWSER_WORKER_URL),
            shadowDom: Boolean(context.env.BROWSER_WORKER_URL),
            reactDiscovery: Boolean(context.env.BROWSER_WORKER_URL),
            safeSameOriginApiProbes: Boolean(context.env.BROWSER_WORKER_URL),
            captchaBypass: false,
        },
        timestamp: new Date().toISOString(),
    });
}

export async function onRequestPost(context) {
    const startedAt = Date.now();

    try {
        const body = await context.request.json();
        const sourceUrl = validatePublicUrl(body.url || body.sourceUrl).toString();
        const timeoutMs = clamp(body.timeoutMs, 5_000, MAX_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);

        const normalizedBody = {
            instruction: String(body.instruction || body.query || "").slice(0, 4_000),
            mode: String(body.mode || "research").slice(0, 32),
            waitUntil: String(body.waitUntil || "networkidle2").slice(0, 40),
            timeoutMs,
            settleMs: clamp(body.settleMs, 0, 5_000, 800),
            includeScreenshot: boolValue(body.includeScreenshot, true),
            captureResponseBodies: boolValue(body.captureResponseBodies, true),
            includeShadowDom: boolValue(body.includeShadowDom, true),
            includeReactLinks: boolValue(body.includeReactLinks, true),
            probeApis: boolValue(body.probeApis, false),
            maxProbes: clamp(body.maxProbes, 0, 12, 8),
        };

        let response;
        if (context.env.BROWSER_WORKER_URL) {
            response = await forwardToBrowserWorker(
                context,
                normalizedBody,
                sourceUrl,
                timeoutMs
            );
        } else if (
            context.env.CLOUDFLARE_ACCOUNT_ID &&
            context.env.CLOUDFLARE_BROWSER_TOKEN
        ) {
            response = await useCloudflareQuickActions(
                context,
                normalizedBody,
                sourceUrl,
                timeoutMs
            );
        } else {
            return json({
                ok: false,
                error: "Browser rendering is not configured. Deploy the included Browser Run worker and set BROWSER_WORKER_URL, or set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_BROWSER_TOKEN for the limited REST fallback.",
                setupRequired: true,
            }, 501);
        }

        const headers = new Headers(response.headers);
        headers.set("X-ScrapeWebsite-Elapsed-Ms", String(Date.now() - startedAt));
        return new Response(response.body, {
            status: response.status,
            headers,
        });
    } catch (error) {
        const status = error?.name === "AbortError" ? 504 : 400;
        return json({
            ok: false,
            error: compactError(error, "Browser render failed."),
            elapsedMs: Date.now() - startedAt,
            timestamp: new Date().toISOString(),
        }, status);
    }
}