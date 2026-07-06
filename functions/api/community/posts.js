// functions/api/community/posts.js

export async function onRequestPost({ request, env }) {
    const body = await request.json();

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    await env.DB.prepare(`
    INSERT INTO community_posts
    (id, user_name, title, artist, audio_url, artwork_url, caption, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
        .bind(
            id,
            body.userName || "Anonymous",
            body.title,
            body.artist || "",
            body.audioUrl,
            body.artworkUrl || "",
            body.caption || "",
            createdAt
        )
        .run();

    return Response.json({ ok: true, id });
}