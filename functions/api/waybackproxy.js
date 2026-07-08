// api/waybackproxy.js
//
// Hardened Cloudflare Pages Function for Internet Archive CDX lookups.
//
// Goals:
// - Proxy only https://web.archive.org/cdx/search/cdx.
// - Accept simple domain-first requests like:
//     /api/waybackproxy?url=rafsimons.com
//     /api/waybackproxy?preset=archive_downloads&q=lil%20uzi%20vert
//     /api/waybackproxy?domain=freemusicarchive.org&mode=audio
// - Reject expensive wildcard query injection.
// - Clamp limits and page sizes so many users can share the proxy safely.
// - Cache identical CDX requests at the edge.
// - Return structured JSON errors so the frontend can recover cleanly.
//
// Important frontend rule:
// - Treat `q` as a client-side filter. Do not send keyword wildcards to CDX.
// - For broad domains, request domain/prefix CDX rows first, then filter returned
//   `original` URLs in the frontend for tokens like artist/title/query words.

const CDX_API_URL = "https://web.archive.org/cdx/search/cdx";

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

const SAFE_CDX_FIELDS = new Set([
    "urlkey",
    "timestamp",
    "original",
    "mimetype",
    "statuscode",
    "digest",
    "length",
]);

const DEFAULT_FIELDS = [
    "timestamp",
    "original",
    "statuscode",
    "mimetype",
    "digest",
    "length",
];

const MATCH_TYPES = new Set(["exact", "prefix", "host", "domain"]);
const OUTPUT_TYPES = new Set(["", "text", "json"]);
const COLLAPSE_VALUES = new Set(["", "digest", "urlkey", "timestamp:4", "timestamp:6", "timestamp:8", "timestamp:10"]);

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_LIMIT_FOR_PAGE_MODE = 20;
const MAX_LIMIT_FOR_BROAD_AUDIO = 10;
const MAX_URL_LENGTH = 420;
const CACHE_TTL_SECONDS = 1800;
const STALE_REVALIDATE_SECONDS = 86400;
const UPSTREAM_TIMEOUT_MS = 18000;
const RETRY_TIMEOUT_MS = 9000;

const DOMAIN_PRESETS = {
    archive_downloads: {
        label: "Archive.org downloads",
        target: "archive.org/download/",
        matchType: "prefix",
        mode: "audio",
    },
    archive_audio: {
        label: "Archive.org audio downloads",
        target: "archive.org/download/",
        matchType: "prefix",
        mode: "audio",
    },
    freemusicarchive: {
        label: "Free Music Archive",
        target: "freemusicarchive.org",
        matchType: "domain",
        mode: "audio",
    },
    librivox: {
        label: "LibriVox",
        target: "librivox.org",
        matchType: "domain",
        mode: "audio",
    },
    ccmixter: {
        label: "ccMixter",
        target: "ccmixter.org",
        matchType: "domain",
        mode: "audio",
    },
    commons: {
        label: "Wikimedia Commons",
        target: "commons.wikimedia.org",
        matchType: "domain",
        mode: "audio",
    },
    rafsimons: {
        label: "Raf Simons",
        target: "rafsimons.com",
        matchType: "domain",
        mode: "pages",
    },
};

class HttpError extends Error {
    constructor(message, status = 400, extra = {}) {
        super(message);
        this.name = "HttpError";
        this.status = status;
        this.extra = extra;
    }
}

function getCorsHeaders(request) {
    const origin = request.headers.get("Origin") || "";
    const allowOrigin = ALLOWED_ORIGINS.has(origin)
        ? origin
        : "https://audiomasterlab.com";

    return {
        "Access-Control-Allow-Origin": allowOrigin,
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Accept, Content-Type, If-None-Match, If-Modified-Since",
        "Access-Control-Expose-Headers":
            "Content-Type, Content-Length, ETag, Last-Modified, X-AML-Upstream, X-AML-Cache-Key, X-AML-Mode, X-AML-Client-Query",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
    };
}

function jsonResponse(data, status, corsHeaders, headers = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            ...corsHeaders,
            ...headers,
            "Content-Type": "application/json; charset=utf-8",
        },
    });
}

function jsonError(error, corsHeaders) {
    const status = error?.status || 500;
    const message = error?.message || "Unexpected proxy error";

    return jsonResponse(
        {
            error: message,
            status,
            ...(error?.extra || {}),
        },
        status,
        corsHeaders,
        {
            "Cache-Control": "no-store",
        }
    );
}

function clampNumber(value, min, max, fallback) {
    if (value === null || value === undefined || value === "") {
        return Math.max(min, Math.min(max, fallback));
    }

    const number = Number(value);
    if (!Number.isFinite(number)) return Math.max(min, Math.min(max, fallback));
    return Math.max(min, Math.min(max, Math.trunc(number)));
}

function cleanToken(value) {
    return String(value || "")
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

function getQueryTokens(value) {
    const stopWords = new Set([
        "a",
        "an",
        "and",
        "archive",
        "audio",
        "by",
        "for",
        "from",
        "in",
        "music",
        "of",
        "on",
        "or",
        "the",
        "to",
        "with",
    ]);

    return cleanToken(value)
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2 && !stopWords.has(token))
        .slice(0, 8);
}

function isProbablyHostname(value) {
    const text = String(value || "").trim();
    return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?::\d+)?(?:\/.*)?$/i.test(text);
}

function stripProtocol(value) {
    return String(value || "").replace(/^https?:\/\//i, "");
}

function removeUnsafeTargetCharacters(value) {
    return String(value || "")
        .replace(/[\r\n\t]/g, "")
        .replace(/[<>{}"'`\\]/g, "")
        .trim();
}

function unwrapNestedCdxUrl(value) {
    const raw = String(value || "").trim();

    try {
        const parsed = new URL(raw);
        if (
            parsed.protocol === "https:" &&
            parsed.hostname === "web.archive.org" &&
            parsed.pathname === "/cdx/search/cdx"
        ) {
            return {
                target: parsed.searchParams.get("url") || "",
                params: parsed.searchParams,
                nested: true,
            };
        }
    } catch {
        // Not a URL; treat it as a plain CDX url target.
    }

    return {
        target: raw,
        params: new URLSearchParams(),
        nested: false,
    };
}

function normalizeTarget(value) {
    const unwrapped = unwrapNestedCdxUrl(value);
    let target = removeUnsafeTargetCharacters(unwrapped.target);

    target = stripProtocol(target);
    target = target.replace(/^web\.archive\.org\/web\/[^/]+\//i, "");
    target = target.replace(/^\/+/, "");
    target = target.slice(0, MAX_URL_LENGTH);

    if (!target) {
        throw new HttpError("Missing CDX url target. Use ?url=rafsimons.com or ?preset=archive_downloads.", 400);
    }

    const lower = target.toLowerCase();
    if (
        lower.startsWith("javascript:") ||
        lower.startsWith("data:") ||
        lower.startsWith("file:") ||
        lower === "*" ||
        lower === "*.*" ||
        lower === "http" ||
        lower === "https"
    ) {
        throw new HttpError("Unsafe or too-broad CDX url target was rejected.", 400, { target });
    }

    if (!target.includes("*") && !isProbablyHostname(target)) {
        throw new HttpError("CDX target must be a domain, host/path, or safe wildcard path.", 400, { target });
    }

    return {
        ...unwrapped,
        target,
    };
}

function inferMatchType(target, requestedMatchType, presetMatchType) {
    const requested = String(requestedMatchType || "").trim();
    if (MATCH_TYPES.has(requested)) return requested;
    if (presetMatchType && MATCH_TYPES.has(presetMatchType)) return presetMatchType;

    if (target.startsWith("*.")) return "domain";
    if (target.endsWith("/*")) return "prefix";
    if (target.includes("*")) return "";
    if (target.includes("/")) return "prefix";

    return "domain";
}

function normalizeFields(value) {
    const requested = String(value || "")
        .split(",")
        .map((field) => field.trim())
        .filter(Boolean)
        .filter((field) => SAFE_CDX_FIELDS.has(field));

    return requested.length ? requested : DEFAULT_FIELDS;
}

function normalizeOutput(value) {
    const output = String(value || "").trim().toLowerCase();
    if (!OUTPUT_TYPES.has(output)) return "";
    return output === "text" ? "" : output;
}

function normalizeDate(value) {
    return String(value || "").replace(/[^0-9]/g, "").slice(0, 14);
}

function normalizeMode(value, fallback = "audio") {
    const mode = String(value || fallback || "audio").trim().toLowerCase();
    if (["audio", "pages", "all"].includes(mode)) return mode;
    return "audio";
}

function normalizeCollapse(value, mode) {
    const collapse = String(value || "").trim();
    if (COLLAPSE_VALUES.has(collapse)) return collapse;
    if (mode === "pages") return "digest";
    if (mode === "audio") return "digest";
    return "digest";
}

function normalizeFilters(searchParams, mode) {
    const filters = [];
    const seen = new Set();

    function addFilter(filter) {
        const value = String(filter || "").trim();
        if (!value || seen.has(value)) return;
        seen.add(value);
        filters.push(value);
    }

    addFilter("statuscode:200");

    if (mode === "audio") {
        addFilter("mimetype:audio/.*");
    } else if (mode === "pages") {
        addFilter("mimetype:text/html");
    }

    for (const filter of searchParams.getAll("filter")) {
        const safeFilter = String(filter || "").trim();
        if (!safeFilter) continue;

        // Keep users from bypassing the main status/mimetype safety with broad
        // negative filters. These are easy to make expensive on large domains.
        if (safeFilter.startsWith("!statuscode:") || safeFilter.startsWith("!mimetype:")) {
            continue;
        }

        if (safeFilter.length <= 120) addFilter(safeFilter);
    }

    return filters;
}

function applyQueryToPathTarget(target, query) {
    const tokens = getQueryTokens(query);
    if (!tokens.length) return target;

    const cleanTarget = stripProtocol(target).replace(/\/+$/, "");
    return `${cleanTarget}/*${tokens.join("*")}*`;
}

function isArchiveDownloadsRoot(target) {
    const cleanTarget = stripProtocol(target)
        .toLowerCase()
        .replace(/[?#].*$/g, "")
        .replace(/\/+$/g, "");

    return cleanTarget === "archive.org/download";
}

function hasNarrowArchiveDownloadPath(target) {
    const cleanTarget = stripProtocol(target)
        .toLowerCase()
        .replace(/[?#].*$/g, "")
        .replace(/^\/+/, "")
        .replace(/\/+$/g, "");

    const prefix = "archive.org/download/";
    if (!cleanTarget.startsWith(prefix)) return true;

    const rest = cleanTarget.slice(prefix.length).replace(/\*/g, "");
    return rest.length >= 3;
}

function assertRequestIsSmallEnough({ target, mode, matchType, queryMode, limit, clientQuery }) {
    if (queryMode === "path") {
        throw new HttpError(
            "queryMode=path was rejected because keyword wildcards make Wayback CDX timeout. Send q as a client-side filter instead.",
            400,
            {
                target,
                clientQuery,
                fix: "Use /api/waybackproxy?url=example.com&mode=audio&q=rap%20music. Filter q tokens after parsing returned CDX rows.",
            }
        );
    }

    if (mode === "audio" && isArchiveDownloadsRoot(target)) {
        throw new HttpError(
            "archive.org/download/ is too broad for direct Wayback audio CDX lookup.",
            422,
            {
                target,
                limit,
                fix: "Use the Archive.org advancedsearch/metadata APIs for Archive.org audio, or pass a specific item path like archive.org/download/some_identifier/ to Wayback.",
            }
        );
    }

    if (mode === "audio" && !hasNarrowArchiveDownloadPath(target)) {
        throw new HttpError(
            "Archive download Wayback audio lookups need a specific item/path, not the global download root.",
            422,
            {
                target,
                matchType,
                fix: "Narrow the target before CDX, for example url=archive.org/download/item_identifier/ with matchType=prefix.",
            }
        );
    }
}

function buildRequestPlan(requestUrl) {
    const outerParams = requestUrl.searchParams;
    const presetId = String(outerParams.get("preset") || "").trim();
    const preset = DOMAIN_PRESETS[presetId] || null;
    const rawTarget =
        outerParams.get("url") ||
        outerParams.get("domain") ||
        outerParams.get("target") ||
        preset?.target ||
        "";
    const normalized = normalizeTarget(rawTarget);
    const mergedParams = new URLSearchParams(normalized.params);

    for (const [key, value] of outerParams.entries()) {
        if (!["url", "domain", "target"].includes(key)) {
            mergedParams.append(key, value);
        }
    }

    const mode = normalizeMode(mergedParams.get("mode"), preset?.mode || "audio");
    const queryMode = String(mergedParams.get("queryMode") || "client").toLowerCase();
    const clientQuery = String(mergedParams.get("q") || mergedParams.get("query") || "").trim();
    const target = normalized.target;
    const matchType = inferMatchType(target, mergedParams.get("matchType"), preset?.matchType);
    const output = normalizeOutput(mergedParams.get("output"));
    const fields = normalizeFields(mergedParams.get("fl"));
    const maxLimit = mode === "pages"
        ? MAX_LIMIT_FOR_PAGE_MODE
        : isArchiveDownloadsRoot(target)
            ? MAX_LIMIT_FOR_BROAD_AUDIO
            : MAX_LIMIT;
    const limit = clampNumber(mergedParams.get("limit"), 1, maxLimit, DEFAULT_LIMIT);
    const pageSize = clampNumber(mergedParams.get("pageSize"), 1, 5, 1);
    const pageRaw = mergedParams.get("page");
    const page = pageRaw === null || pageRaw === "" ? "" : clampNumber(pageRaw, 0, 1000, 0);
    const from = normalizeDate(mergedParams.get("from"));
    const to = normalizeDate(mergedParams.get("to"));
    const collapse = normalizeCollapse(mergedParams.get("collapse"), mode);
    const filters = normalizeFilters(mergedParams, mode);
    const showResumeKey = mergedParams.get("showResumeKey") === "true";
    const resumeKey = String(mergedParams.get("resumeKey") || "").trim().slice(0, 300);
    const fastLatest = mergedParams.get("fastLatest") === "true";

    if (target.includes("*") && target.replace(/\*/g, "").length < 8) {
        throw new HttpError("Wildcard target is too broad. Use a real domain or a preset.", 400, { target });
    }

    assertRequestIsSmallEnough({
        target,
        mode,
        matchType,
        queryMode,
        limit,
        clientQuery,
    });

    const cdxParams = new URLSearchParams();
    cdxParams.set("url", target);
    cdxParams.set("fl", fields.join(","));
    cdxParams.set("limit", String(limit));

    if (output) cdxParams.set("output", output);
    if (matchType) cdxParams.set("matchType", matchType);
    if (from) cdxParams.set("from", from);
    if (to) cdxParams.set("to", to);
    if (collapse) cdxParams.set("collapse", collapse);
    if (page !== "") cdxParams.set("page", String(page));
    if (page !== "") cdxParams.set("pageSize", String(pageSize));
    if (showResumeKey) cdxParams.set("showResumeKey", "true");
    if (resumeKey) cdxParams.set("resumeKey", resumeKey);
    if (fastLatest && matchType === "exact") cdxParams.set("fastLatest", "true");

    for (const filter of filters) {
        cdxParams.append("filter", filter);
    }

    const upstreamUrl = `${CDX_API_URL}?${cdxParams.toString()}`;
    const cacheKey = `${requestUrl.origin}${requestUrl.pathname}?${cdxParams.toString()}&mode=${mode}`;

    return {
        upstreamUrl,
        cacheKey,
        cdxParams,
        mode,
        target,
        matchType,
        output,
        clientQuery,
        queryMode,
        presetId,
        limit,
    };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort("CDX upstream timeout"), timeoutMs);

    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timeoutId);
    }
}

function makeRetryPlan(plan) {
    const currentLimit = Number(plan.limit) || DEFAULT_LIMIT;
    if (currentLimit <= 5) return null;

    const retryLimit = Math.max(1, Math.min(5, Math.floor(currentLimit / 2)));
    const cdxParams = new URLSearchParams(plan.cdxParams);
    cdxParams.set("limit", String(retryLimit));

    if (cdxParams.has("page")) {
        cdxParams.set("pageSize", "1");
    }

    const upstreamUrl = `${CDX_API_URL}?${cdxParams.toString()}`;
    const cacheKey = `${plan.cacheKey}&retryLimit=${retryLimit}`;

    return {
        ...plan,
        upstreamUrl,
        cacheKey,
        cdxParams,
        limit: retryLimit,
        retried: true,
    };
}

function makeResponseHeaders(upstreamResponse, corsHeaders, plan) {
    const headers = new Headers(upstreamResponse.headers);
    headers.delete("Set-Cookie");

    for (const [key, value] of Object.entries(corsHeaders)) {
        headers.set(key, value);
    }

    headers.set(
        "Content-Type",
        plan.output === "json"
            ? "application/json; charset=utf-8"
            : "text/plain; charset=utf-8"
    );
    headers.set(
        "Cache-Control",
        `public, max-age=${CACHE_TTL_SECONDS}, stale-while-revalidate=${STALE_REVALIDATE_SECONDS}`
    );
    headers.set("X-AML-Upstream", plan.upstreamUrl);
    headers.set("X-AML-Cache-Key", plan.cacheKey);
    headers.set("X-AML-Mode", plan.mode);
    headers.set("X-AML-Client-Query", plan.clientQuery);

    return headers;
}

async function tryReadCache(cacheKeyRequest) {
    try {
        return await caches.default.match(cacheKeyRequest);
    } catch {
        return null;
    }
}

async function tryWriteCache(cacheKeyRequest, response) {
    try {
        await caches.default.put(cacheKeyRequest, response.clone());
    } catch {
        // Cache writes should never break the proxy response.
    }
}

async function requestCdx(plan, request, timeoutMs = UPSTREAM_TIMEOUT_MS) {
    const accept = request.headers.get("Accept") || (plan.output === "json" ? "application/json" : "text/plain");

    return fetchWithTimeout(
        plan.upstreamUrl,
        {
            method: request.method,
            headers: {
                Accept: accept,
                "User-Agent": "AudioMasterLab-CDX-Proxy/2.0",
            },
            cf: {
                cacheTtl: CACHE_TTL_SECONDS,
                cacheEverything: true,
            },
        },
        timeoutMs
    );
}

function makeOverloadError(upstreamResponse, plan, corsHeaders) {
    return jsonResponse(
        {
            error: "Internet Archive CDX could not handle this request right now. The proxy normalized the request, but the upstream server still rejected or timed out.",
            status: 503,
            upstreamStatus: upstreamResponse?.status || 0,
            target: plan.target,
            mode: plan.mode,
            limit: plan.limit,
            suggestion: "Retry with a smaller limit, a narrower domain/path, a date range, or mode=pages before scraping audio from returned HTML captures.",
        },
        503,
        corsHeaders,
        {
            "Cache-Control": "no-store",
        }
    );
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
        return jsonError(new HttpError("Method not allowed", 405), corsHeaders);
    }

    let plan;

    try {
        plan = buildRequestPlan(new URL(request.url));
    } catch (error) {
        return jsonError(error, corsHeaders);
    }

    const cacheKeyRequest = new Request(plan.cacheKey, { method: "GET" });
    const cached = request.method === "GET" ? await tryReadCache(cacheKeyRequest) : null;
    if (cached) {
        const cachedHeaders = new Headers(cached.headers);
        for (const [key, value] of Object.entries(corsHeaders)) {
            cachedHeaders.set(key, value);
        }
        cachedHeaders.set("X-AML-Cache", "HIT");

        return new Response(cached.body, {
            status: cached.status,
            statusText: cached.statusText,
            headers: cachedHeaders,
        });
    }

    let upstreamResponse;

    try {
        upstreamResponse = await requestCdx(plan, request);
    } catch (error) {
        const retryPlan = makeRetryPlan(plan);

        if (retryPlan) {
            try {
                upstreamResponse = await requestCdx(retryPlan, request, RETRY_TIMEOUT_MS);
                plan = retryPlan;
            } catch (retryError) {
                return jsonResponse(
                    {
                        error: "CDX upstream request timed out or failed before a response was returned.",
                        status: 504,
                        target: plan.target,
                        mode: plan.mode,
                        detail: retryError?.message || error?.message || "fetch failed",
                        suggestion: "Use a narrower url target, add from/to date bounds, or reduce limit to 5.",
                    },
                    504,
                    corsHeaders,
                    {
                        "Cache-Control": "no-store",
                    }
                );
            }
        } else {
            return jsonResponse(
                {
                    error: "CDX upstream request timed out or failed before a response was returned.",
                    status: 504,
                    target: plan.target,
                    mode: plan.mode,
                    detail: error?.message || "fetch failed",
                    suggestion: "Use a narrower url target, add from/to date bounds, or reduce limit to 5.",
                },
                504,
                corsHeaders,
                {
                    "Cache-Control": "no-store",
                }
            );
        }
    }

    if ([429, 500, 502, 503, 504].includes(upstreamResponse.status)) {
        const retryPlan = makeRetryPlan(plan);

        if (retryPlan) {
            try {
                const retryResponse = await requestCdx(retryPlan, request, RETRY_TIMEOUT_MS);
                if (![429, 500, 502, 503, 504].includes(retryResponse.status)) {
                    upstreamResponse = retryResponse;
                    plan = retryPlan;
                }
            } catch {
                // Fall through to the structured overload response below.
            }
        }

        if (![429, 500, 502, 503, 504].includes(upstreamResponse.status)) {
            const responseHeaders = makeResponseHeaders(upstreamResponse, corsHeaders, plan);
            responseHeaders.set("X-AML-Cache", "MISS");
            responseHeaders.set("X-AML-Retry", "limit-reduced");

            return new Response(request.method === "HEAD" ? null : upstreamResponse.body, {
                status: upstreamResponse.status,
                statusText: upstreamResponse.statusText,
                headers: responseHeaders,
            });
        }

        return makeOverloadError(upstreamResponse, plan, corsHeaders);
    }

    const responseHeaders = makeResponseHeaders(upstreamResponse, corsHeaders, plan);
    responseHeaders.set("X-AML-Cache", "MISS");

    const response = new Response(request.method === "HEAD" ? null : upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: responseHeaders,
    });

    if (request.method === "GET" && upstreamResponse.ok) {
        context.waitUntil?.(tryWriteCache(cacheKeyRequest, response.clone()));
    }

    return response;
}
