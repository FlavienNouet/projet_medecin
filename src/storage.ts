import type { AppState } from "./types";
import { defaultExercises, defaultPatients, defaultProtocols } from "./data";

const STORAGE_KEY = "rehab-link-mvp-state";

export const defaultState: AppState = {
  exercises: defaultExercises,
  protocols: defaultProtocols,
  patients: defaultPatients,
  practitioners: [],
  assignments: [],
  painLogs: [],
  completionLogs: [],
  reminderSchedules: [],
  reminderLogs: []
};

function normalizeState(state: AppState): AppState {
  return {
    exercises: state.exercises?.length ? state.exercises : defaultExercises,
    protocols: state.protocols?.length ? state.protocols : defaultProtocols,
    patients: state.patients?.length ? state.patients : defaultPatients,
    practitioners: state.practitioners ?? [],
    assignments: state.assignments ?? [],
    painLogs: state.painLogs ?? [],
    completionLogs: state.completionLogs ?? [],
    reminderSchedules: state.reminderSchedules ?? [],
    reminderLogs: state.reminderLogs ?? []
  };
}

export function loadLocalState(): AppState {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return defaultState;
  }

  try {
    const parsed = JSON.parse(raw) as AppState;
    return normalizeState(parsed);
  } catch {
    return defaultState;
  }
}

export function saveLocalState(state: AppState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeState(state)));
}

export function sanitizeState(state: AppState): AppState {
  return normalizeState(state);
}