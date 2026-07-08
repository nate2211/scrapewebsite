const ALLOWED_ORIGINS = new Set([
    "https://suiteofficelab.com",
    "https://audiomasterlab.com",
    "https://www.audiomasterlab.com",
    "https://videomasterlab.com",
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:5173",
]);

const YANDEX_HOSTS = new Set([
    "music.yandex.ru",
]);

function getCorsHeaders(request) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = ALLOWED_ORIGINS.has(origin)
        ? origin
        : "https://audiomasterlab.com";

    return {
        "Access-Control-Allow-Origin": allowedOrigin,
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Accept",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin",
    };
}

function jsonResponse(request, data, status = 200) {
    return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: {
            ...getCorsHeaders(request),
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": status >= 400 ? "no-store" : "public, max-age=120",
            "Content-Disposition": "inline",
        },
    });
}

function textResponse(request, text, status = 200, contentType = "text/plain; charset=utf-8") {
    return new Response(text, {
        status,
        headers: {
            ...getCorsHeaders(request),
            "Content-Type": contentType,
            "Cache-Control": status >= 400 ? "no-store" : "public, max-age=120",
            "Content-Disposition": "inline",
            "X-Content-Type-Options": "nosniff",
        },
    });
}

function normalizeQuery(value) {
    return String(value || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 160);
}

function isAllowedYandexUrl(targetUrl) {
    if (!YANDEX_HOSTS.has(targetUrl.hostname)) return false;

    return (
        targetUrl.pathname === "/search" ||
        targetUrl.pathname === "/opensearch.xml"
    );
}

function buildSearchUrl(request) {
    const incoming = new URL(request.url);

    const q =
        incoming.searchParams.get("q") ||
        incoming.searchParams.get("query") ||
        incoming.searchParams.get("text") ||
        "";

    const cleanQuery = normalizeQuery(q);

    if (!cleanQuery) {
        throw new Error("Missing q, query, or text parameter.");
    }

    const target = new URL("https://music.yandex.ru/search");
    target.searchParams.set("text", cleanQuery);

    return target;
}

function buildOpenSearchUrl(request) {
    const incoming = new URL(request.url);

    const q =
        incoming.searchParams.get("q") ||
        incoming.searchParams.get("query") ||
        incoming.searchParams.get("text") ||
        "";

    const cleanQuery = normalizeQuery(q);

    if (!cleanQuery) {
        throw new Error("Missing q, query, or text parameter.");
    }

    const target = new URL("https://music.yandex.ru/opensearch.xml");
    target.searchParams.set("text", cleanQuery);

    return target;
}

async function fetchYandex(request, targetUrl) {
    if (!isAllowedYandexUrl(targetUrl)) {
        return jsonResponse(
            request,
            {
                error: "Blocked target.",
                message: "Only music.yandex.ru/search and music.yandex.ru/opensearch.xml are allowed.",
            },
            403
        );
    }

    const upstream = await fetch(targetUrl.toString(), {
        method: "GET",
        headers: {
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "User-Agent":
                "Mozilla/5.0 AudioMasterLabMusicYandexProxy/1.0 (+https://audiomasterlab.com)",
        },
        redirect: "follow",
    });

    const body = await upstream.text();
    const upstreamType = upstream.headers.get("Content-Type") || "";

    const contentType = upstreamType.includes("xml")
        ? "application/xml; charset=utf-8"
        : "text/html; charset=utf-8";

    return textResponse(request, body, upstream.status, contentType);
}

export default {
    async fetch(request) {
        if (request.method === "OPTIONS") {
            return new Response(null, {
                status: 204,
                headers: getCorsHeaders(request),
            });
        }

        if (request.method !== "GET") {
            return jsonResponse(request, { error: "Only GET is allowed." }, 405);
        }

        const incoming = new URL(request.url);
        const mode = incoming.searchParams.get("mode") || "search";

        try {
            if (mode === "search" || mode === "html") {
                const targetUrl = buildSearchUrl(request);
                return await fetchYandex(request, targetUrl);
            }

            if (mode === "opensearch" || mode === "xml") {
                const targetUrl = buildOpenSearchUrl(request);
                return await fetchYandex(request, targetUrl);
            }

            return jsonResponse(
                request,
                {
                    error: "Unknown mode.",
                    allowed_modes: ["search", "html", "opensearch", "xml"],
                },
                400
            );
        } catch (error) {
            return jsonResponse(
                request,
                {
                    error: "MusicYandex proxy failed.",
                    details: String(error && error.message ? error.message : error),
                },
                400
            );
        }
    },
};