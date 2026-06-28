import {
    extractPageData,
    fetchLimited,
    json,
    validatePublicUrl,
} from "../_shared/scrapeSecurity.js";
import { pickSourcesForQuery } from "../_shared/sourceRouter.js";
import { runSourceAdapter } from "../_shared/sourceAdapters.js";

function extractUrlsFromText(value) {
    const matches = String(value || "").match(/https?:\/\/[^\s"'<>]+/gi) || [];

    return [...new Set(matches)]
        .map((url) => url.trim())
        .filter(Boolean)
        .slice(0, 8);
}

function hostnameFromUrl(url) {
    try {
        return new URL(url).hostname;
    } catch {
        return "";
    }
}

async function scrapeOneUrl({ rawUrl, query, mode }) {
    const parsed = validatePublicUrl(rawUrl);

    const { response, text, truncated } = await fetchLimited(parsed.toString());

    const contentType = response.headers.get("content-type") || "";

    const data = extractPageData({
        html: text,
        url: response.url || parsed.toString(),
        query,
        mode,
        status: response.status,
        contentType,
        truncated,
    });

    return {
        ok: true,
        type: "scrape",
        source: "direct-url",
        sourceLabel: "Direct URL",
        data,
    };
}

async function scrapeDirectUrls({ urls, query, mode }) {
    const results = [];

    for (const rawUrl of urls.slice(0, 5)) {
        try {
            results.push(await scrapeOneUrl({ rawUrl, query, mode }));
        } catch (error) {
            results.push({
                ok: false,
                type: "scrape-error",
                source: "direct-url",
                sourceLabel: "Direct URL",
                url: rawUrl,
                hostname: hostnameFromUrl(rawUrl),
                error: error.message || "Scrape failed.",
            });
        }
    }

    return results;
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
        exampleBody: {
            query: "raf simons hoodie resale",
            mode: "product",
            urls: [],
            sources: [],
            maxSources: 8,
        },
    });
}

export async function onRequestPost(context) {
    try {
        const body = await context.request.json();

        const query = String(body.query || "").trim();
        const mode = String(body.mode || "research").trim();
        const maxSources = Math.min(Math.max(Number(body.maxSources || 8), 1), 12);

        if (!query) {
            return json({ ok: false, error: "Missing query." }, 400);
        }

        const providedUrls = Array.isArray(body.urls) ? body.urls : [];
        const requestedSources = Array.isArray(body.sources) ? body.sources : [];

        const directUrls = [
            ...providedUrls,
            ...extractUrlsFromText(query),
        ]
            .map((url) => String(url || "").trim())
            .filter(Boolean);

        const uniqueDirectUrls = [...new Set(directUrls)].slice(0, 5);

        const picked = pickSourcesForQuery({
            query,
            mode,
            requestedSources,
            maxSources,
        });

        const results = [];

        if (uniqueDirectUrls.length > 0) {
            const directResults = await scrapeDirectUrls({
                urls: uniqueDirectUrls,
                query,
                mode,
            });

            results.push(...directResults);
        }

        for (const source of picked.sources) {
            const sourceResults = await runSourceAdapter({
                source,
                query,
                mode,
                env: context.env,
            });

            results.push(...sourceResults);
        }

        return json({
            ok: true,
            mode,
            query,
            smartSourceRouting: true,
            intents: picked.intents,
            selectedSources: picked.sources.map((source) => ({
                id: source.id,
                label: source.label,
                group: source.group,
                type: source.type,
                score: source.score || source.priority || 0,
            })),
            count: results.length,
            message: `Selected ${picked.sources.length} intelligent source${
                picked.sources.length === 1 ? "" : "s"
            } for this query.`,
            results,
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        return json(
            {
                ok: false,
                error: error.message || "Smart source query failed.",
            },
            500
        );
    }
}