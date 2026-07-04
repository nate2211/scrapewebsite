import {
    extractPageData,
    fetchLimited,
    validatePublicUrl,
} from "./scrapeSecurity.js";

const DEFAULT_USER_AGENT = "ScrapeWebsiteEnterpriseRouter/3.0 (+https://suiteofficelab.com; public-page-research; contact=unusualsuspectsclothing@gmail.com)";

const CDN_HOST_HINTS = [
    "cdn", "static", "assets", "asset", "images", "img", "media", "akamai", "akamaized", "cloudfront",
    "fastly", "edgekey", "edgesuite", "imgix", "shopifycdn", "wp.com", "wordpress", "mercdn", "grailed",
    "next", "vercel", "netlify", "jsdelivr", "unpkg", "gstatic",
];

const STATIC_EXTENSIONS = [
    ".js", ".mjs", ".css", ".map", ".json", ".webmanifest", ".png", ".jpg", ".jpeg", ".webp",
    ".gif", ".svg", ".avif", ".ico", ".mp4", ".webm", ".mov", ".mp3", ".wav", ".woff", ".woff2",
    ".ttf", ".otf", ".eot", ".pdf",
];

const TEXT_ASSET_EXTENSIONS = [".js", ".mjs", ".css", ".json", ".map", ".webmanifest", ".xml", ".txt"];

const OFFICIAL_API_ENDPOINTS = {
    wikipedia: "https://en.wikipedia.org/w/rest.php/v1/search/page",
    wikidata: "https://www.wikidata.org/w/api.php?action=wbsearchentities",
    githubRepositories: "https://api.github.com/search/repositories",
    npmSearch: "https://registry.npmjs.org/-/v1/search",
    nasaApod: "https://api.nasa.gov/planetary/apod",
    nasaImages: "https://images-api.nasa.gov/search",
    arxivQuery: "https://export.arxiv.org/api/query",
};

const LOW_VALUE_PATH_HINTS = [
    "/login", "/signin", "/sign-in", "/signup", "/register", "/cart", "/checkout", "/account", "/privacy",
    "/terms", "/help", "/contact", "/cookie", "/cookies", "/logout", "/auth", "/oauth", "#",
];

const HIGH_VALUE_PATH_HINTS = [
    "/item", "/items", "/product", "/products", "/listing", "/listings", "/shop", "/search",
    "/news", "/article", "/articles", "/story", "/stories", "/blog", "/post", "/wiki", "/docs", "/api",
];

function cleanText(value, max = 500) {
    return String(value || "")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&#x27;/gi, "'")
        .replace(/&quot;/gi, '"')
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max);
}

function hostnameFromUrl(url) {
    try {
        return new URL(url).hostname;
    } catch {
        return "";
    }
}

function originFromUrl(url) {
    try {
        return new URL(url).origin;
    } catch {
        return "";
    }
}

function encodeQuery(query) {
    return encodeURIComponent(String(query || "").trim());
}

function stripHash(url) {
    try {
        const parsed = new URL(url);
        parsed.hash = "";
        return parsed.toString();
    } catch {
        return url;
    }
}

function normalizeMaybeUrl(rawUrl, baseUrl) {
    const value = String(rawUrl || "").trim();

    if (!value || value.startsWith("data:") || value.startsWith("blob:") || value.startsWith("mailto:") || value.startsWith("tel:") || value.startsWith("javascript:")) {
        return "";
    }

    try {
        return stripHash(new URL(value, baseUrl).toString());
    } catch {
        return "";
    }
}

function uniqueBy(items, keyFn) {
    const seen = new Set();
    const out = [];

    for (const item of items) {
        const key = keyFn(item);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(item);
    }

    return out;
}

function isLikelyStaticAsset(url) {
    const lower = String(url || "").toLowerCase();
    return STATIC_EXTENSIONS.some((ext) => lower.includes(ext)) || lower.includes("/_next/static/") || lower.includes("/static/") || lower.includes("/assets/");
}

function isLikelyTextAsset(url) {
    const lower = String(url || "").toLowerCase().split("?")[0];
    return TEXT_ASSET_EXTENSIONS.some((ext) => lower.endsWith(ext)) || lower.includes("/_next/static/chunks/");
}

function isLikelyCdnUrl(url) {
    const host = hostnameFromUrl(url).toLowerCase();
    const path = (() => {
        try {
            return new URL(url).pathname.toLowerCase();
        } catch {
            return "";
        }
    })();

    return CDN_HOST_HINTS.some((hint) => host.includes(hint)) || path.includes("/_next/") || path.includes("/cdn-cgi/") || isLikelyStaticAsset(url);
}

function isProbablyApiUrl(url) {
    const lower = String(url || "").toLowerCase();
    return lower.includes("/api/") || lower.includes("graphql") || lower.includes(".json") || lower.includes("/v1/") || lower.includes("/v2/") || lower.includes("/search?");
}

function safeTokens(value) {
    return String(value || "")
        .toLowerCase()
        .split(/[^a-z0-9一-龥ぁ-んァ-ンー]+/i)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2 && !["the", "and", "for", "with", "from", "into"].includes(token));
}

function extractUrlsFromHtml(html, baseUrl) {
    const found = [];
    const text = String(html || "");

    const attrRegex = /\b(?:href|src|action|poster|data-src|data-href|data-url|content)=(["'])(.*?)\1/gi;
    let match;
    while ((match = attrRegex.exec(text))) {
        const url = normalizeMaybeUrl(match[2], baseUrl);
        if (url) found.push(url);
    }

    const srcsetRegex = /\b(?:srcset|data-srcset)=(["'])(.*?)\1/gi;
    while ((match = srcsetRegex.exec(text))) {
        const parts = String(match[2] || "").split(",");
        for (const part of parts) {
            const candidate = part.trim().split(/\s+/)[0];
            const url = normalizeMaybeUrl(candidate, baseUrl);
            if (url) found.push(url);
        }
    }

    const cssUrlRegex = /url\((['"]?)(.*?)\1\)/gi;
    while ((match = cssUrlRegex.exec(text))) {
        const url = normalizeMaybeUrl(match[2], baseUrl);
        if (url) found.push(url);
    }

    const absoluteRegex = /https?:\/\/[^\s"'<>\\)]+/gi;
    const absoluteMatches = text.match(absoluteRegex) || [];
    for (const raw of absoluteMatches) {
        const url = normalizeMaybeUrl(raw.replace(/[),.;]+$/, ""), baseUrl);
        if (url) found.push(url);
    }

    const escapedAbsoluteRegex = /https?:\\\/\\\/[^"'<>\s)]+/gi;
    const escapedMatches = text.match(escapedAbsoluteRegex) || [];
    for (const raw of escapedMatches) {
        const decoded = raw.replace(/\\\//g, "/").replace(/\\u002F/gi, "/");
        const url = normalizeMaybeUrl(decoded.replace(/[),.;]+$/, ""), baseUrl);
        if (url) found.push(url);
    }

    const jsonUrlRegex = /["'](?:url|href|src|canonicalUrl|contentUrl|image|thumbnail|apiUrl|endpoint)["']\s*:\s*["']([^"']+)["']/gi;
    while ((match = jsonUrlRegex.exec(text))) {
        const decoded = String(match[1] || "").replace(/\\\//g, "/").replace(/\\u002F/gi, "/");
        const url = normalizeMaybeUrl(decoded, baseUrl);
        if (url) found.push(url);
    }

    return [...new Set(found)].slice(0, 900);
}

function extractApiRouteStrings(text, baseUrl) {
    const found = [];
    const source = String(text || "");
    const routeRegex = /["'`](\/?(?:api|graphql|v1|v2|v3|search|products|items|listings|catalog|browse|inventory|recommendations)[^"'`\s<>]{0,220})["'`]/gi;
    let match;

    while ((match = routeRegex.exec(source))) {
        const raw = match[1];
        const url = normalizeMaybeUrl(raw, baseUrl);
        if (url && isProbablyApiUrl(url)) found.push(url);
    }

    return [...new Set(found)].slice(0, 120);
}

function scoreBranchUrl(url, { baseUrl, query, depth, includeExternalBranches }) {
    let score = 0;
    const lower = String(url || "").toLowerCase();
    const baseHost = hostnameFromUrl(baseUrl);
    const host = hostnameFromUrl(url);

    if (!url || !host) return -999;
    if (isLikelyStaticAsset(url)) return -250;
    if (!includeExternalBranches && host !== baseHost) return -120;
    if (host === baseHost) score += 35;
    if (host !== baseHost && includeExternalBranches) score += 10;

    for (const hint of LOW_VALUE_PATH_HINTS) {
        if (lower.includes(hint)) score -= 40;
    }

    for (const hint of HIGH_VALUE_PATH_HINTS) {
        if (lower.includes(hint)) score += 18;
    }

    for (const token of safeTokens(query)) {
        if (lower.includes(encodeURIComponent(token)) || lower.includes(token)) score += 10;
    }

    if (isProbablyApiUrl(url)) score += 14;
    if (depth === 0) score += 8;
    if (url.length > 240) score -= 8;

    return score;
}

function discoverPageSignals(html, baseUrl, query, options = {}) {
    const urls = extractUrlsFromHtml(html, baseUrl);
    const baseHost = hostnameFromUrl(baseUrl);

    const allLinks = urls.map((url) => ({
        url,
        hostname: hostnameFromUrl(url),
        sameHost: hostnameFromUrl(url) === baseHost,
        staticAsset: isLikelyStaticAsset(url),
        cdn: isLikelyCdnUrl(url),
        apiLike: isProbablyApiUrl(url),
    }));

    const cdnLinks = allLinks
        .filter((item) => item.cdn || item.staticAsset)
        .slice(0, options.cdnLimit || 60);

    const apiHints = allLinks
        .filter((item) => item.apiLike)
        .slice(0, options.apiLimit || 40);

    const branchLinks = allLinks
        .filter((item) => !item.staticAsset)
        .map((item) => ({
            ...item,
            branchScore: scoreBranchUrl(item.url, {
                baseUrl,
                query,
                depth: options.depth || 0,
                includeExternalBranches: Boolean(options.includeExternalBranches),
            }),
        }))
        .filter((item) => item.branchScore > 0)
        .sort((a, b) => b.branchScore - a.branchScore)
        .slice(0, options.branchLimit || 8);

    return {
        allLinks: allLinks.slice(0, 160),
        cdnLinks,
        apiHints,
        branchLinks,
    };
}

async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: {
            Accept: "application/json",
            "User-Agent": DEFAULT_USER_AGENT,
            ...(options.headers || {}),
        },
    });

    const text = await response.text();

    let data;
    try {
        data = JSON.parse(text);
    } catch {
        throw new Error(`Expected JSON but got ${response.status} from ${hostnameFromUrl(url)}.`);
    }

    if (!response.ok) {
        throw new Error(data?.message || data?.error || `Request failed: ${response.status}`);
    }

    return data;
}

async function fetchText(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: {
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "User-Agent": DEFAULT_USER_AGENT,
            ...(options.headers || {}),
        },
    });

    const text = await response.text();

    if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
    }

    return { response, text };
}

function parseRssItems(xml, sourceId, sourceLabel, limit = 10) {
    const itemMatches = String(xml || "").match(/<item[\s\S]*?<\/item>/gi) || [];

    return itemMatches.slice(0, limit).map((item, index) => {
        const title = item.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i)?.[1]
            || item.match(/<title>([\s\S]*?)<\/title>/i)?.[1]
            || "Untitled";

        const link = item.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || "";
        const description = item.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/i)?.[1]
            || item.match(/<description>([\s\S]*?)<\/description>/i)?.[1]
            || "";
        const pubDate = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] || null;

        return {
            ok: true,
            type: "source-result",
            source: sourceId,
            sourceLabel,
            rank: index + 1,
            title: cleanText(title, 180),
            url: cleanText(link, 500),
            hostname: hostnameFromUrl(link),
            description: cleanText(description, 300),
            publishedAt: pubDate,
        };
    });
}

async function probeTextAsset({ assetUrl, source, sourceLabel, query, mode, parentUrl }) {
    try {
        if (!isLikelyTextAsset(assetUrl)) return null;

        const parsed = validatePublicUrl(assetUrl);
        const { response, text, truncated } = await fetchLimited(parsed.toString());
        const contentType = response.headers.get("content-type") || "";
        const finalUrl = response.url || parsed.toString();
        const urls = extractUrlsFromHtml(text, finalUrl);
        const apiRoutes = extractApiRouteStrings(text, finalUrl);

        const discovered = urls
            .map((url) => ({
                url,
                hostname: hostnameFromUrl(url),
                staticAsset: isLikelyStaticAsset(url),
                cdn: isLikelyCdnUrl(url),
                apiLike: isProbablyApiUrl(url),
            }))
            .filter((item) => item.apiLike || item.cdn || item.staticAsset)
            .slice(0, 120);

        const apiHints = [...new Set([
            ...apiRoutes,
            ...discovered.filter((item) => item.apiLike).map((item) => item.url),
        ])].slice(0, 80);

        return {
            ok: true,
            type: "asset-probe-result",
            source,
            sourceLabel,
            title: `Static asset probe: ${hostnameFromUrl(finalUrl)}`,
            url: finalUrl,
            hostname: hostnameFromUrl(finalUrl),
            parentUrl,
            depth: 0,
            contentType,
            truncated: Boolean(truncated),
            description: `${apiHints.length} API-like endpoint(s), ${discovered.length} useful link signal(s) found inside a CDN/static asset.`,
            discovery: {
                linksFound: discovered.length,
                branchCandidates: 0,
                cdnLinksFound: discovered.filter((item) => item.cdn || item.staticAsset).length,
                apiHintsFound: apiHints.length,
                branchLinks: [],
                cdnLinks: discovered.filter((item) => item.cdn || item.staticAsset),
                apiHints: apiHints.map((url) => ({
                    url,
                    hostname: hostnameFromUrl(url),
                    sameHost: hostnameFromUrl(url) === hostnameFromUrl(finalUrl),
                    apiLike: true,
                })),
            },
            data: {
                url: finalUrl,
                title: `Static asset probe: ${hostnameFromUrl(finalUrl)}`,
                description: "Extracted links from JavaScript/CSS/JSON asset text.",
                wordCount: cleanText(text, 5000).split(/\s+/).filter(Boolean).length,
                links: discovered.map((item) => item.url),
                cdnLinks: discovered.filter((item) => item.cdn || item.staticAsset).map((item) => item.url),
                apiHints,
                preview: cleanText(text, 900),
            },
        };
    } catch (error) {
        return {
            ok: false,
            type: "asset-probe-error",
            source,
            sourceLabel,
            url: assetUrl,
            hostname: hostnameFromUrl(assetUrl),
            parentUrl,
            error: error.message || "Static asset probe failed.",
        };
    }
}

function buildScrapeResult({
    source,
    sourceLabel,
    url,
    query,
    mode,
    parentUrl = null,
    depth = 0,
    response,
    text,
    truncated,
    crawlOptions = {},
}) {
    const contentType = response.headers.get("content-type") || "";
    const finalUrl = response.url || url;
    const data = extractPageData({
        html: text,
        url: finalUrl,
        query,
        mode,
        status: response.status,
        contentType,
        truncated,
    });

    const discovery = discoverPageSignals(text, finalUrl, query, {
        depth,
        branchLimit: crawlOptions.branchLimit || 4,
        includeExternalBranches: crawlOptions.includeExternalBranches,
        cdnLimit: crawlOptions.includeCdn === false ? 0 : 80,
    });

    return {
        ok: true,
        type: depth === 0 ? "direct-site-result" : "branched-page-result",
        source,
        sourceLabel,
        title: data.title || sourceLabel || "Untitled page",
        url: data.url || finalUrl,
        hostname: hostnameFromUrl(data.url || finalUrl),
        description: data.description || data.preview || "",
        parentUrl,
        depth,
        discovery: {
            linksFound: discovery.allLinks.length,
            branchCandidates: discovery.branchLinks.length,
            cdnLinksFound: discovery.cdnLinks.length,
            apiHintsFound: discovery.apiHints.length,
            branchLinks: discovery.branchLinks,
            cdnLinks: discovery.cdnLinks,
            apiHints: discovery.apiHints,
        },
        data: {
            ...data,
            cdnLinks: discovery.cdnLinks.map((item) => item.url),
            apiHints: [
                ...(Array.isArray(data.apiHints) ? data.apiHints : []),
                ...discovery.apiHints.map((item) => item.url),
            ].slice(0, 80),
            branchLinks: discovery.branchLinks.map((item) => item.url),
        },
    };
}

export async function crawlBranchFromSeed({
    sourceId = "direct-url",
    sourceLabel = "Direct URL",
    seedUrl,
    query,
    mode,
    crawlOptions = {},
}) {
    const maxDepth = Math.min(Math.max(Number(crawlOptions.crawlDepth ?? (mode === "quick" ? 0 : 1)), 0), 2);
    const branchLimit = Math.min(Math.max(Number(crawlOptions.branchLimit ?? 4), 0), 8);
    const queue = [{ url: seedUrl, parentUrl: null, depth: 0 }];
    const visited = new Set();
    const results = [];

    while (queue.length > 0 && results.length < 1 + branchLimit * Math.max(maxDepth, 1)) {
        const next = queue.shift();
        const normalized = stripHash(next.url);
        if (!normalized || visited.has(normalized)) continue;
        visited.add(normalized);

        try {
            const parsed = validatePublicUrl(normalized);
            const { response, text, truncated } = await fetchLimited(parsed.toString());

            const result = buildScrapeResult({
                source: sourceId,
                sourceLabel,
                url: parsed.toString(),
                query,
                mode,
                parentUrl: next.parentUrl,
                depth: next.depth,
                response,
                text,
                truncated,
                crawlOptions: { ...crawlOptions, branchLimit },
            });

            results.push(result);

            const assetProbeLimit = Math.min(Math.max(Number(crawlOptions.assetProbeLimit ?? 0), 0), 6);
            if (next.depth === 0 && assetProbeLimit > 0) {
                const textAssets = result.discovery.cdnLinks
                    .map((item) => item.url)
                    .filter(isLikelyTextAsset)
                    .slice(0, assetProbeLimit);

                for (const assetUrl of textAssets) {
                    const assetResult = await probeTextAsset({
                        assetUrl,
                        source: sourceId,
                        sourceLabel,
                        query,
                        mode,
                        parentUrl: result.url,
                    });

                    if (assetResult) results.push(assetResult);
                }
            }

            if (next.depth < maxDepth && branchLimit > 0) {
                const children = result.discovery.branchLinks
                    .slice(0, branchLimit)
                    .map((item) => ({
                        url: item.url,
                        parentUrl: result.url,
                        depth: next.depth + 1,
                    }));

                queue.push(...children);
            }
        } catch (error) {
            results.push({
                ok: false,
                type: next.depth === 0 ? "source-link" : "branch-error",
                source: sourceId,
                sourceLabel,
                url: normalized,
                parentUrl: next.parentUrl,
                depth: next.depth,
                hostname: hostnameFromUrl(normalized),
                error: error.message || "Scrape failed.",
            });
        }
    }

    return uniqueBy(results, (item) => `${item.type}:${item.url || item.title}:${item.depth || 0}`);
}

async function runEbay(source, query, env) {
    if (!env.EBAY_BEARER_TOKEN) {
        return [{
            ok: false,
            type: "source-error",
            source: source.id,
            sourceLabel: source.label,
            error: "Missing EBAY_BEARER_TOKEN.",
        }];
    }

    const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeQuery(query)}&limit=10`;
    const data = await fetchJson(url, {
        headers: {
            Authorization: `Bearer ${env.EBAY_BEARER_TOKEN}`,
            "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
        },
    });

    return (data.itemSummaries || []).map((item, index) => ({
        ok: true,
        type: "product-result",
        source: source.id,
        sourceLabel: source.label,
        rank: index + 1,
        title: item.title || "Untitled",
        url: item.itemWebUrl,
        hostname: "ebay.com",
        price: item.price ? `${item.price.value} ${item.price.currency}` : null,
        image: item.image?.imageUrl || null,
        condition: item.condition || null,
        seller: item.seller?.username || null,
    }));
}

async function runGitHub(source, query) {
    const url = `${OFFICIAL_API_ENDPOINTS.githubRepositories}?q=${encodeQuery(query)}&sort=stars&order=desc&per_page=10`;
    const data = await fetchJson(url, {
        headers: { Accept: "application/vnd.github+json" },
    });

    return (data.items || []).map((repo, index) => ({
        ok: true,
        type: "source-result",
        source: source.id,
        sourceLabel: source.label,
        rank: index + 1,
        title: repo.full_name,
        url: repo.html_url,
        hostname: "github.com",
        description: cleanText(repo.description || "", 260),
        stars: repo.stargazers_count || 0,
        language: repo.language || "",
    }));
}

async function runNpm(source, query) {
    const url = `${OFFICIAL_API_ENDPOINTS.npmSearch}?text=${encodeQuery(query)}&size=10`;
    const data = await fetchJson(url);

    return (data.objects || []).map((item, index) => {
        const pkg = item.package || {};
        return {
            ok: true,
            type: "source-result",
            source: source.id,
            sourceLabel: source.label,
            rank: index + 1,
            title: pkg.name || "npm package",
            url: pkg.links?.npm || `https://www.npmjs.com/package/${encodeURIComponent(pkg.name || "")}`,
            hostname: "npmjs.com",
            description: cleanText(pkg.description || "", 300),
            version: pkg.version || "",
            score: item.score?.final || null,
        };
    });
}

async function runHackerNews(source, query) {
    const url = `https://hn.algolia.com/api/v1/search?query=${encodeQuery(query)}&tags=story&hitsPerPage=10`;
    const data = await fetchJson(url);

    return (data.hits || []).map((item, index) => ({
        ok: true,
        type: "source-result",
        source: source.id,
        sourceLabel: source.label,
        rank: index + 1,
        title: item.title || item.story_title || "Untitled",
        url: item.url || `https://news.ycombinator.com/item?id=${item.objectID}`,
        hostname: hostnameFromUrl(item.url || "https://news.ycombinator.com"),
        description: "",
        points: item.points || 0,
        comments: item.num_comments || 0,
        createdAt: item.created_at || null,
    }));
}

async function runReddit(source, query) {
    const url = `https://www.reddit.com/search.json?q=${encodeQuery(query)}&limit=10&sort=relevance&type=link`;
    const data = await fetchJson(url);
    const posts = data?.data?.children || [];

    return posts.map((post, index) => {
        const item = post.data || {};
        const finalUrl = item.permalink ? `https://www.reddit.com${item.permalink}` : item.url;

        return {
            ok: true,
            type: "source-result",
            source: source.id,
            sourceLabel: source.label,
            rank: index + 1,
            title: cleanText(item.title || "Untitled", 180),
            url: finalUrl,
            hostname: hostnameFromUrl(finalUrl),
            description: cleanText(item.selftext || item.url || "", 260),
            subreddit: item.subreddit || "",
            score: item.score || 0,
            comments: item.num_comments || 0,
            createdUtc: item.created_utc || null,
        };
    });
}

async function runWikipedia(source, query) {
    const url = `${OFFICIAL_API_ENDPOINTS.wikipedia}?q=${encodeQuery(query)}&limit=10`;
    const data = await fetchJson(url, {
        headers: { "Api-User-Agent": DEFAULT_USER_AGENT },
    });

    return (data.pages || []).map((page, index) => ({
        ok: true,
        type: "source-result",
        source: source.id,
        sourceLabel: source.label,
        rank: index + 1,
        title: cleanText(page.title || "Wikipedia result", 180),
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.key || page.title || "")}`,
        hostname: "wikipedia.org",
        description: cleanText(page.excerpt || page.description || "", 350),
        thumbnail: page.thumbnail?.url || null,
    }));
}

async function runWikidata(source, query) {
    const url = `${OFFICIAL_API_ENDPOINTS.wikidata}&language=en&format=json&limit=10&search=${encodeQuery(query)}`;
    const data = await fetchJson(url, {
        headers: { "Api-User-Agent": DEFAULT_USER_AGENT },
    });

    return (data.search || []).map((item, index) => ({
        ok: true,
        type: "source-result",
        source: source.id,
        sourceLabel: source.label,
        rank: index + 1,
        title: item.label || item.id,
        url: item.concepturi || `https://www.wikidata.org/wiki/${item.id}`,
        hostname: "wikidata.org",
        description: cleanText(item.description || "", 300),
        entityId: item.id,
    }));
}

async function runNasaOpen(source, query, env) {
    const key = env.NASA_API_KEY || "DEMO_KEY";
    const q = String(query || "").toLowerCase();

    if (q.includes("apod") || q.includes("astronomy picture")) {
        const data = await fetchJson(`${OFFICIAL_API_ENDPOINTS.nasaApod}?api_key=${encodeURIComponent(key)}`);
        return [{
            ok: true,
            type: "source-result",
            source: source.id,
            sourceLabel: source.label,
            rank: 1,
            title: data.title || "NASA APOD",
            url: data.url || data.hdurl || "https://api.nasa.gov/",
            hostname: hostnameFromUrl(data.url || "https://api.nasa.gov/"),
            description: cleanText(data.explanation || "", 500),
            mediaType: data.media_type || null,
            date: data.date || null,
        }];
    }

    return runNasaImages({ ...source, id: "nasa-images", label: "NASA Image and Video Library" }, query);
}

async function runNasaImages(source, query) {
    const url = `${OFFICIAL_API_ENDPOINTS.nasaImages}?q=${encodeQuery(query)}&media_type=image,video`;
    const data = await fetchJson(url);
    const items = data?.collection?.items || [];

    return items.slice(0, 10).map((item, index) => {
        const meta = item.data?.[0] || {};
        const link = item.links?.[0]?.href || "";

        return {
            ok: true,
            type: "source-result",
            source: source.id,
            sourceLabel: source.label,
            rank: index + 1,
            title: cleanText(meta.title || "NASA result", 180),
            url: link,
            hostname: hostnameFromUrl(link),
            description: cleanText(meta.description || "", 350),
            date: meta.date_created || null,
            image: link || null,
        };
    });
}

async function runArxiv(source, query) {
    const url = `${OFFICIAL_API_ENDPOINTS.arxivQuery}?search_query=all:${encodeQuery(query)}&start=0&max_results=10`;
    const { text } = await fetchText(url, {
        headers: { Accept: "application/atom+xml,application/xml,text/xml" },
    });

    const entries = text.match(/<entry[\s\S]*?<\/entry>/gi) || [];

    return entries.slice(0, 10).map((entry, index) => {
        const title = entry.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "Untitled";
        const summary = entry.match(/<summary>([\s\S]*?)<\/summary>/i)?.[1] || "";
        const id = entry.match(/<id>([\s\S]*?)<\/id>/i)?.[1] || "";
        const published = entry.match(/<published>([\s\S]*?)<\/published>/i)?.[1] || null;

        return {
            ok: true,
            type: "source-result",
            source: source.id,
            sourceLabel: source.label,
            rank: index + 1,
            title: cleanText(title, 220),
            url: cleanText(id, 500),
            hostname: "arxiv.org",
            description: cleanText(summary, 350),
            publishedAt: published,
        };
    });
}

async function runRssOrDirect(source, query, mode, crawlOptions) {
    if (source.rss) {
        try {
            const { text } = await fetchText(source.rss, {
                headers: { Accept: "application/rss+xml,application/xml,text/xml" },
            });

            const rssItems = parseRssItems(text, source.id, source.label, 10);
            const qTokens = safeTokens(query);
            const filtered = rssItems.filter((item) => {
                const haystack = `${item.title} ${item.description}`.toLowerCase();
                return qTokens.some((word) => haystack.includes(word));
            });

            if (filtered.length > 0) return filtered;
            return rssItems;
        } catch {
            // Fall back to direct page crawl.
        }
    }

    return runDirectSite(source, query, mode, crawlOptions);
}

async function runDirectSite(source, query, mode, crawlOptions = {}) {
    if (!source.buildUrl) return [];

    const url = source.buildUrl(query);

    try {
        return await crawlBranchFromSeed({
            sourceId: source.id,
            sourceLabel: source.label,
            seedUrl: url,
            query,
            mode,
            crawlOptions,
        });
    } catch (error) {
        return [{
            ok: false,
            type: "source-link",
            source: source.id,
            sourceLabel: source.label,
            url,
            hostname: hostnameFromUrl(url),
            error: "This source may block server-side requests or require browser/login access. Opening the official search URL is still available.",
            details: error.message || null,
        }];
    }
}

export async function runSourceAdapter({ source, query, mode, env = {}, crawlOptions = {} }) {
    try {
        if (source.id === "ebay") return await runEbay(source, query, env);
        if (source.id === "github") return await runGitHub(source, query);
        if (source.id === "npm") return await runNpm(source, query);
        if (source.id === "hackernews") return await runHackerNews(source, query);
        if (source.id === "reddit") return await runReddit(source, query);
        if (source.id === "wikipedia") return await runWikipedia(source, query);
        if (source.id === "wikidata") return await runWikidata(source, query);
        if (source.id === "nasa-open") return await runNasaOpen(source, query, env);
        if (source.id === "nasa-images") return await runNasaImages(source, query);
        if (source.id === "arxiv") return await runArxiv(source, query);

        if (source.type === "rss-or-direct") {
            return await runRssOrDirect(source, query, mode, crawlOptions);
        }

        if (source.type === "direct-site") {
            return await runDirectSite(source, query, mode, crawlOptions);
        }

        return [];
    } catch (error) {
        return [{
            ok: false,
            type: "source-error",
            source: source.id,
            sourceLabel: source.label,
            error: error.message || `Failed to query ${source.label}.`,
        }];
    }
}
