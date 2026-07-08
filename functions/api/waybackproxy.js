const ALLOWED_WAYBACK_HOSTS = [
    "web.archive.org",
    "wayback-api.archive.org",
];

const ALLOWED_ORIGINS = new Set([
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

function isAllowedWaybackHost(hostname) {
    return ALLOWED_WAYBACK_HOSTS.includes(String(hostname || "").toLowerCase());
}

function getCorsHeaders(request) {
    const origin = request.headers.get("Origin") || "";
    const allowOrigin = ALLOWED_ORIGINS.has(origin)
        ? origin
        : "https://audiomasterlab.com";

    return {
        "Access-Control-Allow-Origin": allowOrigin,
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers":
            "Accept, Content-Type, Range, If-None-Match, If-Modified-Since",
        "Access-Control-Expose-Headers":
            "Content-Type, Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin",
    };
}

function jsonError(message, status, corsHeaders, extra = {}) {
    return new Response(JSON.stringify({ error: message, ...extra }), {
        status,
        headers: {
            ...corsHeaders,
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
        },
    });
}

function isAllowedWaybackPath(targetUrl) {
    const host = targetUrl.hostname.toLowerCase();
    const path = targetUrl.pathname;

    if (host === "web.archive.org") {
        return (
            path === "/cdx/search/cdx" ||
            path.startsWith("/web/") ||
            path.startsWith("/save/")
        );
    }

    if (host === "wayback-api.archive.org") {
        return path === "/services/context/notices";
    }

    return false;
}

function isCdxJsonRequest(targetUrl) {
    return (
        targetUrl.hostname.toLowerCase() === "web.archive.org" &&
        targetUrl.pathname === "/cdx/search/cdx" &&
        targetUrl.searchParams.get("output") === "json"
    );
}

export async function onRequest(context) {
    const { request } = context;
    const corsHeaders = getCorsHeaders(request);

    if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
        return jsonError("Method not allowed", 405, corsHeaders);
    }

    const requestUrl = new URL(request.url);
    const rawTargetUrl = requestUrl.searchParams.get("url");

    if (!rawTargetUrl) {
        return jsonError("Missing ?url=", 400, corsHeaders);
    }

    let targetUrl;
    try {
        targetUrl = new URL(rawTargetUrl);
    } catch {
        return jsonError("Invalid target URL", 400, corsHeaders, {
            received: rawTargetUrl,
        });
    }

    if (targetUrl.protocol !== "https:") {
        return jsonError("Only HTTPS URLs are allowed", 400, corsHeaders);
    }

    if (!isAllowedWaybackHost(targetUrl.hostname)) {
        return jsonError("Target host is not allowed", 403, corsHeaders, {
            host: targetUrl.hostname,
        });
    }

    if (!isAllowedWaybackPath(targetUrl)) {
        return jsonError("Target path is not allowed", 403, corsHeaders, {
            path: targetUrl.pathname,
        });
    }

    const upstreamHeaders = new Headers();

    for (const headerName of [
        "Range",
        "Accept",
        "If-None-Match",
        "If-Modified-Since",
    ]) {
        const value = request.headers.get(headerName);
        if (value) upstreamHeaders.set(headerName, value);
    }

    let upstreamResponse;

    try {
        upstreamResponse = await fetch(targetUrl.toString(), {
            method: request.method,
            headers: upstreamHeaders,
            redirect: "follow",
        });
    } catch (error) {
        return jsonError("Wayback upstream request failed", 502, corsHeaders, {
            detail: error?.message || "fetch failed",
        });
    }

    const responseHeaders = new Headers(upstreamResponse.headers);
    responseHeaders.delete("Set-Cookie");

    for (const [key, value] of Object.entries(corsHeaders)) {
        responseHeaders.set(key, value);
    }

    if (isCdxJsonRequest(targetUrl)) {
        responseHeaders.set("Content-Type", "application/json; charset=utf-8");
    }

    responseHeaders.set("Cache-Control", "public, max-age=1800");

    return new Response(
        request.method === "HEAD" ? null : upstreamResponse.body,
        {
            status: upstreamResponse.status,
            statusText: upstreamResponse.statusText,
            headers: responseHeaders,
        }
    );
}