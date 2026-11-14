// Printable HTML documents for the dispatch reader and the conduct summary.
// expo-print renders the string in a headless WebView, so the builders return
// complete standalone documents: inline styles only, no external assets.

import { htmlToPlainText, isHtmlBody } from './rich-text';
import type { ConductModel, ConductTerm } from './records-model';
import type { NoticeAttachment } from './content-rules';

const escapeHtml = (value: string | null | undefined): string =>
  (value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * Allowlist sanitizer for notice bodies: the iOS print WebView runs JavaScript,
 * so anything off the structural allowlist — active elements, event-handler
 * attributes, non-http(s) links — is removed rather than escaped. Historical
 * bodies were not sanitized at write time, so the filter must be strict here.
 */
const ALLOWED_TAGS = new Set([
  'a', 'b', 'strong', 'i', 'em', 'u', 's', 'span', 'code', 'mark', 'small', 'sub', 'sup',
  'p', 'br', 'hr', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'pre', 'div', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'caption', 'details', 'summary', 'section', 'article',
]);
const DROP_WITH_CONTENTS =
  /<\s*(script|style|iframe|object|embed|svg|math|form|textarea|select|button|input|link|meta|base|title|template|noscript)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;
const DROPPED_TAGS =
  /<\s*\/?\s*(script|style|iframe|object|embed|svg|math|form|textarea|select|button|input|link|meta|base|title|template|noscript)\b[^>]*>/gi;

const sanitizeTag = (raw: string): string => {
  const match = /^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9-]*)/.exec(raw);
  if (!match) return '';
  const name = match[2].toLowerCase();
  if (!ALLOWED_TAGS.has(name)) return '';
  if (match[1] === '/') return `</${name}>`;
  if (name === 'details') return '<details open>'; // print always expands collapsed sections
  if (name === 'a') {
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(raw);
    const url = (href?.[1] ?? href?.[2] ?? href?.[3] ?? '').trim();
    return /^https?:\/\//i.test(url) ? `<a href="${escapeHtml(url)}">` : '<a>';
  }
  return `<${name}>`;
};

const sanitizeBodyHtml = (html: string): string =>
  html
    .replace(DROP_WITH_CONTENTS, '')
    .replace(DROPPED_TAGS, '')
    .replace(/<[^<>]*>/g, (tag) => sanitizeTag(tag));

const bodyMarkup = (body: string | null | undefined): string => {
  if (!body) return '';
  if (isHtmlBody(body)) {
    return `<div class="rich">${sanitizeBodyHtml(body)}</div>`;
  }
  return escapeHtml(htmlToPlainText(body))
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, '<br/>')}</p>`)
    .join('');
};

const BASE_STYLES = `
  body { font-family: "Times New Roman", "Noto Serif", serif; color: #111; margin: 0; padding: 24px; font-size: 14px; line-height: 1.5; }
  .meta { color: #444; }
  .doc-header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 1px solid #999; padding-bottom: 12px; }
  .issuer { display: flex; gap: 12px; max-width: 62%; }
  .issuer-lines { display: flex; flex-direction: column; gap: 2px; }
  .unit { font-weight: bold; font-size: 12px; text-transform: uppercase; }
  .small { font-size: 11px; }
  .motto { text-align: center; font-size: 12px; max-width: 34%; }
  .motto .rule { border-bottom: 1px solid #111; width: 60%; margin: 4px auto; }
  .notice-title { text-align: center; font-size: 18px; font-weight: bold; margin: 20px 0 4px; }
  .subject { text-align: center; font-size: 15px; font-weight: bold; text-transform: uppercase; margin-bottom: 16px; }
  .salutation { margin: 8px 0; }
  .meta-line { font-size: 12px; color: #333; margin-bottom: 12px; }
  .rich { margin: 12px 0; }
  .rich p, p { margin: 0 0 10px; }
  .attachments { border-top: 1px dashed #999; margin-top: 16px; padding-top: 8px; font-size: 12px; }
  .attachments ul { margin: 4px 0 0; padding-left: 18px; }
  .signoff { margin-top: 32px; text-align: right; font-size: 13px; }
  .signoff .who { font-weight: bold; text-transform: uppercase; margin-top: 2px; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0 16px; font-size: 12px; }
  th, td { border: 1px solid #999; padding: 5px 8px; text-align: left; }
  th { background: #eee; }
  .right { text-align: right; }
  .doc-title { text-align: center; font-size: 18px; font-weight: bold; margin-bottom: 4px; }
  .doc-sub { text-align: center; font-size: 12px; color: #333; margin-bottom: 16px; }
  h2.section { font-size: 13px; text-transform: uppercase; margin: 18px 0 6px; border-bottom: 1px solid #ccc; padding-bottom: 3px; }
`;

const document = (title: string, inner: string): string =>
  `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${escapeHtml(title)}</title><style>${BASE_STYLES}</style></head><body>${inner}</body></html>`;

export interface DispatchPrintData {
  title: string;
  ministryName: string;
  universityName: string;
  publisherName: string;
  nationalMotto1: string;
  nationalMotto2: string;
  dateLine: string;
  docRef: string;
  noticeHeader: string;
  subjectHeading: string;
  salutationLabel: string;
  salutationTarget: string;
  metaLine: string;
  body: string | null;
  attachmentsHeading: string | null;
  attachments: NoticeAttachment[];
  issuedByLabel: string;
  signOffText: string;
}

/** Official dispatch layout mirroring the web AdministrativeDispatchSheet. */
export function dispatchPrintHtml(data: DispatchPrintData): string {
  const attachments = data.attachments.length === 0 ? '' : `
    <div class="attachments">
      ${data.attachmentsHeading ? `<strong>${escapeHtml(data.attachmentsHeading)}</strong>` : ''}
      <ul>${data.attachments.map((file) => `<li>${escapeHtml(file.name)}</li>`).join('')}</ul>
    </div>`;
  return document(data.title, `
    <div class="doc-header">
      <div class="issuer">
        <div class="issuer-lines">
          <span class="small">${escapeHtml(data.ministryName)}</span>
          <span class="unit">${escapeHtml(data.universityName)}</span>
          <span class="unit">${escapeHtml(data.publisherName)}</span>
          <span class="small meta">${escapeHtml(data.docRef)}</span>
        </div>
      </div>
      <div class="motto">
        <div><strong>${escapeHtml(data.nationalMotto1)}</strong></div>
        <div>${escapeHtml(data.nationalMotto2)}</div>
        <div class="rule"></div>
        <div class="small">${escapeHtml(data.dateLine)}</div>
      </div>
    </div>
    <div class="notice-title">${escapeHtml(data.noticeHeader)}</div>
    <div class="subject">${escapeHtml(data.subjectHeading)}</div>
    <div class="salutation">${escapeHtml(data.salutationLabel)}: ${escapeHtml(data.salutationTarget)}</div>
    <div class="meta-line">${escapeHtml(data.metaLine)}</div>
    ${bodyMarkup(data.body)}
    ${attachments}
    <div class="signoff">
      <div>${escapeHtml(data.issuedByLabel)}</div>
      <div class="who">${escapeHtml(data.publisherName)}</div>
      <div class="small meta">${escapeHtml(data.signOffText)}</div>
    </div>`);
}

export interface ConductPrintData {
  title: string;
  universityName: string;
  generatedLabel: string;
  generatedAt: string;
  studentName: string | null;
  studentCode: string | null;
  studentLabel: string;
  codeLabel: string;
  term: ConductTerm | null;
  semesterLabel: string;
  totalLabel: string;
  rankLabel: string;
  statusLabel: string;
  historySemesterLabel: string;
  historyRankLabel: string;
  historyStatusLabel: string;
  evaluatorLabel: string;
  criteriaHeading: string;
  scoreUnit: string;
  reachedLabel: string;
  activitiesHeading: string;
  pointsLabel: string;
  cumulativeLabel: string;
  cumulativeScore: string;
  cumulativeRankLabel: string;
  model: ConductModel;
  criterionName: (code: string, nameVi: string | null | undefined, nameEn: string | null | undefined) => string;
  formatNumber: (value: number | null | undefined, options?: { maximumFractionDigits?: number }) => string;
}

/** Conduct summary: student identity, the selected term's criteria, and history. */
export function conductPrintHtml(data: ConductPrintData): string {
  const { term } = data;
  const studentLine = [
    data.studentName ? `${data.studentLabel}: ${data.studentName}` : null,
    data.studentCode ? `${data.codeLabel}: ${data.studentCode}` : null,
  ].filter(Boolean).map(escapeHtml).join(' &nbsp;·&nbsp; ');

  const termSection = term ? `
    <h2 class="section">${escapeHtml(data.semesterLabel)}</h2>
    <p>
      <strong>${escapeHtml(data.totalLabel)}:</strong> ${escapeHtml(data.formatNumber(term.totalScore, { maximumFractionDigits: 1 }))} / 100
      &nbsp;·&nbsp; <strong>${escapeHtml(data.rankLabel)}</strong>
      ${term.status ? `&nbsp;·&nbsp; ${escapeHtml(data.statusLabel)}` : ''}
      ${term.evaluatorName ? `&nbsp;·&nbsp; ${escapeHtml(data.evaluatorLabel)}: ${escapeHtml(term.evaluatorName)}` : ''}
    </p>
    ${term.criteria.length === 0 ? '' : `
    <table>
      <thead><tr><th>#</th><th>${escapeHtml(data.criteriaHeading)}</th><th class="right">${escapeHtml(data.scoreUnit)}</th></tr></thead>
      <tbody>
        ${term.criteria.map((criterion, index) => {
          const name = data.criterionName(criterion.code, criterion.nameVi, criterion.nameEn);
          const ratio = criterion.maxScore > 0 ? Math.round((criterion.score / criterion.maxScore) * 100) : 0;
          return `<tr><td>${index + 1}</td><td>${escapeHtml(name)}${criterion.description ? `<br/><span class="meta">${escapeHtml(criterion.description)}</span>` : ''}</td><td class="right">${escapeHtml(data.formatNumber(criterion.score))} / ${escapeHtml(data.formatNumber(criterion.maxScore))} (${data.reachedLabel} ${ratio}%)</td></tr>`;
        }).join('')}
      </tbody>
    </table>`}
    ${term.activities.length === 0 ? '' : `
    <h2 class="section">${escapeHtml(data.activitiesHeading)}</h2>
    <table>
      <thead><tr><th>#</th><th></th><th class="right">${escapeHtml(data.pointsLabel)}</th></tr></thead>
      <tbody>
        ${term.activities.map((activity, index) => `
          <tr><td>${index + 1}</td><td>${escapeHtml(activity.title)}${[activity.category, activity.organizer, activity.activityDate].filter(Boolean).length ? `<br/><span class="meta">${escapeHtml([activity.category, activity.organizer, activity.activityDate].filter(Boolean).join(' · '))}</span>` : ''}</td><td class="right">${activity.points == null ? '—' : escapeHtml(data.formatNumber(activity.points))}</td></tr>`).join('')}
      </tbody>
    </table>`}` : '';

  const historySection = data.model.terms.length === 0 ? '' : `
    <h2 class="section">${escapeHtml(data.cumulativeLabel)}: ${escapeHtml(data.cumulativeScore)} &nbsp;·&nbsp; ${escapeHtml(data.cumulativeRankLabel)}</h2>
    <table>
      <thead><tr><th>${escapeHtml(data.historySemesterLabel)}</th><th class="right">${escapeHtml(data.totalLabel)}</th><th>${escapeHtml(data.historyRankLabel)}</th><th>${escapeHtml(data.historyStatusLabel)}</th></tr></thead>
      <tbody>
        ${data.model.terms.map((entry) => `
          <tr><td>${escapeHtml(entry.semesterName)}</td><td class="right">${entry.totalScore == null ? '—' : escapeHtml(data.formatNumber(entry.totalScore))}</td><td>${escapeHtml(entry.classificationVi ?? entry.classification ?? '—')}</td><td>${escapeHtml(entry.status ?? '—')}</td></tr>`).join('')}
      </tbody>
    </table>`;

  return document(data.title, `
    <div class="doc-title">${escapeHtml(data.universityName)}</div>
    <div class="doc-sub">${escapeHtml(data.generatedLabel)}: ${escapeHtml(data.generatedAt)}</div>
    ${studentLine ? `<p><strong>${studentLine}</strong></p>` : ''}
    ${termSection}
    ${historySection}`);
}
