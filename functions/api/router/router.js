function cors() {
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
    };
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: {
            "Content-Type": "application/json",
            ...cors(),
        },
    });
}

function makeId() {
    return crypto.randomUUID();
}

function cleanMethod(method) {
    const value = String(method || "GET").toUpperCase();
    const allowed = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"];
    return allowed.includes(value) ? value : "GET";
}

function cleanUrl(value) {
    try {
        const url = new URL(String(value || "").trim());
        if (url.protocol !== "https:") return null;
        return url.toString();
    } catch {
        return null;
    }
}

async function ensureTable(env) {
    await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS router_requests (
      id TEXT PRIMARY KEY,
      router_id TEXT NOT NULL,
      status TEXT NOT NULL,
      method TEXT NOT NULL,
      url TEXT NOT NULL,
      headers_json TEXT NOT NULL,
      body_text TEXT,
      response_status INTEGER,
      response_body TEXT,
      error_text TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();

    await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_router_requests_status
    ON router_requests (router_id, status, created_at)
  `).run();
}

export async function onRequestOptions() {
    return new Response(null, {
        status: 204,
        headers: cors(),
    });
}

export async function onRequest({ request, env }) {
    await ensureTable(env);

    const reqUrl = new URL(request.url);

    if (request.method === "POST") {
        const payload = await request.json().catch(() => null);

        if (!payload || typeof payload !== "object") {
            return json({ ok: false, error: "Invalid JSON body." }, 400);
        }

        const url = cleanUrl(payload.url || payload.dstUrl);
        if (!url) {
            return json({ ok: false, error: "Only valid https:// URLs are allowed." }, 400);
        }

        const id = makeId();
        const now = new Date().toISOString();
        const routerId = String(payload.routerId || "main").slice(0, 80);
        const method = cleanMethod(payload.method);
        const headers = payload.headers && typeof payload.headers === "object"
            ? payload.headers
            : {};
        const body = payload.body == null
            ? null
            : typeof payload.body === "string"
                ? payload.body
                : JSON.stringify(payload.body);

        await env.DB.prepare(`
      INSERT INTO router_requests (
        id, router_id, status, method, url, headers_json, body_text, created_at, updated_at
      )
      VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, ?)
    `)
            .bind(
                id,
                routerId,
                method,
                url,
                JSON.stringify(headers),
                body,
                now,
                now
            )
            .run();

        return json({
            ok: true,
            id,
            status: "queued",
            routerId,
            method,
            url,
        });
    }

    if (request.method === "GET") {
        const routerId = String(reqUrl.searchParams.get("routerId") || "main").slice(0, 80);
        const limit = Math.min(Number(reqUrl.searchParams.get("limit") || 10), 50);
        const claim = reqUrl.searchParams.get("claim") === "1";

        const { results } = await env.DB.prepare(`
      SELECT *
      FROM router_requests
      WHERE router_id = ?
        AND status = 'queued'
      ORDER BY created_at ASC
      LIMIT ?
    `)
            .bind(routerId, limit)
            .all();

        const jobs = (results || []).map((row) => ({
            id: row.id,
            routerId: row.router_id,
            status: claim ? "claimed" : row.status,
            method: row.method,
            url: row.url,
            headers: JSON.parse(row.headers_json || "{}"),
            body: row.body_text,
            createdAt: row.created_at,
        }));

        if (claim && jobs.length) {
            const now = new Date().toISOString();

            for (const job of jobs) {
                await env.DB.prepare(`
          UPDATE router_requests
          SET status = 'claimed', updated_at = ?
          WHERE id = ?
        `)
                    .bind(now, job.id)
                    .run();
            }
        }

        return json({
            ok: true,
            routerId,
            count: jobs.length,
            jobs,
        });
    }

    if (request.method === "PATCH") {
        const payload = await request.json().catch(() => null);

        if (!payload || !payload.id) {
            return json({ ok: false, error: "Missing request id." }, 400);
        }

        const status = String(payload.status || "completed");
        const allowed = ["completed", "failed", "queued"];
        if (!allowed.includes(status)) {
            return json({ ok: false, error: "Invalid status." }, 400);
        }

        await env.DB.prepare(`
      UPDATE router_requests
      SET status = ?,
          response_status = ?,
          response_body = ?,
          error_text = ?,
          updated_at = ?
      WHERE id = ?
    `)
            .bind(
                status,
                payload.responseStatus || null,
                payload.responseBody || null,
                payload.error || null,
                new Date().toISOString(),
                payload.id
            )
            .run();

        return json({
            ok: true,
            id: payload.id,
            status,
        });
    }

    return json({ ok: false, error: "Method not allowed." }, 405);
}