import React, { useEffect, useMemo, useState } from "react";
import { Link as RouterLink, useLocation } from "react-router-dom";
import {
    AnalyticsRounded,
    ApiRounded,
    ArticleRounded,
    BoltRounded,
    BugReportRounded,
    CloudQueueRounded,
    ContentCopyRounded,
    DeleteRounded,
    DownloadRounded,
    HomeRounded,
    HubRounded,
    LanguageRounded,
    LinkRounded,
    ManageSearchRounded,
    OpenInNewRounded,
    PlayArrowRounded,
    PublicRounded,
    SearchRounded,
    ShieldRounded,
    SpeedRounded,
    StorageRounded,
    TerminalRounded,
} from "@mui/icons-material";
import {
    AppBar,
    Box,
    Button,
    Chip,
    Container,
    Divider,
    Grid,
    IconButton,
    LinearProgress,
    Paper,
    Stack,
    Tab,
    Tabs,
    Tooltip,
    Typography,
} from "@mui/material";
import {
    clearRequestLogs,
    exportRequestLogs,
    getRequestLogs,
    subscribeToRequestLogs,
} from "../utils/requestRecorder";

export function Layout({ children }) {
    const location = useLocation();

    const links = [
        {
            label: "Home",
            path: "/",
            icon: <HomeRounded fontSize="small" />,
        },
        {
            label: "Scrape Lab",
            path: "/scrape",
            icon: <ManageSearchRounded fontSize="small" />,
        },
        {
            label: "Scrape Browser",
            path: "/browser",
            icon: <PublicRounded fontSize="small" />,
        }
    ];

    return (
        <Box
            sx={{
                minHeight: "100vh",
                background:
                    "radial-gradient(circle at 20% 0%, rgba(124, 58, 237, 0.25), transparent 34%), radial-gradient(circle at 80% 10%, rgba(34, 211, 238, 0.18), transparent 30%), #070a13",
                color: "text.primary",
            }}
        >
            <AppBar
                position="sticky"
                elevation={0}
                sx={{
                    borderBottom: "1px solid rgba(148, 163, 184, 0.16)",
                    background: "rgba(7, 10, 19, 0.76)",
                    backdropFilter: "blur(18px)",
                }}
            >
                <Container maxWidth="xl">
                    <Stack
                        direction={{ xs: "column", md: "row" }}
                        alignItems={{ xs: "stretch", md: "center" }}
                        justifyContent="space-between"
                        spacing={2}
                        sx={{ py: 1.4 }}
                    >
                        <Stack direction="row" alignItems="center" spacing={1.5}>
                            <Box
                                sx={{
                                    width: 42,
                                    height: 42,
                                    borderRadius: 3,
                                    display: "grid",
                                    placeItems: "center",
                                    background:
                                        "linear-gradient(135deg, rgba(124,58,237,1), rgba(34,211,238,0.9))",
                                    boxShadow: "0 16px 40px rgba(124,58,237,0.34)",
                                }}
                            >
                                <HubRounded />
                            </Box>

                            <Box>
                                <Typography variant="h6" fontWeight={900} lineHeight={1}>
                                    ScrapeWebsite
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                    Request recorder + Cloudflare scrape interface
                                </Typography>
                            </Box>
                        </Stack>

                        <Stack direction="row" spacing={1} flexWrap="wrap">
                            {links.map((link) => {
                                const active = location.pathname === link.path;

                                return (
                                    <Button
                                        key={link.path}
                                        component={RouterLink}
                                        to={link.path}
                                        startIcon={link.icon}
                                        variant={active ? "contained" : "text"}
                                        color={active ? "primary" : "inherit"}
                                        sx={{
                                            color: active ? "white" : "text.secondary",
                                        }}
                                    >
                                        {link.label}
                                    </Button>
                                );
                            })}
                        </Stack>
                    </Stack>
                </Container>
            </AppBar>

            <Box component="main">{children}</Box>
        </Box>
    );
}

export function PageShell({ eyebrow, title, description, actions, children }) {
    return (
        <Container maxWidth="xl" sx={{ py: { xs: 4, md: 7 } }}>
            <Stack spacing={4}>
                <Stack
                    direction={{ xs: "column", lg: "row" }}
                    alignItems={{ xs: "flex-start", lg: "flex-end" }}
                    justifyContent="space-between"
                    spacing={3}
                >
                    <Stack spacing={1.5} sx={{ maxWidth: 850 }}>
                        {eyebrow && (
                            <Chip
                                icon={<BoltRounded />}
                                label={eyebrow}
                                color="secondary"
                                variant="outlined"
                                sx={{ width: "fit-content" }}
                            />
                        )}

                        <Typography
                            variant="h2"
                            sx={{
                                fontSize: {
                                    xs: "2.4rem",
                                    md: "4.6rem",
                                },
                            }}
                        >
                            {title}
                        </Typography>

                        {description && (
                            <Typography
                                variant="h6"
                                color="text.secondary"
                                sx={{
                                    maxWidth: 760,
                                    lineHeight: 1.75,
                                }}
                            >
                                {description}
                            </Typography>
                        )}
                    </Stack>

                    {actions && (
                        <Stack direction="row" spacing={1.2} flexWrap="wrap">
                            {actions}
                        </Stack>
                    )}
                </Stack>

                {children}
            </Stack>
        </Container>
    );
}

export function GlassCard({ children, sx }) {
    return (
        <Paper
            elevation={0}
            sx={{
                p: { xs: 2.4, md: 3 },
                borderRadius: 5,
                background:
                    "linear-gradient(180deg, rgba(15,23,42,0.88), rgba(15,23,42,0.58))",
                boxShadow: "0 24px 80px rgba(0,0,0,0.28)",
                ...sx,
            }}
        >
            {children}
        </Paper>
    );
}

export function StatCard({ icon, label, value, detail }) {
    return (
        <GlassCard>
            <Stack spacing={1.5}>
                <Box
                    sx={{
                        width: 46,
                        height: 46,
                        borderRadius: 3,
                        display: "grid",
                        placeItems: "center",
                        color: "secondary.main",
                        background: "rgba(34, 211, 238, 0.10)",
                        border: "1px solid rgba(34, 211, 238, 0.18)",
                    }}
                >
                    {icon}
                </Box>

                <Typography variant="h4" fontWeight={900}>
                    {value}
                </Typography>

                <Typography fontWeight={800}>{label}</Typography>

                <Typography variant="body2" color="text.secondary">
                    {detail}
                </Typography>
            </Stack>
        </GlassCard>
    );
}

export function FeatureCard({ icon, title, description, chips = [] }) {
    return (
        <GlassCard sx={{ height: "100%" }}>
            <Stack spacing={2}>
                <Box
                    sx={{
                        width: 52,
                        height: 52,
                        borderRadius: 4,
                        display: "grid",
                        placeItems: "center",
                        color: "white",
                        background:
                            "linear-gradient(135deg, rgba(124,58,237,0.95), rgba(34,211,238,0.8))",
                    }}
                >
                    {icon}
                </Box>

                <Stack spacing={0.7}>
                    <Typography variant="h6" fontWeight={900}>
                        {title}
                    </Typography>
                    <Typography color="text.secondary" lineHeight={1.7}>
                        {description}
                    </Typography>
                </Stack>

                {chips.length > 0 && (
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                        {chips.map((chip) => (
                            <Chip key={chip} size="small" label={chip} variant="outlined" />
                        ))}
                    </Stack>
                )}
            </Stack>
        </GlassCard>
    );
}

export function RecorderPanel({ compact = false }) {
    const [logs, setLogs] = useState(() => getRequestLogs());
    const [tab, setTab] = useState("all");

    useEffect(() => {
        return subscribeToRequestLogs((_entry, nextLogs) => {
            setLogs(nextLogs || getRequestLogs());
        });
    }, []);

    useEffect(() => {
        const onClear = () => setLogs([]);
        window.addEventListener("scrapewebsite:request-log-clear", onClear);
        return () => window.removeEventListener("scrapewebsite:request-log-clear", onClear);
    }, []);

    const filtered = useMemo(() => {
        if (tab === "all") return logs;
        return logs.filter((log) => log.source === tab);
    }, [logs, tab]);

    const stats = useMemo(() => {
        const total = logs.length;
        const failed = logs.filter((log) => log.error || log.ok === false).length;
        const api = logs.filter((log) => String(log.url).includes("/api/")).length;
        const average =
            logs.length === 0
                ? 0
                : Math.round(
                    logs.reduce((sum, log) => sum + Number(log.durationMs || 0), 0) /
                    logs.length
                );

        return { total, failed, api, average };
    }, [logs]);

    return (
        <GlassCard>
            <Stack spacing={2.4}>
                <Stack
                    direction={{ xs: "column", md: "row" }}
                    alignItems={{ xs: "stretch", md: "center" }}
                    justifyContent="space-between"
                    spacing={2}
                >
                    <Stack spacing={0.4}>
                        <Typography variant="h5" fontWeight={900}>
                            App Request Recorder
                        </Typography>
                        <Typography color="text.secondary">
                            Captures requests made by this React app, including calls to your
                            Cloudflare Functions.
                        </Typography>
                    </Stack>

                    <Stack direction="row" spacing={1} flexWrap="wrap">
                        <Button
                            startIcon={<DownloadRounded />}
                            variant="outlined"
                            onClick={exportRequestLogs}
                            disabled={logs.length === 0}
                        >
                            Export JSON
                        </Button>

                        <Button
                            startIcon={<DeleteRounded />}
                            color="error"
                            variant="outlined"
                            onClick={() => {
                                clearRequestLogs();
                                setLogs([]);
                            }}
                            disabled={logs.length === 0}
                        >
                            Clear
                        </Button>
                    </Stack>
                </Stack>

                {!compact && (
                    <Grid container spacing={2}>
                        <Grid item xs={6} md={3}>
                            <MiniMetric label="Total" value={stats.total} />
                        </Grid>
                        <Grid item xs={6} md={3}>
                            <MiniMetric label="API calls" value={stats.api} />
                        </Grid>
                        <Grid item xs={6} md={3}>
                            <MiniMetric label="Failed" value={stats.failed} />
                        </Grid>
                        <Grid item xs={6} md={3}>
                            <MiniMetric label="Avg ms" value={stats.average} />
                        </Grid>
                    </Grid>
                )}

                <Tabs
                    value={tab}
                    onChange={(_, value) => setTab(value)}
                    variant="scrollable"
                    scrollButtons="auto"
                >
                    <Tab value="all" label="All" />
                    <Tab value="fetch" label="Fetch" />
                    <Tab value="xhr" label="XHR" />
                    <Tab value="resource" label="Resources" />
                </Tabs>

                <Stack spacing={1.2} sx={{ maxHeight: compact ? 320 : 520, overflow: "auto" }}>
                    {filtered.length === 0 ? (
                        <EmptyState
                            icon={<BugReportRounded />}
                            title="No requests recorded yet"
                            description="Run a scrape/search or use the app to see request logs appear here."
                        />
                    ) : (
                        filtered.map((log) => <RequestLogItem key={log.id} log={log} />)
                    )}
                </Stack>
            </Stack>
        </GlassCard>
    );
}

function MiniMetric({ label, value }) {
    return (
        <Paper
            elevation={0}
            sx={{
                p: 2,
                borderRadius: 4,
                background: "rgba(2, 6, 23, 0.45)",
            }}
        >
            <Typography variant="h5" fontWeight={900}>
                {value}
            </Typography>
            <Typography variant="caption" color="text.secondary">
                {label}
            </Typography>
        </Paper>
    );
}

function RequestLogItem({ log }) {
    const [open, setOpen] = useState(false);

    const statusColor = log.error
        ? "error"
        : log.ok
            ? "success"
            : log.status
                ? "warning"
                : "default";

    return (
        <Paper
            elevation={0}
            sx={{
                p: 1.5,
                borderRadius: 3,
                background: "rgba(2, 6, 23, 0.42)",
            }}
        >
            <Stack spacing={1}>
                <Stack
                    direction={{ xs: "column", md: "row" }}
                    alignItems={{ xs: "flex-start", md: "center" }}
                    justifyContent="space-between"
                    spacing={1}
                >
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0 }}>
                        <Chip size="small" color={statusColor} label={log.status || log.source} />
                        <Chip size="small" variant="outlined" label={log.method || "GET"} />
                        <Typography
                            variant="body2"
                            sx={{
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                maxWidth: { xs: 280, md: 720 },
                            }}
                        >
                            {log.url}
                        </Typography>
                    </Stack>

                    <Stack direction="row" alignItems="center" spacing={1}>
                        <Typography variant="caption" color="text.secondary">
                            {log.durationMs ?? 0}ms
                        </Typography>
                        <Button size="small" onClick={() => setOpen((value) => !value)}>
                            {open ? "Hide" : "Details"}
                        </Button>
                    </Stack>
                </Stack>

                {open && (
                    <Box
                        component="pre"
                        sx={{
                            p: 1.5,
                            m: 0,
                            borderRadius: 2,
                            overflow: "auto",
                            maxHeight: 240,
                            fontSize: 12,
                            background: "rgba(0,0,0,0.35)",
                        }}
                    >
                        {JSON.stringify(log, null, 2)}
                    </Box>
                )}
            </Stack>
        </Paper>
    );
}

export function EmptyState({ icon, title, description }) {
    return (
        <Paper
            elevation={0}
            sx={{
                p: 3,
                borderRadius: 4,
                textAlign: "center",
                background: "rgba(2, 6, 23, 0.36)",
            }}
        >
            <Stack alignItems="center" spacing={1.2}>
                <Box sx={{ color: "text.secondary" }}>{icon}</Box>
                <Typography fontWeight={900}>{title}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 520 }}>
                    {description}
                </Typography>
            </Stack>
        </Paper>
    );
}

export function SearchResultCard({ result, onScrape, loading }) {
    return (
        <Paper
            elevation={0}
            sx={{
                p: 2,
                borderRadius: 4,
                background: "rgba(2, 6, 23, 0.42)",
            }}
        >
            <Stack spacing={1.5}>
                <Stack
                    direction={{ xs: "column", md: "row" }}
                    alignItems={{ xs: "flex-start", md: "center" }}
                    justifyContent="space-between"
                    spacing={1.5}
                >
                    <Stack spacing={0.5} sx={{ minWidth: 0 }}>
                        <Typography variant="h6" fontWeight={900}>
                            {result.title || "Untitled result"}
                        </Typography>

                        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                            <Chip
                                size="small"
                                icon={<LanguageRounded />}
                                label={result.hostname || "unknown host"}
                                variant="outlined"
                            />

                            {result.rank && (
                                <Chip size="small" label={`Rank ${result.rank}`} color="secondary" />
                            )}
                        </Stack>
                    </Stack>

                    <Stack direction="row" spacing={1}>
                        <Button
                            startIcon={<OpenInNewRounded />}
                            href={result.url}
                            target="_blank"
                            rel="noreferrer"
                            variant="outlined"
                        >
                            Open
                        </Button>

                        <Button
                            startIcon={<PlayArrowRounded />}
                            variant="contained"
                            onClick={() => onScrape(result.url)}
                            disabled={loading}
                        >
                            Scrape
                        </Button>
                    </Stack>
                </Stack>

                <Typography color="text.secondary" lineHeight={1.7}>
                    {result.description || "No description returned."}
                </Typography>

                <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{
                        wordBreak: "break-all",
                    }}
                >
                    {result.url}
                </Typography>
            </Stack>
        </Paper>
    );
}

export function ScrapeResultCard({ result }) {
    const data = result?.data || result;

    if (!data) return null;

    return (
        <GlassCard>
            <Stack spacing={2.2}>
                <Stack
                    direction={{ xs: "column", md: "row" }}
                    justifyContent="space-between"
                    alignItems={{ xs: "flex-start", md: "center" }}
                    spacing={1.5}
                >
                    <Stack spacing={0.5}>
                        <Typography variant="h5" fontWeight={900}>
                            {data.title || "Untitled page"}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ wordBreak: "break-all" }}>
                            {data.url}
                        </Typography>
                    </Stack>

                    <Stack direction="row" spacing={1} flexWrap="wrap">
                        <Chip icon={<ArticleRounded />} label={`${data.wordCount || 0} words`} />
                        <Chip icon={<LinkRounded />} label={`${data.links?.length || 0} links`} />
                        <Chip icon={<ApiRounded />} label={`${data.apiCandidates?.length || 0} API hints`} />
                    </Stack>
                </Stack>

                {data.description && (
                    <Typography color="text.secondary" lineHeight={1.75}>
                        {data.description}
                    </Typography>
                )}

                <Divider />

                <Grid container spacing={2}>
                    <Grid item xs={12} md={6}>
                        <ResultSection
                            title="Headings"
                            icon={<TerminalRounded />}
                            items={(data.headings || []).slice(0, 12).map((item) => item.text)}
                        />
                    </Grid>

                    <Grid item xs={12} md={6}>
                        <ResultSection
                            title="Price-like values"
                            icon={<StorageRounded />}
                            items={(data.prices || []).slice(0, 12)}
                        />
                    </Grid>

                    <Grid item xs={12} md={6}>
                        <ResultSection
                            title="Links"
                            icon={<LinkRounded />}
                            items={(data.links || []).slice(0, 12).map((item) => item.href)}
                        />
                    </Grid>

                    <Grid item xs={12} md={6}>
                        <ResultSection
                            title="Possible API endpoints"
                            icon={<ApiRounded />}
                            items={(data.apiCandidates || []).slice(0, 12)}
                        />
                    </Grid>
                </Grid>

                {data.textPreview && (
                    <>
                        <Divider />
                        <Box>
                            <Typography fontWeight={900} sx={{ mb: 1 }}>
                                Text Preview
                            </Typography>
                            <Box
                                component="pre"
                                sx={{
                                    p: 2,
                                    m: 0,
                                    borderRadius: 3,
                                    overflow: "auto",
                                    maxHeight: 300,
                                    whiteSpace: "pre-wrap",
                                    fontSize: 13,
                                    background: "rgba(0,0,0,0.35)",
                                }}
                            >
                                {data.textPreview}
                            </Box>
                        </Box>
                    </>
                )}
            </Stack>
        </GlassCard>
    );
}

function ResultSection({ title, icon, items }) {
    return (
        <Paper
            elevation={0}
            sx={{
                p: 2,
                borderRadius: 4,
                background: "rgba(2, 6, 23, 0.42)",
                height: "100%",
            }}
        >
            <Stack spacing={1.3}>
                <Stack direction="row" alignItems="center" spacing={1}>
                    {icon}
                    <Typography fontWeight={900}>{title}</Typography>
                </Stack>

                {items.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                        None found.
                    </Typography>
                ) : (
                    <Stack spacing={0.8}>
                        {items.map((item, index) => (
                            <Typography
                                key={`${item}-${index}`}
                                variant="body2"
                                color="text.secondary"
                                sx={{ wordBreak: "break-word" }}
                            >
                                {item}
                            </Typography>
                        ))}
                    </Stack>
                )}
            </Stack>
        </Paper>
    );
}

export function CopyButton({ value }) {
    const [copied, setCopied] = useState(false);

    return (
        <Tooltip title={copied ? "Copied" : "Copy"}>
            <IconButton
                onClick={async () => {
                    await navigator.clipboard.writeText(value);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1200);
                }}
            >
                <ContentCopyRounded fontSize="small" />
            </IconButton>
        </Tooltip>
    );
}

export function LoadingBar({ loading }) {
    if (!loading) return null;

    return (
        <LinearProgress
            sx={{
                borderRadius: 999,
                height: 8,
            }}
        />
    );
}
export function UrlQueueCard({ url, onScrape, loading }) {
    let hostname = "unknown host";

    try {
        hostname = new URL(url).hostname;
    } catch {
        hostname = "invalid URL";
    }

    return (
        <Paper
            elevation={0}
            sx={{
                p: 2,
                borderRadius: 4,
                background: "rgba(2, 6, 23, 0.42)",
            }}
        >
            <Stack
                direction={{ xs: "column", md: "row" }}
                alignItems={{ xs: "flex-start", md: "center" }}
                justifyContent="space-between"
                spacing={1.5}
            >
                <Stack spacing={0.5} sx={{ minWidth: 0 }}>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                        <Chip size="small" label={hostname} color="secondary" />
                        <Chip size="small" label="queued URL" variant="outlined" />
                    </Stack>

                    <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{
                            wordBreak: "break-all",
                        }}
                    >
                        {url}
                    </Typography>
                </Stack>

                <Stack direction="row" spacing={1}>
                    <Button
                        startIcon={<OpenInNewRounded />}
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        variant="outlined"
                    >
                        Open
                    </Button>

                    <Button
                        startIcon={<PlayArrowRounded />}
                        variant="contained"
                        onClick={() => onScrape(url)}
                        disabled={loading}
                    >
                        Scrape
                    </Button>
                </Stack>
            </Stack>
        </Paper>
    );
}
export const featureIcons = {
    recorder: <AnalyticsRounded />,
    scraper: <PublicRounded />,
    cloudflare: <CloudQueueRounded />,
    safe: <ShieldRounded />,
    fast: <SpeedRounded />,
    search: <SearchRounded />,
};