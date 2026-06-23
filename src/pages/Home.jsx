import React from "react";
import { Link as RouterLink } from "react-router-dom";
import {
    AnalyticsRounded,
    CloudQueueRounded,
    CodeRounded,
    HubRounded,
    LinkRounded,
    ManageSearchRounded,
    PublicRounded,
    ShieldRounded,
    StorageRounded,
} from "@mui/icons-material";
import { Box, Button, Grid, Stack, Typography } from "@mui/material";
import {
    FeatureCard,
    GlassCard,
    PageShell,
    RecorderPanel,
    StatCard,
} from "../components/components";

export default function Home() {
    return (
        <PageShell
            eyebrow="No search API key required"
            title="A request recorder and scrape lab that works without paid APIs."
            description="ScrapeWebsite lets users paste URLs, batch scrape pages through Cloudflare Functions, analyze raw HTML locally, and record every request made by the app."
            actions={
                <>
                    <Button
                        component={RouterLink}
                        to="/scrape"
                        size="large"
                        variant="contained"
                        startIcon={<ManageSearchRounded />}
                    >
                        Open Scrape Lab
                    </Button>

                    <Button
                        href="#features"
                        size="large"
                        variant="outlined"
                        startIcon={<HubRounded />}
                    >
                        View Features
                    </Button>
                </>
            }
        >
            <Grid container spacing={2.5}>
                <Grid item xs={12} md={6} lg={3}>
                    <StatCard
                        icon={<AnalyticsRounded />}
                        value="Live"
                        label="Request recorder"
                        detail="Records fetch, XHR, status codes, timing, response previews, and app API routes."
                    />
                </Grid>

                <Grid item xs={12} md={6} lg={3}>
                    <StatCard
                        icon={<CloudQueueRounded />}
                        value="Edge"
                        label="Cloudflare scraping"
                        detail="Your own Functions fetch public pages server-side and return clean structured JSON."
                    />
                </Grid>

                <Grid item xs={12} md={6} lg={3}>
                    <StatCard
                        icon={<CodeRounded />}
                        value="Local"
                        label="HTML analyzer"
                        detail="Users can paste HTML and analyze it fully inside React with no backend call."
                    />
                </Grid>

                <Grid item xs={12} md={6} lg={3}>
                    <StatCard
                        icon={<ShieldRounded />}
                        value="Safe"
                        label="Guarded fetches"
                        detail="Blocks local/private targets, caps response size, and extracts data instead of acting as an open proxy."
                    />
                </Grid>
            </Grid>

            <Grid container spacing={2.5} id="features">
                <Grid item xs={12} lg={7}>
                    <GlassCard sx={{ minHeight: "100%" }}>
                        <Stack spacing={3}>
                            <Typography variant="h3">How this no-key version works</Typography>

                            <Stack spacing={2.2}>
                                <FlowStep
                                    number="01"
                                    title="User provides URLs"
                                    description="Instead of using a search API, the user pastes direct URLs or a list of URLs."
                                />

                                <FlowStep
                                    number="02"
                                    title="Cloudflare extracts pages"
                                    description="Your /api/scrape and /api/batch-scrape functions fetch public pages and return useful structured data."
                                />

                                <FlowStep
                                    number="03"
                                    title="React can analyze pasted HTML locally"
                                    description="Raw HTML can be pasted into the browser and analyzed without any network request."
                                />

                                <FlowStep
                                    number="04"
                                    title="Recorder logs every app request"
                                    description="Every scrape call is captured in the request recorder and can be exported as JSON."
                                />
                            </Stack>
                        </Stack>
                    </GlassCard>
                </Grid>

                <Grid item xs={12} lg={5}>
                    <RecorderPanel compact />
                </Grid>
            </Grid>

            <Grid container spacing={2.5}>
                <Grid item xs={12} md={6} lg={4}>
                    <FeatureCard
                        icon={<AnalyticsRounded />}
                        title="App request recorder"
                        description="Capture every request your own React app makes, including scrape calls and batch scrape calls."
                        chips={["fetch", "XHR", "timing", "export"]}
                    />
                </Grid>

                <Grid item xs={12} md={6} lg={4}>
                    <FeatureCard
                        icon={<LinkRounded />}
                        title="URL-based scraping"
                        description="Users paste direct URLs instead of relying on paid search APIs."
                        chips={["single URL", "batch URLs", "no API key"]}
                    />
                </Grid>

                <Grid item xs={12} md={6} lg={4}>
                    <FeatureCard
                        icon={<PublicRounded />}
                        title="Page intelligence extraction"
                        description="Extract titles, descriptions, headings, links, images, price-like values, text, and API route hints."
                        chips={["meta", "links", "prices", "API hints"]}
                    />
                </Grid>

                <Grid item xs={12} md={6} lg={4}>
                    <FeatureCard
                        icon={<CodeRounded />}
                        title="Local HTML mode"
                        description="Paste HTML and analyze it completely inside the browser."
                        chips={["no backend", "local parser", "instant"]}
                    />
                </Grid>

                <Grid item xs={12} md={6} lg={4}>
                    <FeatureCard
                        icon={<CloudQueueRounded />}
                        title="Cloudflare-only deployment"
                        description="Deploy the frontend and serverless scrape functions from one Pages project."
                        chips={["Pages", "Functions", "free tier"]}
                    />
                </Grid>

                <Grid item xs={12} md={6} lg={4}>
                    <FeatureCard
                        icon={<StorageRounded />}
                        title="Local log storage"
                        description="The first version stores recorder logs in the browser and exports them as JSON."
                        chips={["localStorage", "JSON", "no database"]}
                    />
                </Grid>
            </Grid>
        </PageShell>
    );
}

function FlowStep({ number, title, description }) {
    return (
        <Stack direction="row" spacing={2}>
            <Box
                sx={{
                    width: 42,
                    height: 42,
                    flex: "0 0 auto",
                    borderRadius: 3,
                    display: "grid",
                    placeItems: "center",
                    fontWeight: 900,
                    color: "white",
                    background:
                        "linear-gradient(135deg, rgba(124,58,237,1), rgba(34,211,238,0.88))",
                }}
            >
                {number}
            </Box>

            <Stack spacing={0.4}>
                <Typography fontWeight={900}>{title}</Typography>
                <Typography color="text.secondary" lineHeight={1.65}>
                    {description}
                </Typography>
            </Stack>
        </Stack>
    );
}