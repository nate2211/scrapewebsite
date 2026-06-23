import {
    extractPageData,
    fetchLimited,
    json,
    validatePublicUrl,
} from "../_shared/scrapeSecurity.js";

export async function onRequestOptions() {
    return json({ ok: true });
}

export async function onRequestPost(context) {
    try {
        const body = await context.request.json();

        const urls = Array.isArray(body.urls) ? body.urls : [];
        const query = String(body.query || "").trim();
        const mode = String(body.mode || "research").trim();

        const limitedUrls = urls
            .map((url) => String(url || "").trim())
            .filter(Boolean)
            .slice(0, 5);

        if (limitedUrls.length === 0) {
            return json({ error: "Missing URLs." }, 400);
        }

        const results = [];

        for (const rawUrl of limitedUrls) {
            try {
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

                results.push({
                    ok: true,
                    data,
                });
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
            count: results.length,
            results,
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        return json(
            {
                ok: false,
                error: error.message || "Batch scrape failed.",
            },
            500
        );
    }
}