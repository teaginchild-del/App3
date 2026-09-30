// Minimal localStorage implementation of the Base44 entity API
// (list / filter / get / create / bulkCreate / update / bulkUpdate / delete).

const PREFIX = 'qbo-match:';

function load(name) {
  try {
    return JSON.parse(localStorage.getItem(PREFIX + name) || '[]');
  } catch {
    return [];
  }
}

function save(name, rows) {
  localStorage.setItem(PREFIX + name, JSON.stringify(rows));
}

function sortRows(rows, sort) {
  if (!sort) return rows;
  const desc = sort.startsWith('-');
  const key = desc ? sort.slice(1) : sort;
  return [...rows].sort((a, b) => {
    const x = a[key] ?? '';
    const y = b[key] ?? '';
    if (x < y) return desc ? 1 : -1;
    if (x > y) return desc ? -1 : 1;
    return 0;
  });
}

function matches(row, query) {
  return Object.entries(query || {}).every(([k, v]) => {
    if (Array.isArray(v)) return v.includes(row[k]);
    if (v && typeof v === 'object' && '$in' in v) return v.$in.includes(row[k]);
    return row[k] === v;
  });
}

function newId() {
  return (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replace(/-/g, '').slice(0, 24);
}

export function createLocalEntity(name) {
  const page = (rows, sort, limit, skip) => sortRows(rows, sort ?? '-created_date').slice(skip || 0, (skip || 0) + (limit || 5000));
  return {
    async list(sort, limit, skip) {
      return page(load(name), sort, limit, skip);
    },
    async filter(query, sort, limit, skip) {
      return page(load(name).filter((r) => matches(r, query)), sort, limit, skip);
    },
    async get(id) {
      const row = load(name).find((r) => r.id === id);
      if (!row) throw new Error(`${name} ${id} not found`);
      return row;
    },
    async create(data) {
      const [row] = await this.bulkCreate([data]);
      return row;
    },
    async bulkCreate(items) {
      const rows = load(name);
      const now = new Date().toISOString();
      const created = items.map((d) => ({ ...d, id: newId(), created_date: now, updated_date: now }));
      save(name, [...rows, ...created]);
      return created;
    },
    async update(id, data) {
      const rows = load(name);
      const i = rows.findIndex((r) => r.id === id);
      if (i < 0) throw new Error(`${name} ${id} not found`);
      rows[i] = { ...rows[i], ...data, id, updated_date: new Date().toISOString() };
      save(name, rows);
      return rows[i];
    },
    async bulkUpdate(items) {
      const rows = load(name);
      const byId = new Map(rows.map((r, i) => [r.id, i]));
      const now = new Date().toISOString();
      for (const { id, ...data } of items) {
        const i = byId.get(id);
        if (i != null) rows[i] = { ...rows[i], ...data, updated_date: now };
      }
      save(name, rows);
      return items;
    },
    async delete(id) {
      save(name, load(name).filter((r) => r.id !== id));
      return { success: true };
    },
    async deleteMany(query) {
      const rows = load(name);
      const keep = rows.filter((r) => !matches(r, query));
      save(name, keep);
      return { deleted: rows.length - keep.length };
    },
  };
}
