'use strict';

const Config = require('./config');

function importProgrammeRows(db) {
  ensureProgrammeCatalog(db);
  return (db.programmes || []).map(item => ({
    id: item.id,
    name: item.name,
    level: item.level || null,
    data: item
  }));
}

function normalizeProgrammeText(value = '') {
  return String(value || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function ensureProgrammeCatalog(db) {
  db.programmes ||= [];
  const demoProgrammes = new Set(['p1:Digital Marketing', 'p2:Business Administration', 'p3:Software Development']);
  db.programmes = db.programmes.filter(item => !demoProgrammes.has(`${item.id}:${item.name}`));
  for (const programme of Config.PROGRAMME_CATALOG) {
    const existing = db.programmes.find(item => item.id === programme.id || normalizeProgrammeText(item.name) === normalizeProgrammeText(programme.name));
    if (existing) Object.assign(existing, { ...programme, ...existing, id: programme.id, name: programme.name, level: programme.level });
    else db.programmes.push({ ...programme });
  }
  return db.programmes;
}

function programmeById(db, id) {
  ensureProgrammeCatalog(db);
  return db.programmes.find(item => item.id === id) || null;
}

function unknownProgramme(db) {
  return programmeById(db, 'pr-unknown') || Config.PROGRAMME_CATALOG[Config.PROGRAMME_CATALOG.length - 1];
}

function programmeForText(db, text = '') {
  ensureProgrammeCatalog(db);
  const value = normalizeProgrammeText(text);
  if (!value) return unknownProgramme(db);
  if (/marketing manager|level 6.*marketing|marketing.*level 6/.test(value)) return programmeById(db, 'pr-marketing-manager-l6');
  if (/cim.*(diploma|level 6)|diploma.*marketing/.test(value)) return programmeById(db, 'pr-cim-l6');
  if (/marketing executive|level 4.*marketing executive/.test(value)) return programmeById(db, 'pr-marketing-exec-l4');
  if (/cim.*(certificate|level 4)|professional and digital marketing|digital marketing certificate/.test(value)) return programmeById(db, 'pr-cim-l4');
  if (/strategic sales/.test(value)) return programmeById(db, 'pr-strategic-sales-dm');
  if (/\bpmo\b/.test(value)) return programmeById(db, 'pr-pmo-apm');
  if (/project control/.test(value)) return programmeById(db, 'pr-project-control-l6');
  if (/chpp|chartered project professional|apm chartered/.test(value)) return programmeById(db, 'pr-apm-chpp');
  if (/pmp|project management|ai dashboards|ai in projects/.test(value)) return programmeById(db, 'pr-pmp-ai');
  if (/d2n2|skills bootcamp|bootcamp/.test(value)) return programmeById(db, 'pr-skills-bootcamp');
  if (/ipc|masterclass|stephen jenner|portfolio/.test(value)) return programmeById(db, 'pr-ipc-masterclass');
  if (/networking/.test(value)) return programmeById(db, 'pr-business-networking');
  if (/recruitment|upskill|employer|talent/.test(value)) return programmeById(db, 'pr-funded-recruitment');
  return unknownProgramme(db);
}

function isPlaceholderProgramme(value = {}) {
  const name = normalizeProgrammeText(value.programme || value.name);
  return !value.programme_id ||
    value.programme_id === 'p1' ||
    value.programme_id === 'pr-unknown' ||
    (name === 'digital marketing' && String(value.level || '').toLowerCase() === 'level 3') ||
    name === 'programme not identified';
}

exports.importProgrammeRows = importProgrammeRows;
exports.ensureProgrammeCatalog = ensureProgrammeCatalog;
exports.programmeById = programmeById;
exports.programmeForText = programmeForText;
exports.isPlaceholderProgramme = isPlaceholderProgramme;
