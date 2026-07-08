const ALLOWED_ORIGINS = new Set([
    "https://suiteofficelab.com",
    "https://audiomasterlab.com",
    "https://www.audiomasterlab.com",
    "https://videomasterlab.com",
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:5173",
]);

const MUSICBRAINZ_ROOT = "https://musicbrainz.org/ws/2";

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

function buildMusicBrainzSearchUrl(request) {
    const incoming = new URL(request.url);

    const type = incoming.searchParams.get("type") || "artist";
    const query = incoming.searchParams.get("q") || incoming.searchParams.get("query") || "";
    const limit = clampInt(incoming.searchParams.get("limit"), 25, 1, 100);
    const offset = clampInt(incoming.searchParams.get("offset"), 0, 0, 10000);

    const allowedTypes = new Set([
        "artist",
        "recording",
        "release",
        "release-group",
        "label",
        "work",
        "area",
        "event",
        "place",
        "instrument",
        "series",
        "tag",
        "url",
    ]);

    if (!allowedTypes.has(type)) {
        throw new Error(`Unsupported MusicBrainz type: ${type}`);
    }

    if (!query.trim()) {
        throw new Error("Missing q query parameter.");
    }

    const target = new URL(`${MUSICBRAINZ_ROOT}/${type}`);
    target.searchParams.set("query", query);
    target.searchParams.set("fmt", "json");
    target.searchParams.set("limit", String(limit));
    target.searchParams.set("offset", String(offset));

    return target;
}

function buildMusicBrainzLookupUrl(request) {
    const incoming = new URL(request.url);

    const type = incoming.searchParams.get("type") || "artist";
    const mbid = incoming.searchParams.get("mbid") || "";
    const inc = incoming.searchParams.get("inc") || "";

    const allowedTypes = new Set([
        "artist",
        "recording",
        "release",
        "release-group",
        "label",
        "work",
        "area",
        "event",
        "place",
        "instrument",
        "series",
        "url",
    ]);

    if (!allowedTypes.has(type)) {
        throw new Error(`Unsupported MusicBrainz lookup type: ${type}`);
    }

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mbid)) {
        throw new Error("Invalid or missing mbid parameter.");
    }

    const target = new URL(`${MUSICBRAINZ_ROOT}/${type}/${mbid}`);
    target.searchParams.set("fmt", "json");
    if (inc) target.searchParams.set("inc", inc);

    return target;
}

async function proxyJson(request, target) {
    const upstream = await fetch(target.toString(), {
        method: "GET",
        headers: {
            "Accept": "application/json",
            "User-Agent": "AudioMasterLab/1.0 (https://audiomasterlab.com; no-token MusicBrainz proxy)",
        },
    });

    const text = await upstream.text();

    return new Response(text, {
        status: upstream.status,
        headers: {
            ...corsHeaders(request),
            "Content-Type": upstream.headers.get("Content-Type") || "application/json; charset=utf-8",
            "Cache-Control": upstream.ok ? "public, max-age=300" : "no-store",
        },
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

        const url = new URL(request.url);
        const mode = url.searchParams.get("mode") || "search";

        try {
            if (mode === "search") {
                return await proxyJson(request, buildMusicBrainzSearchUrl(request));
            }

            if (mode === "lookup") {
                return await proxyJson(request, buildMusicBrainzLookupUrl(request));
            }

            return json({
                error: "Unknown mode.",
                allowed_modes: ["search", "lookup"],
            }, 400, request);
        } catch (error) {
            return json({
                error: "MusicBrainz proxy failed.",
                details: String(error && error.message ? error.message : error),
            }, 400, request);
        }
    },
};