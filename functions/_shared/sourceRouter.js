import { SOURCE_REGISTRY } from "./sourceRegistry.js";

const INTENT_RULES = [
    {
        intent: "resale",
        words: [
            "resale", "sold", "price", "worth", "value", "comp", "market price",
            "used", "secondhand", "depop", "poshmark", "grailed", "mercari",
            "bunjang", "bunjung", "zenmarket", "stockx", "vestiaire", "realreal",
            "vintage", "archive", "designer", "listing", "listings",
        ],
    },
    {
        intent: "fashion",
        words: [
            "shirt", "hoodie", "jacket", "pants", "jeans", "sneaker", "shoes",
            "tee", "sweater", "raf", "raf simons", "rick owens", "supreme",
            "stussy", "nike", "adidas", "jordan", "chrome hearts", "kapital",
            "undercover", "issey", "prada", "margiela", "archive fashion",
        ],
    },
    {
        intent: "japan",
        words: [
            "japan", "japanese", "mercari japan", "zenmarket", "buyee",
            "yahoo auctions", "rakuten", "rakuma", "jp", "メルカリ",
            "ヤフオク", "日本",
        ],
    },
    {
        intent: "korea",
        words: ["korea", "korean", "bunjang", "bunjung", "번개장터"],
    },
    {
        intent: "streetwear",
        words: [
            "hypebeast", "highsnobiety", "drop", "release", "streetwear",
            "supreme", "sneaker", "fashion news", "jordan release", "nike release",
        ],
    },
    {
        intent: "news",
        words: [
            "news", "cnn", "nbc", "breaking", "politics", "world", "war",
            "election", "economy", "reuters", "associated press", "ap news",
            "bbc", "latest", "today",
        ],
    },
    {
        intent: "space",
        words: [
            "space", "nasa", "rocket", "launch", "moon", "mars", "astronomy",
            "telescope", "starship", "spacex", "esa", "asteroid", "apod",
        ],
    },
    {
        intent: "developer",
        words: [
            "github", "code", "repo", "api", "javascript", "react", "python",
            "cloudflare", "worker", "node", "npm", "library", "docs",
            "documentation", "endpoint", "json", "cdn",
        ],
    },
    {
        intent: "science",
        words: [
            "paper", "research", "arxiv", "study", "physics", "machine learning",
            "ai model", "biology", "chemistry", "journal", "experiment",
        ],
    },
    {
        intent: "reference",
        words: [
            "wikipedia", "wiki", "what is", "who is", "history of", "definition",
            "overview", "explain", "encyclopedia", "background",
        ],
    },
    {
        intent: "product",
        words: [
            "buy", "shopping", "product", "item", "sku", "model", "deal",
            "discount", "retail", "store", "price", "listing", "available",
        ],
    },
    {
        intent: "assets",
        words: [
            "cdn", "asset", "assets", "image link", "script", "static", "_next",
            "chunk", "api route", "endpoint", "hidden links", "link discovery",
            "crawl", "branch", "branch down",
        ],
    },
];

const MODE_INTENTS = {
    product: ["product", "resale"],
    resale: ["product", "resale", "fashion"],
    links: ["assets", "developer"],
    assets: ["assets", "developer"],
    crawl: ["assets", "research"],
    news: ["news"],
    research: ["research", "reference"],
    quick: ["research"],
};

function lower(value) {
    return String(value || "").toLowerCase();
}

function includesAny(text, words) {
    return words.some((word) => text.includes(lower(word)));
}

function tokenSet(value) {
    return new Set(
        lower(value)
            .split(/[^a-z0-9一-龥ぁ-んァ-ンー]+/i)
            .map((token) => token.trim())
            .filter((token) => token.length >= 2)
    );
}

function sourceHasIntent(source, intent) {
    return Array.isArray(source.intents) && source.intents.includes(intent);
}

function sourceHasKeyword(source, text) {
    return (source.keywords || []).some((keyword) => text.includes(lower(keyword)));
}

function scoreSource(source, { text, intents, mode }) {
    let score = source.priority || 0;

    for (const intent of intents) {
        if (sourceHasIntent(source, intent)) score += 32;
    }

    if (sourceHasKeyword(source, text)) score += 22;

    if (intents.includes("research") && source.group === "reference") score += 22;
    if (intents.includes("reference") && source.group === "reference") score += 30;

    if (
        intents.includes("resale") &&
        [
            "resale",
            "resale-japan",
            "resale-korea",
            "proxy-japan",
            "luxury-resale",
            "resale-verified",
        ].includes(source.group)
    ) {
        score += 38;
    }

    if (
        intents.includes("fashion") &&
        ["resale", "streetwear-news", "sneaker-news", "luxury-resale"].includes(
            source.group
        )
    ) {
        score += 18;
    }

    if (
        intents.includes("japan") &&
        ["resale-japan", "proxy-japan", "retail-japan"].includes(source.group)
    ) {
        score += 45;
    }

    if (intents.includes("korea") && source.group === "resale-korea") {
        score += 45;
    }

    if (intents.includes("space") && String(source.group || "").includes("space")) {
        score += 45;
    }

    if (
        intents.includes("science") &&
        ["science", "science-news", "reference", "space"].includes(source.group)
    ) {
        score += 25;
    }

    if (
        intents.includes("developer") &&
        String(source.group || "").includes("developer")
    ) {
        score += 38;
    }

    if (
        intents.includes("assets") &&
        ["developer", "developer-docs", "reference"].includes(source.group)
    ) {
        score += 18;
    }

    if (
        intents.includes("resale") &&
        source.group === "news" &&
        !intents.includes("streetwear")
    ) {
        score -= 70;
    }

    if (
        (intents.includes("news") || intents.includes("space")) &&
        String(source.group || "").startsWith("resale")
    ) {
        score -= 78;
    }

    if (
        intents.includes("developer") &&
        String(source.group || "").startsWith("resale") &&
        !intents.includes("resale")
    ) {
        score -= 65;
    }

    if (mode === "quick" && source.type === "api" && source.requiresEnv?.length) {
        score -= 10;
    }

    if (text.includes(lower(source.id)) || text.includes(lower(source.label))) {
        score += 60;
    }

    return score;
}

function diversify(scored, maxSources, maxPerGroup = 4) {
    const selected = [];
    const groupCounts = new Map();

    for (const source of scored) {
        const group = source.group || "other";
        const used = groupCounts.get(group) || 0;

        if (used >= maxPerGroup && selected.length < maxSources - 2) {
            continue;
        }

        selected.push(source);
        groupCounts.set(group, used + 1);

        if (selected.length >= maxSources) break;
    }

    return selected;
}

export function detectIntents(query, mode = "research") {
    const text = lower(`${query} ${mode}`);
    const intents = new Set(MODE_INTENTS[mode] || []);

    for (const rule of INTENT_RULES) {
        if (includesAny(text, rule.words)) {
            intents.add(rule.intent);
        }
    }

    if (intents.size === 0) {
        intents.add("research");
    }

    const tokens = tokenSet(query);

    if (
        tokens.size <= 5 &&
        !intents.has("resale") &&
        !intents.has("news") &&
        !intents.has("developer") &&
        !intents.has("space")
    ) {
        intents.add("reference");
    }

    return [...intents];
}

export function pickSourcesForQuery({
                                        query,
                                        mode = "research",
                                        requestedSources = [],
                                        maxSources = 8,
                                    }) {
    const text = lower(`${query} ${mode}`);
    const intents = detectIntents(query, mode);
    const max = Math.min(Math.max(Number(maxSources || 8), 1), 16);

    const explicit = requestedSources
        .map((id) => SOURCE_REGISTRY.find((source) => source.id === id))
        .filter(Boolean)
        .slice(0, max)
        .map((source) => ({ ...source, score: 999 }));

    if (explicit.length > 0) {
        return {
            intents,
            sources: explicit,
            reason: "User-selected source IDs were honored first.",
        };
    }

    let threshold = 58;

    if (
        intents.includes("resale") ||
        intents.includes("news") ||
        intents.includes("developer")
    ) {
        threshold = 64;
    }

    if (mode === "quick") threshold = 70;

    const scored = SOURCE_REGISTRY
        .map((source) => ({
            ...source,
            score: scoreSource(source, { text, intents, mode }),
        }))
        .filter((source) => source.score >= threshold)
        .sort((a, b) => b.score - a.score);

    const sources = diversify(scored, max, intents.includes("resale") ? 5 : 4);

    return {
        intents,
        sources,
        reason: "Automatically selected official/source-specific sites from query intent.",
    };
}