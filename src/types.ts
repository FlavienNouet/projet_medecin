export type Exercise = {
  id: string;
  title: string;
  videoUrl: string;
  repetitions: string;
  rest: string;
  instructions: string;
};

export type Protocol = {
  id: string;
  name: string;
  description?: string;
  exerciseIds: string[];
};

export type Patient = {
  id: string;
  name: string;
  token: string;
  password?: string;
  practitionerId?: string;
};

export type PractitionerAccount = {
  id: string;
  name: string;
  email: string;
  password: string;
};

export type AssignedProgram = {
  patientId: string;
  protocolIds: string[];
};

export type PainLog = {
  patientId: string;
  value: number;
  dateIso: string;
  context?: "avant" | "apres" | "repos";
  comment?: string;
};

export type CompletionLog = {
  patientId: string;
  exerciseId: string;
  dateIso: string;
};

export type PatientReminderSchedule = {
  patientId: string;
  sessionsPerWeek: number;
  channel: "email" | "sms";
  reminderTime: string;
  active: boolean;
};

export type ReminderLog = {
  patientId: string;
  dateIso: string;
  channel: "email" | "sms";
  message: string;
};

export type AppState = {
  exercises: Exercise[];
  protocols: Protocol[];
  patients: Patient[];
  practitioners: PractitionerAccount[];
  assignments: AssignedProgram[];
  painLogs: PainLog[];
  completionLogs: CompletionLog[];
  reminderSchedules: PatientReminderSchedule[];
  reminderLogs: ReminderLog[];
};