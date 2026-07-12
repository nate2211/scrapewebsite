import React, { useMemo, useRef, useState } from "react";
import {
    AccountTreeRounded,
    ClearRounded,
    DataObjectRounded,
    HubRounded,
    ImageSearchRounded,
    LinkRounded,
    ManageSearchRounded,
    OpenInNewRounded,
    PlayArrowRounded,
    PublicRounded,
    SearchRounded,
    SecurityRounded,
    TravelExploreRounded,
    TuneRounded,
} from "@mui/icons-material";
import {
    Alert,
    Box,
    Button,
    Chip,
    Divider,
    FormControlLabel,
    Grid,
    MenuItem,
    Paper,
    Slider,
    Stack,
    Switch,
    TextField,
    Tooltip,
    Typography,
} from "@mui/material";
import {
    EmptyState,
    GlassCard,
    LoadingBar,
    PageShell,
    RecorderPanel,
    ScrapeResultCard,
} from "../components/components";

/*
 * Change these four paths only if your Cloudflare Pages Function filenames
 * expose different routes.
 */
const API_ENDPOINTS = {
    intelligence: "/api/query-scrape",
    search: "/api/search",
    batchScrape: "/api/batch-scrape",
    singleScrape: "/api/scrape",
};

const MAX_RENDERED_RESULTS = 200;
const BATCH_ROUTE_MAX_URLS = 5;

const scrapeOptions = [
    {
        value: "research",
        label: "Enterprise research crawl",
        helper:
            "Runs source routing, web search, recursive branch crawling, page extraction, API discovery, and static-asset discovery.",
    },
    {
        value: "product",
        label: "Product / resale intelligence",
        helper:
            "Prioritizes product pages, resale marketplaces, price strings, listing metadata, images, sellers, and related branches.",
    },
    {
        value: "links",
        label: "Link / CDN / API discovery",
        helper:
            "Prioritizes internal branches, scripts, styles, JSON files, manifests, source maps, GraphQL hints, and API-looking routes.",
    },
    {
        value: "news",
        label: "News / source briefing",
        helper:
            "Prioritizes current articles, official sources, publication metadata, headings, summaries, and related stories.",
    },
    {
        value: "quick",
        label: "Quick seed scan",
        helper:
            "Uses fewer requests and shallower extraction for titles, descriptions, top links, and basic page text.",
    },
];

const defaultSettings = {
    maxSources: 12,
    crawlDepth: 2,
    branchLimit: 6,
    includeCdn: true,
    includeExternalBranches: false,
    assetProbeLimit: 4,
    searchLimit: 12,
    scrapeUrlLimit: 20,
    singleFallbackLimit: 5,
};

const defaultPipeline = {
    useIntelligence: true,
    useSearch: true,
    useBatchScrape: true,
    useSingleFallback: true,
    useLocalHtml: true,
};

function safeList(value) {
    return Array.isArray(value) ? value : [];
}

function asNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
    return Math.min(Math.max(asNumber(value, min), min), max);
}

function normalizeHttpUrl(rawUrl, baseUrl) {
    try {
        const value = new URL(String(rawUrl || "").trim(), baseUrl);
        if (!["http:", "https:"].includes(value.protocol)) return null;
        value.hash = "";
        return value.toString();
    } catch {
        return null;
    }
}

function hostnameFromUrl(url) {
    try {
        return new URL(url).hostname;
    } catch {
        return "";
    }
}

function extractUrlsFromText(value) {
    const matches = String(value || "").match(/https?:\/\/[^\s"'<>]+/gi) || [];

    return [...new Set(matches)]
        .map((url) => url.trim().replace(/[),.;\]}]+$/, ""))
        .map((url) => normalizeHttpUrl(url))
        .filter(Boolean)
        .slice(0, 40);
}

function stripUrlsFromText(value) {
    return String(value || "")
        .replace(/https?:\/\/[^\s"'<>]+/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function selectedOptionLabel(mode) {
    return scrapeOptions.find((item) => item.value === mode)?.label || mode;
}

function shortUrl(url, max = 92) {
    const text = String(url || "");
    return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function chunkArray(items, size) {
    const chunks = [];

    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }

    return chunks;
}

function uniqueBy(items, keyBuilder) {
    const seen = new Set();
    const output = [];

    for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        const key = keyBuilder(item, index);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        output.push(item);
    }

    return output;
}

function getResultUrl(result) {
    return (
        normalizeHttpUrl(result?.url) ||
        normalizeHttpUrl(result?.data?.finalUrl) ||
        normalizeHttpUrl(result?.data?.url) ||
        normalizeHttpUrl(result?.href) ||
        null
    );
}

function resultIdentity(result, index) {
    const url = getResultUrl(result);
    if (url) return `url:${url}`;

    const title = String(result?.title || result?.data?.title || "").trim();
    const source = String(result?.source || result?.sourceLabel || "").trim();

    if (title || source) {
        return `text:${source.toLowerCase()}|${title.toLowerCase()}`;
    }

    return `index:${index}`;
}

function dedupeResults(items) {
    return uniqueBy(
        safeList(items).filter(Boolean),
        (item, index) => resultIdentity(item, index)
    );
}

function normalizeDiscoveryItems(items, type) {
    return safeList(items)
        .map((item) => {
            const url = normalizeHttpUrl(typeof item === "string" ? item : item?.url);
            if (!url) return null;

            return {
                ...(typeof item === "object" && item ? item : {}),
                url,
                type: item?.type || type,
            };
        })
        .filter(Boolean);
}

function mergeDiscoveries(...sources) {
    const merged = {
        cdn: [],
        api: [],
        branches: [],
    };

    for (const source of sources) {
        merged.cdn.push(...normalizeDiscoveryItems(source?.cdn, "cdn"));
        merged.api.push(...normalizeDiscoveryItems(source?.api, "api"));
        merged.branches.push(...normalizeDiscoveryItems(source?.branches, "branch"));
    }

    merged.cdn = uniqueBy(merged.cdn, (item) => item.url);
    merged.api = uniqueBy(merged.api, (item) => item.url);
    merged.branches = uniqueBy(merged.branches, (item) => item.url);

    return merged;
}

function collectCandidateUrls({
                                  explicitUrls,
                                  searchData,
                                  intelligenceData,
                                  limit,
                              }) {
    const candidates = [];
    const seen = new Set();

    function add(rawUrl, origin, priority = 50) {
        const url = normalizeHttpUrl(rawUrl);
        if (!url || seen.has(url)) return;

        seen.add(url);
        candidates.push({
            url,
            origin,
            priority,
            hostname: hostnameFromUrl(url),
        });
    }

    explicitUrls.forEach((url) => add(url, "explicit", 100));

    safeList(searchData?.results).forEach((result) => {
        add(result?.url, "search", 90 - asNumber(result?.rank, 0));
    });

    safeList(intelligenceData?.results).forEach((result) => {
        add(getResultUrl(result), "intelligence-result", 80);
    });

    normalizeDiscoveryItems(intelligenceData?.discovered?.branches, "branch").forEach(
        (item) => add(item.url, "discovered-branch", 70)
    );

    return candidates
        .sort((left, right) => right.priority - left.priority)
        .slice(0, clamp(limit, 1, 50));
}

function normalizeSearchResults(data) {
    return safeList(data?.results).map((result, index) => ({
        ...result,
        ok: true,
        rank: result?.rank || index + 1,
        source: result?.source || "brave",
        sourceLabel: "Brave Search",
        type: "search-result",
        hostname: result?.hostname || hostnameFromUrl(result?.url),
    }));
}

function normalizeScrapeResults(data, sourceLabel, source) {
    return safeList(data?.results).map((result) => ({
        ...result,
        source: result?.source || source,
        sourceLabel: result?.sourceLabel || sourceLabel,
        type: result?.type || (result?.data ? "scraped-page" : "scrape-error"),
    }));
}

function cleanText(value = "") {
    return String(value)
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/\s+/g, " ")
        .trim();
}

function uniqueStrings(items, limit = 200) {
    return [...new Set(items.map((item) => String(item || "").trim()).filter(Boolean))].slice(
        0,
        limit
    );
}

function analyzeHtmlLocally({
                                html,
                                baseUrl = "https://example.com",
                                query = "",
                            }) {
    const source = String(html || "");
    const parser = new DOMParser();
    const documentNode = parser.parseFromString(source, "text/html");
    const bodyText = cleanText(documentNode.body?.textContent || source);

    const readMeta = (...selectors) => {
        for (const selector of selectors) {
            const value = documentNode.querySelector(selector)?.getAttribute("content");
            if (value) return cleanText(value);
        }
        return "";
    };

    const title =
        cleanText(documentNode.querySelector("title")?.textContent || "") ||
        readMeta('meta[property="og:title"]', 'meta[name="twitter:title"]') ||
        "Untitled HTML";

    const description = readMeta(
        'meta[name="description"]',
        'meta[property="og:description"]',
        'meta[name="twitter:description"]'
    );

    const canonicalUrl =
        normalizeHttpUrl(
            documentNode.querySelector('link[rel="canonical"]')?.getAttribute("href"),
            baseUrl
        ) || normalizeHttpUrl(baseUrl) || baseUrl;

    const headings = [...documentNode.querySelectorAll("h1, h2, h3, h4")]
        .map((element) => ({
            level: Number(element.tagName.slice(1)),
            text: cleanText(element.textContent).slice(0, 300),
        }))
        .filter((item) => item.text)
        .slice(0, 120);

    const links = [...documentNode.querySelectorAll("a[href]")]
        .map((element) => {
            const href = normalizeHttpUrl(element.getAttribute("href"), canonicalUrl);
            if (!href) return null;

            return {
                href,
                text: cleanText(element.textContent).slice(0, 220),
                rel: element.getAttribute("rel") || "",
                target: element.getAttribute("target") || "",
            };
        })
        .filter(Boolean)
        .slice(0, 300);

    const images = [...documentNode.querySelectorAll("img")]
        .map((element) => {
            const rawSource =
                element.getAttribute("src") ||
                element.getAttribute("data-src") ||
                element.getAttribute("data-lazy-src");

            const src = normalizeHttpUrl(rawSource, canonicalUrl);
            if (!src) return null;

            return {
                src,
                alt: cleanText(element.getAttribute("alt") || ""),
                width: asNumber(element.getAttribute("width"), null),
                height: asNumber(element.getAttribute("height"), null),
            };
        })
        .filter(Boolean)
        .slice(0, 200);

    const scripts = [...documentNode.querySelectorAll("script[src]")]
        .map((element) => normalizeHttpUrl(element.getAttribute("src"), canonicalUrl))
        .filter(Boolean);

    const stylesheets = [...documentNode.querySelectorAll('link[rel="stylesheet"][href]')]
        .map((element) => normalizeHttpUrl(element.getAttribute("href"), canonicalUrl))
        .filter(Boolean);

    const jsonLd = [...documentNode.querySelectorAll('script[type="application/ld+json"]')]
        .map((element) => {
            const raw = element.textContent?.trim();
            if (!raw) return null;

            try {
                return JSON.parse(raw);
            } catch {
                return {
                    parseError: true,
                    raw: raw.slice(0, 3000),
                };
            }
        })
        .filter(Boolean)
        .slice(0, 40);

    const forms = [...documentNode.querySelectorAll("form")]
        .map((form) => ({
            action:
                normalizeHttpUrl(form.getAttribute("action"), canonicalUrl) || canonicalUrl,
            method: String(form.getAttribute("method") || "get").toUpperCase(),
            fields: [...form.querySelectorAll("input, select, textarea, button")]
                .map((field) => ({
                    tag: field.tagName.toLowerCase(),
                    type: field.getAttribute("type") || "",
                    name: field.getAttribute("name") || "",
                    value: field.getAttribute("value") || "",
                }))
                .slice(0, 50),
        }))
        .slice(0, 30);

    const sourceUrls =
        source.match(/https?:\/\/[^\s"'<>\\]+/gi) || [];

    const relativeApiPaths =
        source.match(
            /\/(?:api|graphql|rest|wp-json|v\d+|search|products|items|listings|query|feed|ajax)[^\s"'<>\\)]*/gi
        ) || [];

    const apiCandidates = uniqueStrings(
        [...sourceUrls, ...relativeApiPaths]
            .map((item) => normalizeHttpUrl(item, canonicalUrl))
            .filter(
                (url) =>
                    /\/api\/|graphql|wp-json|\/v\d+\/|search|products|items|listings|query|ajax/i.test(
                        url || ""
                    )
            ),
        200
    );

    const cdnCandidates = uniqueStrings(
        [...scripts, ...stylesheets, ...images.map((item) => item.src), ...sourceUrls]
            .map((item) => normalizeHttpUrl(item, canonicalUrl))
            .filter(
                (url) =>
                    /cdn|static|assets|_next|webpack|chunk|bundle|\.js(?:\?|$)|\.css(?:\?|$)|\.json(?:\?|$)|\.map(?:\?|$)/i.test(
                        url || ""
                    )
            ),
        200
    );

    const prices = uniqueStrings(
        source.match(
            /(?:\$|USD\s?|US\$|€|EUR\s?|£|GBP\s?|¥|JPY\s?)\s?\d{1,9}(?:,\d{3})*(?:\.\d{1,2})?/gi
        ) || [],
        100
    );

    const emails = uniqueStrings(
        bodyText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [],
        50
    );

    const queryWords = String(query || "")
        .toLowerCase()
        .split(/\s+/)
        .map((word) => word.replace(/[^\p{L}\p{N}_-]/gu, ""))
        .filter((word) => word.length > 2);

    const lowerText = bodyText.toLowerCase();
    const matchedQueryWords = queryWords.filter((word) => lowerText.includes(word));
    const queryScore = matchedQueryWords.length;

    return {
        ok: true,
        source: "local-html",
        sourceLabel: "Local HTML analyzer",
        type: "local-html",
        data: {
            url: canonicalUrl,
            finalUrl: canonicalUrl,
            status: "local-html",
            contentType: "text/html",
            title,
            description,
            wordCount: bodyText
                ? bodyText.split(/\s+/).filter(Boolean).length
                : 0,
            queryScore,
            matchedQueryWords,
            mode: "local",
            headings,
            links,
            images,
            prices,
            emails,
            forms,
            scripts: uniqueStrings(scripts, 200),
            stylesheets: uniqueStrings(stylesheets, 100),
            apiCandidates,
            cdnCandidates,
            jsonLd,
            textPreview: bodyText.slice(0, 12000),
            localOnly: true,
        },
        discovered: {
            cdn: cdnCandidates.map((url) => ({ url, type: "local-cdn" })),
            api: apiCandidates.map((url) => ({ url, type: "local-api" })),
            branches: links
                .filter((item) => hostnameFromUrl(item.href) === hostnameFromUrl(canonicalUrl))
                .slice(0, 100)
                .map((item) => ({ url: item.href, type: "local-branch" })),
        },
        timestamp: new Date().toISOString(),
    };
}

async function requestJson(url, options = {}) {
    const response = await fetch(url, options);
    const rawText = await response.text();

    let data = {};

    if (rawText) {
        try {
            data = JSON.parse(rawText);
        } catch {
            throw new Error(
                `${url} returned non-JSON data (${response.status}). ${rawText
                    .slice(0, 180)
                    .replace(/\s+/g, " ")}`
            );
        }
    }

    if (!response.ok || data?.ok === false) {
        throw new Error(
            data?.error ||
            data?.message ||
            `${url} failed with HTTP ${response.status}.`
        );
    }

    return data;
}

function postJson(url, body, signal) {
    return requestJson(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal,
    });
}

function stageLabel(status) {
    if (status === "running") return "Running";
    if (status === "success") return "Complete";
    if (status === "warning") return "Warning";
    if (status === "error") return "Failed";
    if (status === "cancelled") return "Cancelled";
    return "Waiting";
}

function stageColor(status) {
    if (status === "success") return "success";
    if (status === "warning") return "warning";
    if (status === "error") return "error";
    if (status === "running") return "secondary";
    return "default";
}

export default function Scrape() {
    const [query, setQuery] = useState("");
    const [mode, setMode] = useState("research");
    const [settings, setSettings] = useState(defaultSettings);
    const [pipeline, setPipeline] = useState(defaultPipeline);
    const [localHtml, setLocalHtml] = useState("");
    const [localBaseUrl, setLocalBaseUrl] = useState("https://example.com");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");
    const [results, setResults] = useState([]);
    const [responseMeta, setResponseMeta] = useState(null);
    const [pipelineStages, setPipelineStages] = useState([]);
    const [visibleLimit, setVisibleLimit] = useState(40);

    const abortControllerRef = useRef(null);

    const extractedUrls = useMemo(() => extractUrlsFromText(query), [query]);
    const searchQuery = useMemo(() => stripUrlsFromText(query), [query]);

    const activeOption = useMemo(() => {
        return scrapeOptions.find((item) => item.value === mode) || scrapeOptions[0];
    }, [mode]);

    const selectedSources = safeList(responseMeta?.selectedSources);
    const intents = safeList(responseMeta?.intents);
    const metrics = responseMeta?.metrics || {};
    const discovered = responseMeta?.discovered || {};
    const renderedResults = results.slice(0, visibleLimit);

    function updateSetting(key, value) {
        setSettings((current) => ({
            ...current,
            [key]: value,
        }));
    }

    function updatePipeline(key, value) {
        setPipeline((current) => ({
            ...current,
            [key]: value,
        }));
    }

    function updateStage(id, patch) {
        setPipelineStages((current) => {
            const index = current.findIndex((stage) => stage.id === id);

            if (index === -1) {
                return [
                    ...current,
                    {
                        id,
                        label: id,
                        status: "waiting",
                        detail: "",
                        ...patch,
                    },
                ];
            }

            return current.map((stage) =>
                stage.id === id ? { ...stage, ...patch } : stage
            );
        });
    }

    function cancelScrape() {
        abortControllerRef.current?.abort();
    }

    async function loadHtmlFile(file) {
        if (!file) return;

        try {
            const text = await file.text();
            setLocalHtml(text);

            if (!localBaseUrl || localBaseUrl === "https://example.com") {
                setLocalBaseUrl(`https://${file.name.replace(/\.[^.]+$/, "")}.local/`);
            }

            setMessage(`Loaded ${file.name} for local HTML analysis.`);
        } catch (fileError) {
            setError(fileError.message || "Could not read the selected HTML file.");
        }
    }

    async function startScrape() {
        setError("");
        setMessage("");
        setVisibleLimit(40);

        const cleanedQuery = query.trim();
        const hasLocalHtml = pipeline.useLocalHtml && localHtml.trim();

        if (!cleanedQuery && !hasLocalHtml) {
            setError("Enter a query, URL, or local HTML source first.");
            return;
        }

        abortControllerRef.current?.abort();

        const controller = new AbortController();
        abortControllerRef.current = controller;

        const startedAt = Date.now();
        const collectedResults = [];
        const warnings = [];
        const stageMetrics = {
            searchResults: 0,
            intelligenceResults: 0,
            batchPages: 0,
            singleFallbackPages: 0,
            localHtmlPages: 0,
        };

        let intelligenceData = null;
        let searchData = null;
        let localData = null;

        setLoading(true);
        setPipelineStages([]);

        try {
            if (hasLocalHtml) {
                updateStage("local", {
                    label: "Local HTML analysis",
                    status: "running",
                    detail: "Parsing supplied HTML without a network request.",
                });

                try {
                    localData = analyzeHtmlLocally({
                        html: localHtml,
                        baseUrl: localBaseUrl,
                        query: cleanedQuery,
                    });

                    collectedResults.push(localData);
                    stageMetrics.localHtmlPages = 1;

                    updateStage("local", {
                        status: "success",
                        detail: `${localData.data.wordCount} words, ${localData.data.links.length} links, ${localData.data.apiCandidates.length} API hints.`,
                    });
                } catch (localError) {
                    warnings.push(`Local HTML analysis failed: ${localError.message}`);
                    updateStage("local", {
                        status: "error",
                        detail: localError.message || "Local analysis failed.",
                    });
                }
            }

            const parallelStages = [];

            if (pipeline.useIntelligence && cleanedQuery) {
                updateStage("intelligence", {
                    label: "Recursive intelligence crawl",
                    status: "running",
                    detail: `Requesting depth ${settings.crawlDepth} with ${settings.branchLimit} branches per page.`,
                });

                parallelStages.push(
                    postJson(
                        API_ENDPOINTS.intelligence,
                        {
                            query: cleanedQuery,
                            mode,
                            urls: extractedUrls,
                            maxSources: clamp(settings.maxSources, 1, 30),
                            crawlDepth: clamp(settings.crawlDepth, 0, 8),
                            branchLimit: clamp(settings.branchLimit, 0, 20),
                            includeCdn: Boolean(settings.includeCdn),
                            includeExternalBranches: Boolean(
                                settings.includeExternalBranches
                            ),
                            assetProbeLimit: clamp(settings.assetProbeLimit, 0, 12),
                        },
                        controller.signal
                    )
                        .then((data) => {
                            intelligenceData = data;
                            const normalized = safeList(data?.results).map((result) => ({
                                ...result,
                                source:
                                    result?.source ||
                                    result?.sourceId ||
                                    "query-scrape",
                                sourceLabel:
                                    result?.sourceLabel ||
                                    result?.label ||
                                    "Intelligence crawl",
                            }));

                            collectedResults.push(...normalized);
                            stageMetrics.intelligenceResults = normalized.length;

                            updateStage("intelligence", {
                                status: "success",
                                detail: `${normalized.length} results and ${
                                    safeList(data?.discovered?.branches).length
                                } branch candidates.`,
                            });
                        })
                        .catch((stageError) => {
                            if (stageError.name === "AbortError") throw stageError;

                            warnings.push(
                                `Recursive intelligence crawl failed: ${stageError.message}`
                            );

                            updateStage("intelligence", {
                                status: "error",
                                detail: stageError.message,
                            });
                        })
                );
            }

            if (pipeline.useSearch && searchQuery) {
                updateStage("search", {
                    label: "Brave seed search",
                    status: "running",
                    detail: `Finding up to ${settings.searchLimit} seed pages.`,
                });

                parallelStages.push(
                    postJson(
                        API_ENDPOINTS.search,
                        {
                            query: searchQuery,
                            limit: clamp(settings.searchLimit, 1, 20),
                        },
                        controller.signal
                    )
                        .then((data) => {
                            searchData = data;
                            const normalized = normalizeSearchResults(data);

                            collectedResults.push(...normalized);
                            stageMetrics.searchResults = normalized.length;

                            updateStage("search", {
                                status: "success",
                                detail: `${normalized.length} search results from ${
                                    data.provider || "search provider"
                                }.`,
                            });
                        })
                        .catch((stageError) => {
                            if (stageError.name === "AbortError") throw stageError;

                            warnings.push(`Search failed: ${stageError.message}`);

                            updateStage("search", {
                                status: "error",
                                detail: stageError.message,
                            });
                        })
                );
            } else if (pipeline.useSearch && cleanedQuery && !searchQuery) {
                updateStage("search", {
                    label: "Brave seed search",
                    status: "warning",
                    detail: "Skipped because the input contains only direct URLs.",
                });
            }

            await Promise.all(parallelStages);

            const candidateUrls = collectCandidateUrls({
                explicitUrls: extractedUrls,
                searchData,
                intelligenceData,
                limit: settings.scrapeUrlLimit,
            });

            const batchFailures = [];

            if (pipeline.useBatchScrape && candidateUrls.length > 0) {
                const batches = chunkArray(
                    candidateUrls.map((item) => item.url),
                    BATCH_ROUTE_MAX_URLS
                );

                updateStage("batch", {
                    label: "Batch page extraction",
                    status: "running",
                    detail: `${candidateUrls.length} URLs in ${batches.length} request group${
                        batches.length === 1 ? "" : "s"
                    }.`,
                });

                let successfulBatchPages = 0;
                let failedBatchPages = 0;

                for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
                    const urls = batches[batchIndex];

                    try {
                        const data = await postJson(
                            API_ENDPOINTS.batchScrape,
                            {
                                urls,
                                query: cleanedQuery,
                                mode,
                            },
                            controller.signal
                        );

                        const normalized = normalizeScrapeResults(
                            data,
                            "Batch page scrape",
                            "batch-scrape"
                        );

                        collectedResults.push(...normalized);

                        normalized.forEach((result) => {
                            if (result?.ok === false) {
                                failedBatchPages += 1;
                                const failedUrl = normalizeHttpUrl(result?.url);
                                if (failedUrl) batchFailures.push(failedUrl);
                            } else {
                                successfulBatchPages += 1;
                            }
                        });

                        updateStage("batch", {
                            status: "running",
                            detail: `Completed group ${batchIndex + 1}/${
                                batches.length
                            }: ${successfulBatchPages} pages extracted, ${failedBatchPages} failed.`,
                        });
                    } catch (batchError) {
                        if (batchError.name === "AbortError") throw batchError;

                        failedBatchPages += urls.length;
                        batchFailures.push(...urls);

                        warnings.push(
                            `Batch group ${batchIndex + 1} failed: ${batchError.message}`
                        );
                    }
                }

                stageMetrics.batchPages = successfulBatchPages;

                updateStage("batch", {
                    status: failedBatchPages > 0 ? "warning" : "success",
                    detail: `${successfulBatchPages} pages extracted; ${failedBatchPages} queued for possible fallback.`,
                });
            } else if (pipeline.useBatchScrape) {
                updateStage("batch", {
                    label: "Batch page extraction",
                    status: "warning",
                    detail: "No valid seed or discovered URLs were available.",
                });
            }

            if (pipeline.useSingleFallback) {
                const fallbackUrls = uniqueStrings(
                    batchFailures.length > 0
                        ? batchFailures
                        : !pipeline.useBatchScrape
                            ? candidateUrls.map((item) => item.url)
                            : [],
                    clamp(settings.singleFallbackLimit, 0, 12)
                );

                if (fallbackUrls.length > 0) {
                    updateStage("single", {
                        label: "Single-page fallback",
                        status: "running",
                        detail: `Retrying ${fallbackUrls.length} page${
                            fallbackUrls.length === 1 ? "" : "s"
                        } individually.`,
                    });

                    let successfulFallbacks = 0;
                    let failedFallbacks = 0;

                    const fallbackSettled = await Promise.allSettled(
                        fallbackUrls.map((url) =>
                            postJson(
                                API_ENDPOINTS.singleScrape,
                                {
                                    url,
                                    query: cleanedQuery,
                                    mode,
                                },
                                controller.signal
                            )
                        )
                    );

                    fallbackSettled.forEach((settled, index) => {
                        const url = fallbackUrls[index];

                        if (settled.status === "fulfilled") {
                            successfulFallbacks += 1;
                            collectedResults.push({
                                ...settled.value,
                                source: "single-scrape",
                                sourceLabel: "Single-page fallback",
                                type: "scraped-page",
                            });
                        } else {
                            if (settled.reason?.name === "AbortError") {
                                throw settled.reason;
                            }

                            failedFallbacks += 1;
                            collectedResults.push({
                                ok: false,
                                url,
                                source: "single-scrape",
                                sourceLabel: "Single-page fallback",
                                type: "scrape-error",
                                error:
                                    settled.reason?.message ||
                                    "Single-page scrape failed.",
                            });
                        }
                    });

                    stageMetrics.singleFallbackPages = successfulFallbacks;

                    updateStage("single", {
                        status: failedFallbacks > 0 ? "warning" : "success",
                        detail: `${successfulFallbacks} fallback pages extracted; ${failedFallbacks} failed.`,
                    });
                } else {
                    updateStage("single", {
                        label: "Single-page fallback",
                        status: "success",
                        detail: "No failed or unprocessed pages required a fallback request.",
                    });
                }
            }

            const mergedDiscovery = mergeDiscoveries(
                intelligenceData?.discovered,
                localData?.discovered
            );

            const finalResults = dedupeResults(collectedResults).slice(
                0,
                MAX_RENDERED_RESULTS
            );

            const finalMeta = {
                ...(intelligenceData || {}),
                ok: true,
                query: cleanedQuery,
                mode,
                provider: searchData?.provider || intelligenceData?.provider || null,
                requestId:
                    intelligenceData?.requestId ||
                    `client-${Date.now().toString(36)}`,
                selectedSources: safeList(intelligenceData?.selectedSources),
                intents: safeList(intelligenceData?.intents),
                discovered: mergedDiscovery,
                warnings: [
                    ...safeList(intelligenceData?.warnings),
                    ...warnings,
                ],
                metrics: {
                    ...(intelligenceData?.metrics || {}),
                    ...stageMetrics,
                    totalResults: finalResults.length,
                    candidateUrls: collectCandidateUrls({
                        explicitUrls: extractedUrls,
                        searchData,
                        intelligenceData,
                        limit: settings.scrapeUrlLimit,
                    }).length,
                    cdnLinks: mergedDiscovery.cdn.length,
                    apiHints: mergedDiscovery.api.length,
                    branchCandidates: mergedDiscovery.branches.length,
                },
                elapsedMs: Date.now() - startedAt,
            };

            setResults(finalResults);
            setResponseMeta(finalMeta);

            setMessage(
                `Finished ${selectedOptionLabel(
                    mode
                ).toLowerCase()}: ${finalResults.length} unique results across the enabled API stages.`
            );
        } catch (runError) {
            if (runError.name === "AbortError") {
                setMessage("The crawl was cancelled.");
                setPipelineStages((current) =>
                    current.map((stage) =>
                        stage.status === "running"
                            ? { ...stage, status: "cancelled", detail: "Cancelled by user." }
                            : stage
                    )
                );
            } else {
                setError(runError.message || "Intelligence crawl failed.");
            }
        } finally {
            if (abortControllerRef.current === controller) {
                abortControllerRef.current = null;
            }

            setLoading(false);
        }
    }

    function clearAll() {
        abortControllerRef.current?.abort();
        setQuery("");
        setError("");
        setMessage("");
        setResults([]);
        setResponseMeta(null);
        setPipelineStages([]);
        setSettings(defaultSettings);
        setPipeline(defaultPipeline);
        setLocalHtml("");
        setLocalBaseUrl("https://example.com");
        setVisibleLimit(40);
    }

    return (
        <PageShell
            eyebrow="Enterprise source intelligence"
            title="Search, crawl, branch, scrape, retry, and inspect."
            description="This page coordinates every scraper route: Brave seed search, recursive query crawling, batch extraction, single-page fallback, and local HTML analysis."
            actions={
                <Stack direction="row" spacing={1}>
                    {loading && (
                        <Button
                            variant="outlined"
                            color="warning"
                            startIcon={<ClearRounded />}
                            onClick={cancelScrape}
                        >
                            Cancel
                        </Button>
                    )}

                    <Button
                        variant="outlined"
                        startIcon={<ClearRounded />}
                        onClick={clearAll}
                        disabled={loading && results.length === 0}
                    >
                        Clear
                    </Button>
                </Stack>
            }
        >
            <Grid container spacing={2.5}>
                <Grid item xs={12} lg={5}>
                    <Stack spacing={2.5}>
                        <GlassCard>
                            <Stack spacing={2.5}>
                                <Stack spacing={0.8}>
                                    <Typography variant="h5" fontWeight={900}>
                                        Start an advanced intelligence crawl
                                    </Typography>

                                    <Typography color="text.secondary">
                                        Paste direct URLs, enter a normal search query, load raw HTML, or combine all three. The enabled stages feed discovered URLs into the later stages.
                                    </Typography>
                                </Stack>

                                <TextField
                                    label="Query, product, topic, source, or URL"
                                    value={query}
                                    onChange={(event) => setQuery(event.target.value)}
                                    fullWidth
                                    multiline
                                    minRows={4}
                                    placeholder={
                                        "Examples:\nraf simons hoodie resale mercari japan grailed\nlatest spacecraft launch reports\nhttps://example.com/article\nFind hidden APIs, bundles, and JSON routes"
                                    }
                                />

                                <TextField
                                    label="Scrape mode"
                                    value={mode}
                                    onChange={(event) => setMode(event.target.value)}
                                    select
                                    fullWidth
                                    InputProps={{
                                        startAdornment: (
                                            <TuneRounded
                                                fontSize="small"
                                                sx={{ mr: 1, color: "text.secondary" }}
                                            />
                                        ),
                                    }}
                                >
                                    {scrapeOptions.map((item) => (
                                        <MenuItem key={item.value} value={item.value}>
                                            {item.label}
                                        </MenuItem>
                                    ))}
                                </TextField>

                                <Paper
                                    elevation={0}
                                    sx={{
                                        p: 2,
                                        borderRadius: 4,
                                        background: "rgba(2, 6, 23, 0.42)",
                                        border:
                                            "1px solid rgba(148, 163, 184, 0.12)",
                                    }}
                                >
                                    <Stack spacing={1.2}>
                                        <Stack
                                            direction="row"
                                            spacing={1}
                                            alignItems="center"
                                            flexWrap="wrap"
                                            useFlexGap
                                        >
                                            <Chip
                                                size="small"
                                                color="secondary"
                                                icon={<SearchRounded />}
                                                label={activeOption.label}
                                            />
                                            <Chip
                                                size="small"
                                                variant="outlined"
                                                icon={<AccountTreeRounded />}
                                                label={`Depth ${settings.crawlDepth}`}
                                            />
                                            <Chip
                                                size="small"
                                                variant="outlined"
                                                icon={<HubRounded />}
                                                label={`${settings.branchLimit} branches/page`}
                                            />
                                            <Chip
                                                size="small"
                                                variant="outlined"
                                                label={`${settings.scrapeUrlLimit} page scrape limit`}
                                            />
                                            {extractedUrls.length > 0 && (
                                                <Chip
                                                    size="small"
                                                    color="success"
                                                    label={`${extractedUrls.length} direct URL${
                                                        extractedUrls.length === 1
                                                            ? ""
                                                            : "s"
                                                    }`}
                                                />
                                            )}
                                        </Stack>

                                        <Typography
                                            variant="body2"
                                            color="text.secondary"
                                        >
                                            {activeOption.helper}
                                        </Typography>
                                    </Stack>
                                </Paper>

                                <PipelineControls
                                    pipeline={pipeline}
                                    updatePipeline={updatePipeline}
                                    loading={loading}
                                    hasSearchQuery={Boolean(searchQuery)}
                                />

                                <CrawlerControls
                                    settings={settings}
                                    updateSetting={updateSetting}
                                    loading={loading}
                                />

                                <LocalHtmlPanel
                                    localHtml={localHtml}
                                    setLocalHtml={setLocalHtml}
                                    localBaseUrl={localBaseUrl}
                                    setLocalBaseUrl={setLocalBaseUrl}
                                    onFile={loadHtmlFile}
                                    loading={loading}
                                    enabled={pipeline.useLocalHtml}
                                />

                                <Button
                                    size="large"
                                    variant="contained"
                                    startIcon={<PlayArrowRounded />}
                                    onClick={startScrape}
                                    disabled={
                                        loading ||
                                        (!query.trim() &&
                                            !(
                                                pipeline.useLocalHtml &&
                                                localHtml.trim()
                                            ))
                                    }
                                    sx={{ minHeight: 54, fontSize: "1rem" }}
                                >
                                    {loading
                                        ? "Running multi-stage crawl..."
                                        : "Start Full Intelligence Crawl"}
                                </Button>

                                <LoadingBar loading={loading} />

                                {error && <Alert severity="error">{error}</Alert>}
                                {message && !error && (
                                    <Alert severity="success">{message}</Alert>
                                )}

                                <Alert severity="info" icon={<SecurityRounded />}>
                                    The crawler follows only public HTTP/HTTPS pages. It does not bypass authentication, paywalls, robots enforcement, anti-bot challenges, or private network restrictions.
                                </Alert>
                            </Stack>
                        </GlassCard>

                        <RecorderPanel compact />
                    </Stack>
                </Grid>

                <Grid item xs={12} lg={7}>
                    <Stack spacing={2.5}>
                        <GlassCard>
                            <Stack spacing={2}>
                                <Stack
                                    direction={{ xs: "column", md: "row" }}
                                    alignItems={{
                                        xs: "flex-start",
                                        md: "center",
                                    }}
                                    justifyContent="space-between"
                                    spacing={1}
                                >
                                    <Stack spacing={0.5}>
                                        <Typography variant="h5" fontWeight={900}>
                                            Intelligence results
                                        </Typography>

                                        <Typography color="text.secondary">
                                            Search results, recursively crawled pages, batch extracts, single-page retries, local HTML data, CDN assets, and API hints appear together.
                                        </Typography>
                                    </Stack>

                                    <Chip
                                        icon={<ManageSearchRounded />}
                                        label={`${results.length} unique result${
                                            results.length === 1 ? "" : "s"
                                        }`}
                                        variant="outlined"
                                    />
                                </Stack>

                                <Divider />

                                {pipelineStages.length > 0 && (
                                    <PipelineStatusPanel stages={pipelineStages} />
                                )}

                                {responseMeta && (
                                    <ResponseSummary
                                        responseMeta={responseMeta}
                                        metrics={metrics}
                                        intents={intents}
                                        selectedSources={selectedSources}
                                    />
                                )}

                                {safeList(discovered.cdn).length > 0 ||
                                safeList(discovered.api).length > 0 ||
                                safeList(discovered.branches).length > 0 ? (
                                    <DiscoveryPanel discovered={discovered} />
                                ) : null}

                                {safeList(responseMeta?.warnings).length > 0 && (
                                    <Alert severity="warning">
                                        {responseMeta.warnings.join(" ")}
                                    </Alert>
                                )}

                                {results.length === 0 ? (
                                    <EmptyState
                                        icon={<TravelExploreRounded />}
                                        title="No crawl results yet"
                                        description="Enter a query or URL, optionally load HTML, choose the API stages, tune depth, and start the crawl."
                                    />
                                ) : (
                                    <Stack spacing={2}>
                                        {renderedResults.map((result, index) => (
                                            <EnterpriseResultCard
                                                key={`${resultIdentity(
                                                    result,
                                                    index
                                                )}-${index}`}
                                                result={result}
                                            />
                                        ))}

                                        {visibleLimit < results.length && (
                                            <Button
                                                variant="outlined"
                                                onClick={() =>
                                                    setVisibleLimit((current) =>
                                                        Math.min(
                                                            current + 40,
                                                            results.length
                                                        )
                                                    )
                                                }
                                            >
                                                Show 40 more results
                                            </Button>
                                        )}
                                    </Stack>
                                )}
                            </Stack>
                        </GlassCard>
                    </Stack>
                </Grid>
            </Grid>
        </PageShell>
    );
}

function PipelineControls({
                              pipeline,
                              updatePipeline,
                              loading,
                              hasSearchQuery,
                          }) {
    return (
        <Paper
            elevation={0}
            sx={{
                p: 2,
                borderRadius: 4,
                background: "rgba(15, 23, 42, 0.58)",
                border: "1px solid rgba(148, 163, 184, 0.12)",
            }}
        >
            <Stack spacing={1.5}>
                <Stack direction="row" alignItems="center" spacing={1}>
                    <AccountTreeRounded color="secondary" />
                    <Stack>
                        <Typography fontWeight={900}>API pipeline</Typography>
                        <Typography variant="body2" color="text.secondary">
                            Each enabled stage contributes results or feeds URLs into the next stage.
                        </Typography>
                    </Stack>
                </Stack>

                <FormControlLabel
                    control={
                        <Switch
                            checked={pipeline.useIntelligence}
                            disabled={loading}
                            onChange={(event) =>
                                updatePipeline(
                                    "useIntelligence",
                                    event.target.checked
                                )
                            }
                        />
                    }
                    label="Recursive /api/query-scrape crawl"
                />

                <FormControlLabel
                    control={
                        <Switch
                            checked={pipeline.useSearch}
                            disabled={loading}
                            onChange={(event) =>
                                updatePipeline("useSearch", event.target.checked)
                            }
                        />
                    }
                    label={`Brave /api/search seed discovery${
                        hasSearchQuery ? "" : " (needs non-URL query text)"
                    }`}
                />

                <FormControlLabel
                    control={
                        <Switch
                            checked={pipeline.useBatchScrape}
                            disabled={loading}
                            onChange={(event) =>
                                updatePipeline(
                                    "useBatchScrape",
                                    event.target.checked
                                )
                            }
                        />
                    }
                    label="Chunked /api/batch-scrape extraction"
                />

                <FormControlLabel
                    control={
                        <Switch
                            checked={pipeline.useSingleFallback}
                            disabled={loading}
                            onChange={(event) =>
                                updatePipeline(
                                    "useSingleFallback",
                                    event.target.checked
                                )
                            }
                        />
                    }
                    label="Retry failed pages through /api/scrape"
                />

                <FormControlLabel
                    control={
                        <Switch
                            checked={pipeline.useLocalHtml}
                            disabled={loading}
                            onChange={(event) =>
                                updatePipeline(
                                    "useLocalHtml",
                                    event.target.checked
                                )
                            }
                        />
                    }
                    label="Analyze pasted/uploaded HTML locally"
                />
            </Stack>
        </Paper>
    );
}

function CrawlerControls({ settings, updateSetting, loading }) {
    return (
        <Paper
            elevation={0}
            sx={{
                p: 2,
                borderRadius: 4,
                background: "rgba(15, 23, 42, 0.58)",
                border: "1px solid rgba(148, 163, 184, 0.12)",
            }}
        >
            <Stack spacing={2.2}>
                <Stack
                    direction="row"
                    alignItems="center"
                    justifyContent="space-between"
                    spacing={1}
                >
                    <Stack spacing={0.3}>
                        <Typography fontWeight={900}>Crawler controls</Typography>
                        <Typography variant="body2" color="text.secondary">
                            Higher depth and branch limits create more requests. The server route must permit the requested depth.
                        </Typography>
                    </Stack>
                    <TuneRounded color="secondary" />
                </Stack>

                <NumberSlider
                    label="Maximum routed sources"
                    value={settings.maxSources}
                    min={1}
                    max={24}
                    disabled={loading}
                    onChange={(value) => updateSetting("maxSources", value)}
                />

                <NumberSlider
                    label="Recursive branch depth"
                    value={settings.crawlDepth}
                    min={0}
                    max={4}
                    disabled={loading}
                    marks={[
                        { value: 0, label: "Seed" },
                        { value: 1, label: "Branch" },
                        { value: 2, label: "Deep" },
                        { value: 4, label: "Max" },
                    ]}
                    onChange={(value) => updateSetting("crawlDepth", value)}
                />

                <NumberSlider
                    label="Branches followed per page"
                    value={settings.branchLimit}
                    min={0}
                    max={12}
                    disabled={loading}
                    onChange={(value) => updateSetting("branchLimit", value)}
                />

                <NumberSlider
                    label="Brave search seeds"
                    value={settings.searchLimit}
                    min={1}
                    max={20}
                    disabled={loading}
                    onChange={(value) => updateSetting("searchLimit", value)}
                />

                <NumberSlider
                    label="URLs sent to page extraction"
                    value={settings.scrapeUrlLimit}
                    min={1}
                    max={40}
                    disabled={loading}
                    onChange={(value) => updateSetting("scrapeUrlLimit", value)}
                />

                <NumberSlider
                    label="Single-page fallback retries"
                    value={settings.singleFallbackLimit}
                    min={0}
                    max={12}
                    disabled={loading}
                    onChange={(value) =>
                        updateSetting("singleFallbackLimit", value)
                    }
                />

                <NumberSlider
                    label="CDN JS/CSS/JSON probes"
                    value={settings.assetProbeLimit}
                    min={0}
                    max={10}
                    disabled={loading || !settings.includeCdn}
                    onChange={(value) => updateSetting("assetProbeLimit", value)}
                />

                <Stack spacing={0.5}>
                    <FormControlLabel
                        control={
                            <Switch
                                checked={settings.includeCdn}
                                disabled={loading}
                                onChange={(event) =>
                                    updateSetting(
                                        "includeCdn",
                                        event.target.checked
                                    )
                                }
                            />
                        }
                        label="Hunt CDN/static asset links"
                    />
                    <FormControlLabel
                        control={
                            <Switch
                                checked={settings.includeExternalBranches}
                                disabled={loading}
                                onChange={(event) =>
                                    updateSetting(
                                        "includeExternalBranches",
                                        event.target.checked
                                    )
                                }
                            />
                        }
                        label="Allow external page branching"
                    />
                </Stack>
            </Stack>
        </Paper>
    );
}

function NumberSlider({
                          label,
                          value,
                          min,
                          max,
                          disabled,
                          marks,
                          onChange,
                      }) {
    return (
        <Box>
            <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
            >
                <Typography variant="body2" fontWeight={800}>
                    {label}
                </Typography>
                <Chip size="small" label={value} />
            </Stack>

            <Slider
                value={value}
                min={min}
                max={max}
                step={1}
                disabled={disabled}
                marks={marks}
                onChange={(_, nextValue) =>
                    onChange(Array.isArray(nextValue) ? nextValue[0] : nextValue)
                }
            />
        </Box>
    );
}

function LocalHtmlPanel({
                            localHtml,
                            setLocalHtml,
                            localBaseUrl,
                            setLocalBaseUrl,
                            onFile,
                            loading,
                            enabled,
                        }) {
    return (
        <Paper
            elevation={0}
            sx={{
                p: 2,
                borderRadius: 4,
                background: "rgba(15, 23, 42, 0.58)",
                border: "1px solid rgba(148, 163, 184, 0.12)",
                opacity: enabled ? 1 : 0.65,
            }}
        >
            <Stack spacing={1.5}>
                <Stack
                    direction={{ xs: "column", sm: "row" }}
                    justifyContent="space-between"
                    alignItems={{ xs: "stretch", sm: "center" }}
                    spacing={1}
                >
                    <Stack>
                        <Typography fontWeight={900}>Local HTML analyzer</Typography>
                        <Typography variant="body2" color="text.secondary">
                            Parses HTML already in your browser and extracts structured data, forms, links, assets, prices, and API candidates.
                        </Typography>
                    </Stack>

                    <Button
                        component="label"
                        variant="outlined"
                        disabled={loading || !enabled}
                        startIcon={<DataObjectRounded />}
                    >
                        Load HTML file
                        <input
                            hidden
                            type="file"
                            accept=".html,.htm,.txt,text/html,text/plain"
                            onChange={(event) => {
                                const file = event.target.files?.[0];
                                onFile(file);
                                event.target.value = "";
                            }}
                        />
                    </Button>
                </Stack>

                <TextField
                    label="Base URL for relative links"
                    value={localBaseUrl}
                    onChange={(event) => setLocalBaseUrl(event.target.value)}
                    fullWidth
                    size="small"
                    disabled={loading || !enabled}
                />

                <TextField
                    label="Paste raw HTML"
                    value={localHtml}
                    onChange={(event) => setLocalHtml(event.target.value)}
                    fullWidth
                    multiline
                    minRows={4}
                    maxRows={12}
                    disabled={loading || !enabled}
                    placeholder="<html>...</html>"
                />

                {localHtml && (
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                        <Chip
                            size="small"
                            label={`${localHtml.length.toLocaleString()} characters`}
                            variant="outlined"
                        />
                        <Button
                            size="small"
                            onClick={() => setLocalHtml("")}
                            disabled={loading}
                        >
                            Clear HTML
                        </Button>
                    </Stack>
                )}
            </Stack>
        </Paper>
    );
}

function PipelineStatusPanel({ stages }) {
    return (
        <Paper
            elevation={0}
            sx={{
                p: 2,
                borderRadius: 4,
                background: "rgba(2, 6, 23, 0.42)",
                border: "1px solid rgba(148, 163, 184, 0.12)",
            }}
        >
            <Stack spacing={1.2}>
                <Stack direction="row" spacing={1} alignItems="center">
                    <HubRounded color="secondary" />
                    <Typography fontWeight={950}>Pipeline status</Typography>
                </Stack>

                {stages.map((stage) => (
                    <Stack
                        key={stage.id}
                        direction={{ xs: "column", sm: "row" }}
                        spacing={1}
                        alignItems={{ xs: "flex-start", sm: "center" }}
                        justifyContent="space-between"
                        sx={{
                            p: 1.2,
                            borderRadius: 2.5,
                            background: "rgba(15, 23, 42, 0.55)",
                        }}
                    >
                        <Stack spacing={0.2}>
                            <Typography variant="body2" fontWeight={900}>
                                {stage.label}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                                {stage.detail}
                            </Typography>
                        </Stack>

                        <Chip
                            size="small"
                            label={stageLabel(stage.status)}
                            color={stageColor(stage.status)}
                            variant={
                                stage.status === "running" ? "filled" : "outlined"
                            }
                        />
                    </Stack>
                ))}
            </Stack>
        </Paper>
    );
}

function ResponseSummary({ responseMeta, metrics, intents, selectedSources }) {
    return (
        <Paper
            elevation={0}
            sx={{
                p: 2,
                borderRadius: 4,
                background: "rgba(2, 6, 23, 0.42)",
                border: "1px solid rgba(148, 163, 184, 0.12)",
            }}
        >
            <Stack spacing={2}>
                <Grid container spacing={1.2}>
                    <Grid item xs={6} md={3}>
                        <MetricCard
                            icon={<PublicRounded />}
                            label="Search seeds"
                            value={metrics.searchResults || 0}
                        />
                    </Grid>
                    <Grid item xs={6} md={3}>
                        <MetricCard
                            icon={<AccountTreeRounded />}
                            label="Intelligence"
                            value={metrics.intelligenceResults || 0}
                        />
                    </Grid>
                    <Grid item xs={6} md={3}>
                        <MetricCard
                            icon={<ImageSearchRounded />}
                            label="Batch pages"
                            value={metrics.batchPages || 0}
                        />
                    </Grid>
                    <Grid item xs={6} md={3}>
                        <MetricCard
                            icon={<DataObjectRounded />}
                            label="API hints"
                            value={metrics.apiHints || 0}
                        />
                    </Grid>
                </Grid>

                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    {intents.map((intent) => (
                        <Chip
                            key={intent}
                            size="small"
                            label={intent}
                            color="secondary"
                            variant="outlined"
                        />
                    ))}
                    <Chip
                        size="small"
                        label={`${responseMeta.elapsedMs || 0} ms`}
                        variant="outlined"
                    />
                    <Chip
                        size="small"
                        label={`${metrics.totalResults || 0} unique results`}
                        variant="outlined"
                    />
                    <Chip
                        size="small"
                        label={`${metrics.candidateUrls || 0} candidate URLs`}
                        variant="outlined"
                    />
                    <Chip
                        size="small"
                        label={responseMeta.requestId || "request"}
                        variant="outlined"
                    />
                </Stack>

                {selectedSources.length > 0 && (
                    <Stack spacing={1}>
                        <Typography
                            variant="body2"
                            color="text.secondary"
                            fontWeight={800}
                        >
                            Selected official/source-specific routes
                        </Typography>
                        <Stack
                            direction="row"
                            spacing={1}
                            flexWrap="wrap"
                            useFlexGap
                        >
                            {selectedSources.map((source) => (
                                <Tooltip
                                    key={source.id || source.label}
                                    title={`${source.group || "source"} • score ${
                                        source.score ?? "n/a"
                                    }`}
                                >
                                    <Chip
                                        size="small"
                                        label={source.label || source.id}
                                        variant="outlined"
                                    />
                                </Tooltip>
                            ))}
                        </Stack>
                    </Stack>
                )}
            </Stack>
        </Paper>
    );
}

function MetricCard({ icon, label, value }) {
    return (
        <Paper
            elevation={0}
            sx={{
                p: 1.5,
                borderRadius: 3,
                background: "rgba(15, 23, 42, 0.66)",
                minHeight: 86,
            }}
        >
            <Stack spacing={0.6}>
                <Box sx={{ color: "secondary.main" }}>{icon}</Box>
                <Typography variant="h6" fontWeight={950} lineHeight={1}>
                    {value}
                </Typography>
                <Typography
                    variant="caption"
                    color="text.secondary"
                    fontWeight={800}
                >
                    {label}
                </Typography>
            </Stack>
        </Paper>
    );
}

function DiscoveryPanel({ discovered }) {
    return (
        <Paper
            elevation={0}
            sx={{
                p: 2,
                borderRadius: 4,
                background: "rgba(15, 23, 42, 0.5)",
                border: "1px solid rgba(148, 163, 184, 0.12)",
            }}
        >
            <Stack spacing={2}>
                <Stack direction="row" spacing={1} alignItems="center">
                    <HubRounded color="secondary" />
                    <Typography fontWeight={950}>
                        Discovered crawl intelligence
                    </Typography>
                </Stack>

                <DiscoveryList
                    title="CDN / static assets"
                    icon={<ImageSearchRounded />}
                    items={safeList(discovered.cdn)}
                    empty="No CDN/static assets found."
                />

                <DiscoveryList
                    title="API-looking hints"
                    icon={<DataObjectRounded />}
                    items={safeList(discovered.api)}
                    empty="No API-looking routes found."
                />

                <DiscoveryList
                    title="Branch candidates"
                    icon={<AccountTreeRounded />}
                    items={safeList(discovered.branches)}
                    empty="No branch candidates found."
                />
            </Stack>
        </Paper>
    );
}

function DiscoveryList({ title, icon, items, empty }) {
    const visible = items.slice(0, 12);

    return (
        <Stack spacing={1}>
            <Stack direction="row" spacing={1} alignItems="center">
                <Box sx={{ color: "text.secondary", display: "flex" }}>{icon}</Box>
                <Typography variant="body2" fontWeight={900}>
                    {title}
                </Typography>
                <Chip size="small" label={items.length} variant="outlined" />
            </Stack>

            {visible.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                    {empty}
                </Typography>
            ) : (
                <Stack spacing={0.7}>
                    {visible.map((item, index) => {
                        const url = normalizeHttpUrl(
                            typeof item === "string" ? item : item?.url
                        );

                        if (!url) return null;

                        return (
                            <Stack
                                key={`${url}-${index}`}
                                direction="row"
                                spacing={1}
                                alignItems="center"
                                justifyContent="space-between"
                                sx={{
                                    px: 1.2,
                                    py: 0.85,
                                    borderRadius: 2,
                                    background: "rgba(2, 6, 23, 0.42)",
                                }}
                            >
                                <Typography
                                    variant="caption"
                                    color="text.secondary"
                                    sx={{ wordBreak: "break-all" }}
                                >
                                    {shortUrl(url)}
                                </Typography>
                                <Button
                                    href={url}
                                    target="_blank"
                                    rel="noreferrer"
                                    size="small"
                                    endIcon={<OpenInNewRounded />}
                                >
                                    Open
                                </Button>
                            </Stack>
                        );
                    })}
                </Stack>
            )}
        </Stack>
    );
}

function EnterpriseResultCard({ result }) {
    if (result?.data) {
        return <ScrapeResultCard result={result} />;
    }

    const isError = result?.ok === false;

    return (
        <Paper
            elevation={0}
            sx={{
                p: 2.2,
                borderRadius: 5,
                background: "rgba(2, 6, 23, 0.42)",
                border: "1px solid rgba(148, 163, 184, 0.12)",
            }}
        >
            <Stack spacing={1.5}>
                <Stack
                    direction={{ xs: "column", md: "row" }}
                    alignItems={{ xs: "flex-start", md: "center" }}
                    justifyContent="space-between"
                    spacing={1}
                >
                    <Stack spacing={0.4}>
                        <Stack
                            direction="row"
                            spacing={1}
                            alignItems="center"
                            flexWrap="wrap"
                            useFlexGap
                        >
                            <Chip
                                size="small"
                                label={
                                    result?.sourceLabel ||
                                    result?.source ||
                                    "Source"
                                }
                                color={isError ? "error" : "secondary"}
                            />
                            <Chip
                                size="small"
                                label={result?.type || "result"}
                                variant="outlined"
                            />
                            {result?.rank && (
                                <Chip
                                    size="small"
                                    label={`#${result.rank}`}
                                    variant="outlined"
                                />
                            )}
                        </Stack>

                        <Typography variant="h6" fontWeight={950}>
                            {result?.title || result?.url || "Untitled result"}
                        </Typography>

                        {result?.hostname && (
                            <Typography variant="body2" color="text.secondary">
                                {result.hostname}
                            </Typography>
                        )}
                    </Stack>

                    {result?.url && (
                        <Button
                            href={result.url}
                            target="_blank"
                            rel="noreferrer"
                            variant="outlined"
                            size="small"
                            endIcon={<OpenInNewRounded />}
                        >
                            Open
                        </Button>
                    )}
                </Stack>

                {result?.description && (
                    <Typography color="text.secondary">
                        {result.description}
                    </Typography>
                )}

                {result?.error && (
                    <Alert severity="warning">{result.error}</Alert>
                )}

                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    {result?.age && (
                        <Chip size="small" label={result.age} variant="outlined" />
                    )}
                    {result?.price && (
                        <Chip size="small" label={result.price} color="success" />
                    )}
                    {result?.condition && (
                        <Chip
                            size="small"
                            label={result.condition}
                            variant="outlined"
                        />
                    )}
                    {result?.seller && (
                        <Chip
                            size="small"
                            label={`Seller: ${result.seller}`}
                            variant="outlined"
                        />
                    )}
                    {result?.stars !== undefined && (
                        <Chip
                            size="small"
                            label={`${result.stars} stars`}
                            variant="outlined"
                        />
                    )}
                    {result?.language && (
                        <Chip
                            size="small"
                            label={result.language}
                            variant="outlined"
                        />
                    )}
                    {result?.comments !== undefined && (
                        <Chip
                            size="small"
                            label={`${result.comments} comments`}
                            variant="outlined"
                        />
                    )}
                    {result?.subreddit && (
                        <Chip
                            size="small"
                            label={`r/${result.subreddit}`}
                            variant="outlined"
                        />
                    )}
                </Stack>

                {result?.image && (
                    <Box
                        component="img"
                        src={result.image}
                        alt={result.title || "Result"}
                        loading="lazy"
                        sx={{
                            width: "100%",
                            maxHeight: 260,
                            objectFit: "cover",
                            borderRadius: 4,
                            border: "1px solid rgba(148, 163, 184, 0.18)",
                        }}
                    />
                )}

                {result?.url && (
                    <Stack direction="row" spacing={1} alignItems="center">
                        <LinkRounded fontSize="small" color="disabled" />
                        <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ wordBreak: "break-all" }}
                        >
                            {result.url}
                        </Typography>
                    </Stack>
                )}
            </Stack>
        </Paper>
    );
}
