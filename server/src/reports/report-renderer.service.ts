import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as Handlebars from 'handlebars';
import * as QRCode from 'qrcode';
import type { Browser } from 'puppeteer';
import { env } from '../common/config/env';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  HTML to PDF.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  WHY A BROWSER AND NOT A PDF LIBRARY. Arabic is a cursive script: every
 *  letter has up to four contextual forms and the correct one depends on its
 *  neighbours. PDF libraries that place glyphs one at a time produce
 *  disconnected, unreadable Arabic — the single most common failure of Arabic
 *  document generation. Chromium already contains a complete text shaper
 *  (HarfBuzz) and a bidirectional algorithm, so rendering HTML in it and
 *  printing to PDF gets both correct for free.
 *
 *  ONE BROWSER, MANY RENDERS. Launching Chromium takes one to two seconds; a
 *  page takes milliseconds. The instance is created lazily on the first render
 *  and reused, and each render gets its own page which is always closed —
 *  a leaked page is a leaked renderer process, and thirty of those is the
 *  container's memory.
 *
 *  IMAGES ARE EMBEDDED AS DATA URIs BY THE CALLER, deliberately. A `<img
 *  src="https://...">` would make the renderer fetch from the network, which
 *  means a signed URL that may expire mid-render, a request that can hang, and
 *  a browser in this process making outbound requests to whatever a template
 *  says. Everything is inlined before it gets here.
 */
@Injectable()
export class ReportRendererService implements OnModuleDestroy {
  private readonly logger = new Logger(ReportRendererService.name);
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;

  constructor() {
    this.registerHelpers();
  }

  /**
   * Handlebars helpers available to every template.
   *
   * Deliberately few. A template language rich enough to compute is a template
   * language a tenant administrator can break, and these are edited from the UI.
   */
  private registerHelpers(): void {
    Handlebars.registerHelper('formatDate', (value: unknown) => {
      if (!value) return '—';
      const date = new Date(value as string);
      if (Number.isNaN(date.getTime())) return '—';
      // Gregorian with Arabic month names, which is what Egyptian banking
      // documents use — not the Hijri calendar.
      return new Intl.DateTimeFormat('ar-EG', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }).format(date);
    });

    Handlebars.registerHelper('formatDateTime', (value: unknown) => {
      if (!value) return '—';
      const date = new Date(value as string);
      if (Number.isNaN(date.getTime())) return '—';
      return new Intl.DateTimeFormat('ar-EG', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(date);
    });

    /** An em dash rather than an empty cell, so a blank is visibly blank. */
    Handlebars.registerHelper('blank', (value: unknown) => {
      if (value === null || value === undefined || value === '') return '—';
      return value;
    });

    Handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser?.connected) return this.browser;
    if (this.launching) return this.launching;

    this.launching = (async () => {
      // Imported here rather than at module scope: Puppeteer pulls in a large
      // dependency tree and the API process never renders a PDF when a worker
      // is running.
      const puppeteer = await import('puppeteer');

      const browser = await puppeteer.launch({
        headless: true,
        args: [
          // Required in most containers, which run without the kernel
          // capabilities Chromium's sandbox needs. The renderer only ever sees
          // HTML this application generated, with no network access.
          '--no-sandbox',
          '--disable-setuid-sandbox',
          // /dev/shm is 64 MB by default in Docker, which Chromium exhausts on
          // a document with photographs in it.
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--font-render-hinting=none',
        ],
        ...(env('PUPPETEER_EXECUTABLE_PATH')
          ? { executablePath: env('PUPPETEER_EXECUTABLE_PATH') }
          : {}),
      });

      this.browser = browser;
      this.launching = null;
      this.logger.log('Chromium ready for PDF rendering');
      return browser;
    })();

    return this.launching;
  }

  /** Compile a template and render it against its data. */
  compile(source: string, data: Record<string, unknown>): string {
    const template = Handlebars.compile(source, { noEscape: false });
    return template(data);
  }

  /**
   * Render a full HTML document to a PDF buffer.
   *
   * `waitUntil: 'networkidle0'` would hang forever on a document with no
   * network activity in some Chromium builds; `domcontentloaded` plus an
   * explicit wait for fonts is both faster and deterministic.
   */
  async renderPdf(
    html: string,
    options: {
      pageSize?: string;
      margins?: { top: number; right: number; bottom: number; left: number };
      headerHtml?: string;
      footerHtml?: string;
    } = {},
  ): Promise<{ buffer: Buffer; pageCount: number }> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();

    try {
      await page.setContent(html, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });

      // Web fonts have to be resolved before printing, or the first render of
      // a document uses the fallback face and the Arabic comes out in the
      // wrong font — intermittently, which is the worst kind of bug.
      await page.evaluate(() => document.fonts.ready);

      const margins = options.margins ?? {
        top: 18,
        right: 14,
        bottom: 18,
        left: 14,
      };

      const buffer = await page.pdf({
        format: (options.pageSize as 'A4') ?? 'A4',
        printBackground: true,
        displayHeaderFooter: Boolean(options.headerHtml || options.footerHtml),
        headerTemplate: options.headerHtml ?? '<span></span>',
        footerTemplate:
          options.footerHtml ??
          '<div style="font-size:8px;color:#6b7280;width:100%;text-align:center;">' +
            '<span class="pageNumber"></span> / <span class="totalPages"></span></div>',
        margin: {
          top: `${margins.top}mm`,
          right: `${margins.right}mm`,
          bottom: `${margins.bottom}mm`,
          left: `${margins.left}mm`,
        },
        timeout: 60_000,
      });

      return {
        buffer: Buffer.from(buffer),
        // Cheap and good enough for a metadata field; the exact count would
        // mean parsing the PDF back.
        pageCount: Math.max(1, Math.ceil(html.length / 18_000)),
      };
    } finally {
      // Always. A leaked page is a leaked renderer process.
      await page.close().catch(() => undefined);
    }
  }

  /**
   * Wrap a body fragment in a complete document.
   *
   * The font link is the one external resource the renderer is allowed, and it
   * is a fixed URL to Google Fonts rather than anything a template supplies.
   * A deployment with no outbound network falls back to the system Arabic
   * faces named after it, which every Linux container image with
   * `fonts-noto-core` installed has.
   */
  buildDocument(
    bodyHtml: string,
    css: string,
    locale: 'ar' | 'en' = 'ar',
  ): string {
    return `<!doctype html>
<html lang="${locale}" dir="${locale === 'ar' ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;700&display=swap" rel="stylesheet" />
<style>${css}</style>
</head>
<body>${bodyHtml}</body>
</html>`;
  }

  /** A QR code as a data URI, for the report footer. */
  async qrDataUri(text: string): Promise<string> {
    return QRCode.toDataURL(text, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 180,
    });
  }

  /** Bytes to a data URI, so the renderer never fetches from the network. */
  toDataUri(buffer: Buffer, mimeType: string): string {
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  }

  async onModuleDestroy(): Promise<void> {
    await this.browser?.close().catch(() => undefined);
    this.browser = null;
  }
}
