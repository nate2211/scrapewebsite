import React, { useMemo, useState } from "react";
import {
    ClearRounded,
    ManageSearchRounded,
    PlayArrowRounded,
    SearchRounded,
    TuneRounded,
} from "@mui/icons-material";
import {
    Alert,
    Box,
    Button,
    Chip,
    Divider,
    Grid,
    MenuItem,
    Paper,
    Stack,
    TextField,
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
        label: "Research extraction",
        helper:
            "Best for articles, websites, links, headings, descriptions, and page text.",
    },
    {
        value: "product",
        label: "Product / resale extraction",
        helper:
            "Best for prices, product pages, item descriptions, image links, and resale research.",
    },
    {
        value: "links",
        label: "Link / API discovery",
        helper:
            "Best for finding links, images, API-looking routes, JSON endpoints, and hidden page references.",
    },
    {
        value: "quick",
        label: "Quick scan",
        helper:
            "Fastest option. Good for title, description, links, and a short page preview.",
    },
];

function extractUrlsFromText(value) {
    const matches = String(value || "").match(/https?:\/\/[^\s"'<>]+/gi) || [];

    return [...new Set(matches)]
        .map((url) => url.trim())
        .filter(Boolean)
        .slice(0, 8);
}

function selectedOptionLabel(mode) {
    return scrapeOptions.find((item) => item.value === mode)?.label || mode;
}

export default function Scrape() {
    const [query, setQuery] = useState("");
    const [mode, setMode] = useState("research");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");
    const [results, setResults] = useState([]);

    const extractedUrls = useMemo(() => extractUrlsFromText(query), [query]);

    const activeOption = useMemo(() => {
        return scrapeOptions.find((item) => item.value === mode) || scrapeOptions[0];
    }, [mode]);

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
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || "Query scrape failed.");
            }

            const nextResults = Array.isArray(data.results)
                ? data.results
                : data.data
                    ? [data]
                    : [];

            setResults((current) => [...nextResults, ...current].slice(0, 40));

            setMessage(
                data.message ||
                `Finished ${selectedOptionLabel(mode).toLowerCase()} for "${cleanedQuery}".`
            );
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
    }

    return (
        <PageShell
            eyebrow="Simple query scraper"
            title="Search, scrape, and record from one box."
            description="Enter a query, product, topic, or direct URL. Choose what type of extraction you want, then press Start. Every request is automatically recorded by the app recorder."
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
                                        Start a scrape
                                    </Typography>

                                    <Typography color="text.secondary">
                                        Use one box for everything. Paste a URL for direct scraping, or
                                        type a normal query to create a scrape/search task.
                                    </Typography>
                                </Stack>

                                <TextField
                                    label="Query or URL"
                                    value={query}
                                    onChange={(event) => setQuery(event.target.value)}
                                    fullWidth
                                    multiline
                                    minRows={4}
                                    placeholder={
                                        "Examples:\nNike Air Max 97 silver resale value\nhttps://example.com\nFind product prices and hidden API routes"
                                    }
                                />

                                <TextField
                                    label="Search / scrape option"
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
                                    }}
                                >
                                    <Stack spacing={1}>
                                        <Stack direction="row" spacing={1} alignItems="center">
                                            <Chip
                                                size="small"
                                                color="secondary"
                                                icon={<SearchRounded />}
                                                label={activeOption.label}
                                            />
                                            {extractedUrls.length > 0 && (
                                                <Chip
                                                    size="small"
                                                    color="success"
                                                    label={`${extractedUrls.length} URL${
                                                        extractedUrls.length === 1 ? "" : "s"
                                                    } detected`}
                                                />
                                            )}
                                        </Stack>

                                        <Typography variant="body2" color="text.secondary">
                                            {activeOption.helper}
                                        </Typography>
                                    </Stack>
                                </Paper>

                                <Button
                                    size="large"
                                    variant="contained"
                                    startIcon={<PlayArrowRounded />}
                                    onClick={startScrape}
                                    disabled={loading || !query.trim()}
                                    sx={{
                                        minHeight: 54,
                                        fontSize: "1rem",
                                    }}
                                >
                                    {loading ? "Running..." : "Start Search"}
                                </Button>

                                <LoadingBar loading={loading} />

                                {error && <Alert severity="error">{error}</Alert>}

                                {message && !error && <Alert severity="success">{message}</Alert>}

                                <Alert severity="info">
                                    Query-only searches work through your Cloudflare Function. Direct
                                    URLs are scraped immediately. Plain search queries return a safe
                                    research plan unless you add a search provider later.
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
                                            Results
                                        </Typography>

                                        <Typography color="text.secondary">
                                            Extracted pages, scrape plans, and analysis results appear
                                            here.
                                        </Typography>
                                    </Stack>

                                    <Chip
                                        icon={<ManageSearchRounded />}
                                        label={`${results.length} result${
                                            results.length === 1 ? "" : "s"
                                        }`}
                                        variant="outlined"
                                    />
                                </Stack>

                                <Divider />

                                {results.length === 0 ? (
                                    <EmptyState
                                        icon={<SearchRounded />}
                                        title="No scrape results yet"
                                        description="Enter a query or URL, choose an option, and press Start Search."
                                    />
                                ) : (
                                    <Stack spacing={2}>
                                        {results.map((result, index) => {
                                            if (result?.type === "query-plan") {
                                                return (
                                                    <QueryPlanCard
                                                        key={`plan-${index}`}
                                                        result={result}
                                                        onUseUrl={(url) => setQuery(url)}
                                                    />
                                                );
                                            }

                                            return (
                                                <ScrapeResultCard
                                                    key={`${result?.data?.url || result?.url || "result"}-${index}`}
                                                    result={result}
                                                />
                                            );
                                        })}
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

function QueryPlanCard({ result, onUseUrl }) {
    const sources = result?.suggestedSources || [];

    return (
        <Paper
            elevation={0}
            sx={{
                p: 2.4,
                borderRadius: 5,
                background: "rgba(2, 6, 23, 0.42)",
            }}
        >
            <Stack spacing={2}>
                <Stack spacing={0.5}>
                    <Typography variant="h6" fontWeight={900}>
                        Query scrape plan
                    </Typography>

                    <Typography color="text.secondary">
                        {result.message ||
                            "This query needs source URLs before Cloudflare can scrape page content without a search API."}
                    </Typography>
                </Stack>

                <Box>
                    <Typography fontWeight={900} sx={{ mb: 1 }}>
                        Query
                    </Typography>

                    <Typography color="text.secondary">{result.query}</Typography>
                </Box>

                <Box>
                    <Typography fontWeight={900} sx={{ mb: 1 }}>
                        Suggested search links
                    </Typography>

                    <Stack spacing={1}>
                        {sources.map((source) => (
                            <Paper
                                key={source.url}
                                elevation={0}
                                sx={{
                                    p: 1.5,
                                    borderRadius: 3,
                                    background: "rgba(15, 23, 42, 0.65)",
                                }}
                            >
                                <Stack
                                    direction={{ xs: "column", md: "row" }}
                                    alignItems={{ xs: "flex-start", md: "center" }}
                                    justifyContent="space-between"
                                    spacing={1}
                                >
                                    <Stack spacing={0.3}>
                                        <Typography fontWeight={800}>{source.label}</Typography>
                                        <Typography
                                            variant="body2"
                                            color="text.secondary"
                                            sx={{ wordBreak: "break-all" }}
                                        >
                                            {source.url}
                                        </Typography>
                                    </Stack>

                                    <Stack direction="row" spacing={1}>
                                        <Button
                                            href={source.url}
                                            target="_blank"
                                            rel="noreferrer"
                                            variant="outlined"
                                            size="small"
                                        >
                                            Open
                                        </Button>

                                        <Button
                                            onClick={() => onUseUrl(source.url)}
                                            variant="contained"
                                            size="small"
                                        >
                                            Use URL
                                        </Button>
                                    </Stack>
                                </Stack>
                            </Paper>
                        ))}
                    </Stack>
                </Box>

                <Alert severity="warning">
                    Without a third-party search API, a normal text query cannot magically
                    discover every website. This page can scrape URLs directly, and it can
                    create search links for the user to open.
                </Alert>
            </Stack>
        </Paper>
    );
}