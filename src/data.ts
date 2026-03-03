import type { Exercise, Patient, Protocol } from "./types";

export const defaultExercises: Exercise[] = [
  {
    id: "ex-1",
    title: "Mobilisation cheville guidée",
    videoUrl: "https://www.youtube.com/watch?v=iF4rNmQ0Rqo",
    repetitions: "3 x 12",
    rest: "45 sec",
    instructions: "Garder le talon au sol et avancer le genou sans douleur vive."
  },
  {
    id: "ex-2",
    title: "Montées sur pointes",
    videoUrl: "https://www.youtube.com/watch?v=-M4-G8p8fmc",
    repetitions: "3 x 15",
    rest: "60 sec",
    instructions: "Monter lentement sur la pointe des pieds puis redescendre contrôlé."
  },
  {
    id: "ex-3",
    title: "Stabilisation appui unipodal",
    videoUrl: "https://www.youtube.com/watch?v=2rQfiyQ3g3M",
    repetitions: "4 x 30 sec",
    rest: "30 sec",
    instructions: "Fixer un point devant soi, bassin stable, respiration calme."
  }
];

export const defaultProtocols: Protocol[] = [
  {
    id: "proto-1",
    name: "Mobilité cheville - flexion dorsale",
    exerciseIds: ["ex-1"]
  },
  {
    id: "proto-2",
    name: "Renforcement mollet debout",
    exerciseIds: ["ex-2"]
  },
  {
    id: "proto-3",
    name: "Équilibre unipodal",
    exerciseIds: ["ex-3"]
  }
];

export const defaultPatients: Patient[] = [
  { id: "pat-1", name: "Alice Martin", token: "alice-9f31" },
  { id: "pat-2", name: "Mehdi L.", token: "mehdi-2a8b" }
];