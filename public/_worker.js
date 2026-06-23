const APP_NAME = "ScrapeWebsite API";
const DEFAULT_MAX_BYTES = 1_000_000;
const DEFAULT_TIMEOUT_MS = 12_000;

const BLOCKED_HOST_PATTERNS = [
    /^localhost$/i,
    /^127\./,
    /^0\.0\.0\.0$/,
    /^10\./,
    /^192\.168\./,
    /^172\.(1[6-9]|2\d|3[0-1])\./,
    /^169\.254\./,
    /^::1$/,
    /^\[::1\]$/,
    /\.local$/i,
    /\.localhost$/i,
];

const TEXT_CONTENT_TYPES = [
    "text/html",
    "text/plain",
    "application/json",
    "application/ld+json",
    "application/xml",
    "text/xml",
    "application/xhtml+xml",
];

function corsHeaders(extra = {}) {
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
        "Cache-Control": "no-store",
        ...extra,
    };
}

function json(data, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            ...corsHeaders(extraHeaders),
        },
    });
}

function textResponse(value, status = 200, extraHeaders = {}) {
    return new Response(value, {
        status,
        headers: {
            "Content-Type": "text/plain; charset=utf-8",
            ...corsHeaders(extraHeaders),
        },
    });
}

async function readJsonBody(request) {
    try {
        return await request.json();
    } catch {
        return {};
    }
}

function validatePublicUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== "string") {
        throw new Error("Missing URL.");
    }

    let parsed;

    try {
        parsed = new URL(rawUrl);
    } catch {
        throw new Error("Invalid URL.");
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error("Only http and https URLs are allowed.");
    }

    const hostname = parsed.hostname.toLowerCase();

    if (!hostname || hostname.length > 253) {
        throw new Error("Invalid hostname.");
    }

    for (const pattern of BLOCKED_HOST_PATTERNS) {
        if (pattern.test(hostname)) {
            throw new Error("Local, private, or internal hosts are blocked.");
        }
    }

    return parsed;
}

function normalizeUrl(rawUrl, baseUrl) {
    try {
        return new URL(rawUrl, baseUrl).toString();
    } catch {
        return null;
    }
}

async function fetchLimited(rawUrl) {
    const parsed = validatePublicUrl(rawUrl);
    const controller = new AbortController();

    const timeout = setTimeout(() => {
        controller.abort("Scrape timeout");
    }, DEFAULT_TIMEOUT_MS);

    try {
        const response = await fetch(parsed.toString(), {
            method: "GET",
            redirect: "follow",
            signal: controller.signal,
            headers: {
                "User-Agent": "ScrapeWebsiteBot/1.0",
                Accept:
                    "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,text/plain;q=0.7,*/*;q=0.3",
                "Accept-Language": "en-US,en;q=0.9",
            },
        });

        const contentType = response.headers.get("content-type") || "";
        const lowerContentType = contentType.toLowerCase();

        const isTextLike = TEXT_CONTENT_TYPES.some((type) =>
            lowerContentType.includes(type)
        );

        if (!isTextLike) {
            throw new Error(`Unsupported content type: ${contentType || "unknown"}`);
        }

        const fullText = await response.text();
        const text = fullText.slice(0, DEFAULT_MAX_BYTES);

        return {
            response,
            text,
            truncated: fullText.length > DEFAULT_MAX_BYTES,
            finalUrl: response.url || parsed.toString(),
        };
    } finally {
        clearTimeout(timeout);
    }
}

function decodeEntities(value = "") {
    return String(value)
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&apos;/gi, "'")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">");
}

function cleanText(value = "") {
    return decodeEntities(value)
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function firstMatch(html, regex) {
    const match = String(html || "").match(regex);
    return match ? cleanText(match[1]) : "";
}

function allMatches(html, regex, mapper, limit = 80) {
    const matches = [];
    const text = String(html || "");
    let match;

    while ((match = regex.exec(text)) && matches.length < limit) {
        const mapped = mapper(match);

        if (mapped) {
            matches.push(mapped);
        }
    }

    return matches;
}

function uniqueBy(items, getter) {
    const seen = new Set();
    const out = [];

    for (const item of items) {
        const key = getter(item);

        if (!key || seen.has(key)) continue;

        seen.add(key);
        out.push(item);
    }

    return out;
}

function extractMeta(html, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    return (
        firstMatch(
            html,
            new RegExp(
                `<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`,
                "i"
            )
        ) ||
        firstMatch(
            html,
            new RegExp(
                `<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${escaped}["'][^>]*>`,
                "i"
            )
        )
    );
}

function extractCanonical(html, baseUrl) {
    const href = firstMatch(
        html,
        /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/i
    );

    return href ? normalizeUrl(href, baseUrl) : null;
}

function extractLinks(html, baseUrl) {
    const links = allMatches(
        html,
        /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
        (match) => {
            const href = normalizeUrl(match[1], baseUrl);

            if (!href) return null;

            return {
                href,
                text: cleanText(match[2]).slice(0, 180),
            };
        },
        160
    );

    return uniqueBy(links, (item) => item.href).slice(0, 100);
}

function extractImages(html, baseUrl) {
    const images = allMatches(
        html,
        /<img\b[^>]*src=["']([^"']+)["'][^>]*>/gi,
        (match) => {
            const src = normalizeUrl(match[1], baseUrl);

            if (!src) return null;

            return {
                src,
                alt: firstMatch(match[0], /alt=["']([^"']*)["']/i),
            };
        },
        120
    );

    return uniqueBy(images, (item) => item.src).slice(0, 60);
}

function extractHeadings(html) {
    return allMatches(
        html,
        /<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1>/gi,
        (match) => ({
            level: Number(match[1]),
            text: cleanText(match[2]).slice(0, 220),
        }),
        80
    ).filter((item) => item.text);
}

function extractJsonLd(html) {
    const scripts = allMatches(
        html,
        /<script\b[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
        (match) => match[1].trim(),
        20
    );

    const parsed = [];

    for (const script of scripts) {
        try {
            parsed.push(JSON.parse(script));
        } catch {
            parsed.push({
                parseError: true,
                preview: script.slice(0, 1200),
            });
        }
    }

    return parsed;
}

function extractPriceCandidates(text) {
    const matches =
        String(text || "").match(
            /(?:\$|USD\s?)\s?\d{1,5}(?:,\d{3})*(?:\.\d{2})?/gi
        ) || [];

    return [...new Set(matches)].slice(0, 50);
}

function extractApiCandidates(html, baseUrl) {
    const candidates = [];

    const urlMatches =
        String(html || "").match(
            /https?:\/\/[^\s"'<>\\]+|\/(?:api|graphql|v\d+|search|products|items|listings|query|ajax|rest|wp-json)[^\s"'<>\\]*/gi
        ) || [];

    for (const item of urlMatches) {
        const normalized = normalizeUrl(item, baseUrl);

        if (!normalized) continue;

        if (
            /\/api\/|graphql|\/v\d+\/|search|products|items|listings|query|ajax|rest|wp-json/i.test(
                normalized
            )
        ) {
            candidates.push(normalized);
        }
    }

    return [...new Set(candidates)].slice(0, 80);
}

function extractEmails(text) {
    const matches =
        String(text || "").match(
            /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}/g
        ) || [];

    return [...new Set(matches)].slice(0, 30);
}

function extractPhones(text) {
    const matches =
        String(text || "").match(
            /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}/g
        ) || [];

    return [...new Set(matches)].slice(0, 30);
}

function scoreTextAgainstQuery(text, query) {
    const words = String(query || "")
        .toLowerCase()
        .split(/\s+/)
        .filter((word) => word.length > 2)
        .slice(0, 25);

    const haystack = String(text || "").toLowerCase();

    return words.reduce((score, word) => {
        return haystack.includes(word) ? score + 1 : score;
    }, 0);
}

function extractPageData({
                             html,
                             url,
                             query = "",
                             mode = "research",
                             status,
                             contentType,
                             truncated,
                         }) {
    const text = cleanText(html);

    const title =
        firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i) ||
        extractMeta(html, "og:title") ||
        extractMeta(html, "twitter:title") ||
        "Untitled";

    const description =
        extractMeta(html, "description") ||
        extractMeta(html, "og:description") ||
        extractMeta(html, "twitter:description");

    const headings = extractHeadings(html);
    const links = extractLinks(html, url);
    const images = extractImages(html, url);
    const jsonLd = extractJsonLd(html);
    const prices = extractPriceCandidates(`${html}\n${text}`);
    const apiCandidates = extractApiCandidates(html, url);
    const emails = extractEmails(text);
    const phones = extractPhones(text);

    const baseData = {
        url,
        finalUrl: url,
        status,
        contentType,
        truncated,
        title,
        description,
        canonical: extractCanonical(html, url),
        wordCount: text ? text.split(/\s+/).filter(Boolean).length : 0,
        queryScore: scoreTextAgainstQuery(`${title} ${description} ${text}`, query),
        mode,
        headings,
        links,
        images,
        jsonLd,
        prices,
        apiCandidates,
        emails,
        phones,
        textPreview: text.slice(0, 5000),
    };

    if (mode === "quick") {
        return {
            ...baseData,
            headings: headings.slice(0, 10),
            links: links.slice(0, 15),
            images: images.slice(0, 12),
            jsonLd: [],
            apiCandidates: apiCandidates.slice(0, 10),
            textPreview: text.slice(0, 1800),
        };
    }

    if (mode === "product") {
        return {
            ...baseData,
            productSignals: {
                hasPrices: prices.length > 0,
                imageCount: images.length,
                possibleProductData: jsonLd.filter((item) => {
                    const raw = JSON.stringify(item).toLowerCase();
                    return raw.includes("product") || raw.includes("offer");
                }),
            },
        };
    }

    if (mode === "links") {
        return {
            ...baseData,
            textPreview: text.slice(0, 2500),
            linkSignals: {
                totalLinks: links.length,
                totalImages: images.length,
                totalApiCandidates: apiCandidates.length,
            },
        };
    }

    return baseData;
}

function extractUrlsFromText(value) {
    const matches = String(value || "").match(/https?:\/\/[^\s"'<>]+/gi) || [];

    return [...new Set(matches)]
        .map((url) => url.trim())
        .filter(Boolean)
        .slice(0, 8);
}

function buildSearchLinks(query) {
    const encoded = encodeURIComponent(query);

    return [
        {
            label: "Google Search",
            url: `https://www.google.com/search?q=${encoded}`,
        },
        {
            label: "Bing Search",
            url: `https://www.bing.com/search?q=${encoded}`,
        },
        {
            label: "DuckDuckGo Search",
            url: `https://duckduckgo.com/?q=${encoded}`,
        },
        {
            label: "Reddit Search",
            url: `https://www.reddit.com/search/?q=${encoded}`,
        },
        {
            label: "eBay Search",
            url: `https://www.ebay.com/sch/i.html?_nkw=${encoded}`,
        },
        {
            label: "GitHub Search",
            url: `https://github.com/search?q=${encoded}`,
        },
    ];
}

async function scrapeOneUrl({ rawUrl, query, mode }) {
    const { response, text, truncated, finalUrl } = await fetchLimited(rawUrl);
    const contentType = response.headers.get("content-type") || "";

    const data = extractPageData({
        html: text,
        url: finalUrl,
        query,
        mode,
        status: response.status,
        contentType,
        truncated,
    });

    return {
        ok: true,
        data,
    };
}

async function handleHealth() {
    return json({
        ok: true,
        service: APP_NAME,
        mode: "cloudflare-pages-advanced-worker",
        externalApiKeysRequired: false,
        routes: [
            "GET /api",
            "GET /api/health",
            "GET /api/query-scrape",
            "POST /api/query-scrape",
            "POST /api/scrape",
            "POST /api/batch-scrape",
        ],
        timestamp: new Date().toISOString(),
    });
}

async function handleQueryScrapeGet(url) {
    const query = url.searchParams.get("query") || "";
    const mode = url.searchParams.get("mode") || "research";

    if (!query.trim()) {
        return json({
            ok: true,
            route: "/api/query-scrape",
            method: "GET",
            message:
                "Use POST with JSON body { query, mode, urls } or test with ?query=https://example.com",
            example:
                "/api/query-scrape?query=https%3A%2F%2Fexample.com&mode=research",
        });
    }

    return handleQueryScrapePayload({
        query,
        mode,
        urls: extractUrlsFromText(query),
    });
}

async function handleQueryScrape(request) {
    const body = await readJsonBody(request);

    return handleQueryScrapePayload({
        query: body.query,
        mode: body.mode,
        urls: body.urls,
    });
}

async function handleQueryScrapePayload(payload) {
    const query = String(payload.query || "").trim();
    const mode = String(payload.mode || "research").trim() || "research";

    if (!query) {
        return json({ ok: false, error: "Missing query." }, 400);
    }

    const providedUrls = Array.isArray(payload.urls) ? payload.urls : [];
    const urls = [...providedUrls, ...extractUrlsFromText(query)]
        .map((url) => String(url || "").trim())
        .filter(Boolean);

    const uniqueUrls = [...new Set(urls)].slice(0, 5);

    if (uniqueUrls.length > 0) {
        const results = [];

        for (const rawUrl of uniqueUrls) {
            try {
                results.push(
                    await scrapeOneUrl({
                        rawUrl,
                        query,
                        mode,
                    })
                );
            } catch (error) {
                results.push({
                    ok: false,
                    url: rawUrl,
                    error: error.message || "Scrape failed.",
                });
            }
        }

        return json({
            ok: true,
            mode,
            query,
            count: results.length,
            message: `Scraped ${results.length} URL${
                results.length === 1 ? "" : "s"
            }.`,
            results,
            timestamp: new Date().toISOString(),
        });
    }

    return json({
        ok: true,
        mode,
        query,
        count: 1,
        message:
            "No direct URLs were found in the query. I created safe search links instead.",
        results: [
            {
                ok: true,
                type: "query-plan",
                query,
                mode,
                message:
                    "This no-key version cannot run a real web search from plain text. Open one of the search links, copy a result URL, then paste that URL back into the app.",
                suggestedSources: buildSearchLinks(query),
            },
        ],
        timestamp: new Date().toISOString(),
    });
}

async function handleScrape(request) {
    const body = await readJsonBody(request);

    const url = String(body.url || "").trim();
    const query = String(body.query || "").trim();
    const mode = String(body.mode || "research").trim() || "research";

    const result = await scrapeOneUrl({
        rawUrl: url,
        query,
        mode,
    });

    return json({
        ok: true,
        data: result.data,
        timestamp: new Date().toISOString(),
    });
}

async function handleBatchScrape(request) {
    const body = await readJsonBody(request);

    const urls = Array.isArray(body.urls) ? body.urls : [];
    const query = String(body.query || "").trim();
    const mode = String(body.mode || "research").trim() || "research";

    const limitedUrls = urls
        .map((url) => String(url || "").trim())
        .filter(Boolean)
        .slice(0, 5);

    if (limitedUrls.length === 0) {
        return json({ ok: false, error: "Missing URLs." }, 400);
    }

    const results = [];

    for (const rawUrl of limitedUrls) {
        try {
            results.push(
                await scrapeOneUrl({
                    rawUrl,
                    query,
                    mode,
                })
            );
        } catch (error) {
            results.push({
                ok: false,
                url: rawUrl,
                error: error.message || "Scrape failed.",
            });
        }
    }

    return json({
        ok: true,
        count: results.length,
        results,
        timestamp: new Date().toISOString(),
    });
}

async function serveStaticAsset(request, env) {
    if (!env || !env.ASSETS || typeof env.ASSETS.fetch !== "function") {
        return textResponse("Missing env.ASSETS binding.", 500);
    }

    const response = await env.ASSETS.fetch(request);

    if (response.status !== 404) {
        return response;
    }

    const accept = request.headers.get("Accept") || "";
    const method = request.method.toUpperCase();

    if ((method === "GET" || method === "HEAD") && accept.includes("text/html")) {
        const url = new URL(request.url);
        const fallbackRequest = new Request(`${url.origin}/`, request);
        return env.ASSETS.fetch(fallbackRequest);
    }

    return response;
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const pathname = url.pathname;
        const method = request.method.toUpperCase();

        if (method === "OPTIONS") {
            return new Response(null, {
                status: 204,
                headers: corsHeaders(),
            });
        }

        try {
            if (pathname === "/api" || pathname === "/api/" || pathname === "/api/health") {
                if (method !== "GET") {
                    return json(
                        {
                            ok: false,
                            error: "Method not allowed.",
                            allowedMethods: ["GET"],
                        },
                        405
                    );
                }

                return handleHealth();
            }

            if (pathname === "/api/query-scrape") {
                if (method === "GET") {
                    return handleQueryScrapeGet(url);
                }

                if (method === "POST") {
                    return handleQueryScrape(request);
                }

                return json(
                    {
                        ok: false,
                        error: "Method not allowed.",
                        allowedMethods: ["GET", "POST"],
                    },
                    405
                );
            }

            if (pathname === "/api/scrape") {
                if (method !== "POST") {
                    return json(
                        {
                            ok: false,
                            error: "Method not allowed.",
                            allowedMethods: ["POST"],
                        },
                        405
                    );
                }

                return handleScrape(request);
            }

            if (pathname === "/api/batch-scrape") {
                if (method !== "POST") {
                    return json(
                        {
                            ok: false,
                            error: "Method not allowed.",
                            allowedMethods: ["POST"],
                        },
                        405
                    );
                }

                return handleBatchScrape(request);
            }

            if (pathname.startsWith("/api/")) {
                return json(
                    {
                        ok: false,
                        error: "API route not found.",
                        path: pathname,
                        availableRoutes: [
                            "GET /api/health",
                            "POST /api/query-scrape",
                            "POST /api/scrape",
                            "POST /api/batch-scrape",
                        ],
                    },
                    404
                );
            }

            return serveStaticAsset(request, env);
        } catch (error) {
            if (pathname.startsWith("/api")) {
                return json(
                    {
                        ok: false,
                        error: error.message || "Worker crashed.",
                        path: pathname,
                        method,
                    },
                    500
                );
            }

            return serveStaticAsset(request, env);
        }
    },
};