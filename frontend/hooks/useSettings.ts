"use client";

import { useCallback, useEffect, useState } from "react";

import { API_URL, authHeaders } from "@/lib/api";
import type { AppSettings, MediaSettings } from "@/lib/types";

const FALLBACK: AppSettings = {
  media: { remote_content: false },
};

/** Reads the daemon's rendering preferences and writes toggles back to it. */
export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(FALLBACK);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    fetch(`${API_URL}/settings`, {
      signal: controller.signal,
      headers: authHeaders(),
    })
      .then((response) => response.json() as Promise<AppSettings>)
      .then(setSettings)
      .catch(() => {
        // Daemon unreachable: fall back to the conservative defaults.
      })
      .finally(() => setLoaded(true));

    return () => controller.abort();
  }, []);

  const updateMedia = useCallback(
    async (media: Partial<MediaSettings>) => {
      const next = { ...settings.media, ...media };
      setSettings({ media: next }); // optimistic, so toggles feel instant
      try {
        const response = await fetch(`${API_URL}/settings`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ media: next }),
        });
        setSettings((await response.json()) as AppSettings);
      } catch {
        setSettings(settings); // roll back on failure
      }
    },
    [settings],
  );

  return { settings, loaded, updateMedia };
}
