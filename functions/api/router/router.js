function json(data, status = 200, headers = {}) {
    return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            ...headers,
        },
    });
}

function getCorsHeaders(request) {
    const origin = request.headers.get("Origin") || "";

    const allowedOrigins = new Set([
        "https://suiteofficelab.com",
        "https://audiomasterlab.com",
        "https://www.audiomasterlab.com",
        "https://videomasterlab.com",
        "https://videowebsite.unusualsuspectsclothing.workers.dev",
        "https://imagemasterlab.com",
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:5173",
    ]);

    return {
        "Access-Control-Allow-Origin": allowedOrigins.has(origin)
            ? origin
            : "https://audiomasterlab.com",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Accept",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
    };
}

function normalizeJobs(payload) {
    if (Array.isArray(payload?.jobs)) {
        return payload.jobs;
    }

    if (payload?.url) {
        return [payload];
    }

    return [];
}

function isQueueFullError(error) {
    const text = String(
        error?.message ||
        error?.stack ||
        error ||
        ""
    ).toLowerCase();

    return (
        text.includes("queue") ||
        text.includes("capacity") ||
        text.includes("quota") ||
        text.includes("rate") ||
        text.includes("too many") ||
        text.includes("limit") ||
        text.includes("backpressure")
    );
}

export async function onRequest(context) {
    const { request, env } = context;
    const corsHeaders = getCorsHeaders(request);

    if (request.method === "OPTIONS") {
        return new Response(null, {
            status: 204,
            headers: corsHeaders,
        });
    }

    if (request.method !== "POST") {
        return json(
            { ok: false, error: "Method not allowed" },
            405,
            corsHeaders
        );
    }

    let payload;

    try {
        payload = await request.json();
    } catch {
        return json(
            { ok: false, error: "Invalid JSON" },
            400,
            corsHeaders
        );
    }

    const jobs = normalizeJobs(payload);

    if (!jobs.length) {
        return json(
            {
                ok: true,
                accepted: 0,
                dropped: 0,
                reason: "empty",
            },
            202,
            corsHeaders
        );
    }

    const messages = jobs.slice(0, 25).map((job) => ({
        routerId: payload.routerId || job.routerId || "main",
        sessionId: payload.sessionId || job.sessionId || "",
        pageUrl: payload.pageUrl || job.pageUrl || "",
        createdFrom: payload.createdFrom || job.createdFrom || "browser-session",
        capturedAt: job.capturedAt || payload.capturedAt || new Date().toISOString(),

        url: job.url || "",
        method: job.method || "GET",
        headers: job.headers || {},
        body: job.body || null,
        meta: job.meta || {},
    }));

    try {
        if (env.ROUTER_QUEUE && typeof env.ROUTER_QUEUE.sendBatch === "function") {
            await env.ROUTER_QUEUE.sendBatch(
                messages.map((body) => ({ body }))
            );
        } else if (env.ROUTER_QUEUE && typeof env.ROUTER_QUEUE.send === "function") {
            await Promise.all(messages.map((message) => env.ROUTER_QUEUE.send(message)));
        } else {
            // No queue binding exists. Soft accept so browser does not fail.
            return json(
                {
                    ok: true,
                    accepted: 0,
                    dropped: messages.length,
                    reason: "queue_not_configured",
                },
                202,
                corsHeaders
            );
        }

        return json(
            {
                ok: true,
                accepted: messages.length,
                dropped: Math.max(0, jobs.length - messages.length),
            },
            202,
            corsHeaders
        );
    } catch (error) {
        if (isQueueFullError(error)) {
            return json(
                {
                    ok: true,
                    accepted: 0,
                    dropped: messages.length,
                    reason: "queue_full_soft_drop",
                },
                202,
                {
                    ...corsHeaders,
                    "Retry-After": "10",
                }
            );
        }

        // Still return 202 so the browser app never sees this as a hard failure.
        return json(
            {
                ok: true,
                accepted: 0,
                dropped: messages.length,
                reason: "router_soft_drop",
            },
            202,
            {
                ...corsHeaders,
                "Retry-After": "10",
            }
        );
    }
}