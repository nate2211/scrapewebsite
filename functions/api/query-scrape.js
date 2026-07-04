import { json, validatePublicUrl } from "../_shared/scrapeSecurity.js";
import { pickSourcesForQuery } from "../_shared/sourceRouter.js";
import { crawlBranchFromSeed, runSourceAdapter } from "../_shared/sourceAdapters.js";

const MAX_DIRECT_URLS = 5;
const MAX_TOTAL_RESULTS = 80;
const MAX_SOURCES = 16;
const MAX_CRAWL_DEPTH = 2;
const MAX_BRANCH_LIMIT = 8;
const MAX_ASSET_PROBE_LIMIT = 6;

function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(Math.max(number, min), max);
}

function boolValue(value, fallback = false) {
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
    return fallback;
}

function requestId() {
    return `qs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function extractUrlsFromText(value) {
    const matches = String(value || "").match(/https?:\/\/[^\s"'<>]+/gi) || [];

    return [...new Set(matches)]
        .map((url) => url.trim().replace(/[),.;]+$/, ""))
        .filter(Boolean)
        .slice(0, 12);
}

function hostnameFromUrl(url) {
    try {
        return new URL(url).hostname;
    } catch {
        return "";
    }
}

function normalizeUrlForDedupe(rawUrl) {
    try {
        const parsed = validatePublicUrl(rawUrl);
        parsed.hash = "";
        return parsed.toString();
    } catch {
        return "";
    }
}

function buildDirectUrlList({ query, providedUrls }) {
    const rawUrls = [
        ...(Array.isArray(providedUrls) ? providedUrls : []),
        ...extractUrlsFromText(query),
    ];

    return [...new Set(rawUrls.map(normalizeUrlForDedupe).filter(Boolean))].slice(0, MAX_DIRECT_URLS);
}

function dedupeResults(results) {
    const seen = new Set();
    const out = [];

    for (const result of results) {
        const key = [
            result.source || "unknown",
            result.type || "result",
            result.url || result.data?.url || result.title || "untitled",
            result.depth ?? "",
        ].join("|");

        if (seen.has(key)) continue;
        seen.add(key);
        out.push(result);
    }

    return out;
}

function summarizeResults(results) {
    const summary = {
        ok: 0,
        errors: 0,
        directPages: 0,
        branchedPages: 0,
        sourceResults: 0,
        productResults: 0,
        cdnLinks: 0,
        apiHints: 0,
        bySource: {},
    };

    const cdnSet = new Set();
    const apiSet = new Set();

    for (const result of results) {
        const source = result.source || "unknown";
        summary.bySource[source] = (summary.bySource[source] || 0) + 1;

        if (result.ok) summary.ok += 1;
        else summary.errors += 1;

        if (result.type === "direct-site-result" || result.type === "scrape") summary.directPages += 1;
        if (result.type === "branched-page-result") summary.branchedPages += 1;
        if (result.type === "source-result") summary.sourceResults += 1;
        if (result.type === "product-result") summary.productResults += 1;

        const cdnLinks = result.discovery?.cdnLinks || result.data?.cdnLinks || [];
        const apiHints = result.discovery?.apiHints || result.data?.apiHints || [];

        for (const item of cdnLinks) cdnSet.add(typeof item === "string" ? item : item.url);
        for (const item of apiHints) apiSet.add(typeof item === "string" ? item : item.url);
    }

    summary.cdnLinks = [...cdnSet].filter(Boolean).length;
    summary.apiHints = [...apiSet].filter(Boolean).length;

    return summary;
}

function collectDiscoveredLinks(results) {
    const cdn = new Map();
    const api = new Map();
    const branches = new Map();

    for (const result of results) {
        const source = result.source || "unknown";
        const cdnLinks = result.discovery?.cdnLinks || [];
        const apiHints = result.discovery?.apiHints || [];
        const branchLinks = result.discovery?.branchLinks || [];

        for (const item of cdnLinks) {
            if (item?.url && !cdn.has(item.url)) cdn.set(item.url, { ...item, source });
        }

        for (const item of apiHints) {
            if (item?.url && !api.has(item.url)) api.set(item.url, { ...item, source });
        }

        for (const item of branchLinks) {
            if (item?.url && !branches.has(item.url)) branches.set(item.url, { ...item, source });
        }
    }

    return {
        cdn: [...cdn.values()].slice(0, 120),
        api: [...api.values()].slice(0, 120),
        branches: [...branches.values()].slice(0, 120),
    };
}

async function runPool(items, limit, worker) {
    const results = [];
    let index = 0;

    async function runNext() {
        while (index < items.length) {
            const currentIndex = index;
            index += 1;
            results[currentIndex] = await worker(items[currentIndex], currentIndex);
        }
    }

    const workers = Array.from({ length: Math.min(limit, items.length) }, runNext);
    await Promise.all(workers);

    return results;
}

async function scrapeDirectUrls({ urls, query, mode, crawlOptions }) {
    const nested = await runPool(urls, 2, async (rawUrl) => {
        try {
            return await crawlBranchFromSeed({
                sourceId: "direct-url",
                sourceLabel: "Direct URL",
                seedUrl: rawUrl,
                query,
                mode,
                crawlOptions,
            });
        } catch (error) {
            return [{
                ok: false,
                type: "scrape-error",
                source: "direct-url",
                sourceLabel: "Direct URL",
                url: rawUrl,
                hostname: hostnameFromUrl(rawUrl),
                error: error.message || "Scrape failed.",
            }];
        }
    });

    return nested.flat();
}

export async function onRequestOptions() {
    return json({ ok: true });
}

export async function onRequestGet() {
    return json({
        ok: true,
        route: "/api/query-scrape",
        method: "POST required",
        smartSourceRouting: true,
        enterpriseCrawler: true,
        safeLimits: {
            maxDirectUrls: MAX_DIRECT_URLS,
            maxSources: MAX_SOURCES,
            maxCrawlDepth: MAX_CRAWL_DEPTH,
            maxBranchLimit: MAX_BRANCH_LIMIT,
        },
        exampleBody: {
            query: "raf simons hoodie resale",
            mode: "product",
            urls: [],
            sources: [],
            maxSources: 8,
            crawlDepth: 1,
            branchLimit: 4,
            includeCdn: true,
            includeExternalBranches: false,
            assetProbeLimit: 3,
        },
    });
}

export async function onRequestPost(context) {
    const startedAt = Date.now();
    const id = requestId();

    try {
        const body = await context.request.json();

        const query = String(body.query || "").trim();
        const mode = String(body.mode || "research").trim();
        const maxSources = clampNumber(body.maxSources, 1, MAX_SOURCES, 8);
        const crawlDepth = clampNumber(body.crawlDepth, 0, MAX_CRAWL_DEPTH, mode === "quick" ? 0 : 1);
        const branchLimit = clampNumber(body.branchLimit, 0, MAX_BRANCH_LIMIT, mode === "quick" ? 1 : 4);
        const includeCdn = boolValue(body.includeCdn, true);
        const includeExternalBranches = boolValue(body.includeExternalBranches, false);
        const assetProbeLimit = clampNumber(body.assetProbeLimit, 0, MAX_ASSET_PROBE_LIMIT, mode === "links" ? 4 : 2);

        if (!query) {
            return json({ ok: false, requestId: id, error: "Missing query." }, 400);
        }

        const providedUrls = Array.isArray(body.urls) ? body.urls : [];
        const requestedSources = Array.isArray(body.sources) ? body.sources : [];
        const directUrls = buildDirectUrlList({ query, providedUrls });

        const picked = pickSourcesForQuery({
            query,
            mode,
            requestedSources,
            maxSources,
        });

        const crawlOptions = {
            crawlDepth,
            branchLimit,
            includeCdn,
            includeExternalBranches,
            assetProbeLimit,
        };

        const warnings = [];
        if (includeExternalBranches) {
            warnings.push("External branching is enabled. The crawler still validates public URLs and applies strict depth/branch limits.");
        }
        if (crawlDepth === 0) {
            warnings.push("Crawl depth is 0, so only seed pages/API results are returned.");
        }

        if (assetProbeLimit > 0) {
            warnings.push(`Static asset probing is enabled for up to ${assetProbeLimit} JS/CSS/JSON asset(s) per seed page.`);
        }

        const results = [];

        if (directUrls.length > 0) {
            results.push(...await scrapeDirectUrls({
                urls: directUrls,
                query,
                mode,
                crawlOptions,
            }));
        }

        const sourceResultGroups = await runPool(picked.sources, 3, async (source) => {
            return runSourceAdapter({
                source,
                query,
                mode,
                env: context.env,
                crawlOptions,
            });
        });

        for (const group of sourceResultGroups) {
            results.push(...(Array.isArray(group) ? group : []));
        }

        const finalResults = dedupeResults(results).slice(0, MAX_TOTAL_RESULTS);
        const metrics = summarizeResults(finalResults);
        const discovered = collectDiscoveredLinks(finalResults);
        const elapsedMs = Date.now() - startedAt;

        return json({
            ok: true,
            requestId: id,
            mode,
            query,
            smartSourceRouting: true,
            enterpriseCrawler: true,
            intents: picked.intents,
            routingReason: picked.reason,
            selectedSources: picked.sources.map((source) => ({
                id: source.id,
                label: source.label,
                group: source.group,
                type: source.type,
                official: Boolean(source.official),
                score: source.score || source.priority || 0,
                requiresEnv: source.requiresEnv || [],
            })),
            directUrls: directUrls.map((url) => ({ url, hostname: hostnameFromUrl(url) })),
            crawlOptions,
            count: finalResults.length,
            metrics,
            discovered,
            warnings,
            message: `Selected ${picked.sources.length} intelligent source${picked.sources.length === 1 ? "" : "s"}, crawled depth ${crawlDepth}, and found ${metrics.cdnLinks} CDN/static link${metrics.cdnLinks === 1 ? "" : "s"}.`,
            results: finalResults,
            elapsedMs,
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        return json(
            {
                ok: false,
                requestId: id,
                error: error.message || "Smart source query failed.",
                timestamp: new Date().toISOString(),
            },
            500
        );
    }
}
