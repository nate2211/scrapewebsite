import {
    extractPageData,
    fetchLimited,
    json,
    validatePublicUrl,
} from "../_shared/scrapeSecurity.js";

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
    ];
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
        data,
    };
}

export async function onRequest(context) {
    const { request } = context;

    if (request.method === "OPTIONS") {
        return json({ ok: true });
    }

    if (request.method === "GET") {
        return json({
            ok: true,
            message: "query-scrape API is live. Use POST to run a scrape.",
            route: "/api/query-scrape",
            timestamp: new Date().toISOString(),
        });
    }

    if (request.method !== "POST") {
        return json(
            {
                ok: false,
                error: `Method ${request.method} not allowed.`,
            },
            405
        );
    }

    try {
        const body = await request.json();

        const query = String(body.query || "").trim();
        const mode = String(body.mode || "research").trim();

        if (!query) {
            return json({ ok: false, error: "Missing query." }, 400);
        }

        const providedUrls = Array.isArray(body.urls) ? body.urls : [];
        const urls = [...providedUrls, ...extractUrlsFromText(query)]
            .map((url) => String(url || "").trim())
            .filter(Boolean);

        const uniqueUrls = [...new Set(urls)].slice(0, 5);

        if (uniqueUrls.length > 0) {
            const results = [];

            for (const rawUrl of uniqueUrls) {
                try {
                    results.push(await scrapeOneUrl({ rawUrl, query, mode }));
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
                        "Paste a direct URL into the query box to scrape it, or open one of these search links and copy a result URL back into the app.",
                    suggestedSources: buildSearchLinks(query),
                },
            ],
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        return json(
            {
                ok: false,
                error: error.message || "Query scrape failed.",
            },
            500
        );
    }
}