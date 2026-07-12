const ALLOWED_TARGET_HOSTS = [
    "www.youtube.com",
    "youtube.com",
];

function isAllowedYoutubeHost(hostname) {
    const host = String(hostname || "").toLowerCase();
    return ALLOWED_TARGET_HOSTS.includes(host);
}

function isAllowedYoutubeRssPath(targetUrl) {
    if (targetUrl.pathname !== "/feeds/videos.xml") {
        return false;
    }

    const channelId = targetUrl.searchParams.get("channel_id");

    if (!channelId) {
        return false;
    }

    // YouTube channel IDs normally look like UCxxxxxxxxxxxxxxxxxxxxxx.
    return /^[A-Za-z0-9_-]{10,80}$/.test(channelId);
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
        "http://localhost:45678",
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

    if (!isAllowedYoutubeHost(targetUrl.hostname)) {
        return new Response("Target host is not allowed", {
            status: 403,
            headers: corsHeaders,
        });
    }

    if (!isAllowedYoutubeRssPath(targetUrl)) {
        return new Response("Target YouTube RSS URL is not allowed", {
            status: 403,
            headers: corsHeaders,
        });
    }

    const upstreamHeaders = new Headers();

    upstreamHeaders.set(
        "User-Agent",
        "AudioMasterLab/1.0 (+https://audiomasterlab.com)"
    );
    upstreamHeaders.set(
        "Accept",
        request.headers.get("Accept") || "application/atom+xml, application/xml, text/xml, */*"
    );

    const ifNoneMatch = request.headers.get("If-None-Match");
    if (ifNoneMatch) upstreamHeaders.set("If-None-Match", ifNoneMatch);

    const ifModifiedSince = request.headers.get("If-Modified-Since");
    if (ifModifiedSince) {
        upstreamHeaders.set("If-Modified-Since", ifModifiedSince);
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

    responseHeaders.set("Cache-Control", "public, max-age=900");

    return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: responseHeaders,
    });
}