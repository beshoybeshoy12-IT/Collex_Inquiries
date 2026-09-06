/**
 * The default report template.
 *
 * Handlebars, rendered to HTML and then to PDF by headless Chromium. Seeded as
 * a `ReportTemplate` row so a tenant can edit it from the UI — this file is the
 * starting point, not the runtime source.
 *
 * ARABIC PDF OUTPUT IS THE HARD PART, and three things make it work:
 *
 *  1. `direction: rtl` on the page, with `dir="auto"` on individual values so a
 *     Latin-script name inside an Arabic document still reads left to right.
 *  2. A real Unicode Arabic font with the shaping tables. `Noto Naskh Arabic`
 *     via Google Fonts, with system Arabic faces behind it — Chromium does the
 *     shaping and ligatures itself, which is exactly why the PDF is rendered by
 *     a browser rather than assembled by a PDF library. Libraries that draw
 *     glyph by glyph produce disconnected Arabic letters, which is the classic
 *     failure of Arabic PDF generation.
 *  3. `unicode-bidi: isolate` on mixed-content cells, so a phone number next to
 *     Arabic text does not have its digits reordered.
 *
 * The template is bilingual by construction: every label is printed in both
 * languages, and `{{#if isBilingual}}` blocks add the second language's value
 * where the content itself differs.
 */

export const DEFAULT_REPORT_CSS = `
  @page { size: A4; margin: 0; }

  :root {
    --ink: #111827;
    --muted: #6b7280;
    --line: #e5e7eb;
    --accent: #1d4ed8;
    --wash: #f9fafb;
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    direction: rtl;
    font-family: 'Noto Naskh Arabic', 'Amiri', 'Segoe UI', 'Tahoma', sans-serif;
    font-size: 11px;
    line-height: 1.7;
    color: var(--ink);
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .page { padding: 18mm 14mm; }

  /* Header */
  .masthead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding-bottom: 12px;
    border-bottom: 2px solid var(--accent);
  }
  .masthead__logo { height: 46px; width: auto; object-fit: contain; }
  .masthead__org { font-size: 15px; font-weight: 700; }
  .masthead__meta { font-size: 10px; color: var(--muted); text-align: left; }

  .title {
    margin: 14px 0 4px;
    font-size: 17px;
    font-weight: 700;
    text-align: center;
  }
  .title__en {
    margin: 0 0 14px;
    font-size: 11px;
    font-weight: 400;
    color: var(--muted);
    text-align: center;
    direction: ltr;
  }

  /* Section */
  .section { margin-top: 14px; break-inside: avoid; }
  .section__head {
    background: var(--wash);
    border-right: 3px solid var(--accent);
    padding: 5px 9px;
    font-weight: 700;
    font-size: 12px;
    display: flex;
    justify-content: space-between;
  }
  .section__head small { font-weight: 400; color: var(--muted); direction: ltr; }

  /* Field grid */
  table.fields { width: 100%; border-collapse: collapse; margin-top: 6px; }
  table.fields td { padding: 5px 8px; border: 1px solid var(--line); vertical-align: top; }
  td.label { width: 26%; background: var(--wash); font-weight: 600; }
  td.label small { display: block; font-weight: 400; color: var(--muted); font-size: 9px; direction: ltr; }
  /* Isolation stops a Latin name or a phone number being reordered by the
     surrounding right-to-left context. */
  td.value { unicode-bidi: isolate; }
  .empty { color: var(--muted); }

  /* Evidence */
  .photos { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  figure.photo { width: 31%; margin: 0; break-inside: avoid; }
  figure.photo img {
    width: 100%; height: 120px; object-fit: cover;
    border: 1px solid var(--line); border-radius: 3px;
  }
  figure.photo figcaption {
    font-size: 8.5px; color: var(--muted); margin-top: 3px; text-align: center;
  }

  /* Result banner */
  .verdict {
    margin-top: 14px; padding: 9px 12px; border-radius: 4px;
    font-weight: 700; text-align: center; font-size: 13px;
  }
  .verdict--positive { background: #dcfce7; color: #166534; }
  .verdict--negative { background: #fee2e2; color: #991b1b; }
  .verdict--neutral  { background: #fef3c7; color: #92400e; }

  /* Signatures */
  .signatures { display: flex; gap: 24px; margin-top: 22px; break-inside: avoid; }
  .signature { flex: 1; text-align: center; }
  .signature__line { border-top: 1px solid var(--ink); margin-top: 38px; padding-top: 4px; font-size: 10px; }
  .signature img { height: 46px; object-fit: contain; }

  /* Footer */
  .footer {
    margin-top: 20px; padding-top: 8px; border-top: 1px solid var(--line);
    font-size: 8.5px; color: var(--muted);
    display: flex; justify-content: space-between; align-items: flex-end; gap: 12px;
  }
  .footer__qr { height: 62px; width: 62px; }
  .disclaimer { font-size: 8.5px; color: var(--muted); margin-top: 8px; line-height: 1.5; }

  /* Watermark */
  .watermark {
    position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
    font-size: 76px; font-weight: 800; color: rgba(17, 24, 39, 0.07);
    transform: rotate(-32deg); pointer-events: none; z-index: 0;
  }
  .page { position: relative; z-index: 1; }
`;

export const DEFAULT_REPORT_BODY = `
{{#if showWatermark}}<div class="watermark">{{watermarkText}}</div>{{/if}}

<div class="page">
  <header class="masthead">
    <div>
      {{#if showLogo}}{{#if tenant.logoUrl}}
        <img class="masthead__logo" src="{{tenant.logoUrl}}" alt="" />
      {{/if}}{{/if}}
      <div class="masthead__org">{{tenant.nameAr}}</div>
      <div class="masthead__meta" dir="ltr">{{tenant.nameEn}}</div>
    </div>
    <div class="masthead__meta">
      <div><strong>{{investigation.caseNumber}}</strong></div>
      <div>{{formatDate generatedAt}}</div>
      {{#if report.version}}<div>Report v{{report.version}}</div>{{/if}}
    </div>
  </header>

  <h1 class="title">تقرير استعلام ميداني — {{investigationType.nameAr}}</h1>
  <p class="title__en">Field Investigation Report — {{investigationType.nameEn}}</p>

  {{#if investigation.result}}
  <div class="verdict verdict--{{verdictClass}}">
    {{resultLabelAr}} / {{resultLabelEn}}
  </div>
  {{/if}}

  <section class="section">
    <div class="section__head">بيانات الطلب <small>Request Details</small></div>
    <table class="fields">
      <tr>
        <td class="label">رقم الحالة<small>Case Number</small></td>
        <td class="value" dir="auto">{{investigation.caseNumber}}</td>
        <td class="label">رقم الطلب<small>Application No.</small></td>
        <td class="value" dir="auto">{{blank investigation.applicationNumber}}</td>
      </tr>
      <tr>
        <td class="label">المنتج<small>Product</small></td>
        <td class="value">{{product.nameAr}} / {{product.nameEn}}</td>
        <td class="label">نوع الاستعلام<small>Investigation Type</small></td>
        <td class="value">{{investigationType.nameAr}}</td>
      </tr>
      <tr>
        <td class="label">تاريخ الطلب<small>Requested</small></td>
        <td class="value">{{formatDate investigation.createdAt}}</td>
        <td class="label">تاريخ الإنجاز<small>Completed</small></td>
        <td class="value">{{formatDate investigation.completedAt}}</td>
      </tr>
    </table>
  </section>

  <section class="section">
    <div class="section__head">بيانات العميل <small>Customer Details</small></div>
    <table class="fields">
      <tr>
        <td class="label">الاسم<small>Full Name</small></td>
        <td class="value" dir="auto">{{customer.fullName}}</td>
        <td class="label">الرقم القومي<small>National ID</small></td>
        <td class="value" dir="ltr">{{blank customer.nationalId}}</td>
      </tr>
      <tr>
        <td class="label">الموبايل<small>Mobile</small></td>
        <td class="value" dir="ltr">{{blank customer.mobile}}</td>
        <td class="label">تليفون المنزل<small>Home Phone</small></td>
        <td class="value" dir="ltr">{{blank customer.homePhone}}</td>
      </tr>
      <tr>
        <td class="label">عنوان السكن<small>Residence</small></td>
        <td class="value" colspan="3" dir="auto">{{blank investigation.addressLine}}</td>
      </tr>
      <tr>
        <td class="label">المحافظة<small>Governorate</small></td>
        <td class="value">{{blank governorate.nameAr}}</td>
        <td class="label">المدينة<small>City</small></td>
        <td class="value">{{blank city.nameAr}}</td>
      </tr>
    </table>
  </section>

  {{#if customer.workplaceName}}
  <section class="section">
    <div class="section__head">بيانات العمل <small>Workplace</small></div>
    <table class="fields">
      <tr>
        <td class="label">جهة العمل<small>Employer</small></td>
        <td class="value" dir="auto">{{customer.workplaceName}}</td>
        <td class="label">المسمى الوظيفي<small>Job Title</small></td>
        <td class="value" dir="auto">{{blank customer.jobTitle}}</td>
      </tr>
      <tr>
        <td class="label">عنوان العمل<small>Work Address</small></td>
        <td class="value" colspan="3" dir="auto">{{blank customer.workplaceAddress}}</td>
      </tr>
    </table>
  </section>
  {{/if}}

  {{#each answerSections}}
  <section class="section">
    <div class="section__head">{{this.titleAr}} <small>{{this.titleEn}}</small></div>
    <table class="fields">
      {{#each this.rows}}
      <tr>
        <td class="label">{{this.labelAr}}<small>{{this.labelEn}}</small></td>
        <td class="value" colspan="3" dir="auto">{{blank this.value}}</td>
      </tr>
      {{/each}}
    </table>
  </section>
  {{/each}}

  {{#if photos.length}}
  <section class="section">
    <div class="section__head">الأدلة المصورة <small>Photographic Evidence</small></div>
    <div class="photos">
      {{#each photos}}
      <figure class="photo">
        <img src="{{this.dataUri}}" alt="" />
        <figcaption>{{this.categoryAr}} — {{this.categoryEn}}</figcaption>
      </figure>
      {{/each}}
    </div>
  </section>
  {{/if}}

  {{#if gpsEvents.length}}
  <section class="section">
    <div class="section__head">إثبات الموقع <small>GPS Evidence</small></div>
    <table class="fields">
      <tr>
        <td class="label">الحدث<small>Event</small></td>
        <td class="label">الإحداثيات<small>Coordinates</small></td>
        <td class="label">الدقة<small>Accuracy</small></td>
        <td class="label">الوقت<small>Recorded</small></td>
      </tr>
      {{#each gpsEvents}}
      <tr>
        <td class="value">{{this.eventType}}</td>
        <td class="value" dir="ltr">{{this.lat}}, {{this.lng}}</td>
        <td class="value" dir="ltr">{{blank this.accuracyM}} m</td>
        <td class="value">{{formatDateTime this.recordedAt}}</td>
      </tr>
      {{/each}}
    </table>
  </section>
  {{/if}}

  <section class="section">
    <div class="section__head">بيانات الاستعلام <small>Investigation Details</small></div>
    <table class="fields">
      <tr>
        <td class="label">الباحث الميداني<small>Field Investigator</small></td>
        <td class="value" dir="auto">{{blank investigator.fullName}}</td>
        <td class="label">كود الباحث<small>Employee Code</small></td>
        <td class="value" dir="ltr">{{blank investigator.employeeCode}}</td>
      </tr>
      <tr>
        <td class="label">تاريخ الزيارة<small>Visit Date</small></td>
        <td class="value">{{formatDateTime investigation.onSiteAt}}</td>
        <td class="label">تاريخ التسليم<small>Submitted</small></td>
        <td class="value">{{formatDateTime investigation.submittedAt}}</td>
      </tr>
      {{#if qc}}
      <tr>
        <td class="label">مراجعة الجودة<small>QC Decision</small></td>
        <td class="value">{{qc.decision}}</td>
        <td class="label">تاريخ المراجعة<small>Reviewed</small></td>
        <td class="value">{{formatDateTime qc.reviewedAt}}</td>
      </tr>
      {{/if}}
    </table>
  </section>

  <div class="signatures">
    <div class="signature">
      {{#if signatureDataUri}}<img src="{{signatureDataUri}}" alt="" />{{/if}}
      <div class="signature__line">توقيع الباحث الميداني<br /><small>Field Investigator</small></div>
    </div>
    <div class="signature">
      <div class="signature__line">اعتماد مسؤول الجودة<br /><small>Quality Control</small></div>
    </div>
  </div>

  {{#if disclaimerAr}}
  <p class="disclaimer">{{disclaimerAr}}</p>
  {{/if}}
  {{#if disclaimerEn}}
  <p class="disclaimer" dir="ltr">{{disclaimerEn}}</p>
  {{/if}}

  <footer class="footer">
    <div>
      <div>{{tenant.nameAr}} — {{tenant.nameEn}}</div>
      <div dir="ltr">{{blank tenant.phone}} · {{blank tenant.email}}</div>
      <div>تم إنشاء هذا التقرير آليًا في {{formatDateTime generatedAt}}</div>
      <div dir="ltr">Generated automatically · {{investigation.caseNumber}}</div>
    </div>
    {{#if qrDataUri}}<img class="footer__qr" src="{{qrDataUri}}" alt="" />{{/if}}
  </footer>
</div>
`;

export const DEFAULT_DISCLAIMER_AR =
  'هذا التقرير سري ومُعد لاستخدام الجهة الطالبة فقط، ويستند إلى المعاينة ' +
  'الميدانية والمعلومات المتاحة وقت الزيارة. لا يجوز إعادة نشره أو استخدامه ' +
  'لأي غرض آخر دون إذن كتابي.';

export const DEFAULT_DISCLAIMER_EN =
  'This report is confidential and prepared solely for the requesting party. ' +
  'It reflects the field visit and the information available at the time of ' +
  'that visit. It may not be redistributed or used for any other purpose ' +
  'without written permission.';
