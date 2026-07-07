const ALLOWED_OPENVERSE_HOSTS = [
    "api.openverse.org",
];

function isAllowedOpenverseHost(hostname) {
    const host = String(hostname || "").toLowerCase();
    return ALLOWED_OPENVERSE_HOSTS.includes(host);
}

function isAllowedOpenversePath(targetUrl) {
    const path = targetUrl.pathname;

    return (
        path === "/v1/images/" ||
        path.startsWith("/v1/images/") ||
        path === "/v1/audio/" ||
        path.startsWith("/v1/audio/") ||
        path === "/v1/rate_limit/"
    );
}

function getCorsHeaders(request) {
    const origin = request.headers.get("Origin") || "";

    const allowedOrigins = new Set([
        "https://audiomasterlab.com",
        "https://www.audiomasterlab.com",
        "http://localhost:3000",
        "http://localhost:5173",
    ]);

    return {
        "Access-Control-Allow-Origin": allowedOrigins.has(origin)
            ? origin
            : "https://audiomasterlab.com",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers":
            "Accept, Content-Type, Range, If-None-Match, If-Modified-Since",
        "Access-Control-Expose-Headers":
            "Content-Type, Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
    };
}

export async function onRequest(context) {
    const { request, env } = context;
    const corsHeaders = getCorsHeaders(request);

    if (request.method === "OPTIONS") {
        return new Response(null, {
            status: 204,
            headers: corsHeaders,
        });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method not allowed", {
            status: 405,
            headers: corsHeaders,
        });
    }

    const requestUrl = new URL(request.url);
    const rawTargetUrl = requestUrl.searchParams.get("url");

    if (!rawTargetUrl) {
        return new Response("Missing ?url=", {
            status: 400,
            headers: corsHeaders,
        });
    }

    let targetUrl;

    try {
        targetUrl = new URL(rawTargetUrl);
    } catch {
        return new Response("Invalid target URL", {
            status: 400,
            headers: corsHeaders,
        });
    }

    if (targetUrl.protocol !== "https:") {
        return new Response("Only HTTPS URLs are allowed", {
            status: 400,
            headers: corsHeaders,
        });
    }

    if (!isAllowedOpenverseHost(targetUrl.hostname)) {
        return new Response("Target host is not allowed", {
            status: 403,
            headers: corsHeaders,
        });
    }

    if (!isAllowedOpenversePath(targetUrl)) {
        return new Response("Target path is not allowed", {
            status: 403,
            headers: corsHeaders,
        });
    }

    const upstreamHeaders = new Headers();

    const accept = request.headers.get("Accept");
    if (accept) upstreamHeaders.set("Accept", accept);

    const range = request.headers.get("Range");
    if (range) upstreamHeaders.set("Range", range);

    const ifNoneMatch = request.headers.get("If-None-Match");
    if (ifNoneMatch) upstreamHeaders.set("If-None-Match", ifNoneMatch);

    const ifModifiedSince = request.headers.get("If-Modified-Since");
    if (ifModifiedSince) {
        upstreamHeaders.set("If-Modified-Since", ifModifiedSince);
    }

    if (env.OPENVERSE_ACCESS_TOKEN) {
        upstreamHeaders.set("Authorization", `Bearer ${env.OPENVERSE_ACCESS_TOKEN}`);
    }

    const upstreamResponse = await fetch(targetUrl.toString(), {
        method: request.method,
        headers: upstreamHeaders,
        redirect: "follow",
    });

    const responseHeaders = new Headers(upstreamResponse.headers);

    responseHeaders.delete("Set-Cookie");

    for (const [key, value] of Object.entries(corsHeaders)) {
        responseHeaders.set(key, value);
    }

    responseHeaders.set("Cache-Control", "public, max-age=1800");

    return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: responseHeaders,
    });
}