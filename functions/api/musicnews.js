const ALLOWED_ORIGINS = new Set([
    "https://audiomasterlab.com",
    "https://www.audiomasterlab.com",
    "https://suiteofficelab.com",
    "https://videomasterlab.com",
    "https://imagemasterlab.com",
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:5173",
]);

const BASE_RSS_SOURCES = [
    {
        id: "google-music-news",
        label: "Google News",
        url: buildGoogleNewsUrl("music news"),
    },
    {
        id: "pitchfork-news",
        label: "Pitchfork News",
        url: "https://pitchfork.com/feed/feed-news/rss",
    },
    {
        id: "pitchfork-albums",
        label: "Pitchfork Album Reviews",
        url: "https://pitchfork.com/feed/feed-album-reviews/rss",
    },
    {
        id: "pitchfork-tracks",
        label: "Pitchfork Tracks",
        url: "https://pitchfork.com/feed/feed-tracks/rss",
    },
    {
        id: "musicchoice",
        label: "Music Choice",
        url: "https://www.musicchoice.com/blog-feed.xml",
    },
    {
        id: "reddit-music",
        label: "Reddit Music",
        url: "https://old.reddit.com/r/Music/.rss",
    },
    {
        id: "reddit-hiphopheads",
        label: "Reddit HipHopHeads",
        url: "https://old.reddit.com/r/hiphopheads/.rss",
    },
    {
        id: "reddit-popheads",
        label: "Reddit PopHeads",
        url: "https://old.reddit.com/r/popheads/.rss",
    },
];

function buildGoogleNewsUrl(query) {
    const q = `${String(query || "music news").trim()} when:14d`;
    return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
}

function getCorsHeaders(request) {
    const origin = request.headers.get("Origin") || "";

    return {
        "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin)
            ? origin
            : "https://audiomasterlab.com",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Accept, Content-Type",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
    };
}

function sendJson(request, body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            ...getCorsHeaders(request),
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "public, max-age=900",
            "X-Content-Type-Options": "nosniff",
        },
    });
}

function decodeXml(value = "") {
    return String(value)
        .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/g, "'")
        .replace(/&#x2F;/g, "/")
        .trim();
}

function stripHtml(value = "") {
    return decodeXml(value)
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function getTag(block, tag) {
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = block.match(new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "i"));
    return match ? decodeXml(match[1]) : "";
}

function getAttr(block, tag, attr) {
    const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedAttr = attr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = block.match(
        new RegExp(`<${escapedTag}[^>]*\\s${escapedAttr}=["']([^"']+)["'][^>]*>`, "i")
    );
    return match ? decodeXml(match[1]) : "";
}

function getImage(block) {
    const direct =
        getAttr(block, "media:content", "url") ||
        getAttr(block, "media:thumbnail", "url") ||
        getAttr(block, "enclosure", "url");

    if (direct) return direct;

    const html = getTag(block, "description") || getTag(block, "content:encoded") || "";
    const img = html.match(/<img[^>]+src=["']([^"']+)["']/i);
    return img ? decodeXml(img[1]) : "";
}

function safeDate(value) {
    if (!value) return null;
    const time = Date.parse(value);
    return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function makeId(sourceId, url, title) {
    const raw = `${sourceId}:${url || title}`;
    let hash = 0;

    for (let i = 0; i < raw.length; i += 1) {
        hash = (hash << 5) - hash + raw.charCodeAt(i);
        hash |= 0;
    }

    return `${sourceId}-${Math.abs(hash)}`;
}

function parseFeed(xml, source) {
    const isAtom = /<feed[\s>]/i.test(xml);
    const blocks = isAtom
        ? xml.match(/<entry[\s\S]*?<\/entry>/gi) || []
        : xml.match(/<item[\s\S]*?<\/item>/gi) || [];

    return blocks.map((block) => {
        const title = stripHtml(getTag(block, "title"));
        const atomLink = getAttr(block, "link", "href");
        const link = decodeXml(atomLink || getTag(block, "link") || getTag(block, "guid"));
        const summary = stripHtml(
            getTag(block, "description") ||
            getTag(block, "summary") ||
            getTag(block, "content") ||
            getTag(block, "content:encoded")
        );

        const publishedAt = safeDate(
            getTag(block, "pubDate") || getTag(block, "published") || getTag(block, "updated")
        );

        return {
            id: makeId(source.id, link, title),
            source: source.label,
            sourceId: source.id,
            title,
            url: link,
            imageUrl: getImage(block),
            summary: summary.slice(0, 420),
            publishedAt,
            provider: "rss",
        };
    });
}

function buildQuerySources(query) {
    const clean = String(query || "").trim();

    if (!clean) return [];

    return [
        {
            id: "google-query",
            label: "Google News",
            url: buildGoogleNewsUrl(`${clean} music`),
        },
        {
            id: "reddit-music-query",
            label: "Reddit Music Search",
            url: `https://old.reddit.com/r/Music/search.rss?q=${encodeURIComponent(clean)}&restrict_sr=on&sort=new&t=month`,
        },
        {
            id: "reddit-hiphopheads-query",
            label: "Reddit HipHopHeads Search",
            url: `https://old.reddit.com/r/hiphopheads/search.rss?q=${encodeURIComponent(clean)}&restrict_sr=on&sort=new&t=month`,
        },
    ];
}

async function fetchSource(source) {
    const response = await fetch(source.url, {
        headers: {
            Accept: "application/rss+xml, application/atom+xml, text/xml, */*",
            "User-Agent": "AudioMasterLabNews/1.0 https://audiomasterlab.com",
        },
    });

    if (!response.ok) {
        throw new Error(`${source.label} returned ${response.status}`);
    }

    const text = await response.text();
    return parseFeed(text, source);
}

export async function onRequest(context) {
    const { request } = context;
    const corsHeaders = getCorsHeaders(request);

    if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "GET") {
        return new Response("Method not allowed", { status: 405, headers: corsHeaders });
    }

    const requestUrl = new URL(request.url);
    const query = requestUrl.searchParams.get("query") || "";
    const limit = Math.min(Math.max(Number(requestUrl.searchParams.get("limit") || 48), 1), 80);

    const sources = [...buildQuerySources(query), ...BASE_RSS_SOURCES];
    const settled = await Promise.allSettled(sources.map(fetchSource));

    const errors = [];
    const seen = new Set();

    const articles = settled
        .flatMap((result, index) => {
            if (result.status === "fulfilled") return result.value;

            errors.push({
                source: sources[index].label,
                message: result.reason?.message || "Fetch failed",
            });

            return [];
        })
        .filter((article) => {
            if (!article.title || !article.url) return false;

            const key = article.url.replace(/[?#].*$/, "").toLowerCase();
            if (seen.has(key)) return false;

            seen.add(key);
            return true;
        })
        .sort((a, b) => {
            const aTime = a.publishedAt ? Date.parse(a.publishedAt) : 0;
            const bTime = b.publishedAt ? Date.parse(b.publishedAt) : 0;
            return bTime - aTime;
        })
        .slice(0, limit);

    return sendJson(request, {
        ok: true,
        query,
        count: articles.length,
        articles,
        errors,
        sources: sources.map(({ id, label, url }) => ({ id, label, url })),
        fetchedAt: new Date().toISOString(),
    });
}