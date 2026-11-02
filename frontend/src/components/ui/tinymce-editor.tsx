'use client';

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Check,
  Copy,
  Download,
  Eye,
  FileText,
  HelpCircle,
  Loader2,
  RefreshCw,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  MAX_ANNOUNCEMENT_CONTENT_CHARS,
  MAX_INLINE_IMAGES,
  MAX_INLINE_IMAGE_BYTES,
  assessAnnouncementContentLength,
} from '@/lib/announcement-limits';
import { buildDocumentFilename } from '@/lib/editor-document';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { editorSurfacesEn, editorSurfacesVi } from '@/i18n/messages-editor';

// Loading shell rendered while the editor chunk resolves. Locale is picked from
// <html lang> because the dynamic wrapper has no access to the component props.
function EditorLoading({ isVi }: { isVi: boolean }) {
  const copy = isVi ? editorSurfacesVi.tinyMce : editorSurfacesEn.tinyMce;
  return (
    <div className="flex h-96 w-full items-center justify-center rounded-lg border border-border/70 bg-card/60">
      <div className="flex flex-col items-center gap-2 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <span className="text-sm font-medium">
          {copy.initializing}
        </span>
      </div>
    </div>
  );
}

// RT-P3-2: the previous `dynamic()` wrapper only had a `loading` state, so a
// blocked or timed-out editor chunk left an eternal spinner on a flaky campus
// network. The loader below tracks failure and offers a real retry: webpack
// evicts a failed chunk from its cache, so a re-import re-downloads it.
type EditorModuleState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; Editor: React.ComponentType<any> };

let editorModulePromise: Promise<React.ComponentType<any>> | null = null;

function loadEditorModule(): Promise<React.ComponentType<any>> {
  if (editorModulePromise) return editorModulePromise;
  const attempt = import('@tinymce/tinymce-react').then(
    (mod) => mod.Editor as unknown as React.ComponentType<any>,
    (error) => {
      // K3: this module-level cache used to keep the rejected promise forever,
      // so "Retry" re-entered the error branch without ever attempting another
      // import. Dropping the cache lets the next call re-import the chunk (and
      // recover once the network is back).
      editorModulePromise = null;
      throw error;
    },
  );
  editorModulePromise = attempt;
  return attempt;
}

function useEditorModule(): [EditorModuleState, () => void] {
  const [state, setState] = useState<EditorModuleState>({ status: 'loading' });
  const attemptRef = useRef(0);
  const load = useCallback(() => {
    const attempt = ++attemptRef.current;
    setState({ status: 'loading' });
    loadEditorModule().then(
      (Editor) => {
        if (attemptRef.current === attempt) setState({ status: 'ready', Editor });
      },
      () => {
        if (attemptRef.current === attempt) setState({ status: 'error' });
      },
    );
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  return [state, load];
}

function EditorLoadError({ isVi, onRetry }: { isVi: boolean; onRetry: () => void }) {
  const copy = isVi ? editorSurfacesVi.tinyMce : editorSurfacesEn.tinyMce;
  return (
    <div
      role="alert"
      className="flex h-96 w-full flex-col items-center justify-center gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center"
    >
      <TriangleAlert className="h-8 w-8 text-status-danger-foreground" aria-hidden="true" />
      <p className="max-w-md text-sm font-medium text-foreground">
        {copy.loadError}
      </p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry} className="gap-1.5">
        <RefreshCw className="h-3.5 w-3.5" />
        {copy.retry}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// K6: TinyMCE autosave draft hygiene
// ---------------------------------------------------------------------------

/** Must stay in sync with the `autosave_prefix` used in `init` below. */
const AUTOSAVE_KEY_PREFIX = 'campuscore-tinymce-';

/**
 * Removes the drafts the autosave plugin keeps in localStorage (the `<prefix>…draft`
 * and `…time` entries). The studio calls this when the author discards a
 * document — New Document, Cancel edit, or closing the quick-edit modal — so a
 * discarded body cannot be pulled back with File → Restore last draft. Drafts
 * left by a crash or a closed tab are untouched and stay reachable through that
 * same menu item.
 */
export function clearTinyMceAutosaveDrafts(editorId?: string): void {
  if (typeof window === 'undefined' || !editorId) return;
  try {
    const storage = window.localStorage;
    // Match TinyMCE's path/query/id expansion. A modal discard must not erase
    // the recovery copy belonging to the studio or another editor/route.
    const prefix = `${AUTOSAVE_KEY_PREFIX}${window.location.pathname}${window.location.search}-${editorId}-`;
    storage.removeItem(`${prefix}draft`);
    storage.removeItem(`${prefix}time`);
  } catch {
    // Storage can be unavailable (private mode); nothing to clear then.
  }
}

// ---------------------------------------------------------------------------
// K5: foreign-paste cleanup
// ---------------------------------------------------------------------------

/**
 * True when pasted content must be cleaned. `internal` is TinyMCE's marker for
 * HTML copied out of a TinyMCE editor (this app's two editor instances both set
 * it), so internal paste is left byte-for-byte alone; only external sources —
 * Word, Google Docs, arbitrary web pages — are reduced to what the app renders.
 */
export function shouldCleanForeignPaste(args: { internal?: boolean } | null | undefined): boolean {
  return Boolean(args) && args?.internal !== true;
}

/** Mirror of the backend AnnouncementHtmlSanitizer allowlist: what can render. */
const PASTE_ALLOWED_TAGS = new Set([
  'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'code', 'col', 'colgroup',
  'dd', 'details', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'h1', 'h2',
  'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'li', 'mark', 'ol', 'p', 'pre',
  's', 'small', 'span', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody',
  'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'u', 'ul',
]);

/** Only attributes that carry meaning for the allowed formatting survive. */
const PASTE_ALLOWED_ATTRS = new Set([
  'href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'scope', 'headers',
  'start', 'type', 'datetime', 'width', 'height', 'loading', 'target', 'rel',
]);

const PASTE_DROP_TAGS = new Set([
  'script', 'style', 'meta', 'link', 'title', 'base', 'iframe', 'object',
  'embed', 'form', 'input', 'textarea', 'select', 'button', 'noscript',
  'template', 'svg', 'math', 'canvas', 'video', 'audio', 'source', 'track',
]);

/** The only image MIME types whose base64 src the publish sanitizer keeps. */
const INLINE_IMAGE_MIME_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp',
]);

/**
 * src values that survive the publish sanitizer — mirrors the server's
 * SAFE_IMAGE_URL exactly: anchored base64 payload charset (an invalid payload
 * like `data:image/png;base64,AAA-BBB` is kept client-side but stripped at
 * publish — the parity check makes it vanish at insert instead), relative
 * `./`/`../` paths the reader allowlist permits, and root-relative `/` (but
 * not protocol-relative `//`). `blob:` is tolerated inside the editor only
 * because automatic_uploads replaces it with a data: URI after the upload
 * handler runs; a stray blob: still dies at publish.
 */
const INLINE_IMG_SRC_STRIPPED = /[\u0000-\u0020\u00a0\u2028\u2029]/g;

/**
 * Mirrors AnnouncementHtmlSanitizer: the server strips this control/space set
 * before matching, so the editor normalizes the same way. Java's `\s` is
 * ASCII-only — a U+2007-separated base64 payload would otherwise pass the
 * JS `\s` check and be dropped by the Java check at publish, leaving the
 * author with an image readers never see.
 */
const normalizeInlineImgSrc = (src: string): string =>
  src.replace(INLINE_IMG_SRC_STRIPPED, '').toLowerCase();

const SAFE_INLINE_IMAGE_SRC =
  /^(?:https?:|blob:|data:image\/(?:png|jpe?g|gif|webp|bmp);base64,[a-z0-9+/=]+$|\/(?!\/)|\.{1,2}\/)/;

/**
 * The outbound variant — blob: is tolerated inside the editor because
 * automatic_uploads replaces it with a data: URI once the upload handler
 * runs, but an in-flight upload's blob: src dies at publish, so serialized
 * content must not carry it either.
 */
const PUBLISHABLE_INLINE_IMAGE_SRC =
  /^(?:https?:|data:image\/(?:png|jpe?g|gif|webp|bmp);base64,[a-z0-9+/=]+$|\/(?!\/)|\.{1,2}\/)/;

/** The editor's own callout wrapper classes must survive a copy/paste. */
const PASTE_KEPT_CLASS = /^academic-callout(-|$)/;

/**
 * Walks the pasted fragment and strips foreign-source junk: comments (Word
 * conditional blocks), Office-only elements (`o:p`, `w:*`, …) are removed or
 * unwrapped, `style`/`class`/MSO attributes are dropped, and only the
 * allowlisted formatting above is kept. Basic bold/italic/underline, lists,
 * links, headings and paragraphs are tag-based and survive untouched.
 */
export function cleanForeignPasteTree(root: Element): void {
  const comments: Comment[] = [];
  const commentWalker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  while (commentWalker.nextNode()) comments.push(commentWalker.currentNode as Comment);
  comments.forEach((node) => node.remove());

  const elements = Array.from(root.querySelectorAll('*'));
  for (const element of elements) {
    const tag = element.tagName.toLowerCase();
    if (PASTE_DROP_TAGS.has(tag)) {
      element.remove();
      continue;
    }
    if (!PASTE_ALLOWED_TAGS.has(tag)) {
      // Unwrap unknown wrappers instead of dropping their text.
      const parent = element.parentNode;
      if (!parent) continue;
      while (element.firstChild) parent.insertBefore(element.firstChild, element);
      parent.removeChild(element);
      continue;
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name === 'class') {
        const kept = attribute.value.split(/\s+/).filter((cls) => PASTE_KEPT_CLASS.test(cls));
        if (kept.length > 0) element.setAttribute('class', kept.join(' '));
        else element.removeAttribute('class');
        continue;
      }
      if (!PASTE_ALLOWED_ATTRS.has(name)) element.removeAttribute(attribute.name);
    }
    // An image whose src cannot survive publish (svg/avif data: URIs,
    // javascript:, protocol-relative //host) renders fine in this editing
    // session then breaks for every reader. Drop it at insert time so the
    // author sees it vanish rather than publishing a broken frame.
    if (tag === 'img'
        && !SAFE_INLINE_IMAGE_SRC.test(normalizeInlineImgSrc(element.getAttribute('src') ?? ''))) {
      element.remove();
    }
  }
}

export interface TinyMceEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  height?: number | string;
  disabled?: boolean;
  readOnly?: boolean;
  locale?: 'vi' | 'en';
  id?: string;
  /**
   * Resolved account id that owns this editor's autosave drafts. When set, the
   * editor id gains an owner suffix so the autosave plugin's localStorage keys
   * are namespaced per account: another user's recovery draft can neither
   * hydrate nor be cleared inside this session.
   */
  draftOwnerId?: string;
  /** Document title used for the downloaded file name (K2). */
  documentTitle?: string;
  showTemplates?: boolean;
  showWordCount?: boolean;
  onInit?: (evt: any, editor: any) => void;
}

const TINYMCE_TEMPLATES = [
  {
    id: 'officialNotice',
    contentVi: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1e293b;">
        <div style="text-align: center; border-bottom: 2px solid #0284c7; padding-bottom: 12px; margin-bottom: 20px;">
          <h4 style="margin: 0; text-transform: uppercase; color: #64748b; font-size: 13px; letter-spacing: 1px;">TRƯỜNG ĐẠI HỌC CÔNG NGHỆ KỸ THUẬT TP.HCM</h4>
          <h2 style="margin: 8px 0 0 0; color: #0f172a; font-size: 20px; font-weight: 700;">THÔNG BÁO HỌC VỤ CHÍNH THỨC</h2>
          <p style="margin: 4px 0 0 0; color: #64748b; font-size: 13px;">Số: {{số văn bản}} | {{Học kỳ - Năm học}}</p>
        </div>

        <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 14px 18px; border-radius: 6px; margin-bottom: 20px;">
          <strong style="color: #1d4ed8; font-size: 14px;">Kính gửi:</strong> Toàn thể Giảng viên và Sinh viên các khóa hệ chính quy.
        </div>

        <h3 style="color: #0369a1; font-size: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">1. Kế hoạch chi tiết</h3>
        <table style="width: 100%; border-collapse: collapse; margin-top: 10px; margin-bottom: 20px;">
          <thead>
            <tr style="background-color: #f1f5f9; text-align: left;">
              <th style="border: 1px solid #cbd5e1; padding: 10px; font-weight: 600;">Hạng mục</th>
              <th style="border: 1px solid #cbd5e1; padding: 10px; font-weight: 600;">Thời gian bắt đầu</th>
              <th style="border: 1px solid #cbd5e1; padding: 10px; font-weight: 600;">Thời gian kết thúc</th>
              <th style="border: 1px solid #cbd5e1; padding: 10px; font-weight: 600;">Ghi chú</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="border: 1px solid #cbd5e1; padding: 10px;">{{Hạng mục kế hoạch 1}}</td>
              <td style="border: 1px solid #cbd5e1; padding: 10px;">{{giờ - ngày bắt đầu}}</td>
              <td style="border: 1px solid #cbd5e1; padding: 10px;">{{giờ - ngày kết thúc}}</td>
              <td style="border: 1px solid #cbd5e1; padding: 10px;">{{đối tượng áp dụng}}</td>
            </tr>
            <tr>
              <td style="border: 1px solid #cbd5e1; padding: 10px;">{{Hạng mục kế hoạch 2}}</td>
              <td style="border: 1px solid #cbd5e1; padding: 10px;">{{giờ - ngày bắt đầu}}</td>
              <td style="border: 1px solid #cbd5e1; padding: 10px;">{{giờ - ngày kết thúc}}</td>
              <td style="border: 1px solid #cbd5e1; padding: 10px;">{{đối tượng áp dụng}}</td>
            </tr>
          </tbody>
        </table>

        <div style="background-color: #fefce8; border-left: 4px solid #eab308; padding: 14px 18px; border-radius: 6px; margin-bottom: 20px;">
          <strong style="color: #a16207;">Lưu ý quan trọng:</strong> Sinh viên kiểm tra kỹ điều kiện học phần tiên quyết trước khi nộp đăng ký. Mọi thắc mắc liên hệ Văn phòng Đào tạo A1-101.
        </div>
      </div>
    `,
    contentEn: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1e293b;">
        <div style="text-align: center; border-bottom: 2px solid #0284c7; padding-bottom: 12px; margin-bottom: 20px;">
          <h4 style="margin: 0; text-transform: uppercase; color: #64748b; font-size: 13px; letter-spacing: 1px;">HCMC UNIVERSITY OF TECHNOLOGY AND ENGINEERING</h4>
          <h2 style="margin: 8px 0 0 0; color: #0f172a; font-size: 20px; font-weight: 700;">OFFICIAL ACADEMIC NOTICE</h2>
          <p style="margin: 4px 0 0 0; color: #64748b; font-size: 13px;">No.: {{số văn bản}} | {{Học kỳ - Năm học}}</p>
        </div>

        <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 14px 18px; border-radius: 6px; margin-bottom: 20px;">
          <strong style="color: #1d4ed8; font-size: 14px;">Attention:</strong> All faculty members and full-time students of all cohorts.
        </div>

        <h3 style="color: #0369a1; font-size: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">1. Detailed plan</h3>
        <table style="width: 100%; border-collapse: collapse; margin-top: 10px; margin-bottom: 20px;">
          <thead>
            <tr style="background-color: #f1f5f9; text-align: left;">
              <th style="border: 1px solid #cbd5e1; padding: 10px; font-weight: 600;">Item</th>
              <th style="border: 1px solid #cbd5e1; padding: 10px; font-weight: 600;">Start Time</th>
              <th style="border: 1px solid #cbd5e1; padding: 10px; font-weight: 600;">End Time</th>
              <th style="border: 1px solid #cbd5e1; padding: 10px; font-weight: 600;">Notes</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="border: 1px solid #cbd5e1; padding: 10px;">{{Hạng mục kế hoạch 1}}</td>
              <td style="border: 1px solid #cbd5e1; padding: 10px;">{{giờ - ngày bắt đầu}}</td>
              <td style="border: 1px solid #cbd5e1; padding: 10px;">{{giờ - ngày kết thúc}}</td>
              <td style="border: 1px solid #cbd5e1; padding: 10px;">{{đối tượng áp dụng}}</td>
            </tr>
            <tr>
              <td style="border: 1px solid #cbd5e1; padding: 10px;">{{Hạng mục kế hoạch 2}}</td>
              <td style="border: 1px solid #cbd5e1; padding: 10px;">{{giờ - ngày bắt đầu}}</td>
              <td style="border: 1px solid #cbd5e1; padding: 10px;">{{giờ - ngày kết thúc}}</td>
              <td style="border: 1px solid #cbd5e1; padding: 10px;">{{đối tượng áp dụng}}</td>
            </tr>
          </tbody>
        </table>

        <div style="background-color: #fefce8; border-left: 4px solid #eab308; padding: 14px 18px; border-radius: 6px; margin-bottom: 20px;">
          <strong style="color: #a16207;">Important note:</strong> Students must check the prerequisite requirements carefully before submitting their registration. For any questions, contact the Office of Academic Affairs A1-101.
        </div>
      </div>
    `,
  },
  {
    id: 'thesisProposal',
    contentVi: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1e293b;">
        <h2 style="color: #0f172a; border-bottom: 2px solid #0284c7; padding-bottom: 8px;">ĐỀ CƯƠNG ĐỀ TÀI KHÓA LUẬN TỐT NGHIỆP</h2>

        <p><strong>1. Tên đề tài (Tiếng Việt):</strong> {{tên đề tài tiếng Việt}}</p>
        <p><strong>2. Tên đề tài (Tiếng Anh):</strong> {{tên đề tài tiếng Anh}}</p>
        <p><strong>3. Giảng viên hướng dẫn:</strong> {{học hàm/học vị, họ tên GVHD}}</p>
        <p><strong>4. Nhóm sinh viên thực hiện:</strong></p>
        <ul>
          <li>{{họ tên trưởng nhóm}} (Trưởng nhóm - MSSV: {{MSSV}})</li>
          <li>{{họ tên thành viên}} (MSSV: {{MSSV}})</li>
        </ul>

        <h3 style="color: #0369a1; margin-top: 20px;">I. Tính cấp thiết của đề tài</h3>
        <p>Trình bày bối cảnh thực tiễn, những hạn chế của hệ thống hiện hữu và lý do lựa chọn nghiên cứu đề tài này.</p>

        <h3 style="color: #0369a1; margin-top: 20px;">II. Mục tiêu nghiên cứu</h3>
        <ol>
          <li>{{Mục tiêu tổng quát: sản phẩm/kết quả chính của đề tài}}</li>
          <li>{{Mục tiêu cụ thể 1 đo lường được}}</li>
          <li>{{Mục tiêu cụ thể 2 đo lường được}}</li>
        </ol>

        <h3 style="color: #0369a1; margin-top: 20px;">III. Kế hoạch triển khai (Gantt)</h3>
        <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
          <thead>
            <tr style="background-color: #f1f5f9;">
              <th style="border: 1px solid #cbd5e1; padding: 8px;">Giai đoạn</th>
              <th style="border: 1px solid #cbd5e1; padding: 8px;">Nội dung công việc</th>
              <th style="border: 1px solid #cbd5e1; padding: 8px;">Thời gian</th>
              <th style="border: 1px solid #cbd5e1; padding: 8px;">Kết quả dự kiến</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="border: 1px solid #cbd5e1; padding: 8px;">1</td>
              <td style="border: 1px solid #cbd5e1; padding: 8px;">Khảo sát và thiết kế kiến trúc</td>
              <td style="border: 1px solid #cbd5e1; padding: 8px;">Tuần 1 - Tuần 3</td>
              <td style="border: 1px solid #cbd5e1; padding: 8px;">Báo cáo SRS & Architecture Spec</td>
            </tr>
            <tr>
              <td style="border: 1px solid #cbd5e1; padding: 8px;">2</td>
              <td style="border: 1px solid #cbd5e1; padding: 8px;">Phát triển Core Engine & Web Portal</td>
              <td style="border: 1px solid #cbd5e1; padding: 8px;">Tuần 4 - Tuần 10</td>
              <td style="border: 1px solid #cbd5e1; padding: 8px;">Hệ thống chạy thử nghiệm Staging</td>
            </tr>
          </tbody>
        </table>
      </div>
    `,
    contentEn: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1e293b;">
        <h2 style="color: #0f172a; border-bottom: 2px solid #0284c7; padding-bottom: 8px;">GRADUATION THESIS / RESEARCH PROPOSAL OUTLINE</h2>

        <p><strong>1. Thesis title (Vietnamese):</strong> {{tên đề tài tiếng Việt}}</p>
        <p><strong>2. Thesis title (English):</strong> {{tên đề tài tiếng Anh}}</p>
        <p><strong>3. Supervisor:</strong> {{học hàm/học vị, họ tên GVHD}}</p>
        <p><strong>4. Student team:</strong></p>
        <ul>
          <li>{{họ tên trưởng nhóm}} (Team leader - Student ID: {{MSSV}})</li>
          <li>{{họ tên thành viên}} (Student ID: {{MSSV}})</li>
        </ul>

        <h3 style="color: #0369a1; margin-top: 20px;">I. Rationale for the topic</h3>
        <p>Present the practical context, the limitations of existing systems, and the reasons for choosing this research topic.</p>

        <h3 style="color: #0369a1; margin-top: 20px;">II. Research objectives</h3>
        <ol>
          <li>{{Mục tiêu tổng quát: sản phẩm/kết quả chính của đề tài}}</li>
          <li>{{Mục tiêu cụ thể 1 đo lường được}}</li>
          <li>{{Mục tiêu cụ thể 2 đo lường được}}</li>
        </ol>

        <h3 style="color: #0369a1; margin-top: 20px;">III. Implementation plan (Gantt)</h3>
        <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
          <thead>
            <tr style="background-color: #f1f5f9;">
              <th style="border: 1px solid #cbd5e1; padding: 8px;">Phase</th>
              <th style="border: 1px solid #cbd5e1; padding: 8px;">Work items</th>
              <th style="border: 1px solid #cbd5e1; padding: 8px;">Timeline</th>
              <th style="border: 1px solid #cbd5e1; padding: 8px;">Expected outcome</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="border: 1px solid #cbd5e1; padding: 8px;">1</td>
              <td style="border: 1px solid #cbd5e1; padding: 8px;">Survey and architecture design</td>
              <td style="border: 1px solid #cbd5e1; padding: 8px;">Week 1 - Week 3</td>
              <td style="border: 1px solid #cbd5e1; padding: 8px;">SRS & Architecture Spec report</td>
            </tr>
            <tr>
              <td style="border: 1px solid #cbd5e1; padding: 8px;">2</td>
              <td style="border: 1px solid #cbd5e1; padding: 8px;">Core Engine & Web Portal development</td>
              <td style="border: 1px solid #cbd5e1; padding: 8px;">Week 4 - Week 10</td>
              <td style="border: 1px solid #cbd5e1; padding: 8px;">System running in the Staging environment</td>
            </tr>
          </tbody>
        </table>
      </div>
    `,
  },
  {
    id: 'rectorDecision',
    contentVi: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1e293b;">
        <div style="text-align: center; border-bottom: 2px solid #0d509d; padding-bottom: 12px; margin-bottom: 20px;">
          <h4 style="margin: 0; text-transform: uppercase; color: #64748b; font-size: 13px; letter-spacing: 1px;">TRƯỜNG ĐẠI HỌC CÔNG NGHỆ KỸ THUẬT TP.HCM</h4>
          <h2 style="margin: 8px 0 0 0; color: #0d509d; font-size: 20px; font-weight: 700;">QUYẾT ĐỊNH BAN HÀNH QUY CHẾ HỌC VỤ & ĐÀO TẠO</h2>
          <p style="margin: 4px 0 0 0; color: #64748b; font-size: 13px;">Căn cứ Luật Giáo dục Đại học và Đề án phát triển Trường Đại học Công nghệ Kỹ thuật TP.HCM</p>
        </div>

        <p><strong>HIỆU TRƯỞNG TRƯỜNG ĐẠI HỌC CÔNG NGHỆ KỸ THUẬT TP.HCM QUYẾT ĐỊNH:</strong></p>

        <p><strong>Điều 1.</strong> Ban hành kèm theo Quyết định này Quy định tổ chức đào tạo theo hệ thống tín chỉ và quy chế đánh giá điểm rèn luyện sinh viên.</p>
        <p><strong>Điều 2.</strong> Quyết định này có hiệu lực kể từ ngày ký và áp dụng cho toàn thể các khóa sinh viên hệ chính quy.</p>
        <p><strong>Điều 3.</strong> Trưởng phòng Đào tạo, Trưởng khoa Công nghệ Thông tin và các đơn vị liên quan chịu trách nhiệm thi hành Quyết định này.</p>

        <div style="margin-top: 30px; display: flex; justify-content: space-between;">
          <div style="font-size: 12px; color: #64748b;">
            <strong>Nơi nhận:</strong><br/>
            - Như Điều 3;<br/>
            - Ban Giám hiệu (để báo cáo);<br/>
            - Lưu: VT, P.ĐT.
          </div>
          <div style="text-align: right;">
            <p style="margin: 0; font-weight: 700; text-transform: uppercase;">HIỆU TRƯỞNG</p>
            <div style="height: 50px;"></div>
            <p style="margin: 0; font-weight: 700; color: #0d509d;">{{Học hàm, Học vị, Họ tên}}</p>
          </div>
        </div>
      </div>
    `,
    contentEn: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1e293b;">
        <div style="text-align: center; border-bottom: 2px solid #0d509d; padding-bottom: 12px; margin-bottom: 20px;">
          <h4 style="margin: 0; text-transform: uppercase; color: #64748b; font-size: 13px; letter-spacing: 1px;">HCMC UNIVERSITY OF TECHNOLOGY AND ENGINEERING</h4>
          <h2 style="margin: 8px 0 0 0; color: #0d509d; font-size: 20px; font-weight: 700;">DECISION ON PROMULGATING ACADEMIC AFFAIRS & TRAINING REGULATIONS</h2>
          <p style="margin: 4px 0 0 0; color: #64748b; font-size: 13px;">Pursuant to the Law on Higher Education and the Development Plan of HCMC University of Technology and Engineering</p>
        </div>

        <p><strong>THE RECTOR OF HCMC UNIVERSITY OF TECHNOLOGY AND ENGINEERING DECIDES:</strong></p>

        <p><strong>Article 1.</strong> Promulgate with this Decision the Regulations on credit-based training and the rules for assessing student conduct scores.</p>
        <p><strong>Article 2.</strong> This Decision takes effect from the date of signing and applies to all full-time student cohorts.</p>
        <p><strong>Article 3.</strong> The Head of the Office of Academic Affairs, the Dean of the Faculty of Information Technology and related units are responsible for implementing this Decision.</p>

        <div style="margin-top: 30px; display: flex; justify-content: space-between;">
          <div style="font-size: 12px; color: #64748b;">
            <strong>Recipients:</strong><br/>
            - As in Article 3;<br/>
            - Board of Rectors (for reporting);<br/>
            - Filed: Secretariat, Office of Academic Affairs.
          </div>
          <div style="text-align: right;">
            <p style="margin: 0; font-weight: 700; text-transform: uppercase;">RECTOR</p>
            <div style="height: 50px;"></div>
            <p style="margin: 0; font-weight: 700; color: #0d509d;">{{Học hàm, Học vị, Họ tên}}</p>
          </div>
        </div>
      </div>
    `,
  },
  {
    id: 'examAppeal',
    contentVi: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1e293b;">
        <h2 style="color: #0d509d; border-bottom: 2px solid #0d509d; padding-bottom: 8px;">KẾ HOẠCH TỔ CHỨC THI KẾT THÚC HỌC PHẦN & PHÚC KHẢO ĐIỂM</h2>

        <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 12px 16px; border-radius: 6px; margin: 16px 0;">
          <strong style="color: #1d4ed8;">Phòng Khảo thí & Đảm bảo Chất lượng</strong> thông báo lịch thi và quy định dành cho sinh viên tham gia kỳ thi học kỳ.
        </div>

        <h3 style="color: #0369a1;">1. Quy định khi vào phòng thi</h3>
        <ul>
          <li>Sinh viên bắt buộc xuất trình Thẻ sinh viên có ảnh hoặc CCCD còn hạn sử dụng.</li>
          <li>Tuyệt đối không mang tài liệu, điện thoại di động và thiết bị thu phát sóng vào phòng thi.</li>
          <li>Có mặt tại phòng thi trước giờ bắt đầu tối thiểu 15 phút.</li>
        </ul>

        <h3 style="color: #0369a1;">2. Thủ tục nộp đơn phúc khảo điểm thi</h3>
        <p>Sinh viên có quyền gửi yêu cầu phúc khảo trực tuyến trên cổng học vụ trong vòng <strong>07 ngày làm việc</strong> kể từ ngày giảng viên công bố điểm chính thức.</p>
      </div>
    `,
    contentEn: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1e293b;">
        <h2 style="color: #0d509d; border-bottom: 2px solid #0d509d; padding-bottom: 8px;">END-OF-COURSE EXAMINATION & SCORE APPEAL PLAN</h2>

        <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 12px 16px; border-radius: 6px; margin: 16px 0;">
          <strong style="color: #1d4ed8;">Office of Testing & Quality Assurance</strong> announces the examination schedule and the regulations for students taking the term examinations.
        </div>

        <h3 style="color: #0369a1;">1. Exam room regulations</h3>
        <ul>
          <li>Students must present a valid photo student ID card or citizen ID card.</li>
          <li>Reference materials, mobile phones and transmitting or receiving devices are strictly prohibited in the exam room.</li>
          <li>Be present in the exam room at least 15 minutes before the start time.</li>
        </ul>

        <h3 style="color: #0369a1;">2. Score appeal procedure</h3>
        <p>Students may submit an online appeal request on the academic portal within <strong>07 working days</strong> from the date the instructor publishes the official score.</p>
      </div>
    `,
  },
] as const;

/**
 * WAI-ARIA menu keyboard contract: opening lands on the first item (or the
 * last when opened with ArrowUp), arrow keys wrap, and Home/End jump to the
 * ends. Returns null when the key is not a menu-navigation key.
 */
export function nextTemplateMenuItemIndex(
  currentIndex: number,
  itemCount: number,
  key: string,
): number | null {
  if (itemCount <= 0) return null;
  switch (key) {
    case 'ArrowDown':
      return currentIndex < 0 ? 0 : (currentIndex + 1) % itemCount;
    case 'ArrowUp':
      return currentIndex < 0 ? itemCount - 1 : (currentIndex + itemCount - 1) % itemCount;
    case 'Home':
      return 0;
    case 'End':
      return itemCount - 1;
    default:
      return null;
  }
}

export function TinyMceEditor({
  value,
  onChange,
  placeholder,
  className,
  height = 500,
  disabled = false,
  readOnly = false,
  locale = 'vi',
  id,
  draftOwnerId,
  documentTitle,
  showTemplates = true,
  showWordCount = true,
  onInit,
}: TinyMceEditorProps) {
  const generatedId = useId();
  const editorId = `${id || `tinymce-${generatedId.replace(/:/g, '')}`}${draftOwnerId ? `-owner-${encodeURIComponent(draftOwnerId)}` : ''}`;
  const editorRef = useRef<any>(null);
  const [isDark, setIsDark] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editorState, reloadEditor] = useEditorModule();

  // RT-P1-2: the server refuses bodies over MAX_ANNOUNCEMENT_CONTENT_CHARS,
  // so tell the author BEFORE they try to publish instead of surfacing a quota
  // error after they have finished writing.
  const contentLengthState = assessAnnouncementContentLength(value);
  const formatCharacterCount = (count: number) =>
    count.toLocaleString(isVi ? 'vi-VN' : 'en-US');

  // Detect dark mode in document element
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const checkDark = () => {
      setIsDark(document.documentElement.classList.contains('dark'));
    };
    checkDark();

    const observer = new MutationObserver(checkDark);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => observer.disconnect();
  }, []);

  const isVi = locale === 'vi';
  const copy = isVi ? editorSurfacesVi.tinyMce : editorSurfacesEn.tinyMce;
  const templateCopy = isVi ? editorSurfacesVi.templates.tinyMce : editorSurfacesEn.templates.tinyMce;

  // RT-P3-d: the reader sanitizer accepts only base64 png/jpeg/gif/webp/bmp
  // image sources, so an inlined SVG looks fine in the author's preview and
  // comes back with its `src` deleted for every reader — an unexplained broken
  // image. Refuse it at both insert points, before the payload is embedded,
  // and say why in the author's language.
  const svgRejected = copy.svgRejected;

  const unsupportedImageFormat = copy.unsupportedImageFormat;

  // Apply academic template. Insert at the cursor instead of replacing the
  // document: the label says "chèn" and a misclick must not wipe the content
  // being edited.
  const handleInsertTemplate = (templateHtml: string) => {
    if (editorRef.current) {
      const current = editorRef.current.getContent({ format: 'raw' });
      if (current && String(current).trim()) {
        editorRef.current.insertContent(templateHtml);
        onChange(editorRef.current.getContent());
      } else {
        editorRef.current.setContent(templateHtml);
        onChange(templateHtml);
      }
      setTemplatesOpen(false);
    }
  };

  // Close the templates popover with Escape and return focus to its trigger.
  const templatesTriggerRef = useRef<HTMLButtonElement>(null);
  const templatesMenuRef = useRef<HTMLDivElement>(null);

  // Opening the menu moves focus to its first item; the arrow keys walk the
  // items and Escape returns focus to the trigger (WAI-ARIA menu contract).
  useEffect(() => {
    if (!templatesOpen) return undefined;
    const frame = window.requestAnimationFrame(() => {
      templatesMenuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [templatesOpen]);

  const handleTemplatesKeyDown = (event: React.KeyboardEvent) => {
    if (!templatesOpen) return;
    if (event.key === 'Escape') {
      event.stopPropagation();
      setTemplatesOpen(false);
      templatesTriggerRef.current?.focus();
      return;
    }
    const items = Array.from(
      templatesMenuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);
    const nextIndex = nextTemplateMenuItemIndex(currentIndex, items.length, event.key);
    if (nextIndex === null) return;
    event.preventDefault();
    items[nextIndex]?.focus();
  };

  // Copy HTML to clipboard — a rejected write must surface, not leave the
  // button looking dead while nothing reached the clipboard.
  const handleCopyHtml = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(
        copy.copyFailed,
      );
    }
  };

  // Export HTML as file. K2: same naming rule as the studio export — the
  // title slug when there is one, otherwise the previous dated fallback.
  const handleExportHtml = () => {
    const blob = new Blob([value], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = buildDocumentFilename(
      documentTitle ?? '',
      'html',
      `document-${new Date().toISOString().slice(0, 10)}`,
    );
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className={cn(
        'relative flex flex-col rounded-lg border border-border/80 bg-card transition-all',
        disabled && 'opacity-60 pointer-events-none',
        className
      )}
    >
      {/* Upper Control Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-secondary/30 px-3 py-2 text-foreground">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 font-semibold text-xs text-primary uppercase tracking-wider">
            <Sparkles className="h-4 w-4" />
            <span>{copy.editorTitle}</span>
          </div>
          <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
            {copy.secureStorage}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {showTemplates ? (
            <div className="relative" onKeyDown={handleTemplatesKeyDown}>
              <Button
                ref={templatesTriggerRef}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setTemplatesOpen(!templatesOpen)}
                aria-haspopup="true"
                aria-expanded={templatesOpen}
                className="h-8 gap-1.5 text-xs font-medium"
              >
                <BookOpen className="h-3.5 w-3.5 text-primary" />
                <span>{copy.templatesButton}</span>
              </Button>

              {templatesOpen ? (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setTemplatesOpen(false)}
                    aria-hidden="true"
                  />
                  <div
                    ref={templatesMenuRef}
                    role="menu"
                    aria-label={copy.templatesAriaLabel}
                    className="absolute right-0 top-full z-50 mt-1 w-80 rounded-lg border border-border bg-popover p-2 shadow-xl animate-in fade-in zoom-in-95"
                  >
                  <div className="border-b border-border pb-2 px-2 text-xs font-semibold text-foreground">
                    {copy.chooseTemplate}
                  </div>
                  <div className="mt-1 space-y-1">
                    {TINYMCE_TEMPLATES.map((tmpl, idx) => (
                      <button
                        key={idx}
                        type="button"
                        role="menuitem"
                        tabIndex={-1}
                        onClick={() => handleInsertTemplate(isVi ? tmpl.contentVi : tmpl.contentEn)}
                        className="w-full text-left rounded p-2 text-xs transition-colors hover:bg-secondary focus-visible:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                      >
                        <div className="font-semibold text-foreground">
                          {templateCopy[tmpl.id].title}
                        </div>
                        <div className="mt-0.5 text-muted-foreground text-[11px] leading-tight line-clamp-2">
                          {templateCopy[tmpl.id].description}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : null}
            </div>
          ) : null}

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleCopyHtml}
            className="h-8 gap-1 text-xs"
            title={copy.copyHtmlTitle}
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{copied ? copy.copied : 'HTML'}</span>
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleExportHtml}
            className="h-8 gap-1 text-xs"
            title={copy.downloadHtmlTitle}
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{copy.exportHtml}</span>
          </Button>
        </div>
      </div>

      {/* RT-P1-2: warn while composing — the server rejects bodies over the
          200k-character cap, so the author must see the budget shrinking
          before they hit publish, not as a quota error afterwards. */}
      {contentLengthState !== 'ok' ? (
        <div
          role="status"
          className={cn(
            'flex items-center gap-2 border-b px-3 py-2 text-xs font-medium',
            contentLengthState === 'exceeded'
              ? 'border-destructive/40 bg-destructive/10 text-status-danger-foreground'
              : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
          )}
        >
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            {contentLengthState === 'exceeded'
              ? copy.contentExceeded
                .replace('{length}', formatCharacterCount(value.length))
                .replace('{limit}', formatCharacterCount(MAX_ANNOUNCEMENT_CONTENT_CHARS))
              : copy.contentNearLimit
                .replace('{length}', formatCharacterCount(value.length))
                .replace('{limit}', formatCharacterCount(MAX_ANNOUNCEMENT_CONTENT_CHARS))}
          </span>
        </div>
      ) : null}

      {/* TinyMCE Self-Hosted Container. The key forces a remount when the
          theme flips: the React wrapper only reads `init` at mount, so without
          it a light-to-dark switch would keep the light skin and content CSS. */}
      <div className="flex-1 overflow-hidden">
        {editorState.status === 'loading' ? <EditorLoading isVi={isVi} /> : null}
        {editorState.status === 'error' ? (
          <EditorLoadError isVi={isVi} onRetry={reloadEditor} />
        ) : null}
        {editorState.status === 'ready' ? (
          <editorState.Editor
            key={`${editorId}-${isDark ? 'dark' : 'light'}`}
            id={editorId}
            tinymceScriptSrc="/tinymce/tinymce.min.js"
          value={value}
          disabled={disabled || readOnly}
          onEditorChange={(newContent: string) => {
            onChange(newContent);
          }}
          onInit={(evt: any, editor: any) => {
            editorRef.current = editor;
            if (onInit) {
              onInit(evt, editor);
            }
          }}
          init={{
            license_key: 'gpl',
            height,
            menubar: 'file edit view insert format tools table help',
            menu: {
              // K6: the autosave plugin keeps writing a recovery draft, so the
              // File menu keeps `restoredraft` as the only way to read it back
              // after a crash or a closed tab (upstream's default file menu).
              // The studio clears the draft on every active discard — New
              // Document, Cancel edit, closing the quick-edit modal — so a body
              // the author chose to throw away is never restorable here.
              file: { title: 'File', items: 'newdocument restoredraft | preview | print' },
              edit: { title: 'Edit', items: 'undo redo | cut copy paste pastetext | selectall | searchreplace' },
              view: { title: 'View', items: 'code | visualaid visualchars visualblocks | preview fullscreen' },
              // RT-P2-2: `media` was removed from the insert menu and plugin
              // list — its output is <iframe>/<video>, which the announcement
              // allowlist drops (no upload endpoint exists, RT-P2-6), so the
              // feature produced content that silently vanished for readers.
              // RT-P3-c: `pagebreak` is gone for the same reason. The reader
              // and print CSS never honoured `<!-- pagebreak -->`, the server
              // sanitizer strips the comment, and the author's own preview
              // showed it as literal junk.
              insert: { title: 'Insert', items: 'image link codesample inserttable | charmap hr | nonbreaking anchor | insertdatetime' },
              format: { title: 'Format', items: 'bold italic underline strikethrough superscript subscript codeformat | styles blocks fontfamily fontsize align lineheight | forecolor backcolor | removeformat' },
              tools: { title: 'Tools', items: 'code wordcount' },
              table: { title: 'Table', items: 'inserttable | cell row column | tableprops deletetable' },
              help: { title: 'Help', items: 'help' },
            },
            plugins: [
              'accordion',
              'advlist',
              'anchor',
              'autolink',
              'autosave',
              'charmap',
              'code',
              'codesample',
              'directionality',
              // K4: the upstream fullscreen plugin is the single fullscreen
              // mechanism. The old app-level overlay set the iframe height in
              // `init`, which the React wrapper only reads at mount, so it kept
              // the stale inline height around a full-screen frame.
              'fullscreen',
              'help',
              'image',
              'insertdatetime',
              'link',
              'lists',
              'nonbreaking',
              'preview',
              'quickbars',
              'searchreplace',
              'table',
              'visualblocks',
              'visualchars',
              'wordcount',
            ],
            // RT-P2-2: accordion + anchor are kept because their output
            // (<details>/<summary> and a restricted `id`) is allowlisted by
            // the sanitizer on both the read and write paths; RT-P3-4:
            // `wordcount` is only offered when `showWordCount` is set.
            // `emoticons` is deliberately absent: official administrative
            // content offers no sticker insertion; `charmap` covers the
            // typographic characters that remain appropriate.
            toolbar: [
              'undo redo | blocks fontfamily fontsize lineheight | bold italic underline strikethrough | forecolor backcolor | alignleft aligncenter alignright alignjustify | bullist numlist outdent indent',
              [
                'table link image codesample',
                'accordion charmap insertdatetime',
                'visualblocks visualchars searchreplace',
                showWordCount ? 'wordcount' : null,
                'preview fullscreen',
                'code help',
              ]
                .filter(Boolean)
                .join(' | '),
            ],
            toolbar_mode: 'sliding',
            font_family_formats:
              'Be Vietnam Pro=Be Vietnam Pro,sans-serif; Arial=arial,helvetica,sans-serif; Times New Roman=times new roman,times,serif; Calibri=calibri,sans-serif; Roboto=roboto,sans-serif; Segoe UI=Segoe UI,sans-serif; Courier New=courier new,courier,monospace; Tahoma=tahoma,arial,helvetica,sans-serif; Georgia=georgia,palatino;',
            font_size_formats: '10px 11px 12px 13px 14px 15px 16px 18px 20px 22px 24px 26px 28px 32px 36px 48px',
            line_height_formats: '1 1.15 1.3 1.5 1.65 1.8 2 2.5',
            style_formats: [
              {
                title: copy.toolbar.headings.title,
                items: [
                  { title: copy.toolbar.headings.h1, format: 'h1' },
                  { title: copy.toolbar.headings.h2, format: 'h2' },
                  { title: copy.toolbar.headings.h3, format: 'h3' },
                  { title: copy.toolbar.headings.h4, format: 'h4' },
                ],
              },
              {
                title: copy.toolbar.callouts.title,
                items: [
                  { title: copy.toolbar.callouts.paragraph, format: 'p' },
                  { title: copy.toolbar.callouts.blockquote, format: 'blockquote' },
                  {
                    title: copy.toolbar.callouts.notice,
                    block: 'div',
                    classes: 'academic-callout academic-callout-info',
                    wrapper: true,
                  },
                  {
                    title: copy.toolbar.callouts.warning,
                    block: 'div',
                    classes: 'academic-callout academic-callout-warning',
                    wrapper: true,
                  },
                  {
                    title: copy.toolbar.callouts.success,
                    block: 'div',
                    classes: 'academic-callout academic-callout-success',
                    wrapper: true,
                  },
                ],
              },
              {
                title: copy.toolbar.inline.title,
                items: [
                  { title: copy.toolbar.inline.bold, format: 'bold' },
                  { title: copy.toolbar.inline.italic, format: 'italic' },
                  { title: copy.toolbar.inline.underline, format: 'underline' },
                  { title: copy.toolbar.inline.strikethrough, format: 'strikethrough' },
                  { title: copy.toolbar.inline.superscript, format: 'superscript' },
                  { title: copy.toolbar.inline.subscript, format: 'subscript' },
                  { title: copy.toolbar.inline.code, format: 'code' },
                ],
              },
            ],
            image_advtab: true,
            image_caption: true,
            image_title: true,
            automatic_uploads: true,
            // Only the formats the publish sanitizer keeps — AVIF/HEIC/SVG
            // used to inline happily then lose their src on publish.
            images_file_types: 'jpg,jpeg,png,gif,webp,bmp',
            file_picker_types: 'image',
            // Pasted screenshots go through the same upload handler instead of
            // being silently dropped (TinyMCE's default rejects data images).
            paste_data_images: true,
            // K5: TinyMCE 8 no longer filters Word/Google-Docs markup and the
            // server sanitizer keeps class/style, so external paste is reduced
            // to the app's rendering allowlist here. Internal
            // editor-to-editor paste carries TinyMCE's `internal` marker and is
            // left untouched.
            paste_postprocess: (_editor: any, args: any) => {
              if (shouldCleanForeignPaste(args) && args?.node) {
                cleanForeignPasteTree(args.node as Element);
              }
            },
            images_upload_handler: (blobInfo: any) =>
              new Promise((resolve, reject) => {
                // RT-P1-2: inline base64 payloads land in the announcement
                // content, so the cap is DERIVED from the server's 200k-char
                // body limit (see lib/announcement-limits.ts) instead of the
                // old independent 1MB number, which made the base64-encoded
                // image alone ~6.8x the entire server budget.
                const blob = blobInfo.blob();
                const blobType = String(blob.type || '').toLowerCase();
                // Positive allowlist, checked before the size test: AVIF, HEIC,
                // TIFF, SVG or an empty type all produced a data: URI the
                // reader sanitizer strips — an image that looked fine to the
                // author and broke for every reader.
                if (!INLINE_IMAGE_MIME_TYPES.has(blobType)) {
                  reject(blobType.includes('svg') ? svgRejected : unsupportedImageFormat);
                  return;
                }
                if (blob.size > MAX_INLINE_IMAGE_BYTES) {
                  reject(copy.imageTooLarge.replace('{size}', String(Math.floor(MAX_INLINE_IMAGE_BYTES / 1024))));
                  return;
                }
                // The per-image cap does not bound the whole document: several images
                // at the cap exceed the server limit together. Refuse the image that
                // would cross the count budget so the author learns while composing
                // rather than at publish time.
                const currentContent = editorRef.current?.getContent({ format: 'raw' }) ?? '';
                const imagesAlreadyInlined = (currentContent.match(/data:image\//g) ?? []).length;
                if (imagesAlreadyInlined >= MAX_INLINE_IMAGES) {
                  reject(copy.tooManyInlineImages.replace('{count}', String(MAX_INLINE_IMAGES)));
                  return;
                }
                resolve(`data:${blob.type};base64,${blobInfo.base64()}`);
              }),
            file_picker_callback: (callback: any, _value: any, meta: any) => {
              if (meta.filetype === 'image') {
                const input = document.createElement('input');
                input.setAttribute('type', 'file');
                // The picker lists only the formats the reader sanitizer keeps;
                // `image/*` offered SVG files that were rejected on publish.
                input.setAttribute('accept', 'image/png,image/jpeg,image/gif,image/webp,image/bmp');
                input.onchange = function () {
                  const file = (this as HTMLInputElement).files?.[0];
                  if (file) {
                    if (!INLINE_IMAGE_MIME_TYPES.has(file.type.toLowerCase())) {
                      // The accept attribute is advisory — "All files" bypasses
                      // it. Same non-blocking toast as the size rejection: a
                      // payload that cannot be published must never reach the
                      // document.
                      toast.error(
                        file.type.toLowerCase().includes('svg') ? svgRejected : unsupportedImageFormat,
                      );
                      return;
                    }
                    if (file.size > MAX_INLINE_IMAGE_BYTES) {
                      // Fail before reading so the author gets the same quota
                      // message as the paste path instead of a silent drop.
                      // Non-blocking toast (app standard) instead of native alert,
                      // which freezes the editor window.
                      toast.error(copy.imageTooLarge.replace('{size}', String(Math.floor(MAX_INLINE_IMAGE_BYTES / 1024))));
                      return;
                    }
                    const reader = new FileReader();
                    reader.onload = function () {
                      callback(reader.result as string, { title: file.name, alt: file.name });
                    };
                    reader.readAsDataURL(file);
                  }
                };
                input.click();
              }
            },
            table_default_attributes: {
              border: '1',
            },
            table_default_styles: {
              'border-collapse': 'collapse',
              width: '100%',
            },
            table_responsive_width: true,
            table_advtab: true,
            table_cell_advtab: true,
            table_row_advtab: true,
            table_toolbar:
              'tableprops tabledelete | tableinsertrowbefore tableinsertrowafter tabledeleterow | tableinsertcolbefore tableinsertcolafter tabledeletecol',
            quickbars_selection_toolbar: 'bold italic underline | quicklink h2 h3 blockquote | forecolor backcolor',
            quickbars_insert_toolbar: 'quickimage quicktable | hr',
            autosave_interval: '30s',
            autosave_prefix: `${AUTOSAVE_KEY_PREFIX}{path}{query}-{id}-`,
            autosave_restore_when_empty: false,
            autosave_retention: '60m',
            skin: isDark ? 'oxide-dark' : 'oxide',
            content_css: isDark ? 'dark' : 'default',
            content_style: `
              body {
                font-family: 'Be Vietnam Pro', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
                font-size: 14.5px;
                line-height: 1.65;
                padding: 16px;
                color: ${isDark ? '#e2e8f0' : '#1e293b'};
                background-color: ${isDark ? '#0f172a' : '#ffffff'};
              }
              table { border-collapse: collapse; width: 100%; margin: 16px 0; }
              table td, table th { border: 1px solid ${isDark ? '#334155' : '#cbd5e1'}; padding: 9px 12px; }
              table th { background-color: ${isDark ? '#1e293b' : '#f8fafc'}; font-weight: 600; text-align: left; }
              img { max-width: 100%; height: auto; border-radius: 6px; margin: 8px 0; }
              blockquote { border-left: 4px solid #0284c7; padding-left: 14px; margin-left: 0; color: #64748b; font-style: italic; }
              .academic-callout { border-radius: 8px; padding: 14px 18px; margin: 16px 0; }
              .academic-callout-info { background-color: ${isDark ? 'rgba(59, 130, 246, 0.15)' : '#eff6ff'}; border-left: 4px solid #3b82f6; color: ${isDark ? '#93c5fd' : '#1d4ed8'}; }
              .academic-callout-warning { background-color: ${isDark ? 'rgba(234, 179, 8, 0.15)' : '#fefce8'}; border-left: 4px solid #eab308; color: ${isDark ? '#fde047' : '#a16207'}; }
              .academic-callout-success { background-color: ${isDark ? 'rgba(34, 197, 94, 0.15)' : '#f0fdf4'}; border-left: 4px solid #22c55e; color: ${isDark ? '#86efac' : '#15803d'}; }
              pre { background-color: ${isDark ? '#1e293b' : '#f1f5f9'}; border-radius: 6px; padding: 12px; overflow-x: auto; font-family: monospace; }
              code { background-color: ${isDark ? '#334155' : '#e2e8f0'}; padding: 2px 5px; border-radius: 4px; font-family: monospace; font-size: 0.9em; }
              details { border: 1px solid ${isDark ? '#334155' : '#cbd5e1'}; border-radius: 6px; padding: 10px 14px; margin: 12px 0; }
              summary { font-weight: 600; cursor: pointer; color: #0284c7; }
            `,
            branding: false,
            promotion: false,
            placeholder: placeholder || copy.placeholder,
            // RT-P3-1: self-hosted Vietnamese language pack (copied from
            // tinymce-i18n by scripts/copy-tinymce.mjs to /tinymce/langs/vi.js);
            // the English locale uses TinyMCE's built-in strings.
            language: isVi ? 'vi' : undefined,
            language_url: isVi ? '/tinymce/langs/vi.js' : undefined,
            contextmenu: 'link image table',
            init_instance_callback: (editor: any) => {
              // The Insert ▸ Image ▸ Source field and internal editor-to-editor
              // paste skip both guarded insert points and the foreign-paste
              // cleaner. A parser-level img filter catches them at set/get
              // time: any src the publish sanitizer would strip drops the node
              // immediately, so the author sees it vanish instead of shipping
              // a broken frame. blob: stays — it is the transient src that
              // automatic_uploads replaces with a data: URI.
              const dropUnsafeImg = (node: any, pattern: RegExp) => {
                const src = normalizeInlineImgSrc(String(node.attr('src') ?? ''));
                if (!pattern.test(src)) {
                  node.remove();
                }
              };
              editor.parser.addNodeFilter('img', (nodes: any[]) => {
                nodes.forEach((node: any) => dropUnsafeImg(node, SAFE_INLINE_IMAGE_SRC));
              });
              // Editing an existing image's Source in the Image dialog mutates
              // the DOM node via setAttribs — it never re-enters the parser,
              // so the parser filter cannot see it. The serializer filter
              // strips the node at getContent time (published content can
              // never carry it), and the NodeChange sweep removes the live
              // element so the author watches it vanish rather than shipping
              // a frame that breaks for readers.
              editor.serializer.addNodeFilter('img', (nodes: any[]) => {
                nodes.forEach((node: any) => dropUnsafeImg(node, PUBLISHABLE_INLINE_IMAGE_SRC));
              });
              editor.on('NodeChange', () => {
                editor.getBody()?.querySelectorAll('img').forEach((img: HTMLImageElement) => {
                  const src = img.getAttribute('src') ?? '';
                  if (src && !SAFE_INLINE_IMAGE_SRC.test(normalizeInlineImgSrc(src))) {
                    img.remove();
                  }
                });
              });
            },
          }}
          />
        ) : null}
      </div>
    </div>
  );
}
