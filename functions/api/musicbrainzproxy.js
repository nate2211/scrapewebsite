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

const MUSICBRAINZ_ROOT = "https://musicbrainz.org/ws/2";

const ALLOWED_TYPES = new Set([
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
        "Access-Control-Expose-Headers": "Content-Type, Cache-Control",
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

function cleanInc(value) {
    const inc = String(value || "").trim();
    if (!inc) return "";

    if (inc.length > 240 || !/^[a-zA-Z0-9_\-+\s]+$/.test(inc)) {
        throw new Error("Invalid inc parameter.");
    }

    return inc.replace(/\s+/g, "+");
}

function requireMbid(value) {
    const mbid = String(value || "").trim();

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mbid)) {
        throw new Error("Invalid or missing mbid parameter.");
    }

    return mbid;
}

function buildSearchUrl(request) {
    const incoming = new URL(request.url);

    const type = incoming.searchParams.get("type") || "artist";
    const query = incoming.searchParams.get("q") || incoming.searchParams.get("query") || "";
    const limit = clampInt(incoming.searchParams.get("limit"), 25, 1, 100);
    const offset = clampInt(incoming.searchParams.get("offset"), 0, 0, 10000);

    if (!ALLOWED_TYPES.has(type)) {
        throw new Error(`Unsupported MusicBrainz type: ${type}`);
    }

    if (!query.trim()) {
        throw new Error("Missing q query parameter.");
    }

    if (query.length > 300) {
        throw new Error("Query is too long.");
    }

    const target = new URL(`${MUSICBRAINZ_ROOT}/${type}`);
    target.searchParams.set("query", query.trim());
    target.searchParams.set("fmt", "json");
    target.searchParams.set("limit", String(limit));
    target.searchParams.set("offset", String(offset));

    return target;
}

function buildLookupUrl(request) {
    const incoming = new URL(request.url);

    const type = incoming.searchParams.get("type") || "artist";
    const mbid = requireMbid(incoming.searchParams.get("mbid"));
    const inc = cleanInc(incoming.searchParams.get("inc"));

    if (!ALLOWED_TYPES.has(type)) {
        throw new Error(`Unsupported MusicBrainz lookup type: ${type}`);
    }

    const target = new URL(`${MUSICBRAINZ_ROOT}/${type}/${mbid}`);
    target.searchParams.set("fmt", "json");

    if (inc) {
        target.searchParams.set("inc", inc);
    }

    return target;
}

async function proxyJson(request, target) {
    const upstream = await fetch(target.toString(), {
        method: "GET",
        headers: {
            "Accept": "application/json",
            "User-Agent": "AudioMasterLab/1.0 (https://audiomasterlab.com)",
        },
        cf: {
            cacheTtl: 300,
            cacheEverything: true,
        },
    });

    const body = await upstream.text();

    return new Response(body, {
        status: upstream.status,
        headers: {
            ...corsHeaders(request),
            "Content-Type": upstream.headers.get("Content-Type") || "application/json; charset=utf-8",
            "Cache-Control": upstream.ok ? "public, max-age=300" : "no-store",
        },
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
        const url = new URL(request.url);
        const mode = url.searchParams.get("mode") || "search";

        if (mode === "search") {
            return await proxyJson(request, buildSearchUrl(request));
        }

        if (mode === "lookup") {
            return await proxyJson(request, buildLookupUrl(request));
        }

        return jsonResponse(request, {
            error: "Unknown mode.",
            allowed_modes: ["search", "lookup"],
        }, 400);
    } catch (error) {
        return jsonResponse(request, {
            error: "MusicBrainz proxy failed.",
            details: error instanceof Error ? error.message : String(error),
        }, 400);
    }
}