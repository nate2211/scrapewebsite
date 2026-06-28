import {
    extractPageData,
    fetchLimited,
    validatePublicUrl,
} from "./scrapeSecurity.js";

function cleanText(value, max = 500) {
    return String(value || "")
        .replace(/<[^>]*>/g, " ")
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

function encodeQuery(query) {
    return encodeURIComponent(String(query || "").trim());
}

async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: {
            Accept: "application/json",
            "User-Agent": "ScrapeWebsiteSourceRouter/1.0",
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
            "User-Agent": "ScrapeWebsiteSourceRouter/1.0",
            ...(options.headers || {}),
        },
    });

    const text = await response.text();

    if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
    }

    return {
        response,
        text,
    };
}

function parseRssItems(xml, sourceId, sourceLabel, limit = 10) {
    const itemMatches = xml.match(/<item[\s\S]*?<\/item>/gi) || [];

    return itemMatches.slice(0, limit).map((item, index) => {
        const title = item.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i)?.[1]
            || item.match(/<title>([\s\S]*?)<\/title>/i)?.[1]
            || "Untitled";

        const link = item.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || "";
        const description = item.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/i)?.[1]
            || item.match(/<description>([\s\S]*?)<\/description>/i)?.[1]
            || "";

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
        };
    });
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
        price: item.price
            ? `${item.price.value} ${item.price.currency}`
            : null,
        image: item.image?.imageUrl || null,
        condition: item.condition || null,
        seller: item.seller?.username || null,
    }));
}

async function runGitHub(source, query) {
    const url = `https://api.github.com/search/repositories?q=${encodeQuery(query)}&sort=stars&order=desc&per_page=10`;
    const data = await fetchJson(url, {
        headers: {
            Accept: "application/vnd.github+json",
        },
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
    }));
}

async function runReddit(source, query) {
    const url = `https://www.reddit.com/search.json?q=${encodeQuery(query)}&limit=10&sort=relevance&type=link`;
    const data = await fetchJson(url);

    const posts = data?.data?.children || [];

    return posts.map((post, index) => {
        const item = post.data || {};
        const finalUrl = item.permalink
            ? `https://www.reddit.com${item.permalink}`
            : item.url;

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
        };
    });
}

async function runNasaOpen(source, query, env) {
    const key = env.NASA_API_KEY || "DEMO_KEY";
    const q = query.toLowerCase();

    if (q.includes("apod") || q.includes("astronomy picture")) {
        const data = await fetchJson(`https://api.nasa.gov/planetary/apod?api_key=${encodeURIComponent(key)}`);

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

    return runNasaImages(
        {
            ...source,
            id: "nasa-images",
            label: "NASA Image and Video Library",
        },
        query
    );
}

async function runNasaImages(source, query) {
    const url = `https://images-api.nasa.gov/search?q=${encodeQuery(query)}&media_type=image,video`;
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
    const url = `https://export.arxiv.org/api/query?search_query=all:${encodeQuery(query)}&start=0&max_results=10`;
    const { text } = await fetchText(url, {
        headers: {
            Accept: "application/atom+xml,application/xml,text/xml",
        },
    });

    const entries = text.match(/<entry[\s\S]*?<\/entry>/gi) || [];

    return entries.slice(0, 10).map((entry, index) => {
        const title = entry.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "Untitled";
        const summary = entry.match(/<summary>([\s\S]*?)<\/summary>/i)?.[1] || "";
        const id = entry.match(/<id>([\s\S]*?)<\/id>/i)?.[1] || "";

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
        };
    });
}

async function runRssOrDirect(source, query, mode) {
    if (source.rss) {
        try {
            const { text } = await fetchText(source.rss, {
                headers: {
                    Accept: "application/rss+xml,application/xml,text/xml",
                },
            });

            const rssItems = parseRssItems(text, source.id, source.label, 10);
            const q = String(query || "").toLowerCase();

            const filtered = rssItems.filter((item) => {
                const haystack = `${item.title} ${item.description}`.toLowerCase();
                return q.split(/\s+/).some((word) => word.length > 2 && haystack.includes(word));
            });

            if (filtered.length > 0) {
                return filtered;
            }

            return rssItems;
        } catch {
            // Fall back to direct page scrape below.
        }
    }

    return runDirectSite(source, query, mode);
}

async function runDirectSite(source, query, mode) {
    if (!source.buildUrl) {
        return [];
    }

    const url = source.buildUrl(query);

    try {
        const parsed = validatePublicUrl(url);
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

        return [{
            ok: true,
            type: "direct-site-result",
            source: source.id,
            sourceLabel: source.label,
            title: data.title || source.label,
            url: data.url || url,
            hostname: hostnameFromUrl(data.url || url),
            description: data.description || data.preview || "",
            data,
        }];
    } catch (error) {
        return [{
            ok: false,
            type: "source-link",
            source: source.id,
            sourceLabel: source.label,
            url,
            hostname: hostnameFromUrl(url),
            error:
                "This source may block server-side requests or require browser/login access. Opening the official search URL is still available.",
        }];
    }
}

export async function runSourceAdapter({ source, query, mode, env }) {
    try {
        if (source.id === "ebay") return await runEbay(source, query, env);
        if (source.id === "github") return await runGitHub(source, query);
        if (source.id === "hackernews") return await runHackerNews(source, query);
        if (source.id === "reddit") return await runReddit(source, query);
        if (source.id === "nasa-open") return await runNasaOpen(source, query, env);
        if (source.id === "nasa-images") return await runNasaImages(source, query);
        if (source.id === "arxiv") return await runArxiv(source, query);

        if (source.type === "rss-or-direct") {
            return await runRssOrDirect(source, query, mode);
        }

        if (source.type === "direct-site") {
            return await runDirectSite(source, query, mode);
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