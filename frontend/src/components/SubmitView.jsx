import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

// Step 1 — pick a preset (sample repo + PR diff) or paste your own diff.
export default function SubmitView({ onSubmit, error: apiError }) {
  const [presets, setPresets] = useState([]);
  const [selected, setSelected] = useState(null);
  const [mode, setMode] = useState('preset'); // 'preset' | 'diff'
  const [diffText, setDiffText] = useState('');
  const [label, setLabel] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.presets().then((list) => {
      setPresets(list);
      if (list[0]) setSelected(list[0].id);
    }).catch(() => {});
  }, []);

  const submit = async () => {
    setError(null);
    if (mode === 'diff' && !diffText.trim()) {
      setError('Paste a unified diff first');
      return;
    }
    setLoading(true);
    try {
      if (mode === 'preset') {
        await onSubmit({ preset: selected }, presets.find((p) => p.id === selected)?.label);
      } else {
        await onSubmit({ diffText, label: label || 'Pasted diff' }, label || 'Pasted diff');
      }
    } catch {
      /* API error is rendered from props (set by App) */
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <h2>Submit a PR for review</h2>
      <div className="tabs">
        <button className={mode === 'preset' ? 'tab active' : 'tab'} onClick={() => setMode('preset')}>
          Sample presets
        </button>
        <button className={mode === 'diff' ? 'tab active' : 'tab'} onClick={() => setMode('diff')}>
          Paste a diff
        </button>
      </div>

      {mode === 'preset' ? (
        <div className="preset-list">
          {presets.map((p) => (
            <label key={p.id} className={selected === p.id ? 'preset selected' : 'preset'}>
              <input
                type="radio"
                name="preset"
                checked={selected === p.id}
                onChange={() => setSelected(p.id)}
              />
              <span>
                <strong>{p.label}</strong>
                <small>{p.repoPath}</small>
              </span>
            </label>
          ))}
          {presets.length === 0 && <p className="muted">Loading presets… (is the backend running?)</p>}
        </div>
      ) : (
        <div className="diff-form">
          <input
            className="input"
            placeholder="Label (e.g. my-feature-pr)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <textarea
            className="textarea"
            rows={10}
            placeholder={'diff --git a/src/example.js b/src/example.js\n…'}
            value={diffText}
            onChange={(e) => setDiffText(e.target.value)}
          />
        </div>
      )}

      {(error || apiError) && <p className="error">{error || apiError}</p>}

      <button className="primary" onClick={submit} disabled={loading}>
        {loading ? 'Submitting…' : 'Run release readiness review'}
      </button>
      <p className="muted">
        Four subagents (test coverage, docs-vs-behavior, ownership, breaking changes) run in parallel on
        the diff + document-understanding baseline.
      </p>
    </div>
  );
}
