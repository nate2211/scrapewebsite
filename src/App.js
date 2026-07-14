import React, { useEffect, useMemo } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { CssBaseline, ThemeProvider, createTheme } from "@mui/material";

import { Layout } from "./components/components";
import Home from "./pages/Home";
import Scrape from "./pages/Scrape";
import Browser from "./pages/Browser";
import { installRequestRecorder } from "./utils/requestRecorder";

export default function App() {
  const theme = useMemo(
      () =>
          createTheme({
            palette: {
              mode: "dark",
              background: {
                default: "#070a13",
                paper: "rgba(15, 23, 42, 0.88)",
              },
              primary: {
                main: "#7c3aed",
              },
              secondary: {
                main: "#22d3ee",
              },
              success: {
                main: "#22c55e",
              },
              warning: {
                main: "#f59e0b",
              },
              error: {
                main: "#ef4444",
              },
            },
            shape: {
              borderRadius: 18,
            },
            typography: {
              fontFamily:
                  'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
              h1: {
                fontWeight: 900,
                letterSpacing: "-0.06em",
              },
              h2: {
                fontWeight: 900,
                letterSpacing: "-0.05em",
              },
              h3: {
                fontWeight: 850,
                letterSpacing: "-0.04em",
              },
              button: {
                fontWeight: 800,
                textTransform: "none",
              },
            },
            components: {
              MuiPaper: {
                styleOverrides: {
                  root: {
                    backgroundImage: "none",
                    border: "1px solid rgba(148, 163, 184, 0.18)",
                    backdropFilter: "blur(16px)",
                  },
                },
              },
              MuiButton: {
                styleOverrides: {
                  root: {
                    borderRadius: 14,
                  },
                },
              },
              MuiTextField: {
                defaultProps: {
                  variant: "outlined",
                },
              },
            },
          }),
      []
  );

  useEffect(() => {
    installRequestRecorder({
      captureFetch: true,
      captureXHR: true,
      captureResourceTiming: true,
      maxLogs: 500,
    });
  }, []);

  return (
      <ThemeProvider theme={theme}>
        <CssBaseline />

        <BrowserRouter>
          <Layout>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/scrape" element={<Scrape />} />
              <Route path="/browser" element={<Browser />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Layout>
        </BrowserRouter>
      </ThemeProvider>
  );
}
