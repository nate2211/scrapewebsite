// functions/api/community/feed.js

export async function onRequestGet({ env, request }) {
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

    return Response.json({ posts: results });
}