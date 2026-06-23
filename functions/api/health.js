import { json } from "../_shared/scrapeSecurity.js";

export async function onRequestOptions() {
    return json({ ok: true });
}

export async function onRequestGet() {
    return json({
        ok: true,
        service: "ScrapeWebsite API",
        externalApiKeysRequired: false,
        routes: ["/api/scrape", "/api/batch-scrape"],
        timestamp: new Date().toISOString(),
    });
}