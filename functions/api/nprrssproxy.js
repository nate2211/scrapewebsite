const ALLOWED_TARGET_HOSTS = new Set(["feeds.npr.org"]);

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
    "http://localhost:45678",
]);

function corsHeaders(request) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = ALLOWED_ORIGINS.has(origin)
        ? origin
        : "https://audiomasterlab.com";

    return {
        "Access-Control-Allow-Origin": allowedOrigin,
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Accept, If-None-Match, If-Modified-Since",
        "Access-Control-Expose-Headers": "Content-Type, Cache-Control, ETag, Last-Modified, X-Proxy-Target-URL",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
    };
}

function json(data, status, request, cacheControl = "no-store") {
    return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: {
            ...corsHeaders(request),
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": cacheControl,
        },
    });
}

function text(body, status, request, contentType = "text/plain; charset=utf-8", cacheControl = "no-store") {
    return new Response(body, {
        status,
        headers: {
            ...corsHeaders(request),
            "Content-Type": contentType,
            "Cache-Control": cacheControl,
        },
    });
}

function isAllowedTarget(targetUrl) {
    if (targetUrl.protocol !== "https:") return false;
    if (!ALLOWED_TARGET_HOSTS.has(targetUrl.hostname.toLowerCase())) return false;
    return /^\/\d+\/rss\.xml$/i.test(targetUrl.pathname);
}

function getTargetUrl(request) {
    const requestUrl = new URL(request.url);
    const raw = requestUrl.searchParams.get("url") || "https://feeds.npr.org/1039/rss.xml";

    let targetUrl;
    try {
        targetUrl = new URL(raw);
    } catch {
        throw new Error("Invalid ?url= parameter.");
    }

    if (!isAllowedTarget(targetUrl)) {
        throw new Error("Only NPR RSS feed URLs like https://feeds.npr.org/1039/rss.xml are allowed.");
    }

    targetUrl.hash = "";
    return targetUrl;
}

export async function onRequestOptions({ request }) {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function onRequestHead({ request }) {
    return onRequestGet({ request, headOnly: true });
}

export async function onRequestGet({ request, headOnly = false }) {
    let targetUrl;

    try {
        targetUrl = getTargetUrl(request);
    } catch (error) {
        return json(
            {
                error: "Bad NPR RSS proxy request",
                message: error?.message || String(error),
            },
            400,
            request
        );
    }

    const upstreamHeaders = new Headers({
        Accept: "application/rss+xml, application/xml, text/xml, */*",
        "User-Agent": "AudioMasterLabRSSProxy/1.0 (+https://audiomasterlab.com/news)",
    });

    const ifNoneMatch = request.headers.get("If-None-Match");
    if (ifNoneMatch) upstreamHeaders.set("If-None-Match", ifNoneMatch);

    const ifModifiedSince = request.headers.get("If-Modified-Since");
    if (ifModifiedSince) upstreamHeaders.set("If-Modified-Since", ifModifiedSince);

    try {
        const upstream = await fetch(targetUrl.toString(), {
            method: headOnly ? "HEAD" : "GET",
            headers: upstreamHeaders,
            redirect: "follow",
            cf: {
                cacheTtl: 900,
                cacheEverything: true,
            },
        });

        const headers = new Headers(upstream.headers);
        headers.delete("Set-Cookie");

        for (const [key, value] of Object.entries(corsHeaders(request))) {
            headers.set(key, value);
        }

        headers.set("Content-Type", "application/rss+xml; charset=utf-8");
        headers.set("Cache-Control", "public, max-age=300, s-maxage=900");
        headers.set("X-Proxy-Target-URL", targetUrl.toString());

        if (headOnly) {
            return new Response(null, {
                status: upstream.status,
                statusText: upstream.statusText,
                headers,
            });
        }

        const body = await upstream.text();

        if (!upstream.ok) {
            return json(
                {
                    error: "NPR RSS upstream request failed",
                    upstreamStatus: upstream.status,
                    upstreamStatusText: upstream.statusText || "<none>",
                    targetUrl: targetUrl.toString(),
                    preview: body.slice(0, 600),
                },
                502,
                request
            );
        }

        if (/<!doctype html|<html|<div id=["']root["']><\/div>/i.test(body)) {
            return json(
                {
                    error: "NPR RSS upstream returned HTML instead of RSS XML",
                    targetUrl: targetUrl.toString(),
                    preview: body.slice(0, 600),
                },
                502,
                request
            );
        }

        return new Response(body, {
            status: 200,
            headers,
        });
    } catch (error) {
        return json(
            {
                error: "NPR RSS upstream fetch failed",
                message: error?.message || String(error),
                targetUrl: targetUrl.toString(),
            },
            502,
            request
        );
    }
}