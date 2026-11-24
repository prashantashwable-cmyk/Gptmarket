import { NextResponse } from 'next/server';
import { AppError } from '@/lib/errors';
import { fail, ok } from '@/server/api';
import { handleRazorpayWebhook } from '@/server/services/aiec-contract';

/**
 * Razorpay payment webhook for AIEC invoices – AWAITING CONFIGURATION. It refuses every request until
 * RAZORPAY_WEBHOOK_SECRET is set after merchant onboarding. Signature: `X-Razorpay-Signature`
 * (HMAC-SHA256 of the raw body). Only this server-side path, never the browser, can verify a gateway payment.
 */
export async function POST(request: Request) {
  try {
    const raw = await request.text();
    return ok(await handleRazorpayWebhook(raw, request.headers.get('x-razorpay-signature'), request.headers.get('x-razorpay-event-id')));
  } catch (error) {
    if (error instanceof AppError && error.code === 'GATEWAY_NOT_CONFIGURED') {
      return NextResponse.json({ ok: false, error: { code: 'GATEWAY_NOT_CONFIGURED' } }, { status: 503 });
    }
    return fail(error instanceof SyntaxError ? new AppError('VALIDATION') : error);
  }
}
