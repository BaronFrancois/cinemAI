// Structural checks only: no provider call and no claim of visual recognition.
export function reviewStoryboard(manifest) {
  const shots = manifest.shots || [];
  const assets = manifest.assets || [];
  const media = manifest.media || [];
  const issues = [];
  const add = (code, message, shotId = null) => issues.push({ code, message, shotId });
  if (!shots.length) add("empty", "Le scénario doit être découpé en plans.");
  const durationMs = shots.reduce((sum, shot) => sum + (shot.durationMs || 0), 0);
  const targetMs = (manifest.project?.durationSeconds || 0) * 1000;
  if (shots.length && targetMs && Math.abs(durationMs - targetMs) > 500) {
    add("duration", `Les plans durent ${durationMs / 1000} s pour une cible de ${targetMs / 1000} s.`);
  }
  let approvedFrames = 0;
  shots.forEach((shot, index) => {
    const images = media.filter(m => m.targetType === "shot" && m.targetId === shot.id && m.kind === "image");
    const selected = images.find(m => m.status === "approved") || images.at(-1);
    if (!shot.description?.trim()) add("description", "L’action du plan reste à décrire.", shot.id);
    if (!selected) add("missing_frame", "L’image de ce plan n’a pas encore été créée.", shot.id);
    else {
      if (selected.status === "approved") approvedFrames += 1;
      else add("unapproved_frame", "L’image du plan attend votre validation.", shot.id);
      const checkedVersion = selected.reviewedShotVersion || selected.sourceShotVersion;
      if (checkedVersion && checkedVersion !== shot.version) {
        add("stale_frame", "Le scénario a changé depuis cette image : vérifiez son adéquation.", shot.id);
      } else if (!checkedVersion) {
        add("unknown_source", "Image historique : la version du scénario utilisée n’est pas connue.", shot.id);
      }
    }
    if (!(shot.assetIds || []).length) add("no_references", "Aucun personnage ou décor de référence n’est lié à ce plan.", shot.id);
    for (const id of shot.assetIds || []) {
      const asset = assets.find(a => a.id === id);
      if (!asset) { add("missing_asset", "Une référence liée à ce plan est introuvable.", shot.id); continue; }
      const reference = media.find(m => m.targetType === "asset" && m.targetId === id && m.kind === "image" && !m.variantKey && m.purpose !== "set_layout" && m.status === "approved");
      if (!reference) add("unapproved_reference", `La référence « ${asset.name} » n’est pas validée.`, shot.id);
      // Provenance : l'image du plan a-t-elle été produite depuis la référence
      // aujourd'hui validée ? Une planche régénérée depuis rend le plan suspect.
      else if (selected && Array.isArray(selected.sourceRefs) && selected.sourceRefs.length) {
        const used = selected.sourceRefs.find(ref => ref.assetId === id);
        if (used && used.mediaId !== reference.id) {
          add("reference_changed", `La référence « ${asset.name} » a changé depuis cette image : revoyez ce plan.`, shot.id);
        }
      }
    }
    if (shot.continuity === "continuous") {
      if (!index) add("first_continuous", "Le premier plan ne peut pas prolonger un plan précédent.", shot.id);
      else {
        const locations = s => (s.assetIds || []).filter(id => assets.some(a => a.id === id && a.type === "location")).sort().join(",");
        if (locations(shot) !== locations(shots[index - 1])) add("location_change", "Le décor change alors que ce plan prolonge le précédent.", shot.id);
      }
    }
    for (const line of shot.dialogue || []) {
      if (!assets.some(a => a.type === "character" && (shot.assetIds || []).includes(a.id) && a.name.toLocaleLowerCase() === line.speaker?.toLocaleLowerCase())) {
        add("speaker", `Le personnage qui parle (« ${line.speaker || "non précisé"} ») n’est pas lié au plan.`, shot.id);
      }
    }
  });
  return { revision: manifest.revision, scope: "structure", durationMs, targetMs, approvedFrames, shotCount: shots.length, issues };
}
