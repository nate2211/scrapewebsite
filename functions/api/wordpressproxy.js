const ALLOWED_EXACT_HOSTS = new Set([
    "public-api.wordpress.com",
    "wordpress.com",
    "www.wordpress.com",
    "polymathprojects.org",
    "www.polymathprojects.org",
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
]);

const MAX_REDIRECTS = 5;

function normalizeHostname(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\.$/, "");
}

function isWordPressComSubdomain(hostname) {
    const host = normalizeHostname(hostname);

    return (
        host.endsWith(".wordpress.com") &&
        host !== ".wordpress.com"
    );
}

function isAllowedWordPressHost(hostname) {
    const host = normalizeHostname(hostname);

    return (
        ALLOWED_EXACT_HOSTS.has(host) ||
        isWordPressComSubdomain(host)
    );
}

function isPublicWordPressApiHost(hostname) {
    return normalizeHostname(hostname) === "public-api.wordpress.com";
}

function isAllowedFeedQuery(url) {
    const feed = String(url.searchParams.get("feed") || "").toLowerCase();

    return [
        "feed",
        "rss",
        "rss2",
        "rdf",
        "atom",
        "comments-rss2",
    ].includes(feed);
}

function isAllowedRestRouteQuery(url) {
    const restRoute = url.searchParams.get("rest_route");

    if (!restRoute) {
        return false;
    }

    const normalizedRoute = String(restRoute).trim();

    return (
        normalizedRoute === "/" ||
        normalizedRoute.startsWith("/wp/") ||
        normalizedRoute.startsWith("/oembed/") ||
        normalizedRoute.startsWith("/wpcom/")
    );
}

function isAllowedWordPressPath(url) {
    const path = decodeURIComponent(url.pathname || "/").toLowerCase();

    /*
     * WordPress.com's centralized public API supports routes such as:
     *
     * /rest/v1.1/sites/example.wordpress.com/posts/
     * /wp-json/
     * /oembed/1.0/
     */
    if (isPublicWordPressApiHost(url.hostname)) {
        return (
            path === "/rest" ||
            path.startsWith("/rest/") ||
            path === "/wp-json" ||
            path.startsWith("/wp-json/") ||
            path === "/oembed" ||
            path.startsWith("/oembed/")
        );
    }

    /*
     * Standard WordPress REST endpoints.
     */
    if (
        path === "/wp-json" ||
        path.startsWith("/wp-json/")
    ) {
        return true;
    }

    /*
     * Standard WordPress feeds:
     *
     * /feed/
     * /comments/feed/
     * /category/music/feed/
     * /tag/music/feed/
     * /author/name/feed/
     */
    if (
        path === "/feed" ||
        path === "/feed/" ||
        path === "/comments/feed" ||
        path === "/comments/feed/" ||
        path.endsWith("/feed") ||
        path.endsWith("/feed/")
    ) {
        return true;
    }

    /*
     * WordPress installations without pretty permalinks may use:
     *
     * /?rest_route=/wp/v2/posts
     * /?feed=rss2
     */
    if (path === "/" || path === "/index.php") {
        return (
            isAllowedRestRouteQuery(url) ||
            isAllowedFeedQuery(url)
        );
    }

    return false;
}

function validateTargetUrl(url) {
    if (!(url instanceof URL)) {
        return {
            ok: false,
            status: 400,
            error: "Invalid target URL",
        };
    }

    if (url.protocol !== "https:") {
        return {
            ok: false,
            status: 400,
            error: "Only HTTPS target URLs are allowed",
        };
    }

    if (url.username || url.password) {
        return {
            ok: false,
            status: 400,
            error: "Target URLs cannot contain credentials",
        };
    }

    if (url.port && url.port !== "443") {
        return {
            ok: false,
            status: 400,
            error: "Only the standard HTTPS port is allowed",
        };
    }

    if (!isAllowedWordPressHost(url.hostname)) {
        return {
            ok: false,
            status: 403,
            error: "Target WordPress host is not allowed",
        };
    }

    if (!isAllowedWordPressPath(url)) {
        return {
            ok: false,
            status: 403,
            error:
                "Only WordPress REST, oEmbed, RSS, and Atom paths are allowed",
        };
    }

    return {
        ok: true,
    };
}

function getCorsHeaders(request) {
    const origin = request.headers.get("Origin") || "";

    const headers = {
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers":
            "Accept, Content-Type, If-None-Match, If-Modified-Since",
        "Access-Control-Expose-Headers":
            "Content-Type, Content-Length, ETag, Last-Modified, X-WP-Total, X-WP-TotalPages",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
    };

    /*
     * Do not grant an unknown browser origin access.
     * Requests without an Origin header, such as server-to-server calls,
     * do not need Access-Control-Allow-Origin.
     */
    if (ALLOWED_ORIGINS.has(origin)) {
        headers["Access-Control-Allow-Origin"] = origin;
    }

    return headers;
}

function jsonResponse(data, status, headers = {}) {
    return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            ...headers,
        },
    });
}

function getCacheTtl(url) {
    const path = url.pathname.toLowerCase();

    /*
     * Feeds should refresh more frequently than individual REST resources.
     */
    if (
        path.endsWith("/feed") ||
        path.endsWith("/feed/") ||
        isAllowedFeedQuery(url)
    ) {
        return 300;
    }

    return 900;
}

function copyForwardedRequestHeaders(request) {
    const headers = new Headers();

    const forwardedHeaderNames = [
        "Accept",
        "If-None-Match",
        "If-Modified-Since",
    ];

    for (const name of forwardedHeaderNames) {
        const value = request.headers.get(name);

        if (value) {
            headers.set(name, value);
        }
    }

    /*
     * Some WordPress installations reject requests with no recognizable
     * User-Agent.
     */
    headers.set(
        "User-Agent",
        "AudioMasterLab-WordPressProxy/1.0"
    );

    return headers;
}

async function fetchWithValidatedRedirects({
    initialUrl,
    method,
    headers,
}) {
    let currentUrl = new URL(initialUrl.toString());

    for (
        let redirectCount = 0;
        redirectCount <= MAX_REDIRECTS;
        redirectCount += 1
    ) {
        const validation = validateTargetUrl(currentUrl);

        if (!validation.ok) {
            throw new ProxyRequestError(
                validation.error,
                validation.status,
                currentUrl.toString()
            );
        }

        const cacheTtl = getCacheTtl(currentUrl);

        const response = await fetch(currentUrl.toString(), {
            method,
            headers,
            redirect: "manual",

            /*
             * Cloudflare-specific cache options.
             * Cache-Control is also added to the outgoing proxy response.
             */
            cf: {
                cacheEverything: method === "GET",
                cacheTtl,
            },
        });

        if (
            response.status < 300 ||
            response.status > 399
        ) {
            return {
                response,
                finalUrl: currentUrl,
                cacheTtl,
            };
        }

        const location = response.headers.get("Location");

        if (!location) {
            return {
                response,
                finalUrl: currentUrl,
                cacheTtl,
            };
        }

        if (redirectCount >= MAX_REDIRECTS) {
            throw new ProxyRequestError(
                "WordPress upstream exceeded the redirect limit",
                502,
                currentUrl.toString()
            );
        }

        const redirectedUrl = new URL(
            location,
            currentUrl
        );

        const redirectValidation =
            validateTargetUrl(redirectedUrl);

        if (!redirectValidation.ok) {
            throw new ProxyRequestError(
                `Blocked unsafe WordPress redirect: ${redirectValidation.error}`,
                502,
                redirectedUrl.toString()
            );
        }

        currentUrl = redirectedUrl;
    }

    throw new ProxyRequestError(
        "WordPress upstream redirect processing failed",
        502,
        currentUrl.toString()
    );
}

class ProxyRequestError extends Error {
    constructor(message, status = 500, targetUrl = "") {
        super(message);

        this.name = "ProxyRequestError";
        this.status = status;
        this.targetUrl = targetUrl;
    }
}

function buildResponseHeaders({
    upstreamResponse,
    corsHeaders,
    finalUrl,
    cacheTtl,
}) {
    const headers = new Headers(upstreamResponse.headers);

    /*
     * Do not relay cookies, security-reporting configuration, or upstream
     * infrastructure information through the public proxy.
     */
    const blockedResponseHeaders = [
        "Set-Cookie",
        "Set-Cookie2",
        "Content-Security-Policy",
        "Content-Security-Policy-Report-Only",
        "Report-To",
        "Reporting-Endpoints",
        "NEL",
        "Server",
        "Via",
        "Alt-Svc",
        "CF-Ray",
        "CF-Cache-Status",
    ];

    for (const name of blockedResponseHeaders) {
        headers.delete(name);
    }

    for (const [key, value] of Object.entries(corsHeaders)) {
        headers.set(key, value);
    }

    headers.set(
        "Cache-Control",
        `public, max-age=${cacheTtl}, stale-while-revalidate=300`
    );

    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "no-referrer");
    headers.set(
        "X-WordPress-Proxy-Final-Host",
        finalUrl.hostname
    );

    return headers;
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

    if (
        request.method !== "GET" &&
        request.method !== "HEAD"
    ) {
        return jsonResponse(
            {
                ok: false,
                error: "Method not allowed",
                allowedMethods: [
                    "GET",
                    "HEAD",
                    "OPTIONS",
                ],
            },
            405,
            {
                ...corsHeaders,
                Allow: "GET, HEAD, OPTIONS",
            }
        );
    }

    const requestUrl = new URL(request.url);
    const rawTargetUrl =
        requestUrl.searchParams.get("url");

    if (!rawTargetUrl) {
        return jsonResponse(
            {
                ok: false,
                error: "Missing ?url= parameter",
                examples: {
                    rest:
                        "/api/wordpressproxy?url=https%3A%2F%2Fterrytao.wordpress.com%2Fwp-json%2Fwp%2Fv2%2Fposts%3Fper_page%3D10",
                    feed:
                        "/api/wordpressproxy?url=https%3A%2F%2Fterrytao.wordpress.com%2Ffeed%2F",
                },
            },
            400,
            corsHeaders
        );
    }

    let targetUrl;

    try {
        targetUrl = new URL(rawTargetUrl);
    } catch {
        return jsonResponse(
            {
                ok: false,
                error: "Invalid target URL",
            },
            400,
            corsHeaders
        );
    }

    const validation = validateTargetUrl(targetUrl);

    if (!validation.ok) {
        return jsonResponse(
            {
                ok: false,
                error: validation.error,
                targetHost: targetUrl.hostname,
                targetPath: targetUrl.pathname,
            },
            validation.status,
            corsHeaders
        );
    }

    const upstreamHeaders =
        copyForwardedRequestHeaders(request);

    try {
        const {
            response: upstreamResponse,
            finalUrl,
            cacheTtl,
        } = await fetchWithValidatedRedirects({
            initialUrl: targetUrl,
            method: request.method,
            headers: upstreamHeaders,
        });

        const responseHeaders = buildResponseHeaders({
            upstreamResponse,
            corsHeaders,
            finalUrl,
            cacheTtl,
        });

        return new Response(
            request.method === "HEAD"
                ? null
                : upstreamResponse.body,
            {
                status: upstreamResponse.status,
                statusText:
                    upstreamResponse.statusText,
                headers: responseHeaders,
            }
        );
    } catch (error) {
        const isProxyError =
            error instanceof ProxyRequestError;

        return jsonResponse(
            {
                ok: false,
                error: isProxyError
                    ? error.message
                    : "WordPress upstream request failed",
                targetUrl: isProxyError
                    ? error.targetUrl
                    : targetUrl.toString(),
                details:
                    error instanceof Error
                        ? error.message
                        : String(error),
            },
            isProxyError ? error.status : 502,
            corsHeaders
        );
    }
}

