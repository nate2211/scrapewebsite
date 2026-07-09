const ALLOWED_TARGET_HOSTS = [
    "feeds.feedburner.com",
    "hypebeast.com",
    "www.hypebeast.com",
    "rss.app",
];

const PRESET_TARGETS = {
    main: "http://feeds.feedburner.com/hypebeast/feed",

    // These are Hypebeast HTML category pages.
    // Use RSS.app-generated URLs for true category RSS feeds.
    latest: "https://hypebeast.com/latest",
    fashion: "https://hypebeast.com/fashion",
    footwear: "https://hypebeast.com/footwear",
    art: "https://hypebeast.com/art",
    design: "https://hypebeast.com/design",
    music: "https://hypebeast.com/music",
};

function normalizeHost(hostname) {
    return String(hostname || "").toLowerCase();
}

function isAllowedTargetHost(hostname) {
    return ALLOWED_TARGET_HOSTS.includes(normalizeHost(hostname));
}

function isFeedBurnerHost(hostname) {
    return normalizeHost(hostname) === "feeds.feedburner.com";
}

function isHypebeastHost(hostname) {
    const host = normalizeHost(hostname);
    return host === "hypebeast.com" || host === "www.hypebeast.com";
}

function isRssAppHost(hostname) {
    return normalizeHost(hostname) === "rss.app";
}

function isAllowedHypebeastPath(targetUrl) {
    const path = targetUrl.pathname;

    if (
        path === "/" ||
        path === "/latest" ||
        path === "/fashion" ||
        path === "/footwear" ||
        path === "/art" ||
        path === "/design" ||
        path === "/music" ||
        path === "/lifestyle"
    ) {
        return true;
    }

    // Allows real Hypebeast article pages like:
    // /2026/7/example-article-title
    if (/^\/\d{4}\/\d{1,2}\/[a-z0-9-]+\/?$/.test(path)) {
        return true;
    }

    return false;
}

function isAllowedRssAppPath(targetUrl) {
    const path = targetUrl.pathname;

    // Typical RSS.app feed URLs look like:
    // https://rss.app/feeds/xxxxxxxx.xml
    return path.startsWith("/feeds/") && /\.(xml|rss)$/i.test(path);
}

function isAllowedFeedBurnerPath(targetUrl) {
    const path = targetUrl.pathname;

    return (
        path === "/hypebeast/feed" ||
        path === "/hypebeast" ||
        path.startsWith("/hypebeast/")
    );
}

function isAllowedTargetUrl(targetUrl) {
    if (!isAllowedTargetHost(targetUrl.hostname)) {
        return false;
    }

    if (isFeedBurnerHost(targetUrl.hostname)) {
        return (
            (targetUrl.protocol === "http:" || targetUrl.protocol === "https:") &&
            isAllowedFeedBurnerPath(targetUrl)
        );
    }

    if (targetUrl.protocol !== "https:") {
        return false;
    }

    if (isHypebeastHost(targetUrl.hostname)) {
        return isAllowedHypebeastPath(targetUrl);
    }

    if (isRssAppHost(targetUrl.hostname)) {
        return isAllowedRssAppPath(targetUrl);
    }

    return false;
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
            "Accept, Content-Type, Range, If-None-Match, If-Modified-Since",
        "Access-Control-Expose-Headers":
            "Content-Type, Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified, Cache-Control",
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
            "Cache-Control": "no-store",
        },
    });
}

function getTargetUrlFromRequest(requestUrl) {
    const rawUrl = requestUrl.searchParams.get("url");

    if (rawUrl) {
        return rawUrl;
    }

    const feedKey = String(requestUrl.searchParams.get("feed") || "main")
        .trim()
        .toLowerCase();

    return PRESET_TARGETS[feedKey] || null;
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
    const rawTargetUrl = getTargetUrlFromRequest(requestUrl);

    if (!rawTargetUrl) {
        return textResponse(
            "Missing target. Use ?feed=main, ?feed=fashion, or ?url=https%3A%2F%2Frss.app%2Ffeeds%2Fexample.xml",
            400,
            corsHeaders
        );
    }

    let targetUrl;

    try {
        targetUrl = new URL(rawTargetUrl);
    } catch {
        return textResponse("Invalid target URL", 400, corsHeaders);
    }

    if (!isAllowedTargetUrl(targetUrl)) {
        return textResponse("Target URL is not allowed", 403, corsHeaders);
    }

    const upstreamHeaders = new Headers();

    const range = request.headers.get("Range");
    if (range) upstreamHeaders.set("Range", range);

    const accept =
        request.headers.get("Accept") ||
        "application/rss+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8";
    upstreamHeaders.set("Accept", accept);

    const ifNoneMatch = request.headers.get("If-None-Match");
    if (ifNoneMatch) upstreamHeaders.set("If-None-Match", ifNoneMatch);

    const ifModifiedSince = request.headers.get("If-Modified-Since");
    if (ifModifiedSince) {
        upstreamHeaders.set("If-Modified-Since", ifModifiedSince);
    }

    upstreamHeaders.set(
        "User-Agent",
        "AudioMasterLab-NewsProxy/1.0 (+https://audiomasterlab.com)"
    );

    let upstreamResponse;

    try {
        upstreamResponse = await fetch(targetUrl.toString(), {
            method: request.method,
            headers: upstreamHeaders,
            redirect: "follow",
            cf: {
                cacheTtl: 900,
                cacheEverything: true,
            },
        });
    } catch (error) {
        return new Response(
            JSON.stringify(
                {
                    error: "Hypebeast upstream request failed",
                    message: error instanceof Error ? error.message : String(error),
                    targetUrl: targetUrl.toString(),
                },
                null,
                2
            ),
            {
                status: 502,
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
    responseHeaders.delete("Content-Security-Policy");
    responseHeaders.delete("X-Frame-Options");

    for (const [key, value] of Object.entries(corsHeaders)) {
        responseHeaders.set(key, value);
    }

    if (!responseHeaders.get("Content-Type")) {
        if (isFeedBurnerHost(targetUrl.hostname) || isRssAppHost(targetUrl.hostname)) {
            responseHeaders.set("Content-Type", "application/xml; charset=utf-8");
        } else {
            responseHeaders.set("Content-Type", "text/html; charset=utf-8");
        }
    }

    responseHeaders.set("Cache-Control", "public, max-age=900, s-maxage=900");
    responseHeaders.set("X-Proxy-Target-Host", targetUrl.hostname);

    return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: responseHeaders,
    });
}