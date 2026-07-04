import React, { useMemo, useState } from "react";
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

const scrapeOptions = [
    {
        value: "research",
        label: "Enterprise research crawl",
        helper: "Balanced source routing for articles, references, official pages, headings, summaries, links, and page text.",
    },
    {
        value: "product",
        label: "Product / resale intelligence",
        helper: "Prioritizes resale marketplaces, fashion sites, Japan/Korea proxy sources, product pages, prices, and listing links.",
    },
    {
        value: "links",
        label: "Link / CDN / API discovery",
        helper: "Finds page branches, static bundles, CDN assets, JSON-looking routes, API hints, images, scripts, and hidden references.",
    },
    {
        value: "news",
        label: "News / source briefing",
        helper: "Routes to official news, reference, science, space, and culture sources depending on query intent.",
    },
    {
        value: "quick",
        label: "Quick seed scan",
        helper: "Fast seed-page scan with shallow extraction. Useful when you only need title, description, and top links.",
    },
];

const defaultSettings = {
    maxSources: 8,
    crawlDepth: 1,
    branchLimit: 4,
    includeCdn: true,
    includeExternalBranches: false,
    assetProbeLimit: 3,
};

function extractUrlsFromText(value) {
    const matches = String(value || "").match(/https?:\/\/[^\s"'<>]+/gi) || [];

    return [...new Set(matches)]
        .map((url) => url.trim().replace(/[),.;]+$/, ""))
        .filter(Boolean)
        .slice(0, 8);
}

function selectedOptionLabel(mode) {
    return scrapeOptions.find((item) => item.value === mode)?.label || mode;
}

function safeList(value) {
    return Array.isArray(value) ? value : [];
}

function shortUrl(url, max = 92) {
    const text = String(url || "");
    return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

export default function Scrape() {
    const [query, setQuery] = useState("");
    const [mode, setMode] = useState("research");
    const [settings, setSettings] = useState(defaultSettings);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");
    const [results, setResults] = useState([]);
    const [responseMeta, setResponseMeta] = useState(null);

    const extractedUrls = useMemo(() => extractUrlsFromText(query), [query]);

    const activeOption = useMemo(() => {
        return scrapeOptions.find((item) => item.value === mode) || scrapeOptions[0];
    }, [mode]);

    const selectedSources = safeList(responseMeta?.selectedSources);
    const intents = safeList(responseMeta?.intents);
    const metrics = responseMeta?.metrics || {};
    const discovered = responseMeta?.discovered || {};

    function updateSetting(key, value) {
        setSettings((current) => ({
            ...current,
            [key]: value,
        }));
    }

    async function startScrape() {
        setError("");
        setMessage("");

        const cleanedQuery = query.trim();

        if (!cleanedQuery) {
            setError("Enter a query, product name, topic, or URL first.");
            return;
        }

        setLoading(true);

        try {
            const response = await fetch("/api/query-scrape", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    query: cleanedQuery,
                    mode,
                    urls: extractedUrls,
                    maxSources: settings.maxSources,
                    crawlDepth: settings.crawlDepth,
                    branchLimit: settings.branchLimit,
                    includeCdn: settings.includeCdn,
                    includeExternalBranches: settings.includeExternalBranches,
                    assetProbeLimit: settings.assetProbeLimit,
                }),
            });

            const data = await response.json();

            if (!response.ok || !data.ok) {
                throw new Error(data.error || "Query scrape failed.");
            }

            const nextResults = Array.isArray(data.results) ? data.results : [];

            setResults(nextResults.slice(0, 80));
            setResponseMeta(data);
            setMessage(data.message || `Finished ${selectedOptionLabel(mode).toLowerCase()} for "${cleanedQuery}".`);
        } catch (err) {
            setError(err.message || "Query scrape failed.");
        } finally {
            setLoading(false);
        }
    }

    function clearAll() {
        setQuery("");
        setError("");
        setMessage("");
        setResults([]);
        setResponseMeta(null);
        setSettings(defaultSettings);
    }

    return (
        <PageShell
            eyebrow="Enterprise source intelligence"
            title="Query, scrape, branch, and discover CDN links."
            description="Enter a topic, product, source name, or direct URL. The Cloudflare Function routes the query to official source sites, crawls selected branches, and extracts page links, API hints, static assets, and CDN references."
            actions={
                <Button
                    variant="outlined"
                    startIcon={<ClearRounded />}
                    onClick={clearAll}
                    disabled={loading && results.length === 0}
                >
                    Clear
                </Button>
            }
        >
            <Grid container spacing={2.5}>
                <Grid item xs={12} lg={5}>
                    <Stack spacing={2.5}>
                        <GlassCard>
                            <Stack spacing={2.5}>
                                <Stack spacing={0.8}>
                                    <Typography variant="h5" fontWeight={900}>
                                        Start an intelligent scrape
                                    </Typography>

                                    <Typography color="text.secondary">
                                        Use one box for everything. Paste URLs for direct crawling, or type a normal query and let source routing choose the best official sites.
                                    </Typography>
                                </Stack>

                                <TextField
                                    label="Query, source, product, topic, or URL"
                                    value={query}
                                    onChange={(event) => setQuery(event.target.value)}
                                    fullWidth
                                    multiline
                                    minRows={4}
                                    placeholder={
                                        "Examples:\nraf simons hoodie resale mercari japan grailed\nspaceX starship launch latest\nhttps://example.com\nFind CDN bundles and hidden API-looking routes"
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
                                            <TuneRounded fontSize="small" sx={{ mr: 1, color: "text.secondary" }} />
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
                                        border: "1px solid rgba(148, 163, 184, 0.12)",
                                    }}
                                >
                                    <Stack spacing={1.2}>
                                        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                                            <Chip size="small" color="secondary" icon={<SearchRounded />} label={activeOption.label} />
                                            <Chip size="small" variant="outlined" icon={<AccountTreeRounded />} label={`Depth ${settings.crawlDepth}`} />
                                            <Chip size="small" variant="outlined" icon={<HubRounded />} label={`${settings.branchLimit} branches/page`} />
                                            <Chip size="small" variant="outlined" label={`${settings.assetProbeLimit} asset probes`} />
                                            {extractedUrls.length > 0 && (
                                                <Chip size="small" color="success" label={`${extractedUrls.length} URL${extractedUrls.length === 1 ? "" : "s"} detected`} />
                                            )}
                                        </Stack>

                                        <Typography variant="body2" color="text.secondary">
                                            {activeOption.helper}
                                        </Typography>
                                    </Stack>
                                </Paper>

                                <CrawlerControls settings={settings} updateSetting={updateSetting} loading={loading} />

                                <Button
                                    size="large"
                                    variant="contained"
                                    startIcon={<PlayArrowRounded />}
                                    onClick={startScrape}
                                    disabled={loading || !query.trim()}
                                    sx={{ minHeight: 54, fontSize: "1rem" }}
                                >
                                    {loading ? "Running enterprise crawl..." : "Start Intelligence Crawl"}
                                </Button>

                                <LoadingBar loading={loading} />

                                {error && <Alert severity="error">{error}</Alert>}
                                {message && !error && <Alert severity="success">{message}</Alert>}

                                <Alert severity="info" icon={<SecurityRounded />}>
                                    This uses direct requests to source-specific official URLs. It does not bypass logins, paywalls, anti-bot blocks, or private pages. Server-blocked sources return an official fallback link.
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
                                    alignItems={{ xs: "flex-start", md: "center" }}
                                    justifyContent="space-between"
                                    spacing={1}
                                >
                                    <Stack spacing={0.5}>
                                        <Typography variant="h5" fontWeight={900}>
                                            Intelligence results
                                        </Typography>

                                        <Typography color="text.secondary">
                                            Crawled pages, branched pages, source API results, CDN links, API hints, and extracted page data appear here.
                                        </Typography>
                                    </Stack>

                                    <Chip
                                        icon={<ManageSearchRounded />}
                                        label={`${results.length} result${results.length === 1 ? "" : "s"}`}
                                        variant="outlined"
                                    />
                                </Stack>

                                <Divider />

                                {responseMeta && (
                                    <ResponseSummary
                                        responseMeta={responseMeta}
                                        metrics={metrics}
                                        intents={intents}
                                        selectedSources={selectedSources}
                                    />
                                )}

                                {safeList(discovered.cdn).length > 0 || safeList(discovered.api).length > 0 || safeList(discovered.branches).length > 0 ? (
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
                                        description="Enter a query or URL, tune the branch/depth controls, and press Start Intelligence Crawl."
                                    />
                                ) : (
                                    <Stack spacing={2}>
                                        {results.map((result, index) => (
                                            <EnterpriseResultCard
                                                key={`${result?.source || "source"}-${result?.url || result?.title || "result"}-${index}`}
                                                result={result}
                                            />
                                        ))}
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
                <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                    <Stack spacing={0.3}>
                        <Typography fontWeight={900}>Crawler controls</Typography>
                        <Typography variant="body2" color="text.secondary">
                            Higher depth and branch count means more discovery, but more source requests.
                        </Typography>
                    </Stack>
                    <TuneRounded color="secondary" />
                </Stack>

                <Box>
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography variant="body2" fontWeight={800}>Max sources</Typography>
                        <Chip size="small" label={settings.maxSources} />
                    </Stack>
                    <Slider
                        value={settings.maxSources}
                        min={1}
                        max={16}
                        step={1}
                        disabled={loading}
                        onChange={(_, value) => updateSetting("maxSources", value)}
                    />
                </Box>

                <Box>
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography variant="body2" fontWeight={800}>Branch depth</Typography>
                        <Chip size="small" label={settings.crawlDepth} />
                    </Stack>
                    <Slider
                        value={settings.crawlDepth}
                        min={0}
                        max={2}
                        step={1}
                        disabled={loading}
                        marks={[{ value: 0, label: "Seed" }, { value: 1, label: "Branch" }, { value: 2, label: "Deep" }]}
                        onChange={(_, value) => updateSetting("crawlDepth", value)}
                    />
                </Box>

                <Box>
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography variant="body2" fontWeight={800}>Branches per page</Typography>
                        <Chip size="small" label={settings.branchLimit} />
                    </Stack>
                    <Slider
                        value={settings.branchLimit}
                        min={0}
                        max={8}
                        step={1}
                        disabled={loading}
                        onChange={(_, value) => updateSetting("branchLimit", value)}
                    />
                </Box>

                <Box>
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography variant="body2" fontWeight={800}>CDN JS/CSS/JSON probes</Typography>
                        <Chip size="small" label={settings.assetProbeLimit} />
                    </Stack>
                    <Slider
                        value={settings.assetProbeLimit}
                        min={0}
                        max={6}
                        step={1}
                        disabled={loading || !settings.includeCdn}
                        onChange={(_, value) => updateSetting("assetProbeLimit", value)}
                    />
                </Box>

                <Stack spacing={0.5}>
                    <FormControlLabel
                        control={
                            <Switch
                                checked={settings.includeCdn}
                                disabled={loading}
                                onChange={(event) => updateSetting("includeCdn", event.target.checked)}
                            />
                        }
                        label="Hunt CDN/static asset links"
                    />
                    <FormControlLabel
                        control={
                            <Switch
                                checked={settings.includeExternalBranches}
                                disabled={loading}
                                onChange={(event) => updateSetting("includeExternalBranches", event.target.checked)}
                            />
                        }
                        label="Allow external page branching"
                    />
                </Stack>
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
                        <MetricCard icon={<PublicRounded />} label="Sources" value={selectedSources.length} />
                    </Grid>
                    <Grid item xs={6} md={3}>
                        <MetricCard icon={<AccountTreeRounded />} label="Branched" value={metrics.branchedPages || 0} />
                    </Grid>
                    <Grid item xs={6} md={3}>
                        <MetricCard icon={<ImageSearchRounded />} label="CDN links" value={metrics.cdnLinks || 0} />
                    </Grid>
                    <Grid item xs={6} md={3}>
                        <MetricCard icon={<DataObjectRounded />} label="API hints" value={metrics.apiHints || 0} />
                    </Grid>
                </Grid>

                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    {intents.map((intent) => (
                        <Chip key={intent} size="small" label={intent} color="secondary" variant="outlined" />
                    ))}
                    <Chip size="small" label={`${responseMeta.elapsedMs || 0} ms`} variant="outlined" />
                    <Chip size="small" label={responseMeta.requestId || "request"} variant="outlined" />
                </Stack>

                {selectedSources.length > 0 && (
                    <Stack spacing={1}>
                        <Typography variant="body2" color="text.secondary" fontWeight={800}>
                            Selected official/source-specific routes
                        </Typography>
                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                            {selectedSources.map((source) => (
                                <Tooltip key={source.id} title={`${source.group} • score ${source.score}`}>
                                    <Chip size="small" label={source.label} variant="outlined" />
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
                <Typography variant="caption" color="text.secondary" fontWeight={800}>
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
                    <Typography fontWeight={950}>Discovered crawl intelligence</Typography>
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
    const visible = items.slice(0, 8);

    return (
        <Stack spacing={1}>
            <Stack direction="row" spacing={1} alignItems="center">
                <Box sx={{ color: "text.secondary", display: "flex" }}>{icon}</Box>
                <Typography variant="body2" fontWeight={900}>{title}</Typography>
                <Chip size="small" label={items.length} variant="outlined" />
            </Stack>

            {visible.length === 0 ? (
                <Typography variant="body2" color="text.secondary">{empty}</Typography>
            ) : (
                <Stack spacing={0.7}>
                    {visible.map((item) => (
                        <Stack
                            key={item.url}
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
                            <Typography variant="caption" color="text.secondary" sx={{ wordBreak: "break-all" }}>
                                {shortUrl(item.url)}
                            </Typography>
                            <Button href={item.url} target="_blank" rel="noreferrer" size="small" endIcon={<OpenInNewRounded />}>
                                Open
                            </Button>
                        </Stack>
                    ))}
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
                        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                            <Chip size="small" label={result?.sourceLabel || result?.source || "Source"} color={isError ? "error" : "secondary"} />
                            <Chip size="small" label={result?.type || "result"} variant="outlined" />
                            {result?.rank && <Chip size="small" label={`#${result.rank}`} variant="outlined" />}
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
                        <Button href={result.url} target="_blank" rel="noreferrer" variant="outlined" size="small" endIcon={<OpenInNewRounded />}>
                            Open
                        </Button>
                    )}
                </Stack>

                {result?.description && (
                    <Typography color="text.secondary">
                        {result.description}
                    </Typography>
                )}

                {result?.error && <Alert severity="warning">{result.error}</Alert>}

                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    {result?.price && <Chip size="small" label={result.price} color="success" />}
                    {result?.condition && <Chip size="small" label={result.condition} variant="outlined" />}
                    {result?.seller && <Chip size="small" label={`Seller: ${result.seller}`} variant="outlined" />}
                    {result?.stars !== undefined && <Chip size="small" label={`${result.stars} stars`} variant="outlined" />}
                    {result?.language && <Chip size="small" label={result.language} variant="outlined" />}
                    {result?.comments !== undefined && <Chip size="small" label={`${result.comments} comments`} variant="outlined" />}
                    {result?.subreddit && <Chip size="small" label={`r/${result.subreddit}`} variant="outlined" />}
                </Stack>

                {result?.image && (
                    <Box
                        component="img"
                        src={result.image}
                        alt={result.title || "Result image"}
                        sx={{
                            width: "100%",
                            maxHeight: 220,
                            objectFit: "cover",
                            borderRadius: 4,
                            border: "1px solid rgba(148, 163, 184, 0.18)",
                        }}
                    />
                )}

                {result?.url && (
                    <Stack direction="row" spacing={1} alignItems="center">
                        <LinkRounded fontSize="small" color="disabled" />
                        <Typography variant="caption" color="text.secondary" sx={{ wordBreak: "break-all" }}>
                            {result.url}
                        </Typography>
                    </Stack>
                )}
            </Stack>
        </Paper>
    );
}
