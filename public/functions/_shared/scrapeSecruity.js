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

export function json(data, status = 200, extraHeaders = {}) {
    return Response.json(data, {
        status,
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Cache-Control": "no-store",
            ...extraHeaders,
        },
    });
}

export function validatePublicUrl(rawUrl) {
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

export function normalizeUrl(rawUrl, baseUrl) {
    try {
        return new URL(rawUrl, baseUrl).toString();
    } catch {
        return null;
    }
}

export async function fetchLimited(url) {
    const controller = new AbortController();

    const timeout = setTimeout(() => {
        controller.abort("Scrape timeout");
    }, DEFAULT_TIMEOUT_MS);

    try {
        const response = await fetch(url, {
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
        const isTextLike = TEXT_CONTENT_TYPES.some((type) =>
            contentType.toLowerCase().includes(type)
        );

        if (!isTextLike) {
            throw new Error(`Unsupported content type: ${contentType || "unknown"}`);
        }

        if (!response.body) {
            const text = await response.text();

            return {
                response,
                text: text.slice(0, DEFAULT_MAX_BYTES),
                truncated: text.length > DEFAULT_MAX_BYTES,
            };
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        let received = 0;
        let text = "";
        let truncated = false;

        while (true) {
            const { done, value } = await reader.read();

            if (done) break;

            received += value.byteLength;

            if (received > DEFAULT_MAX_BYTES) {
                truncated = true;
                break;
            }

            text += decoder.decode(value, {
                stream: true,
            });
        }

        text += decoder.decode();

        return {
            response,
            text,
            truncated,
        };
    } finally {
        clearTimeout(timeout);
    }
}

export function stripTags(html) {
    return String(html || "")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/\s+/g, " ")
        .trim();
}

export function cleanText(value) {
    return String(value || "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
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
        120
    );

    return uniqueBy(links, (item) => item.href).slice(0, 80);
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
        80
    );

    return uniqueBy(images, (item) => item.src).slice(0, 50);
}

function extractHeadings(html) {
    return allMatches(
        html,
        /<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1>/gi,
        (match) => ({
            level: Number(match[1]),
            text: cleanText(match[2]).slice(0, 220),
        }),
        60
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
                preview: script.slice(0, 1000),
            });
        }
    }

    return parsed;
}

function extractPriceCandidates(text) {
    const matches = String(text || "").match(
        /(?:\$|USD\s?)\s?\d{1,5}(?:,\d{3})*(?:\.\d{2})?/gi
    );

    return [...new Set(matches || [])].slice(0, 40);
}

function extractApiCandidates(html, baseUrl) {
    const candidates = [];

    const urlMatches = String(html || "").match(
        /https?:\/\/[^\s"'<>\\]+|\/(?:api|graphql|v\d+|search|products|items|listings|query)[^\s"'<>\\]*/gi
    );

    for (const item of urlMatches || []) {
        const normalized = normalizeUrl(item, baseUrl);

        if (!normalized) continue;

        if (
            /\/api\/|graphql|\/v\d+\/|search|products|items|listings|query/i.test(
                normalized
            )
        ) {
            candidates.push(normalized);
        }
    }

    return [...new Set(candidates)].slice(0, 60);
}

function scoreTextAgainstQuery(text, query) {
    if (!query) return 0;

    const haystack = String(text || "").toLowerCase();
    const words = String(query || "")
        .toLowerCase()
        .split(/\s+/)
        .filter((word) => word.length > 2)
        .slice(0, 20);

    let score = 0;

    for (const word of words) {
        if (haystack.includes(word)) {
            score += 1;
        }
    }

    return score;
}

export function extractPageData({
                                    html,
                                    url,
                                    query = "",
                                    mode = "research",
                                    status,
                                    contentType,
                                    truncated,
                                }) {
    const text = stripTags(html);

    const title =
        firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i) ||
        extractMeta(html, "og:title") ||
        "Untitled";

    const description =
        extractMeta(html, "description") ||
        extractMeta(html, "og:description") ||
        extractMeta(html, "twitter:description");

    const canonical = firstMatch(
        html,
        /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/i
    );

    const headings = extractHeadings(html);
    const links = extractLinks(html, url);
    const images = extractImages(html, url);
    const jsonLd = extractJsonLd(html);
    const apiCandidates = extractApiCandidates(html, url);
    const prices = extractPriceCandidates(`${html}\n${text}`);

    return {
        url,
        finalUrl: url,
        status,
        contentType,
        truncated,
        title,
        description,
        canonical: canonical ? normalizeUrl(canonical, url) : null,
        wordCount: text ? text.split(/\s+/).filter(Boolean).length : 0,
        queryScore: scoreTextAgainstQuery(`${title} ${description} ${text}`, query),
        mode,
        headings,
        links,
        images,
        jsonLd,
        prices,
        apiCandidates,
        textPreview: text.slice(0, 5000),
    };
}