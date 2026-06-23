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

        const url = String(body.url || "").trim();
        const query = String(body.query || "").trim();
        const mode = String(body.mode || "research").trim();

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

        return json({
            ok: true,
            data,
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        return json(
            {
                ok: false,
                error: error.message || "Scrape failed.",
            },
            400
        );
    }
}