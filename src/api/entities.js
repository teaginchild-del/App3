import { base44, isBase44 } from './base44Client';
import { createLocalEntity } from './localStore';

const entity = (name) => (isBase44 ? base44.entities[name] : createLocalEntity(name));

export const LedgerRecord = entity('LedgerRecord');
export const RecordType = entity('RecordType');
export const MatchRule = entity('MatchRule');
export const Match = entity('Match');
export const QuickBooksConnection = entity('QuickBooksConnection');
export const ImportBatch = entity('ImportBatch');
export const ImportTemplate = entity('ImportTemplate');

/** Read every row of an entity (Base44 caps a single request at 5,000). */
export async function listAll(handler, query = {}, sort = '-created_date') {
  const pageSize = 5000;
  const out = [];
  for (let skip = 0; ; skip += pageSize) {
    const rows = await handler.filter(query, sort, pageSize, skip);
    out.push(...rows);
    if (rows.length < pageSize) return out;
  }
}

/** Write in chunks so large imports don't hit request size limits. */
export async function bulkCreateChunked(handler, rows, size = 200) {
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push(...(await handler.bulkCreate(rows.slice(i, i + size))));
  return out;
}

export async function bulkUpdateChunked(handler, rows, size = 200) {
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    if (typeof handler.bulkUpdate === 'function') await handler.bulkUpdate(chunk);
    else for (const { id, ...data } of chunk) await handler.update(id, data);
  }
}
