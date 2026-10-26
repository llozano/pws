'use client';

import React, { useEffect, useRef, useState } from 'react';
import { MANDELBROT_PROBE } from '@/fingerprint/fractalConfig';
import {
  generateGridHash,
  runDeviceProfileProbe,
  generateGridHash256,
  analyzeMatrixVariance,
  type DeviceProfileProbeController,
  type QuantumLandscapeResult,
  type MatrixVarianceAnalysis,
} from '@/utils/quantumDiagnostics';

const DEFAULT_PROBE_SETTINGS = {
  width: 1024,
  height: 1024,
  zoom: MANDELBROT_PROBE.defaultZoom,
  audioAllowed: true,
} as const;

/** Renders the probe controls, progress log, identifiers, and stability measurements. */
export default function DiagnosticsDashboard() {
  const [status, setStatus] = useState<'idle' | 'running' | 'complete' | 'error' | 'cancelled'>(
    'idle',
  );
  const [result, setResult] = useState<QuantumLandscapeResult | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [resultHash, setResultHash] = useState<string>('');
  const [variance, setVariance] = useState<MatrixVarianceAnalysis | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [gpuStabilityEnabled, setGpuStabilityEnabled] = useState(false);
  const controllerRef = useRef<DeviceProfileProbeController | null>(null);
  const runSequenceRef = useRef(0);

  // Adds a timestamped message to the visible execution log.
  const addLog = (msg: string) => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  useEffect(() => {
    const controller = controllerRef;
    const runSequence = runSequenceRef;
    return () => {
      runSequence.current++;
      controller.current?.cancel();
    };
  }, []);

  // Starts a fresh probe and ignores callbacks from any previous run.
  const handleStartProbe = () => {
    controllerRef.current?.cancel();
    const runSequence = ++runSequenceRef.current;

    setStatus('running');
    setResult(null);
    setResultHash('');
    setVariance(null);
    setErrorMessage('');
    setLogs([]);

    addLog('Device-profile probe started.');

    controllerRef.current = runDeviceProfileProbe({
      ...DEFAULT_PROBE_SETTINGS,
      logUpdate: addLog,
      onComplete: async (quantumData: QuantumLandscapeResult) => {
        if (runSequence !== runSequenceRef.current) return;
        controllerRef.current = null;
        setResult(quantumData);

        if (quantumData.browserProfileId) {
          setResultHash(quantumData.browserProfileId);
          addLog(`Browser profile: ${quantumData.browserProfileId.slice(0, 16)}...`);
        } else {
          let hash: string;
          try {
            hash = await generateGridHash256(quantumData.potentialGrid);
          } catch {
            hash = generateGridHash(quantumData.potentialGrid);
          }
          setResultHash(hash);
          addLog(`Using a grid-only fallback hash: ${hash.slice(0, 24)}...`);
        }

        const stats = analyzeMatrixVariance(quantumData.potentialGrid);
        setVariance(stats);
        setStatus('complete');
        addLog('Device-profile probe complete.');
      },
      onError: (error) => {
        if (runSequence !== runSequenceRef.current) return;
        controllerRef.current = null;
        setErrorMessage(error.message);
        setStatus('error');
      },
      gpuStabilityEnabled,
    });
  };

  // Cancels the active run and invalidates any callbacks already in flight.
  const handleCancel = () => {
    runSequenceRef.current++;
    controllerRef.current?.cancel();
    controllerRef.current = null;
    setStatus('cancelled');
    addLog('Probe cancelled.');
  };

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>Device Profile Probe</h1>
      </header>

      <div style={styles.controlPanel}>
        <label style={styles.optionRow}>
          <input
            type="checkbox"
            checked={gpuStabilityEnabled}
            disabled={status === 'running'}
            onChange={(event) => setGpuStabilityEnabled(event.target.checked)}
          />
          <span>
            Run optional GPU load and recovery test
            <small style={styles.optionHelp}> Uses a bounded WebGPU workload when available.</small>
          </span>
        </label>

        <button
          onClick={status === 'running' ? handleCancel : handleStartProbe}
          style={{
            ...styles.btnActive,
            backgroundColor: status === 'running' ? '#a61b1b' : styles.btnActive.backgroundColor,
            cursor: 'pointer',
            touchAction: 'manipulation',
            WebkitTapHighlightColor: 'rgba(0,0,0,0)',
          }}
        >
          {status === 'running' ? 'Cancel Probe' : 'Run Device Profile'}
        </button>
      </div>

      {status === 'error' && (
        <div style={styles.errorCard} role="alert">
          <strong>Probe failed:</strong> {errorMessage}
        </div>
      )}

      {result?.browserProfileId && (
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Profile Identifiers</h3>

          <div style={{ marginBottom: '10px' }}>
            <span style={{ fontSize: '0.75rem', color: '#888' }}>BROWSER PROFILE ID:</span>
            <div style={styles.hashBadge}>{result.browserProfileId}</div>
          </div>

          {result.deviceClusterId ? (
            <div>
              <span style={{ fontSize: '0.75rem', color: '#00ff88' }}>
                SERVER DEVICE CLUSTER ID:
              </span>
              <div style={{ ...styles.hashBadge, borderColor: '#00ff88' }}>
                {result.deviceClusterId}
              </div>
              <p style={styles.matchSummary}>
                {result.matchedExistingDevice ? 'Existing cluster match' : 'New cluster'} ·{' '}
                {((result.deviceMatchConfidence ?? 0) * 100).toFixed(1)}% confidence ·{' '}
                {((result.deviceMatchEvidence ?? 0) * 100).toFixed(1)}% evidence coverage
              </p>
            </div>
          ) : (
            <p style={styles.matcherWarning}>
              Device matcher unavailable: {result.deviceMatchError || 'unknown error'}
            </p>
          )}
        </div>
      )}

      <section style={styles.terminalContainer} aria-live="polite">
        <h3 style={styles.terminalTitle}>Execution Log</h3>
        <div style={styles.terminalBox} role="log">
          {logs.length === 0 ? (
            <span style={{ color: '#444' }}>Ready to run.</span>
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
            <h2 style={styles.cardTitle}>Synthetic Probe Result</h2>

            <div style={styles.hashBadge}>
              <strong>RESULT ID:</strong> <span style={{ color: '#00ffff' }}>{resultHash}</span>
            </div>

            <p style={{ marginTop: '15px' }}>
              <strong>Description:</strong> {result.systemDescription}
            </p>

            <div style={styles.metricGrid}>
              <div style={styles.metricBox}>
                <span style={styles.metricLabel}>Fractal Backend</span>
                <span style={styles.metricValue}>{result.fractalBackend ?? 'unknown'}</span>
              </div>
              <div style={styles.metricBox}>
                <span style={styles.metricLabel}>Fractal Duration</span>
                <span style={styles.metricValue}>
                  {result.fractalDurationMs?.toFixed(1) ?? '0.0'} ms
                </span>
              </div>
              <div style={styles.metricBox}>
                <span style={styles.metricLabel}>Maximum Synthetic Delta</span>
                <span style={styles.metricValue}>{result.maxEnergyBarrier.toFixed(4)}</span>
              </div>
              <div style={styles.metricBox}>
                <span style={styles.metricLabel}>Non-Zero Grid Nodes</span>
                <span style={styles.metricValue}>{variance.activeGlitches.toLocaleString()}</span>
              </div>
              <div style={styles.metricBox}>
                <span style={styles.metricLabel}>Average Synthetic Delta</span>
                <span style={styles.metricValue}>{variance.averageDrift.toExponential(4)}</span>
              </div>
              {variance.invalidValues > 0 && (
                <div style={styles.metricBox}>
                  <span style={styles.metricLabel}>Invalid Grid Values</span>
                  <span style={styles.metricValue}>{variance.invalidValues.toLocaleString()}</span>
                </div>
              )}
            </div>

            {result.gpuStability && (
              <>
                <h3 style={styles.sectionTitle}>Experimental GPU Stability</h3>
                <p style={styles.stabilityNotice}>
                  Numerical changes may come from browser, driver, power, temperature, or system
                  load. They do not prove hardware failure and are not used for device matching.
                </p>
                <div style={styles.metricGrid}>
                  <div style={styles.metricBox}>
                    <span style={styles.metricLabel}>Cold Changed Pixels</span>
                    <span style={styles.metricValue}>
                      {(result.gpuStability.baseline.changedPixelRatio * 100).toFixed(3)}%
                    </span>
                  </div>
                  <div style={styles.metricBox}>
                    <span style={styles.metricLabel}>Loaded Changed Pixels</span>
                    <span style={styles.metricValue}>
                      {(result.gpuStability.loaded.changedPixelRatio * 100).toFixed(3)}%
                    </span>
                  </div>
                  <div style={styles.metricBox}>
                    <span style={styles.metricLabel}>Recovered Changed Pixels</span>
                    <span style={styles.metricValue}>
                      {(result.gpuStability.recovered.changedPixelRatio * 100).toFixed(3)}%
                    </span>
                  </div>
                  <div style={styles.metricBox}>
                    <span style={styles.metricLabel}>Stress Workload</span>
                    <span style={styles.metricValue}>
                      {result.gpuStability.stressPasses} passes
                    </span>
                  </div>
                </div>
              </>
            )}

            <h3 style={styles.sectionTitle}>First 15 Grid Values</h3>
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
  controlPanel: { marginBottom: '15px', display: 'grid', gap: '10px' },
  optionRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
    color: '#ccc',
    fontSize: '0.8rem',
  },
  optionHelp: {
    display: 'block',
    color: '#777',
    marginTop: '2px',
  },
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
  errorCard: {
    marginBottom: '15px',
    padding: '12px',
    border: '1px solid #a61b1b',
    borderRadius: '4px',
    backgroundColor: '#2b0d0d',
    color: '#ffb4b4',
  },
  matchSummary: {
    color: '#8ca99c',
    fontSize: '0.75rem',
    margin: '8px 0 0',
  },
  matcherWarning: {
    color: '#ffb347',
    fontSize: '0.8rem',
    margin: 0,
  },
  stabilityNotice: {
    color: '#aaa',
    fontSize: '0.75rem',
    lineHeight: '1.4',
    margin: '0 0 10px',
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
