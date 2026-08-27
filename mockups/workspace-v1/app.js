const root = document.documentElement;
const themeToggle = document.querySelector('#theme-toggle');
const themeLabel = document.querySelector('.theme-label');
const tabs = [...document.querySelectorAll('.sidebar-tab')];
const panels = [...document.querySelectorAll('[data-panel]')];
const shots = [...document.querySelectorAll('.shot-card')];
const prepareButton = document.querySelector('#prepare-button');
const compareButton = document.querySelector('#compare-button');
const comparePanel = document.querySelector('#compare-panel');
const continuityStage = document.querySelector('#continuity-stage');
const issuePanel = document.querySelector('#issue-panel');
const issueTitle = document.querySelector('#issue-title');
const issueDescription = document.querySelector('#issue-description');
const impactCopy = document.querySelector('#impact-copy');
const toast = document.querySelector('#toast');

const shotDetails = {
  1: { title: 'Plan 01 · Arrivée', issue: 'Aucun écart détecté', description: 'Mara et Nox utilisent les versions attendues dans la station.', observed: 'jacket_clean', expected: 'jacket_clean' },
  2: { title: "Plan 02 · L'incident", issue: 'État source confirmé', description: "La déchirure de la veste est établie à la fin de ce plan.", observed: 'jacket_torn_left', expected: 'jacket_torn_left' },
  3: { title: 'Plan 03 · La reprise', issue: 'État de costume incohérent', description: "Mara porte une veste intacte alors que le plan 02 a établi une déchirure à l'épaule gauche.", observed: 'jacket_clean', expected: 'jacket_torn_left' },
  4: { title: 'Plan 04 · La balise', issue: 'Contrôle humain recommandé', description: "Ce plan dépend de l'état corrigé du costume, sans nécessiter de régénération automatique.", observed: 'jacket_torn_left', expected: 'jacket_torn_left' },
  5: { title: 'Plan 05 · Le signal', issue: 'Aucun écart détecté', description: 'Le plan large ne présente aucune dépendance visuelle affectée.', observed: 'jacket_torn_left', expected: 'jacket_torn_left' }
};

let prepared = false;
let toastTimer;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2200);
}

themeToggle.addEventListener('click', () => {
  const dark = root.dataset.theme !== 'dark';
  root.dataset.theme = dark ? 'dark' : 'light';
  themeToggle.setAttribute('aria-pressed', String(dark));
  themeLabel.textContent = dark ? 'Clair' : 'Sombre';
});

tabs.forEach((tab) => tab.addEventListener('click', () => {
  tabs.forEach((item) => {
    const active = item === tab;
    item.classList.toggle('is-active', active);
    item.setAttribute('aria-selected', String(active));
  });
  panels.forEach((panel) => panel.classList.toggle('is-hidden', panel.dataset.panel !== tab.dataset.tab));
}));

shots.forEach((shot) => shot.addEventListener('click', () => {
  const id = shot.dataset.shot;
  const details = shotDetails[id];
  shots.forEach((item) => {
    const selected = item === shot;
    item.classList.toggle('is-selected', selected);
    item.toggleAttribute('aria-current', selected);
  });
  document.querySelector('#inspector-title').textContent = details.title;
  issueTitle.textContent = details.issue;
  issueDescription.textContent = details.description;
  document.querySelector('#observed-state').textContent = details.observed;
  document.querySelector('#expected-state').textContent = details.expected;
  prepareButton.disabled = id !== '3' || prepared;
  prepareButton.textContent = id === '3' && prepared ? '✓ Correction préparée' : id === '3' ? '✦ Préparer la correction locale' : 'Aucune correction nécessaire';
}));

prepareButton.addEventListener('click', () => {
  prepared = true;
  const target = document.querySelector('[data-shot="3"]');
  target.classList.add('is-prepared');
  target.classList.remove('has-issue');
  target.querySelector('.status').className = 'status status--stable';
  target.querySelector('.status').textContent = 'Préparé';
  target.querySelector('.shot-frame em').textContent = '✓';
  continuityStage.classList.add('is-repaired');
  issuePanel.classList.add('is-prepared');
  issueTitle.textContent = 'Correction locale préparée';
  issueDescription.textContent = 'shot_03@v3 référence maintenant jacket_torn_left. Aucune génération distante n’a été lancée.';
  impactCopy.innerHTML = '<strong>1 nouvelle version locale.</strong> Les quatre autres hashes restent inchangés.';
  document.querySelector('.hash-diff code').textContent = '8f2a… → c14b…';
  document.querySelector('.summary-issue').innerHTML = '<strong>0</strong> rupture ouverte';
  prepareButton.textContent = '✓ Correction préparée';
  prepareButton.classList.add('is-active');
  prepareButton.disabled = true;
  comparePanel.hidden = false;
  compareButton.setAttribute('aria-pressed', 'true');
  showToast('Correction locale préparée · aucun autre plan modifié');
});

compareButton.addEventListener('click', () => {
  comparePanel.hidden = !comparePanel.hidden;
  compareButton.setAttribute('aria-pressed', String(!comparePanel.hidden));
});

document.querySelector('#scan-button').addEventListener('click', () => {
  document.querySelector('[data-shot="3"]').focus();
  showToast(prepared ? 'Analyse terminée · aucune rupture ouverte' : 'Analyse terminée · 1 rupture détectée au plan 03');
});

document.querySelector('#export-button').addEventListener('click', () => {
  const manifest = {
    project: 'le_dernier_signal',
    manifestVersion: '0.3-mockup',
    localOnly: true,
    preparedCorrection: prepared ? { shotId: 'shot_03', from: 'v2', to: 'v3', changedState: 'jacket_torn_left', untouchedShots: ['shot_01', 'shot_02', 'shot_04', 'shot_05'] } : null
  };
  const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'cinemai-manifest-mockup.json';
  link.click();
  URL.revokeObjectURL(link.href);
  showToast('Manifeste de maquette exporté');
});

