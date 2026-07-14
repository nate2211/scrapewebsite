const HTTP_PROTOCOLS = new Set(["http:", "https:"]);

const AUDIO_EXTENSIONS = /\.(?:mp3|wav|flac|m4a|aac|ogg|opus|weba|aiff|alac)(?:$|[?#])/i;
const VIDEO_EXTENSIONS = /\.(?:mp4|webm|mov|m4v|mkv|avi|mpeg|mpg|ogv)(?:$|[?#])/i;
const IMAGE_EXTENSIONS = /\.(?:png|jpe?g|gif|webp|avif|svg|bmp|ico|tiff?)(?:$|[?#])/i;
const MANIFEST_EXTENSIONS = /\.(?:m3u8|mpd)(?:$|[?#])/i;
const API_HINT_PATTERN = /(?:^|\/)(?:api|apis|v\d+|graphql|gql|rest|rpc|ajax|json|feed|search|query|data|wp-json)(?:\/|$|[?#])/i;
const STATIC_EXTENSIONS = /\.(?:js|mjs|css|json|map|wasm|woff2?|ttf|otf)(?:$|[?#])/i;
const CDN_HOST_PATTERN = /(?:^|\.)(?:cloudfront\.net|cloudflare\.com|cloudflareinsights\.com|fastly\.net|akamaihd\.net|akamaized\.net|cdn\.|static\.|assets\.|media\.|images\.|img\.|video\.|audio\.)/i;

export function uniqueStrings(values, limit = 500) {
    const output = [];
    const seen = new Set();

    for (const value of values || []) {
        const text = String(value || "").trim();
        if (!text || seen.has(text)) continue;
        seen.add(text);
        output.push(text);
        if (output.length >= limit) break;
    }

    return output;
}

export function normalizeHttpUrl(rawUrl, baseUrl) {
    try {
        const parsed = new URL(String(rawUrl || "").trim(), baseUrl);
        if (!HTTP_PROTOCOLS.has(parsed.protocol)) return "";
        if (parsed.username || parsed.password) return "";
        parsed.hash = "";
        return parsed.toString();
    } catch {
        return "";
    }
}

export function parseUrlList(value, limit = 8) {
    const matches = String(value || "").match(/https?:\/\/[^\s"'<>]+/gi) || [];
    return uniqueStrings(
        matches
            .map((item) => item.replace(/[),.;]+$/, ""))
            .map((item) => normalizeHttpUrl(item))
            .filter(Boolean),
        limit
    );
}

export function parseLineList(value, limit = 20) {
    return uniqueStrings(
        String(value || "")
            .split(/\r?\n+/)
            .map((item) => item.trim())
            .filter(Boolean),
        limit
    );
}

export function buildQueryUrl(template, query, parameterName = "q") {
    const cleanedQuery = String(query || "").trim();
    if (!cleanedQuery) return normalizeHttpUrl(template);

    const source = String(template || "").trim();
    if (!source) return "";

    if (source.includes("{query}")) {
        return normalizeHttpUrl(source.replaceAll("{query}", encodeURIComponent(cleanedQuery)));
    }

    try {
        const parsed = new URL(source);
        parsed.searchParams.set(parameterName || "q", cleanedQuery);
        return normalizeHttpUrl(parsed.toString());
    } catch {
        return "";
    }
}

export async function postJson(route, body, signal) {
    const response = await fetch(route, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
        },
        body: JSON.stringify(body),
        signal,
    });

    const text = await response.text();
    let data;

    try {
        data = text ? JSON.parse(text) : {};
    } catch {
        throw new Error(`${route} returned non-JSON content (HTTP ${response.status}).`);
    }

    if (!response.ok || data?.ok === false) {
        throw new Error(data?.error || data?.message || `${route} failed with HTTP ${response.status}.`);
    }

    return data;
}

export function classifyResource(rawUrl, metadata = {}) {
    const url = normalizeHttpUrl(rawUrl);
    if (!url) return null;

    let hostname = "";
    let pathname = "";

    try {
        const parsed = new URL(url);
        hostname = parsed.hostname;
        pathname = parsed.pathname;
    } catch {
        return null;
    }

    const contentType = String(metadata.contentType || metadata.mimeType || "").toLowerCase();
    const resourceType = String(metadata.resourceType || metadata.type || metadata.kind || "").toLowerCase();
    const lowerUrl = url.toLowerCase();

    const explicitKinds = new Set(["audio", "video", "image", "api", "manifest", "page", "asset", "link"]);
    let kind = explicitKinds.has(resourceType) ? resourceType : "link";
    if (contentType.startsWith("audio/") || AUDIO_EXTENSIONS.test(lowerUrl)) kind = "audio";
    else if (contentType.startsWith("video/") || VIDEO_EXTENSIONS.test(lowerUrl)) kind = "video";
    else if (MANIFEST_EXTENSIONS.test(lowerUrl) || /application\/(?:vnd\.apple\.mpegurl|dash\+xml)/.test(contentType)) kind = "manifest";
    else if (contentType.startsWith("image/") || IMAGE_EXTENSIONS.test(lowerUrl)) kind = "image";
    else if (contentType.includes("json") || resourceType === "xhr" || resourceType === "fetch" || API_HINT_PATTERN.test(lowerUrl)) kind = "api";
    else if (STATIC_EXTENSIONS.test(lowerUrl)) kind = "asset";
    else if (/\.html?(?:$|[?#])/.test(lowerUrl) || resourceType === "document") kind = "page";

    const isCdn = CDN_HOST_PATTERN.test(hostname) || /\/(?:cdn|assets|static|media|images|img|video|audio)\//i.test(pathname);

    return {
        url,
        hostname,
        pathname,
        kind,
        isCdn,
        status: metadata.status ?? null,
        method: metadata.method || "GET",
        contentType,
        source: metadata.source || "discovery",
        responsePreview: metadata.responsePreview || metadata.bodyPreview || "",
        size: Number(metadata.size || metadata.encodedBodySize || metadata.contentLength || 0) || 0,
        durationMs: Number(metadata.durationMs || metadata.duration || 0) || 0,
        title: metadata.title || "",
        text: metadata.text || "",
        metadata,
    };
}

function addResource(map, rawUrl, metadata = {}) {
    const classified = classifyResource(rawUrl, metadata);
    if (!classified) return;

    const current = map.get(classified.url);
    if (!current) {
        map.set(classified.url, classified);
        return;
    }

    map.set(classified.url, {
        ...current,
        ...classified,
        source: uniqueStrings([current.source, classified.source], 4).join(", "),
        responsePreview: classified.responsePreview || current.responsePreview,
        contentType: classified.contentType || current.contentType,
        status: classified.status ?? current.status,
        size: Math.max(current.size || 0, classified.size || 0),
    });
}

function collectPageData(pageData, map, pageRecords) {
    if (!pageData || typeof pageData !== "object") return;

    const url = normalizeHttpUrl(pageData.url || pageData.finalUrl);
    if (url) {
        pageRecords.push({
            url,
            title: pageData.title || "Untitled page",
            description: pageData.description || "",
            text: pageData.text || pageData.textPreview || "",
            html: pageData.html || pageData.renderedHtml || "",
            screenshot: pageData.screenshot || pageData.screenshotDataUrl || "",
            status: pageData.status ?? null,
            source: pageData.source || "page",
            raw: pageData,
        });
        addResource(map, url, {
            kind: "page",
            source: pageData.source || "page",
            status: pageData.status,
            contentType: pageData.contentType || "text/html",
            title: pageData.title,
        });
    }

    const listFields = [
        ["links", "link"],
        ["images", "image"],
        ["scripts", "asset"],
        ["stylesheets", "asset"],
        ["cdnLinks", "asset"],
        ["branchLinks", "page"],
        ["apiHints", "api"],
        ["apiCandidates", "api"],
        ["apiProbes", "api"],
        ["media", "media"],
        ["audio", "audio"],
        ["video", "video"],
        ["manifests", "manifest"],
        ["reactLinks", "link"],
        ["shadowLinks", "link"],
        ["resources", "asset"],
        ["network", "asset"],
        ["requests", "asset"],
        ["responses", "asset"],
    ];

    for (const [field, sourceKind] of listFields) {
        const values = Array.isArray(pageData[field]) ? pageData[field] : [];
        for (const item of values) {
            const itemUrl = typeof item === "string"
                ? item
                : item?.url || item?.href || item?.src || item?.currentSrc || item?.requestUrl;
            addResource(map, itemUrl, {
                ...(typeof item === "object" && item ? item : {}),
                source: `${pageData.source || "page"}:${field}`,
                type: typeof item === "object" && item?.type ? item.type : sourceKind,
            });
        }
    }
}

export function mergeResearchPayloads(payloads) {
    const resourceMap = new Map();
    const pages = [];
    const warnings = [];
    const rawPayloads = [];

    for (const payload of payloads || []) {
        if (!payload) continue;
        rawPayloads.push(payload);

        if (Array.isArray(payload.warnings)) warnings.push(...payload.warnings.map(String));
        if (payload.warning) warnings.push(String(payload.warning));

        collectPageData(payload.data, resourceMap, pages);
        collectPageData(payload.rendered, resourceMap, pages);
        collectPageData(payload.page, resourceMap, pages);

        for (const result of payload.results || []) {
            collectPageData(result?.data || result, resourceMap, pages);
        }

        for (const probe of payload.probes || payload.apiProbes || []) {
            const url = probe?.url || probe?.requestUrl;
            addResource(resourceMap, url, {
                ...probe,
                type: "api",
                source: "api-probe",
                responsePreview: probe?.bodyPreview || probe?.responsePreview || probe?.body || "",
            });
        }

        const discovered = payload.discovered || {};
        for (const value of Object.values(discovered)) {
            if (!Array.isArray(value)) continue;
            for (const item of value) {
                const itemUrl = typeof item === "string" ? item : item?.url || item?.href || item?.src;
                addResource(resourceMap, itemUrl, {
                    ...(typeof item === "object" && item ? item : {}),
                    source: "discovered",
                });
            }
        }

        for (const item of payload.network || payload.requests || payload.responses || []) {
            const itemUrl = item?.url || item?.requestUrl;
            addResource(resourceMap, itemUrl, {
                ...item,
                source: item?.source || "render-network",
            });
        }
    }

    const resources = [...resourceMap.values()];
    const byKind = {
        api: resources.filter((item) => item.kind === "api"),
        image: resources.filter((item) => item.kind === "image"),
        audio: resources.filter((item) => item.kind === "audio"),
        video: resources.filter((item) => item.kind === "video"),
        manifest: resources.filter((item) => item.kind === "manifest"),
        page: resources.filter((item) => item.kind === "page"),
        asset: resources.filter((item) => item.kind === "asset"),
        link: resources.filter((item) => item.kind === "link"),
        cdn: resources.filter((item) => item.isCdn),
    };

    return {
        pages: dedupePages(pages),
        resources,
        byKind,
        warnings: uniqueStrings(warnings, 100),
        rawPayloads,
        generatedAt: new Date().toISOString(),
    };
}

function dedupePages(pages) {
    const map = new Map();
    for (const page of pages || []) {
        if (!page?.url) continue;
        const current = map.get(page.url);
        if (!current || String(page.html || "").length > String(current.html || "").length) {
            map.set(page.url, page);
        }
    }
    return [...map.values()];
}

export function summarizeJsonShape(value, depth = 0, maxDepth = 3) {
    if (depth > maxDepth) return "…";
    if (Array.isArray(value)) {
        return {
            type: "array",
            length: value.length,
            sample: value.length ? summarizeJsonShape(value[0], depth + 1, maxDepth) : null,
        };
    }
    if (value && typeof value === "object") {
        const output = {};
        for (const key of Object.keys(value).slice(0, 30)) {
            output[key] = summarizeJsonShape(value[key], depth + 1, maxDepth);
        }
        return output;
    }
    return typeof value;
}

export function compareRecords(records) {
    const normalized = (records || []).filter(Boolean).map((record, index) => {
        const data = record.data || record.raw || record;
        const text = String(data.text || data.textPreview || data.description || data.bodyPreview || "");
        const html = String(data.html || data.renderedHtml || "");
        const title = data.title || `Record ${index + 1}`;
        const prices = uniqueStrings(
            `${text}\n${html}`.match(/(?:[$£€]\s?\d[\d,.]*|\d[\d,.]*\s?(?:USD|GBP|EUR))/gi) || [],
            30
        );
        const imageUrls = uniqueStrings(
            (data.images || [])
                .map((item) => typeof item === "string" ? item : item?.url || item?.src)
                .filter(Boolean),
            100
        );
        const apiUrls = uniqueStrings(
            (data.apiHints || data.apiCandidates || [])
                .map((item) => typeof item === "string" ? item : item?.url)
                .filter(Boolean),
            100
        );

        return {
            id: data.url || `${index}`,
            title,
            url: data.url || record.url || "",
            hostname: (() => {
                try { return new URL(data.url || record.url).hostname; } catch { return ""; }
            })(),
            status: data.status ?? record.status ?? null,
            textLength: text.length,
            htmlLength: html.length,
            prices,
            imageCount: imageUrls.length,
            apiCount: apiUrls.length,
            jsonShape: data.json ? summarizeJsonShape(data.json) : null,
            description: data.description || "",
        };
    });

    const allPriceValues = uniqueStrings(normalized.flatMap((item) => item.prices), 100);
    const hosts = uniqueStrings(normalized.map((item) => item.hostname), 30);

    return {
        records: normalized,
        summary: {
            count: normalized.length,
            hosts,
            allPriceValues,
            largestText: [...normalized].sort((a, b) => b.textLength - a.textLength)[0] || null,
            mostImages: [...normalized].sort((a, b) => b.imageCount - a.imageCount)[0] || null,
            mostApis: [...normalized].sort((a, b) => b.apiCount - a.apiCount)[0] || null,
        },
    };
}

export function prepareSandboxHtml(html, baseUrl) {
    const source = String(html || "");
    if (!source) return "";

    const safeBase = normalizeHttpUrl(baseUrl);
    const baseTag = safeBase ? `<base href="${escapeHtmlAttribute(safeBase)}">` : "";
    const guard = `
<script>
(() => {
  try {
    const blocked = ['localStorage', 'sessionStorage'];
    blocked.forEach((name) => {
      try { window[name].clear(); } catch (_) {}
    });
    window.addEventListener('beforeunload', (event) => event.stopImmediatePropagation(), true);
    document.addEventListener('click', (event) => {
      const anchor = event.target && event.target.closest ? event.target.closest('a[href]') : null;
      if (!anchor) return;
      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'noopener noreferrer');
    }, true);
  } catch (_) {}
})();
</script>`;

    if (/<head\b[^>]*>/i.test(source)) {
        return source.replace(/<head\b([^>]*)>/i, `<head$1>${baseTag}${guard}`);
    }

    return `<!doctype html><html><head>${baseTag}${guard}</head><body>${source}</body></html>`;
}

function escapeHtmlAttribute(value) {
    return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll('"', "&quot;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}

export function buildAssistantContext(workspace, options = {}) {
    const maxCharacters = Math.max(4_000, Number(options.maxCharacters || 7_500));
    const selected = Array.isArray(workspace?.selectedResources) ? workspace.selectedResources : [];
    const pages = Array.isArray(workspace?.pages) ? workspace.pages : [];
    const resources = Array.isArray(workspace?.resources) ? workspace.resources : [];
    const comparison = workspace?.comparison || null;

    const compactPages = pages.slice(0, 8).map((page) => ({
        url: page.url,
        title: page.title,
        description: page.description,
        status: page.status,
        text: String(page.text || "").slice(0, 12_000),
    }));

    const compactResources = resources.slice(0, 300).map((item) => ({
        url: item.url,
        kind: item.kind,
        hostname: item.hostname,
        status: item.status,
        method: item.method,
        contentType: item.contentType,
        isCdn: item.isCdn,
        responsePreview: String(item.responsePreview || "").slice(0, 2_500),
    }));

    const compactSelected = selected.slice(0, 40).map((item) => ({
        url: item.url,
        kind: item.kind,
        status: item.status,
        contentType: item.contentType,
        responsePreview: String(item.responsePreview || "").slice(0, 6_000),
    }));

    const payload = {
        instruction: workspace?.instruction || "",
        seedUrls: workspace?.seedUrls || [],
        queries: workspace?.queries || [],
        selectedResources: compactSelected,
        comparison,
        pages: compactPages,
        resources: compactResources,
        warnings: workspace?.warnings || [],
    };

    const serialized = JSON.stringify(payload, null, 2);
    return serialized.length > maxCharacters
        ? `${serialized.slice(0, maxCharacters)}\n\n[Context truncated]`
        : serialized;
}

export function fallbackResearchAnswer(question, workspace) {
    const q = String(question || "").toLowerCase();
    const pages = workspace?.pages || [];
    const resources = workspace?.resources || [];
    const byKind = workspace?.byKind || {};
    const comparison = workspace?.comparison;

    const lines = [];
    lines.push(`I have ${pages.length} page record${pages.length === 1 ? "" : "s"} and ${resources.length} discovered resource${resources.length === 1 ? "" : "s"} in this workspace.`);

    if (/api|endpoint|json|graphql/.test(q)) {
        const apis = (byKind.api || []).slice(0, 12);
        lines.push(`I found ${byKind.api?.length || 0} API-looking resource${byKind.api?.length === 1 ? "" : "s"}.`);
        for (const api of apis) lines.push(`• ${api.method || "GET"} ${api.url}${api.status ? ` → ${api.status}` : ""}`);
    } else if (/image|photo|picture|cdn/.test(q)) {
        const images = (byKind.image || []).slice(0, 12);
        lines.push(`I found ${byKind.image?.length || 0} images and ${byKind.cdn?.length || 0} CDN-hosted resources.`);
        for (const image of images) lines.push(`• ${image.url}`);
    } else if (/audio|video|media|stream|manifest/.test(q)) {
        const media = [
            ...(byKind.audio || []),
            ...(byKind.video || []),
            ...(byKind.manifest || []),
        ].slice(0, 12);
        lines.push(`I found ${media.length} directly classified media or manifest resource${media.length === 1 ? "" : "s"} in the visible sample.`);
        for (const item of media) lines.push(`• ${item.kind}: ${item.url}`);
    } else if (/compare|authentic|grailed|depop|resale|price/.test(q) && comparison) {
        lines.push(`The comparison contains ${comparison.records?.length || 0} records across ${(comparison.summary?.hosts || []).join(", ") || "the loaded sites"}.`);
        if (comparison.summary?.allPriceValues?.length) {
            lines.push(`Price-like values: ${comparison.summary.allPriceValues.slice(0, 15).join(", ")}.`);
        }
        lines.push("Treat authenticity as an evidence review, not a guaranteed verdict: compare listing photos, measurements, tags, seller history, provenance, and platform-specific authentication notes.");
    } else {
        for (const page of pages.slice(0, 5)) {
            lines.push(`• ${page.title || "Untitled"} — ${page.url}`);
        }
        lines.push("Ask about APIs, images, media, CDNs, price signals, or a comparison and I will focus the workspace summary.");
    }

    return lines.join("\n");
}

export function downloadJson(filename, value) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}
