const ALLOWED_TARGET_HOSTS = [
    "archive.org",
    "web.archive.org",
];

const ALLOWED_WAYBACK_PATHS = new Set([
    "/cdx/search/cdx",
    "/wayback/available",
    "/wayback/v1/available",
]);

const MAX_CDX_LIMIT = 100;

function isAllowedWaybackHost(hostname) {
    const host = String(hostname || "").toLowerCase();
    return ALLOWED_TARGET_HOSTS.includes(host);
}

function isAllowedWaybackPath(targetUrl) {
    const path = String(targetUrl?.pathname || "");
    return ALLOWED_WAYBACK_PATHS.has(path);
}

function isAllowedCorsOrigin(origin) {
    const cleanOrigin = String(origin || "").replace(/\/$/, "");

    const allowedOrigins = new Set([
        "https://suiteofficelab.com",
        "https://audiomasterlab.com",
        "https://www.audiomasterlab.com",
        "https://videomasterlab.com",
        "https://videowebsite.unusualsuspectsclothing.workers.dev",
        "https://imagemasterlab.com",
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
        "http://127.0.0.1:5173",
    ]);

    const localDevOriginPattern =
        /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::(?:3000|3001|5173))$/i;

    return allowedOrigins.has(cleanOrigin) || localDevOriginPattern.test(cleanOrigin);
}

function getCorsHeaders(request) {
    const origin = String(request.headers.get("Origin") || "").replace(/\/$/, "");
    const allowedOrigin = isAllowedCorsOrigin(origin)
        ? origin
        : "https://audiomasterlab.com";

    return {
        "Access-Control-Allow-Origin": allowedOrigin,
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers":
            "Accept, Content-Type, If-None-Match, If-Modified-Since",
        "Access-Control-Expose-Headers":
            "Content-Type, Content-Length, ETag, Last-Modified, Cache-Control",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
    };
}

function textResponse(message, status, headers) {
    return new Response(message, {
        status,
        headers: {
            ...headers,
            "Content-Type": "text/plain; charset=utf-8",
        },
    });
}

function normalizeCdxTargetUrl(targetUrl) {
    const url = new URL(targetUrl.toString());

    // Keep the API predictable for frontend JSON parsing.
    url.searchParams.set("output", "json");
    url.searchParams.delete("callback");

    const requestedLimit = Number(url.searchParams.get("limit") || "50");
    const safeLimit = Number.isFinite(requestedLimit)
        ? Math.min(MAX_CDX_LIMIT, Math.max(1, Math.floor(requestedLimit)))
        : 50;
    url.searchParams.set("limit", String(safeLimit));

    // Default fields are small and useful. Keep caller-provided fl if supplied.
    if (!url.searchParams.has("fl")) {
        url.searchParams.set(
            "fl",
            "timestamp,original,statuscode,mimetype,digest,length"
        );
    }

    return url;
}

function normalizeAvailabilityTargetUrl(targetUrl) {
    const url = new URL(targetUrl.toString());
    url.searchParams.delete("callback");

    const requestedUrl = String(url.searchParams.get("url") || "").trim();

    if (requestedUrl) {
        // Match the working frontend request format:
        // https://archive.org/wayback/available?url=audiomasterlab.com
        // Keep the inner target as domain/path instead of forcing https://domain.
        const safeTarget = requestedUrl
            .replace(/^https?:\/\//i, "")
            .replace(/^web\.archive\.org\/web\/\d+(?:id_)?\//i, "")
            .replace(/[<>"']/g, "")
            .replace(/\s+/g, "")
            .replace(/\/+$/g, "")
            .slice(0, 500);

        url.searchParams.set("url", safeTarget);
    }

    return url;
}

function normalizeWaybackTargetUrl(targetUrl) {
    const host = targetUrl.hostname.toLowerCase();
    const path = targetUrl.pathname;
    const isCdx = host === "web.archive.org" && path === "/cdx/search/cdx";
    const isAvailability =
        host === "archive.org" &&
        (path === "/wayback/available" || path === "/wayback/v1/available");

    if (isCdx) return normalizeCdxTargetUrl(targetUrl);
    if (isAvailability) return normalizeAvailabilityTargetUrl(targetUrl);

    const url = new URL(targetUrl.toString());
    url.searchParams.delete("callback");
    return url;
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
        return textResponse("Method not allowed", 405, corsHeaders);
    }

    const requestUrl = new URL(request.url);
    const rawTargetUrl = requestUrl.searchParams.get("url");

    if (!rawTargetUrl) {
        return textResponse("Missing ?url=", 400, corsHeaders);
    }

    let targetUrl;

    try {
        targetUrl = new URL(rawTargetUrl);
    } catch {
        return textResponse("Invalid target URL", 400, corsHeaders);
    }

    if (targetUrl.protocol !== "https:") {
        return textResponse("Only HTTPS URLs are allowed", 400, corsHeaders);
    }

    if (!isAllowedWaybackHost(targetUrl.hostname)) {
        return textResponse("Target host is not allowed", 403, corsHeaders);
    }

    if (!isAllowedWaybackPath(targetUrl)) {
        return textResponse("Target Wayback path is not allowed", 403, corsHeaders);
    }

    const normalizedTargetUrl = normalizeWaybackTargetUrl(targetUrl);
    const upstreamHeaders = new Headers();

    const accept = request.headers.get("Accept");
    upstreamHeaders.set("Accept", accept || "application/json,text/plain,*/*");

    const ifNoneMatch = request.headers.get("If-None-Match");
    if (ifNoneMatch) upstreamHeaders.set("If-None-Match", ifNoneMatch);

    const ifModifiedSince = request.headers.get("If-Modified-Since");
    if (ifModifiedSince) {
        upstreamHeaders.set("If-Modified-Since", ifModifiedSince);
    }

    const upstreamResponse = await fetch(normalizedTargetUrl.toString(), {
        method: request.method,
        headers: upstreamHeaders,
        redirect: "follow",
    });

    if (!upstreamResponse.ok) {
        let upstreamText = "";

        try {
            upstreamText = await upstreamResponse.text();
        } catch {
            upstreamText = "";
        }

        return new Response(
            JSON.stringify(
                {
                    error: "Wayback upstream request failed",
                    upstreamStatus: upstreamResponse.status,
                    upstreamStatusText: upstreamResponse.statusText,
                    targetUrl: normalizedTargetUrl.toString(),
                    upstreamBody: upstreamText.slice(0, 1200),
                },
                null,
                2
            ),
            {
                status: upstreamResponse.status,
                headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json; charset=utf-8",
                    "Cache-Control": "no-store",
                },
            }
        );
    }

    const responseHeaders = new Headers(upstreamResponse.headers);
    responseHeaders.delete("Set-Cookie");
    responseHeaders.delete("Cookie");

    for (const [key, value] of Object.entries(corsHeaders)) {
        responseHeaders.set(key, value);
    }

    responseHeaders.set("Cache-Control", "public, max-age=900, s-maxage=3600");

    return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: responseHeaders,
    });
}
