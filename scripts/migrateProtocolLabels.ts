import { PrismaClient } from "@prisma/client";

async function main() {
  const prisma = new PrismaClient();

  try {
    const row = await prisma.appStateRecord.findUnique({ where: { id: 1 } });
    if (!row) {
      console.log("Aucun état en base (id=1), rien à migrer.");
      return;
    }

    const state = JSON.parse(row.state);

    const exerciseTitleMap = new Map<string, string>([
      ["Mobilité cheville - flexion dorsale", "Mobilisation cheville guidée"],
      ["Renforcement mollet debout", "Montées sur pointes"],
      ["Équilibre unipodal", "Stabilisation appui unipodal"]
    ]);

    state.exercises = (state.exercises ?? []).map((exercise: { title?: string }) => ({
      ...exercise,
      title: exerciseTitleMap.get(exercise.title ?? "") ?? exercise.title
    }));

    const nextProtocols = [...(state.protocols ?? [])];

    const updateProtocolName = (id: string, nextName: string, fallbackExerciseId: string) => {
      const index = nextProtocols.findIndex((item: { id: string }) => item.id === id);

      if (index >= 0) {
        const current = nextProtocols[index];
        const currentExerciseIds = Array.isArray(current.exerciseIds) ? current.exerciseIds : [];
        nextProtocols[index] = {
          ...current,
          name: nextName,
          exerciseIds: Array.from(new Set(currentExerciseIds.length > 0 ? currentExerciseIds : [fallbackExerciseId]))
        };
        return;
      }

      nextProtocols.push({
        id,
        name: nextName,
        exerciseIds: [fallbackExerciseId]
      });
    };

    updateProtocolName("proto-1", "Mobilité cheville - flexion dorsale", "ex-1");
    updateProtocolName("proto-2", "Renforcement mollet debout", "ex-2");

    if (!nextProtocols.some((item: { id: string; name: string }) => item.id === "proto-3" || item.name === "Équilibre unipodal")) {
      nextProtocols.push({
        id: "proto-3",
        name: "Équilibre unipodal",
        exerciseIds: ["ex-3"]
      });
    }

    state.protocols = nextProtocols;

    await prisma.appStateRecord.update({
      where: { id: 1 },
      data: { state: JSON.stringify(state) }
    });

    console.log("État SQLite migré: libellés exercices/protocoles mis à jour.");
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
