import { useEffect, useRef } from "react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router";
import { BrandMark } from "./components/Icon";
import { EmptyState } from "./components/states";
import { useAppConfig } from "./config-context";
import { DashboardPage } from "./pages/DashboardPage";
import { DemoControlsPage } from "./pages/DemoControlsPage";
import { NewReportPage } from "./pages/NewReportPage";
import { ReportPage } from "./pages/ReportPage";
import { RunPage } from "./pages/RunPage";

export function App() {
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);

  // Move focus to the page content on navigation so keyboard and screen reader users land in the right place.
  useEffect(() => {
    mainRef.current?.focus({ preventScroll: true });
  }, [location.pathname]);

  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="topbar">
        <div className="container topbar__inner">
          <Link to="/" className="brand" aria-label="ReproLab home">
            <BrandMark />
            <span>
              <span className="brand__repro">Repro</span>
              <span className="brand__lab">Lab</span>
            </span>
          </Link>
          <nav aria-label="Main" className="nav">
            <NavLink to="/" end>
              Dashboard
            </NavLink>
            <NavLink to="/reports/new">New report</NavLink>
            <NavLink to="/demo">Demo controls</NavLink>
          </nav>
          <LiveAiStatus />
        </div>
      </header>
      <main id="main" ref={mainRef} tabIndex={-1} className="container main">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/reports/new" element={<NewReportPage />} />
          <Route path="/reports/:id" element={<ReportPage />} />
          <Route path="/runs/:id" element={<RunPage />} />
          <Route path="/demo" element={<DemoControlsPage />} />
          <Route
            path="*"
            element={
              <EmptyState title="Page not found" icon="help-circle">
                <Link to="/">Back to the dashboard</Link>
              </EmptyState>
            }
          />
        </Routes>
      </main>
      <footer className="footer">
        <div className="container">Local demo build. The API has no authentication — keep it on localhost.</div>
      </footer>
    </>
  );
}

function LiveAiStatus() {
  const { config } = useAppConfig();
  const on = Boolean(config?.liveAi.available);
  return (
    <span className={`ai-status${on ? " ai-status--on" : ""}`} title={config?.liveAi.reason ?? undefined}>
      <span className="ai-status__dot" aria-hidden="true" />
      Live AI
      {config ? (
        on ? (
          <span className="ai-status__model">
            {config.liveAi.providerLabel} · {config.liveAi.model}
          </span>
        ) : (
          <span>off</span>
        )
      ) : (
        <span>…</span>
      )}
    </span>
  );
}
