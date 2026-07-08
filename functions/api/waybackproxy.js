// api/waybackproxy.js
//
// Purpose:
//   Proxy only the Internet Archive CDX API:
//   https://web.archive.org/cdx/search/cdx?url=rafsimons.com
//
// This version does not proxy wayback-api.archive.org and does not proxy arbitrary
// /web/ replay URLs. It accepts CDX query params from the frontend and builds the
// upstream URL itself.
//
// Frontend examples:
//   /api/waybackproxy?url=rafsimons.com
//   /api/waybackproxy?url=rafsimons.com&output=json&fl=timestamp,original,statuscode,mimetype,digest,length
//   /api/waybackproxy?url=archive.org/download/*lil*uzi*vert*&output=json&filter=statuscode:200&filter=mimetype:audio/.*

const CDX_API_URL = "https://web.archive.org/cdx/search/cdx";

const ALLOWED_ORIGINS = new Set([
    "https://audiomasterlab.com",
    "https://www.audiomasterlab.com",
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:4173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    "http://127.0.0.1:5173",
]);

const ALLOWED_CDX_PARAMS = new Set([
    "url",
    "matchType",
    "from",
    "to",
    "output",
    "fl",
    "filter",
    "collapse",
    "limit",
    "page",
    "pageSize",
    "showResumeKey",
    "resumeKey",
    "fastLatest",
    "fastLatest2",
    "sort",
]);

const DEFAULT_CDX_FIELDS = [
    "urlkey",
    "timestamp",
    "original",
    "mimetype",
    "statuscode",
    "digest",
    "length",
];

function getCorsHeaders(request) {
    const origin = request.headers.get("Origin") || "";
    const allowOrigin = ALLOWED_ORIGINS.has(origin)
        ? origin
        : "https://audiomasterlab.com";

    return {
        "Access-Control-Allow-Origin": allowOrigin,
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Accept, Content-Type",
        "Access-Control-Expose-Headers": "Content-Type, Content-Length",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
    };
}

function jsonResponse(data, status, corsHeaders) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            ...corsHeaders,
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
        },
    });
}

function jsonError(message, status, corsHeaders, extra = {}) {
    return jsonResponse({ error: message, ...extra }, status, corsHeaders);
}

function normalizeCdxUrlTarget(value) {
    return String(value || "")
        .trim()
        .replace(/^https?:\/\/web\.archive\.org\/cdx\/search\/cdx\?/i, "")
        .slice(0, 500);
}

function isUnsafeCdxTarget(value) {
    const text = String(value || "").trim().toLowerCase();

    return (
        !text ||
        text.startsWith("javascript:") ||
        text.startsWith("data:") ||
        text.startsWith("file:") ||
        text.includes("\n") ||
        text.includes("\r")
    );
}

function appendAllowedCdxParams(sourceParams, targetParams) {
    for (const [key, value] of sourceParams.entries()) {
        if (!ALLOWED_CDX_PARAMS.has(key)) continue;
        if (key === "target" || key === "source") continue;

        if (key === "url") {
            const cleanTarget = normalizeCdxUrlTarget(value);
            if (!isUnsafeCdxTarget(cleanTarget)) {
                targetParams.append("url", cleanTarget);
            }
            continue;
        }

        targetParams.append(key, value);
    }
}

function buildCdxApiUrl(requestUrl) {
    const params = new URLSearchParams();

    appendAllowedCdxParams(requestUrl.searchParams, params);

    if (!params.has("url")) {
        throw new Error("Missing ?url=. Example: /api/waybackproxy?url=rafsimons.com");
    }

    if (!params.has("fl")) {
        params.set("fl", DEFAULT_CDX_FIELDS.join(","));
    }

    if (!params.has("limit")) {
        params.set("limit", "100");
    }

    return `${CDX_API_URL}?${params.toString()}`;
}

export async function onRequest(context) {
    const { request } = context;
    const corsHeaders = getCorsHeaders(request);

    if (request.method === "OPTIONS") {
        return new Response(null, {
            status: 204,
            headers: corsHeaders,
        });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
        return jsonError("Method not allowed", 405, corsHeaders);
    }

    const requestUrl = new URL(request.url);
    let upstreamUrl;

    try {
        upstreamUrl = buildCdxApiUrl(requestUrl);
    } catch (error) {
        return jsonError(error?.message || "Invalid CDX request", 400, corsHeaders);
    }

    let upstreamResponse;

    try {
        upstreamResponse = await fetch(upstreamUrl, {
            method: request.method,
            headers: {
                Accept: request.headers.get("Accept") || "*/*",
                "User-Agent": "AudioMasterLab-CDX-Proxy/1.0",
            },
        });
    } catch (error) {
        return jsonError("CDX upstream request failed", 502, corsHeaders, {
            upstream: upstreamUrl,
            detail: error?.message || "fetch failed",
        });
    }

    const responseHeaders = new Headers(upstreamResponse.headers);
    responseHeaders.delete("Set-Cookie");

    for (const [key, value] of Object.entries(corsHeaders)) {
        responseHeaders.set(key, value);
    }

    const outputMode = requestUrl.searchParams.get("output");
    if (outputMode === "json") {
        responseHeaders.set("Content-Type", "application/json; charset=utf-8");
    } else {
        responseHeaders.set("Content-Type", "text/plain; charset=utf-8");
    }

    responseHeaders.set("Cache-Control", "public, max-age=1800");
    responseHeaders.set("X-AudioMasterLab-Upstream", upstreamUrl);

    return new Response(request.method === "HEAD" ? null : upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: responseHeaders,
    });
}
