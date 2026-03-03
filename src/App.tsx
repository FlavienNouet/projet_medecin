import { useEffect, useMemo, useState, type DragEvent } from "react";
import { getInitialState, loadAppState, saveAppState } from "./persistence";
import type { AppState, Exercise, Patient, PractitionerAccount } from "./types";

type View = "praticien" | "patient";
type ChartPoint = { label: string; value: number };
type PractitionerTab = "dashboard" | "assignation" | "patients" | "rappels" | "suivi" | "bibliotheque";
type PractitionerPatientTab = "patients" | "protocoles";
type PatientTab = "dashboard" | "acces" | "exercices" | "douleur" | "historique";
type PatientExerciseFilter = "all" | "done" | "pending";
type PatientHistoryEntry = {
  id: string;
  type: "completion" | "pain";
  title: string;
  detail: string;
  dateIso: string;
  exerciseId?: string;
  painValue?: number;
};

const PRACTITIONER_SESSION_STORAGE_KEY = "rehablink_practitioner_session";
const PATIENT_SESSION_STORAGE_KEY = "rehablink_patient_session";

function readStorageValue(key: string): string | null {
  try {
    const value = window.localStorage.getItem(key);
    return value && value.trim() ? value : null;
  } catch {
    return null;
  }
}

function getYoutubeEmbedUrl(videoUrl: string): string | null {
  try {
    const url = new URL(videoUrl);
    if (url.hostname.includes("youtube.com")) {
      const videoId = url.searchParams.get("v");
      return videoId ? `https://www.youtube.com/embed/${videoId}` : null;
    }
    if (url.hostname.includes("youtu.be")) {
      const videoId = url.pathname.replace("/", "");
      return videoId ? `https://www.youtube.com/embed/${videoId}` : null;
    }
    return null;
  } catch {
    return null;
  }
}

function inferTitleFromUrl(videoUrl: string): string {
  try {
    const url = new URL(videoUrl);
    const lastPart = url.pathname.split("/").filter(Boolean).pop();
    if (!lastPart) {
      return "Nouvel exercice";
    }
    return decodeURIComponent(lastPart).replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[-_]+/g, " ");
  } catch {
    return "Nouvel exercice";
  }
}

function VideoPreview({ videoUrl, title }: { videoUrl: string; title: string }) {
  const youtubeEmbedUrl = getYoutubeEmbedUrl(videoUrl);

  if (youtubeEmbedUrl) {
    return (
      <iframe
        className="video-player"
        src={youtubeEmbedUrl}
        title={title}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
      />
    );
  }

  return <video className="video-player" src={videoUrl} controls preload="metadata" />;
}

function buildPainTrend(logs: { value: number; dateIso: string }[]): ChartPoint[] {
  const dayMap = new Map<string, { sum: number; count: number }>();

  const getDayKey = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  for (const log of logs) {
    const date = new Date(log.dateIso);
    if (Number.isNaN(date.getTime())) {
      continue;
    }

    const key = getDayKey(date);
    const existing = dayMap.get(key);

    if (existing) {
      existing.sum += log.value;
      existing.count += 1;
    } else {
      dayMap.set(key, {
        sum: log.value,
        count: 1
      });
    }
  }

  const end = new Date();
  end.setHours(0, 0, 0, 0);

  const points: ChartPoint[] = [];
  for (let index = 6; index >= 0; index -= 1) {
    const day = new Date(end);
    day.setDate(end.getDate() - index);
    const key = getDayKey(day);
    const entry = dayMap.get(key);

    points.push({
      label: day.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }),
      value: entry ? Number((entry.sum / entry.count).toFixed(1)) : 0
    });
  }

  return points;
}

function VerticalBarChart({
  data,
  yLabel,
  yMax,
  unit = "",
  tickCount = 5
}: {
  data: ChartPoint[];
  yLabel: string;
  yMax?: number;
  unit?: string;
  tickCount?: number;
}) {
  if (data.length === 0) {
    return <p className="small-text">Aucune donnée pour ce graphique.</p>;
  }

  const maxDataValue = Math.max(1, ...data.map((item) => item.value));
  const maxValue = Math.max(1, yMax ?? maxDataValue);
  const safeTickCount = Math.max(2, tickCount);
  const ticks = Array.from({ length: safeTickCount + 1 }, (_, index) => {
    const tickValue = maxValue - (index * maxValue) / safeTickCount;
    return Number.isInteger(tickValue) ? tickValue : Number(tickValue.toFixed(1));
  });

  return (
    <div className="vbar-wrap" role="img" aria-label="Histogramme des exercices validés par jour">
      <div className="vbar-y-label">{yLabel}</div>
      <div className="vbar-plot">
        <div className="vbar-grid">
          {ticks.map((tick) => (
            <div key={`tick-${tick}`} className="vbar-grid-row">
              <span className="vbar-tick-label">{tick}</span>
              <span className="vbar-grid-line" />
            </div>
          ))}
        </div>

        <div className="vbar-columns">
          {data.map((item, index) => {
            const ratio = Math.max(0, Math.min(100, (item.value / maxValue) * 100));
            return (
              <div key={`vbar-${item.label}-${index}`} className="vbar-col">
                <div className="vbar-value">{item.value}{unit}</div>
                <div className="vbar-track">
                  <div className="vbar-fill" style={{ height: `${ratio}%` }} />
                </div>
                <div className="vbar-x-label">{item.label}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PieChart({ data }: { data: ChartPoint[] }) {
  const slices = data.filter((item) => item.value > 0);
  if (slices.length === 0) {
    return <p className="small-text">Aucune donnée pour ce graphique.</p>;
  }

  const total = slices.reduce((sum, item) => sum + item.value, 0);
  const colors = ["#0f766e", "#14b8a6", "#0ea5e9", "#6366f1", "#f59e0b", "#ef4444", "#8b5cf6", "#22c55e"];

  let current = 0;
  const segments = slices.map((slice, index) => {
    const start = current;
    const ratio = slice.value / total;
    current += ratio;
    const end = current;

    return {
      ...slice,
      color: colors[index % colors.length],
      start,
      end,
      percent: Math.round(ratio * 100)
    };
  });

  const gradient = segments
    .map((segment) => `${segment.color} ${(segment.start * 100).toFixed(2)}% ${(segment.end * 100).toFixed(2)}%`)
    .join(", ");

  return (
    <div className="pie-wrap">
      <div className="pie-chart" style={{ backgroundImage: `conic-gradient(${gradient})` }} aria-label="Camembert des programmes assignés" />
      <ul className="pie-legend">
        {segments.map((segment) => (
          <li key={`pie-${segment.label}`}>
            <span className="pie-dot" style={{ backgroundColor: segment.color }} aria-hidden="true" />
            <span className="pie-label">{segment.label}</span>
            <span className="pie-value">{segment.value} ({segment.percent}%)</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LineChart({ data, yMax = 10, chartHeight = 190 }: { data: ChartPoint[]; yMax?: number; chartHeight?: number }) {
  if (data.length === 0) {
    return <p className="small-text">Aucune donnée pour ce graphique.</p>;
  }

  if (!data.some((item) => item.value > 0)) {
    return <p className="small-text">Aucune saisie douleur sur la période.</p>;
  }

  const width = 560;
  const height = chartHeight;
  const padding = 24;
  const yLabelPadding = 34;
  const leftAxisX = padding + yLabelPadding;
  const maxValue = Math.max(yMax, ...data.map((item) => item.value), 1);
  const safeSteps = Math.max(data.length - 1, 1);
  const yTicks = 5;
  const yTickValues = Array.from({ length: yTicks + 1 }, (_, index) => {
    const value = maxValue - (index * maxValue) / yTicks;
    return Number.isInteger(value) ? value : Number(value.toFixed(1));
  });

  const points = data.map((item, index) => {
    const x = leftAxisX + (index / safeSteps) * (width - leftAxisX - padding);
    const y = height - padding - (item.value / maxValue) * (height - padding * 2);
    return { x, y, label: item.label };
  });

  const polylinePoints = points.map((point) => `${point.x},${point.y}`).join(" ");

  return (
    <div className="line-chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} className="line-chart" role="img" aria-label="Graphique de tendance">
        {yTickValues.map((tick, index) => {
          const y = padding + (index / yTicks) * (height - padding * 2);
          return (
            <g key={`line-tick-${tick}-${index}`}>
              <line x1={leftAxisX} y1={y} x2={width - padding} y2={y} className="line-grid" />
              <text x={leftAxisX - 8} y={y + 4} className="line-y-tick" textAnchor="end">{tick}</text>
            </g>
          );
        })}
        <line x1={leftAxisX} y1={height - padding} x2={width - padding} y2={height - padding} className="line-axis" />
        <line x1={leftAxisX} y1={padding} x2={leftAxisX} y2={height - padding} className="line-axis" />
        <polyline points={polylinePoints} className="line-path" />
        {points.map((point) => (
          <circle key={`${point.label}-${point.x}`} cx={point.x} cy={point.y} r={4} className="line-dot" />
        ))}
      </svg>
      <div className="line-labels">
        {points.map((point, index) => (
          <span key={`${point.label}-${index}`} className="line-label">{point.label}</span>
        ))}
      </div>
    </div>
  );
}

function getExercisesForPatient(patient: Patient, state: AppState): Exercise[] {
  const assignment = state.assignments.find((item) => item.patientId === patient.id);
  if (!assignment) {
    return [];
  }

  const protocolExerciseIds = assignment.protocolIds
    .flatMap((protocolId) => state.protocols.find((item) => item.id === protocolId)?.exerciseIds ?? []);

  const uniqueIds = Array.from(new Set(protocolExerciseIds));

  return uniqueIds
    .map((exerciseId) => state.exercises.find((item) => item.id === exerciseId))
    .filter((item): item is Exercise => Boolean(item));
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function makeTokenFromName(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 18);
  return `${base || "patient"}-${Math.random().toString(36).slice(2, 6)}`;
}

function makePatientPassword(): string {
  return Math.random().toString(36).slice(2, 10);
}

function makeUniquePatientToken(name: string, patients: Patient[]): string {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const token = makeTokenFromName(name);
    if (!patients.some((patient) => patient.token.toLowerCase() === token.toLowerCase())) {
      return token;
    }
  }

  return `${name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 14) || "patient"}-${Date.now().toString(36)}`;
}

function daysSince(dateIso: string): number {
  const date = new Date(dateIso);
  if (Number.isNaN(date.getTime())) {
    return Number.POSITIVE_INFINITY;
  }

  const now = new Date();
  const startNow = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return Math.floor((startNow - startDate) / (24 * 60 * 60 * 1000));
}

export default function App() {
  const [view, setView] = useState<View>("praticien");
  const [state, setState] = useState<AppState>(() => getInitialState());
  const [isBootstrapping, setIsBootstrapping] = useState(true);

  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [patientSearchQuery, setPatientSearchQuery] = useState("");
  const [isPatientSearchOpen, setIsPatientSearchOpen] = useState(false);
  const [selectedProtocolId, setSelectedProtocolId] = useState("");
  const [quickAssignProtocolIds, setQuickAssignProtocolIds] = useState<string[]>([]);
  const [newPatientName, setNewPatientName] = useState("");
  const [newProtocolName, setNewProtocolName] = useState("");
  const [editingProtocolId, setEditingProtocolId] = useState<string | null>(null);
  const [editingProtocolName, setEditingProtocolName] = useState("");
  const [editingProtocolDescription, setEditingProtocolDescription] = useState("");
  const [editingProtocolExercises, setEditingProtocolExercises] = useState<string[]>([]);
  const [protocolExerciseToAdd, setProtocolExerciseToAdd] = useState("");
  const [protocolStatus, setProtocolStatus] = useState<"idle" | "created" | "saved" | "deleted">("idle");
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [newExerciseTitle, setNewExerciseTitle] = useState("");
  const [newExerciseUrl, setNewExerciseUrl] = useState("");
  const [newExerciseRepetitions, setNewExerciseRepetitions] = useState("3 x 12");
  const [newExerciseRest, setNewExerciseRest] = useState("45 sec");
  const [newExerciseInstructions, setNewExerciseInstructions] = useState("Réaliser le mouvement lentement et sans douleur vive.");
  const [dropMessage, setDropMessage] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [editingExerciseId, setEditingExerciseId] = useState<string | null>(null);
  const [editingExerciseTitle, setEditingExerciseTitle] = useState("");
  const [editingExerciseUrl, setEditingExerciseUrl] = useState("");
  const [editingExerciseRepetitions, setEditingExerciseRepetitions] = useState("");
  const [editingExerciseRest, setEditingExerciseRest] = useState("");
  const [editingExerciseInstructions, setEditingExerciseInstructions] = useState("");
  const [libraryStatus, setLibraryStatus] = useState<"idle" | "ok" | "error">("idle");

  const [patientTokenInput, setPatientTokenInput] = useState("");
  const [patientPasswordInput, setPatientPasswordInput] = useState("");
  const [painValue, setPainValue] = useState(3);
  const [painContext, setPainContext] = useState<"avant" | "apres" | "repos">("apres");
  const [painComment, setPainComment] = useState("");
  const [painSubmitStatus, setPainSubmitStatus] = useState<"idle" | "saved">("idle");
  const [exerciseSubmitStatusId, setExerciseSubmitStatusId] = useState<string | null>(null);
  const [historyDeleteMessage, setHistoryDeleteMessage] = useState("");
  const [copyStatus, setCopyStatus] = useState<"idle" | "ok" | "error">("idle");
  const [latestPatientAccess, setLatestPatientAccess] = useState<{ id: string; name: string; token: string; password: string } | null>(null);
  const [patientAccountNameInput, setPatientAccountNameInput] = useState("");
  const [patientAccountTokenInput, setPatientAccountTokenInput] = useState("");
  const [patientAccountPasswordInput, setPatientAccountPasswordInput] = useState("");
  const [patientAccountStatus, setPatientAccountStatus] = useState<"idle" | "saved">("idle");
  const [patientCreateStatus, setPatientCreateStatus] = useState<"idle" | "created">("idle");
  const [quickAssignStatus, setQuickAssignStatus] = useState<"idle" | "saved">("idle");
  const [reminderSessionsPerWeek, setReminderSessionsPerWeek] = useState(3);
  const [reminderChannel, setReminderChannel] = useState<"email" | "sms">("email");
  const [reminderTime, setReminderTime] = useState("18:30");
  const [reminderStatus, setReminderStatus] = useState<"idle" | "saved" | "sent">("idle");
  const [dbError, setDbError] = useState<string | null>(null);
  const [practitionerSessionId, setPractitionerSessionId] = useState<string | null>(() => readStorageValue(PRACTITIONER_SESSION_STORAGE_KEY));
  const [patientSessionId, setPatientSessionId] = useState<string | null>(() => readStorageValue(PATIENT_SESSION_STORAGE_KEY));
  const [practitionerMode, setPractitionerMode] = useState<"login" | "register">("register");
  const [practitionerNameInput, setPractitionerNameInput] = useState("");
  const [practitionerEmailInput, setPractitionerEmailInput] = useState("");
  const [practitionerPasswordInput, setPractitionerPasswordInput] = useState("");
  const [authError, setAuthError] = useState("");
  const [authInfo, setAuthInfo] = useState("");
  const [activePractitionerTab, setActivePractitionerTab] = useState<PractitionerTab>("assignation");
  const [activePractitionerPatientTab, setActivePractitionerPatientTab] = useState<PractitionerPatientTab>("patients");
  const [patientAccountsSearch, setPatientAccountsSearch] = useState("");
  const [patientAccountsCarouselIndex, setPatientAccountsCarouselIndex] = useState(0);
  const [protocolsSearch, setProtocolsSearch] = useState("");
  const [protocolsCarouselIndex, setProtocolsCarouselIndex] = useState(0);
  const [activePatientTab, setActivePatientTab] = useState<PatientTab>("exercices");
  const [patientExerciseFilter, setPatientExerciseFilter] = useState<PatientExerciseFilter>("pending");

  const allPatients = state.patients;
  const practitioners = state.practitioners;
  const currentPractitioner = useMemo(
    () => practitioners.find((item) => item.id === practitionerSessionId) ?? null,
    [practitionerSessionId, practitioners]
  );

  const patients = useMemo(() => {
    if (!currentPractitioner) {
      return [];
    }
    return allPatients.filter((item) => item.practitionerId === currentPractitioner.id);
  }, [allPatients, currentPractitioner]);

  const protocols = state.protocols;
  const exercises = state.exercises;

  const selectedPatient = useMemo(
    () => patients.find((item) => item.id === selectedPatientId) ?? null,
    [patients, selectedPatientId]
  );

  const filteredPatientAccounts = useMemo(() => {
    const query = patientAccountsSearch.trim().toLowerCase();
    if (!query) {
      return patients;
    }
    return patients.filter((patient) => {
      const label = `${patient.name} ${patient.token}`.toLowerCase();
      return label.includes(query);
    });
  }, [patientAccountsSearch, patients]);

  const activePatientAccount = filteredPatientAccounts[patientAccountsCarouselIndex] ?? null;

  const filteredProtocols = useMemo(() => {
    const query = protocolsSearch.trim().toLowerCase();
    if (!query) {
      return protocols;
    }
    return protocols.filter((protocol) => {
      const label = `${protocol.name} ${protocol.description ?? ""}`.toLowerCase();
      return label.includes(query);
    });
  }, [protocols, protocolsSearch]);

  const protocolCardsPerPage = 3;
  const visibleProtocolCards = useMemo(
    () => filteredProtocols.slice(protocolsCarouselIndex, protocolsCarouselIndex + protocolCardsPerPage),
    [filteredProtocols, protocolsCarouselIndex]
  );

  const patientSearchSuggestions = useMemo(() => {
    const normalizedQuery = patientSearchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return patients.slice(0, 6);
    }
    return patients
      .filter((patient) => {
        const label = `${patient.name} (${patient.token})`.toLowerCase();
        return label.includes(normalizedQuery) || patient.token.toLowerCase().includes(normalizedQuery);
      })
      .slice(0, 6);
  }, [patientSearchQuery, patients]);

  const selectedProtocol = useMemo(
    () => protocols.find((item) => item.id === selectedProtocolId) ?? null,
    [protocols, selectedProtocolId]
  );

  const currentPatient = useMemo(
    () => allPatients.find((item) => item.id === patientSessionId) ?? null,
    [allPatients, patientSessionId]
  );

  const currentExercises = useMemo(() => {
    if (!currentPatient) {
      return [];
    }
    return getExercisesForPatient(currentPatient, state);
  }, [currentPatient, state]);

  const completedExerciseIds = useMemo(() => {
    if (!currentPatient) {
      return new Set<string>();
    }

    return new Set(
      state.completionLogs
        .filter((log) => log.patientId === currentPatient.id)
        .map((log) => log.exerciseId)
    );
  }, [currentPatient, state.completionLogs]);

  const featuredPatientExercise = useMemo(() => {
    const filteredExercises = currentExercises.filter((exercise) => {
      if (patientExerciseFilter === "done") {
        return completedExerciseIds.has(exercise.id);
      }
      if (patientExerciseFilter === "pending") {
        return !completedExerciseIds.has(exercise.id);
      }
      return true;
    });

    if (filteredExercises.length === 0) {
      return null;
    }

    const nextToDo = filteredExercises.find((exercise) => !completedExerciseIds.has(exercise.id));
    return nextToDo ?? filteredExercises[0];
  }, [completedExerciseIds, currentExercises, patientExerciseFilter]);

  const filteredPatientExercises = useMemo(() => {
    return currentExercises.filter((exercise) => {
      if (patientExerciseFilter === "done") {
        return completedExerciseIds.has(exercise.id);
      }
      if (patientExerciseFilter === "pending") {
        return !completedExerciseIds.has(exercise.id);
      }
      return true;
    });
  }, [completedExerciseIds, currentExercises, patientExerciseFilter]);

  const remainingPatientExercises = useMemo(() => {
    if (!featuredPatientExercise) {
      return [];
    }

    return filteredPatientExercises.filter((exercise) => exercise.id !== featuredPatientExercise.id);
  }, [featuredPatientExercise, filteredPatientExercises]);

  const patientAssignedProtocols = useMemo(() => {
    if (!currentPatient) {
      return [];
    }

    const assignment = state.assignments.find((item) => item.patientId === currentPatient.id);
    if (!assignment) {
      return [];
    }

    return assignment.protocolIds
      .map((protocolId) => state.protocols.find((item) => item.id === protocolId))
      .filter((item): item is (typeof state.protocols)[number] => Boolean(item));
  }, [currentPatient, state.assignments, state.protocols]);

  const patientCompletion = useMemo(() => {
    if (!currentPatient) {
      return { done: 0, total: 0, percent: 0 };
    }

    const total = currentExercises.length;
    const done = currentExercises.filter((exercise) =>
      state.completionLogs.some(
        (log) => log.patientId === currentPatient.id && log.exerciseId === exercise.id
      )
    ).length;

    if (total === 0) {
      return { done: 0, total: 0, percent: 0 };
    }

    return {
      done,
      total,
      percent: Math.round((done / total) * 100)
    };
  }, [currentExercises, currentPatient, state.completionLogs]);

  const adherenceByPatient = useMemo(() => {
    return patients.map((patient) => {
      const assigned = getExercisesForPatient(patient, state);
      if (assigned.length === 0) {
        return { patientId: patient.id, percent: 0 };
      }

      const doneCount = assigned.filter((exercise) =>
        state.completionLogs.some(
          (log) => log.patientId === patient.id && log.exerciseId === exercise.id
        )
      ).length;

      return {
        patientId: patient.id,
        percent: Math.round((doneCount / assigned.length) * 100)
      };
    });
  }, [state]);

  const patientRecentActivity = useMemo(() => {
    if (!currentPatient) {
      return [] as PatientHistoryEntry[];
    }

    const completionEvents = state.completionLogs
      .filter((entry) => entry.patientId === currentPatient.id)
      .map((entry) => {
        const exercise = state.exercises.find((item) => item.id === entry.exerciseId);
        return {
          id: `completion-${entry.exerciseId}-${entry.dateIso}`,
          type: "completion" as const,
          title: "Exercice validé",
          detail: exercise?.title ?? "Exercice",
          dateIso: entry.dateIso,
          exerciseId: entry.exerciseId
        };
      });

    const painEvents = state.painLogs
      .filter((entry) => entry.patientId === currentPatient.id)
      .map((entry) => {
        const contextLabel = entry.context ? ` (${entry.context})` : "";
        return {
          id: `pain-${entry.dateIso}-${entry.value}`,
          type: "pain" as const,
          title: `Douleur ${entry.value}/10${contextLabel}`,
          detail: entry.comment ? entry.comment : "Aucun commentaire.",
          dateIso: entry.dateIso,
          painValue: entry.value
        };
      });

    return [...completionEvents, ...painEvents]
      .sort((a, b) => new Date(b.dateIso).getTime() - new Date(a.dateIso).getTime())
      .slice(0, 14);
  }, [currentPatient, state.completionLogs, state.exercises, state.painLogs]);

  const patientActivityByDay = useMemo(() => {
    const groups = new Map<string, { dayLabel: string; items: PatientHistoryEntry[] }>();

    for (const item of patientRecentActivity) {
      const date = new Date(item.dateIso);
      const dayKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
      const dayLabel = date.toLocaleDateString("fr-FR", {
        weekday: "long",
        day: "2-digit",
        month: "long"
      });

      if (!groups.has(dayKey)) {
        groups.set(dayKey, { dayLabel, items: [] });
      }

      groups.get(dayKey)?.items.push(item);
    }

    return Array.from(groups.entries()).map(([key, value]) => ({
      key,
      dayLabel: value.dayLabel,
      items: value.items
    }));
  }, [patientRecentActivity]);

  const patientHistorySummary = useMemo(() => {
    const todayKey = (() => {
      const now = new Date();
      return `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
    })();

    const todayCount = patientActivityByDay.find((group) => group.key === todayKey)?.items.length ?? 0;
    const painCount = patientRecentActivity.filter((entry) => entry.type === "pain").length;

    return {
      total: patientRecentActivity.length,
      today: todayCount,
      pain: painCount
    };
  }, [patientActivityByDay, patientRecentActivity]);

  const adminAdherenceChart = useMemo(
    () =>
      patients.map((patient) => ({
        label: patient.name,
        value: adherenceByPatient.find((item) => item.patientId === patient.id)?.percent ?? 0
      })),
    [adherenceByPatient, patients]
  );

  const adminProgramsByPatientChart = useMemo(
    () =>
      patients.map((patient) => {
        const assignment = state.assignments.find((item) => item.patientId === patient.id);
        return {
          label: patient.name,
          value: assignment?.protocolIds.length ?? 0
        };
      }),
    [patients, state.assignments]
  );

  const adminProgramsByProtocolChart = useMemo(() => {
    const patientIds = new Set(patients.map((patient) => patient.id));
    const countByProtocolId = new Map<string, number>();

    for (const assignment of state.assignments) {
      if (!patientIds.has(assignment.patientId)) {
        continue;
      }

      for (const protocolId of assignment.protocolIds) {
        countByProtocolId.set(protocolId, (countByProtocolId.get(protocolId) ?? 0) + 1);
      }
    }

    return protocols
      .map((protocol) => ({
        label: protocol.name,
        value: countByProtocolId.get(protocol.id) ?? 0
      }))
      .filter((item) => item.value > 0)
      .slice(0, 8);
  }, [patients, protocols, state.assignments]);

  const adminPainTrend = useMemo(() => {
    const patientIds = new Set(patients.map((item) => item.id));
    const logs = state.painLogs.filter((item) => patientIds.has(item.patientId));
    return buildPainTrend(logs);
  }, [patients, state.painLogs]);

  const patientPainTrend = useMemo(() => {
    if (!currentPatient) {
      return [];
    }
    const logs = state.painLogs.filter((item) => item.patientId === currentPatient.id);
    return buildPainTrend(logs);
  }, [currentPatient, state.painLogs]);

  const patientDonePerDayChart = useMemo(() => {
    if (!currentPatient) {
      return [];
    }

    const getDayKey = (date: Date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };

    const dayCount = new Map<string, number>();
    for (const log of state.completionLogs) {
      if (log.patientId !== currentPatient.id) {
        continue;
      }
      const date = new Date(log.dateIso);
      if (Number.isNaN(date.getTime())) {
        continue;
      }
      const key = getDayKey(date);
      dayCount.set(key, (dayCount.get(key) ?? 0) + 1);
    }

    const end = new Date();
    end.setHours(0, 0, 0, 0);

    const points: ChartPoint[] = [];
    for (let index = 6; index >= 0; index -= 1) {
      const day = new Date(end);
      day.setDate(end.getDate() - index);
      const key = getDayKey(day);
      points.push({
        label: day.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }),
        value: dayCount.get(key) ?? 0
      });
    }

    return points;
  }, [currentPatient, state.completionLogs]);

  const adminKpis = useMemo(() => {
    const patientIds = new Set(patients.map((item) => item.id));
    const assignedPatients = state.assignments.filter((item) => patientIds.has(item.patientId)).length;
    const avgAdherence = adherenceByPatient.length
      ? Math.round(adherenceByPatient.reduce((sum, item) => sum + item.percent, 0) / adherenceByPatient.length)
      : 0;
    const painLogs = state.painLogs.filter((item) => patientIds.has(item.patientId));
    const avgPain = painLogs.length
      ? Number((painLogs.reduce((sum, item) => sum + item.value, 0) / painLogs.length).toFixed(1))
      : 0;

    return {
      totalPatients: patients.length,
      assignedPatients,
      avgAdherence,
      avgPain
    };
  }, [adherenceByPatient, patients, state.assignments, state.painLogs]);

  const selectedPatientReminderSchedule = useMemo(() => {
    if (!selectedPatient) {
      return null;
    }
    return state.reminderSchedules.find((item) => item.patientId === selectedPatient.id) ?? null;
  }, [selectedPatient, state.reminderSchedules]);

  const reminderCandidates = useMemo(() => {
    const now = new Date();
    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    return patients
      .map((patient) => {
        const schedule = state.reminderSchedules.find((item) => item.patientId === patient.id);
        if (!schedule || !schedule.active) {
          return null;
        }

        const hasAssignedProgram = state.assignments.some((item) => item.patientId === patient.id);
        if (!hasAssignedProgram) {
          return null;
        }

        const patientCompletions = state.completionLogs.filter((entry) => entry.patientId === patient.id);
        const completedLast7Days = patientCompletions.filter((entry) => daysSince(entry.dateIso) <= 6).length;
        const lastCompletion = patientCompletions
          .slice()
          .sort((a, b) => new Date(b.dateIso).getTime() - new Date(a.dateIso).getTime())[0];
        const daysWithoutCompletion = lastCompletion ? daysSince(lastCompletion.dateIso) : Number.POSITIVE_INFINITY;

        const alreadyRemindedToday = state.reminderLogs.some((entry) => {
          if (entry.patientId !== patient.id) {
            return false;
          }
          const date = new Date(entry.dateIso);
          const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
          return key === todayKey;
        });

        const dueByInactivity = daysWithoutCompletion >= 2;
        const dueByObjective = completedLast7Days < schedule.sessionsPerWeek;
        const shouldSend = (dueByInactivity || dueByObjective) && !alreadyRemindedToday;

        if (!shouldSend) {
          return null;
        }

        const reason = dueByInactivity
          ? `Aucune séance validée depuis ${daysWithoutCompletion} jours.`
          : `Objectif hebdomadaire non atteint (${completedLast7Days}/${schedule.sessionsPerWeek}).`;

        return {
          patientId: patient.id,
          patientName: patient.name,
          channel: schedule.channel,
          message: `Rappel automatique (${schedule.reminderTime}) - ${reason}`
        };
      })
      .filter((item): item is { patientId: string; patientName: string; channel: "email" | "sms"; message: string } => Boolean(item));
  }, [patients, state.assignments, state.completionLogs, state.reminderLogs, state.reminderSchedules]);

  const adminAlerts = useMemo(() => {
    const alerts: string[] = [];

    for (const patient of patients) {
      const adherence = adherenceByPatient.find((item) => item.patientId === patient.id)?.percent ?? 0;
      const hasAssignedProgram = state.assignments.some((item) => item.patientId === patient.id);

      if (hasAssignedProgram && adherence < 50) {
        alerts.push(`${patient.name}: adhérence faible (${adherence}%).`);
      }

      const painEntries = state.painLogs
        .filter((item) => item.patientId === patient.id)
        .sort((a, b) => new Date(a.dateIso).getTime() - new Date(b.dateIso).getTime());

      const completionEntries = state.completionLogs
        .filter((item) => item.patientId === patient.id)
        .sort((a, b) => new Date(a.dateIso).getTime() - new Date(b.dateIso).getTime());

      if (painEntries.length >= 2) {
        const previous = painEntries[painEntries.length - 2].value;
        const latest = painEntries[painEntries.length - 1].value;
        if (latest - previous >= 2) {
          alerts.push(`${patient.name}: douleur en hausse (${previous} → ${latest}).`);
        }
      }

      if (painEntries.length >= 3) {
        const lastThree = painEntries.slice(-3).map((entry) => entry.value);
        if (lastThree[0] <= lastThree[1] && lastThree[1] <= lastThree[2] && lastThree[2] >= 7) {
          alerts.push(`${patient.name}: douleur élevée persistante (3 dernières saisies).`);
        }
      }

      if (completionEntries.length > 0) {
        const latestCompletion = completionEntries[completionEntries.length - 1];
        if (daysSince(latestCompletion.dateIso) >= 3) {
          alerts.push(`${patient.name}: aucune séance validée depuis 3 jours ou plus.`);
        }
      }
    }

    return alerts.slice(0, 8);
  }, [adherenceByPatient, patients, state.assignments, state.painLogs]);

  const adminDailyTasks = useMemo(() => {
    const tasks: string[] = [];

    if (reminderCandidates.length > 0) {
      tasks.push(`${reminderCandidates.length} rappel(s) à envoyer aujourd'hui.`);
    }

    const patientsWithoutProgram = patients.filter(
      (patient) => !state.assignments.some((assignment) => assignment.patientId === patient.id)
    ).length;

    if (patientsWithoutProgram > 0) {
      tasks.push(`${patientsWithoutProgram} patient(s) sans programme assigné.`);
    }

    const protocolsWithoutVideos = protocols.filter((protocol) => protocol.exerciseIds.length === 0).length;
    if (protocolsWithoutVideos > 0) {
      tasks.push(`${protocolsWithoutVideos} protocole(s) sans vidéo associée.`);
    }

    if (adminAlerts.length > 0) {
      tasks.push(...adminAlerts.slice(0, 3));
    }

    if (tasks.length === 0) {
      tasks.push("Aucune tâche urgente aujourd'hui.");
    }

    return tasks.slice(0, 8);
  }, [adminAlerts, patients, protocols, reminderCandidates, state.assignments]);

  const activeCarouselExercise = exercises[carouselIndex] ?? null;

  function persist(nextState: AppState) {
    setState(nextState);
    void saveAppState(nextState).catch((error: unknown) => {
      setDbError(error instanceof Error ? error.message : "Erreur de sauvegarde SQLite/Prisma");
    });
  }

  function resetAuthFeedback() {
    setAuthError("");
    setAuthInfo("");
  }

  function registerPractitioner() {
    resetAuthFeedback();
    const name = practitionerNameInput.trim();
    const email = practitionerEmailInput.trim().toLowerCase();
    const password = practitionerPasswordInput.trim();

    if (!name || !email || !password) {
      setAuthError("Merci de renseigner nom, email et mot de passe.");
      return;
    }

    if (state.practitioners.some((item) => item.email === email)) {
      setAuthError("Un compte praticien existe déjà avec cet email.");
      return;
    }

    const nextPractitioner: PractitionerAccount = {
      id: makeId("pro"),
      name,
      email,
      password
    };

    persist({
      ...state,
      practitioners: [...state.practitioners, nextPractitioner]
    });

    setView("praticien");
    setPractitionerSessionId(nextPractitioner.id);
    setPractitionerMode("login");
    setPractitionerNameInput("");
    setPractitionerEmailInput(email);
    setPractitionerPasswordInput("");
    setAuthInfo("Compte praticien créé et connecté.");
  }

  function loginPractitioner() {
    resetAuthFeedback();
    const email = practitionerEmailInput.trim().toLowerCase();
    const password = practitionerPasswordInput.trim();

    if (!email || !password) {
      setAuthError("Email et mot de passe requis.");
      return;
    }

    const account = state.practitioners.find(
      (item) => item.email === email && item.password === password
    );

    if (!account) {
      setAuthError("Identifiants praticien invalides.");
      return;
    }

    setView("praticien");
    setPractitionerSessionId(account.id);
    setAuthInfo(`Connecté en tant que ${account.name}.`);
    setPractitionerPasswordInput("");
  }

  function logoutPractitioner() {
    setView("praticien");
    setPractitionerSessionId(null);
    setSelectedPatientId("");
    setAuthInfo("Session praticien fermée.");
  }

  function loginPatient() {
    resetAuthFeedback();
    if (state.practitioners.length === 0) {
      setAuthError("Aucun compte praticien n'existe encore. Créez d'abord un compte praticien.");
      return;
    }

    const token = patientTokenInput.trim().toLowerCase();
    const password = patientPasswordInput.trim();
    if (!token) {
      setAuthError("Identifiant patient requis.");
      return;
    }

    if (!password) {
      setAuthError("Mot de passe patient requis.");
      return;
    }

    const patientsForToken = state.patients.filter((item) => item.token.toLowerCase() === token);
    if (patientsForToken.length === 0) {
      setAuthError("Identifiant patient invalide.");
      return;
    }

    if (!patientsForToken.some((item) => item.password)) {
      setAuthError("Ce compte patient n'a pas encore de mot de passe. Demandez au praticien de régénérer le compte.");
      return;
    }

    const patient = patientsForToken.find((item) => item.password === password);
    if (!patient) {
      setAuthError("Mot de passe patient invalide.");
      return;
    }

    if (!patient.practitionerId || !state.practitioners.some((item) => item.id === patient.practitionerId)) {
      setAuthError("Ce patient n'est pas lié à un praticien actif.");
      return;
    }

    setView("patient");
    setPatientSessionId(patient.id);
    setPatientPasswordInput("");
    setAuthInfo(`Connecté en tant que ${patient.name}.`);
  }

  function logoutPatient() {
    setView("patient");
    setPatientSessionId(null);
    setPatientPasswordInput("");
    setAuthInfo("Session patient fermée.");
  }

  function buildPatientAccessText(patient: Pick<Patient, "name" | "token" | "password">): string {
    const appUrl = `${window.location.origin}${window.location.pathname}`;
    return [
      "RehabLink - Accès patient",
      `URL: ${appUrl}`,
      `Nom: ${patient.name}`,
      `Identifiant: ${patient.token}`,
      `Mot de passe: ${patient.password ?? "à générer par le praticien"}`
    ].join("\n");
  }

  function getPatientQrImageUrl(patient: Pick<Patient, "name" | "token" | "password">): string {
    return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(buildPatientAccessText(patient))}`;
  }

  async function copyPatientAccess(patient: Pick<Patient, "name" | "token" | "password">): Promise<void> {
    const credentials = buildPatientAccessText(patient);

    try {
      if (!navigator.clipboard) {
        throw new Error("clipboard unavailable");
      }
      await navigator.clipboard.writeText(credentials);
      setCopyStatus("ok");
    } catch {
      setCopyStatus("error");
    }
  }

  function updatePatientCredentials() {
    if (!currentPatient) {
      return;
    }

    const nextName = patientAccountNameInput.trim();
    const nextToken = patientAccountTokenInput.trim().toLowerCase();
    const nextPassword = patientAccountPasswordInput.trim();

    if (!nextName && !nextToken && !nextPassword) {
      return;
    }

    if (nextName && nextName.length < 2) {
      setAuthError("Le nom doit contenir au moins 2 caractères.");
      return;
    }

    if (nextToken && !/^[a-z0-9-]{3,24}$/.test(nextToken)) {
      setAuthError("Identifiant invalide (3-24 caractères: lettres, chiffres, tirets).");
      return;
    }

    if (
      nextToken
      && state.patients.some((patient) => patient.id !== currentPatient.id && patient.token.toLowerCase() === nextToken)
    ) {
      setAuthError("Cet identifiant est déjà utilisé.");
      return;
    }

    if (nextPassword && nextPassword.length < 6) {
      setAuthError("Le mot de passe doit contenir au moins 6 caractères.");
      return;
    }

    const nextPatients = state.patients.map((patient) => {
      if (patient.id !== currentPatient.id) {
        return patient;
      }
      return {
        ...patient,
        name: nextName || patient.name,
        token: nextToken || patient.token,
        password: nextPassword || patient.password
      };
    });

    persist({
      ...state,
      patients: nextPatients
    });

    if (nextName) {
      setLatestPatientAccess((current) => {
        if (!current || current.id !== currentPatient.id) {
          return current;
        }
        return {
          ...current,
          name: nextName
        };
      });
    }

    if (nextToken) {
      setPatientTokenInput(nextToken);
    }

    setPatientAccountNameInput("");
    setPatientAccountTokenInput("");
    setPatientAccountPasswordInput("");
    setPatientAccountStatus("saved");
    setAuthError("");
    setAuthInfo("Profil patient mis à jour.");
  }

  function assignToPatient() {
    if (!selectedPatient || quickAssignProtocolIds.length === 0) {
      return;
    }

    const existing = state.assignments.find((item) => item.patientId === selectedPatient.id);
    let nextAssignments = state.assignments.filter((item) => item.patientId !== selectedPatient.id);

    const protocolIds = existing
      ? Array.from(new Set([...existing.protocolIds, ...quickAssignProtocolIds]))
      : quickAssignProtocolIds;

    nextAssignments = [
      ...nextAssignments,
      {
        patientId: selectedPatient.id,
        protocolIds
      }
    ];

    persist({
      ...state,
      assignments: nextAssignments
    });

    setQuickAssignStatus("saved");
  }

  function addPatient() {
    if (!currentPractitioner) {
      setAuthError("Connexion praticien requise pour créer un patient.");
      return;
    }

    const cleaned = newPatientName.trim();
    if (!cleaned) {
      return;
    }

    const token = makeUniquePatientToken(cleaned, state.patients);
    const password = makePatientPassword();
    const nextPatient = {
      id: makeId("pat"),
      name: cleaned,
      token,
      password,
      practitionerId: currentPractitioner.id
    };

    const nextState = {
      ...state,
      patients: [...state.patients, nextPatient]
    };

    persist(nextState);
    setSelectedPatientId(nextPatient.id);
    setNewPatientName("");
    setLatestPatientAccess({ id: nextPatient.id, name: nextPatient.name, token, password });
    setPatientCreateStatus("created");
    setAuthInfo(`Compte patient créé: identifiant ${token} / mot de passe ${password}`);
  }

  function deletePatientAccount(patientId: string) {
    const targetPatient = state.patients.find((patient) => patient.id === patientId);
    if (!targetPatient) {
      return;
    }

    const nextState: AppState = {
      ...state,
      patients: state.patients.filter((patient) => patient.id !== patientId),
      assignments: state.assignments.filter((assignment) => assignment.patientId !== patientId),
      painLogs: state.painLogs.filter((entry) => entry.patientId !== patientId),
      completionLogs: state.completionLogs.filter((entry) => entry.patientId !== patientId),
      reminderSchedules: state.reminderSchedules.filter((entry) => entry.patientId !== patientId),
      reminderLogs: state.reminderLogs.filter((entry) => entry.patientId !== patientId)
    };

    persist(nextState);
    setLatestPatientAccess((current) => (current?.id === patientId ? null : current));

    if (selectedPatientId === patientId) {
      setSelectedPatientId("");
    }

    if (patientSessionId === patientId) {
      setPatientSessionId(null);
      setPatientPasswordInput("");
    }

    setAuthInfo(`Compte patient supprimé: ${targetPatient.name}`);
  }

  function saveReminderSchedule() {
    if (!selectedPatient) {
      setAuthError("Sélectionne un patient pour planifier les rappels.");
      return;
    }

    const sessions = Math.max(1, Math.min(7, reminderSessionsPerWeek));
    const schedule = {
      patientId: selectedPatient.id,
      sessionsPerWeek: sessions,
      channel: reminderChannel,
      reminderTime: reminderTime || "18:30",
      active: true
    };

    const nextSchedules = state.reminderSchedules.some((entry) => entry.patientId === selectedPatient.id)
      ? state.reminderSchedules.map((entry) => (entry.patientId === selectedPatient.id ? schedule : entry))
      : [...state.reminderSchedules, schedule];

    persist({
      ...state,
      reminderSchedules: nextSchedules
    });

    setReminderStatus("saved");
    setAuthInfo(`Rappels planifiés pour ${selectedPatient.name}.`);
  }

  function sendReminderNow(patientId: string) {
    const patient = state.patients.find((entry) => entry.id === patientId);
    if (!patient) {
      return;
    }

    const schedule = state.reminderSchedules.find((entry) => entry.patientId === patientId);
    const channel = schedule?.channel ?? "email";
    const message = `Rappel séance de rééducation (${channel.toUpperCase()})`;

    persist({
      ...state,
      reminderLogs: [
        ...state.reminderLogs,
        {
          patientId,
          dateIso: new Date().toISOString(),
          channel,
          message
        }
      ]
    });

    setReminderStatus("sent");
    setAuthInfo(`Rappel envoyé à ${patient.name} via ${channel.toUpperCase()}.`);
  }

  function addProtocol() {
    const cleaned = newProtocolName.trim();
    if (!cleaned) {
      return;
    }

    const nextProtocol = {
      id: makeId("proto"),
      name: cleaned,
      exerciseIds: []
    };

    persist({
      ...state,
      protocols: [...state.protocols, nextProtocol]
    });

    setSelectedProtocolId(nextProtocol.id);
    setNewProtocolName("");
    setProtocolStatus("created");
  }

  function startEditingProtocol() {
    if (!selectedProtocol) {
      return;
    }
    setEditingProtocolId(selectedProtocol.id);
    setEditingProtocolName(selectedProtocol.name);
    setEditingProtocolDescription(selectedProtocol.description ?? "");
    setEditingProtocolExercises(selectedProtocol.exerciseIds ?? []);
    setProtocolExerciseToAdd("");
    setProtocolStatus("idle");
  }

  function cancelEditingProtocol() {
    setEditingProtocolId(null);
    setEditingProtocolName("");
    setEditingProtocolDescription("");
    setEditingProtocolExercises([]);
    setProtocolExerciseToAdd("");
  }

  function addExerciseToEditingProtocol() {
    if (!protocolExerciseToAdd) {
      return;
    }

    setEditingProtocolExercises((current) => {
      if (current.includes(protocolExerciseToAdd)) {
        return current;
      }
      return [...current, protocolExerciseToAdd];
    });
    setProtocolExerciseToAdd("");
  }

  function removeExerciseFromEditingProtocol(exerciseId: string) {
    setEditingProtocolExercises((current) => current.filter((id) => id !== exerciseId));
  }

  function saveEditedProtocol() {
    if (!editingProtocolId) {
      return;
    }

    const cleanedName = editingProtocolName.trim();
    const cleanedDescription = editingProtocolDescription.trim();
    if (!cleanedName) {
      setAuthError("Le protocole doit avoir un nom.");
      return;
    }

    persist({
      ...state,
      protocols: state.protocols.map((protocol) =>
        protocol.id === editingProtocolId
          ? {
              ...protocol,
              name: cleanedName,
              description: cleanedDescription || undefined,
              exerciseIds: Array.from(new Set(editingProtocolExercises))
            }
          : protocol
      )
    });

    setProtocolStatus("saved");
    cancelEditingProtocol();
  }

  function deleteProtocol(protocolId: string) {
    const existing = state.protocols.find((protocol) => protocol.id === protocolId);
    if (!existing) {
      return;
    }

    persist({
      ...state,
      protocols: state.protocols.filter((protocol) => protocol.id !== protocolId),
      assignments: state.assignments.map((assignment) => ({
        ...assignment,
        protocolIds: assignment.protocolIds.filter((id) => id !== protocolId)
      }))
    });

    if (selectedProtocolId === protocolId) {
      setSelectedProtocolId("");
    }

    setQuickAssignProtocolIds((current) => current.filter((id) => id !== protocolId));

    if (editingProtocolId === protocolId) {
      cancelEditingProtocol();
    }

    setProtocolStatus("deleted");
    setAuthInfo(`Protocole supprimé: ${existing.name}`);
  }

  function buildExercise(videoUrl: string, fallbackTitle: string): Exercise {
    const title = newExerciseTitle.trim() || fallbackTitle;
    return {
      id: makeId("ex"),
      title,
      videoUrl,
      repetitions: newExerciseRepetitions.trim() || "3 x 12",
      rest: newExerciseRest.trim() || "45 sec",
      instructions: newExerciseInstructions.trim() || "Réaliser le mouvement lentement et sans douleur vive."
    };
  }

  function parseSafeUrl(raw: string): string | null {
    try {
      return new URL(raw).toString();
    } catch {
      return null;
    }
  }

  function addExerciseToLibrary(exercise: Exercise) {
    const nextExercises = [...state.exercises, exercise];
    persist({
      ...state,
      exercises: nextExercises
    });
    setCarouselIndex(nextExercises.length - 1);
  }

  function resetExerciseForm() {
    setNewExerciseTitle("");
    setNewExerciseUrl("");
    setNewExerciseRepetitions("3 x 12");
    setNewExerciseRest("45 sec");
    setNewExerciseInstructions("Réaliser le mouvement lentement et sans douleur vive.");
  }

  function addExerciseFromUrl() {
    const cleanedUrl = newExerciseUrl.trim();
    if (!cleanedUrl) {
      return;
    }

    const parsedUrl = parseSafeUrl(cleanedUrl);
    if (!parsedUrl) {
      setDropMessage("error");
      return;
    }

    const nextExercise = buildExercise(parsedUrl, inferTitleFromUrl(parsedUrl));
    addExerciseToLibrary(nextExercise);
    resetExerciseForm();
  }

  function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          resolve(reader.result);
          return;
        }
        reject(new Error("invalid-file"));
      };
      reader.onerror = () => reject(new Error("read-failed"));
      reader.readAsDataURL(file);
    });
  }

  async function addExerciseFromFile(file: File): Promise<void> {
    setDropMessage("loading");

    try {
      const dataUrl = await fileToDataUrl(file);
      const fileTitle = file.name.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[-_]+/g, " ");
      const nextExercise = buildExercise(dataUrl, fileTitle || "Exercice vidéo");
      addExerciseToLibrary(nextExercise);
      resetExerciseForm();
      setDropMessage("ok");
    } catch {
      setDropMessage("error");
    }
  }

  async function handleDropVideo(event: DragEvent<HTMLDivElement>): Promise<void> {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith("video/")) {
      setDropMessage("error");
      return;
    }
    await addExerciseFromFile(file);
  }

  async function handleFileInputChange(file: File | null): Promise<void> {
    if (!file) {
      return;
    }
    if (!file.type.startsWith("video/")) {
      setDropMessage("error");
      return;
    }
    await addExerciseFromFile(file);
  }

  function startEditingExercise(exercise: Exercise) {
    setEditingExerciseId(exercise.id);
    setEditingExerciseTitle(exercise.title);
    setEditingExerciseUrl(exercise.videoUrl);
    setEditingExerciseRepetitions(exercise.repetitions);
    setEditingExerciseRest(exercise.rest);
    setEditingExerciseInstructions(exercise.instructions);
    setLibraryStatus("idle");
  }

  function cancelEditingExercise() {
    setEditingExerciseId(null);
    setEditingExerciseTitle("");
    setEditingExerciseUrl("");
    setEditingExerciseRepetitions("");
    setEditingExerciseRest("");
    setEditingExerciseInstructions("");
  }

  function saveEditedExercise() {
    if (!editingExerciseId) {
      return;
    }

    const safeUrl = parseSafeUrl(editingExerciseUrl.trim());
    if (!safeUrl) {
      setLibraryStatus("error");
      return;
    }

    const nextExercises = state.exercises.map((exercise) => {
      if (exercise.id !== editingExerciseId) {
        return exercise;
      }
      return {
        ...exercise,
        title: editingExerciseTitle.trim() || exercise.title,
        videoUrl: safeUrl,
        repetitions: editingExerciseRepetitions.trim() || exercise.repetitions,
        rest: editingExerciseRest.trim() || exercise.rest,
        instructions: editingExerciseInstructions.trim() || exercise.instructions
      };
    });

    persist({
      ...state,
      exercises: nextExercises
    });
    setLibraryStatus("ok");
    cancelEditingExercise();
  }

  function deleteExercise(exerciseId: string) {
    const nextExercises = state.exercises.filter((exercise) => exercise.id !== exerciseId);
    const nextProtocols = state.protocols.map((protocol) => ({
      ...protocol,
      exerciseIds: protocol.exerciseIds.filter((id) => id !== exerciseId)
    }));

    persist({
      ...state,
      exercises: nextExercises,
      protocols: nextProtocols,
      completionLogs: state.completionLogs.filter((log) => log.exerciseId !== exerciseId)
    });

    if (editingExerciseId === exerciseId) {
      cancelEditingExercise();
    }
  }

  function markExerciseDone(patientId: string, exerciseId: string) {
    const alreadyDone = state.completionLogs.some(
      (item) => item.patientId === patientId && item.exerciseId === exerciseId
    );

    if (alreadyDone) {
      return;
    }

    persist({
      ...state,
      completionLogs: [
        ...state.completionLogs,
        {
          patientId,
          exerciseId,
          dateIso: new Date().toISOString()
        }
      ]
    });

    setExerciseSubmitStatusId(exerciseId);
  }

  function submitPainLog(patientId: string) {
    const cleanedComment = painComment.trim();
    persist({
      ...state,
      painLogs: [
        ...state.painLogs,
        {
          patientId,
          value: painValue,
          dateIso: new Date().toISOString(),
          context: painContext,
          comment: cleanedComment || undefined
        }
      ]
    });

    setPainComment("");
    setPainSubmitStatus("saved");
  }

  function deletePatientHistoryEntry(entry: PatientHistoryEntry) {
    if (!currentPatient) {
      return;
    }

    if (entry.type === "completion" && entry.exerciseId) {
      persist({
        ...state,
        completionLogs: state.completionLogs.filter(
          (log) => !(
            log.patientId === currentPatient.id
            && log.exerciseId === entry.exerciseId
            && log.dateIso === entry.dateIso
          )
        )
      });
      setHistoryDeleteMessage("Entrée d'exercice supprimée.");
      return;
    }

    if (entry.type === "pain" && typeof entry.painValue === "number") {
      persist({
        ...state,
        painLogs: state.painLogs.filter(
          (log) => !(
            log.patientId === currentPatient.id
            && log.value === entry.painValue
            && log.dateIso === entry.dateIso
          )
        )
      });
      setHistoryDeleteMessage("Entrée de ressenti supprimée.");
    }
  }

  useEffect(() => {
    let active = true;

    const bootstrap = async () => {
      try {
        const loadedState = await loadAppState();
        if (!active) {
          return;
        }
        setState(loadedState);
      } catch (error) {
        if (!active) {
          return;
        }
        const message = error instanceof Error ? error.message : "Connexion SQLite/Prisma impossible";
        setDbError(message);
      } finally {
        if (active) {
          setIsBootstrapping(false);
        }
      }
    };

    void bootstrap();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedPatientId && patients.length > 0) {
      setSelectedPatientId(patients[0].id);
    }
    if (selectedPatientId && !patients.some((item) => item.id === selectedPatientId)) {
      setSelectedPatientId(patients[0]?.id ?? "");
    }
  }, [patients, selectedPatientId]);

  useEffect(() => {
    if (!selectedPatient) {
      setPatientSearchQuery("");
      return;
    }
    const nextLabel = `${selectedPatient.name} (${selectedPatient.token})`;
    setPatientSearchQuery((current) => (current === nextLabel ? current : nextLabel));
  }, [selectedPatient]);

  useEffect(() => {
    if (!selectedProtocolId && protocols.length > 0) {
      setSelectedProtocolId(protocols[0].id);
    }
    if (selectedProtocolId && !protocols.some((item) => item.id === selectedProtocolId)) {
      setSelectedProtocolId(protocols[0]?.id ?? "");
    }
  }, [protocols, selectedProtocolId]);

  useEffect(() => {
    setQuickAssignProtocolIds((current) => {
      const validIds = current.filter((id) => protocols.some((protocol) => protocol.id === id));
      if (validIds.length > 0 || protocols.length === 0) {
        return validIds;
      }
      return [protocols[0].id];
    });
  }, [protocols]);

  function toggleQuickAssignProtocol(protocolId: string) {
    setQuickAssignProtocolIds((current) => {
      if (current.includes(protocolId)) {
        return current.filter((id) => id !== protocolId);
      }
      return [...current, protocolId];
    });
  }

  function selectAllQuickAssignProtocols() {
    setQuickAssignProtocolIds(protocols.map((protocol) => protocol.id));
  }

  function clearQuickAssignProtocols() {
    setQuickAssignProtocolIds([]);
  }

  function selectQuickAssignPatient(patientId: string) {
    const patient = patients.find((item) => item.id === patientId);
    if (!patient) {
      return;
    }
    setSelectedPatientId(patient.id);
    setPatientSearchQuery(`${patient.name} (${patient.token})`);
    setIsPatientSearchOpen(false);
  }

  useEffect(() => {
    if (!selectedPatient) {
      setReminderSessionsPerWeek(3);
      setReminderChannel("email");
      setReminderTime("18:30");
      return;
    }

    const schedule = state.reminderSchedules.find((entry) => entry.patientId === selectedPatient.id);
    if (!schedule) {
      setReminderSessionsPerWeek(3);
      setReminderChannel("email");
      setReminderTime("18:30");
      return;
    }

    setReminderSessionsPerWeek(schedule.sessionsPerWeek);
    setReminderChannel(schedule.channel);
    setReminderTime(schedule.reminderTime);
  }, [selectedPatient, state.reminderSchedules]);

  useEffect(() => {
    try {
      if (practitionerSessionId) {
        window.localStorage.setItem(PRACTITIONER_SESSION_STORAGE_KEY, practitionerSessionId);
      } else {
        window.localStorage.removeItem(PRACTITIONER_SESSION_STORAGE_KEY);
      }
    } catch {
      return;
    }
  }, [practitionerSessionId]);

  useEffect(() => {
    try {
      if (patientSessionId) {
        window.localStorage.setItem(PATIENT_SESSION_STORAGE_KEY, patientSessionId);
      } else {
        window.localStorage.removeItem(PATIENT_SESSION_STORAGE_KEY);
      }
    } catch {
      return;
    }
  }, [patientSessionId]);

  useEffect(() => {
    if (isBootstrapping) {
      return;
    }

    if (practitionerSessionId && !state.practitioners.some((item) => item.id === practitionerSessionId)) {
      setPractitionerSessionId(null);
    }

    if (patientSessionId && !state.patients.some((item) => item.id === patientSessionId)) {
      setPatientSessionId(null);
    }
  }, [isBootstrapping, patientSessionId, practitionerSessionId, state.patients, state.practitioners]);

  useEffect(() => {
    if (copyStatus === "idle") {
      return;
    }

    const timer = window.setTimeout(() => setCopyStatus("idle"), 1800);
    return () => window.clearTimeout(timer);
  }, [copyStatus]);

  useEffect(() => {
    if (patientAccountStatus === "idle") {
      return;
    }

    const timer = window.setTimeout(() => setPatientAccountStatus("idle"), 2000);
    return () => window.clearTimeout(timer);
  }, [patientAccountStatus]);

  useEffect(() => {
    setPatientAccountsCarouselIndex(0);
  }, [patientAccountsSearch]);

  useEffect(() => {
    if (filteredPatientAccounts.length === 0) {
      setPatientAccountsCarouselIndex(0);
      return;
    }
    if (patientAccountsCarouselIndex > filteredPatientAccounts.length - 1) {
      setPatientAccountsCarouselIndex(filteredPatientAccounts.length - 1);
    }
  }, [filteredPatientAccounts.length, patientAccountsCarouselIndex]);

  useEffect(() => {
    setProtocolsCarouselIndex(0);
  }, [protocolsSearch]);

  useEffect(() => {
    if (filteredProtocols.length === 0) {
      setProtocolsCarouselIndex(0);
      return;
    }

    const maxStart = Math.max(0, filteredProtocols.length - protocolCardsPerPage);
    if (protocolsCarouselIndex > maxStart) {
      setProtocolsCarouselIndex(maxStart);
    }
  }, [filteredProtocols.length, protocolsCarouselIndex, protocolCardsPerPage]);

  useEffect(() => {
    if (activePractitionerTab !== "patients" || activePractitionerPatientTab !== "protocoles") {
      return;
    }
    if (filteredProtocols.length === 0) {
      return;
    }
    const selectionIsVisible = filteredProtocols.some((protocol) => protocol.id === selectedProtocolId);
    if (!selectionIsVisible) {
      setSelectedProtocolId(filteredProtocols[0].id);
      return;
    }
  }, [activePractitionerTab, activePractitionerPatientTab, filteredProtocols, selectedProtocolId]);

  useEffect(() => {
    setPatientAccountNameInput("");
    setPatientAccountTokenInput("");
    setPatientAccountPasswordInput("");
    setPatientAccountStatus("idle");
  }, [currentPatient?.id]);

  useEffect(() => {
    if (exercises.length === 0) {
      setCarouselIndex(0);
      return;
    }
    if (carouselIndex > exercises.length - 1) {
      setCarouselIndex(exercises.length - 1);
    }
  }, [carouselIndex, exercises.length]);

  useEffect(() => {
    if (dropMessage === "idle") {
      return;
    }
    const timer = window.setTimeout(() => setDropMessage("idle"), 2200);
    return () => window.clearTimeout(timer);
  }, [dropMessage]);

  useEffect(() => {
    if (libraryStatus === "idle") {
      return;
    }
    const timer = window.setTimeout(() => setLibraryStatus("idle"), 2200);
    return () => window.clearTimeout(timer);
  }, [libraryStatus]);

  useEffect(() => {
    if (!authError && !authInfo) {
      return;
    }
    const timer = window.setTimeout(() => {
      setAuthError("");
      setAuthInfo("");
    }, 2600);
    return () => window.clearTimeout(timer);
  }, [authError, authInfo]);

  useEffect(() => {
    if (reminderStatus === "idle") {
      return;
    }
    const timer = window.setTimeout(() => setReminderStatus("idle"), 2200);
    return () => window.clearTimeout(timer);
  }, [reminderStatus]);

  useEffect(() => {
    if (protocolStatus === "idle") {
      return;
    }
    const timer = window.setTimeout(() => setProtocolStatus("idle"), 2200);
    return () => window.clearTimeout(timer);
  }, [protocolStatus]);

  useEffect(() => {
    if (patientCreateStatus === "idle") {
      return;
    }
    const timer = window.setTimeout(() => setPatientCreateStatus("idle"), 2200);
    return () => window.clearTimeout(timer);
  }, [patientCreateStatus]);

  useEffect(() => {
    if (quickAssignStatus === "idle") {
      return;
    }
    const timer = window.setTimeout(() => setQuickAssignStatus("idle"), 2200);
    return () => window.clearTimeout(timer);
  }, [quickAssignStatus]);

  useEffect(() => {
    if (painSubmitStatus === "idle") {
      return;
    }
    const timer = window.setTimeout(() => setPainSubmitStatus("idle"), 2200);
    return () => window.clearTimeout(timer);
  }, [painSubmitStatus]);

  useEffect(() => {
    if (!exerciseSubmitStatusId) {
      return;
    }
    const timer = window.setTimeout(() => setExerciseSubmitStatusId(null), 2200);
    return () => window.clearTimeout(timer);
  }, [exerciseSubmitStatusId]);

  useEffect(() => {
    if (!historyDeleteMessage) {
      return;
    }
    const timer = window.setTimeout(() => setHistoryDeleteMessage(""), 2200);
    return () => window.clearTimeout(timer);
  }, [historyDeleteMessage]);

  if (isBootstrapping) {
    return (
      <div className="page">
        <header>
          <div className="brand-top">
            <div className="brand-mark" aria-hidden="true">RL</div>
            <div>
              <p className="brand-kicker">Institut de Rééducation Digitale</p>
              <h1>Rehab Link - MVP</h1>
            </div>
          </div>
          <p>Chargement des données...</p>
        </header>
      </div>
    );
  }

  if (dbError) {
    return (
      <div className="page">
        <header>
          <div className="brand-top">
            <div className="brand-mark" aria-hidden="true">RL</div>
            <div>
              <p className="brand-kicker">Institut de Rééducation Digitale</p>
              <h1>Rehab Link - MVP</h1>
            </div>
          </div>
          <p>Configuration base de données requise.</p>
        </header>

        <section className="card auth-card">
          <h2>Connexion BDD obligatoire (SQLite + Prisma)</h2>
          <p className="error">Erreur BDD: {dbError}</p>
          <p className="small-text">Vérifie que l'API backend tourne (`npm run dev`) et que la base SQLite est initialisée (`npm run db:push`).</p>
          <p className="small-text">URL API utilisée: {import.meta.env.VITE_API_BASE_URL?.trim() || "http://localhost:8787 (proxy Vite)"}</p>
          <p className="small-text">Ce projet est désormais configuré en mode base de données réelle uniquement, sans fallback local.</p>
        </section>
      </div>
    );
  }

  const isPractitionerAuthenticated = Boolean(currentPractitioner);
  const isPatientAuthenticated = Boolean(currentPatient);

  return (
    <div className="page">
      <header>
        <div className="brand-top">
          <div className="brand-mark" aria-hidden="true">RL</div>
          <div>
            <p className="brand-kicker">Institut de Rééducation Digitale</p>
            <h1>Rehab Link - MVP</h1>
          </div>
        </div>
        <p>Plateforme de liaison kiné/patient pour la rééducation à domicile.</p>
        <div className="brand-badges">
          <span>Suivi clinique</span>
          <span>Parcours patient sécurisé</span>
          <span>Usage cabinet & domicile</span>
        </div>
        <p className="small-text">
          Persistance: SQLite + Prisma (base de données réelle)
        </p>
        {isPractitionerAuthenticated && (
          <p className="small-text">
            Session praticien: {currentPractitioner?.name} ({currentPractitioner?.email})
          </p>
        )}
        {isPatientAuthenticated && (
          <p className="small-text">
            Session patient: {currentPatient?.name}
          </p>
        )}
      </header>

      {authInfo && <p className="success">{authInfo}</p>}
      {authError && <p className="error">{authError}</p>}

      {!isPractitionerAuthenticated && !isPatientAuthenticated && (
        <section className="card auth-card">
          <h2>Connexion</h2>
          <p className="small-text">Même URL pour tous : choisissez le profil puis connectez-vous.</p>
          <div className="tabs auth-tabs">
            <button className={view === "praticien" ? "active" : ""} onClick={() => setView("praticien")}>Praticien</button>
            <button className={view === "patient" ? "active" : ""} onClick={() => setView("patient")}>Patient</button>
          </div>

          {view === "praticien" ? (
            <>
              <p className="small-text">Le praticien doit se connecter pour gérer ses patients et protocoles.</p>
              <div className="tabs auth-tabs">
                <button className={practitionerMode === "register" ? "active" : ""} onClick={() => setPractitionerMode("register")}>Créer un compte</button>
                <button className={practitionerMode === "login" ? "active" : ""} onClick={() => setPractitionerMode("login")}>Se connecter</button>
              </div>

              {practitionerMode === "register" && (
                <label>
                  Nom du praticien
                  <input value={practitionerNameInput} onChange={(event) => setPractitionerNameInput(event.target.value)} placeholder="Ex: Dr Martin" />
                </label>
              )}

              <label>
                Email
                <input value={practitionerEmailInput} onChange={(event) => setPractitionerEmailInput(event.target.value)} placeholder="email@cabinet.fr" />
              </label>
              <label>
                Mot de passe
                <input type="password" value={practitionerPasswordInput} onChange={(event) => setPractitionerPasswordInput(event.target.value)} placeholder="••••••••" />
              </label>

              <div className="action-row">
                {practitionerMode === "register" ? (
                  <button onClick={registerPractitioner}>Créer mon compte praticien</button>
                ) : (
                  <button onClick={loginPractitioner}>Connexion praticien</button>
                )}
              </div>
            </>
          ) : state.practitioners.length === 0 ? (
            <p className="error">Accès patient bloqué: un praticien doit d'abord créer son compte.</p>
          ) : (
            <>
              <p className="small-text">Le patient se connecte avec les identifiants fournis par son praticien.</p>
              <label>
                Identifiant patient
                <input value={patientTokenInput} onChange={(event) => setPatientTokenInput(event.target.value)} placeholder="ex: alice-9f31" />
              </label>
              <label>
                Mot de passe patient
                <input type="password" value={patientPasswordInput} onChange={(event) => setPatientPasswordInput(event.target.value)} placeholder="mot de passe" />
              </label>
              <div className="action-row">
                <button onClick={loginPatient}>Se connecter à l'espace patient</button>
              </div>
            </>
          )}
        </section>
      )}

      {view === "praticien" && isPractitionerAuthenticated && (
        <div className="action-row auth-actions">
          <button onClick={logoutPractitioner}>Se déconnecter (praticien)</button>
        </div>
      )}

      {view === "patient" && isPatientAuthenticated && (
        <div className="action-row auth-actions">
          <button onClick={logoutPatient}>Se déconnecter (patient)</button>
        </div>
      )}

      {view === "praticien" ? (
        isPractitionerAuthenticated ? (
          <main className="grid app-with-sidebar">
          <aside className="card side-tabs" aria-label="Navigation praticien">
            <h3>Navigation</h3>
            <button type="button" className={`side-tab-link ${activePractitionerTab === "dashboard" ? "active" : ""}`} onClick={() => setActivePractitionerTab("dashboard")}>Dashboard</button>
            <button type="button" className={`side-tab-link ${activePractitionerTab === "assignation" ? "active" : ""}`} onClick={() => setActivePractitionerTab("assignation")}>Assignation rapide</button>
            <button type="button" className={`side-tab-link ${activePractitionerTab === "patients" ? "active" : ""}`} onClick={() => setActivePractitionerTab("patients")}>Patients & protocoles</button>
            <button type="button" className={`side-tab-link ${activePractitionerTab === "rappels" ? "active" : ""}`} onClick={() => setActivePractitionerTab("rappels")}>Rappels</button>
            <button type="button" className={`side-tab-link ${activePractitionerTab === "suivi" ? "active" : ""}`} onClick={() => setActivePractitionerTab("suivi")}>Suivi patient</button>
            <button type="button" className={`side-tab-link ${activePractitionerTab === "bibliotheque" ? "active" : ""}`} onClick={() => setActivePractitionerTab("bibliotheque")}>Bibliothèque</button>
          </aside>
          <div className="content-stack single-panel">
          {activePractitionerTab === "dashboard" && <section id="pro-dashboard" className="card wide section-anchor">
            <h2>Dashboard Admin</h2>
            <div className="kpi-grid">
              <article className="kpi-card">
                <p className="kpi-label">Patients</p>
                <p className="kpi-value">{adminKpis.totalPatients}</p>
              </article>
              <article className="kpi-card">
                <p className="kpi-label">Programmes assignés</p>
                <p className="kpi-value">{adminKpis.assignedPatients}</p>
              </article>
              <article className="kpi-card">
                <p className="kpi-label">Adhérence moyenne</p>
                <p className="kpi-value">{adminKpis.avgAdherence}%</p>
              </article>
              <article className="kpi-card">
                <p className="kpi-label">Douleur moyenne</p>
                <p className="kpi-value">{adminKpis.avgPain}/10</p>
              </article>
            </div>

            <div className="dashboard-grid">
              <article className="chart-card">
                <h3>Programmes assignés par patient</h3>
                <PieChart data={adminProgramsByPatientChart} />
              </article>
              <article className="chart-card">
                <h3>Programmes par protocole</h3>
                <VerticalBarChart data={adminProgramsByProtocolChart} yLabel="Patients" tickCount={5} />
              </article>
              <article className="chart-card">
                <h3>Adhérence par patient</h3>
                <VerticalBarChart data={adminAdherenceChart} yLabel="Adhérence (%)" yMax={100} unit="%" tickCount={5} />
              </article>
              <article className="chart-card">
                <h3>Tendance douleur (7 derniers jours)</h3>
                <LineChart data={adminPainTrend} yMax={10} />
              </article>
            </div>

            <div className="link-box">
              <h3>Tâches du jour</h3>
              <ul className="event-list">
                {adminDailyTasks.map((task) => (
                  <li key={task}>{task}</li>
                ))}
              </ul>
            </div>
          </section>}

          {activePractitionerTab === "assignation" && <section id="pro-assignation" className="card section-anchor">
            <h2>Assignation rapide</h2>
            <label>
              Patient
              <div className="patient-search-wrap">
                <input
                  type="text"
                  value={patientSearchQuery}
                  onChange={(event) => {
                    const query = event.target.value;
                    setPatientSearchQuery(query);
                    setIsPatientSearchOpen(true);

                    const normalizedQuery = query.trim().toLowerCase();
                    if (!normalizedQuery) {
                      return;
                    }

                    const exactPatient = patients.find((patient) => {
                      const fullLabel = `${patient.name} (${patient.token})`.toLowerCase();
                      return fullLabel === normalizedQuery || patient.name.toLowerCase() === normalizedQuery || patient.token.toLowerCase() === normalizedQuery;
                    });

                    if (exactPatient) {
                      setSelectedPatientId(exactPatient.id);
                    }
                  }}
                  onFocus={() => setIsPatientSearchOpen(true)}
                  onBlur={() => {
                    window.setTimeout(() => setIsPatientSearchOpen(false), 120);
                  }}
                  placeholder={patients.length > 0 ? "Rechercher un patient (nom ou identifiant)" : "Aucun patient"}
                  disabled={patients.length === 0}
                />
                {isPatientSearchOpen && patients.length > 0 && (
                  <ul className="patient-search-suggestions">
                    {patientSearchSuggestions.length > 0 ? patientSearchSuggestions.map((patient) => (
                      <li key={`patient-suggestion-${patient.id}`}>
                        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => selectQuickAssignPatient(patient.id)}>
                          <span>{patient.name}</span>
                          <small>{patient.token}</small>
                        </button>
                      </li>
                    )) : (
                      <li className="patient-search-empty">Aucun patient trouvé</li>
                    )}
                  </ul>
                )}
              </div>
            </label>
            {selectedPatient && <p className="small-text patient-search-selected">Sélectionné: {selectedPatient.name} ({selectedPatient.token})</p>}

            <div className="assign-toolbar">
              <div>
                <h3>Protocoles à assigner</h3>
                <p className="small-text assign-summary">{quickAssignProtocolIds.length} protocole(s) sélectionné(s)</p>
              </div>
              <div className="action-row assign-actions">
                <button type="button" onClick={selectAllQuickAssignProtocols} disabled={protocols.length === 0}>Tout sélectionner</button>
                <button type="button" onClick={clearQuickAssignProtocols} disabled={quickAssignProtocolIds.length === 0}>Vider</button>
              </div>
            </div>

            <div className="quick-protocol-grid">
              {protocols.map((protocol) => {
                const isSelected = quickAssignProtocolIds.includes(protocol.id);
                return (
                  <button
                    key={`quick-assign-${protocol.id}`}
                    type="button"
                    className={`quick-protocol-card ${isSelected ? "selected" : ""}`}
                    onClick={() => toggleQuickAssignProtocol(protocol.id)}
                    aria-pressed={isSelected}
                    disabled={protocols.length === 0}
                  >
                    <div className="quick-protocol-head">
                      <strong>{protocol.name}</strong>
                      <span>{isSelected ? "✓" : "+"}</span>
                    </div>
                    <p className="small-text">{protocol.description?.trim() || "Aucune description"}</p>
                    <p className="small-text">{protocol.exerciseIds.length} vidéo(s) associée(s)</p>
                  </button>
                );
              })}
            </div>

            <button className={quickAssignStatus === "saved" ? "is-sent" : ""} onClick={assignToPatient} disabled={!selectedPatientId || quickAssignProtocolIds.length === 0}>Assigner en 1 clic</button>
            {quickAssignStatus === "saved" && <p className="success assign-feedback">✅ Protocole(s) assigné(s) avec succès.</p>}
          </section>}

          {activePractitionerTab === "patients" && <section id="pro-patients" className="card section-anchor">
            <h2>Patients & protocoles</h2>
            <div className="tabs auth-tabs split-tabs">
              <button className={activePractitionerPatientTab === "patients" ? "active" : ""} onClick={() => setActivePractitionerPatientTab("patients")}>Patients</button>
              <button className={activePractitionerPatientTab === "protocoles" ? "active" : ""} onClick={() => setActivePractitionerPatientTab("protocoles")}>Protocoles</button>
            </div>

            {activePractitionerPatientTab === "patients" && (
              <>
                <div className="link-box patient-create-box">
                  <h3>Création du compte patient</h3>
                  <label>
                    Nom complet
                    <input
                      value={newPatientName}
                      onChange={(event) => setNewPatientName(event.target.value)}
                      placeholder="Ex: Léa Dupont"
                    />
                  </label>
                  <button className={patientCreateStatus === "created" ? "is-sent" : ""} onClick={addPatient} disabled={!newPatientName.trim()}>Créer patient</button>
                  {patientCreateStatus === "created" && <p className="success account-create-feedback">✅ Compte patient créé.</p>}

                  {latestPatientAccess && (
                    <div className="link-box patient-created-box">
                      <h3>Compte créé : QR à remettre</h3>
                      <p className="small-text">Ce QR et ces identifiants apparaissent juste après avoir cliqué sur “Créer patient”.</p>
                      <div className="patient-access-layout">
                        <div className="patient-access-qr">
                          <img src={getPatientQrImageUrl(latestPatientAccess)} alt={`QR code compte ${latestPatientAccess.name}`} />
                        </div>
                        <div className="patient-access-details">
                          <p className="small-text">Nom: <strong>{latestPatientAccess.name}</strong></p>
                          <p className="small-text">Identifiant: <strong>{latestPatientAccess.token}</strong></p>
                          <p className="small-text">Mot de passe: <strong>{latestPatientAccess.password}</strong></p>
                          <button onClick={() => copyPatientAccess(latestPatientAccess)}>Copier les identifiants</button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="link-box patient-accounts-box">
                  <h3>Comptes patients</h3>
                  <label>
                    Rechercher un compte
                    <input
                      value={patientAccountsSearch}
                      onChange={(event) => setPatientAccountsSearch(event.target.value)}
                      placeholder="Nom ou identifiant"
                    />
                  </label>

                  {filteredPatientAccounts.length === 0 ? (
                    <p className="small-text">Aucun compte trouvé.</p>
                  ) : (
                    <div className="carousel-card patient-account-carousel">
                      <div className="carousel-controls">
                        <button
                          type="button"
                          onClick={() => setPatientAccountsCarouselIndex((current) => Math.max(0, current - 1))}
                          disabled={patientAccountsCarouselIndex === 0}
                        >
                          Précédent
                        </button>
                        <p className="small-text">
                          {patientAccountsCarouselIndex + 1}/{filteredPatientAccounts.length}
                        </p>
                        <button
                          type="button"
                          onClick={() => setPatientAccountsCarouselIndex((current) => Math.min(filteredPatientAccounts.length - 1, current + 1))}
                          disabled={patientAccountsCarouselIndex >= filteredPatientAccounts.length - 1}
                        >
                          Suivant
                        </button>
                      </div>

                      {activePatientAccount && (
                        <article key={`admin-${activePatientAccount.id}`} className="patient-admin-item">
                          <p><strong>{activePatientAccount.name}</strong></p>
                          <p className="small-text">Identifiant: {activePatientAccount.token}</p>
                          <p className="small-text">Mot de passe: {activePatientAccount.password ?? "non défini"}</p>
                          <div className="action-row">
                            <button onClick={() => deletePatientAccount(activePatientAccount.id)}>Supprimer compte</button>
                          </div>
                        </article>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}

            {activePractitionerPatientTab === "protocoles" && (
              <>
                <div className="link-box protocol-create-box">
                  <h3>Nouveau protocole type</h3>
                  <label>
                    Nom du protocole
                    <input
                      value={newProtocolName}
                      onChange={(event) => setNewProtocolName(event.target.value)}
                      placeholder="Ex: Lombalgie douce"
                    />
                  </label>
                  <p className="small-text">Crée le protocole avec son nom. Tu peux ensuite modifier son nom, sa description et les vidéos associées.</p>
                  <button onClick={addProtocol} disabled={!newProtocolName.trim()}>Créer protocole</button>
                  {protocolStatus === "created" && <p className="success">Nouveau protocole créé.</p>}
                </div>

                <div className="link-box protocol-manage-box">
                  <h3>Gestion des protocoles</h3>
                  <label>
                    Rechercher un protocole
                    <input
                      value={protocolsSearch}
                      onChange={(event) => setProtocolsSearch(event.target.value)}
                      placeholder="Nom ou description"
                    />
                  </label>

                  {filteredProtocols.length === 0 ? (
                    <p className="small-text">Aucun protocole trouvé.</p>
                  ) : (
                    <div className="carousel-card protocol-carousel">
                      <div className="carousel-controls">
                        <button
                          type="button"
                          onClick={() => setProtocolsCarouselIndex((current) => Math.max(0, current - 1))}
                          disabled={protocolsCarouselIndex === 0}
                        >
                          Précédent
                        </button>
                        <p className="small-text">
                          {Math.min(protocolsCarouselIndex + 1, filteredProtocols.length)}-
                          {Math.min(protocolsCarouselIndex + visibleProtocolCards.length, filteredProtocols.length)} / {filteredProtocols.length}
                        </p>
                        <button
                          type="button"
                          onClick={() => setProtocolsCarouselIndex((current) => Math.min(Math.max(0, filteredProtocols.length - protocolCardsPerPage), current + 1))}
                          disabled={protocolsCarouselIndex >= Math.max(0, filteredProtocols.length - protocolCardsPerPage)}
                        >
                          Suivant
                        </button>
                      </div>

                      <div className="protocol-grid protocol-carousel-track">
                        {visibleProtocolCards.map((protocol) => {
                          const isSelected = selectedProtocolId === protocol.id;
                          return (
                            <button
                              key={`protocol-card-${protocol.id}`}
                              type="button"
                              className={`protocol-card ${isSelected ? "selected" : ""}`}
                              onClick={() => setSelectedProtocolId(protocol.id)}
                              aria-pressed={isSelected}
                            >
                              <div className="protocol-card-head">
                                <strong>{protocol.name}</strong>
                                <span>{isSelected ? "✓" : "•"}</span>
                              </div>
                              <p className="small-text">{protocol.description?.trim() || "Aucune description"}</p>
                              <p className="small-text">{protocol.exerciseIds.length} vidéo(s) associée(s)</p>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {protocols.length === 0 ? (
                    <p className="small-text">Aucun protocole disponible.</p>
                  ) : (
                    <>
                      {selectedProtocol && (
                        <p className="small-text"><strong>Protocole actif:</strong> {selectedProtocol.name}</p>
                      )}

                      {selectedProtocol && editingProtocolId === selectedProtocol.id ? (
                        <>
                          <label>
                            Nom du protocole
                            <input value={editingProtocolName} onChange={(event) => setEditingProtocolName(event.target.value)} />
                          </label>
                          <label>
                            Description
                            <textarea
                              value={editingProtocolDescription}
                              onChange={(event) => setEditingProtocolDescription(event.target.value)}
                              placeholder="Ex: progression douleur, objectifs et précautions"
                              rows={3}
                            />
                          </label>
                          <div className="link-box">
                            <h3>Vidéos associées au protocole</h3>
                            {editingProtocolExercises.length === 0 ? (
                              <p className="small-text">Aucune vidéo associée pour l'instant.</p>
                            ) : (
                              <div className="patient-admin-list">
                                {editingProtocolExercises.map((exerciseId) => {
                                  const linkedExercise = exercises.find((item) => item.id === exerciseId);
                                  if (!linkedExercise) {
                                    return null;
                                  }
                                  return (
                                    <article key={`linked-ex-${exerciseId}`} className="patient-admin-item">
                                      <p><strong>{linkedExercise.title}</strong></p>
                                      <div className="action-row">
                                        <a href={linkedExercise.videoUrl} target="_blank" rel="noreferrer">Voir vidéo</a>
                                        <button type="button" onClick={() => removeExerciseFromEditingProtocol(exerciseId)}>Retirer</button>
                                      </div>
                                    </article>
                                  );
                                })}
                              </div>
                            )}

                            <label>
                              Ajouter une vidéo de la bibliothèque
                              <select value={protocolExerciseToAdd} onChange={(event) => setProtocolExerciseToAdd(event.target.value)}>
                                <option value="">Sélectionner une vidéo</option>
                                {exercises
                                  .filter((exercise) => !editingProtocolExercises.includes(exercise.id))
                                  .map((exercise) => (
                                  <option key={`add-proto-ex-${exercise.id}`} value={exercise.id}>{exercise.title}</option>
                                  ))}
                              </select>
                            </label>
                            <button type="button" onClick={addExerciseToEditingProtocol} disabled={!protocolExerciseToAdd}>Ajouter la vidéo</button>
                          </div>
                          <div className="action-row">
                            <button onClick={saveEditedProtocol}>Enregistrer protocole</button>
                            <button onClick={cancelEditingProtocol}>Annuler</button>
                          </div>
                        </>
                      ) : (
                        <>
                          {selectedProtocol?.description && <p className="small-text">Description: {selectedProtocol.description}</p>}
                          <div className="action-row">
                            <button onClick={startEditingProtocol} disabled={!selectedProtocol}>Modifier</button>
                            <button onClick={() => selectedProtocol && deleteProtocol(selectedProtocol.id)} disabled={!selectedProtocol}>Supprimer</button>
                          </div>
                        </>
                      )}
                      {protocolStatus === "saved" && <p className="success">Protocole mis à jour.</p>}
                      {protocolStatus === "deleted" && <p className="success">Protocole supprimé et retiré des assignations.</p>}
                    </>
                  )}
                </div>
              </>
            )}
          </section>}

          {activePractitionerTab === "rappels" && <section id="pro-rappels" className="card section-anchor">
            <h2>Rappels automatiques</h2>
            <p className="small-text">Planifie la cadence des rappels et envoie les rappels dus automatiquement.</p>

            <label>
              Patient ciblé
              <div className="patient-search-wrap">
                <input
                  type="text"
                  value={patientSearchQuery}
                  onChange={(event) => {
                    const query = event.target.value;
                    setPatientSearchQuery(query);
                    setIsPatientSearchOpen(true);

                    const normalizedQuery = query.trim().toLowerCase();
                    if (!normalizedQuery) {
                      return;
                    }

                    const exactPatient = patients.find((patient) => {
                      const fullLabel = `${patient.name} (${patient.token})`.toLowerCase();
                      return fullLabel === normalizedQuery || patient.name.toLowerCase() === normalizedQuery || patient.token.toLowerCase() === normalizedQuery;
                    });

                    if (exactPatient) {
                      setSelectedPatientId(exactPatient.id);
                    }
                  }}
                  onFocus={() => setIsPatientSearchOpen(true)}
                  onBlur={() => {
                    window.setTimeout(() => setIsPatientSearchOpen(false), 120);
                  }}
                  placeholder={patients.length > 0 ? "Rechercher un patient (nom ou identifiant)" : "Aucun patient"}
                  disabled={patients.length === 0}
                />
                {isPatientSearchOpen && patients.length > 0 && (
                  <ul className="patient-search-suggestions">
                    {patientSearchSuggestions.length > 0 ? patientSearchSuggestions.map((patient) => (
                      <li key={`reminder-patient-suggestion-${patient.id}`}>
                        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => selectQuickAssignPatient(patient.id)}>
                          <span>{patient.name}</span>
                          <small>{patient.token}</small>
                        </button>
                      </li>
                    )) : (
                      <li className="patient-search-empty">Aucun patient trouvé</li>
                    )}
                  </ul>
                )}
              </div>
            </label>
            {selectedPatient && <p className="small-text patient-search-selected">Sélectionné: {selectedPatient.name} ({selectedPatient.token})</p>}

            <div className="form-row">
              <label>
                Séances / semaine
                <input
                  type="number"
                  min={1}
                  max={7}
                  value={reminderSessionsPerWeek}
                  onChange={(event) => setReminderSessionsPerWeek(Number(event.target.value))}
                />
              </label>
              <label>
                Heure du rappel
                <input type="time" value={reminderTime} onChange={(event) => setReminderTime(event.target.value)} />
              </label>
            </div>

            <label>
              Canal
              <select value={reminderChannel} onChange={(event) => setReminderChannel(event.target.value as "email" | "sms")}>
                <option value="email">Email</option>
                <option value="sms">SMS</option>
              </select>
            </label>

            <div className="action-row">
              <button onClick={saveReminderSchedule} disabled={!selectedPatient}>Enregistrer la planification</button>
            </div>
            {selectedPatientReminderSchedule && (
              <p className="small-text">Plan actif: {selectedPatientReminderSchedule.sessionsPerWeek} séances/semaine à {selectedPatientReminderSchedule.reminderTime} via {selectedPatientReminderSchedule.channel.toUpperCase()}.</p>
            )}
            {reminderStatus === "saved" && <p className="success">Plan de rappel enregistré.</p>}
            {reminderStatus === "sent" && <p className="success">Rappel envoyé.</p>}

            <div className="link-box">
              <h3>Rappels à envoyer aujourd'hui</h3>
              {reminderCandidates.length === 0 ? (
                <p className="small-text">Aucun rappel urgent pour le moment.</p>
              ) : (
                <div className="patient-admin-list">
                  {reminderCandidates.map((candidate) => (
                    <article key={`candidate-${candidate.patientId}`} className="patient-admin-item">
                      <p><strong>{candidate.patientName}</strong></p>
                      <p className="small-text">{candidate.message}</p>
                      <button onClick={() => sendReminderNow(candidate.patientId)}>Envoyer rappel ({candidate.channel.toUpperCase()})</button>
                    </article>
                  ))}
                </div>
              )}
            </div>

            <div className="link-box">
              <h3>Historique rappels</h3>
              <ul className="event-list">
                {state.reminderLogs.slice(-8).reverse().map((entry, index) => {
                  const patient = patients.find((item) => item.id === entry.patientId);
                  return (
                    <li key={`reminder-log-${entry.dateIso}-${index}`}>
                      {patient?.name ?? "Patient"} - {entry.channel.toUpperCase()} - {new Date(entry.dateIso).toLocaleString("fr-FR")}
                    </li>
                  );
                })}
                {state.reminderLogs.length === 0 && <li>Aucun rappel envoyé.</li>}
              </ul>
            </div>
          </section>}

          {activePractitionerTab === "suivi" && <section id="pro-suivi" className="card section-anchor">
            <h2>Suivi patient</h2>
            <table>
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Adhérence</th>
                  <th>Douleur moyenne</th>
                </tr>
              </thead>
              <tbody>
                {patients.map((patient) => {
                  const adherence = adherenceByPatient.find((item) => item.patientId === patient.id)?.percent ?? 0;
                  const pain = state.painLogs.filter((item) => item.patientId === patient.id);
                  const painAverage = pain.length
                    ? (pain.reduce((acc, item) => acc + item.value, 0) / pain.length).toFixed(1)
                    : "-";
                  const lastPain = pain.length ? pain[pain.length - 1].value : "-";

                  return (
                    <tr key={patient.id}>
                      <td>{patient.name}</td>
                      <td>{adherence}%</td>
                      <td>{painAverage} (dernier: {lastPain})</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <h3>Dernières remontées douleur</h3>
            <ul className="event-list">
              {state.painLogs.slice(-6).reverse().map((entry, index) => {
                const patient = patients.find((item) => item.id === entry.patientId);
                const contextLabel = entry.context ? ` (${entry.context})` : "";
                return (
                  <li key={`${entry.dateIso}-${index}`}>
                    {patient?.name ?? "Patient"} - {entry.value}/10{contextLabel} - {new Date(entry.dateIso).toLocaleString("fr-FR")}
                    {entry.comment ? ` — ${entry.comment}` : ""}
                  </li>
                );
              })}
              {state.painLogs.length === 0 && <li>Aucune donnée de douleur pour le moment.</li>}
            </ul>
          </section>}

          {activePractitionerTab === "bibliotheque" && <section id="pro-bibliotheque" className="card wide section-anchor">
            <h2>Bibliothèque d'exercices</h2>
            <div className="library-layout">
              <div className="library-left">
                {activeCarouselExercise ? (
                  <article className="exercise-item carousel-card">
                    <VideoPreview videoUrl={activeCarouselExercise.videoUrl} title={activeCarouselExercise.title} />
                    <div className="carousel-controls">
                      <button
                        onClick={() => setCarouselIndex((current) => (current - 1 + exercises.length) % exercises.length)}
                        disabled={exercises.length <= 1}
                      >
                        Précédent
                      </button>
                      <p className="small-text">Vidéo {carouselIndex + 1}/{exercises.length}</p>
                      <button
                        onClick={() => setCarouselIndex((current) => (current + 1) % exercises.length)}
                        disabled={exercises.length <= 1}
                      >
                        Suivant
                      </button>
                    </div>

                    <h3>{activeCarouselExercise.title}</h3>
                    <a href={activeCarouselExercise.videoUrl} target="_blank" rel="noreferrer">Ouvrir la source vidéo</a>
                    <p><strong>Répétitions:</strong> {activeCarouselExercise.repetitions}</p>
                    <p><strong>Repos:</strong> {activeCarouselExercise.rest}</p>
                    <p>{activeCarouselExercise.instructions}</p>
                  </article>
                ) : (
                  <p>Aucune vidéo dans la bibliothèque.</p>
                )}

                {activeCarouselExercise && (
                  <div className="link-box">
                    <h3>Modifier la vidéo active</h3>
                    {editingExerciseId === activeCarouselExercise.id ? (
                      <>
                        <label>
                          Titre
                          <input value={editingExerciseTitle} onChange={(event) => setEditingExerciseTitle(event.target.value)} />
                        </label>
                        <label>
                          URL vidéo
                          <input value={editingExerciseUrl} onChange={(event) => setEditingExerciseUrl(event.target.value)} />
                        </label>
                        <div className="form-row">
                          <label>
                            Répétitions
                            <input value={editingExerciseRepetitions} onChange={(event) => setEditingExerciseRepetitions(event.target.value)} />
                          </label>
                          <label>
                            Repos
                            <input value={editingExerciseRest} onChange={(event) => setEditingExerciseRest(event.target.value)} />
                          </label>
                        </div>
                        <label>
                          Consignes
                          <input value={editingExerciseInstructions} onChange={(event) => setEditingExerciseInstructions(event.target.value)} />
                        </label>
                        <div className="action-row">
                          <button onClick={saveEditedExercise}>Enregistrer</button>
                          <button onClick={cancelEditingExercise}>Annuler</button>
                        </div>
                      </>
                    ) : (
                      <div className="action-row">
                        <button onClick={() => startEditingExercise(activeCarouselExercise)}>Modifier</button>
                        <button onClick={() => deleteExercise(activeCarouselExercise.id)}>Supprimer</button>
                      </div>
                    )}
                    {libraryStatus === "ok" && <p className="success">Exercice modifié.</p>}
                    {libraryStatus === "error" && <p className="error">URL invalide pour la vidéo.</p>}
                    <p className="small-text">La suppression retire aussi l'exercice des protocoles, assignations personnalisées et historiques de complétion.</p>
                  </div>
                )}
              </div>

              <div className="library-right">
                <h3>Ajouter une vidéo</h3>
                <label>
                  URL vidéo
                  <input
                    value={newExerciseUrl}
                    onChange={(event) => setNewExerciseUrl(event.target.value)}
                    placeholder="https://..."
                  />
                </label>
                <button onClick={addExerciseFromUrl} disabled={!newExerciseUrl.trim()}>Ajouter via URL</button>

                <div className="drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => void handleDropVideo(event)}>
                  <p>Glisse une vidéo ici (mp4, mov...) ou choisis un fichier</p>
                  <input type="file" accept="video/*" onChange={(event) => void handleFileInputChange(event.target.files?.[0] ?? null)} />
                </div>

                <label>
                  Titre (optionnel)
                  <input
                    value={newExerciseTitle}
                    onChange={(event) => setNewExerciseTitle(event.target.value)}
                    placeholder="Ex: Rotation épaule"
                  />
                </label>
                <div className="form-row">
                  <label>
                    Répétitions
                    <input
                      value={newExerciseRepetitions}
                      onChange={(event) => setNewExerciseRepetitions(event.target.value)}
                    />
                  </label>
                  <label>
                    Repos
                    <input value={newExerciseRest} onChange={(event) => setNewExerciseRest(event.target.value)} />
                  </label>
                </div>
                <label>
                  Consignes
                  <input
                    value={newExerciseInstructions}
                    onChange={(event) => setNewExerciseInstructions(event.target.value)}
                  />
                </label>
                {dropMessage === "loading" && <p className="small-text">Import vidéo en cours...</p>}
                {dropMessage === "ok" && <p className="success">Vidéo ajoutée à la bibliothèque.</p>}
                {dropMessage === "error" && <p className="error">Impossible d'ajouter cette vidéo (URL/fichier invalide).</p>}
              </div>
            </div>
          </section>}
          </div>
          </main>
        ) : null
      ) : (
        isPatientAuthenticated ? (
          <main className="grid patient-grid app-with-sidebar patient-with-sidebar">
          <aside className="card side-tabs" aria-label="Navigation patient">
            <h3>Navigation</h3>
            <button type="button" className={`side-tab-link ${activePatientTab === "exercices" ? "active" : ""}`} onClick={() => setActivePatientTab("exercices")}>Mon programme</button>
            <button type="button" className={`side-tab-link ${activePatientTab === "douleur" ? "active" : ""}`} onClick={() => setActivePatientTab("douleur")}>Mon ressenti</button>
            <button type="button" className={`side-tab-link ${activePatientTab === "historique" ? "active" : ""}`} onClick={() => setActivePatientTab("historique")}>Activité</button>
            <button type="button" className={`side-tab-link ${activePatientTab === "dashboard" ? "active" : ""}`} onClick={() => setActivePatientTab("dashboard")}>Vue d'ensemble</button>
            <button type="button" className={`side-tab-link ${activePatientTab === "acces" ? "active" : ""}`} onClick={() => setActivePatientTab("acces")}>Mon compte</button>
          </aside>
          <div className="content-stack single-panel">
          {currentPatient && activePatientTab === "dashboard" && (
            <section id="pat-dashboard" className="card wide section-anchor">
              <h2>Vue d'ensemble patient</h2>
              <div className="kpi-grid">
                <article className="kpi-card">
                  <p className="kpi-label">Exercices validés</p>
                  <p className="kpi-value">{patientCompletion.done}/{patientCompletion.total}</p>
                </article>
                <article className="kpi-card">
                  <p className="kpi-label">Progression</p>
                  <p className="kpi-value">{patientCompletion.percent}%</p>
                </article>
                <article className="kpi-card">
                  <p className="kpi-label">Entrées douleur</p>
                  <p className="kpi-value">{state.painLogs.filter((item) => item.patientId === currentPatient.id).length}</p>
                </article>
                <article className="kpi-card">
                  <p className="kpi-label">Protocoles actifs</p>
                  <p className="kpi-value">{patientAssignedProtocols.length}</p>
                </article>
              </div>

              <div className="progress-inline">
                <p className="small-text">Objectif du programme: {patientCompletion.done} exercices validés sur {patientCompletion.total}.</p>
                <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={patientCompletion.percent}>
                  <div className="progress-fill" style={{ width: `${patientCompletion.percent}%` }} />
                </div>
              </div>

              <div className="dashboard-grid">
                <article className="chart-card patient-equal-chart">
                  <h3>Exercices validés par jour (7 jours)</h3>
                  <div className="patient-chart-area">
                    <VerticalBarChart data={patientDonePerDayChart} yLabel="Nombre d'exercices" />
                  </div>
                </article>
                <article className="chart-card patient-equal-chart">
                  <h3>Tendance douleur personnelle</h3>
                  <div className="patient-chart-area">
                    <LineChart data={patientPainTrend} yMax={10} chartHeight={238} />
                  </div>
                </article>
              </div>
            </section>
          )}

          {activePatientTab === "acces" && <section id="pat-acces" className="card section-anchor">
            <h2>Mon compte</h2>
            <p className="small-text">Connecté avec l'identifiant: {currentPatient?.token}</p>
            <p>Bienvenue {currentPatient?.name}. Suivez vos exercices et votre ressenti douleur.</p>
            <div className="link-box">
              <h3>Modifier mon profil</h3>
              <p className="small-text">Vous pouvez changer votre nom, identifiant et mot de passe après la première connexion.</p>
              <label>
                Nouveau nom
                <input
                  value={patientAccountNameInput}
                  onChange={(event) => setPatientAccountNameInput(event.target.value)}
                  placeholder={currentPatient?.name ?? "votre nom"}
                />
              </label>
              <label>
                Nouvel identifiant
                <input
                  value={patientAccountTokenInput}
                  onChange={(event) => setPatientAccountTokenInput(event.target.value)}
                  placeholder={currentPatient?.token ?? "nouvel identifiant"}
                />
              </label>
              <label>
                Nouveau mot de passe
                <input
                  type="password"
                  value={patientAccountPasswordInput}
                  onChange={(event) => setPatientAccountPasswordInput(event.target.value)}
                  placeholder="minimum 6 caractères"
                />
              </label>
              <button onClick={updatePatientCredentials} disabled={!patientAccountNameInput.trim() && !patientAccountTokenInput.trim() && !patientAccountPasswordInput.trim()}>
                Enregistrer mon profil
              </button>
              {patientAccountStatus === "saved" && <p className="success">Profil mis à jour.</p>}
            </div>
            <div className="link-box">
              <h3>Protocoles attribués</h3>
              {patientAssignedProtocols.length === 0 ? (
                <p className="small-text">Aucun protocole attribué pour le moment. Ton praticien peut t'en assigner depuis son espace.</p>
              ) : (
                <div className="chip-list">
                  {patientAssignedProtocols.map((protocol) => (
                    <span key={`chip-${protocol.id}`} className="protocol-chip">{protocol.name}</span>
                  ))}
                </div>
              )}
            </div>
          </section>}

          {currentPatient && activePatientTab === "exercices" && (
              <section id="pat-exercices" className="card wide section-anchor">
                <div className="patient-program-header">
                  <h2>Ma séance - {currentPatient.name}</h2>
                  <div className="program-filter-tabs" role="tablist" aria-label="Filtrer les séances">
                    <button type="button" className={patientExerciseFilter === "all" ? "active" : ""} onClick={() => setPatientExerciseFilter("all")}>Tous</button>
                    <button type="button" className={patientExerciseFilter === "done" ? "active" : ""} onClick={() => setPatientExerciseFilter("done")}>Terminées</button>
                    <button type="button" className={patientExerciseFilter === "pending" ? "active" : ""} onClick={() => setPatientExerciseFilter("pending")}>Non fait</button>
                  </div>
                </div>
                <p className="small-text">Progression: {patientCompletion.done}/{patientCompletion.total} exercices validés ({patientCompletion.percent}%)</p>
                {currentExercises.length === 0 ? (
                  <p>Aucun exercice assigné pour le moment. Vérifie avec ton praticien que ton protocole a bien des vidéos associées.</p>
                ) : (
                  <>
                    {featuredPatientExercise ? (
                      <article className={`exercise-item patient-featured-exercise patient-exercise-card ${completedExerciseIds.has(featuredPatientExercise.id) ? "done" : "pending"} ${exerciseSubmitStatusId === featuredPatientExercise.id ? "just-saved" : ""}`}>
                        <div className="patient-featured-left">
                          <p className={`exercise-status ${completedExerciseIds.has(featuredPatientExercise.id) ? "done" : "pending"}`}>
                            {completedExerciseIds.has(featuredPatientExercise.id) ? "Terminé" : "À faire"}
                          </p>
                          <h3>{featuredPatientExercise.title}</h3>
                          <p><strong>Répétitions:</strong> {featuredPatientExercise.repetitions}</p>
                          <p><strong>Repos:</strong> {featuredPatientExercise.rest}</p>
                          <p>{featuredPatientExercise.instructions}</p>
                          <div className="action-row">
                            <a href={featuredPatientExercise.videoUrl} target="_blank" rel="noreferrer">Ouvrir la vidéo</a>
                            <button
                              className={exerciseSubmitStatusId === featuredPatientExercise.id ? "is-sent" : ""}
                              disabled={completedExerciseIds.has(featuredPatientExercise.id)}
                              onClick={() => markExerciseDone(currentPatient.id, featuredPatientExercise.id)}
                            >
                              {completedExerciseIds.has(featuredPatientExercise.id) ? "Séance terminée" : "Valider la séance"}
                            </button>
                          </div>
                          {exerciseSubmitStatusId === featuredPatientExercise.id && <p className="success exercise-submit-feedback">✅ Séance enregistrée.</p>}
                        </div>
                        <div className="patient-featured-right">
                          <VideoPreview videoUrl={featuredPatientExercise.videoUrl} title={featuredPatientExercise.title} />
                        </div>
                      </article>
                    ) : (
                      <p className="small-text">Aucun exercice dans ce filtre.</p>
                    )}

                    {remainingPatientExercises.length > 0 && (
                      <div className="link-box">
                        <h3>Séances suivantes</h3>
                        <div className="patient-session-list">
                          {remainingPatientExercises.map((exercise) => {
                            const done = completedExerciseIds.has(exercise.id);

                            return (
                              <article key={exercise.id} className={`exercise-item patient-featured-exercise patient-exercise-card ${done ? "done" : "pending"} ${exerciseSubmitStatusId === exercise.id ? "just-saved" : ""}`}>
                                <div className="patient-featured-left">
                                  <p className={`exercise-status ${done ? "done" : "pending"}`}>{done ? "Terminé" : "À faire"}</p>
                                  <h3>{exercise.title}</h3>
                                  <p><strong>Répétitions:</strong> {exercise.repetitions}</p>
                                  <p><strong>Repos:</strong> {exercise.rest}</p>
                                  <p>{exercise.instructions}</p>
                                  <div className="action-row">
                                    <a href={exercise.videoUrl} target="_blank" rel="noreferrer">Ouvrir la vidéo</a>
                                    <button className={exerciseSubmitStatusId === exercise.id ? "is-sent" : ""} disabled={done} onClick={() => markExerciseDone(currentPatient.id, exercise.id)}>
                                      {done ? "Séance terminée" : "Valider la séance"}
                                    </button>
                                  </div>
                                  {exerciseSubmitStatusId === exercise.id && <p className="success exercise-submit-feedback">✅ Séance enregistrée.</p>}
                                </div>
                                <div className="patient-featured-right">
                                  <VideoPreview videoUrl={exercise.videoUrl} title={exercise.title} />
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </section>
          )}

          {currentPatient && activePatientTab === "douleur" && <section id="pat-douleur" className="card section-anchor">
                <h2>Suivi douleur</h2>
                <p className="small-text">Renseigne ton ressenti pour aider ton praticien à adapter les prochaines séances.</p>
                <label>
                  Ressenti après effort: {painValue}/10
                  <input
                    type="range"
                    min={0}
                    max={10}
                    value={painValue}
                    onChange={(event) => setPainValue(Number(event.target.value))}
                  />
                </label>
                <label>
                  Contexte
                  <select value={painContext} onChange={(event) => setPainContext(event.target.value as "avant" | "apres" | "repos")}>
                    <option value="avant">Avant séance</option>
                    <option value="apres">Après séance</option>
                    <option value="repos">Jour de repos</option>
                  </select>
                </label>
                <label>
                  Commentaire (optionnel)
                  <textarea
                    value={painComment}
                    onChange={(event) => setPainComment(event.target.value)}
                    placeholder="Ex: douleur localisée au genou, surtout en montée d'escalier"
                    rows={3}
                  />
                </label>
                <button className={painSubmitStatus === "saved" ? "is-sent" : ""} onClick={() => submitPainLog(currentPatient.id)}>Enregistrer mon ressenti</button>
                {painSubmitStatus === "saved" && <p className="success pain-submit-feedback">✅ Ressenti enregistré avec succès.</p>}
              </section>}

          {currentPatient && activePatientTab === "historique" && <section id="pat-historique" className="card section-anchor">
                <h2>Historique récent</h2>
                {historyDeleteMessage && <p className="success history-delete-feedback">✅ {historyDeleteMessage}</p>}
                {patientRecentActivity.length === 0 ? (
                  <p className="small-text">Aucun événement pour le moment.</p>
                ) : (
                  <>
                    <div className="history-header">
                      <div className="history-stats">
                        <span className="history-stat">Total: {patientHistorySummary.total}</span>
                        <span className="history-stat">Aujourd'hui: {patientHistorySummary.today}</span>
                        <span className="history-stat">Ressentis: {patientHistorySummary.pain}</span>
                      </div>
                    </div>

                    <div className="history-groups">
                    {patientActivityByDay.map((group) => (
                      <article key={group.key} className="history-group">
                        <div className="history-group-head">
                          <h3>{group.dayLabel}</h3>
                          <span className="history-count">{group.items.length} événement{group.items.length > 1 ? "s" : ""}</span>
                        </div>
                        <ul className="history-list">
                          {group.items.map((entry) => (
                            <li key={entry.id} className={`history-item ${entry.type}`}>
                              <div className="history-item-head">
                                <span className={`history-badge ${entry.type}`}>
                                  {entry.type === "completion" ? "Exercice" : "Ressenti"}
                                </span>
                                <div className="history-item-meta">
                                  <span className="history-time">{new Date(entry.dateIso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>
                                  <button
                                    type="button"
                                    className="history-delete-btn"
                                    aria-label="Supprimer cet élément d'historique"
                                    title="Supprimer"
                                    onClick={() => deletePatientHistoryEntry(entry)}
                                  >
                                    🗑
                                  </button>
                                </div>
                              </div>
                              <p className="history-item-main">{entry.title}</p>
                              <p className="history-item-detail">{entry.detail}</p>
                            </li>
                          ))}
                        </ul>
                      </article>
                    ))}
                  </div>
                  </>
                )}
              </section>}
          </div>
          </main>
        ) : null
      )}
    </div>
  );
}