import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    ApiRounded,
    AutoAwesomeRounded,
    CancelRounded,
    CheckBoxOutlineBlankRounded,
    CheckBoxRounded,
    ClearRounded,
    CompareArrowsRounded,
    ContentCopyRounded,
    DataObjectRounded,
    DownloadRounded,
    HubRounded,
    ImageRounded,
    LanguageRounded,
    MemoryRounded,
    OpenInNewRounded,
    PlayArrowRounded,
    PublicRounded,
    SearchRounded,
    SecurityRounded,
    SmartToyRounded,
    StorageRounded,
    VideoLibraryRounded,
} from "@mui/icons-material";
import {
    Alert,
    Box,
    Button,
    Checkbox,
    Chip,
    CircularProgress,
    Divider,
    FormControlLabel,
    Grid,
    IconButton,
    LinearProgress,
    MenuItem,
    Paper,
    Stack,
    Switch,
    Tab,
    Tabs,
    TextField,
    Tooltip,
    Typography,
} from "@mui/material";

import {
    EmptyState,
    GlassCard,
    PageShell,
    RecorderPanel,
} from "../components/components";
import {
    buildAssistantContext,
    buildQueryUrl,
    compareRecords,
    downloadJson,
    mergeResearchPayloads,
    parseLineList,
    parseUrlList,
    postJson,
    uniqueStrings,
} from "../utils/browserResearch";
import {
    askBrowserModel,
    DEFAULT_BROWSER_MODEL,
    getBrowserModelCapabilities,
    getLoadedBrowserModel,
    loadBrowserModel,
    unloadBrowserModel,
} from "../utils/browserModel";

const STORAGE_KEY = "scrapewebsite.browser.workspace.v1";
const MAX_SEED_URLS = 6;
const MAX_QUERY_RUNS = 12;
const MAX_SELECTED_RESOURCES = 8;

const DEFAULT_SETTINGS = {
    mode: "product",
    renderStrategy: "both",
    crawlDepth: 1,
    branchLimit: 4,
    assetProbeLimit: 4,
    includeCdn: true,
    includeApiProbes: true,
    probeBodies: true,
    maxCandidates: 40,
    maxProbes: 12,
    queryParameter: "q",
};

const LIVE_BROWSER_CHANNEL = "scrapewebsite-live-browser-v1";

const DEFAULT_LAB_HTML = `
<main class="lesson-shell">
  <section class="hero-card">
    <p class="eyebrow">Interactive browser lesson</p>
    <h1>HTML, CSS, and JavaScript working together</h1>
    <p class="intro">
      Edit the source panels, press Run, then turn on Learning Mode and point at any element.
    </p>

    <div class="lesson-grid">
      <article class="demo-card">
        <h2>Event handling</h2>
        <p>A JavaScript click listener updates this value without reloading the page.</p>
        <button id="countButton" type="button">
          Clicked <strong id="countValue">0</strong> times
        </button>
      </article>

      <article class="demo-card">
        <h2>Form state</h2>
        <form id="profileForm">
          <label for="nameInput">Your name</label>
          <input id="nameInput" name="name" placeholder="Type a name" autocomplete="off" />
          <button type="submit">Create greeting</button>
        </form>
        <p id="greeting" class="result" aria-live="polite">The result will appear here.</p>
      </article>

      <article class="demo-card wide">
        <h2>DOM mutation</h2>
        <p>JavaScript can create and remove elements after the document has rendered.</p>
        <div class="row">
          <button id="addCardButton" type="button">Add a card</button>
          <button id="clearCardsButton" type="button" class="secondary">Clear cards</button>
        </div>
        <div id="dynamicCards" class="dynamic-grid"></div>
      </article>
    </div>
  </section>
</main>`;

const DEFAULT_LAB_CSS = `
:root {
  color-scheme: dark;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #07101f;
  color: #e8f1ff;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  background:
    radial-gradient(circle at 15% 5%, rgba(124, 58, 237, .30), transparent 34rem),
    radial-gradient(circle at 90% 15%, rgba(34, 211, 238, .20), transparent 30rem),
    #07101f;
}
button, input { font: inherit; }
.lesson-shell { padding: clamp(20px, 5vw, 64px); }
.hero-card {
  max-width: 1100px;
  margin: 0 auto;
  padding: clamp(22px, 4vw, 54px);
  border: 1px solid rgba(148, 163, 184, .20);
  border-radius: 30px;
  background: rgba(15, 23, 42, .82);
  box-shadow: 0 28px 90px rgba(0, 0, 0, .32);
  backdrop-filter: blur(22px);
}
.eyebrow {
  margin: 0 0 10px;
  color: #67e8f9;
  font-weight: 900;
  letter-spacing: .14em;
  text-transform: uppercase;
  font-size: 12px;
}
h1 { margin: 0; font-size: clamp(34px, 6vw, 68px); line-height: .98; letter-spacing: -.055em; }
.intro { max-width: 760px; color: #b8c6db; font-size: 18px; line-height: 1.7; }
.lesson-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; margin-top: 28px; }
.demo-card {
  padding: 22px;
  border: 1px solid rgba(148, 163, 184, .18);
  border-radius: 22px;
  background: rgba(2, 6, 23, .62);
}
.demo-card.wide { grid-column: 1 / -1; }
.demo-card h2 { margin-top: 0; }
.demo-card p { color: #aebdd2; line-height: 1.6; }
button {
  min-height: 44px;
  padding: 10px 16px;
  border: 0;
  border-radius: 13px;
  cursor: pointer;
  color: white;
  font-weight: 850;
  background: linear-gradient(135deg, #7c3aed, #5b21b6);
  box-shadow: 0 10px 30px rgba(124, 58, 237, .22);
}
button:hover { transform: translateY(-1px); filter: brightness(1.08); }
button.secondary { background: rgba(148, 163, 184, .18); box-shadow: none; }
label { display: block; margin-bottom: 7px; color: #dce7f7; font-weight: 750; }
input {
  width: 100%;
  min-height: 44px;
  margin-bottom: 12px;
  padding: 10px 13px;
  border: 1px solid rgba(148, 163, 184, .30);
  border-radius: 13px;
  background: rgba(15, 23, 42, .88);
  color: white;
}
.result { min-height: 28px; color: #67e8f9 !important; font-weight: 750; }
.row { display: flex; gap: 10px; flex-wrap: wrap; }
.dynamic-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; margin-top: 16px; }
.dynamic-item { padding: 16px; border-radius: 16px; background: rgba(34, 211, 238, .11); border: 1px solid rgba(34, 211, 238, .28); }
@media (max-width: 720px) {
  .lesson-grid { grid-template-columns: 1fr; }
  .demo-card.wide { grid-column: auto; }
}`;

const DEFAULT_LAB_JS = `
(() => {
  let clicks = 0;
  let cardNumber = 0;

  const countButton = document.getElementById("countButton");
  const countValue = document.getElementById("countValue");
  countButton?.addEventListener("click", () => {
    clicks += 1;
    countValue.textContent = String(clicks);
    console.log("Counter changed", { clicks });
  });

  document.getElementById("profileForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const name = String(formData.get("name") || "").trim();
    const greeting = document.getElementById("greeting");
    greeting.textContent = name ? "Hello, " + name + "!" : "Enter a name first.";
    console.info("Form submitted", { name });
  });

  document.getElementById("addCardButton")?.addEventListener("click", () => {
    cardNumber += 1;
    const card = document.createElement("div");
    card.className = "dynamic-item";
    card.innerHTML = "<strong>Card " + cardNumber + "</strong><br><span>Added with JavaScript</span>";
    document.getElementById("dynamicCards")?.appendChild(card);
  });

  document.getElementById("clearCardsButton")?.addEventListener("click", () => {
    document.getElementById("dynamicCards")?.replaceChildren();
    console.warn("Dynamic cards cleared");
  });
})();`;

const LEARNING_EXAMPLES = [
    {
        id: "events",
        title: "Events and forms",
        description: "A counter, form submission, and DOM mutation example.",
        html: DEFAULT_LAB_HTML,
        css: DEFAULT_LAB_CSS,
        javascript: DEFAULT_LAB_JS,
    },
    {
        id: "filter",
        title: "Live filtering",
        description: "Input events filter a rendered product list.",
        html: `
<main class="catalog">
  <header>
    <p class="eyebrow">Interactive lesson</p>
    <h1>Live product filter</h1>
    <label for="filterInput">Filter products</label>
    <input id="filterInput" placeholder="Try: jacket" autocomplete="off" />
    <p id="resultCount" aria-live="polite"></p>
  </header>
  <section id="productGrid" class="product-grid">
    <article data-search="vintage leather jacket black"><h2>Vintage leather jacket</h2><p>$120</p></article>
    <article data-search="running shoes white blue"><h2>Running shoes</h2><p>$64</p></article>
    <article data-search="graphic t shirt red"><h2>Graphic T-shirt</h2><p>$35</p></article>
    <article data-search="denim jacket blue"><h2>Denim jacket</h2><p>$78</p></article>
  </section>
</main>`,
        css: `
:root { color-scheme: dark; font-family: Inter, system-ui, sans-serif; background: #06101c; color: white; }
* { box-sizing: border-box; }
body { margin: 0; padding: 40px; background: linear-gradient(145deg, #07111f, #111827); min-height: 100vh; }
.catalog { max-width: 960px; margin: auto; }
.eyebrow { color: #22d3ee; font-weight: 900; text-transform: uppercase; letter-spacing: .14em; }
h1 { font-size: clamp(36px, 7vw, 72px); margin: 0 0 24px; letter-spacing: -.06em; }
label { display: block; margin-bottom: 8px; font-weight: 800; }
input { width: 100%; padding: 14px; border-radius: 14px; border: 1px solid #334155; background: #0f172a; color: white; font: inherit; }
.product-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 14px; margin-top: 24px; }
article { padding: 20px; border-radius: 18px; border: 1px solid #334155; background: rgba(15, 23, 42, .82); transition: .2s ease; }
article.hidden { display: none; }
article:hover { transform: translateY(-3px); border-color: #22d3ee; }
article p { color: #67e8f9; font-weight: 900; }`,
        javascript: `
(() => {
  const input = document.getElementById("filterInput");
  const cards = [...document.querySelectorAll("[data-search]")];
  const resultCount = document.getElementById("resultCount");
  const update = () => {
    const query = input.value.trim().toLowerCase();
    let shown = 0;
    cards.forEach((card) => {
      const matches = !query || card.dataset.search.includes(query);
      card.classList.toggle("hidden", !matches);
      if (matches) shown += 1;
    });
    resultCount.textContent = shown + " matching products";
    console.log("Filter updated", { query, shown });
  };
  input.addEventListener("input", update);
  update();
})();`,
    },
    {
        id: "async",
        title: "Async loading states",
        description: "A simulated API task shows loading, success, and error handling.",
        html: `
<main class="async-demo">
  <p class="eyebrow">Interactive lesson</p>
  <h1>Async request lifecycle</h1>
  <p>Press the button to simulate a delayed API response.</p>
  <div class="actions">
    <button id="loadButton" type="button">Load records</button>
    <button id="errorButton" type="button" class="secondary">Simulate error</button>
  </div>
  <div id="status" role="status">Idle</div>
  <pre id="output">[]</pre>
</main>`,
        css: `
:root { color-scheme: dark; font-family: Inter, system-ui, sans-serif; background: #090716; color: #f8fafc; }
body { margin: 0; padding: clamp(24px, 7vw, 80px); min-height: 100vh; background: radial-gradient(circle at top, #312e81, #090716 58%); }
.async-demo { max-width: 820px; margin: auto; padding: 34px; border-radius: 28px; background: rgba(15,23,42,.84); border: 1px solid rgba(148,163,184,.22); }
.eyebrow { color: #a5b4fc; font-weight: 900; text-transform: uppercase; letter-spacing: .14em; }
h1 { font-size: clamp(38px, 7vw, 70px); letter-spacing: -.06em; margin: 0; }
.actions { display: flex; gap: 10px; flex-wrap: wrap; margin: 24px 0; }
button { padding: 12px 18px; border: 0; border-radius: 14px; color: white; background: #7c3aed; font: inherit; font-weight: 850; cursor: pointer; }
button.secondary { background: #334155; }
button:disabled { opacity: .55; cursor: wait; }
#status { margin-bottom: 12px; color: #c4b5fd; font-weight: 800; }
pre { min-height: 160px; overflow: auto; padding: 18px; border-radius: 18px; background: #020617; border: 1px solid #334155; }`,
        javascript: `
(() => {
  const loadButton = document.getElementById("loadButton");
  const errorButton = document.getElementById("errorButton");
  const status = document.getElementById("status");
  const output = document.getElementById("output");

  async function run(shouldFail) {
    loadButton.disabled = true;
    errorButton.disabled = true;
    status.textContent = "Loading…";
    output.textContent = "[]";
    console.time("simulated-request");
    try {
      await new Promise((resolve) => setTimeout(resolve, 900));
      if (shouldFail) throw new Error("The simulated endpoint returned HTTP 500");
      const records = [
        { id: 1, title: "Rendered HTML" },
        { id: 2, title: "Captured API call" },
        { id: 3, title: "Discovered CDN image" }
      ];
      output.textContent = JSON.stringify(records, null, 2);
      status.textContent = "Completed successfully";
      console.table(records);
    } catch (error) {
      status.textContent = "Request failed";
      output.textContent = error.stack || error.message;
      console.error(error);
    } finally {
      console.timeEnd("simulated-request");
      loadButton.disabled = false;
      errorButton.disabled = false;
    }
  }

  loadButton.addEventListener("click", () => run(false));
  errorButton.addEventListener("click", () => run(true));
})();`,
    },
];


const EMPTY_WORKSPACE = {
    pages: [],
    resources: [],
    byKind: {
        api: [],
        image: [],
        audio: [],
        video: [],
        manifest: [],
        page: [],
        asset: [],
        link: [],
        cdn: [],
    },
    warnings: [],
    rawPayloads: [],
    comparison: null,
    selectedResources: [],
    seedUrls: [],
    queries: [],
    instruction: "",
    generatedAt: null,
};

function restoreState() {
    if (typeof window === "undefined") return null;
    try {
        const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null");
        return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
        return null;
    }
}

function saveState(value) {
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch {
        // Storage may be disabled or full.
    }
}

function statusText(error) {
    if (error?.name === "AbortError") return "The operation was cancelled.";
    return error?.message || "The operation failed.";
}

export default function Browser() {
    const restored = useMemo(() => restoreState(), []);
    const [instruction, setInstruction] = useState(
        restored?.instruction ||
        "Cross-examine listing details, prices, images, seller claims, structured data, API responses, and media assets. Separate direct evidence from assumptions."
    );
    const [urlInput, setUrlInput] = useState(
        restored?.urlInput ||
        "https://www.depop.com/\nhttps://www.grailed.com/"
    );
    const [queryInput, setQueryInput] = useState(
        restored?.queryInput ||
        "brand and model\nexact product title\nstyle code\nrecent sold prices"
    );
    const [queryTemplate, setQueryTemplate] = useState(
        restored?.queryTemplate || "https://example.com/search?q={query}"
    );
    const [settings, setSettings] = useState({
        ...DEFAULT_SETTINGS,
        ...(restored?.settings || {}),
    });
    const [workspace, setWorkspace] = useState({
        ...EMPTY_WORKSPACE,
        ...(restored?.workspace || {}),
        selectedResources: [],
    });
    const [selectedUrls, setSelectedUrls] = useState(new Set());
    const [activeTab, setActiveTab] = useState("preview");
    const [activePageUrl, setActivePageUrl] = useState("");
    const [resourceFilter, setResourceFilter] = useState("all");
    const [loading, setLoading] = useState(false);
    const [loadingLabel, setLoadingLabel] = useState("");
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");
    const [queryRuns, setQueryRuns] = useState(restored?.queryRuns || []);
    const [chatInput, setChatInput] = useState("");
    const [chatMessages, setChatMessages] = useState(
        restored?.chatMessages || [
            {
                role: "assistant",
                content:
                    "Load one or more pages, then ask me about listing evidence, prices, API responses, images, media, CDNs, or differences between sites.",
                source: "workspace-summary",
            },
        ]
    );
    const [chatBusy, setChatBusy] = useState(false);
    const [modelStatus, setModelStatus] = useState(() => ({
        ...getLoadedBrowserModel(),
        progress: 0,
        text: "",
        error: "",
    }));
    const abortRef = useRef(null);

    const seedUrls = useMemo(() => parseUrlList(urlInput, MAX_SEED_URLS), [urlInput]);
    const queryList = useMemo(() => parseLineList(queryInput, MAX_QUERY_RUNS), [queryInput]);
    const activePage = useMemo(() => {
        if (!workspace.pages.length) return null;
        return workspace.pages.find((item) => item.url === activePageUrl) || workspace.pages[0];
    }, [activePageUrl, workspace.pages]);

    const filteredResources = useMemo(() => {
        const source = workspace.resources || [];
        if (resourceFilter === "all") return source;
        if (resourceFilter === "cdn") return source.filter((item) => item.isCdn);
        if (resourceFilter === "media") {
            return source.filter((item) => ["audio", "video", "manifest"].includes(item.kind));
        }
        return source.filter((item) => item.kind === resourceFilter);
    }, [resourceFilter, workspace.resources]);

    const selectedResources = useMemo(() => {
        return (workspace.resources || []).filter((item) => selectedUrls.has(item.url));
    }, [selectedUrls, workspace.resources]);

    const capabilities = useMemo(() => getBrowserModelCapabilities(), []);

    useEffect(() => {
        const snapshot = {
            instruction,
            urlInput,
            queryInput,
            queryTemplate,
            settings,
            workspace: {
                ...workspace,
                rawPayloads: [],
                selectedResources: [],
            },
            queryRuns,
            chatMessages: chatMessages.slice(-30),
        };
        const timer = window.setTimeout(() => saveState(snapshot), 400);
        return () => window.clearTimeout(timer);
    }, [chatMessages, instruction, queryInput, queryRuns, queryTemplate, settings, urlInput, workspace]);

    useEffect(() => {
        if (!activePageUrl && workspace.pages?.[0]?.url) {
            setActivePageUrl(workspace.pages[0].url);
        }
    }, [activePageUrl, workspace.pages]);

    useEffect(() => {
        return () => abortRef.current?.abort();
    }, []);

    function updateSetting(name, value) {
        setSettings((current) => ({ ...current, [name]: value }));
    }

    function beginOperation(label) {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        setLoading(true);
        setLoadingLabel(label);
        setProgress(0);
        setError("");
        setMessage("");
        return controller;
    }

    function finishOperation() {
        setLoading(false);
        setLoadingLabel("");
        setProgress(100);
        abortRef.current = null;
    }

    async function runResearch() {
        if (!seedUrls.length) {
            setError("Enter at least one complete public http:// or https:// URL.");
            return;
        }

        const controller = beginOperation("Starting browser research workspace…");
        const payloads = [];
        const warnings = [];
        const stagesPerUrl =
            (settings.renderStrategy !== "rendered" ? 1 : 0) +
            (settings.renderStrategy !== "static" ? 1 : 0) +
            (settings.includeApiProbes ? 1 : 0);
        const totalStages = Math.max(1, seedUrls.length * stagesPerUrl);
        let completedStages = 0;

        try {
            for (let index = 0; index < seedUrls.length; index += 1) {
                const url = seedUrls[index];
                const host = new URL(url).hostname;

                if (settings.renderStrategy !== "rendered") {
                    setLoadingLabel(`Crawling ${host} through /api/query-scrape…`);
                    try {
                        payloads.push(
                            await postJson(
                                "/api/query-scrape",
                                {
                                    query: `${instruction}\n${url}`,
                                    mode: settings.mode,
                                    urls: [url],
                                    maxSources: 6,
                                    crawlDepth: settings.crawlDepth,
                                    branchLimit: settings.branchLimit,
                                    includeCdn: settings.includeCdn,
                                    includeExternalBranches: false,
                                    assetProbeLimit: settings.assetProbeLimit,
                                },
                                controller.signal
                            )
                        );
                    } catch (stageError) {
                        if (stageError.name === "AbortError") throw stageError;
                        warnings.push(`${host} static crawl: ${statusText(stageError)}`);
                    }
                    completedStages += 1;
                    setProgress(Math.round((completedStages / totalStages) * 100));
                }

                if (settings.renderStrategy !== "static") {
                    setLoadingLabel(`Rendering JavaScript, CSS, DOM, and network activity for ${host}…`);
                    try {
                        payloads.push(
                            await postJson(
                                "/api/browser-render",
                                {
                                    url,
                                    instruction,
                                    waitUntil: "networkidle2",
                                    timeoutMs: 24_000,
                                    settleMs: 1_200,
                                    includeScreenshot: true,
                                    captureResponseBodies: true,
                                    includeShadowDom: true,
                                    includeReactLinks: true,
                                    probeApis: settings.includeApiProbes,
                                    maxProbes: settings.maxProbes,
                                    sameOriginProbesOnly: true,
                                },
                                controller.signal
                            )
                        );
                    } catch (stageError) {
                        if (stageError.name === "AbortError") throw stageError;
                        warnings.push(`${host} rendered crawl: ${statusText(stageError)}`);
                    }
                    completedStages += 1;
                    setProgress(Math.round((completedStages / totalStages) * 100));
                }

                if (settings.includeApiProbes) {
                    setLoadingLabel(`Discovering bounded public GET/HEAD API candidates for ${host}…`);
                    try {
                        payloads.push(
                            await postJson(
                                "/api/api-scrape",
                                {
                                    sourceUrl: url,
                                    urls: [],
                                    maxCandidates: settings.maxCandidates,
                                    maxProbes: settings.maxProbes,
                                    assetProbeLimit: settings.assetProbeLimit,
                                    probeBodies: settings.probeBodies,
                                },
                                controller.signal
                            )
                        );
                    } catch (stageError) {
                        if (stageError.name === "AbortError") throw stageError;
                        warnings.push(`${host} API discovery: ${statusText(stageError)}`);
                    }
                    completedStages += 1;
                    setProgress(Math.round((completedStages / totalStages) * 100));
                }
            }

            const merged = mergeResearchPayloads(payloads);
            const comparison = compareRecords(merged.pages);
            const nextWorkspace = {
                ...merged,
                warnings: uniqueStrings([...merged.warnings, ...warnings], 100),
                comparison,
                selectedResources: [],
                seedUrls,
                queries: queryList,
                instruction,
            };

            setWorkspace(nextWorkspace);
            setSelectedUrls(new Set());
            setActivePageUrl(nextWorkspace.pages?.[0]?.url || "");
            setActiveTab("preview");
            setMessage(
                `Loaded ${nextWorkspace.pages.length} page records and classified ${nextWorkspace.resources.length} links, APIs, images, media files, manifests, and assets.`
            );
        } catch (operationError) {
            setError(statusText(operationError));
        } finally {
            finishOperation();
        }
    }

    async function runQueryMatrix() {
        if (!queryTemplate.trim()) {
            setError("Enter a URL template or URL that accepts a query parameter.");
            return;
        }
        if (!queryList.length) {
            setError("Enter at least one query, one per line.");
            return;
        }

        const variants = queryList
            .map((query) => ({
                query,
                url: buildQueryUrl(queryTemplate, query, settings.queryParameter),
            }))
            .filter((item) => item.url)
            .slice(0, MAX_QUERY_RUNS);

        if (!variants.length) {
            setError("The query template did not produce valid public URLs.");
            return;
        }

        const controller = beginOperation("Running query matrix…");
        const runs = [];
        const payloads = [];

        try {
            for (let index = 0; index < variants.length; index += 1) {
                const variant = variants[index];
                setLoadingLabel(`Query ${index + 1}/${variants.length}: ${variant.query}`);

                try {
                    const data = settings.renderStrategy === "static"
                        ? await postJson(
                            "/api/scrape",
                            {
                                url: variant.url,
                                query: `${instruction}\nQuery variant: ${variant.query}`,
                                mode: settings.mode,
                            },
                            controller.signal
                        )
                        : await postJson(
                            "/api/browser-render",
                            {
                                url: variant.url,
                                instruction: `${instruction}\nQuery variant: ${variant.query}`,
                                waitUntil: "networkidle2",
                                timeoutMs: 22_000,
                                settleMs: 900,
                                includeScreenshot: false,
                                captureResponseBodies: true,
                                includeShadowDom: true,
                                includeReactLinks: true,
                                probeApis: false,
                            },
                            controller.signal
                        );

                    payloads.push(data);
                    const page = data.rendered || data.data || data.page || data.results?.[0]?.data || data.results?.[0] || {};
                    runs.push({
                        ok: true,
                        query: variant.query,
                        url: variant.url,
                        title: page.title || "Untitled response",
                        status: page.status ?? data.status ?? null,
                        textLength: String(page.text || page.textPreview || "").length,
                        htmlLength: String(page.html || page.renderedHtml || "").length,
                        result: data,
                    });
                } catch (runError) {
                    if (runError.name === "AbortError") throw runError;
                    runs.push({
                        ok: false,
                        query: variant.query,
                        url: variant.url,
                        error: statusText(runError),
                    });
                }

                setProgress(Math.round(((index + 1) / variants.length) * 100));
            }

            const merged = mergeResearchPayloads(payloads);
            const comparison = compareRecords(
                runs.filter((item) => item.ok).map((item) => ({
                    ...(item.result?.rendered || item.result?.data || item.result?.page || {}),
                    url: item.url,
                    title: item.title,
                    status: item.status,
                }))
            );

            setQueryRuns(runs);
            setWorkspace((current) => {
                const pages = uniquePageRecords([...merged.pages, ...(current.pages || [])]);
                const resources = mergeUniqueResources([
                    ...merged.resources,
                    ...(current.resources || []),
                ]);

                return {
                    ...current,
                    pages,
                    resources,
                    byKind: groupResources(resources),
                    rawPayloads: [...merged.rawPayloads, ...(current.rawPayloads || [])].slice(0, 60),
                    warnings: uniqueStrings([...merged.warnings, ...(current.warnings || [])], 100),
                    comparison,
                    queries: queryList,
                    instruction,
                    generatedAt: new Date().toISOString(),
                };
            });
            setActiveTab("compare");
            setMessage(`Completed ${runs.filter((item) => item.ok).length}/${runs.length} query variants.`);
        } catch (operationError) {
            setError(statusText(operationError));
        } finally {
            finishOperation();
        }
    }

    async function crossExamineSelected() {
        const urls = selectedResources
            .map((item) => item.url)
            .filter(Boolean)
            .slice(0, MAX_SELECTED_RESOURCES);

        if (!urls.length) {
            setError(`Select up to ${MAX_SELECTED_RESOURCES} links, APIs, images, or pages first.`);
            return;
        }

        const controller = beginOperation("Cross-examining selected resources…");

        try {
            const data = await postJson(
                "/api/batch-scrape",
                {
                    urls,
                    query: instruction,
                    mode: settings.mode,
                    concurrency: 3,
                },
                controller.signal
            );
            const merged = mergeResearchPayloads([data]);
            const comparison = compareRecords(
                (data.results || []).map((item) => item?.data || item)
            );

            setWorkspace((current) => {
                const pages = uniquePageRecords([...merged.pages, ...(current.pages || [])]);
                const resources = mergeUniqueResources([
                    ...merged.resources,
                    ...(current.resources || []),
                ]);

                return {
                    ...current,
                    pages,
                    resources,
                    byKind: groupResources(resources),
                    comparison,
                    selectedResources,
                    warnings: uniqueStrings([...merged.warnings, ...(current.warnings || [])], 100),
                    rawPayloads: [data, ...(current.rawPayloads || [])].slice(0, 60),
                    generatedAt: new Date().toISOString(),
                };
            });
            setActiveTab("compare");
            setMessage(`Cross-examined ${urls.length} selected resources.`);
        } catch (operationError) {
            setError(statusText(operationError));
        } finally {
            finishOperation();
        }
    }

    async function loadLocalModel() {
        setModelStatus((current) => ({ ...current, error: "", text: "Preparing WebLLM…" }));
        try {
            await loadBrowserModel({
                modelId: DEFAULT_BROWSER_MODEL,
                onProgress(next) {
                    setModelStatus({
                        loaded: false,
                        modelId: DEFAULT_BROWSER_MODEL,
                        progress: next.progress,
                        text: next.text,
                        error: "",
                    });
                },
            });
            setModelStatus({
                loaded: true,
                modelId: DEFAULT_BROWSER_MODEL,
                progress: 1,
                text: "Local browser model ready.",
                error: "",
            });
        } catch (modelError) {
            setModelStatus({
                loaded: false,
                modelId: "",
                progress: 0,
                text: "",
                error: statusText(modelError),
            });
        }
    }

    async function removeLocalModel() {
        await unloadBrowserModel();
        setModelStatus({ loaded: false, modelId: "", progress: 0, text: "", error: "" });
    }

    async function sendChat() {
        const question = chatInput.trim();
        if (!question || chatBusy) return;

        const userMessage = { role: "user", content: question };
        setChatMessages((current) => [...current, userMessage]);
        setChatInput("");
        setChatBusy(true);

        try {
            const workspaceWithSelection = {
                ...workspace,
                selectedResources,
                instruction,
                seedUrls,
                queries: queryList,
            };
            const context = buildAssistantContext(workspaceWithSelection, {
                maxCharacters: 7_500,
            });
            const answer = await askBrowserModel({
                question,
                context,
                workspace: workspaceWithSelection,
                history: chatMessages,
                modelId: DEFAULT_BROWSER_MODEL,
            });

            setChatMessages((current) => [
                ...current,
                {
                    role: "assistant",
                    content: answer.text,
                    source: answer.source,
                    modelId: answer.modelId || "",
                },
            ]);
            const loaded = getLoadedBrowserModel();
            setModelStatus((current) => ({ ...current, ...loaded }));
        } catch (chatError) {
            setChatMessages((current) => [
                ...current,
                {
                    role: "assistant",
                    content: `I could not run the local model: ${statusText(chatError)}`,
                    source: "error",
                },
            ]);
        } finally {
            setChatBusy(false);
        }
    }

    function toggleResource(url) {
        setSelectedUrls((current) => {
            const next = new Set(current);
            if (next.has(url)) next.delete(url);
            else if (next.size < MAX_SELECTED_RESOURCES) next.add(url);
            return next;
        });
    }

    function clearWorkspace() {
        abortRef.current?.abort();
        setWorkspace(EMPTY_WORKSPACE);
        setQueryRuns([]);
        setSelectedUrls(new Set());
        setActivePageUrl("");
        setError("");
        setMessage("");
        setProgress(0);
        try {
            window.localStorage.removeItem(STORAGE_KEY);
        } catch {
            // Ignore storage failures.
        }
    }

    const summaryCounts = {
        pages: workspace.pages?.length || 0,
        api: workspace.byKind?.api?.length || 0,
        images: workspace.byKind?.image?.length || 0,
        media:
            (workspace.byKind?.audio?.length || 0) +
            (workspace.byKind?.video?.length || 0) +
            (workspace.byKind?.manifest?.length || 0),
        cdn: workspace.byKind?.cdn?.length || 0,
    };

    return (
        <PageShell
            eyebrow="Browser Lab"
            title="Chat with rendered pages, APIs, DOM, media, and cross-site evidence."
            description="Load multiple public pages into one research workspace, execute JavaScript through an optional Browser Run service, inspect API responses and CDN assets, run query lists, compare selected resources, and feed the complete bounded workspace into a local browser model."
            actions={
                <>
                    <Button
                        variant="outlined"
                        startIcon={<DownloadRounded />}
                        disabled={!workspace.generatedAt}
                        onClick={() =>
                            downloadJson("scrapewebsite-browser-workspace.json", {
                                instruction,
                                seedUrls,
                                queryList,
                                queryRuns,
                                workspace: {
                                    ...workspace,
                                    selectedResources,
                                },
                                chatMessages,
                            })
                        }
                    >
                        Export workspace
                    </Button>
                    <Button
                        color="error"
                        variant="outlined"
                        startIcon={<ClearRounded />}
                        onClick={clearWorkspace}
                    >
                        Clear
                    </Button>
                </>
            }
        >
            <Alert severity="info" icon={<SecurityRounded />}>
                This page is designed for public, authorized research. It does not defeat CAPTCHAs, authentication, rate limits, paywalls, or private endpoints. Challenge pages are reported and automated probing stops so you can use the site normally.
            </Alert>

            <Grid container spacing={2.5}>
                <Grid item xs={12} xl={4}>
                    <Stack spacing={2.5}>
                        <ResearchControls
                            instruction={instruction}
                            setInstruction={setInstruction}
                            urlInput={urlInput}
                            setUrlInput={setUrlInput}
                            seedUrls={seedUrls}
                            queryInput={queryInput}
                            setQueryInput={setQueryInput}
                            queryList={queryList}
                            queryTemplate={queryTemplate}
                            setQueryTemplate={setQueryTemplate}
                            settings={settings}
                            updateSetting={updateSetting}
                            loading={loading}
                            onRunResearch={runResearch}
                            onRunQueryMatrix={runQueryMatrix}
                            onCancel={() => abortRef.current?.abort()}
                        />

                        <ChatPanel
                            messages={chatMessages}
                            input={chatInput}
                            setInput={setChatInput}
                            busy={chatBusy}
                            onSend={sendChat}
                            modelStatus={modelStatus}
                            capabilities={capabilities}
                            onLoadModel={loadLocalModel}
                            onUnloadModel={removeLocalModel}
                            contextCounts={summaryCounts}
                        />

                        <RecorderPanel compact />
                    </Stack>
                </Grid>

                <Grid item xs={12} xl={8}>
                    <Stack spacing={2.5}>
                        <WorkspaceHeader
                            counts={summaryCounts}
                            loading={loading}
                            loadingLabel={loadingLabel}
                            progress={progress}
                            selectedCount={selectedUrls.size}
                            onCrossExamine={crossExamineSelected}
                            onClearSelection={() => setSelectedUrls(new Set())}
                        />

                        {error && <Alert severity="error">{error}</Alert>}
                        {message && !error && <Alert severity="success">{message}</Alert>}
                        {(workspace.warnings || []).length > 0 && (
                            <Alert severity="warning">
                                {(workspace.warnings || []).slice(0, 6).join(" · ")}
                            </Alert>
                        )}

                        <GlassCard sx={{ p: 0, overflow: "hidden" }}>
                            <Tabs
                                value={activeTab}
                                onChange={(_, value) => setActiveTab(value)}
                                variant="scrollable"
                                scrollButtons="auto"
                                sx={{ px: 2, pt: 1.2, borderBottom: "1px solid rgba(148,163,184,.16)" }}
                            >
                                <Tab value="preview" icon={<LanguageRounded />} iconPosition="start" label="Rendered preview" />
                                <Tab value="resources" icon={<HubRounded />} iconPosition="start" label="Links and resources" />
                                <Tab value="apis" icon={<ApiRounded />} iconPosition="start" label="API calls" />
                                <Tab value="assets" icon={<ImageRounded />} iconPosition="start" label="Media and CDN" />
                                <Tab value="compare" icon={<CompareArrowsRounded />} iconPosition="start" label="Cross-examine" />
                                <Tab value="raw" icon={<DataObjectRounded />} iconPosition="start" label="Raw workspace" />
                            </Tabs>

                            <Box sx={{ p: { xs: 2, md: 2.5 } }}>
                                {activeTab === "preview" && (
                                    <PreviewPanel
                                        pages={workspace.pages || []}
                                        activePage={activePage}
                                        activePageUrl={activePageUrl}
                                        setActivePageUrl={setActivePageUrl}
                                    />
                                )}

                                {activeTab === "resources" && (
                                    <ResourcePanel
                                        resources={filteredResources}
                                        filter={resourceFilter}
                                        setFilter={setResourceFilter}
                                        selectedUrls={selectedUrls}
                                        toggleResource={toggleResource}
                                    />
                                )}

                                {activeTab === "apis" && (
                                    <ApiPanel
                                        resources={workspace.byKind?.api || []}
                                        selectedUrls={selectedUrls}
                                        toggleResource={toggleResource}
                                    />
                                )}

                                {activeTab === "assets" && (
                                    <AssetPanel
                                        workspace={workspace}
                                        selectedUrls={selectedUrls}
                                        toggleResource={toggleResource}
                                    />
                                )}

                                {activeTab === "compare" && (
                                    <ComparePanel
                                        comparison={workspace.comparison}
                                        queryRuns={queryRuns}
                                        selectedResources={selectedResources}
                                    />
                                )}

                                {activeTab === "raw" && (
                                    <JsonViewer value={{ workspace, queryRuns }} />
                                )}
                            </Box>
                        </GlassCard>
                    </Stack>
                </Grid>
            </Grid>
        </PageShell>
    );
}

function ResearchControls({
                              instruction,
                              setInstruction,
                              urlInput,
                              setUrlInput,
                              seedUrls,
                              queryInput,
                              setQueryInput,
                              queryList,
                              queryTemplate,
                              setQueryTemplate,
                              settings,
                              updateSetting,
                              loading,
                              onRunResearch,
                              onRunQueryMatrix,
                              onCancel,
                          }) {
    const [tab, setTab] = useState("sites");

    return (
        <GlassCard>
            <Stack spacing={2.3}>
                <Stack spacing={0.5}>
                    <Typography variant="h5" fontWeight={900}>
                        Browser research controls
                    </Typography>
                    <Typography color="text.secondary">
                        Build one bounded workspace from rendered pages, static extraction, APIs, images, media, and query variants.
                    </Typography>
                </Stack>

                <TextField
                    label="Research instruction"
                    value={instruction}
                    onChange={(event) => setInstruction(event.target.value)}
                    multiline
                    minRows={3}
                    fullWidth
                    placeholder="What should the browser extract and compare?"
                />

                <Tabs value={tab} onChange={(_, value) => setTab(value)} variant="scrollable" scrollButtons="auto">
                    <Tab value="sites" label="Sites" />
                    <Tab value="queries" label="Query matrix" />
                    <Tab value="settings" label="Settings" />
                </Tabs>

                {tab === "sites" && (
                    <Stack spacing={1.8}>
                        <TextField
                            label={`Seed URLs, one per line (maximum ${MAX_SEED_URLS})`}
                            value={urlInput}
                            onChange={(event) => setUrlInput(event.target.value)}
                            multiline
                            minRows={6}
                            fullWidth
                            placeholder={"https://www.depop.com/products/...\nhttps://www.grailed.com/listings/..."}
                        />
                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                            {seedUrls.map((url) => (
                                <Chip key={url} size="small" label={new URL(url).hostname} />
                            ))}
                        </Stack>
                        <Button
                            variant="contained"
                            size="large"
                            startIcon={loading ? <CircularProgress size={18} color="inherit" /> : <PlayArrowRounded />}
                            disabled={loading || !seedUrls.length}
                            onClick={onRunResearch}
                        >
                            Run browser research
                        </Button>
                    </Stack>
                )}

                {tab === "queries" && (
                    <Stack spacing={1.8}>
                        <TextField
                            label="URL template"
                            value={queryTemplate}
                            onChange={(event) => setQueryTemplate(event.target.value)}
                            fullWidth
                            helperText="Use {query}, or the selected query-parameter name will be added automatically."
                        />
                        <TextField
                            label={`Queries, one per line (maximum ${MAX_QUERY_RUNS})`}
                            value={queryInput}
                            onChange={(event) => setQueryInput(event.target.value)}
                            multiline
                            minRows={6}
                            fullWidth
                        />
                        <Typography variant="body2" color="text.secondary">
                            {queryList.length} query variants ready.
                        </Typography>
                        <Button
                            variant="contained"
                            color="secondary"
                            size="large"
                            startIcon={<SearchRounded />}
                            disabled={loading || !queryList.length || !queryTemplate.trim()}
                            onClick={onRunQueryMatrix}
                        >
                            Run query matrix
                        </Button>
                    </Stack>
                )}

                {tab === "settings" && (
                    <Stack spacing={1.8}>
                        <TextField
                            label="Extraction mode"
                            select
                            value={settings.mode}
                            onChange={(event) => updateSetting("mode", event.target.value)}
                            fullWidth
                        >
                            <MenuItem value="research">Research</MenuItem>
                            <MenuItem value="product">Product / resale</MenuItem>
                            <MenuItem value="links">Links / API / CDN</MenuItem>
                            <MenuItem value="news">News</MenuItem>
                            <MenuItem value="quick">Quick</MenuItem>
                        </TextField>

                        <TextField
                            label="Rendering strategy"
                            select
                            value={settings.renderStrategy}
                            onChange={(event) => updateSetting("renderStrategy", event.target.value)}
                            fullWidth
                        >
                            <MenuItem value="both">Static extraction + rendered browser</MenuItem>
                            <MenuItem value="static">Static Cloudflare scrape only</MenuItem>
                            <MenuItem value="rendered">Rendered browser only</MenuItem>
                        </TextField>

                        <Grid container spacing={1.5}>
                            <Grid item xs={6}>
                                <TextField
                                    type="number"
                                    label="Crawl depth"
                                    value={settings.crawlDepth}
                                    inputProps={{ min: 0, max: 2 }}
                                    onChange={(event) => updateSetting("crawlDepth", Math.max(0, Math.min(2, Number(event.target.value))))}
                                    fullWidth
                                />
                            </Grid>
                            <Grid item xs={6}>
                                <TextField
                                    type="number"
                                    label="Branch limit"
                                    value={settings.branchLimit}
                                    inputProps={{ min: 0, max: 8 }}
                                    onChange={(event) => updateSetting("branchLimit", Math.max(0, Math.min(8, Number(event.target.value))))}
                                    fullWidth
                                />
                            </Grid>
                            <Grid item xs={6}>
                                <TextField
                                    type="number"
                                    label="API probes"
                                    value={settings.maxProbes}
                                    inputProps={{ min: 0, max: 20 }}
                                    onChange={(event) => updateSetting("maxProbes", Math.max(0, Math.min(12, Number(event.target.value))))}
                                    fullWidth
                                />
                            </Grid>
                            <Grid item xs={6}>
                                <TextField
                                    label="Query parameter"
                                    value={settings.queryParameter}
                                    onChange={(event) => updateSetting("queryParameter", event.target.value.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 40))}
                                    fullWidth
                                />
                            </Grid>
                        </Grid>

                        <FormControlLabel
                            control={<Switch checked={settings.includeCdn} onChange={(event) => updateSetting("includeCdn", event.target.checked)} />}
                            label="Discover CDN and static assets"
                        />
                        <FormControlLabel
                            control={<Switch checked={settings.includeApiProbes} onChange={(event) => updateSetting("includeApiProbes", event.target.checked)} />}
                            label="Probe bounded public GET/HEAD API candidates"
                        />
                        <FormControlLabel
                            control={<Switch checked={settings.probeBodies} onChange={(event) => updateSetting("probeBodies", event.target.checked)} />}
                            label="Capture bounded response previews"
                        />
                    </Stack>
                )}

                {loading && (
                    <Button color="warning" variant="outlined" startIcon={<CancelRounded />} onClick={onCancel}>
                        Cancel current operation
                    </Button>
                )}
            </Stack>
        </GlassCard>
    );
}

function ChatPanel({
                       messages,
                       input,
                       setInput,
                       busy,
                       onSend,
                       modelStatus,
                       capabilities,
                       onLoadModel,
                       onUnloadModel,
                       contextCounts,
                   }) {
    return (
        <GlassCard>
            <Stack spacing={2}>
                <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                    <Stack direction="row" spacing={1} alignItems="center">
                        <SmartToyRounded color="secondary" />
                        <Box>
                            <Typography variant="h5" fontWeight={900}>
                                Workspace chat
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                                The assistant receives the bounded page, API, asset, and comparison context.
                            </Typography>
                        </Box>
                    </Stack>
                    <Chip
                        size="small"
                        color={modelStatus.loaded ? "success" : "default"}
                        icon={<MemoryRounded />}
                        label={modelStatus.loaded ? "Local model" : "Summary mode"}
                    />
                </Stack>

                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    <Chip size="small" label={`${contextCounts.pages} pages`} />
                    <Chip size="small" label={`${contextCounts.api} APIs`} />
                    <Chip size="small" label={`${contextCounts.images} images`} />
                    <Chip size="small" label={`${contextCounts.media} media`} />
                </Stack>

                <Paper
                    elevation={0}
                    sx={{
                        p: 1.5,
                        borderRadius: 4,
                        background: "rgba(2,6,23,.42)",
                        maxHeight: 430,
                        overflow: "auto",
                    }}
                >
                    <Stack spacing={1.2}>
                        {messages.map((item, index) => (
                            <Box
                                key={`${item.role}-${index}`}
                                sx={{
                                    alignSelf: item.role === "user" ? "flex-end" : "stretch",
                                    maxWidth: item.role === "user" ? "88%" : "100%",
                                    p: 1.4,
                                    borderRadius: 3,
                                    background:
                                        item.role === "user"
                                            ? "rgba(124,58,237,.26)"
                                            : "rgba(15,23,42,.74)",
                                    border: "1px solid rgba(148,163,184,.14)",
                                }}
                            >
                                <Typography
                                    variant="body2"
                                    sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", lineHeight: 1.65 }}
                                >
                                    {item.content}
                                </Typography>
                                {item.role === "assistant" && item.source && (
                                    <Typography variant="caption" color="text.secondary">
                                        {item.source === "webllm" ? item.modelId || "WebLLM" : item.source}
                                    </Typography>
                                )}
                            </Box>
                        ))}
                        {busy && <LinearProgress sx={{ borderRadius: 99 }} />}
                    </Stack>
                </Paper>

                <TextField
                    label="Ask about the loaded workspace"
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    multiline
                    minRows={2}
                    fullWidth
                    onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                            event.preventDefault();
                            onSend();
                        }
                    }}
                />

                <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                    <Button
                        variant="contained"
                        startIcon={<AutoAwesomeRounded />}
                        disabled={busy || !input.trim()}
                        onClick={onSend}
                        fullWidth
                    >
                        Ask workspace
                    </Button>
                    {!modelStatus.loaded ? (
                        <Button
                            variant="outlined"
                            startIcon={<MemoryRounded />}
                            disabled={!capabilities.webGpu || Boolean(modelStatus.text && modelStatus.progress < 1)}
                            onClick={onLoadModel}
                            fullWidth
                        >
                            Load quick local model
                        </Button>
                    ) : (
                        <Button variant="outlined" color="warning" onClick={onUnloadModel} fullWidth>
                            Unload model
                        </Button>
                    )}
                </Stack>

                {!capabilities.webGpu && (
                    <Alert severity="warning">WebGPU is unavailable, so chat uses deterministic workspace summaries.</Alert>
                )}
                {modelStatus.text && !modelStatus.loaded && (
                    <Box>
                        <Typography variant="caption" color="text.secondary">
                            {modelStatus.text}
                        </Typography>
                        <LinearProgress variant="determinate" value={Math.round((modelStatus.progress || 0) * 100)} />
                    </Box>
                )}
                {modelStatus.error && <Alert severity="error">{modelStatus.error}</Alert>}
            </Stack>
        </GlassCard>
    );
}

function WorkspaceHeader({
                             counts,
                             loading,
                             loadingLabel,
                             progress,
                             selectedCount,
                             onCrossExamine,
                             onClearSelection,
                         }) {
    return (
        <GlassCard>
            <Stack spacing={2}>
                <Stack
                    direction={{ xs: "column", md: "row" }}
                    alignItems={{ xs: "stretch", md: "center" }}
                    justifyContent="space-between"
                    spacing={2}
                >
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                        <Chip icon={<PublicRounded />} label={`${counts.pages} pages`} />
                        <Chip icon={<ApiRounded />} label={`${counts.api} APIs`} color="secondary" />
                        <Chip icon={<ImageRounded />} label={`${counts.images} images`} />
                        <Chip icon={<VideoLibraryRounded />} label={`${counts.media} media`} />
                        <Chip icon={<StorageRounded />} label={`${counts.cdn} CDN`} />
                    </Stack>
                    <Stack direction="row" spacing={1}>
                        <Button
                            variant="contained"
                            color="secondary"
                            startIcon={<CompareArrowsRounded />}
                            disabled={loading || selectedCount === 0}
                            onClick={onCrossExamine}
                        >
                            Cross-examine {selectedCount || "selected"}
                        </Button>
                        <Button variant="outlined" disabled={!selectedCount} onClick={onClearSelection}>
                            Clear selection
                        </Button>
                    </Stack>
                </Stack>

                {loading && (
                    <Stack spacing={0.7}>
                        <Typography variant="body2" color="text.secondary">
                            {loadingLabel}
                        </Typography>
                        <LinearProgress variant="determinate" value={progress} sx={{ height: 8, borderRadius: 99 }} />
                    </Stack>
                )}
            </Stack>
        </GlassCard>
    );
}

function safeInlineScript(value) {
    return String(value || "").replace(/<\/script/gi, "<\\/script");
}

function safeInlineStyle(value) {
    return String(value || "").replace(/<\/style/gi, "<\\/style");
}

function escapeHtmlAttribute(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function stripOriginalScripts(markup) {
    return String(markup || "").replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "");
}

function buildLabBridgeScript(learningMode) {
    return `
(() => {
  const CHANNEL = ${JSON.stringify(LIVE_BROWSER_CHANNEL)};
  const LEARNING_MODE = ${JSON.stringify(Boolean(learningMode))};
  const MAX_TEXT = 5000;
  let mutationTimer = 0;
  let hoverOutline = null;

  const send = (type, payload) => {
    try {
      window.parent.postMessage({ channel: CHANNEL, type, payload: payload || {} }, "*");
    } catch (_) {
      // The sandbox remains usable even if the parent is unavailable.
    }
  };

  const stringify = (value) => {
    if (typeof value === "string") return value.slice(0, MAX_TEXT);
    if (value instanceof Error) return (value.stack || value.message || String(value)).slice(0, MAX_TEXT);
    try {
      const seen = new WeakSet();
      return JSON.stringify(value, (key, item) => {
        if (typeof item === "object" && item !== null) {
          if (seen.has(item)) return "[Circular]";
          seen.add(item);
        }
        if (typeof item === "function") return "[Function " + (item.name || "anonymous") + "]";
        return item;
      }, 2).slice(0, MAX_TEXT);
    } catch (_) {
      return String(value).slice(0, MAX_TEXT);
    }
  };

  const originalConsole = {};
  ["log", "info", "warn", "error", "debug", "table", "time", "timeEnd"].forEach((method) => {
    if (typeof console[method] !== "function") return;
    originalConsole[method] = console[method].bind(console);
    console[method] = (...args) => {
      send("console", {
        level: method,
        values: args.map(stringify),
        timestamp: Date.now(),
      });
      return originalConsole[method](...args);
    };
  });

  window.addEventListener("error", (event) => {
    send("console", {
      level: "error",
      values: [String(event.message || "Script error"), String(event.filename || ""), String(event.lineno || "")],
      timestamp: Date.now(),
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    send("console", {
      level: "error",
      values: ["Unhandled promise rejection", stringify(event.reason)],
      timestamp: Date.now(),
    });
  });

  const nativeFetch = typeof window.fetch === "function" ? window.fetch.bind(window) : null;
  if (nativeFetch) {
    window.fetch = async (...args) => {
      const request = args[0];
      const options = args[1] || {};
      const url = typeof request === "string" ? request : request?.url || String(request || "");
      const method = String(options.method || request?.method || "GET").toUpperCase();
      const startedAt = performance.now();
      try {
        const response = await nativeFetch(...args);
        let preview = "";
        try {
          preview = (await response.clone().text()).slice(0, MAX_TEXT);
        } catch (_) {
          preview = "[Body unavailable]";
        }
        send("network", {
          transport: "fetch",
          url,
          method,
          status: response.status,
          ok: response.ok,
          contentType: response.headers.get("content-type") || "",
          durationMs: Math.round(performance.now() - startedAt),
          responsePreview: preview,
        });
        return response;
      } catch (error) {
        send("network", {
          transport: "fetch",
          url,
          method,
          status: 0,
          ok: false,
          durationMs: Math.round(performance.now() - startedAt),
          error: stringify(error),
        });
        throw error;
      }
    };
  }

  const NativeXHR = window.XMLHttpRequest;
  if (NativeXHR) {
    const nativeOpen = NativeXHR.prototype.open;
    const nativeSend = NativeXHR.prototype.send;
    NativeXHR.prototype.open = function(method, url, ...rest) {
      this.__swbMethod = String(method || "GET").toUpperCase();
      this.__swbUrl = String(url || "");
      return nativeOpen.call(this, method, url, ...rest);
    };
    NativeXHR.prototype.send = function(body) {
      const startedAt = performance.now();
      this.addEventListener("loadend", () => {
        let preview = "";
        try {
          preview = String(this.responseText || "").slice(0, MAX_TEXT);
        } catch (_) {
          preview = "[Body unavailable]";
        }
        send("network", {
          transport: "xhr",
          url: this.responseURL || this.__swbUrl || "",
          method: this.__swbMethod || "GET",
          status: Number(this.status || 0),
          ok: this.status >= 200 && this.status < 400,
          contentType: this.getResponseHeader("content-type") || "",
          durationMs: Math.round(performance.now() - startedAt),
          responsePreview: preview,
          requestBodyPreview: typeof body === "string" ? body.slice(0, 2000) : "",
        });
      }, { once: true });
      return nativeSend.call(this, body);
    };
  }

  function collectRoots() {
    const roots = [document];
    const visited = new Set();
    for (let index = 0; index < roots.length; index += 1) {
      const root = roots[index];
      if (!root || visited.has(root)) continue;
      visited.add(root);
      root.querySelectorAll?.("*").forEach((element) => {
        if (element.shadowRoot && !visited.has(element.shadowRoot)) roots.push(element.shadowRoot);
      });
    }
    return roots;
  }

  function collectStats() {
    const roots = collectRoots();
    const counts = {
      elements: 0,
      interactive: 0,
      links: 0,
      buttons: 0,
      inputs: 0,
      forms: 0,
      images: 0,
      scripts: document.scripts.length,
      stylesheets: document.styleSheets.length,
      shadowRoots: Math.max(0, roots.length - 1),
    };
    roots.forEach((root) => {
      counts.elements += root.querySelectorAll?.("*").length || 0;
      counts.interactive += root.querySelectorAll?.("a[href],button,input,select,textarea,summary,[role='button'],[tabindex]").length || 0;
      counts.links += root.querySelectorAll?.("a[href]").length || 0;
      counts.buttons += root.querySelectorAll?.("button,[role='button']").length || 0;
      counts.inputs += root.querySelectorAll?.("input,select,textarea").length || 0;
      counts.forms += root.querySelectorAll?.("form").length || 0;
      counts.images += root.querySelectorAll?.("img,picture,svg,canvas").length || 0;
    });
    return counts;
  }

  function cssPath(element) {
    if (!(element instanceof Element)) return "";
    const parts = [];
    let current = element;
    while (current && current.nodeType === 1 && parts.length < 9) {
      if (current.id) {
        parts.unshift("#" + CSS.escape(current.id));
        break;
      }
      let part = current.localName || current.tagName.toLowerCase();
      const classes = [...current.classList].filter(Boolean).slice(0, 2);
      if (classes.length) part += "." + classes.map((item) => CSS.escape(item)).join(".");
      const parent = current.parentElement;
      if (parent) {
        const siblings = [...parent.children].filter((item) => item.localName === current.localName);
        if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")";
      }
      parts.unshift(part);
      const root = current.getRootNode();
      if (root instanceof ShadowRoot) {
        parts.unshift(">>>");
        current = root.host;
      } else {
        current = parent;
      }
    }
    return parts.join(" > ").replace(/ > >>> > /g, " >>> ");
  }

  function accessibilityIssues(element, accessibleName) {
    const issues = [];
    const tag = element.localName;
    const role = element.getAttribute("role") || "";
    if ((tag === "button" || role === "button") && !accessibleName) issues.push("Button has no accessible name.");
    if (tag === "img" && !element.hasAttribute("alt")) issues.push("Image is missing an alt attribute.");
    if (["input", "select", "textarea"].includes(tag)) {
      const labels = element.labels ? [...element.labels] : [];
      if (!labels.length && !element.getAttribute("aria-label") && !element.getAttribute("aria-labelledby")) {
        issues.push("Form control has no associated label.");
      }
    }
    if (tag === "a" && !element.getAttribute("href")) issues.push("Anchor has no href destination.");
    return issues;
  }

  function inspectElement(element) {
    if (!(element instanceof Element)) return null;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const labelText = element.labels?.[0]?.innerText || "";
    const accessibleName = (
      element.getAttribute("aria-label") ||
      element.getAttribute("alt") ||
      element.getAttribute("title") ||
      labelText ||
      element.innerText ||
      element.value ||
      ""
    ).trim().slice(0, 500);
    return {
      tag: element.localName || "",
      id: element.id || "",
      classes: [...element.classList].slice(0, 16),
      role: element.getAttribute("role") || "",
      type: element.getAttribute("type") || "",
      selector: cssPath(element),
      accessibleName,
      text: String(element.innerText || element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 800),
      href: element.href || element.getAttribute("href") || "",
      src: element.currentSrc || element.src || element.getAttribute("src") || "",
      attributes: Object.fromEntries([...element.attributes].slice(0, 30).map((item) => [item.name, item.value.slice(0, 500)])),
      styles: {
        display: style.display,
        position: style.position,
        width: style.width,
        height: style.height,
        color: style.color,
        backgroundColor: style.backgroundColor,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        margin: style.margin,
        padding: style.padding,
        border: style.border,
        zIndex: style.zIndex,
      },
      bounds: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      accessibilityIssues: accessibilityIssues(element, accessibleName),
      html: String(element.outerHTML || "").slice(0, 2200),
    };
  }

  function getEventElement(event) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    const candidate = path.find((item) => item instanceof Element);
    return candidate || (event.target instanceof Element ? event.target : null);
  }

  function ensureOutline() {
    if (hoverOutline) return hoverOutline;
    hoverOutline = document.createElement("div");
    hoverOutline.id = "__swb_learning_outline";
    Object.assign(hoverOutline.style, {
      position: "fixed",
      zIndex: "2147483647",
      pointerEvents: "none",
      border: "2px solid #22d3ee",
      background: "rgba(34, 211, 238, .10)",
      boxShadow: "0 0 0 1px rgba(2, 6, 23, .85), 0 0 28px rgba(34, 211, 238, .40)",
      borderRadius: "4px",
      transition: "all 60ms linear",
    });
    document.documentElement.appendChild(hoverOutline);
    return hoverOutline;
  }

  if (LEARNING_MODE) {
    const outline = ensureOutline();
    document.addEventListener("pointerover", (event) => {
      const element = getEventElement(event);
      if (!element || element === outline || element.id === "__swb_learning_badge") return;
      const rect = element.getBoundingClientRect();
      Object.assign(outline.style, {
        display: rect.width > 0 && rect.height > 0 ? "block" : "none",
        left: rect.left + "px",
        top: rect.top + "px",
        width: rect.width + "px",
        height: rect.height + "px",
      });
    }, true);

    document.addEventListener("click", (event) => {
      const element = getEventElement(event);
      if (!element || element === outline || element.id === "__swb_learning_badge") return;
      const inspection = inspectElement(element);
      if (inspection) send("inspect", inspection);
      const navigationTarget = element.closest?.("a[href]");
      const submitTarget = element.closest?.("button[type='submit'],input[type='submit']");
      if (navigationTarget) {
        event.preventDefault();
        send("console", {
          level: "info",
          values: ["Learning Mode prevented navigation to", navigationTarget.href],
          timestamp: Date.now(),
        });
      } else if (submitTarget && submitTarget.form && !submitTarget.form.hasAttribute("data-allow-navigation")) {
        send("console", {
          level: "info",
          values: ["Learning Mode kept the form inside the sandbox."],
          timestamp: Date.now(),
        });
      }
    }, true);

    document.addEventListener("submit", (event) => {
      const form = event.target;
      if (form instanceof HTMLFormElement && !form.hasAttribute("data-allow-navigation")) {
        event.preventDefault();
      }
    }, true);

    const badge = document.createElement("div");
    badge.id = "__swb_learning_badge";
    badge.textContent = "Learning Mode · hover and click elements";
    Object.assign(badge.style, {
      position: "fixed",
      right: "12px",
      bottom: "12px",
      zIndex: "2147483647",
      padding: "8px 10px",
      borderRadius: "10px",
      background: "rgba(2, 6, 23, .92)",
      color: "#e2f8ff",
      border: "1px solid rgba(34, 211, 238, .55)",
      font: "700 11px/1.2 ui-monospace, SFMono-Regular, Consolas, monospace",
      pointerEvents: "none",
    });
    document.documentElement.appendChild(badge);
  }

  const observer = new MutationObserver((mutations) => {
    window.clearTimeout(mutationTimer);
    mutationTimer = window.setTimeout(() => {
      send("mutation", {
        mutationCount: mutations.length,
        stats: collectStats(),
        timestamp: Date.now(),
      });
    }, 180);
  });

  const start = () => {
    observer.observe(document.documentElement || document, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    send("ready", {
      title: document.title,
      url: location.href,
      stats: collectStats(),
      timestamp: Date.now(),
    });
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();

  window.__SCRAPEWEBSITE_BROWSER_LAB__ = {
    getStats: collectStats,
    inspect: (selector) => inspectElement(document.querySelector(selector)),
  };
})();`;
}

function buildInteractiveBrowserDocument({
                                             html,
                                             css,
                                             javascript,
                                             baseUrl,
                                             learningMode,
                                             runOriginalScripts,
                                         }) {
    let markup = String(html || DEFAULT_LAB_HTML).trim();
    if (!runOriginalScripts) markup = stripOriginalScripts(markup);

    markup = markup
        .replace(/<base\b[^>]*>/gi, "")
        .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi, "");

    const safeBase = /^https?:\/\//i.test(String(baseUrl || ""))
        ? String(baseUrl)
        : "https://example.invalid/";
    const bridge = buildLabBridgeScript(learningMode);
    const headInjection = [
        `<base href="${escapeHtmlAttribute(safeBase)}">`,
        `<style id="__swb_user_css">${safeInlineStyle(css)}</style>`,
        `<script>${safeInlineScript(bridge)}</script>`,
    ].join("\n");
    const userScript = `<script>\ntry {\n${safeInlineScript(javascript)}\n} catch (error) { console.error("User JavaScript failed", error); }\n<\/script>`;

    if (!/<html\b/i.test(markup)) {
        return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${headInjection}</head><body>${markup}${userScript}</body></html>`;
    }

    if (/<head\b[^>]*>/i.test(markup)) {
        markup = markup.replace(/<head\b[^>]*>/i, (match) => `${match}\n${headInjection}`);
    } else {
        markup = markup.replace(/<html\b[^>]*>/i, (match) => `${match}<head>${headInjection}</head>`);
    }

    if (/<\/body\s*>/i.test(markup)) {
        markup = markup.replace(/<\/body\s*>/i, `${userScript}</body>`);
    } else {
        markup += userScript;
    }
    return markup;
}

function describeLearningTarget(target) {
    if (!target) return [];
    const tag = String(target.tag || "element").toLowerCase();
    const notes = [];
    if (["button", "input", "select", "textarea"].includes(tag) || target.role === "button") {
        notes.push("This is an interactive control. JavaScript can listen for events such as click, input, change, focus, and submit.");
    } else if (tag === "a") {
        notes.push("This anchor connects the current document to another URL. Learning Mode prevents accidental navigation while you inspect it.");
    } else if (["img", "picture", "video", "audio", "source"].includes(tag)) {
        notes.push("This is a media element. Its src, currentSrc, poster, source children, and computed dimensions help identify the loaded asset.");
    } else if (["section", "article", "main", "nav", "header", "footer", "aside"].includes(tag)) {
        notes.push("This semantic container communicates the purpose of a page region to browsers, search engines, and assistive technology.");
    } else if (["h1", "h2", "h3", "h4", "h5", "h6"].includes(tag)) {
        notes.push("This heading participates in the document outline and should describe the section that follows it.");
    } else {
        notes.push("This element contributes structure, content, or styling to the rendered document.");
    }

    if (target.styles?.display) {
        notes.push(`Its computed display is ${target.styles.display}; position is ${target.styles.position || "static"}.`);
    }
    if (target.selector) notes.push(`The generated selector can be used to find it again: ${target.selector}`);
    if (target.accessibilityIssues?.length) {
        notes.push(`Accessibility review: ${target.accessibilityIssues.join(" ")}`);
    } else {
        notes.push("No obvious accessibility issue was detected by the lightweight inspector.");
    }
    return notes;
}

function InteractiveBrowserLab({ activePage }) {
    const iframeRef = useRef(null);
    const activeMarkup = activePage?.html || activePage?.raw?.renderedHtml || activePage?.raw?.html || "";
    const activeUrl = activePage?.url || "";
    const [address, setAddress] = useState(activeUrl);
    const [baseUrl, setBaseUrl] = useState(activeUrl || "https://example.invalid/");
    const [htmlSource, setHtmlSource] = useState(activeMarkup || DEFAULT_LAB_HTML);
    const [cssSource, setCssSource] = useState(DEFAULT_LAB_CSS);
    const [javascriptSource, setJavascriptSource] = useState(DEFAULT_LAB_JS);
    const [learningMode, setLearningMode] = useState(true);
    const [autoRun, setAutoRun] = useState(false);
    const [runOriginalScripts, setRunOriginalScripts] = useState(false);
    const [panel, setPanel] = useState("browser");
    const [frameHeight, setFrameHeight] = useState(760);
    const [consoleEntries, setConsoleEntries] = useState([]);
    const [networkEntries, setNetworkEntries] = useState([]);
    const [inspectedElement, setInspectedElement] = useState(null);
    const [pageStats, setPageStats] = useState(null);
    const [lastMutation, setLastMutation] = useState(null);
    const [loadBusy, setLoadBusy] = useState(false);
    const [loadError, setLoadError] = useState("");
    const [runVersion, setRunVersion] = useState(1);
    const [compiledDocument, setCompiledDocument] = useState(() =>
        buildInteractiveBrowserDocument({
            html: activeMarkup || DEFAULT_LAB_HTML,
            css: DEFAULT_LAB_CSS,
            javascript: DEFAULT_LAB_JS,
            baseUrl: activeUrl || "https://example.invalid/",
            learningMode: true,
            runOriginalScripts: false,
        })
    );

    const compileAndRun = useCallback((overrides = {}) => {
        const nextHtml = overrides.html ?? htmlSource;
        const nextCss = overrides.css ?? cssSource;
        const nextJavascript = overrides.javascript ?? javascriptSource;
        const nextBaseUrl = overrides.baseUrl ?? baseUrl;
        const nextLearningMode = overrides.learningMode ?? learningMode;
        const nextOriginalScripts = overrides.runOriginalScripts ?? runOriginalScripts;

        setCompiledDocument(
            buildInteractiveBrowserDocument({
                html: nextHtml,
                css: nextCss,
                javascript: nextJavascript,
                baseUrl: nextBaseUrl,
                learningMode: nextLearningMode,
                runOriginalScripts: nextOriginalScripts,
            })
        );
        setRunVersion((value) => value + 1);
        setConsoleEntries([]);
        setNetworkEntries([]);
        setInspectedElement(null);
        setPageStats(null);
        setLastMutation(null);
        setLoadError("");
    }, [baseUrl, cssSource, htmlSource, javascriptSource, learningMode, runOriginalScripts]);

    useEffect(() => {
        if (!activeUrl || !activeMarkup) return;
        setAddress(activeUrl);
        setBaseUrl(activeUrl);
        setHtmlSource(activeMarkup);
        compileAndRun({ html: activeMarkup, baseUrl: activeUrl });
        // compileAndRun intentionally uses the current CSS/JavaScript learning tools.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeUrl, activeMarkup]);

    useEffect(() => {
        if (!autoRun) return undefined;
        const timer = window.setTimeout(() => compileAndRun(), 650);
        return () => window.clearTimeout(timer);
    }, [autoRun, compileAndRun]);

    useEffect(() => {
        const onMessage = (event) => {
            if (event.source !== iframeRef.current?.contentWindow) return;
            const data = event.data;
            if (!data || data.channel !== LIVE_BROWSER_CHANNEL) return;

            if (data.type === "console") {
                setConsoleEntries((current) => [...current, data.payload].slice(-250));
            } else if (data.type === "network") {
                setNetworkEntries((current) => [...current, data.payload].slice(-150));
            } else if (data.type === "inspect") {
                setInspectedElement(data.payload);
            } else if (data.type === "ready") {
                setPageStats(data.payload?.stats || null);
            } else if (data.type === "mutation") {
                setLastMutation(data.payload || null);
                if (data.payload?.stats) setPageStats(data.payload.stats);
            }
        };
        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
    }, []);

    async function loadAddressInBrowser() {
        let normalized;
        try {
            normalized = new URL(address.trim());
            if (!/^https?:$/.test(normalized.protocol)) throw new Error("Only public HTTP and HTTPS URLs are supported.");
        } catch (error) {
            setLoadError(error.message || "Enter a complete public URL.");
            return;
        }

        setLoadBusy(true);
        setLoadError("");
        try {
            const data = await postJson("/api/browser-render", {
                url: normalized.toString(),
                instruction: "Render the page for the interactive browser lab.",
                waitUntil: "networkidle2",
                timeoutMs: 24_000,
                settleMs: 1_000,
                includeScreenshot: false,
                captureResponseBodies: true,
                includeShadowDom: true,
                includeReactLinks: true,
                probeApis: false,
            });
            const page = data?.rendered || data?.data || data?.page || data?.results?.[0]?.data || data?.results?.[0] || {};
            if (page.challengeDetected || data?.challengeDetected) {
                throw new Error("The page returned a human-verification challenge. Use the site normally instead of repeatedly automating it.");
            }
            const nextHtml = page.html || page.renderedHtml || data?.html || data?.renderedHtml || "";
            if (!nextHtml) throw new Error("The renderer returned no HTML for this URL.");
            const nextUrl = page.url || page.finalUrl || normalized.toString();
            setAddress(nextUrl);
            setBaseUrl(nextUrl);
            setHtmlSource(nextHtml);
            compileAndRun({ html: nextHtml, baseUrl: nextUrl });
            setPanel("browser");
        } catch (error) {
            setLoadError(statusText(error));
        } finally {
            setLoadBusy(false);
        }
    }

    function applyExample(example) {
        const nextBaseUrl = "https://example.invalid/lessons/" + example.id + "/";
        setAddress("lesson://" + example.id);
        setBaseUrl(nextBaseUrl);
        setHtmlSource(example.html);
        setCssSource(example.css);
        setJavascriptSource(example.javascript);
        setRunOriginalScripts(false);
        compileAndRun({
            html: example.html,
            css: example.css,
            javascript: example.javascript,
            baseUrl: nextBaseUrl,
            runOriginalScripts: false,
        });
        setPanel("browser");
    }

    function resetLab() {
        if (activeMarkup) {
            setAddress(activeUrl);
            setBaseUrl(activeUrl);
            setHtmlSource(activeMarkup);
            setCssSource(DEFAULT_LAB_CSS);
            setJavascriptSource(DEFAULT_LAB_JS);
            setRunOriginalScripts(false);
            compileAndRun({
                html: activeMarkup,
                css: DEFAULT_LAB_CSS,
                javascript: DEFAULT_LAB_JS,
                baseUrl: activeUrl,
                runOriginalScripts: false,
            });
        } else {
            applyExample(LEARNING_EXAMPLES[0]);
        }
    }

    const learningNotes = describeLearningTarget(inspectedElement);

    return (
        <Stack spacing={2}>
            <Paper elevation={0} sx={{ p: 1.5, borderRadius: 4, background: "rgba(2,6,23,.64)" }}>
                <Stack spacing={1.4}>
                    <Stack direction={{ xs: "column", md: "row" }} spacing={1} alignItems={{ md: "center" }}>
                        <Stack direction="row" spacing={0.7} sx={{ px: 0.5 }}>
                            <Box sx={{ width: 12, height: 12, borderRadius: "50%", background: "#ef4444" }} />
                            <Box sx={{ width: 12, height: 12, borderRadius: "50%", background: "#f59e0b" }} />
                            <Box sx={{ width: 12, height: 12, borderRadius: "50%", background: "#22c55e" }} />
                        </Stack>
                        <TextField
                            size="small"
                            value={address}
                            onChange={(event) => setAddress(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === "Enter") loadAddressInBrowser();
                            }}
                            placeholder="https://example.com/"
                            fullWidth
                            InputProps={{
                                startAdornment: <LanguageRounded sx={{ mr: 1, color: "text.secondary" }} />,
                            }}
                        />
                        <Button
                            variant="outlined"
                            startIcon={loadBusy ? <CircularProgress size={17} color="inherit" /> : <SearchRounded />}
                            disabled={loadBusy || !address.trim() || address.startsWith("lesson://")}
                            onClick={loadAddressInBrowser}
                            sx={{ whiteSpace: "nowrap" }}
                        >
                            Load URL
                        </Button>
                        <Button
                            variant="contained"
                            startIcon={<PlayArrowRounded />}
                            onClick={() => compileAndRun()}
                            sx={{ whiteSpace: "nowrap" }}
                        >
                            Run
                        </Button>
                        <Button variant="outlined" startIcon={<ClearRounded />} onClick={resetLab}>
                            Reset
                        </Button>
                    </Stack>

                    <Stack direction="row" spacing={1.2} flexWrap="wrap" useFlexGap alignItems="center">
                        <FormControlLabel
                            control={
                                <Switch
                                    checked={learningMode}
                                    onChange={(event) => {
                                        setLearningMode(event.target.checked);
                                        window.setTimeout(() => compileAndRun({ learningMode: event.target.checked }), 0);
                                    }}
                                />
                            }
                            label="Learning Mode"
                        />
                        <FormControlLabel
                            control={<Switch checked={autoRun} onChange={(event) => setAutoRun(event.target.checked)} />}
                            label="Auto-run edits"
                        />
                        <FormControlLabel
                            control={
                                <Switch
                                    checked={runOriginalScripts}
                                    onChange={(event) => {
                                        setRunOriginalScripts(event.target.checked);
                                        window.setTimeout(() => compileAndRun({ runOriginalScripts: event.target.checked }), 0);
                                    }}
                                />
                            }
                            label="Run original page scripts"
                        />
                        <TextField
                            select
                            size="small"
                            label="Window height"
                            value={frameHeight}
                            onChange={(event) => setFrameHeight(Number(event.target.value))}
                            sx={{ width: 150 }}
                        >
                            <MenuItem value={560}>560 px</MenuItem>
                            <MenuItem value={760}>760 px</MenuItem>
                            <MenuItem value={960}>960 px</MenuItem>
                            <MenuItem value={1200}>1200 px</MenuItem>
                        </TextField>
                        {pageStats && <Chip size="small" color="secondary" label={`${pageStats.interactive || 0} interactive pieces`} />}
                        {lastMutation && <Chip size="small" label={`DOM updated · ${lastMutation.mutationCount || 0} mutations`} />}
                    </Stack>
                </Stack>
            </Paper>

            {loadError && <Alert severity="error">{loadError}</Alert>}
            {runOriginalScripts && (
                <Alert severity="warning" icon={<SecurityRounded />}>
                    Original third-party scripts can make network requests and may not work inside an isolated srcDoc sandbox. Keep this off unless you trust the captured public page. The iframe does not receive same-origin access to the ScrapeWebsite application.
                </Alert>
            )}
            {learningMode && (
                <Alert severity="info" icon={<AutoAwesomeRounded />}>
                    Hover to highlight an element, then click it to inspect its HTML, selector, computed CSS, size, accessible name, and likely purpose. Buttons, inputs, custom JavaScript, DOM mutations, fetch calls, and XHR calls continue to work inside the sandbox.
                </Alert>
            )}

            <Tabs value={panel} onChange={(_, value) => setPanel(value)} variant="scrollable" scrollButtons="auto">
                <Tab value="browser" label="Browser window" icon={<LanguageRounded />} iconPosition="start" />
                <Tab value="html" label="HTML" icon={<DataObjectRounded />} iconPosition="start" />
                <Tab value="css" label="CSS" />
                <Tab value="javascript" label="JavaScript" />
                <Tab value="console" label={`Console (${consoleEntries.length + networkEntries.length})`} />
                <Tab value="learn" label="Learn and inspect" icon={<AutoAwesomeRounded />} iconPosition="start" />
            </Tabs>

            {panel === "browser" && (
                <Box
                    sx={{
                        border: "1px solid rgba(148,163,184,.26)",
                        borderRadius: 3,
                        overflow: "hidden",
                        background: "white",
                    }}
                >
                    <Box
                        component="iframe"
                        key={runVersion}
                        ref={iframeRef}
                        title="Interactive HTML, CSS, and JavaScript browser lab"
                        srcDoc={compiledDocument}
                        sandbox="allow-scripts allow-forms allow-popups allow-modals allow-downloads"
                        referrerPolicy="no-referrer"
                        sx={{ width: "100%", height: frameHeight, display: "block", border: 0, background: "white" }}
                    />
                </Box>
            )}

            {panel === "html" && (
                <SourceEditor
                    label="HTML source"
                    value={htmlSource}
                    onChange={setHtmlSource}
                    helper="Edit document structure and content. Press Run, or enable Auto-run edits."
                />
            )}

            {panel === "css" && (
                <SourceEditor
                    label="CSS source"
                    value={cssSource}
                    onChange={setCssSource}
                    helper="Edit layout, colors, typography, responsive rules, animations, and element states."
                />
            )}

            {panel === "javascript" && (
                <SourceEditor
                    label="JavaScript source"
                    value={javascriptSource}
                    onChange={setJavascriptSource}
                    helper="This code runs after the HTML is installed. Console output and fetch/XHR activity are captured below."
                />
            )}

            {panel === "console" && (
                <Stack spacing={2}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography variant="h5" fontWeight={900}>Runtime console and network</Typography>
                        <Button
                            size="small"
                            startIcon={<ClearRounded />}
                            onClick={() => {
                                setConsoleEntries([]);
                                setNetworkEntries([]);
                            }}
                        >
                            Clear
                        </Button>
                    </Stack>
                    {!consoleEntries.length && !networkEntries.length ? (
                        <Alert severity="info">Run or interact with the page to capture console messages, JavaScript errors, fetch calls, and XHR calls.</Alert>
                    ) : (
                        <Stack spacing={1} sx={{ maxHeight: 700, overflow: "auto" }}>
                            {consoleEntries.map((entry, index) => (
                                <Paper key={`console-${index}`} elevation={0} sx={{ p: 1.4, borderRadius: 3, background: "rgba(2,6,23,.52)" }}>
                                    <Stack direction="row" spacing={1} alignItems="flex-start">
                                        <Chip
                                            size="small"
                                            color={entry.level === "error" ? "error" : entry.level === "warn" ? "warning" : "default"}
                                            label={entry.level || "log"}
                                        />
                                        <Typography component="pre" variant="body2" sx={{ m: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                                            {(entry.values || []).join("\n")}
                                        </Typography>
                                    </Stack>
                                </Paper>
                            ))}
                            {networkEntries.map((entry, index) => (
                                <Paper key={`network-${index}`} elevation={0} sx={{ p: 1.4, borderRadius: 3, background: "rgba(8,47,73,.30)" }}>
                                    <Stack spacing={0.7}>
                                        <Stack direction="row" spacing={0.7} flexWrap="wrap" useFlexGap>
                                            <Chip size="small" color="secondary" label={`${entry.transport || "network"} · ${entry.method || "GET"}`} />
                                            <Chip size="small" color={entry.ok ? "success" : "error"} label={entry.status || "failed"} />
                                            <Chip size="small" label={`${entry.durationMs || 0} ms`} />
                                            {entry.contentType && <Chip size="small" variant="outlined" label={entry.contentType.slice(0, 60)} />}
                                        </Stack>
                                        <Typography variant="body2" sx={{ wordBreak: "break-all" }}>{entry.url}</Typography>
                                        {(entry.responsePreview || entry.error) && (
                                            <CodeViewer value={entry.responsePreview || entry.error} maxHeight={230} />
                                        )}
                                    </Stack>
                                </Paper>
                            ))}
                        </Stack>
                    )}
                </Stack>
            )}

            {panel === "learn" && (
                <Stack spacing={2.5}>
                    <Stack spacing={0.5}>
                        <Typography variant="h5" fontWeight={900}>Working lessons</Typography>
                        <Typography color="text.secondary">
                            Load a complete example, interact with it in the browser window, inspect its elements, then change the HTML, CSS, and JavaScript to see what each layer controls.
                        </Typography>
                    </Stack>
                    <Grid container spacing={1.5}>
                        {LEARNING_EXAMPLES.map((example) => (
                            <Grid item xs={12} md={4} key={example.id}>
                                <Paper elevation={0} sx={{ p: 2, height: "100%", borderRadius: 4, background: "rgba(2,6,23,.44)" }}>
                                    <Stack spacing={1.2} height="100%">
                                        <Typography variant="h6" fontWeight={900}>{example.title}</Typography>
                                        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>{example.description}</Typography>
                                        <Button variant="outlined" startIcon={<PlayArrowRounded />} onClick={() => applyExample(example)}>
                                            Load lesson
                                        </Button>
                                    </Stack>
                                </Paper>
                            </Grid>
                        ))}
                    </Grid>

                    <Divider />

                    <Stack spacing={1.5}>
                        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                            <Typography variant="h5" fontWeight={900}>Selected element</Typography>
                            {inspectedElement && <CopyIconButton value={JSON.stringify(inspectedElement, null, 2)} />}
                        </Stack>
                        {!inspectedElement ? (
                            <Alert severity="info">Open the Browser window with Learning Mode enabled, hover over a piece, and click it.</Alert>
                        ) : (
                            <Grid container spacing={1.5}>
                                <Grid item xs={12} lg={5}>
                                    <Paper elevation={0} sx={{ p: 2, borderRadius: 4, background: "rgba(2,6,23,.44)", height: "100%" }}>
                                        <Stack spacing={1.2}>
                                            <Stack direction="row" spacing={0.7} flexWrap="wrap" useFlexGap>
                                                <Chip color="secondary" label={`<${inspectedElement.tag}>`} />
                                                {inspectedElement.role && <Chip label={`role=${inspectedElement.role}`} />}
                                                {inspectedElement.type && <Chip label={`type=${inspectedElement.type}`} />}
                                                <Chip label={`${inspectedElement.bounds?.width || 0}×${inspectedElement.bounds?.height || 0}px`} />
                                            </Stack>
                                            <Typography variant="body2"><strong>Accessible name:</strong> {inspectedElement.accessibleName || "None"}</Typography>
                                            <Typography variant="body2"><strong>Selector:</strong> {inspectedElement.selector || "Unavailable"}</Typography>
                                            {learningNotes.map((note) => (
                                                <Typography key={note} variant="body2" color="text.secondary">• {note}</Typography>
                                            ))}
                                        </Stack>
                                    </Paper>
                                </Grid>
                                <Grid item xs={12} lg={7}>
                                    <Stack spacing={1.5}>
                                        <Typography fontWeight={900}>Element HTML</Typography>
                                        <CodeViewer value={inspectedElement.html} maxHeight={270} />
                                        <Typography fontWeight={900}>Computed CSS</Typography>
                                        <CodeViewer value={JSON.stringify(inspectedElement.styles || {}, null, 2)} maxHeight={270} />
                                    </Stack>
                                </Grid>
                            </Grid>
                        )}
                    </Stack>

                    {pageStats && (
                        <Stack spacing={1}>
                            <Typography variant="h6" fontWeight={900}>Current document map</Typography>
                            <Stack direction="row" spacing={0.8} flexWrap="wrap" useFlexGap>
                                {Object.entries(pageStats).map(([name, value]) => (
                                    <Chip key={name} size="small" label={`${name}: ${value}`} />
                                ))}
                            </Stack>
                        </Stack>
                    )}
                </Stack>
            )}
        </Stack>
    );
}

function SourceEditor({ label, value, onChange, helper }) {
    return (
        <Stack spacing={1.2}>
            <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={1}>
                <Box>
                    <Typography variant="h5" fontWeight={900}>{label}</Typography>
                    <Typography variant="body2" color="text.secondary">{helper}</Typography>
                </Box>
                <CopyIconButton value={value} />
            </Stack>
            <TextField
                value={value}
                onChange={(event) => onChange(event.target.value)}
                multiline
                minRows={24}
                fullWidth
                inputProps={{ spellCheck: false }}
                sx={{
                    "& textarea": {
                        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                        fontSize: 13,
                        lineHeight: 1.55,
                        tabSize: 2,
                    },
                }}
            />
        </Stack>
    );
}

function PreviewPanel({ pages, activePage, activePageUrl, setActivePageUrl }) {
    const [view, setView] = useState("browser");
    const screenshot = activePage?.screenshot || activePage?.raw?.screenshotDataUrl || "";
    const activeHtml = activePage?.html || activePage?.raw?.renderedHtml || "";
    const activeText = activePage?.text || activePage?.raw?.textPreview || "";

    return (
        <Stack spacing={2}>
            <Stack
                direction={{ xs: "column", md: "row" }}
                alignItems={{ xs: "stretch", md: "center" }}
                justifyContent="space-between"
                spacing={1.5}
            >
                {pages.length > 0 ? (
                    <TextField
                        select
                        label="Loaded workspace page"
                        value={activePage?.url || activePageUrl}
                        onChange={(event) => setActivePageUrl(event.target.value)}
                        sx={{ minWidth: { md: 420 } }}
                    >
                        {pages.map((page) => (
                            <MenuItem key={page.url} value={page.url}>
                                {page.title || page.url}
                            </MenuItem>
                        ))}
                    </TextField>
                ) : (
                    <Stack spacing={0.4}>
                        <Typography variant="h5" fontWeight={900}>Interactive browser window</Typography>
                        <Typography variant="body2" color="text.secondary">
                            Start with a working lesson or load a public URL directly through the rendered-browser route.
                        </Typography>
                    </Stack>
                )}
                <Tabs value={view} onChange={(_, value) => setView(value)} variant="scrollable" scrollButtons="auto">
                    <Tab value="browser" label="Browser Lab" />
                    <Tab value="screenshot" label="Screenshot" disabled={!activePage} />
                    <Tab value="html" label="Captured HTML" disabled={!activePage} />
                    <Tab value="text" label="Extracted text" disabled={!activePage} />
                </Tabs>
            </Stack>

            {activePage && (
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Chip label={activePage.status || "status unknown"} color={activePage.status >= 400 ? "error" : "success"} />
                    <Chip label={activePage.source || "page"} variant="outlined" />
                    <Button href={activePage.url} target="_blank" rel="noreferrer" startIcon={<OpenInNewRounded />}>
                        Open original
                    </Button>
                </Stack>
            )}

            {view === "browser" && <InteractiveBrowserLab activePage={activePage} />}

            {view === "screenshot" && (
                screenshot ? (
                    <Box
                        component="img"
                        src={screenshot.startsWith("data:") ? screenshot : `data:image/png;base64,${screenshot}`}
                        alt={`Rendered screenshot of ${activePage?.title || activePage?.url}`}
                        sx={{ width: "100%", borderRadius: 3, border: "1px solid rgba(148,163,184,.24)" }}
                    />
                ) : (
                    <Alert severity="info">No screenshot was returned for this page.</Alert>
                )
            )}

            {view === "html" && <CodeViewer value={activeHtml} />}
            {view === "text" && <CodeViewer value={activeText} />}
        </Stack>
    );
}


function ResourcePanel({ resources, filter, setFilter, selectedUrls, toggleResource }) {
    return (
        <Stack spacing={2}>
            <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={1.5}>
                <Stack spacing={0.4}>
                    <Typography variant="h5" fontWeight={900}>Discovered resources</Typography>
                    <Typography color="text.secondary">
                        Select links from different sites, then cross-examine them through the bounded batch scraper.
                    </Typography>
                </Stack>
                <TextField select label="Filter" value={filter} onChange={(event) => setFilter(event.target.value)} sx={{ minWidth: 180 }}>
                    <MenuItem value="all">All</MenuItem>
                    <MenuItem value="page">Pages</MenuItem>
                    <MenuItem value="link">Links</MenuItem>
                    <MenuItem value="api">APIs</MenuItem>
                    <MenuItem value="image">Images</MenuItem>
                    <MenuItem value="media">Audio/video/manifests</MenuItem>
                    <MenuItem value="asset">Scripts/styles/assets</MenuItem>
                    <MenuItem value="cdn">CDN resources</MenuItem>
                </TextField>
            </Stack>

            {!resources.length ? (
                <EmptyState icon={<HubRounded />} title="No matching resources" description="Change the filter or run a browser research crawl." />
            ) : (
                <Stack spacing={1} sx={{ maxHeight: 850, overflow: "auto" }}>
                    {resources.slice(0, 500).map((item) => (
                        <ResourceRow
                            key={item.url}
                            item={item}
                            selected={selectedUrls.has(item.url)}
                            onToggle={() => toggleResource(item.url)}
                        />
                    ))}
                </Stack>
            )}
        </Stack>
    );
}

function ResourceRow({ item, selected, onToggle }) {
    return (
        <Paper elevation={0} sx={{ p: 1.5, borderRadius: 3, background: "rgba(2,6,23,.42)" }}>
            <Stack direction={{ xs: "column", md: "row" }} spacing={1.2} alignItems={{ xs: "stretch", md: "center" }}>
                <IconButton onClick={onToggle} color={selected ? "secondary" : "default"}>
                    {selected ? <CheckBoxRounded /> : <CheckBoxOutlineBlankRounded />}
                </IconButton>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" spacing={0.7} alignItems="center" flexWrap="wrap" useFlexGap>
                        <Chip size="small" label={item.kind} color={item.kind === "api" ? "secondary" : "default"} />
                        {item.isCdn && <Chip size="small" label="CDN" color="success" />}
                        {item.status && <Chip size="small" label={item.status} variant="outlined" />}
                        {item.contentType && <Chip size="small" label={item.contentType.slice(0, 42)} variant="outlined" />}
                    </Stack>
                    <Typography variant="body2" sx={{ mt: 0.7, wordBreak: "break-all" }}>
                        {item.url}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                        {item.source || "discovered"}{item.size ? ` · ${item.size.toLocaleString()} bytes` : ""}
                    </Typography>
                </Box>
                <Stack direction="row" spacing={0.5}>
                    <CopyIconButton value={item.url} />
                    <Tooltip title="Open">
                        <IconButton component="a" href={item.url} target="_blank" rel="noreferrer">
                            <OpenInNewRounded />
                        </IconButton>
                    </Tooltip>
                </Stack>
            </Stack>
        </Paper>
    );
}

function ApiPanel({ resources, selectedUrls, toggleResource }) {
    if (!resources.length) {
        return <EmptyState icon={<ApiRounded />} title="No API calls found" description="Enable API discovery or rendered browser capture and load a page that makes fetch/XHR requests." />;
    }

    return (
        <Stack spacing={1.5}>
            <Stack spacing={0.4}>
                <Typography variant="h5" fontWeight={900}>API calls and response previews</Typography>
                <Typography color="text.secondary">
                    Request headers and bodies remain bounded. Credentials should be redacted by the backend before results reach this interface.
                </Typography>
            </Stack>
            {resources.slice(0, 300).map((item) => (
                <ApiCard
                    key={item.url}
                    item={item}
                    selected={selectedUrls.has(item.url)}
                    onToggle={() => toggleResource(item.url)}
                />
            ))}
        </Stack>
    );
}

function ApiCard({ item, selected, onToggle }) {
    const [open, setOpen] = useState(false);
    return (
        <Paper elevation={0} sx={{ p: 1.7, borderRadius: 3, background: "rgba(2,6,23,.42)" }}>
            <Stack spacing={1.2}>
                <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={1}>
                    <Stack direction="row" spacing={1} alignItems="flex-start" sx={{ minWidth: 0 }}>
                        <Checkbox checked={selected} onChange={onToggle} />
                        <Box sx={{ minWidth: 0 }}>
                            <Stack direction="row" spacing={0.7} flexWrap="wrap" useFlexGap>
                                <Chip size="small" color="secondary" label={item.method || "GET"} />
                                {item.status && <Chip size="small" label={`HTTP ${item.status}`} color={item.status >= 400 ? "error" : "success"} />}
                                {item.contentType && <Chip size="small" variant="outlined" label={item.contentType.slice(0, 50)} />}
                            </Stack>
                            <Typography variant="body2" sx={{ mt: 0.7, wordBreak: "break-all" }}>{item.url}</Typography>
                        </Box>
                    </Stack>
                    <Stack direction="row" spacing={0.5}>
                        <Button size="small" onClick={() => setOpen((value) => !value)}>{open ? "Hide response" : "Response"}</Button>
                        <CopyIconButton value={item.url} />
                        <IconButton component="a" href={item.url} target="_blank" rel="noreferrer"><OpenInNewRounded /></IconButton>
                    </Stack>
                </Stack>
                {open && (
                    <CodeViewer value={item.responsePreview || JSON.stringify(item.metadata || {}, null, 2) || "No response preview captured."} maxHeight={420} />
                )}
            </Stack>
        </Paper>
    );
}

function AssetPanel({ workspace, selectedUrls, toggleResource }) {
    const images = workspace.byKind?.image || [];
    const media = [
        ...(workspace.byKind?.audio || []),
        ...(workspace.byKind?.video || []),
        ...(workspace.byKind?.manifest || []),
    ];
    const cdn = workspace.byKind?.cdn || [];

    return (
        <Stack spacing={3}>
            <AssetSection title="Images" icon={<ImageRounded />} items={images} selectedUrls={selectedUrls} toggleResource={toggleResource} visual />
            <Divider />
            <AssetSection title="Audio, video, and manifests" icon={<VideoLibraryRounded />} items={media} selectedUrls={selectedUrls} toggleResource={toggleResource} />
            <Divider />
            <AssetSection title="CDN resources" icon={<StorageRounded />} items={cdn} selectedUrls={selectedUrls} toggleResource={toggleResource} />
        </Stack>
    );
}

function AssetSection({ title, icon, items, selectedUrls, toggleResource, visual = false }) {
    return (
        <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} alignItems="center">
                {icon}
                <Typography variant="h5" fontWeight={900}>{title}</Typography>
                <Chip size="small" label={items.length} />
            </Stack>
            {!items.length ? (
                <Typography color="text.secondary">None discovered.</Typography>
            ) : visual ? (
                <Grid container spacing={1.5}>
                    {items.slice(0, 120).map((item) => (
                        <Grid item xs={6} md={4} lg={3} key={item.url}>
                            <Paper elevation={0} sx={{ p: 1, borderRadius: 3, background: "rgba(2,6,23,.42)", height: "100%" }}>
                                <Box
                                    component="img"
                                    src={item.url}
                                    alt="Discovered resource"
                                    loading="lazy"
                                    referrerPolicy="no-referrer"
                                    sx={{ width: "100%", height: 150, objectFit: "contain", borderRadius: 2, background: "rgba(255,255,255,.06)" }}
                                />
                                <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 0.7 }}>
                                    <Checkbox checked={selectedUrls.has(item.url)} onChange={() => toggleResource(item.url)} />
                                    <IconButton component="a" href={item.url} target="_blank" rel="noreferrer" size="small"><OpenInNewRounded fontSize="small" /></IconButton>
                                </Stack>
                                <Typography variant="caption" sx={{ display: "block", wordBreak: "break-all" }}>{item.url}</Typography>
                            </Paper>
                        </Grid>
                    ))}
                </Grid>
            ) : (
                <Stack spacing={1}>
                    {items.slice(0, 200).map((item) => (
                        <ResourceRow key={item.url} item={item} selected={selectedUrls.has(item.url)} onToggle={() => toggleResource(item.url)} />
                    ))}
                </Stack>
            )}
        </Stack>
    );
}

function ComparePanel({ comparison, queryRuns, selectedResources }) {
    if (!comparison?.records?.length && !queryRuns.length) {
        return <EmptyState icon={<CompareArrowsRounded />} title="Nothing to compare yet" description="Run a multi-site crawl, a query matrix, or select resources and press Cross-examine." />;
    }

    return (
        <Stack spacing={2.5}>
            {queryRuns.length > 0 && (
                <Stack spacing={1.2}>
                    <Typography variant="h5" fontWeight={900}>Query matrix results</Typography>
                    {queryRuns.map((run) => (
                        <Paper key={`${run.query}-${run.url}`} elevation={0} sx={{ p: 1.5, borderRadius: 3, background: "rgba(2,6,23,.42)" }}>
                            <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={1}>
                                <Box>
                                    <Typography fontWeight={900}>{run.query}</Typography>
                                    <Typography variant="body2" color="text.secondary" sx={{ wordBreak: "break-all" }}>{run.url}</Typography>
                                </Box>
                                <Stack direction="row" spacing={0.7} flexWrap="wrap" useFlexGap>
                                    <Chip size="small" color={run.ok ? "success" : "error"} label={run.ok ? "Completed" : "Failed"} />
                                    {run.status && <Chip size="small" label={`HTTP ${run.status}`} />}
                                    {run.ok && <Chip size="small" label={`${run.textLength || 0} text chars`} />}
                                </Stack>
                            </Stack>
                            {run.error && <Alert severity="error" sx={{ mt: 1 }}>{run.error}</Alert>}
                        </Paper>
                    ))}
                </Stack>
            )}

            {comparison?.records?.length > 0 && (
                <Stack spacing={1.5}>
                    <Typography variant="h5" fontWeight={900}>Cross-site comparison</Typography>
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                        {(comparison.summary?.hosts || []).map((host) => <Chip key={host} label={host} color="secondary" />)}
                        {(comparison.summary?.allPriceValues || []).slice(0, 18).map((price) => <Chip key={price} label={price} color="success" variant="outlined" />)}
                    </Stack>
                    <Grid container spacing={1.5}>
                        {comparison.records.map((record) => (
                            <Grid item xs={12} md={6} key={record.id}>
                                <Paper elevation={0} sx={{ p: 2, borderRadius: 4, background: "rgba(2,6,23,.42)", height: "100%" }}>
                                    <Stack spacing={1.2}>
                                        <Typography variant="h6" fontWeight={900}>{record.title}</Typography>
                                        <Typography variant="body2" color="text.secondary" sx={{ wordBreak: "break-all" }}>{record.url}</Typography>
                                        <Stack direction="row" spacing={0.7} flexWrap="wrap" useFlexGap>
                                            <Chip size="small" label={`${record.textLength} text chars`} />
                                            <Chip size="small" label={`${record.imageCount} images`} />
                                            <Chip size="small" label={`${record.apiCount} APIs`} />
                                            {record.status && <Chip size="small" label={`HTTP ${record.status}`} />}
                                        </Stack>
                                        {record.prices.length > 0 && (
                                            <Typography variant="body2">Prices: {record.prices.slice(0, 12).join(", ")}</Typography>
                                        )}
                                        {record.description && <Typography color="text.secondary">{record.description}</Typography>}
                                    </Stack>
                                </Paper>
                            </Grid>
                        ))}
                    </Grid>
                </Stack>
            )}

            {selectedResources.length > 0 && (
                <Alert severity="info">
                    {selectedResources.length} workspace resources are currently selected. Cross-examination extracts public page representations; an image URL alone may return binary metadata rather than visual authenticity evidence.
                </Alert>
            )}

            <Alert severity="warning">
                Marketplace authenticity cannot be guaranteed from scraping alone. Treat the comparison as evidence collection and verify tags, measurements, serial/style codes, stitching, materials, seller history, provenance, return policy, and platform authentication independently.
            </Alert>
        </Stack>
    );
}

function JsonViewer({ value }) {
    return <CodeViewer value={JSON.stringify(value, null, 2)} maxHeight={900} />;
}

function CodeViewer({ value, maxHeight = 700 }) {
    return (
        <Box
            component="pre"
            sx={{
                m: 0,
                p: 2,
                maxHeight,
                overflow: "auto",
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
                borderRadius: 3,
                fontSize: 12,
                lineHeight: 1.55,
                background: "rgba(0,0,0,.38)",
                border: "1px solid rgba(148,163,184,.14)",
            }}
        >
            {String(value || "No data available.")}
        </Box>
    );
}

function CopyIconButton({ value }) {
    const [copied, setCopied] = useState(false);
    return (
        <Tooltip title={copied ? "Copied" : "Copy"}>
            <IconButton
                size="small"
                onClick={async () => {
                    try {
                        await navigator.clipboard.writeText(String(value || ""));
                        setCopied(true);
                        window.setTimeout(() => setCopied(false), 1_200);
                    } catch {
                        setCopied(false);
                    }
                }}
            >
                <ContentCopyRounded fontSize="small" />
            </IconButton>
        </Tooltip>
    );
}

function uniquePageRecords(pages) {
    const map = new Map();
    for (const page of pages || []) {
        if (!page?.url) continue;
        const current = map.get(page.url);
        if (!current || String(page.html || "").length > String(current.html || "").length) {
            map.set(page.url, page);
        }
    }
    return [...map.values()];
}

function mergeUniqueResources(resources) {
    const map = new Map();
    for (const item of resources || []) {
        if (!item?.url) continue;
        const current = map.get(item.url);
        map.set(item.url, current ? { ...current, ...item } : item);
    }
    return [...map.values()];
}


function groupResources(resources) {
    const source = Array.isArray(resources) ? resources : [];
    const kinds = ["api", "image", "audio", "video", "manifest", "page", "asset", "link"];
    const grouped = Object.fromEntries(
        kinds.map((kind) => [kind, source.filter((item) => item?.kind === kind)])
    );

    grouped.cdn = source.filter((item) => Boolean(item?.isCdn));
    return grouped;
}
