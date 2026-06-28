import { SOURCE_REGISTRY } from "./sourceRegistry.js";

const INTENT_RULES = [
    {
        intent: "resale",
        words: [
            "resale", "sold", "price", "worth", "value", "comp", "used",
            "depop", "poshmark", "grailed", "mercari", "bunjang", "zenmarket",
            "vintage", "archive", "designer"
        ],
    },
    {
        intent: "fashion",
        words: [
            "shirt", "hoodie", "jacket", "pants", "jeans", "sneaker", "shoes",
            "raf", "rick owens", "supreme", "stussy", "nike", "adidas", "jordan",
            "chrome hearts", "kapital", "undercover", "issey"
        ],
    },
    {
        intent: "japan",
        words: ["japan", "japanese", "mercari japan", "zenmarket", "yahoo auctions", "rakuten", "jp", "メルカリ"],
    },
    {
        intent: "korea",
        words: ["korea", "korean", "bunjang", "bunjung"],
    },
    {
        intent: "streetwear",
        words: ["hypebeast", "drop", "release", "streetwear", "supreme", "sneaker", "fashion news"],
    },
    {
        intent: "news",
        words: ["news", "cnn", "nbc", "breaking", "politics", "world", "war", "election", "economy"],
    },
    {
        intent: "space",
        words: ["space", "nasa", "rocket", "launch", "moon", "mars", "astronomy", "telescope", "starship", "spacex"],
    },
    {
        intent: "developer",
        words: ["github", "code", "repo", "api", "javascript", "react", "python", "cloudflare", "worker"],
    },
    {
        intent: "science",
        words: ["paper", "research", "arxiv", "study", "physics", "machine learning", "ai model"],
    },
];

function lower(value) {
    return String(value || "").toLowerCase();
}

function includesAny(text, words) {
    return words.some((word) => text.includes(lower(word)));
}

export function detectIntents(query, mode = "research") {
    const text = lower(`${query} ${mode}`);
    const intents = new Set();

    for (const rule of INTENT_RULES) {
        if (includesAny(text, rule.words)) {
            intents.add(rule.intent);
        }
    }

    if (mode === "product") {
        intents.add("product");
        intents.add("resale");
    }

    if (mode === "links") {
        intents.add("developer");
    }

    if (intents.size === 0) {
        intents.add("research");
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

    const explicit = requestedSources
        .map((id) => SOURCE_REGISTRY.find((source) => source.id === id))
        .filter(Boolean);

    if (explicit.length > 0) {
        return {
            intents,
            sources: explicit.slice(0, maxSources),
            reason: "User-selected sources.",
        };
    }

    const scored = SOURCE_REGISTRY.map((source) => {
        let score = source.priority || 0;

        for (const intent of intents) {
            if (source.intents?.includes(intent)) {
                score += 28;
            }
        }

        for (const keyword of source.keywords || []) {
            if (text.includes(lower(keyword))) {
                score += 18;
            }
        }

        // Keep news out of normal resale queries.
        if (intents.includes("resale") && source.group === "news") {
            score -= 55;
        }

        // Keep resale sites out of normal news/space queries.
        if ((intents.includes("news") || intents.includes("space")) && source.group?.includes("resale")) {
            score -= 65;
        }

        // Japan query should prefer Japan/proxy sources.
        if (intents.includes("japan") && ["resale-japan", "proxy-japan", "retail-japan"].includes(source.group)) {
            score += 35;
        }

        // Space query should prefer NASA/Space.com.
        if (intents.includes("space") && source.group?.includes("space")) {
            score += 35;
        }

        return {
            ...source,
            score,
        };
    })
        .filter((source) => source.score > 50)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxSources);

    return {
        intents,
        sources: scored,
        reason: "Automatically selected sources from query intent.",
    };
}