const ALLOWED_ORIGINS = new Set([
    "https://audiomasterlab.com",
    "https://www.audiomasterlab.com",
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:5173",
]);

const MAX_VIDEO_IDS = 50;
const CACHE_SECONDS = 600;

function getCorsHeaders(request) {
    const origin = request.headers.get("Origin") || "";
    const allowOrigin = ALLOWED_ORIGINS.has(origin)
        ? origin
        : "https://audiomasterlab.com";

    return {
        "Access-Control-Allow-Origin": allowOrigin,
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
    };
}

function jsonResponse(request, body, init = {}) {
    const headers = new Headers(init.headers || {});
    headers.set("Content-Type", "application/json; charset=utf-8");

    for (const [key, value] of Object.entries(getCorsHeaders(request))) {
        headers.set(key, value);
    }

    return new Response(JSON.stringify(body), {
        ...init,
        headers,
    });
}

function normalizeIds(value) {
    return Array.from(
        new Set(
            String(value || "")
                .split(",")
                .map((id) => id.trim())
                .filter((id) => /^[A-Za-z0-9_-]{11}$/.test(id)),
        ),
    ).slice(0, MAX_VIDEO_IDS);
}

function normalizeCount(value) {
    if (value === null || value === undefined || value === "") return null;

    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
}

function isoDurationToMillis(value) {
    const match = String(value || "").match(
        /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i,
    );

    if (!match) return null;

    const days = Number(match[1] || 0);
    const hours = Number(match[2] || 0);
    const minutes = Number(match[3] || 0);
    const seconds = Number(match[4] || 0);

    return Math.round(
        (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000,
    );
}

function getBestThumbnail(thumbnails) {
    return (
        thumbnails?.maxres?.url ||
        thumbnails?.standard?.url ||
        thumbnails?.high?.url ||
        thumbnails?.medium?.url ||
        thumbnails?.default?.url ||
        ""
    );
}

function normalizeVideo(item) {
    const snippet = item?.snippet || {};
    const statistics = item?.statistics || {};
    const contentDetails = item?.contentDetails || {};
    const status = item?.status || {};
    const liveStreamingDetails = item?.liveStreamingDetails || {};

    return {
        id: String(item?.id || ""),
        title: snippet?.title || "",
        description: snippet?.description || "",
        channelId: snippet?.channelId || "",
        channelTitle: snippet?.channelTitle || "",
        publishedAt: snippet?.publishedAt || "",
        thumbnail: getBestThumbnail(snippet?.thumbnails),
        thumbnails: snippet?.thumbnails || {},
        tags: Array.isArray(snippet?.tags) ? snippet.tags : [],
        categoryId: snippet?.categoryId || "",
        defaultLanguage: snippet?.defaultLanguage || "",
        defaultAudioLanguage: snippet?.defaultAudioLanguage || "",
        liveBroadcastContent: snippet?.liveBroadcastContent || "none",
        viewCount: normalizeCount(statistics?.viewCount),
        likeCount: normalizeCount(statistics?.likeCount),
        commentCount: normalizeCount(statistics?.commentCount),
        favoriteCount: normalizeCount(statistics?.favoriteCount),
        duration: contentDetails?.duration || "",
        durationMillis: isoDurationToMillis(contentDetails?.duration),
        dimension: contentDetails?.dimension || "",
        definition: contentDetails?.definition || "",
        caption: contentDetails?.caption || "false",
        licensedContent: Boolean(contentDetails?.licensedContent),
        projection: contentDetails?.projection || "rectangular",
        embeddable:
            typeof status?.embeddable === "boolean" ? status.embeddable : true,
        publicStatsViewable:
            typeof status?.publicStatsViewable === "boolean"
                ? status.publicStatsViewable
                : true,
        privacyStatus: status?.privacyStatus || "public",
        madeForKids:
            typeof status?.madeForKids === "boolean" ? status.madeForKids : null,
        actualStartTime: liveStreamingDetails?.actualStartTime || "",
        actualEndTime: liveStreamingDetails?.actualEndTime || "",
        scheduledStartTime: liveStreamingDetails?.scheduledStartTime || "",
        concurrentViewers: normalizeCount(liveStreamingDetails?.concurrentViewers),
    };
}

async function requestYoutubeVideos(ids, apiKey) {
    const target = new URL("https://www.googleapis.com/youtube/v3/videos");
    target.searchParams.set(
        "part",
        "snippet,statistics,contentDetails,status,liveStreamingDetails",
    );
    target.searchParams.set("id", ids.join(","));
    target.searchParams.set("key", apiKey);

    const response = await fetch(target.toString(), {
        method: "GET",
        headers: {
            Accept: "application/json",
        },
        cf: {
            cacheEverything: true,
            cacheTtl: CACHE_SECONDS,
        },
    });

    const text = await response.text();
    let payload = null;

    try {
        payload = text ? JSON.parse(text) : null;
    } catch {
        payload = null;
    }

    if (!response.ok) {
        const reason =
            payload?.error?.message ||
            text.slice(0, 300).replace(/\s+/g, " ") ||
            "YouTube Data API request failed.";

        throw new Error(`YouTube Data API returned ${response.status}: ${reason}`);
    }

    return payload || {};
}

export async function onRequestOptions(context) {
    return new Response(null, {
        status: 204,
        headers: getCorsHeaders(context.request),
    });
}

export async function onRequestGet(context) {
    const { request, env } = context;
    const requestUrl = new URL(request.url);
    const ids = normalizeIds(
        requestUrl.searchParams.get("ids") || requestUrl.searchParams.get("id"),
    );

    if (ids.length === 0) {
        return jsonResponse(
            request,
            {
                ok: false,
                error:
                    "Provide one or more valid 11-character YouTube video IDs in ?ids=.",
            },
            { status: 400 },
        );
    }

    const apiKey = String(env?.YOUTUBE_API_KEY || "").trim();

    if (!apiKey) {
        return jsonResponse(
            request,
            {
                ok: false,
                error:
                    "The YOUTUBE_API_KEY Cloudflare secret is not configured. RSS views and embeds can still load, but rich statistics hydration is disabled.",
            },
            { status: 503 },
        );
    }

    try {
        const payload = await requestYoutubeVideos(ids, apiKey);
        const items = Array.isArray(payload?.items)
            ? payload.items.map(normalizeVideo).filter((item) => item.id)
            : [];
        const returnedIds = new Set(items.map((item) => item.id));
        const missingIds = ids.filter((id) => !returnedIds.has(id));

        return jsonResponse(
            request,
            {
                ok: true,
                provider: "YouTube Data API v3",
                requestedCount: ids.length,
                returnedCount: items.length,
                missingIds,
                fetchedAt: new Date().toISOString(),
                items,
            },
            {
                status: 200,
                headers: {
                    "Cache-Control": `public, max-age=${CACHE_SECONDS}, s-maxage=${CACHE_SECONDS}`,
                },
            },
        );
    } catch (error) {
        return jsonResponse(
            request,
            {
                ok: false,
                error: error?.message || "YouTube statistics request failed.",
            },
            { status: 502 },
        );
    }
}