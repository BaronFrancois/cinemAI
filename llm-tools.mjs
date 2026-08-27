export const GEMINI_FUNCTION_DECLARATIONS = [
  {
    name: "set_project",
    description: "Proposer le titre, le brief ou les paramètres globaux du projet. Ne l'applique pas sans validation humaine.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Titre du projet." },
        brief: { type: "string", description: "Intention et contraintes du projet." },
        aspectRatio: { type: "string", description: "Format visuel, par exemple 16:9 ou 9:16." },
        fps: { type: "integer", description: "Cadence cible." },
        durationSeconds: { type: "integer", description: "Durée totale cible en secondes." },
      },
    },
  },
  {
    name: "create_asset",
    description: "Proposer un personnage, un décor, un accessoire ou une direction de style avec un identifiant stable créé après validation.",
    parameters: {
      type: "object",
      properties: {
        assetType: { type: "string", enum: ["character", "location", "prop", "style"] },
        name: { type: "string" },
        description: { type: "string" },
      },
      required: ["assetType", "name"],
    },
  },
  {
    name: "create_sequence",
    description: "Proposer une séquence narrative qui pourra recevoir plusieurs plans.",
    parameters: {
      type: "object",
      properties: { title: { type: "string" }, summary: { type: "string" } },
      required: ["title"],
    },
  },
  {
    name: "create_shot",
    description: "Proposer un plan relié à une séquence et choisir sa stratégie visuelle initiale.",
    parameters: {
      type: "object",
      properties: {
        sequenceId: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        durationMs: { type: "integer" },
        strategy: { type: "string", enum: ["image", "first_last_video", "micro_video", "image_sequence", "interpolation"] },
        assetIds: { type: "array", items: { type: "string" } },
      },
      required: ["description"],
    },
  },
  {
    name: "update_shot",
    description: "Proposer une correction locale d'un plan existant sans réécrire les autres plans.",
    parameters: {
      type: "object",
      properties: {
        shotId: { type: "string" },
        patch: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            durationMs: { type: "integer" },
            strategy: { type: "string", enum: ["image", "first_last_video", "micro_video", "image_sequence", "interpolation"] },
          },
        },
      },
      required: ["shotId", "patch"],
    },
  },
  {
    name: "add_timeline_clip",
    description: "Proposer le placement d'un plan sur la piste visuelle canonique.",
    parameters: {
      type: "object",
      properties: {
        shotId: { type: "string" },
        title: { type: "string" },
        strategy: { type: "string", enum: ["image", "first_last_video", "micro_video", "image_sequence", "interpolation"] },
        startMs: { type: "integer" },
        durationMs: { type: "integer" },
      },
      required: ["shotId", "startMs"],
    },
  },
  {
    name: "add_audio_clip",
    description: "Proposer un clip sur une piste audio séparée de la vidéo.",
    parameters: {
      type: "object",
      properties: {
        trackKind: { type: "string", enum: ["dialogue", "voiceover", "sfx", "ambience", "music"] },
        title: { type: "string" },
        shotId: { type: "string" },
        startMs: { type: "integer" },
        durationMs: { type: "integer" },
      },
      required: ["trackKind", "title", "startMs", "durationMs"],
    },
  },
  {
    name: "queue_generation",
    description: "Proposer un job de génération. La validation ne lance encore aucun fournisseur payant ; elle ajoute le job à la file locale.",
    parameters: {
      type: "object",
      properties: {
        targetType: { type: "string", enum: ["shot", "asset"] },
        targetId: { type: "string" },
        strategy: { type: "string", enum: ["image", "first_last_video", "micro_video", "image_sequence", "interpolation", "dialogue", "voiceover", "sfx", "ambience", "music"] },
        label: { type: "string" },
      },
      required: ["targetType", "targetId", "strategy"],
    },
  },
];

export function extractFunctionCalls(parts = []) {
  return parts
    .filter((part) => part?.functionCall && typeof part.functionCall.name === "string")
    .map((part) => ({
      name: part.functionCall.name,
      args: part.functionCall.args && typeof part.functionCall.args === "object" ? part.functionCall.args : {},
    }));
}
