const TARGET_ORIGIN = "https://www.traditionsofthesun.org";

const ALLOWED_TARGET_HOSTS = new Set([
    "traditionsofthesun.org",
    "www.traditionsofthesun.org",
]);

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

const ENDPOINTS = Object.freeze({
    site: "/wp-json/",
    posts: "/wp-json/wp/v2/posts",
    pages: "/wp-json/wp/v2/pages",
    media: "/wp-json/wp/v2/media",
    categories: "/wp-json/wp/v2/categories",
    tags: "/wp-json/wp/v2/tags",
    search: "/wp-json/wp/v2/search",
    feed: "/feed/",
    "comments-feed": "/comments/feed/",
});

const CONTROL_QUERY_KEYS = new Set([
    "url",
    "endpoint",
    "id",
]);

const COLLECTION_QUERY_KEYS = new Set([
    "context",
    "page",
    "per_page",
    "search",
    "after",
    "modified_after",
    "before",
    "modified_before",
    "exclude",
    "include",
    "offset",
    "order",
    "orderby",
    "slug",
    "status",
    "_fields",
    "_embed",
]);

const POST_QUERY_KEYS = new Set([
    ...COLLECTION_QUERY_KEYS,
    "author",
    "author_exclude",
    "categories",
    "categories_exclude",
    "tags",
    "tags_exclude",
    "sticky",
]);

const PAGE_QUERY_KEYS = new Set([
    ...COLLECTION_QUERY_KEYS,
    "author",
    "author_exclude",
    "parent",
    "parent_exclude",
    "menu_order",
]);

const MEDIA_QUERY_KEYS = new Set([
    ...COLLECTION_QUERY_KEYS,
    "author",
    "author_exclude",
    "parent",
    "parent_exclude",
    "media_type",
    "mime_type",
]);

const TAXONOMY_QUERY_KEYS = new Set([
    ...COLLECTION_QUERY_KEYS,
    "hide_empty",
    "parent",
    "post",
]);

const SEARCH_QUERY_KEYS = new Set([
    "context",
    "page",
    "per_page",
    "search",
    "type",
    "subtype",
    "exclude",
    "include",
    "order",
    "orderby",
    "_fields",
]);

const FEED_QUERY_KEYS = new Set([
    "paged",
]);

const MAX_PER_PAGE = 100;
const MAX_PAGE = 10000;
const MAX_OFFSET = 10000;
const MAX_SEARCH_LENGTH = 200;
const MAX_QUERY_VALUE_LENGTH = 1000;
const UPSTREAM_TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 3;

function getCorsHeaders(request) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = ALLOWED_ORIGINS.has(origin)
        ? origin
        : "https://audiomasterlab.com";

    return {
        "Access-Control-Allow-Origin": allowedOrigin,
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers":
            "Accept, Content-Type, Range, If-None-Match, If-Modified-Since",
        "Access-Control-Expose-Headers":
            "Content-Type, Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified, Link, X-WP-Total, X-WP-TotalPages",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
    };
}

function jsonResponse(request, data, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            ...getCorsHeaders(request),
            ...extraHeaders,
        },
    });
}

function normalizeHost(hostname) {
    return String(hostname || "").trim().toLowerCase();
}

function isAllowedHost(hostname) {
    return ALLOWED_TARGET_HOSTS.has(normalizeHost(hostname));
}

function classifyPath(pathname) {
    const normalizedPath =
        pathname.length > 1 && pathname.endsWith("/")
            ? pathname.slice(0, -1)
            : pathname;

    if (normalizedPath === "/wp-json") {
        return { type: "site", item: false };
    }

    if (normalizedPath === "/feed") {
        return { type: "feed", item: false };
    }

    if (normalizedPath === "/comments/feed") {
        return { type: "comments-feed", item: false };
    }

    const match = normalizedPath.match(
        /^\/wp-json\/wp\/v2\/(posts|pages|media|categories|tags|search)(?:\/(\d+))?$/
    );

    if (!match) {
        return null;
    }

    const type = match[1];
    const itemId = match[2] || null;

    if (type === "search" && itemId) {
        return null;
    }

    return {
        type,
        item: Boolean(itemId),
        itemId,
    };
}

function getAllowedQueryKeys(route) {
    switch (route.type) {
        case "posts":
            return POST_QUERY_KEYS;
        case "pages":
            return PAGE_QUERY_KEYS;
        case "media":
            return MEDIA_QUERY_KEYS;
        case "categories":
        case "tags":
            return TAXONOMY_QUERY_KEYS;
        case "search":
            return SEARCH_QUERY_KEYS;
        case "feed":
        case "comments-feed":
            return FEED_QUERY_KEYS;
        case "site":
            return new Set(["context"]);
        default:
            return new Set();
    }
}

function parseBoundedInteger(value, name, minimum, maximum) {
    if (!/^\d+$/.test(value)) {
        throw new Error(`${name} must be an integer`);
    }

    const parsed = Number(value);

    if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
        throw new Error(
            `${name} must be between ${minimum} and ${maximum}`
        );
    }

    return String(parsed);
}

function validateQueryValue(key, value) {
    if (value.length > MAX_QUERY_VALUE_LENGTH) {
        throw new Error(`${key} is too long`);
    }

    if (key === "per_page") {
        return parseBoundedInteger(
            value,
            "per_page",
            1,
            MAX_PER_PAGE
        );
    }

    if (key === "page") {
        return parseBoundedInteger(value, "page", 1, MAX_PAGE);
    }

    if (key === "offset") {
        return parseBoundedInteger(value, "offset", 0, MAX_OFFSET);
    }

    if (key === "paged") {
        return parseBoundedInteger(value, "paged", 1, MAX_PAGE);
    }

    if (key === "search" && value.length > MAX_SEARCH_LENGTH) {
        throw new Error(
            `search must be ${MAX_SEARCH_LENGTH} characters or fewer`
        );
    }

    if (key === "context" && value !== "view" && value !== "embed") {
        throw new Error("Only context=view or context=embed is allowed");
    }

    if (key === "order" && value !== "asc" && value !== "desc") {
        throw new Error("order must be asc or desc");
    }

    if (
        (key === "_embed" || key === "hide_empty" || key === "sticky") &&
        !["", "1", "0", "true", "false"].includes(value)
    ) {
        throw new Error(`${key} must be true or false`);
    }

    return value;
}

function sanitizeTargetUrl(targetUrl) {
    if (targetUrl.protocol !== "https:") {
        throw new Error("Only HTTPS target URLs are allowed");
    }

    if (!isAllowedHost(targetUrl.hostname)) {
        throw new Error("Target host is not allowed");
    }

    if (targetUrl.username || targetUrl.password) {
        throw new Error("Credentials are not allowed in target URLs");
    }

    targetUrl.hash = "";

    const route = classifyPath(targetUrl.pathname);

    if (!route) {
        throw new Error(
            "Only the public WordPress REST routes and RSS feeds are allowed"
        );
    }

    const allowedKeys = getAllowedQueryKeys(route);
    const sanitizedParams = new URLSearchParams();

    for (const [key, rawValue] of targetUrl.searchParams.entries()) {
        if (!allowedKeys.has(key)) {
            throw new Error(`Query parameter "${key}" is not allowed`);
        }

        const value = validateQueryValue(key, rawValue);
        sanitizedParams.append(key, value);
    }

    targetUrl.search = sanitizedParams.toString();

    return { targetUrl, route };
}

function buildTargetUrl(requestUrl) {
    const rawTargetUrl = requestUrl.searchParams.get("url");

    if (rawTargetUrl) {
        let parsedUrl;

        try {
            parsedUrl = new URL(rawTargetUrl);
        } catch {
            throw new Error("Invalid target URL");
        }

        return sanitizeTargetUrl(parsedUrl);
    }

    const endpoint = (
        requestUrl.searchParams.get("endpoint") || "posts"
    ).toLowerCase();

    const basePath = ENDPOINTS[endpoint];

    if (!basePath) {
        throw new Error(
            `Unknown endpoint. Allowed endpoints: ${Object.keys(ENDPOINTS).join(
                ", "
            )}`
        );
    }

    const targetUrl = new URL(basePath, TARGET_ORIGIN);
    const id = requestUrl.searchParams.get("id");

    if (id !== null) {
        if (
            !["posts", "pages", "media", "categories", "tags"].includes(
                endpoint
            )
        ) {
            throw new Error(`endpoint=${endpoint} does not accept id`);
        }

        const normalizedId = parseBoundedInteger(
            id,
            "id",
            1,
            Number.MAX_SAFE_INTEGER
        );

        targetUrl.pathname = `${targetUrl.pathname.replace(
            /\/$/,
            ""
        )}/${normalizedId}`;
    }

    for (const [key, value] of requestUrl.searchParams.entries()) {
        if (CONTROL_QUERY_KEYS.has(key)) {
            continue;
        }

        targetUrl.searchParams.append(key, value);
    }

    return sanitizeTargetUrl(targetUrl);
}

function getCacheTtl(route, targetUrl) {
    if (route.type === "feed" || route.type === "comments-feed") {
        return 900;
    }

    if (
        route.type === "search" ||
        targetUrl.searchParams.has("search")
    ) {
        return 120;
    }

    if (route.item) {
        return 900;
    }

    return 300;
}

function createUpstreamHeaders(request) {
    const headers = new Headers();

    headers.set(
        "Accept",
        request.headers.get("Accept") ||
        "application/json, application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5"
    );

    headers.set(
        "User-Agent",
        "AudioMasterLab-TraditionsOfTheSunProxy/1.0"
    );

    const range = request.headers.get("Range");
    if (range) {
        headers.set("Range", range);
    }

    const ifNoneMatch = request.headers.get("If-None-Match");
    if (ifNoneMatch) {
        headers.set("If-None-Match", ifNoneMatch);
    }

    const ifModifiedSince = request.headers.get("If-Modified-Since");
    if (ifModifiedSince) {
        headers.set("If-Modified-Since", ifModifiedSince);
    }

    return headers;
}

async function fetchWithValidatedRedirects(
    initialUrl,
    options,
    maxRedirects = MAX_REDIRECTS
) {
    let currentUrl = new URL(initialUrl);

    for (let redirectCount = 0; ; redirectCount += 1) {
        const response = await fetch(currentUrl.toString(), {
            ...options,
            redirect: "manual",
        });

        if (
            ![301, 302, 303, 307, 308].includes(response.status)
        ) {
            return {
                response,
                finalUrl: currentUrl,
            };
        }

        if (redirectCount >= maxRedirects) {
            throw new Error("Too many upstream redirects");
        }

        const location = response.headers.get("Location");

        if (!location) {
            throw new Error(
                "Upstream redirect did not include a Location header"
            );
        }

        const nextUrl = new URL(location, currentUrl);
        sanitizeTargetUrl(nextUrl);
        currentUrl = nextUrl;
    }
}

function copySafeResponseHeaders(
    upstreamResponse,
    request,
    cacheTtl,
    finalUrl
) {
    const responseHeaders = new Headers();

    const allowedResponseHeaders = [
        "Content-Type",
        "Content-Length",
        "Content-Range",
        "Accept-Ranges",
        "ETag",
        "Last-Modified",
        "Link",
        "X-WP-Total",
        "X-WP-TotalPages",
    ];

    for (const headerName of allowedResponseHeaders) {
        const value = upstreamResponse.headers.get(headerName);
        if (value !== null) {
            responseHeaders.set(headerName, value);
        }
    }

    for (const [key, value] of Object.entries(getCorsHeaders(request))) {
        responseHeaders.set(key, value);
    }

    responseHeaders.set(
        "Cache-Control",
        upstreamResponse.ok
            ? `public, max-age=${cacheTtl}, s-maxage=${cacheTtl}, stale-while-revalidate=60`
            : "no-store"
    );

    responseHeaders.set(
        "X-Proxy-Upstream",
        `${finalUrl.origin}${finalUrl.pathname}`
    );

    responseHeaders.set(
        "X-Content-Type-Options",
        "nosniff"
    );

    return responseHeaders;
}

export async function onRequest(context) {
    const { request } = context;
    const corsHeaders = getCorsHeaders(request);

    if (request.method === "OPTIONS") {
        return new Response(null, {
            status: 204,
            headers: corsHeaders,
        });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
        return jsonResponse(
            request,
            {
                error: "Method not allowed",
                allowedMethods: ["GET", "HEAD", "OPTIONS"],
            },
            405,
            {
                Allow: "GET, HEAD, OPTIONS",
            }
        );
    }

    let target;
    let route;

    try {
        const built = buildTargetUrl(new URL(request.url));
        target = built.targetUrl;
        route = built.route;
    } catch (error) {
        return jsonResponse(
            request,
            {
                error: "Invalid proxy request",
                message:
                    error instanceof Error
                        ? error.message
                        : String(error),
                examples: [
                    "/api/traditionsofthesunproxy?endpoint=posts&per_page=12&_embed=1",
                    "/api/traditionsofthesunproxy?endpoint=search&search=solar&per_page=10",
                    "/api/traditionsofthesunproxy?endpoint=categories&per_page=100",
                    "/api/traditionsofthesunproxy?endpoint=feed",
                ],
            },
            400
        );
    }

    const cacheTtl = getCacheTtl(route, target);
    const controller = new AbortController();
    const timeoutId = setTimeout(
        () => controller.abort("Upstream request timed out"),
        UPSTREAM_TIMEOUT_MS
    );

    try {
        const { response: upstreamResponse, finalUrl } =
            await fetchWithValidatedRedirects(target, {
                method: request.method,
                headers: createUpstreamHeaders(request),
                signal: controller.signal,
                cf: {
                    cacheEverything: true,
                    cacheTtl,
                },
            });

        const responseHeaders = copySafeResponseHeaders(
            upstreamResponse,
            request,
            cacheTtl,
            finalUrl
        );

        return new Response(
            request.method === "HEAD"
                ? null
                : upstreamResponse.body,
            {
                status: upstreamResponse.status,
                statusText: upstreamResponse.statusText,
                headers: responseHeaders,
            }
        );
    } catch (error) {
        const timedOut =
            error instanceof Error &&
            (error.name === "AbortError" ||
                error.message.toLowerCase().includes("timed out"));

        return jsonResponse(
            request,
            {
                error: timedOut
                    ? "Traditions of the Sun upstream timed out"
                    : "Traditions of the Sun upstream request failed",
                message:
                    error instanceof Error
                        ? error.message
                        : String(error),
                target: `${target.origin}${target.pathname}`,
            },
            timedOut ? 504 : 502
        );
    } finally {
        clearTimeout(timeoutId);
    }
}