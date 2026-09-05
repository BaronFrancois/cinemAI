const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
const canonical = value => String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("fr");
const unknown = new Set(["", "?", "inconnu", "unknown", "indéterminé", "non précisé"]);
const known = value => !unknown.has(canonical(value));

export const NARRATIVE_TRANSITIONS = new Set(["unspecified", "direct", "ellipsis"]);

export function cleanNarrativeTransition(value) {
  if (value === undefined) return "unspecified";
  if (!NARRATIVE_TRANSITIONS.has(value)) fail("La transition narrative doit être non précisée, directe ou une ellipse.");
  return value;
}

export function cleanNarrativeStates(value, assetIds) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) fail("Déclarez au maximum 20 états par plan.");
  const keys = new Set();
  return value.map(entry => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail("Un état narratif est invalide.");
    const text = (field, max) => {
      if (typeof entry[field] !== "string" || entry[field].length > max) fail(`Le champ « ${field} » de l’état est invalide (maximum ${max} caractères).`);
      return entry[field].normalize("NFKC").trim().replace(/\s+/g, " ");
    };
    const assetId = text("assetId", 128);
    const property = text("property", 80);
    if (!assetIds.includes(assetId)) fail("L’élément suivi doit être lié au plan dans les références.");
    if (!property) fail("Précisez la propriété suivie, par exemple position ou tenue.");
    const key = JSON.stringify([assetId, canonical(property)]);
    if (keys.has(key)) fail("Une même propriété ne peut être déclarée deux fois pour le même élément.");
    keys.add(key);
    const before = text("before", 240);
    const after = text("after", 240);
    return { assetId, property, before: known(before) ? before : "", after: known(after) ? after : "" };
  });
}

// Only adjacent, explicitly declared states are compared. No NLP inference,
// synonym guessing, or carrying an old state across an undocumented shot.
export function reviewNarrativeContinuity(shots, assets) {
  const issues = [];
  const questions = [];
  const summary = { trackedShots: 0, compared: 0, indeterminate: 0, ellipses: 0 };
  const validStates = shot => (Array.isArray(shot.narrativeStates) ? shot.narrativeStates : [])
    .filter(s => s && typeof s.property === "string" && (shot.assetIds || []).includes(s.assetId) && assets.some(a => a.id === s.assetId));
  const key = s => JSON.stringify([s.assetId, canonical(s.property)]);
  shots.forEach((shot, index) => {
    const states = validStates(shot);
    if (states.length) summary.trackedShots += 1;
    if (!index) return;
    const previous = shots[index - 1];
    const previousStates = new Map(validStates(previous).map(s => [key(s), s]));
    // An explicit choice overrides the cinematic cut. Legacy continuous shots
    // already declare uninterrupted action, whereas a cut alone says nothing.
    const transition = shot.narrativeTransition && shot.narrativeTransition !== "unspecified"
      ? shot.narrativeTransition : shot.continuity === "continuous" ? "direct" : "unspecified";
    for (const current of states) {
      const earlier = previousStates.get(key(current));
      if (!earlier || !known(earlier.after) || !known(current.before)) { summary.indeterminate += 1; continue; }
      if (transition === "ellipsis") { summary.ellipses += 1; continue; }
      summary.compared += 1;
      if (canonical(earlier.after) === canonical(current.before)) continue;
      const asset = assets.find(a => a.id === current.assetId);
      const finding = {
        code: transition === "direct" ? "narrative_state_conflict" : "narrative_transition_question",
        severity: transition === "direct" ? "contradiction" : "question",
        shotId: shot.id,
        relatedShotIds: [previous.id, shot.id],
        assetId: asset.id,
        property: current.property,
        evidence: [
          { shotId: previous.id, shotVersion: previous.version, phase: "after", value: earlier.after },
          { shotId: shot.id, shotVersion: shot.version, phase: "before", value: current.before },
        ],
        message: `« ${asset.name} » — ${current.property} : « ${earlier.after} » à la fin de « ${previous.title || "Plan précédent"} », puis « ${current.before} » au début de « ${shot.title || "Plan suivant"} ». ${transition === "direct" ? "Ces états déclarés diffèrent malgré une action sans interruption." : "La transition n’est pas précisée : ce changement reste à expliquer, pas une erreur certaine."}`,
        suggestion: "Vérifiez les libellés, décrivez le changement dans l’action du plan et ses états avant/après, ou indiquez une ellipse si elle est intentionnelle.",
      };
      (transition === "direct" ? issues : questions).push(finding);
    }
  });
  return { issues, questions, summary };
}
