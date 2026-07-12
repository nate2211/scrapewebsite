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

function isAllowedSoundCloudContentUrl(contentUrl) {
    const host = contentUrl.hostname.toLowerCase();

    if (
        host !== "soundcloud.com" &&
        host !== "www.soundcloud.com" &&
        host !== "m.soundcloud.com" &&
        host !== "on.soundcloud.com"
    ) {
        return false;
    }

    if (contentUrl.pathname.includes("..")) return false;

    return contentUrl.pathname.split("/").filter(Boolean).length >= 1;
}

function normalizeSoundCloudOembedTarget(raw) {
    let incoming;

    try {
        incoming = new URL(raw);
    } catch {
        throw new Error("Invalid ?url= parameter.");
    }

    const host = incoming.hostname.toLowerCase();

    if (host === "soundcloud.com" && incoming.pathname === "/oembed") {
        const inner = incoming.searchParams.get("url");

        if (!inner) {
            throw new Error("SoundCloud oEmbed URL is missing its inner url= parameter.");
        }

        const contentUrl = new URL(inner);

        if (!isAllowedSoundCloudContentUrl(contentUrl)) {
            throw new Error("Inner SoundCloud URL is not allowed.");
        }

        const target = new URL("https://soundcloud.com/oembed");
        target.searchParams.set("format", "json");
        target.searchParams.set("url", contentUrl.toString());
        return { target, contentUrl };
    }

    if (!isAllowedSoundCloudContentUrl(incoming)) {
        throw new Error("Only SoundCloud content URLs or https://soundcloud.com/oembed URLs are allowed.");
    }

    const target = new URL("https://soundcloud.com/oembed");
    target.searchParams.set("format", "json");
    target.searchParams.set("url", incoming.toString());
    return { target, contentUrl: incoming };
}

function fallbackSoundCloudOembed(contentUrl, reason = "") {
    const playerUrl = `https://w.soundcloud.com/player/?url=${encodeURIComponent(
        contentUrl.toString()
    )}&color=%23ff5500&auto_play=false&hide_related=false&show_comments=false&show_user=true&show_reposts=false&show_teaser=true&visual=true`;

    return {
        ok: true,
        fallback: true,
        reason,
        version: "1.0",
        type: "rich",
        provider_name: "SoundCloud",
        provider_url: "https://soundcloud.com",
        title: "SoundCloud preview",
        author_name: "SoundCloud",
        thumbnail_url: "https://audiomasterlab.com/social-preview.png",
        html: `<iframe width="100%" height="450" scrolling="no" frameborder="no" allow="autoplay" src="${playerUrl}"></iframe>`,
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
                    "/api/soundcloudoembedproxy?url=https%3A%2F%2Fsoundcloud.com%2Foembed%3Fformat%3Djson%26url%3Dhttps%253A%252F%252Fsoundcloud.com%252Fforss%252Fflickermood",
            },
            400,
            request
        );
    }

    let target;
    let contentUrl;

    try {
        const normalized = normalizeSoundCloudOembedTarget(raw);
        target = normalized.target;
        contentUrl = normalized.contentUrl;
    } catch (error) {
        return json(
            {
                error: "Bad SoundCloud oEmbed proxy request",
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
                "User-Agent": "AudioMasterLabSoundCloudOEmbedProxy/1.0 (+https://audiomasterlab.com/news)",
            },
            cf: {
                cacheTtl: 3600,
                cacheEverything: true,
            },
        });

        const body = await upstream.text();

        if (!upstream.ok) {
            return json(
                {
                    ...fallbackSoundCloudOembed(
                        contentUrl,
                        `SoundCloud oEmbed upstream returned ${upstream.status}.`
                    ),
                    upstreamStatus: upstream.status,
                    upstreamStatusText: upstream.statusText || "<none>",
                    upstreamPreview: body.slice(0, 600),
                },
                200,
                request,
                "public, max-age=900, s-maxage=3600"
            );
        }

        if (/<!doctype html|<html|<div id=["']root["']><\/div>/i.test(body)) {
            return json(
                fallbackSoundCloudOembed(
                    contentUrl,
                    "SoundCloud oEmbed returned HTML instead of JSON."
                ),
                200,
                request,
                "public, max-age=900, s-maxage=3600"
            );
        }

        let data;

        try {
            data = JSON.parse(body);
        } catch {
            return json(
                fallbackSoundCloudOembed(
                    contentUrl,
                    "SoundCloud oEmbed returned invalid JSON."
                ),
                200,
                request,
                "public, max-age=900, s-maxage=3600"
            );
        }

        return json(
            {
                ok: true,
                ...data,
            },
            200,
            request,
            "public, max-age=900, s-maxage=3600"
        );
    } catch (error) {
        return json(
            fallbackSoundCloudOembed(contentUrl, error?.message || String(error)),
            200,
            request,
            "public, max-age=900, s-maxage=3600"
        );
    }
}