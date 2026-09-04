export const GEMINI_FUNCTION_DECLARATIONS = [
  {
    name: "set_project",
    description: "Présenter l'idée sous une forme structurée complète avant tout asset ou plan. Cette proposition constitue la porte de validation éditoriale et ne s'applique jamais sans validation humaine.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Titre du projet." },
        brief: { type: "string", description: "Intention et contraintes du projet." },
        premise: { type: "string", description: "Prémisse claire en une ou deux phrases." },
        genre: { type: "string", description: "Genre et tonalité." },
        visualStyle: { type: "string", description: "Direction visuelle proposée." },
        narrativeOutline: { type: "string", description: "Squelette narratif concis, sans détailler encore tous les plans." },
        aspectRatio: { type: "string", description: "Format visuel, par exemple 16:9 ou 9:16." },
        fps: { type: "integer", description: "Cadence cible." },
        durationSeconds: { type: "integer", description: "Durée totale cible en secondes." },
      },
      required: ["title", "premise", "genre", "visualStyle", "narrativeOutline"],
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
    name: "update_asset",
    description: "Proposer une modification ciblée d'un personnage, décor, accessoire ou style existant sans créer de doublon et sans toucher à ses médias validés.",
    parameters: {
      type: "object",
      properties: {
        assetId: { type: "string", description: "Identifiant exact d'un asset présent dans l'état courant." },
        name: { type: "string", description: "Nouveau nom, uniquement si l'utilisateur demande de le changer." },
        description: { type: "string", description: "Nouvelle description complète intégrant la correction demandée." },
      },
      required: ["assetId"],
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
        dialogue: {
          type: "array",
          description: "Répliques prononcées à l'image. À décider avant la génération vidéo : la synchronisation labiale est produite avec l'image et n'est pas ajoutable après.",
          items: {
            type: "object",
            properties: { speaker: { type: "string" }, line: { type: "string" } },
            required: ["line"],
          },
        },
        continuity: {
          type: "string",
          enum: ["cut", "continuous"],
          description: "\"continuous\" impose que la première image de ce plan soit la dernière du plan précédent. \"cut\" pour une coupe franche.",
        },
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
            dialogue: {
              type: "array",
              description: "Répliques prononcées à l'image. À décider avant la génération vidéo : la synchronisation labiale est produite avec l'image et n'est pas ajoutable après.",
              items: {
                type: "object",
                properties: { speaker: { type: "string" }, line: { type: "string" } },
                required: ["line"],
              },
            },
            continuity: {
              type: "string",
              enum: ["cut", "continuous"],
              description: "\"continuous\" impose que la première image de ce plan soit la dernière du plan précédent. \"cut\" pour une coupe franche.",
            },
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

// Outils de lecture seule : ils interrogent la télémétrie de production dans
// ClickHouse, à travers le serveur MCP officiel. Contrairement aux opérations,
// ils ne modifient rien et s'exécutent donc sans validation humaine.
export const ANALYTICS_TOOL_NAMES = new Set(["list_production_tables", "query_production_data"]);

export const ANALYTICS_FUNCTION_DECLARATIONS = [
  {
    name: "list_production_tables",
    description: "Lister les tables de télémétrie de production disponibles dans ClickHouse, avec leur schéma. À utiliser avant d'écrire une requête.",
    parameters: { type: "object", properties: {}, },
  },
  {
    name: "query_production_data",
    description: [
      "Interroger la télémétrie de production en SQL ClickHouse (lecture seule).",
      "Tables : production_events (journal des décisions et générations),",
      "media_generations (une ligne par image ou clip généré, avec cost_usd, version, chain_depth, reanchored),",
      "approvals (propositions de l'agent, avec status et decision_ms, la latence de décision humaine).",
      "Sert à répondre sur le coût d'un film, les plans les plus régénérés, la dérive du personnage",
      "le long d'une chaîne, ou les assets sans référence validée.",
    ].join(" "),
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Requête SELECT ClickHouse. Toujours préfixer les tables par cinemai." },
      },
      required: ["query"],
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
