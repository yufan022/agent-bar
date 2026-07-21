import { useCallback, useEffect, useState } from "react";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";

export function SettingsPanel() {
  const [launchAtLogin, setLaunchAtLogin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const enabled = await isEnabled();
      setLaunchAtLogin(enabled);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onToggle = useCallback(async () => {
    if (saving || loading) {
      return;
    }

    const next = !launchAtLogin;
    setSaving(true);
    try {
      if (next) {
        await enable();
      } else {
        await disable();
      }
      setLaunchAtLogin(next);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }, [launchAtLogin, loading, saving]);

  return (
    <section className="card settings-card">
      <div className="settings-row">
        <div className="settings-row-copy">
          <h2>Launch at login</h2>
          <p className="muted">Start agent-bar when you log in to this Mac</p>
        </div>
        <button
          type="button"
          className={`toggle${launchAtLogin ? " toggle-on" : ""}`}
          role="switch"
          aria-checked={launchAtLogin}
          aria-label="Launch at login"
          disabled={loading || saving}
          onClick={() => void onToggle()}
        >
          <span className="toggle-thumb" />
        </button>
      </div>
      {error ? <p className="error-text settings-error">{error}</p> : null}
    </section>
  );
}
