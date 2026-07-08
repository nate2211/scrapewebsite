const ALLOWED_ORIGINS = new Set([
    "https://suiteofficelab.com",
    "https://audiomasterlab.com",
    "https://www.audiomasterlab.com",
    "https://videomasterlab.com",
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:5173",
]);

const LISTENBRAINZ_ROOT = "https://api.listenbrainz.org";

function corsHeaders(request) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = ALLOWED_ORIGINS.has(origin) ? origin : "https://audiomasterlab.com";

    return {
        "Access-Control-Allow-Origin": allowedOrigin,
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Accept",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin",
    };
}

function json(data, status = 200, request) {
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
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || "")) {
        throw new Error(`Invalid or missing ${name}.`);
    }
}

function buildListenBrainzUrl(request) {
    const incoming = new URL(request.url);
    const mode = incoming.searchParams.get("mode") || "top-recordings";

    if (mode === "top-recordings") {
        const artistMbid = incoming.searchParams.get("artist_mbid");
        requireMbid(artistMbid, "artist_mbid");

        return new URL(`${LISTENBRAINZ_ROOT}/1/popularity/top-recordings-for-artist/${artistMbid}`);
    }

    if (mode === "artist-radio") {
        const artistMbid = incoming.searchParams.get("artist_mbid");
        requireMbid(artistMbid, "artist_mbid");

        const target = new URL(`${LISTENBRAINZ_ROOT}/1/lb-radio/artist/${artistMbid}`);
        target.searchParams.set("mode", incoming.searchParams.get("radio_mode") || "easy");
        target.searchParams.set("max_similar_artists", String(clampInt(incoming.searchParams.get("max_similar_artists"), 8, 1, 25)));
        target.searchParams.set("max_recordings_per_artist", String(clampInt(incoming.searchParams.get("max_recordings_per_artist"), 5, 1, 25)));

        return target;
    }

    if (mode === "recording-metadata") {
        const recordingMbids = incoming.searchParams.get("recording_mbids") || "";
        if (!recordingMbids.trim()) throw new Error("Missing recording_mbids.");

        const safeMbids = recordingMbids
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean)
            .slice(0, 75);

        for (const mbid of safeMbids) requireMbid(mbid, "recording_mbid");

        const target = new URL(`${LISTENBRAINZ_ROOT}/1/metadata/recording/`);
        target.searchParams.set("recording_mbids", safeMbids.join(","));
        target.searchParams.set("inc", incoming.searchParams.get("inc") || "artist release tag");

        return target;
    }

    if (mode === "search-users") {
        const searchTerm = incoming.searchParams.get("q") || incoming.searchParams.get("search_term") || "";
        if (searchTerm.trim().length < 2) throw new Error("Search term must be at least 2 characters.");

        const target = new URL(`${LISTENBRAINZ_ROOT}/1/search/users/`);
        target.searchParams.set("search_term", searchTerm);

        return target;
    }

    throw new Error(`Unknown ListenBrainz mode: ${mode}`);
}

async function proxyJson(request, target) {
    const upstream = await fetch(target.toString(), {
        method: "GET",
        headers: {
            "Accept": "application/json",
            "User-Agent": "AudioMasterLab/1.0 (https://audiomasterlab.com; no-token ListenBrainz proxy)",
        },
    });

    const responseHeaders = {
        ...corsHeaders(request),
        "Content-Type": upstream.headers.get("Content-Type") || "application/json; charset=utf-8",
        "Cache-Control": upstream.ok ? "public, max-age=240" : "no-store",
    };

    const rateHeaders = [
        "X-RateLimit-Limit",
        "X-RateLimit-Remaining",
        "X-RateLimit-Reset-In",
        "X-RateLimit-Reset",
    ];

    for (const header of rateHeaders) {
        const value = upstream.headers.get(header);
        if (value) responseHeaders[header] = value;
    }

    return new Response(upstream.body, {
        status: upstream.status,
        headers: responseHeaders,
    });
}

export default {
    async fetch(request) {
        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders(request) });
        }

        if (request.method !== "GET") {
            return json({ error: "Only GET is allowed." }, 405, request);
        }

        try {
            const target = buildListenBrainzUrl(request);
            return await proxyJson(request, target);
        } catch (error) {
            return json({
                error: "ListenBrainz proxy failed.",
                details: String(error && error.message ? error.message : error),
            }, 400, request);
        }
    },
};