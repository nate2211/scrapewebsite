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

function getCorsHeaders(request) {
    const origin = request.headers.get("Origin") || "";

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
    ]);

    return {
        "Access-Control-Allow-Origin": allowedOrigins.has(origin)
            ? origin
            : "https://audiomasterlab.com",
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

function normalizeWaybackTargetUrl(targetUrl) {
    const isCdx =
        targetUrl.hostname.toLowerCase() === "web.archive.org" &&
        targetUrl.pathname === "/cdx/search/cdx";

    if (isCdx) return normalizeCdxTargetUrl(targetUrl);

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
