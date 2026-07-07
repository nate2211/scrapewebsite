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
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Accept",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin",
    };
}

function jsonResponse(request, data, init = {}) {
    return Response.json(data, {
        ...init,
        headers: {
            ...getCorsHeaders(request),
            ...(init.headers || {}),
        },
    });
}

function cleanText(value, maxLength = 300) {
    return String(value || "").trim().slice(0, maxLength);
}

function cleanUrl(value) {
    const raw = String(value || "").trim();

    if (!raw) return "";

    try {
        const parsed = new URL(raw);

        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
            return "";
        }

        return parsed.toString();
    } catch {
        return "";
    }
}

function cleanNumber(value) {
    const number = Number(value);

    if (!Number.isFinite(number) || number < 0) {
        return 0;
    }

    return number;
}

export async function onRequestOptions({ request }) {
    return new Response(null, {
        status: 204,
        headers: getCorsHeaders(request),
    });
}

export async function onRequestGet({ env, request }) {
    try {
        const url = new URL(request.url);
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 25), 1), 50);
        const activeWithinSeconds = Math.min(
            Math.max(Number(url.searchParams.get("activeWithin") || 90), 15),
            300
        );

        const { results } = await env.DB.prepare(`
            SELECT
                session_id,
                user_name,
                track_title,
                artist,
                audio_url,
                artwork_url,
                position_seconds,
                duration_seconds,
                is_playing,
                updated_at
            FROM community_listening
            WHERE is_playing = 1
              AND datetime(updated_at) >= datetime('now', '-' || ? || ' seconds')
            ORDER BY datetime(updated_at) DESC
            LIMIT ?
        `)
            .bind(activeWithinSeconds, limit)
            .all();

        return jsonResponse(request, {
            ok: true,
            listeners: results || [],
            activeWithinSeconds,
        });
    } catch (error) {
        return jsonResponse(
            request,
            {
                ok: false,
                error: "Could not load live listeners.",
            },
            { status: 500 }
        );
    }
}

export async function onRequestPost({ env, request }) {
    try {
        const body = await request.json().catch(() => null);

        if (!body || typeof body !== "object") {
            return jsonResponse(
                request,
                {
                    ok: false,
                    error: "Expected JSON body.",
                },
                { status: 400 }
            );
        }

        const sessionId = cleanText(body.session_id || body.sessionId, 120);

        if (!sessionId) {
            return jsonResponse(
                request,
                {
                    ok: false,
                    error: "Missing session_id.",
                },
                { status: 400 }
            );
        }

        const userName =
            cleanText(body.user_name || body.userName, 80) || "AudioMasterLab listener";
        const trackTitle =
            cleanText(body.track_title || body.trackTitle || body.title, 220) ||
            "Unknown track";
        const artist = cleanText(body.artist, 160);
        const audioUrl = cleanUrl(body.audio_url || body.audioUrl || body.url);
        const artworkUrl = cleanUrl(body.artwork_url || body.artworkUrl || body.image_url);
        const positionSeconds = cleanNumber(
            body.position_seconds || body.positionSeconds || body.currentTime
        );
        const durationSeconds = cleanNumber(
            body.duration_seconds || body.durationSeconds || body.duration
        );
        const isPlaying = body.is_playing === false || body.isPlaying === false ? 0 : 1;

        await env.DB.prepare(`
            INSERT INTO community_listening (
                session_id,
                user_name,
                track_title,
                artist,
                audio_url,
                artwork_url,
                position_seconds,
                duration_seconds,
                is_playing,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(session_id) DO UPDATE SET
                user_name = excluded.user_name,
                track_title = excluded.track_title,
                artist = excluded.artist,
                audio_url = excluded.audio_url,
                artwork_url = excluded.artwork_url,
                position_seconds = excluded.position_seconds,
                duration_seconds = excluded.duration_seconds,
                is_playing = excluded.is_playing,
                updated_at = CURRENT_TIMESTAMP
        `)
            .bind(
                sessionId,
                userName,
                trackTitle,
                artist,
                audioUrl,
                artworkUrl,
                positionSeconds,
                durationSeconds,
                isPlaying
            )
            .run();

        return jsonResponse(request, {
            ok: true,
            saved: true,
        });
    } catch (error) {
        return jsonResponse(
            request,
            {
                ok: false,
                error: "Could not update live listening status.",
            },
            { status: 500 }
        );
    }
}