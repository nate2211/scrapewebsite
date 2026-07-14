import {
    extractPageData,
    json,
    validatePublicUrl,
} from "../_shared/scrapeSecurity.js";

const MAX_TIMEOUT_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 22_000;
const MAX_RESPONSE_BYTES = 4_000_000;
const MAX_SELECTORS = 20;

function compactError(error, fallback = "Browser render failed.") {
    if (!error) return fallback;

    if (typeof error === "string") {
        return (error.trim() || fallback).slice(0, 1_000);
    }

    const message =
        typeof error.message === "string" && error.message.trim()
            ? error.message.trim()
            : fallback;

    return message.slice(0, 1_000);
}

function clamp(value, min, max, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function boolValue(value, fallback = false) {
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
    return fallback;
}

function timeoutSignal(timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(
        () => controller.abort("Cloudflare Browser Run REST request timed out."),
        timeoutMs
    );

    return {
        signal: controller.signal,
        clear() {
            clearTimeout(timer);
        },
    };
}

async function readLimitedText(response, limit = MAX_RESPONSE_BYTES) {
    if (!response.body) return "";

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    let total = 0;

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value) continue;

            const remaining = limit - total;
            if (remaining <= 0) break;

            const chunk =
                value.byteLength > remaining
                    ? value.slice(0, remaining)
                    : value;

            total += chunk.byteLength;
            text += decoder.decode(chunk, { stream: true });

            if (value.byteLength > remaining || total >= limit) break;
        }
    } finally {
        try {
            await reader.cancel();
        } catch {
            // Ignore stream cleanup errors.
        }
    }

    text += decoder.decode();
    return text;
}

function requireCloudflareConfiguration(context) {
    const accountId = String(
        context.env.CLOUDFLARE_ACCOUNT_ID || ""
    ).trim();

    const token = String(
        context.env.CLOUDFLARE_BROWSER_TOKEN ||
        context.env.CLOUDFLARE_API_TOKEN ||
        ""
    ).trim();

    if (!accountId) {
        throw new Error(
            "CLOUDFLARE_ACCOUNT_ID is not configured in the Pages project."
        );
    }

    if (!token) {
        throw new Error(
            "CLOUDFLARE_BROWSER_TOKEN is not configured in the Pages project."
        );
    }

    return { accountId, token };
}

async function callQuickAction(
    context,
    action,
    requestBody,
    timeoutMs
) {
    const { accountId, token } =
        requireCloudflareConfiguration(context);

    const endpoint =
        `https://api.cloudflare.com/client/v4/accounts/` +
        `${encodeURIComponent(accountId)}/browser-rendering/` +
        `${encodeURIComponent(action)}`;

    const timeout = timeoutSignal(timeoutMs);

    try {
        const response = await fetch(endpoint, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            body: JSON.stringify(requestBody),
            signal: timeout.signal,
        });

        const browserMsUsed =
            response.headers.get("X-Browser-Ms-Used") || "";

        const text = await readLimitedText(response);
        let payload = null;

        try {
            payload = text ? JSON.parse(text) : null;
        } catch {
            payload = null;
        }

        if (!response.ok) {
            const message =
                payload?.errors?.[0]?.message ||
                payload?.error ||
                text.slice(0, 800) ||
                `HTTP ${response.status}`;

            throw new Error(
                `Cloudflare Browser Run ${action} failed: ${message}`
            );
        }

        if (payload?.success === false) {
            throw new Error(
                payload?.errors?.[0]?.message ||
                `Cloudflare Browser Run ${action} failed.`
            );
        }

        return {
            result: payload?.result ?? payload ?? text,
            meta: payload?.meta || {},
            browserMsUsed,
        };
    } finally {
        timeout.clear();
    }
}

const DEEP_DISCOVERY_SCRIPT = String.raw`
(() => {
  const LIMIT = 800;
  const urls = new Set();
  const apiUrls = new Set();
  const imageUrls = new Set();
  const mediaUrls = new Set();
  const shadowLinks = new Set();
  const reactLinks = new Set();
  const performanceResources = [];
  let shadowRootCount = 0;
  let visitedElements = 0;

  const addUrl = (value, bucket = urls) => {
    if (!value || bucket.size >= LIMIT) return;

    const source = String(value).trim();
    if (!source || source.length > 4000) return;
    if (/^(data:|blob:|javascript:|mailto:|tel:|#)/i.test(source)) return;

    try {
      const absolute = new URL(source, location.href).href;
      if (/^https?:/i.test(absolute)) bucket.add(absolute);
    } catch {
      // Ignore invalid URLs.
    }
  };

  const inspectString = (value, preferredBucket = urls) => {
    if (typeof value !== "string" || value.length > 10000) return;

    const matches = value.match(/https?:\/\/[^\s"'<>\\)]+/g) || [];
    for (const match of matches.slice(0, 40)) {
      addUrl(match, preferredBucket);
    }
  };

  const inspectReactValue = (value, depth = 0, seen = new WeakSet()) => {
    if (depth > 4 || reactLinks.size >= LIMIT) return;

    if (typeof value === "string") {
      inspectString(value, reactLinks);
      if (/^(\/|\.\/|\.\.\/)[^\s]+/.test(value)) {
        addUrl(value, reactLinks);
      }
      return;
    }

    if (!value || typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);

    const entries = Array.isArray(value)
      ? value.slice(0, 30).map((item, index) => [index, item])
      : Object.entries(value).slice(0, 40);

    for (const [, child] of entries) {
      inspectReactValue(child, depth + 1, seen);
      if (reactLinks.size >= LIMIT) break;
    }
  };

  const inspectElement = (element, insideShadow = false) => {
    if (!(element instanceof Element) || visitedElements >= 6000) return;
    visitedElements += 1;

    const attributes = [
      "href",
      "src",
      "poster",
      "action",
      "data-src",
      "data-url",
      "data-href",
      "data-image",
      "data-video",
      "data-audio",
      "content",
    ];

    for (const name of attributes) {
      const value = element.getAttribute(name);
      if (!value) continue;

      addUrl(value);
      if (insideShadow) addUrl(value, shadowLinks);

      const tag = element.tagName.toLowerCase();
      if (tag === "img" || /image|thumbnail|poster/i.test(name)) {
        addUrl(value, imageUrls);
      }
      if (
        ["video", "audio", "source", "track"].includes(tag) ||
        /video|audio|media/i.test(name)
      ) {
        addUrl(value, mediaUrls);
      }
    }

    const srcset = element.getAttribute("srcset");
    if (srcset) {
      for (const candidate of srcset.split(",")) {
        addUrl(candidate.trim().split(/\s+/)[0], imageUrls);
      }
    }

    try {
      const background = getComputedStyle(element).backgroundImage || "";
      const matches = [...background.matchAll(/url\((['"]?)(.*?)\1\)/g)];
      for (const match of matches.slice(0, 10)) {
        addUrl(match[2], imageUrls);
      }
    } catch {
      // Ignore inaccessible computed styles.
    }

    const ownKeys = Object.keys(element);
    for (const key of ownKeys) {
      if (
        key.startsWith("__reactProps$") ||
        key.startsWith("__reactFiber$") ||
        key.startsWith("__reactContainer$")
      ) {
        try {
          inspectReactValue(element[key]);
        } catch {
          // Ignore inaccessible framework internals.
        }
      }
    }
  };

  const walkRoot = (root, insideShadow = false, depth = 0) => {
    if (!root || depth > 8 || visitedElements >= 6000) return;

    const elements = root.querySelectorAll
      ? root.querySelectorAll("*")
      : [];

    for (const element of elements) {
      inspectElement(element, insideShadow);

      if (element.shadowRoot) {
        shadowRootCount += 1;
        walkRoot(element.shadowRoot, true, depth + 1);
      }

      if (visitedElements >= 6000) break;
    }
  };

  walkRoot(document, false, 0);

  try {
    const resources = performance.getEntriesByType("resource").slice(-1200);

    for (const entry of resources) {
      if (!entry?.name) continue;

      addUrl(entry.name);

      const record = {
        url: entry.name,
        initiatorType: entry.initiatorType || "",
        duration: Math.round(Number(entry.duration || 0)),
        transferSize: Number(entry.transferSize || 0),
        encodedBodySize: Number(entry.encodedBodySize || 0),
        decodedBodySize: Number(entry.decodedBodySize || 0),
      };

      performanceResources.push(record);

      if (
        ["fetch", "xmlhttprequest", "beacon"].includes(
          String(entry.initiatorType || "").toLowerCase()
        ) ||
        /\/api\/|graphql|\.json(?:$|\?)/i.test(entry.name)
      ) {
        addUrl(entry.name, apiUrls);
      }

      if (
        /\.(?:png|jpe?g|gif|webp|avif|svg)(?:$|\?)/i.test(entry.name)
      ) {
        addUrl(entry.name, imageUrls);
      }

      if (
        /\.(?:mp3|wav|ogg|m4a|aac|flac|mp4|webm|mov|m3u8|mpd)(?:$|\?)/i.test(
          entry.name
        )
      ) {
        addUrl(entry.name, mediaUrls);
      }
    }
  } catch {
    // Ignore unavailable performance entries.
  }

  for (const url of urls) {
    if (/\/api\/|graphql|\.json(?:$|\?)/i.test(url)) {
      apiUrls.add(url);
    }
    if (/\.(?:png|jpe?g|gif|webp|avif|svg)(?:$|\?)/i.test(url)) {
      imageUrls.add(url);
    }
    if (/\.(?:mp3|wav|ogg|m4a|aac|flac|mp4|webm|mov|m3u8|mpd)(?:$|\?)/i.test(url)) {
      mediaUrls.add(url);
    }
  }

  const html = document.documentElement?.outerHTML || "";
  const challengeDetected = [
    /cf-chl-/i,
    /challenges\.cloudflare\.com/i,
    /g-recaptcha|recaptcha\/api/i,
    /hcaptcha|h-captcha/i,
    /cf-turnstile/i,
    /verify (?:you are|that you are) human/i,
    /checking your browser|attention required/i,
  ].some((pattern) => pattern.test(html.slice(0, 500000)));

  const payload = {
    finalUrl: location.href,
    title: document.title,
    readyState: document.readyState,
    shadowRootCount,
    visitedElements,
    challengeDetected,
    urls: [...urls].slice(0, LIMIT),
    apiUrls: [...apiUrls].slice(0, LIMIT),
    imageUrls: [...imageUrls].slice(0, LIMIT),
    mediaUrls: [...mediaUrls].slice(0, LIMIT),
    shadowLinks: [...shadowLinks].slice(0, LIMIT),
    reactLinks: [...reactLinks].slice(0, LIMIT),
    performanceResources: performanceResources.slice(0, LIMIT),
  };

  try {
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    let binary = "";
    for (let index = 0; index < bytes.length; index += 1) {
      binary += String.fromCharCode(bytes[index]);
    }

    let marker = document.getElementById(
      "__scrapewebsite_browser_data__"
    );

    if (!marker) {
      marker = document.createElement("script");
      marker.id = "__scrapewebsite_browser_data__";
      marker.type = "application/octet-stream";
      (document.head || document.documentElement).appendChild(marker);
    }

    marker.textContent = btoa(binary);
  } catch {
    // The normal rendered HTML is still useful if the marker cannot be added.
  }
})();
`;

function decodeUtf8Base64(value) {
    if (!value) return "";

    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }

    return new TextDecoder().decode(bytes);
}

function extractDeepDiscovery(html) {
    const source = String(html || "");
    const pattern =
        /<script[^>]+id=["']__scrapewebsite_browser_data__["'][^>]*>([\s\S]*?)<\/script>/i;

    const match = source.match(pattern);
    if (!match?.[1]) return null;

    try {
        return JSON.parse(
            decodeUtf8Base64(match[1].trim())
        );
    } catch {
        return null;
    }
}

function normalizeLinks(value) {
    const source = Array.isArray(value)
        ? value
        : Array.isArray(value?.links)
            ? value.links
            : [];

    const output = [];
    const seen = new Set();

    for (const item of source) {
        const url =
            typeof item === "string"
                ? item
                : item?.href || item?.url || "";

        if (!url || seen.has(url)) continue;
        seen.add(url);
        output.push(url);

        if (output.length >= 1_000) break;
    }

    return output;
}

function normalizeSelectors(value) {
    if (!Array.isArray(value)) return [];

    return value
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .slice(0, MAX_SELECTORS);
}

export async function onRequestOptions() {
    return json({ ok: true });
}

export async function onRequestGet(context) {
    return json({
        ok: true,
        route: "/api/browser-render",
        provider: "cloudflare-browser-run-rest",
        configured: Boolean(
            context.env.CLOUDFLARE_ACCOUNT_ID &&
            (
                context.env.CLOUDFLARE_BROWSER_TOKEN ||
                context.env.CLOUDFLARE_API_TOKEN
            )
        ),
        requiredSecrets: [
            "CLOUDFLARE_ACCOUNT_ID",
            "CLOUDFLARE_BROWSER_TOKEN",
        ],
        capabilities: {
            javascriptRendering: true,
            cssRendering: true,
            renderedHtml: true,
            screenshot: true,
            markdown: true,
            accessibilityTree: true,
            links: true,
            cssSelectorScrape: true,
            openShadowDomDiscovery: true,
            reactUrlDiscovery: true,
            performanceResourceDiscovery: true,
            fullNetworkInterception: false,
            responseBodyCapture: false,
            persistentBrowserSession: false,
            captchaBypass: false,
        },
        timestamp: new Date().toISOString(),
    });
}

export async function onRequestPost(context) {
    const startedAt = Date.now();

    try {
        const body = await context.request.json();
        const sourceUrl = validatePublicUrl(
            body.url || body.sourceUrl
        ).toString();

        const timeoutMs = clamp(
            body.timeoutMs,
            5_000,
            MAX_TIMEOUT_MS,
            DEFAULT_TIMEOUT_MS
        );

        const waitUntil = [
            "load",
            "domcontentloaded",
            "networkidle0",
            "networkidle2",
        ].includes(body.waitUntil)
            ? body.waitUntil
            : "networkidle2";

        const includeScreenshot = boolValue(
            body.includeScreenshot,
            true
        );

        const includeMarkdown = boolValue(
            body.includeMarkdown,
            false
        );

        const includeAccessibilityTree = boolValue(
            body.includeAccessibilityTree,
            false
        );

        const viewportWidth = clamp(
            body.viewport?.width,
            320,
            2_560,
            1_440
        );

        const viewportHeight = clamp(
            body.viewport?.height,
            240,
            2_000,
            1_000
        );

        const formats = ["content"];

        if (includeScreenshot) formats.push("screenshot");
        if (includeMarkdown) formats.push("markdown");
        if (includeAccessibilityTree) {
            formats.push("accessibilityTree");
        }

        // Cloudflare snapshot requires at least two formats.
        if (formats.length < 2) formats.push("screenshot");

        const commonRequest = {
            url: sourceUrl,
            gotoOptions: {
                waitUntil,
                timeout: timeoutMs,
            },
            viewport: {
                width: viewportWidth,
                height: viewportHeight,
                deviceScaleFactor: clamp(
                    body.viewport?.deviceScaleFactor,
                    1,
                    3,
                    1
                ),
            },
            userAgent:
                typeof body.userAgent === "string"
                    ? body.userAgent.slice(0, 500)
                    : undefined,
        };

        const snapshotRequest = {
            ...commonRequest,
            formats,
            screenshotOptions: {
                fullPage: boolValue(
                    body.fullPageScreenshot,
                    true
                ),
            },
            addScriptTag: [
                {
                    content: DEEP_DISCOVERY_SCRIPT,
                },
            ],
        };

        const linksRequest = {
            ...commonRequest,
            visibleLinksOnly: boolValue(
                body.visibleLinksOnly,
                false
            ),
            excludeExternalLinks: boolValue(
                body.excludeExternalLinks,
                false
            ),
        };

        const selectors = normalizeSelectors(body.selectors);

        const jobs = [
            callQuickAction(
                context,
                "snapshot",
                snapshotRequest,
                timeoutMs + 3_000
            ),
            callQuickAction(
                context,
                "links",
                linksRequest,
                timeoutMs + 3_000
            ).catch((error) => ({
                result: [],
                meta: {},
                browserMsUsed: "",
                warning: compactError(error),
            })),
        ];

        if (selectors.length) {
            jobs.push(
                callQuickAction(
                    context,
                    "scrape",
                    {
                        ...commonRequest,
                        elements: selectors.map((selector) => ({
                            selector,
                        })),
                    },
                    timeoutMs + 3_000
                ).catch((error) => ({
                    result: [],
                    meta: {},
                    browserMsUsed: "",
                    warning: compactError(error),
                }))
            );
        }

        const [snapshotResponse, linksResponse, scrapeResponse] =
            await Promise.all(jobs);

        const snapshot = snapshotResponse.result || {};
        const html = String(
            snapshot.content ||
            snapshot.html ||
            ""
        );

        const deep = extractDeepDiscovery(html) || {};
        const links = normalizeLinks(linksResponse.result);

        const pageData = extractPageData({
            html,
            url: deep.finalUrl || sourceUrl,
            query: String(
                body.instruction || body.query || ""
            ).slice(0, 4_000),
            mode: String(body.mode || "research").slice(0, 40),
            status: Number(
                snapshotResponse.meta?.status || 200
            ),
            contentType: "text/html; charset=utf-8",
            truncated: html.length >= MAX_RESPONSE_BYTES,
        });

        const warnings = [
            linksResponse.warning,
            scrapeResponse?.warning,
        ].filter(Boolean);

        warnings.push(
            "Cloudflare REST Quick Actions render JavaScript and CSS, but do not expose complete request/response interception or persistent browser sessions. Use Browser Run sessions, CDP, Playwright, or Puppeteer when those capabilities are required."
        );

        return json({
            ok: true,
            provider: "cloudflare-browser-run-rest",
            rendered: {
                ...pageData,
                url: deep.finalUrl || pageData.url || sourceUrl,
                finalUrl:
                    deep.finalUrl || pageData.url || sourceUrl,
                title:
                    deep.title ||
                    snapshotResponse.meta?.title ||
                    pageData.title ||
                    "",
                html,
                screenshot: snapshot.screenshot || "",
                screenshotDataUrl: snapshot.screenshot
                    ? `data:image/png;base64,${snapshot.screenshot}`
                    : "",
                markdown: snapshot.markdown || "",
                accessibilityTree:
                    snapshot.accessibilityTree || null,
                links:
                    links.length
                        ? links
                        : deep.urls || pageData.links || [],
                shadowLinks: deep.shadowLinks || [],
                reactLinks: deep.reactLinks || [],
                apiUrls: deep.apiUrls || [],
                imageUrls: deep.imageUrls || [],
                mediaUrls: deep.mediaUrls || [],
                network:
                    deep.performanceResources || [],
                shadowRootCount:
                    Number(deep.shadowRootCount || 0),
                challengeDetected: Boolean(
                    deep.challengeDetected
                ),
                selectorResults:
                    scrapeResponse?.result || [],
                apiProbes: [],
                source: "cloudflare-browser-run-rest",
            },
            usage: {
                snapshotBrowserMs:
                    snapshotResponse.browserMsUsed || "",
                linksBrowserMs:
                    linksResponse.browserMsUsed || "",
                scrapeBrowserMs:
                    scrapeResponse?.browserMsUsed || "",
            },
            warnings,
            elapsedMs: Date.now() - startedAt,
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        const status =
            error?.name === "AbortError" ? 504 : 400;

        return json(
            {
                ok: false,
                error: compactError(error),
                elapsedMs: Date.now() - startedAt,
                timestamp: new Date().toISOString(),
            },
            status
        );
    }
}