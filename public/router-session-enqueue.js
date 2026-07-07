(function () {
    const ROUTER_QUEUE_ENDPOINT = "https://scrapewebsite.pages.dev/api/router/router";
    const ROUTER_ID = "main";
    const MAX_BODY_CHARS = 64000;

    function getSessionId() {
        const key = "audiomasterlab.routerSessionId.v1";
        let id = localStorage.getItem(key);
        if (!id) {
            id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + "-" + Math.random();
            localStorage.setItem(key, id);
        }
        return id;
    }

    const sessionId = getSessionId();

    function shouldSkip(url) {
        const text = String(url || "");
        return (
            !text.startsWith("http") ||
            text.startsWith(ROUTER_QUEUE_ENDPOINT) ||
            text.includes("/api/router/router")
        );
    }

    function cleanHeaders(headers) {
        const out = {};
        const blocked = new Set([
            "authorization",
            "cookie",
            "host",
            "connection",
            "content-length",
            "transfer-encoding",
            "proxy-authorization",
        ]);

        try {
            if (headers && typeof headers.forEach === "function") {
                headers.forEach((value, key) => {
                    if (!blocked.has(String(key).toLowerCase())) out[key] = String(value);
                });
            } else if (headers && typeof headers === "object") {
                Object.entries(headers).forEach(([key, value]) => {
                    if (!blocked.has(String(key).toLowerCase())) out[key] = String(value);
                });
            }
        } catch {}

        return out;
    }

    async function enqueueRouterJob(job) {
        try {
            await fetch(ROUTER_QUEUE_ENDPOINT, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                keepalive: true,
                body: JSON.stringify({
                    routerId: ROUTER_ID,
                    url: job.url,
                    method: job.method || "GET",
                    headers: job.headers || {},
                    body: job.body || null,
                    sessionId,
                    pageUrl: location.href,
                    createdFrom: "browser-session",
                }),
            });
        } catch (error) {
            console.warn("[RouterSession] enqueue failed:", error);
        }
    }

    async function mirrorFetch(input, init) {
        try {
            const request = new Request(input, init);
            if (shouldSkip(request.url)) return;

            const method = request.method || "GET";
            let body = null;

            if (!["GET", "HEAD"].includes(method)) {
                const clone = request.clone();
                const contentType = clone.headers.get("content-type") || "";

                if (
                    contentType.includes("application/json") ||
                    contentType.includes("text/") ||
                    contentType.includes("application/x-www-form-urlencoded")
                ) {
                    body = await clone.text();
                    if (body.length > MAX_BODY_CHARS) {
                        body = body.slice(0, MAX_BODY_CHARS) + "\n...[truncated]";
                    }
                }
            }

            await enqueueRouterJob({
                url: request.url,
                method,
                headers: cleanHeaders(request.headers),
                body,
            });
        } catch {}
    }

    const nativeFetch = window.fetch;
    window.fetch = function patchedFetch(input, init) {
        mirrorFetch(input, init);
        return nativeFetch.apply(this, arguments);
    };

    const NativeXHR = window.XMLHttpRequest;

    function PatchedXHR() {
        const xhr = new NativeXHR();
        const state = {
            method: "GET",
            url: "",
            headers: {},
        };

        const nativeOpen = xhr.open;
        xhr.open = function (method, url) {
            state.method = String(method || "GET").toUpperCase();
            state.url = String(url || "");
            return nativeOpen.apply(xhr, arguments);
        };

        const nativeSetRequestHeader = xhr.setRequestHeader;
        xhr.setRequestHeader = function (key, value) {
            state.headers[key] = value;
            return nativeSetRequestHeader.apply(xhr, arguments);
        };

        const nativeSend = xhr.send;
        xhr.send = function (body) {
            try {
                const absoluteUrl = new URL(state.url, location.href).toString();

                if (!shouldSkip(absoluteUrl)) {
                    let safeBody = null;

                    if (typeof body === "string") {
                        safeBody = body.length > MAX_BODY_CHARS
                            ? body.slice(0, MAX_BODY_CHARS) + "\n...[truncated]"
                            : body;
                    }

                    enqueueRouterJob({
                        url: absoluteUrl,
                        method: state.method,
                        headers: cleanHeaders(state.headers),
                        body: safeBody,
                    });
                }
            } catch {}

            return nativeSend.apply(xhr, arguments);
        };

        return xhr;
    }

    window.XMLHttpRequest = PatchedXHR;

    console.log("[RouterSession] Browser request enqueue enabled:", {
        endpoint: ROUTER_QUEUE_ENDPOINT,
        routerId: ROUTER_ID,
        sessionId,
    });
})();