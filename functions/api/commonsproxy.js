const ALLOWED_ORIGINS = new Set([
    "https://suiteofficelab.com",
    "https://audiomasterlab.com",
    "https://www.audiomasterlab.com",
    "https://videomasterlab.com",
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:5173",
]);

const OPENVERSE_HOST = "api.openverse.org";

const ALLOWED_OPENVERSE_PATHS = [
    "/v1/images/",
    "/v1/audio/",
    "/v1/rate_limit/",
];

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
            "Cache-Control": "public, max-age=120",
        },
    });
}

function isAllowedOpenversePath(pathname) {
    return ALLOWED_OPENVERSE_PATHS.some((path) => {
        return pathname === path || pathname.startsWith(path);
    });
}

function cleanSearchParams(sourceParams) {
    const allowed = new Set([
        "q",
        "query",
        "page",
        "page_size",
        "license",
        "license_type",
        "categories",
        "extension",
        "source",
        "creator",
        "tags",
        "unstable__include_sensitive_results",
    ]);

    const params = new URLSearchParams();

    for (const [key, value] of sourceParams.entries()) {
        if (allowed.has(key)) params.set(key, value);
    }

    return params;
}

async function proxyOpenverse(request, kind) {
    const incoming = new URL(request.url);
    const query = incoming.searchParams.get("q") || incoming.searchParams.get("query") || "";
    const page = incoming.searchParams.get("page") || "1";
    const pageSize = incoming.searchParams.get("page_size") || "24";

    let targetPath = "/v1/images/";

    if (kind === "audio") targetPath = "/v1/audio/";
    if (kind === "rate_limit") targetPath = "/v1/rate_limit/";

    const target = new URL(`https://${OPENVERSE_HOST}${targetPath}`);

    if (kind !== "rate_limit") {
        target.search = cleanSearchParams(incoming.searchParams).toString();
        target.searchParams.set("q", query);
        target.searchParams.set("page", page);
        target.searchParams.set("page_size", pageSize);
    }

    const upstream = await fetch(target.toString(), {
        method: "GET",
        headers: {
            "Accept": "application/json",
            "User-Agent": "AudioMasterLab CommonsProxy/1.0 (no-token public proxy)",
        },
    });

    const text = await upstream.text();

    return new Response(text, {
        status: upstream.status,
        headers: {
            ...corsHeaders(request),
            "Content-Type": upstream.headers.get("Content-Type") || "application/json; charset=utf-8",
            "Cache-Control": upstream.ok ? "public, max-age=180" : "no-store",
        },
    });
}

async function proxyOpenverseRaw(request) {
    const incoming = new URL(request.url);
    const url = incoming.searchParams.get("url");

    if (!url) {
        return json({ error: "Missing url parameter." }, 400, request);
    }

    let target;

    try {
        target = new URL(url);
    } catch {
        return json({ error: "Invalid url parameter." }, 400, request);
    }

    if (target.hostname !== OPENVERSE_HOST || !isAllowedOpenversePath(target.pathname)) {
        return json({ error: "Only allowed Openverse public API paths may be proxied." }, 403, request);
    }

    const upstream = await fetch(target.toString(), {
        method: "GET",
        headers: {
            "Accept": "application/json",
            "User-Agent": "AudioMasterLab CommonsProxy/1.0",
        },
    });

    return new Response(upstream.body, {
        status: upstream.status,
        headers: {
            ...corsHeaders(request),
            "Content-Type": upstream.headers.get("Content-Type") || "application/json; charset=utf-8",
            "Cache-Control": upstream.ok ? "public, max-age=180" : "no-store",
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
        const mode = url.searchParams.get("mode") || "images";

        try {
            if (mode === "images") return await proxyOpenverse(request, "images");
            if (mode === "audio") return await proxyOpenverse(request, "audio");
            if (mode === "rate_limit") return await proxyOpenverse(request, "rate_limit");
            if (mode === "raw") return await proxyOpenverseRaw(request);

            return json({
                error: "Unknown mode.",
                allowed_modes: ["images", "audio", "rate_limit", "raw"],
            }, 400, request);
        } catch (error) {
            return json({
                error: "Commons proxy failed.",
                details: String(error && error.message ? error.message : error),
            }, 502, request);
        }
    },
};