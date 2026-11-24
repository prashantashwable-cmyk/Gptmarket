import { NextResponse } from 'next/server';
import { AppError } from '@/lib/errors';
import { getSessionUser } from '@/server/auth';
import { getMarketQuotation } from '@/server/services/market-quotes';
import { renderQuotationPdf } from '@/server/services/quotation-pdf';

/** Quotation PDF for its customer or AIEC staff. Generated from the immutable version snapshot. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionUser();
  if (!ctx) return NextResponse.json({ ok: false, error: { code: 'UNAUTHENTICATED' } }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: { code: 'NOT_FOUND' } }, { status: 404 });
  try {
    const { quotation, current, versions, approvals } = await getMarketQuotation(ctx, id);
    const wanted = new URL(request.url).searchParams.get('version');
    const version = (wanted ? versions.find((v) => String(v.version_no) === wanted) : current) ?? null;
    if (!version) throw new AppError('NOT_FOUND');
    const bytes = await renderQuotationPdf(quotation, version, approvals);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${quotation.quotation_number}-v${version.version_no}.pdf"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ ok: false, error: { code: 'NOT_FOUND' } }, { status: 404 });
    throw error;
  }
}
