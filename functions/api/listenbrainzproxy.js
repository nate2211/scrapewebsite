const ALLOWED_ORIGINS = new Set([
    "https://suiteofficelab.com",
    "https://audiomasterlab.com",
    "https://www.audiomasterlab.com",
    "https://videomasterlab.com",
    "https://imagemasterlab.com",
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:5173",
]);

const LISTENBRAINZ_ROOT = "https://api.listenbrainz.org";

function corsHeaders(request) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = ALLOWED_ORIGINS.has(origin)
        ? origin
        : "https://audiomasterlab.com";

    return {
        "Access-Control-Allow-Origin": allowedOrigin,
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Accept",
        "Access-Control-Max-Age": "86400",
        "Access-Control-Expose-Headers": [
            "Content-Type",
            "Cache-Control",
            "X-RateLimit-Limit",
            "X-RateLimit-Remaining",
            "X-RateLimit-Reset-In",
            "X-RateLimit-Reset",
        ].join(", "),
        "Vary": "Origin",
    };
}

function jsonResponse(request, data, status = 200) {
    return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: {
            ...corsHeaders(request),
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": status >= 400 ? "no-store" : "public, max-age=180",
        },
    });
}

function clampInt(value, fallback, min, max) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
}

function requireMbid(value, name) {
    const mbid = String(value || "").trim();

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mbid)) {
        throw new Error(`Invalid or missing ${name}.`);
    }

    return mbid;
}

function buildListenBrainzUrl(request) {
    const incoming = new URL(request.url);
    const mode = incoming.searchParams.get("mode") || "top-recordings";

    if (mode === "top-recordings") {
        const artistMbid = requireMbid(incoming.searchParams.get("artist_mbid"), "artist_mbid");
        return new URL(`${LISTENBRAINZ_ROOT}/1/popularity/top-recordings-for-artist/${artistMbid}`);
    }

    if (mode === "artist-radio") {
        const artistMbid = requireMbid(incoming.searchParams.get("artist_mbid"), "artist_mbid");

        const target = new URL(`${LISTENBRAINZ_ROOT}/1/lb-radio/artist/${artistMbid}`);
        target.searchParams.set("mode", incoming.searchParams.get("radio_mode") || "easy");
        target.searchParams.set(
            "max_similar_artists",
            String(clampInt(incoming.searchParams.get("max_similar_artists"), 8, 1, 25))
        );
        target.searchParams.set(
            "max_recordings_per_artist",
            String(clampInt(incoming.searchParams.get("max_recordings_per_artist"), 5, 1, 25))
        );

        return target;
    }

    if (mode === "recording-metadata") {
        const rawMbids = incoming.searchParams.get("recording_mbids") || "";

        const safeMbids = rawMbids
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
            .slice(0, 75);

        if (!safeMbids.length) {
            throw new Error("Missing recording_mbids.");
        }

        for (const mbid of safeMbids) {
            requireMbid(mbid, "recording_mbid");
        }

        const target = new URL(`${LISTENBRAINZ_ROOT}/1/metadata/recording/`);
        target.searchParams.set("recording_mbids", safeMbids.join(","));
        target.searchParams.set("inc", incoming.searchParams.get("inc") || "artist release tag");

        return target;
    }

    if (mode === "search-users") {
        const searchTerm = incoming.searchParams.get("q") || incoming.searchParams.get("search_term") || "";

        if (searchTerm.trim().length < 2) {
            throw new Error("Search term must be at least 2 characters.");
        }

        if (searchTerm.length > 120) {
            throw new Error("Search term is too long.");
        }

        const target = new URL(`${LISTENBRAINZ_ROOT}/1/search/users/`);
        target.searchParams.set("search_term", searchTerm.trim());

        return target;
    }

    throw new Error(`Unknown ListenBrainz mode: ${mode}`);
}

async function proxyJson(request, target) {
    const upstream = await fetch(target.toString(), {
        method: "GET",
        headers: {
            "Accept": "application/json",
            "User-Agent": "AudioMasterLab/1.0 (https://audiomasterlab.com)",
        },
        cf: {
            cacheTtl: 240,
            cacheEverything: true,
        },
    });

    const responseHeaders = {
        ...corsHeaders(request),
        "Content-Type": upstream.headers.get("Content-Type") || "application/json; charset=utf-8",
        "Cache-Control": upstream.ok ? "public, max-age=240" : "no-store",
    };

    for (const header of [
        "X-RateLimit-Limit",
        "X-RateLimit-Remaining",
        "X-RateLimit-Reset-In",
        "X-RateLimit-Reset",
    ]) {
        const value = upstream.headers.get(header);
        if (value) responseHeaders[header] = value;
    }

    return new Response(upstream.body, {
        status: upstream.status,
        headers: responseHeaders,
    });
}

export async function onRequest({ request }) {
    if (request.method === "OPTIONS") {
        return new Response(null, {
            status: 204,
            headers: corsHeaders(request),
        });
    }

    if (request.method !== "GET") {
        return jsonResponse(request, { error: "Only GET is allowed." }, 405);
    }

    try {
        const target = buildListenBrainzUrl(request);
        return await proxyJson(request, target);
    } catch (error) {
        return jsonResponse(request, {
            error: "ListenBrainz proxy failed.",
            details: error instanceof Error ? error.message : String(error),
        }, 400);
    }
}