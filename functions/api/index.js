export async function onRequest() {
    return Response.json(
        {
            ok: true,
            service: "ScrapeWebsite API",
            routes: [
                "/api/health",
                "/api/query-scrape",
                "/api/scrape",
                "/api/batch-scrape"
            ],
            timestamp: new Date().toISOString()
        },
        {
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "no-store"
            }
        }
    );
}