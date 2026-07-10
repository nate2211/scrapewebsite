const ALLOWED_TARGET_HOSTS = new Set([
    "www.npr.org",
    "npr.org",
]);

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

function normalizeHost(hostname) {
    return String(hostname || "").toLowerCase();
}

function isAllowedNprHost(hostname) {
    return ALLOWED_TARGET_HOSTS.has(normalizeHost(hostname));
}

function isAllowedNprArticlePath(targetUrl) {
    const path = targetUrl.pathname || "";

    if (path === "/" || path === "/sections" || path === "/sections/") {
        return false;
    }

    if (path.includes("..")) {
        return false;
    }

    // NPR article URLs commonly look like:
    // /2026/07/09/nx-s1-xxxxx/story-title
    // /sections/music/2026/07/09/nx-s1-xxxxx/story-title
    // /2026/7/story-title
    const articlePatterns = [
        /^\/\d{4}\/\d{2}\/\d{2}\/[^/]+\/[^/]+\/?$/i,
        /^\/sections\/[a-z0-9-]+\/\d{4}\/\d{2}\/\d{2}\/[^/]+\/[^/]+\/?$/i,
        /^\/sections\/[a-z0-9-]+\/\d{4}\/\d{1,2}\/\d{1,2}\/[^/]+\/[^/]+\/?$/i,
        /^\/\d{4}\/\d{1,2}\/\d{1,2}\/[^/]+\/?$/i,
        /^\/\d{4}\/\d{1,2}\/[^/]+\/?$/i,
    ];

    return articlePatterns.some((pattern) => pattern.test(path));
}

function getCorsHeaders(request) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = ALLOWED_ORIGINS.has(origin)
        ? origin
        : "https://audiomasterlab.com";

    return {
        "Access-Control-Allow-Origin": allowedOrigin,
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers":
            "Accept, Content-Type, If-None-Match, If-Modified-Since",
        "Access-Control-Expose-Headers":
            "Content-Type, Content-Length, ETag, Last-Modified, Cache-Control, X-Proxy-Target-Host",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin",
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

function jsonResponse(data, status, headers, cacheControl = "no-store") {
    return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: {
            ...headers,
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": cacheControl,
        },
    });
}

function isHtmlResponse(text) {
    const value = String(text || "").trim().slice(0, 300).toLowerCase();

    return (
        value.startsWith("<!doctype html") ||
        value.startsWith("<html") ||
        value.includes("<head") ||
        value.includes("<body")
    );
}

function extractMeta(html, selectors) {
    for (const selector of selectors) {
        const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

        const propertyRegex = new RegExp(
            `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`,
            "i"
        );

        const propertyMatch = html.match(propertyRegex);
        if (propertyMatch?.[1]) {
            return propertyMatch[1].replace(/&amp;/g, "&").trim();
        }

        const reverseRegex = new RegExp(
            `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`,
            "i"
        );

        const reverseMatch = html.match(reverseRegex);
        if (reverseMatch?.[1]) {
            return reverseMatch[1].replace(/&amp;/g, "&").trim();
        }
    }

    return "";
}

function extractTitle(html) {
    return (
        extractMeta(html, ["og:title", "twitter:title"]) ||
        (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "")
            .replace(/\s+/g, " ")
            .replace(/&amp;/g, "&")
            .trim()
    );
}

function extractDescription(html) {
    return extractMeta(html, [
        "og:description",
        "twitter:description",
        "description",
    ]);
}

function extractImage(html) {
    const metaImage = extractMeta(html, [
        "og:image",
        "og:image:url",
        "twitter:image",
        "twitter:image:src",
    ]);

    if (metaImage) return metaImage;

    const jsonLdMatches = html.match(
        /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    );

    if (jsonLdMatches) {
        for (const block of jsonLdMatches) {
            const jsonText =
                block.match(/<script[^>]*>([\s\S]*?)<\/script>/i)?.[1] || "";

            try {
                const data = JSON.parse(jsonText.trim());
                const list = Array.isArray(data) ? data : [data];

                for (const item of list) {
                    const imageValue = item?.image;
                    const candidate =
                        typeof imageValue === "string"
                            ? imageValue
                            : Array.isArray(imageValue)
                                ? imageValue[0]
                                : imageValue?.url;

                    if (candidate) return String(candidate).replace(/&amp;/g, "&");
                }
            } catch {
                // Ignore malformed JSON-LD blocks.
            }
        }
    }

    const imgMatch = html.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (imgMatch?.[1]) {
        return imgMatch[1].replace(/&amp;/g, "&").trim();
    }

    return "";
}

function extractPublishedAt(html) {
    return (
        extractMeta(html, [
            "article:published_time",
            "article:modified_time",
            "date",
            "pubdate",
        ]) ||
        html.match(/<time[^>]+datetime=["']([^"']+)["']/i)?.[1] ||
        ""
    );
}

function absoluteUrl(value, baseUrl) {
    const text = String(value || "").trim();

    if (!text) return "";

    try {
        return new URL(text, baseUrl).toString();
    } catch {
        return "";
    }
}

function getTargetUrlFromRequest(requestUrl) {
    return requestUrl.searchParams.get("url") || requestUrl.searchParams.get("u");
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
    const wantsJson =
        requestUrl.searchParams.get("format") === "json" ||
        requestUrl.searchParams.get("extract") === "1";

    if (!rawTargetUrl) {
        return textResponse(
            "Missing ?url=. Example: /api/nprarticleproxy?url=https%3A%2F%2Fwww.npr.org%2F2026%2F07%2F09%2Fexample",
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

    if (targetUrl.protocol !== "https:") {
        return textResponse("Only HTTPS NPR article URLs are allowed", 400, corsHeaders);
    }

    if (!isAllowedNprHost(targetUrl.hostname)) {
        return textResponse("Target host is not allowed", 403, corsHeaders);
    }

    if (!isAllowedNprArticlePath(targetUrl)) {
        return textResponse("Target NPR article path is not allowed", 403, corsHeaders);
    }

    const upstreamHeaders = new Headers();

    upstreamHeaders.set(
        "User-Agent",
        "AudioMasterLab-NPRArticleProxy/1.0 (+https://audiomasterlab.com)"
    );

    upstreamHeaders.set(
        "Accept",
        request.headers.get("Accept") ||
        "text/html, application/xhtml+xml, application/xml;q=0.9, */*;q=0.8"
    );

    const ifNoneMatch = request.headers.get("If-None-Match");
    if (ifNoneMatch) upstreamHeaders.set("If-None-Match", ifNoneMatch);

    const ifModifiedSince = request.headers.get("If-Modified-Since");
    if (ifModifiedSince) upstreamHeaders.set("If-Modified-Since", ifModifiedSince);

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
        return jsonResponse(
            {
                error: "NPR article upstream request failed",
                message: error instanceof Error ? error.message : String(error),
                targetUrl: targetUrl.toString(),
            },
            502,
            corsHeaders
        );
    }

    const contentType = upstreamResponse.headers.get("Content-Type") || "";
    const responseHeaders = new Headers(upstreamResponse.headers);

    responseHeaders.delete("Set-Cookie");
    responseHeaders.delete("Content-Security-Policy");
    responseHeaders.delete("X-Frame-Options");

    for (const [key, value] of Object.entries(corsHeaders)) {
        responseHeaders.set(key, value);
    }

    responseHeaders.set("X-Proxy-Target-Host", targetUrl.hostname);
    responseHeaders.set("Cache-Control", "public, max-age=900, s-maxage=900");

    if (!upstreamResponse.ok) {
        const body = await upstreamResponse.text();

        return jsonResponse(
            {
                error: "NPR article upstream returned an error",
                upstreamStatus: upstreamResponse.status,
                upstreamStatusText: upstreamResponse.statusText,
                targetUrl: targetUrl.toString(),
                preview: body.slice(0, 500),
            },
            upstreamResponse.status,
            corsHeaders
        );
    }

    if (request.method === "HEAD") {
        return new Response(null, {
            status: upstreamResponse.status,
            statusText: upstreamResponse.statusText,
            headers: responseHeaders,
        });
    }

    const html = await upstreamResponse.text();

    if (!isHtmlResponse(html) && !contentType.toLowerCase().includes("html")) {
        return jsonResponse(
            {
                error: "NPR article upstream did not return HTML",
                targetUrl: targetUrl.toString(),
                contentType,
                preview: html.slice(0, 500),
            },
            502,
            corsHeaders
        );
    }

    if (wantsJson) {
        const image = absoluteUrl(extractImage(html), targetUrl.toString());

        return jsonResponse(
            {
                ok: true,
                source: "npr",
                url: targetUrl.toString(),
                title: extractTitle(html),
                description: extractDescription(html),
                image,
                publishedAt: extractPublishedAt(html),
            },
            200,
            corsHeaders,
            "public, max-age=900, s-maxage=900"
        );
    }

    responseHeaders.set("Content-Type", "text/html; charset=utf-8");

    return new Response(html, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: responseHeaders,
    });
}