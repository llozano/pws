"use client";

import React, { useState, useEffect } from "react";
import { runHardwareTriage, type QuantumLandscapeResult } from "@/utils/quantumDiagnostics";

export default function DiagnosticsDashboard() {
  const [status, setStatus] = useState<"idle" | "running" | "complete">("idle");
  const [result, setResult] = useState<QuantumLandscapeResult | null>(null);
  const [threadCount, setThreadCount] = useState<number>(4);
  const [logs, setLogs] = useState<string[]>([]); // 💡 Mobile Screen Logger

  const addLog = (msg: string) => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };


  useEffect(() => {
    // Detect core count safely in the browser context
    if (typeof window !== "undefined" && navigator.hardwareConcurrency) {
      setThreadCount(navigator.hardwareConcurrency);
    }
  }, []);

  const handleStartTriage = () => {
    setStatus("running");
    setResult(null);
    setLogs([]);

    addLog("🔴 Click Event Triggered successfully!");

    // Grid Dimensions: 1024x1024 data points
    const width = 1024;
    const height = 1024;
    const zoom = 0.05; // Target a deep zoom section

    // Fire off the background threads
    runHardwareTriage(width, height, zoom, (msg) => addLog(msg), (quantumData: QuantumLandscapeResult) => {
      setResult(quantumData);
      setStatus("complete");
    });
  };

  return (
      <div style={styles.container}>
        <header style={styles.header}>
          <h1 style={styles.title}>💻 Hardware Quantum Diagnostics Engine</h1>
          <p style={styles.subtitle}>
            Parallelized CPU/GPU Silicon Lottery Profiling & Error Isolation
          </p>
        </header>

        <div style={styles.controlPanel}>
          <div style={styles.metaInfo}>
            <strong>Detected CPU Cores:</strong> {threadCount} Active Threads
          </div>
          <button
              onClick={handleStartTriage}
              onTouchStart={handleStartTriage}
              disabled={status === "running"}
              style={{
                ...styles.btnActive,
                cursor: "pointer",
                touchAction: "manipulation", // Prevent double-tap zoom delay on iOS
                WebkitTapHighlightColor: "rgba(0,0,0,0)" // Removes the default blue block flash on iOS Safari
              }}
          >
            {status === "running" ? "🧬 Harvesting Hardware Errors..." : "🚀 Launch Triage"}
          </button>
        </div>

        <section style={styles.terminalContainer}>
          <h3 style={styles.terminalTitle}>🛰️ Real-Time Execution Telemetry</h3>
          <div style={styles.terminalBox}>
            {logs.length === 0 ? (
                <span style={{ color: "#444" }}>Terminal awaiting execution broadcast...</span>
            ) : (
                logs.map((log, index) => <div key={index} style={styles.logLine}>{log}</div>)
            )}
          </div>
        </section>

        <main style={styles.resultsArea}>
          {status === "idle" && (
              <div style={styles.placeholder}>
                System Idle. Click Launch to spin up threads and generate the potential well data.
              </div>
          )}

          {status === "running" && (
              <div style={styles.loaderContainer}>
                <div style={styles.spinner}></div>
                <p>Gathering floating-point discrepancies across independent system cores...</p>
              </div>
          )}

          {status === "complete" && result && (
              <div style={styles.card}>
                <h2 style={styles.cardTitle}>📊 QuantumLandscapeResult Generated</h2>
                <p style={styles.description}><strong>Description:</strong> {result.systemDescription}</p>

                <div style={styles.metricGrid}>
                  <div style={styles.metricBox}>
                    <span style={styles.metricLabel}>Max Energy Barrier (eV)</span>
                    <span style={styles.metricValue}>{result.maxEnergyBarrier.toFixed(4)}</span>
                  </div>
                  <div style={styles.metricBox}>
                    <span style={styles.metricLabel}>Tunneling Susceptibility</span>
                    <span style={styles.metricValue}>{(result.tunnelingSusceptibility * 100).toFixed(2)}%</span>
                  </div>
                  <div style={styles.metricBox}>
                    <span style={styles.metricLabel}>Total Array Memory Map</span>
                    <span style={styles.metricValue}>{result.potentialGrid.length.toLocaleString()} Indices</span>
                  </div>
                </div>

                <h3 style={styles.sectionTitle}>💾 Raw Sample Stream (First 15 Data Wells)</h3>
                <pre style={styles.codeBlock}>
              {JSON.stringify(Array.from(result.potentialGrid.slice(0, 15)), null, 2)}
            </pre>
              </div>
          )}
        </main>
      </div>
  );
}

// Minimal styling object to ensure visual layouts fit cleanly on mobile and desktop
const styles: Record<string, React.CSSProperties> = {
  container: { padding: "20px", maxWidth: "800px", margin: "0 auto", fontFamily: "monospace", color: "#e0e0e0", backgroundColor: "#0a0a0a", minHeight: "100vh" },
  header: { borderBottom: "1px solid #333", paddingBottom: "15px", marginBottom: "20px" },
  title: { fontSize: "1.5rem", color: "#fff", margin: "0 0 5px 0" },
  subtitle: { color: "#888", fontSize: "0.9rem", margin: 0 },
  controlPanel: { display: "flex", justifyContent: "space-between", alignItems: "center", backgroundColor: "#111", padding: "15px", borderRadius: "6px", border: "1px solid #222", marginBottom: "20px" },
  metaInfo: { fontSize: "0.9rem" },
  btnActive: { backgroundColor: "#0070f3", color: "#fff", border: "none", padding: "10px 20px", borderRadius: "4px", cursor: "pointer", fontWeight: "bold" },
  btnDisabled: { backgroundColor: "#333", color: "#666", border: "none", padding: "10px 20px", borderRadius: "4px", cursor: "not-allowed" },
  resultsArea: { minHeight: "200px" },
  placeholder: { color: "#666", textAlign: "center", paddingTop: "5px" },
  loaderContainer: { textAlign: "center", padding: "40px 0", color: "#0070f3" },
  spinner: { width: "30px", height: "30px", border: "4px solid #333", borderTop: "4px solid #0070f3", borderRadius: "50%", margin: "0 auto 15px auto", animation: "spin 1s linear infinite" },
  card: { backgroundColor: "#111", border: "1px solid #333", borderRadius: "6px", padding: "20px" },
  cardTitle: { fontSize: "1.2rem", color: "#00ff88", marginTop: 0, marginBottom: "10px" },
  description: { color: "#aaa", fontSize: "0.9rem", marginBottom: "20px" },
  metricGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "15px", marginBottom: "25px" },
  metricBox: { backgroundColor: "#1a1a1a", border: "1px solid #222", padding: "15px", borderRadius: "4px", display: "flex", flexDirection: "column" },
  metricLabel: { fontSize: "0.8rem", color: "#888", marginBottom: "5px" },
  metricValue: { fontSize: "1.4rem", fontWeight: "bold", color: "#fff" },
  sectionTitle: { fontSize: "1rem", color: "#fff", marginBottom: "10px" },
  codeBlock: { backgroundColor: "#050505", border: "1px solid #222", padding: "15px", borderRadius: "4px", color: "#00ff88", overflowX: "auto", fontSize: "0.85rem" }
};
