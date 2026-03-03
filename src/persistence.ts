import type { AppState } from "./types";
import { defaultState, sanitizeState } from "./storage";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim() || "";
const stateUrl = `${apiBaseUrl}/api/state`;

async function ensureStateExists(): Promise<void> {
  const response = await fetch(stateUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ state: defaultState })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`SQLITE_INIT_FAILED:${response.status}:${text}`);
  }
}

export async function loadAppState(): Promise<AppState> {
  const response = await fetch(stateUrl);

  if (response.status === 404) {
    await ensureStateExists();
    return defaultState;
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`SQLITE_LOAD_FAILED:${response.status}:${text}`);
  }

  const payload = (await response.json()) as { state?: AppState };
  return sanitizeState(payload.state ?? defaultState);
}

export async function saveAppState(state: AppState): Promise<void> {
  const sanitized = sanitizeState(state);

  const response = await fetch(stateUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ state: sanitized })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`SQLITE_SAVE_FAILED:${response.status}:${text}`);
  }
}

export function getInitialState(): AppState {
  return defaultState;
}