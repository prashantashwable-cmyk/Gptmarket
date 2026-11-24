import { timingSafeEqual } from 'node:crypto';
import { AppError } from '@/lib/errors';
import { fail, ok } from '@/server/api';
import { runMarketSweep } from '@/server/services/market-admin';
import { runExpirySweep } from '@/server/services/partners';
import { runReminderSweep } from '@/server/services/reminders';

/** Scheduled housekeeping (licence expiry, invitation expiry, package quotation expiry, overdue and upcoming-due reminders). Call from a cron with `Authorization: Bearer <APP_SECRET>`. */
export async function POST(request: Request) {
  try {
    const secret = process.env.APP_SECRET ?? '';
    const given = (request.headers.get('authorization') ?? '').replace(/^Bearer /, '');
    const a = Buffer.from(secret);
    const b = Buffer.from(given);
    if (secret.length < 16 || a.length !== b.length || !timingSafeEqual(a, b)) throw new AppError('FORBIDDEN');
    const expiry = await runExpirySweep();
    return ok({ ...expiry, ...(await runMarketSweep()), reminders: await runReminderSweep() });
  } catch (error) {
    return fail(error);
  }
}
