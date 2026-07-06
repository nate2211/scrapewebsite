const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
};

const JSON_HEADERS = {
    ...CORS_HEADERS,
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
};

const SIGNAL_TTL_SECONDS = 120;

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: JSON_HEADERS,
    });
}

function cleanRoom(value) {
    return String(value || "DEFAULT")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9_-]/g, "")
        .slice(0, 64) || "DEFAULT";
}

function cleanRole(value) {
    return value === "receiver" ? "receiver" : "sender";
}

function oppositeRole(role) {
    return role === "sender" ? "receiver" : "sender";
}

function roomKey(room) {
    return `stream-room:${room}`;
}

function makeSignalId() {
    return `${Date.now()}-${crypto.randomUUID()}`;
}

async function readRoom(env, room) {
    const raw = await env.STREAM_SIGNALING.get(roomKey(room));

    if (!raw) {
        return {
            room,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messages: [],
        };
    }

    try {
        const parsed = JSON.parse(raw);

        return {
            room,
            createdAt: parsed.createdAt || Date.now(),
            updatedAt: parsed.updatedAt || Date.now(),
            messages: Array.isArray(parsed.messages) ? parsed.messages : [],
        };
    } catch {
        return {
            room,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messages: [],
        };
    }
}

async function writeRoom(env, room, data) {
    const compacted = {
        ...data,
        room,
        updatedAt: Date.now(),
        messages: data.messages
            .filter((message) => Date.now() - Number(message.createdAt || 0) < SIGNAL_TTL_SECONDS * 1000)
            .slice(-250),
    };

    await env.STREAM_SIGNALING.put(roomKey(room), JSON.stringify(compacted), {
        expirationTtl: SIGNAL_TTL_SECONDS,
    });

    return compacted;
}

export async function onRequestOptions() {
    return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
    });
}

export async function onRequestGet(context) {
    const { request, env } = context;
    const url = new URL(request.url);

    const room = cleanRoom(url.searchParams.get("room"));
    const role = cleanRole(url.searchParams.get("role"));
    const since = Number(url.searchParams.get("since") || 0);

    if (!env.STREAM_SIGNALING) {
        return json(
            {
                ok: false,
                error: "Missing STREAM_SIGNALING KV binding.",
            },
            500
        );
    }

    const data = await readRoom(env, room);
    const wantedFrom = oppositeRole(role);

    const messages = data.messages.filter((message) => {
        return message.createdAt > since && message.from === wantedFrom;
    });

    return json({
        ok: true,
        room,
        role,
        now: Date.now(),
        messages,
    });
}

export async function onRequestPost(context) {
    const { request, env } = context;

    if (!env.STREAM_SIGNALING) {
        return json(
            {
                ok: false,
                error: "Missing STREAM_SIGNALING KV binding.",
            },
            500
        );
    }

    let body;

    try {
        body = await request.json();
    } catch {
        return json(
            {
                ok: false,
                error: "Invalid JSON body.",
            },
            400
        );
    }

    const room = cleanRoom(body.room);
    const role = cleanRole(body.role);
    const type = String(body.type || "signal");

    if (!body.payload) {
        return json(
            {
                ok: false,
                error: "Missing payload.",
            },
            400
        );
    }

    const data = await readRoom(env, room);

    const message = {
        id: makeSignalId(),
        type,
        room,
        from: role,
        to: oppositeRole(role),
        payload: body.payload,
        createdAt: Date.now(),
    };

    data.messages.push(message);

    await writeRoom(env, room, data);

    return json({
        ok: true,
        room,
        id: message.id,
        createdAt: message.createdAt,
    });
}

export async function onRequestDelete(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const room = cleanRoom(url.searchParams.get("room"));

    if (!env.STREAM_SIGNALING) {
        return json(
            {
                ok: false,
                error: "Missing STREAM_SIGNALING KV binding.",
            },
            500
        );
    }

    await env.STREAM_SIGNALING.delete(roomKey(room));

    return json({
        ok: true,
        room,
        cleared: true,
    });
}