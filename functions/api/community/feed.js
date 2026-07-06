// functions/api/community/feed.js

const ALLOWED_ORIGINS = new Set([
    "https://audiomasterlab.com",
    "https://www.audiomasterlab.com",
    "https://scrapewebsite.pages.dev",
    "http://localhost:3000",
    "http://localhost:5173",
]);

function getCorsHeaders(request) {
    const origin = request.headers.get("Origin") || "";

    return {
        "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin)
            ? origin
            : "https://audiomasterlab.com",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Accept, Content-Type",
        "Vary": "Origin",
    };
}

function json(data, request, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            ...getCorsHeaders(request),
            "Content-Type": "application/json",
        },
    });
}

export async function onRequestOptions({ request }) {
    return json({ ok: true }, request);
}

export async function onRequestGet({ env, request }) {
    try {
        const url = new URL(request.url);
        const limit = Math.min(Number(url.searchParams.get("limit") || 30), 50);

        const { results } = await env.DB.prepare(`
      SELECT *
      FROM community_posts
      ORDER BY created_at DESC
      LIMIT ?
    `)
            .bind(limit)
            .all();

        return json({ ok: true, posts: results }, request);
    } catch (error) {
        return json(
            {
                ok: false,
                error: error?.message || "Could not load community feed.",
            },
            request,
            500
        );
    }
}