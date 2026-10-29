// Definicje typów zasobów – każdy typ ma własny zestaw pól.
const RESOURCE_TYPES = {
  documents: {
    label: 'Dokumenty',
    titleField: 'title',
    fields: [
      { key: 'title', label: 'Tytuł', type: 'text', required: true },
      { key: 'category', label: 'Kategoria', type: 'select', options: ['Umowa', 'Raport', 'Procedura', 'Notatka'], required: true },
      { key: 'author', label: 'Autor', type: 'text', required: true },
      { key: 'status', label: 'Status', type: 'select', options: ['Szkic', 'Zatwierdzony', 'Archiwalny'], required: true },
      { key: 'content', label: 'Treść', type: 'textarea' },
    ],
  },
  projects: {
    label: 'Projekty',
    titleField: 'name',
    fields: [
      { key: 'name', label: 'Nazwa projektu', type: 'text', required: true },
      { key: 'lead', label: 'Kierownik projektu', type: 'text', required: true },
      { key: 'budget', label: 'Budżet (PLN)', type: 'number', required: true },
      { key: 'startDate', label: 'Data rozpoczęcia', type: 'date', required: true },
      { key: 'endDate', label: 'Data zakończenia', type: 'date' },
      { key: 'status', label: 'Status', type: 'select', options: ['Planowany', 'W toku', 'Zakończony'], required: true },
    ],
  },
  devices: {
    label: 'Urządzenia',
    titleField: 'name',
    fields: [
      { key: 'name', label: 'Nazwa', type: 'text', required: true },
      { key: 'deviceType', label: 'Rodzaj', type: 'select', options: ['Laptop', 'Telefon', 'Drukarka', 'Serwer'], required: true },
      { key: 'serialNumber', label: 'Numer seryjny', type: 'text', required: true },
      { key: 'location', label: 'Lokalizacja', type: 'text' },
      { key: 'condition', label: 'Stan', type: 'select', options: ['Sprawny', 'W naprawie', 'Wycofany'], required: true },
    ],
  },
};

// Waliduje i oczyszcza dane zasobu; zwraca { data } lub { error }.
function validateResourceData(type, input) {
  const def = RESOURCE_TYPES[type];
  if (!def) return { error: 'Nieznany typ zasobu.' };
  if (!input || typeof input !== 'object') return { error: 'Nieprawidłowe dane zasobu.' };

  const data = {};
  for (const field of def.fields) {
    const raw = input[field.key];
    const empty = raw === undefined || raw === null || String(raw).trim() === '';
    if (empty) {
      if (field.required) return { error: `Pole „${field.label}” jest wymagane.` };
      data[field.key] = '';
      continue;
    }
    const value = String(raw).trim();
    if (value.length > 5000) return { error: `Pole „${field.label}” jest zbyt długie.` };
    if (field.type === 'number') {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) return { error: `Pole „${field.label}” musi być liczbą nieujemną.` };
      data[field.key] = n;
    } else if (field.type === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
        return { error: `Pole „${field.label}” musi być poprawną datą.` };
      }
      data[field.key] = value;
    } else if (field.type === 'select') {
      if (!field.options.includes(value)) return { error: `Nieprawidłowa wartość pola „${field.label}”.` };
      data[field.key] = value;
    } else {
      data[field.key] = value;
    }
  }
  return { data };
}

module.exports = { RESOURCE_TYPES, validateResourceData };
