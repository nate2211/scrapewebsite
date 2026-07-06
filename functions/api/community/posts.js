// functions/api/community/posts.js

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Accept",
        },
    });
}

export async function onRequestOptions() {
    return json({ ok: true });
}

export async function onRequestPost({ request, env }) {
    try {
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
                body.title || "Untitled track",
                body.artist || "",
                body.audioUrl || "",
                body.artworkUrl || "",
                body.caption || "",
                createdAt
            )
            .run();

        return json({ ok: true, id });
    } catch (error) {
        return json(
            {
                ok: false,
                error: error?.message || "Could not create community post.",
            },
            500
        );
    }
}