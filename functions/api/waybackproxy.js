function normalizeWaybackInput(value = "") {
    return normalizeText(value)
        .replace(/[<>"']/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 300);
}

function stripWaybackProtocol(value = "") {
    return String(value || "")
        .trim()
        .replace(/^https?:\/\//i, "")
        .replace(/^web\.archive\.org\/web\/\d+(?:id_)?\//i, "")
        .replace(/^\*\./, "")
        .replace(/\*+$/g, "")
        .trim();
}

function looksLikeFullWaybackUrl(value = "") {
    return /^https?:\/\//i.test(String(value || "").trim());
}

function clampWaybackLimit(value) {
    const limit = Number(value);
    if (!Number.isFinite(limit)) return WAYBACK_DEFAULT_LIMIT;
    return Math.min(WAYBACK_MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

function getHostnameFromWaybackInput(value = "") {
    const target = normalizeWaybackInput(value)
        .replace(/^https?:\/\/web\.archive\.org\/web\/\d+(?:id_)?\//i, "")
        .replace(/^web\.archive\.org\/web\/\d+(?:id_)?\//i, "")
        .trim();

    if (!target) return "";

    try {
        const parsedUrl = new URL(looksLikeFullWaybackUrl(target) ? target : `https://${target}`);
        return parsedUrl.hostname
            .replace(/^\*\./, "")
            .replace(/[^a-z0-9.-]/gi, "")
            .replace(/\.+$/g, "")
            .toLowerCase()
            .trim();
    } catch {
        return stripWaybackProtocol(target)
            .split(/[/?#]/)[0]
            .replace(/^\*\./, "")
            .replace(/[^a-z0-9.-]/gi, "")
            .replace(/\.+$/g, "")
            .toLowerCase()
            .trim();
    }
}

function normalizeWaybackUrlForAvailability(value = "") {
    // Domain-only for now:
    // https://archive.org/wayback/available?url=audiomasterlab.com
    return getHostnameFromWaybackInput(value);
}

function normalizeWaybackTargetForCdx(value = "", matchType = "domain") {
    const target = normalizeWaybackInput(value);
    if (!target) return "";

    if (matchType === "exact") {
        if (looksLikeFullWaybackUrl(target)) return target;

        const stripped = stripWaybackProtocol(target).replace(/\*+$/g, "");
        return stripped ? `https://${stripped}` : "";
    }

    if (matchType === "prefix") {
        const stripped = stripWaybackProtocol(target)
            .replace(/^\*\./, "")
            .replace(/\*+$/g, "")
            .trim();

        if (!stripped) return "";
        return stripped.includes("/") ? stripped : `${stripped}/`;
    }

    return getHostnameFromWaybackInput(target);
}

function buildWaybackCdxApiUrl({
    query,
    matchType = "domain",
    limit = WAYBACK_DEFAULT_LIMIT,
    onlyStatus200 = true,
    collapse = "digest",
}) {
    const safeMatchType = ["exact", "prefix", "host", "domain"].includes(matchType)
        ? matchType
        : "domain";

    const target = normalizeWaybackTargetForCdx(query, safeMatchType);
    if (!target) throw new Error("Type a domain or URL for the Wayback/CDX query first.");

    const apiUrl = new URL(WAYBACK_CDX_API_URL);
    const params = new URLSearchParams();

    params.set("url", target);
    params.set("output", "json");
    params.set("matchType", safeMatchType);
    params.set("fl", "timestamp,original,statuscode,mimetype,digest,length");
    params.set("limit", String(clampWaybackLimit(limit)));
    params.set("gzip", "false");

    if (onlyStatus200) params.append("filter", "statuscode:200");

    if (collapse && collapse !== "none") {
        params.set("collapse", collapse);
    }

    apiUrl.search = params.toString();
    return apiUrl.toString();
}

function buildWaybackAvailabilityApiUrl({ query }) {
    const target = normalizeWaybackUrlForAvailability(query);
    if (!target) throw new Error("Type a domain for the Wayback snapshot lookup first.");

    const apiUrl = new URL(WAYBACK_AVAILABLE_API_URL);

    // No timestamp, no collection, no extra params for now.
    apiUrl.searchParams.set("url", target);

    return apiUrl.toString();
}

function isWaybackProxyRequestUrl(value = "") {
    try {
        const baseUrl =
            typeof window !== "undefined"
                ? window.location.origin
                : "https://suiteofficelab.com";

        const parsedUrl = new URL(value, baseUrl);

        return WAYBACK_PROXY_ENDPOINTS.some((proxyEndpoint) => {
            const proxyUrl = new URL(proxyEndpoint, baseUrl);

            return (
                parsedUrl.hostname === proxyUrl.hostname &&
                parsedUrl.pathname === proxyUrl.pathname
            );
        });
    } catch {
        return false;
    }
}

function buildWaybackProxyRequestUrl(proxyEndpoint, targetUrl) {
    const cleanTargetUrl = String(targetUrl || "").trim();
    if (!cleanTargetUrl) return "";

    // Prevent double proxy nesting.
    if (isWaybackProxyRequestUrl(cleanTargetUrl)) {
        return cleanTargetUrl;
    }

    const baseUrl =
        typeof window !== "undefined"
            ? window.location.origin
            : "https://suiteofficelab.com";

    const proxyUrl = new URL(proxyEndpoint, baseUrl);
    proxyUrl.searchParams.set("url", cleanTargetUrl);

    return proxyUrl.toString();
}

function buildWaybackRequestAttempts(targetUrl) {
    const seen = new Set();

    const attempts = WAYBACK_PROXY_ENDPOINTS.map((proxyEndpoint, index) => ({
        url: buildWaybackProxyRequestUrl(proxyEndpoint, targetUrl),
        label:
            index === 0
                ? "scrapewebsite /api/waybackproxy"
                : "waybackproxy fallback",
    }));

    return attempts.filter((attempt) => {
        if (!attempt?.url || seen.has(attempt.url)) return false;
        seen.add(attempt.url);
        return true;
    });
}

function getPrimaryWaybackRequestUrl(targetUrl) {
    return buildWaybackRequestAttempts(targetUrl)[0]?.url || targetUrl || "";
}