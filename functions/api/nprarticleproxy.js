const ALLOWED_TARGET_HOSTS = new Set(["www.npr.org", "npr.org"]);

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

function text(body, status, request, contentType = "text/plain; charset=utf-8") {
    return new Response(body, {
        status,
        headers: {
            ...corsHeaders(request),
            "Content-Type": contentType,
            "Cache-Control": "no-store",
        },
    });
}

function isAllowedNprArticlePath(targetUrl) {
    const path = targetUrl.pathname || "";

    if (path.includes("..")) return false;
    if (path === "/" || path === "/sections" || path === "/sections/") return false;

    return (
        /^\/\d{4}\/\d{1,2}\/\d{1,2}\/[a-z0-9-]+\/[a-z0-9-]+\/?$/i.test(path) ||
        /^\/sections\/[a-z0-9-]+\/\d{4}\/\d{1,2}\/\d{1,2}\/[a-z0-9-]+\/[a-z0-9-]+\/?$/i.test(path) ||
        /^\/\d{4}\/\d{1,2}\/\d{1,2}\/\d+\/[a-z0-9-]+\/?$/i.test(path) ||
        /^\/sections\/[a-z0-9-]+\/\d{4}\/\d{1,2}\/\d{1,2}\/\d+\/[a-z0-9-]+\/?$/i.test(path)
    );
}

function getTargetUrl(request) {
    const requestUrl = new URL(request.url);
    const raw = requestUrl.searchParams.get("url") || requestUrl.searchParams.get("u");

    if (!raw) throw new Error("Missing ?url= parameter.");

    let targetUrl;

    try {
        targetUrl = new URL(raw);
    } catch {
        throw new Error("Invalid target URL.");
    }

    if (targetUrl.protocol !== "https:") {
        throw new Error("Only HTTPS NPR article URLs are allowed.");
    }

    if (!ALLOWED_TARGET_HOSTS.has(targetUrl.hostname.toLowerCase())) {
        throw new Error("Target host is not allowed.");
    }

    if (!isAllowedNprArticlePath(targetUrl)) {
        throw new Error("Target NPR article path is not allowed.");
    }

    targetUrl.hash = "";
    return targetUrl;
}

function decodeEntities(value) {
    return String(value || "")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#039;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&nbsp;/g, " ");
}

function extractMeta(html, names) {
    for (const name of names) {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regexA = new RegExp(
            `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`,
            "i"
        );
        const regexB = new RegExp(
            `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`,
            "i"
        );

        const match = html.match(regexA) || html.match(regexB);
        if (match?.[1]) return decodeEntities(match[1].trim());
    }

    return "";
}

function absoluteUrl(value, baseUrl) {
    const textValue = String(value || "").trim();
    if (!textValue) return "";

    try {
        return new URL(textValue, baseUrl).toString();
    } catch {
        return "";
    }
}

function extractImage(html, baseUrl) {
    const meta =
        extractMeta(html, [
            "og:image",
            "og:image:url",
            "twitter:image",
            "twitter:image:src",
        ]) || "";

    if (meta) return absoluteUrl(meta, baseUrl);

    const imgMatch = html.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (imgMatch?.[1]) return absoluteUrl(decodeEntities(imgMatch[1]), baseUrl);

    const loose = html.match(
        /(https?:\/\/[^\s"'<>]+?\.(?:jpg|jpeg|png|webp|gif|avif)(?:\?[^\s"'<>]*)?)/i
    );

    return absoluteUrl(loose?.[1], baseUrl);
}

function extractTitle(html) {
    return (
        extractMeta(html, ["og:title", "twitter:title"]) ||
        decodeEntities((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/\s+/g, " ").trim())
    );
}

function extractDescription(html) {
    return extractMeta(html, [
        "og:description",
        "twitter:description",
        "description",
    ]);
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
                ok: false,
                error: "Bad NPR article proxy request",
                message: error?.message || String(error),
            },
            400,
            request
        );
    }

    const requestUrl = new URL(request.url);
    const rawMode = requestUrl.searchParams.get("raw") === "1";
    const wantsJson =
        requestUrl.searchParams.get("format") === "json" ||
        requestUrl.searchParams.get("extract") === "1" ||
        !rawMode;

    try {
        const upstream = await fetch(targetUrl.toString(), {
            method: headOnly ? "HEAD" : "GET",
            headers: {
                Accept:
                    "text/html, application/xhtml+xml, application/xml;q=0.9, image/avif,image/webp,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                "User-Agent":
                    "Mozilla/5.0 (compatible; AudioMasterLabNewsBot/1.0; +https://audiomasterlab.com/news)",
            },
            redirect: "follow",
            cf: {
                cacheTtl: 900,
                cacheEverything: true,
            },
        });

        if (headOnly) {
            const headers = new Headers(upstream.headers);
            for (const [key, value] of Object.entries(corsHeaders(request))) {
                headers.set(key, value);
            }
            headers.set("X-Proxy-Target-URL", targetUrl.toString());

            return new Response(null, {
                status: upstream.status,
                statusText: upstream.statusText,
                headers,
            });
        }

        const html = await upstream.text();

        if (!upstream.ok) {
            if (wantsJson) {
                return json(
                    {
                        ok: false,
                        source: "npr",
                        url: targetUrl.toString(),
                        image: "",
                        title: "",
                        description: "",
                        publishedAt: "",
                        upstreamStatus: upstream.status,
                        upstreamStatusText: upstream.statusText || "<none>",
                        message:
                            "NPR article page fetch failed. Use the RSS content:encoded image first; do not depend on article-page enrichment.",
                        preview: html.slice(0, 500),
                    },
                    200,
                    request,
                    "public, max-age=120, s-maxage=120"
                );
            }

            return json(
                {
                    ok: false,
                    error: "NPR article upstream returned an error",
                    upstreamStatus: upstream.status,
                    upstreamStatusText: upstream.statusText || "<none>",
                    targetUrl: targetUrl.toString(),
                    preview: html.slice(0, 500),
                },
                502,
                request
            );
        }

        if (wantsJson) {
            return json(
                {
                    ok: true,
                    source: "npr",
                    url: targetUrl.toString(),
                    title: extractTitle(html),
                    description: extractDescription(html),
                    image: extractImage(html, targetUrl.toString()),
                    publishedAt: extractPublishedAt(html),
                },
                200,
                request,
                "public, max-age=900, s-maxage=900"
            );
        }

        const headers = new Headers(upstream.headers);
        headers.delete("Set-Cookie");
        headers.delete("Content-Security-Policy");
        headers.delete("X-Frame-Options");

        for (const [key, value] of Object.entries(corsHeaders(request))) {
            headers.set(key, value);
        }

        headers.set("Content-Type", "text/html; charset=utf-8");
        headers.set("Cache-Control", "public, max-age=900, s-maxage=900");
        headers.set("X-Proxy-Target-URL", targetUrl.toString());

        return new Response(html, {
            status: 200,
            headers,
        });
    } catch (error) {
        if (wantsJson) {
            return json(
                {
                    ok: false,
                    source: "npr",
                    url: targetUrl.toString(),
                    image: "",
                    title: "",
                    description: "",
                    publishedAt: "",
                    message: error?.message || String(error),
                },
                200,
                request,
                "public, max-age=120, s-maxage=120"
            );
        }

        return json(
            {
                ok: false,
                error: "NPR article fetch failed",
                message: error?.message || String(error),
                targetUrl: targetUrl.toString(),
            },
            502,
            request
        );
    }
}