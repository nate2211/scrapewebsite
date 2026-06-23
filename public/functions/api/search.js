import { json } from "../_shared/scrapeSecurity.js";

function hostnameFromUrl(url) {
    try {
        return new URL(url).hostname;
    } catch {
        return "";
    }
}

function normalizeBraveResults(data, limit) {
    const web = data?.web?.results || [];

    return web.slice(0, limit).map((item, index) => ({
        rank: index + 1,
        title: item.title || "Untitled",
        url: item.url,
        hostname: hostnameFromUrl(item.url),
        description: item.description || "",
        age: item.age || null,
        source: "brave",
    }));
}

async function braveSearch(query, limit, env) {
    if (!env.BRAVE_SEARCH_API_KEY) {
        throw new Error(
            "Missing BRAVE_SEARCH_API_KEY. Add it in Cloudflare Pages environment variables."
        );
    }

    const endpoint = new URL("https://api.search.brave.com/res/v1/web/search");

    endpoint.searchParams.set("q", query);
    endpoint.searchParams.set("count", String(Math.min(Math.max(limit, 1), 20)));
    endpoint.searchParams.set("safesearch", "moderate");
    endpoint.searchParams.set("text_decorations", "false");
    endpoint.searchParams.set("search_lang", "en");
    endpoint.searchParams.set("country", "us");

    const response = await fetch(endpoint.toString(), {
        headers: {
            Accept: "application/json",
            "X-Subscription-Token": env.BRAVE_SEARCH_API_KEY,
        },
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data?.error?.message || "Search provider request failed.");
    }

    return normalizeBraveResults(data, limit);
}

export async function onRequestOptions() {
    return json({ ok: true });
}

export async function onRequestPost(context) {
    try {
        const body = await context.request.json();
        const query = String(body.query || "").trim();
        const limit = Math.min(Math.max(Number(body.limit || 8), 1), 20);

        if (!query) {
            return json({ error: "Missing query." }, 400);
        }

        const provider = context.env.SEARCH_PROVIDER || "brave";
        let results = [];

        if (provider === "brave") {
            results = await braveSearch(query, limit, context.env);
        } else {
            throw new Error(`Unsupported SEARCH_PROVIDER: ${provider}`);
        }

        return json({
            ok: true,
            provider,
            query,
            count: results.length,
            results,
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        return json(
            {
                ok: false,
                error: error.message || "Search failed.",
            },
            500
        );
    }
}