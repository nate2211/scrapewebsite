const ALLOWED_TARGET_HOSTS = [
    "www.youtube.com",
    "youtube.com",
];

const ALLOWED_EMBED_URL_HOSTS = [
    "www.youtube.com",
    "youtube.com",
    "m.youtube.com",
    "youtu.be",
];

function isAllowedYoutubeOembedHost(hostname) {
    const host = String(hostname || "").toLowerCase();
    return ALLOWED_TARGET_HOSTS.includes(host);
}

function isAllowedYoutubeVideoUrl(rawUrl) {
    if (!rawUrl) return false;

    let videoUrl;

    try {
        videoUrl = new URL(rawUrl);
    } catch {
        return false;
    }

    if (videoUrl.protocol !== "https:") {
        return false;
    }

    const host = videoUrl.hostname.toLowerCase();

    if (!ALLOWED_EMBED_URL_HOSTS.includes(host)) {
        return false;
    }

    if (host === "youtu.be") {
        return /^\/[A-Za-z0-9_-]{6,128}$/.test(videoUrl.pathname);
    }

    if (videoUrl.pathname === "/watch") {
        const videoId = videoUrl.searchParams.get("v");
        return !!videoId && /^[A-Za-z0-9_-]{6,128}$/.test(videoId);
    }

    if (videoUrl.pathname.startsWith("/shorts/")) {
        return /^\/shorts\/[A-Za-z0-9_-]{6,128}$/.test(videoUrl.pathname);
    }

    if (videoUrl.pathname.startsWith("/embed/")) {
        return /^\/embed\/[A-Za-z0-9_-]{6,128}$/.test(videoUrl.pathname);
    }

    return false;
}

function isAllowedYoutubeOembedPath(targetUrl) {
    if (targetUrl.pathname !== "/oembed") {
        return false;
    }

    const format = targetUrl.searchParams.get("format");
    if (format && format !== "json") {
        return false;
    }

    const embedUrl = targetUrl.searchParams.get("url");
    return isAllowedYoutubeVideoUrl(embedUrl);
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

    if (!isAllowedYoutubeOembedHost(targetUrl.hostname)) {
        return new Response("Target host is not allowed", {
            status: 403,
            headers: corsHeaders,
        });
    }

    if (!isAllowedYoutubeOembedPath(targetUrl)) {
        return new Response("Target YouTube oEmbed URL is not allowed", {
            status: 403,
            headers: corsHeaders,
        });
    }

    const upstreamHeaders = new Headers();

    upstreamHeaders.set(
        "User-Agent",
        "AudioMasterLab/1.0 (+https://audiomasterlab.com)"
    );
    upstreamHeaders.set("Accept", request.headers.get("Accept") || "application/json");

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

    responseHeaders.set("Cache-Control", "public, max-age=86400");

    return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: responseHeaders,
    });
}