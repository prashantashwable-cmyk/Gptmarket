import type { Ctx } from '../ctx';
import { withSystem, type Rec, type Tx } from '../db';

/**
 * Records an automated workflow step (brief section 13) in the caller's transaction.
 * Every event carries an id, timestamp, actor, status, retry counters and an idempotency key.
 * Returns false when the key was already used: the caller must then skip the side effects,
 * which is what makes duplicate requests and replayed webhooks harmless.
 */
export async function emitEvent(
  tx: Tx, ctx: Ctx | null, eventType: string, idempotencyKey: string,
  entity: { type: string; id: string | null }, payload: Record<string, unknown> = {},
): Promise<boolean> {
  const rows = await tx.query<{ id: string }>(
    `insert into automation_events (event_type, idempotency_key, entity_type, entity_id, actor_id, payload, status, attempts, processed_at)
     values ($1, $2, $3, $4, $5, $6, 'DONE', 1, now()) on conflict (idempotency_key) do nothing returning id`,
    [eventType, idempotencyKey, entity.type, entity.id, ctx?.userId ?? null, JSON.stringify(payload)],
  );
  return rows.length === 1;
}

/** Records a step that failed outside a transaction that rolled back, so it can be retried and is visible to staff. */
export async function recordFailedEvent(eventType: string, idempotencyKey: string, entity: { type: string; id: string | null }, error: unknown, payload: Record<string, unknown> = {}): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await withSystem((tx) => tx.exec(
    `insert into automation_events (event_type, idempotency_key, entity_type, entity_id, payload, status, attempts, last_error)
     values ($1, $2, $3, $4, $5, 'FAILED', 1, $6)
     on conflict (idempotency_key) do update set attempts = least(automation_events.attempts + 1, 20), last_error = excluded.last_error
       where automation_events.status <> 'DONE'`,
    [eventType, `failed:${idempotencyKey}`, entity.type, entity.id, JSON.stringify(payload), message.slice(0, 1000)],
  ));
}

export async function listEvents(tx: Tx, entityType: string, entityId: string): Promise<Rec[]> {
  return tx.query<Rec>(
    `select e.event_type, e.status, e.attempts, e.created_at, e.last_error, u.full_name as actor
       from automation_events e left join users u on u.id = e.actor_id
      where e.entity_type = $1 and e.entity_id = $2 order by e.created_at`, [entityType, entityId]);
}
