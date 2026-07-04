export function cleanText(value = "") {
    return String(value)
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

function firstMatch(html, regex) {
    const match = String(html || "").match(regex);
    return match ? cleanText(match[1]) : "";
}

function normalizeUrl(rawUrl, baseUrl = "https://example.com") {
    try {
        return new URL(rawUrl, baseUrl).toString();
    } catch {
        return null;
    }
}

function allMatches(html, regex, mapper, limit = 80) {
    const out = [];
    let match;

    while ((match = regex.exec(String(html || ""))) && out.length < limit) {
        const item = mapper(match);
        if (item) out.push(item);
    }

    return out;
}

function unique(items) {
    return [...new Set(items.filter(Boolean))];
}

export function analyzeHtmlLocally({
                                       html,
                                       baseUrl = "https://example.com",
                                       query = "",
                                   }) {
    const source = String(html || "");
    const text = cleanText(source);

    const title =
        firstMatch(source, /<title[^>]*>([\s\S]*?)<\/title>/i) ||
        firstMatch(
            source,
            /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i
        ) ||
        "Untitled HTML";

    const description =
        firstMatch(
            source,
            /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i
        ) ||
        firstMatch(
            source,
            /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i
        );

    const headings = allMatches(
        source,
        /<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1>/gi,
        (match) => ({
            level: Number(match[1]),
            text: cleanText(match[2]).slice(0, 220),
        }),
        80
    );

    const links = allMatches(
        source,
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

    const images = allMatches(
        source,
        /<img\b[^>]*src=["']([^"']+)["'][^>]*>/gi,
        (match) => {
            const src = normalizeUrl(match[1], baseUrl);
            if (!src) return null;

            return {
                src,
                alt: firstMatch(match[0], /alt=["']([^"']*)["']/i),
            };
        },
        100
    );

    const prices = unique(
        source.match(/(?:\$|USD\s?)\s?\d{1,6}(?:,\d{3})*(?:\.\d{2})?/gi) ||
        []
    ).slice(0, 60);

    const apiCandidates = unique(
        (
            source.match(
                /https?:\/\/[^\s"'<>\\]+|\/(?:api|graphql|v\d+|search|products|items|listings|query)[^\s"'<>\\]*/gi
            ) || []
        )
            .map((item) => normalizeUrl(item, baseUrl))
            .filter((url) =>
                /\/api\/|graphql|\/v\d+\/|search|products|items|listings|query/i.test(
                    url || ""
                )
            )
    ).slice(0, 120);

    const queryWords = String(query || "")
        .toLowerCase()
        .split(/\s+/)
        .filter((word) => word.length > 2);

    const lowerText = text.toLowerCase();

    const queryScore = queryWords.reduce((score, word) => {
        return lowerText.includes(word) ? score + 1 : score;
    }, 0);

    return {
        ok: true,
        data: {
            url: baseUrl,
            finalUrl: baseUrl,
            status: "local-html",
            contentType: "text/html",
            title,
            description,
            wordCount: text ? text.split(/\s+/).filter(Boolean).length : 0,
            queryScore,
            mode: "local",
            headings,
            links,
            images,
            prices,
            apiCandidates,
            jsonLd: [],
            textPreview: text.slice(0, 5000),
            localOnly: true,
        },
        timestamp: new Date().toISOString(),
    };
}