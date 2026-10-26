'use client';

import React, { useState, useEffect } from 'react';
import {
  runHardwareTriage,
  generateHardwareHash256,
  analyzeMatrixVariance,
  type QuantumLandscapeResult,
  type MatrixVarianceAnalysis,
} from '@/utils/quantumDiagnostics';

export default function DiagnosticsDashboard() {
  const [status, setStatus] = useState<'idle' | 'running' | 'complete'>('idle');
  const [result, setResult] = useState<QuantumLandscapeResult | null>(null);
  const [threadCount, setThreadCount] = useState<number>(4);
  const [logs, setLogs] = useState<string[]>([]); // 💡 Mobile Screen Logger
  const [hwHash, setHwHash] = useState<string>('');
  const [variance, setVariance] = useState<MatrixVarianceAnalysis | null>(null);

  const addLog = (msg: string) => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  useEffect(() => {
    // Detect core count safely in the browser context
    if (typeof window !== 'undefined' && navigator.hardwareConcurrency) {
      setThreadCount(navigator.hardwareConcurrency);
    }
  }, []);

  const handleStartTriage = () => {
    setStatus('running');
    setResult(null);
    setHwHash('');
    setVariance(null);
    setLogs([]);

    addLog('🔴 Click Event Triggered successfully!');

    // Grid Dimensions: 1024x1024 data points
    const width = 1024;
    const height = 1024;
    const zoom = 0.05; // Target a deep zoom section

    const audioAllowed = true;

    // Fire off the background threads
    runHardwareTriage(
      width,
      height,
      zoom,
      (msg) => addLog(msg),
      async (quantumData: QuantumLandscapeResult) => {
        setResult(quantumData);

        if (quantumData.fingerprintId) {
          setHwHash(quantumData.fingerprintId);
          addLog(`Composite fingerprint: ${quantumData.fingerprintId.slice(0, 16)}...`);
        } else {
          const hash = await generateHardwareHash256(quantumData.potentialGrid);
          setHwHash(hash);
          addLog(`Falling back to hash: ${hash}...`);
        }

        const stats = analyzeMatrixVariance(quantumData.potentialGrid);

        setVariance(stats);

        setStatus('complete');
        addLog(
          `🏁 Pipeline complete. Unique Signature locked: ${quantumData.fingerprintId ?? 'hash'}`,
        );
        addLog(
          `🏁 Unique Hardware Signature locked: ${quantumData.crossBrowserHardwareId ?? 'hash'}`,
        );
      },
      audioAllowed,
    );
  };

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>💻 Hardware Quantum Diagnostics Engine</h1>
      </header>

      <div style={styles.controlPanel}>
        <button
          onClick={handleStartTriage}
          onTouchStart={handleStartTriage}
          disabled={status === 'running'}
          style={{
            ...styles.btnActive,
            cursor: 'pointer',
            touchAction: 'manipulation', // Prevent double-tap zoom delay on iOS
            WebkitTapHighlightColor: 'rgba(0,0,0,0)', // Removes the default blue block flash on iOS Safari
          }}
        >
          {status === 'running' ? '🧬 Harvesting Hardware Errors...' : '🚀 Launch Triage'}
        </button>
      </div>

      {result?.fingerprintId && (
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Composite Fingerprint</h3>

          <div style={{ marginBottom: '10px' }}>
            <span style={{ fontSize: '0.75rem', color: '#888' }}>BROWSER-SCOPED ID:</span>
            <div style={styles.hashBadge}>{result?.fingerprintId}</div>
          </div>

          <div>
            <span style={{ fontSize: '0.75rem', color: '#00ff88' }}>
              CROSS-BROWSER HARDWARE ID (SILICON):
            </span>
            <div style={{ ...styles.hashBadge, borderColor: '#00ff88' }}>
              {result?.crossBrowserHardwareId}
            </div>
          </div>
        </div>
      )}

      <section style={styles.terminalContainer}>
        <h3 style={styles.terminalTitle}>🛰️ Real-Time Execution Telemetry</h3>
        <div style={styles.terminalBox}>
          {logs.length === 0 ? (
            <span style={{ color: '#444' }}>Terminal awaiting execution broadcast...</span>
          ) : (
            logs.map((log, index) => (
              <div key={index} style={styles.logLine}>
                {log}
              </div>
            ))
          )}
        </div>
      </section>

      <main style={styles.resultsArea}>
        {status === 'complete' && result && variance && (
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>📊 QuantumLandscapeResult</h2>

            {/* 💡 PRINT UNIQUE HARDWARE CODE DIRECTLY TO SCREEN */}
            <div style={styles.hashBadge}>
              <strong>HARDWARE ID:</strong> <span style={{ color: '#00ffff' }}>{hwHash}</span>
            </div>

            <p style={{ marginTop: '15px' }}>
              <strong>Description:</strong> {result.systemDescription}
            </p>

            <div style={styles.metricGrid}>
              <div style={styles.metricBox}>
                <span style={styles.metricLabel}>Max Energy Barrier (eV)</span>
                <span style={styles.metricValue}>{result.maxEnergyBarrier.toFixed(4)}</span>
              </div>
              <div style={styles.metricBox}>
                <span style={styles.metricLabel}>Active Glitched Nodes</span>
                <span style={styles.metricValue}>{variance.activeGlitches.toLocaleString()}</span>
              </div>
              <div style={styles.metricBox}>
                <span style={styles.metricLabel}>Average Precision Drift</span>
                <span style={styles.metricValue}>{variance.averageDrift.toExponential(4)}</span>
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
  container: {
    padding: '15px',
    maxWidth: '600px',
    margin: '0 auto',
    fontFamily: 'monospace',
    color: '#e0e0e0',
    backgroundColor: '#050505',
    minHeight: '100vh',
  },
  header: { borderBottom: '1px solid #222', paddingBottom: '10px', marginBottom: '15px' },
  title: { fontSize: '1.2rem', color: '#fff', margin: 0 },
  controlPanel: { marginBottom: '15px' },
  btnActive: {
    width: '100%',
    backgroundColor: '#0070f3',
    color: '#fff',
    border: 'none',
    padding: '15px',
    borderRadius: '4px',
    fontSize: '1rem',
    fontWeight: 'bold',
    touchAction: 'manipulation',
  },
  terminalContainer: { marginBottom: '20px' },
  terminalTitle: { fontSize: '0.85rem', color: '#888', marginBottom: '5px' },
  terminalBox: {
    backgroundColor: '#000',
    border: '1px solid #333',
    padding: '12px',
    borderRadius: '4px',
    minHeight: '120px',
    maxHeight: '200px',
    overflowY: 'auto',
    fontSize: '0.8rem',
  },
  logLine: { color: '#8e8e8e', marginBottom: '4px', lineHeight: '1.2' },
  resultsArea: { marginTop: '15px' },
  card: { backgroundColor: '#111', border: '1px solid #222', padding: '15px', borderRadius: '4px' },
  cardTitle: { color: '#00ff88', margin: '0 0 10px 0', fontSize: '1rem' },
  hashBadge: {
    backgroundColor: '#1f142e',
    border: '1px solid #7928ca',
    padding: '10px',
    borderRadius: '4px',
    fontSize: '0.9rem',
    color: '#fff',
    overflowX: 'auto',
    whiteSpace: 'nowrap',
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    WebkitOverflowScrolling: 'touch',
  },
  metricGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: '10px',
    marginTop: '15px',
    marginBottom: '15px',
  },
  metricBox: {
    backgroundColor: '#161616',
    border: '1px solid #222',
    padding: '10px',
    borderRadius: '4px',
    display: 'flex',
    flexDirection: 'column',
  },
  metricLabel: { fontSize: '0.7rem', color: '#888', marginBottom: '3px' },
  metricValue: { fontSize: '1.1rem', fontWeight: 'bold', color: '#fff' },
  sectionTitle: { fontSize: '0.85rem', color: '#fff', marginBottom: '5px' },
  codeBlock: {
    backgroundColor: '#000',
    border: '1px solid #222',
    padding: '10px',
    borderRadius: '4px',
    color: '#888',
    overflowX: 'auto',
    fontSize: '0.75rem',
  },
};
