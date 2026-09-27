import React, { useEffect, useRef, useState } from 'react';
import SubmitView from './components/SubmitView.jsx';
import StatusView from './components/StatusView.jsx';
import ReportView from './components/ReportView.jsx';
import { api, pollReview } from './api.js';

// submit → poll → report. One review at a time (the demo flow).
export default function App() {
  const [view, setView] = useState('submit'); // submit | status | report
  const [review, setReview] = useState(null);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const stopPolling = useRef(null);

  useEffect(() => () => stopPolling.current?.(), []);

  const submit = async (payload, label) => {
    setError(null);
    try {
      const { reviewId } = await api.submit(payload);
      setReview({ id: reviewId, status: 'queued', label, checks: [] });
      setReport(null);
      setView('status');
      stopPolling.current?.();
      stopPolling.current = pollReview(reviewId, (r) => {
        setReview(r);
        if (r.report) {
          setReport(r.report);
          setView('report');
        }
      });
    } catch (err) {
      setError(String(err.message || err));
      throw err;
    }
  };

  const reset = () => {
    stopPolling.current?.();
    setView('submit');
    setReview(null);
    setReport(null);
    setError(null);
  };

  return (
    <div className="app">
      <header className="header">
        <div className="logo">
          🛡️ ReleaseGuard
          <span className="tagline">Release Readiness Report for institutional knowledge risk</span>
        </div>
        <div className="steps">
          <span className={view === 'submit' ? 'on' : ''}>1 · Submit</span>
          <span className={view === 'status' ? 'on' : ''}>2 · Parallel checks</span>
          <span className={view === 'report' ? 'on' : ''}>3 · Report</span>
        </div>
      </header>

      <main>
        {view === 'submit' && <SubmitView onSubmit={submit} error={error} />}
        {view === 'status' && review && <StatusView review={review} />}
        {view === 'report' && report && <ReportView report={report} onReset={reset} />}
      </main>
    </div>
  );
}
