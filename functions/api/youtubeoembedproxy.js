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

function corsHeaders(request) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = ALLOWED_ORIGINS.has(origin)
        ? origin
        : "https://audiomasterlab.com";

    return {
        "Access-Control-Allow-Origin": allowedOrigin,
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Accept",
        "Access-Control-Expose-Headers": "Content-Type, Cache-Control, X-Proxy-Target-URL",
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

function isAllowedYoutubeVideoUrl(videoUrl) {
    const host = videoUrl.hostname.toLowerCase();

    const allowedHost =
        host === "youtube.com" ||
        host === "www.youtube.com" ||
        host === "m.youtube.com" ||
        host === "youtu.be" ||
        host === "music.youtube.com";

    if (!allowedHost) return false;

    if (host === "youtu.be") {
        return /^\/[a-zA-Z0-9_-]{6,}$/.test(videoUrl.pathname);
    }

    return (
        videoUrl.pathname === "/watch" ||
        videoUrl.pathname.startsWith("/shorts/") ||
        videoUrl.pathname.startsWith("/embed/")
    );
}

function normalizeYoutubeOembedTarget(raw) {
    let incoming;

    try {
        incoming = new URL(raw);
    } catch {
        throw new Error("Invalid ?url= parameter.");
    }

    const host = incoming.hostname.toLowerCase();

    if (
        (host === "youtube.com" || host === "www.youtube.com") &&
        incoming.pathname === "/oembed"
    ) {
        const videoRaw = incoming.searchParams.get("url");

        if (!videoRaw) {
            throw new Error("YouTube oEmbed URL is missing its inner url= parameter.");
        }

        const videoUrl = new URL(videoRaw);

        if (!isAllowedYoutubeVideoUrl(videoUrl)) {
            throw new Error("Inner YouTube video URL is not allowed.");
        }

        const target = new URL("https://www.youtube.com/oembed");
        target.searchParams.set("format", "json");
        target.searchParams.set("url", videoUrl.toString());
        return target;
    }

    if (!isAllowedYoutubeVideoUrl(incoming)) {
        throw new Error("Only YouTube video URLs or https://www.youtube.com/oembed URLs are allowed.");
    }

    const target = new URL("https://www.youtube.com/oembed");
    target.searchParams.set("format", "json");
    target.searchParams.set("url", incoming.toString());
    return target;
}

function fallbackYoutubeOembed(videoUrl) {
    let id = "";

    if (videoUrl.hostname.toLowerCase() === "youtu.be") {
        id = videoUrl.pathname.split("/").filter(Boolean)[0] || "";
    } else if (videoUrl.pathname === "/watch") {
        id = videoUrl.searchParams.get("v") || "";
    } else if (videoUrl.pathname.startsWith("/shorts/") || videoUrl.pathname.startsWith("/embed/")) {
        id = videoUrl.pathname.split("/").filter(Boolean)[1] || "";
    }

    if (!id) return null;

    return {
        version: "1.0",
        type: "video",
        provider_name: "YouTube",
        provider_url: "https://www.youtube.com/",
        title: "YouTube video",
        author_name: "YouTube",
        thumbnail_url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        html: `<iframe width="560" height="315" src="https://www.youtube.com/embed/${id}" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`,
    };
}

export async function onRequestOptions({ request }) {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function onRequestGet({ request }) {
    const requestUrl = new URL(request.url);
    const raw = requestUrl.searchParams.get("url");

    if (!raw) {
        return json(
            {
                error: "Missing ?url= parameter",
                example:
                    "/api/youtubeoembedproxy?url=https%3A%2F%2Fwww.youtube.com%2Foembed%3Fformat%3Djson%26url%3Dhttps%253A%252F%252Fwww.youtube.com%252Fwatch%253Fv%253Dox1Eemj8FDo",
            },
            400,
            request
        );
    }

    let target;

    try {
        target = normalizeYoutubeOembedTarget(raw);
    } catch (error) {
        return json(
            {
                error: "Bad YouTube oEmbed proxy request",
                message: error?.message || String(error),
            },
            400,
            request
        );
    }

    try {
        const upstream = await fetch(target.toString(), {
            headers: {
                Accept: "application/json, text/plain, */*",
                "User-Agent": "AudioMasterLabYouTubeOEmbedProxy/1.0 (+https://audiomasterlab.com/news)",
            },
            cf: {
                cacheTtl: 86400,
                cacheEverything: true,
            },
        });

        const body = await upstream.text();

        if (!upstream.ok) {
            const videoUrl = new URL(target.searchParams.get("url"));
            const fallback = fallbackYoutubeOembed(videoUrl);

            if (fallback) {
                return json(
                    {
                        ...fallback,
                        ok: true,
                        fallback: true,
                        upstreamStatus: upstream.status,
                        upstreamStatusText: upstream.statusText || "<none>",
                    },
                    200,
                    request,
                    "public, max-age=3600, s-maxage=86400"
                );
            }

            return json(
                {
                    error: "YouTube oEmbed upstream request failed",
                    upstreamStatus: upstream.status,
                    upstreamStatusText: upstream.statusText || "<none>",
                    targetUrl: target.toString(),
                    preview: body.slice(0, 600),
                },
                502,
                request
            );
        }

        if (/<!doctype html|<html|<div id=["']root["']><\/div>/i.test(body)) {
            return json(
                {
                    error: "YouTube oEmbed upstream returned HTML instead of JSON",
                    targetUrl: target.toString(),
                    preview: body.slice(0, 600),
                },
                502,
                request
            );
        }

        let data;

        try {
            data = JSON.parse(body);
        } catch {
            return json(
                {
                    error: "YouTube oEmbed upstream returned invalid JSON",
                    targetUrl: target.toString(),
                    preview: body.slice(0, 600),
                },
                502,
                request
            );
        }

        return json(
            {
                ok: true,
                ...data,
            },
            200,
            request,
            "public, max-age=3600, s-maxage=86400"
        );
    } catch (error) {
        const videoUrl = new URL(target.searchParams.get("url"));
        const fallback = fallbackYoutubeOembed(videoUrl);

        if (fallback) {
            return json(
                {
                    ...fallback,
                    ok: true,
                    fallback: true,
                    message: error?.message || String(error),
                },
                200,
                request,
                "public, max-age=3600, s-maxage=86400"
            );
        }

        return json(
            {
                error: "YouTube oEmbed fetch failed",
                message: error?.message || String(error),
                targetUrl: target.toString(),
            },
            502,
            request
        );
    }
}