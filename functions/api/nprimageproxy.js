const ALLOWED_TARGET_HOSTS = new Set([
    "media.npr.org",
    "npr.brightspotcdn.com",
    "npr-brightspot.s3.amazonaws.com",
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

function json(data, status, request) {
    return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: {
            ...corsHeaders(request),
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
        },
    });
}

function isAllowedTarget(targetUrl) {
    if (targetUrl.protocol !== "https:" && targetUrl.protocol !== "http:") return false;

    const host = targetUrl.hostname.toLowerCase();

    if (!ALLOWED_TARGET_HOSTS.has(host)) return false;

    if (targetUrl.pathname.includes("..")) return false;

    const pathLooksImage = /\.(jpg|jpeg|png|webp|gif|avif)$/i.test(targetUrl.pathname);
    const isBrightspotDims = host === "npr.brightspotcdn.com" && targetUrl.pathname.startsWith("/dims3/");

    return pathLooksImage || isBrightspotDims;
}

function getTargetUrl(request) {
    const requestUrl = new URL(request.url);
    const raw = requestUrl.searchParams.get("url");

    if (!raw) throw new Error("Missing ?url= parameter.");

    let targetUrl;

    try {
        targetUrl = new URL(raw);
    } catch {
        throw new Error("Invalid target URL.");
    }

    if (!isAllowedTarget(targetUrl)) {
        throw new Error("Only NPR image CDN URLs are allowed.");
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
                error: "Bad NPR image proxy request",
                message: error?.message || String(error),
            },
            400,
            request
        );
    }

    try {
        const upstream = await fetch(targetUrl.toString(), {
            method: headOnly ? "HEAD" : "GET",
            headers: {
                Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
                "User-Agent": "AudioMasterLabImageProxy/1.0 (+https://audiomasterlab.com/news)",
            },
            redirect: "follow",
            cf: {
                cacheTtl: 86400,
                cacheEverything: true,
            },
        });

        const headers = new Headers(upstream.headers);
        headers.delete("Set-Cookie");
        headers.delete("Content-Security-Policy");
        headers.delete("X-Frame-Options");

        for (const [key, value] of Object.entries(corsHeaders(request))) {
            headers.set(key, value);
        }

        headers.set("Cache-Control", "public, max-age=86400, s-maxage=86400");
        headers.set("X-Proxy-Target-URL", targetUrl.toString());

        const contentType = upstream.headers.get("Content-Type") || "";
        if (!contentType.toLowerCase().startsWith("image/")) {
            return json(
                {
                    error: "NPR image upstream did not return an image",
                    upstreamStatus: upstream.status,
                    contentType,
                    targetUrl: targetUrl.toString(),
                },
                502,
                request
            );
        }

        if (!upstream.ok) {
            return json(
                {
                    error: "NPR image upstream failed",
                    upstreamStatus: upstream.status,
                    upstreamStatusText: upstream.statusText || "<none>",
                    targetUrl: targetUrl.toString(),
                },
                502,
                request
            );
        }

        if (headOnly) {
            return new Response(null, {
                status: upstream.status,
                statusText: upstream.statusText,
                headers,
            });
        }

        return new Response(upstream.body, {
            status: upstream.status,
            statusText: upstream.statusText,
            headers,
        });
    } catch (error) {
        return json(
            {
                error: "NPR image fetch failed",
                message: error?.message || String(error),
                targetUrl: targetUrl.toString(),
            },
            502,
            request
        );
    }
}