'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlertCircle,
  Bold,
  CheckSquare,
  Code,
  Columns,
  Edit3,
  Eye,
  FileCode,
  Heading1,
  Heading2,
  Heading3,
  HelpCircle,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Maximize2,
  Minimize2,
  Minus,
  Quote,
  Redo2,
  Sparkles,
  Strikethrough,
  Table,
  Undo2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { en } from '@/i18n/messages';
import { editorSurfacesEn, editorSurfacesVi } from '@/i18n/messages-editor';
import { RichContentRenderer } from './rich-content-renderer';
import { useRovingTabs } from './use-roving-tabs';
import { Modal } from './modal';

// Single brand source: every visible mention reads the canonical site name
// from the dictionary instead of a literal.
const SITE_NAME = en.meta.defaults.siteName;

export interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  minHeight?: string;
  disabled?: boolean;
  readOnly?: boolean;
  locale?: 'vi' | 'en';
  hint?: string;
  showTemplates?: boolean;
  id?: string;
  'aria-label'?: string;
}

type EditorViewMode = 'write' | 'split' | 'preview';
const EDITOR_VIEW_MODES: readonly EditorViewMode[] = ['write', 'split', 'preview'];

interface AcademicTemplate {
  id: keyof typeof editorSurfacesEn.templates.richText;
  contentVi: string;
  contentEn: string;
}

const ACADEMIC_TEMPLATES: AcademicTemplate[] = [
  {
    id: 'urgentNotice',
    contentVi: `# THÔNG BÁO KHẨN: THAY ĐỔI LỊCH HỌC VỤ

> [!WARNING]
> **Kính gửi toàn thể Giảng viên và Sinh viên:**
> Đề nghị kiểm tra kỹ thông tin điều chỉnh dưới đây để sắp xếp lịch trình phù hợp.

### 1. Nội dung điều chỉnh
Các lớp học phần và hoạt động thi kết thúc học phần được điều chỉnh theo thời gian biểu mới:

| Học phần | Giảng viên | Thời gian cũ | Thời gian mới | Phòng học |
| :--- | :--- | :--- | :--- | :--- |
| Lập trình Java nâng cao | TS. Nguyễn Văn A | Thứ 2, Tiết 1-3 | Thứ 4, Tiết 4-6 | A1-302 |
| Cơ sở dữ liệu phân tán | ThS. Trần Thị B | Thứ 3, Tiết 7-9 | Thứ 6, Tiết 7-9 | B2-405 |

### 2. Yêu cầu phối hợp
- [ ] Sinh viên chủ động cập nhật thời khóa biểu cá nhân trên cổng portal.
- [ ] Cán bộ quản lý lớp kiểm tra sĩ số và báo cáo nếu có xung đột lịch.

> [!NOTE]
> Mọi thắc mắc vui lòng liên hệ Văn phòng Đào tạo (Phòng A1-101) hoặc gửi hỗ trợ trực tuyến qua Trợ lý AI ${SITE_NAME}.`,
    contentEn: `# URGENT NOTICE: ACADEMIC SCHEDULE CHANGE

> [!WARNING]
> **To all Faculty Members and Students:**
> Please review the adjustments below carefully so you can plan your schedule accordingly.

### 1. Adjusted items
The following course sections and end-of-course examination activities have been moved to the new timetable:

| Course | Instructor | Previous time | New time | Room |
| :--- | :--- | :--- | :--- | :--- |
| Advanced Java Programming | Dr. Nguyen Van A | Mon, Period 1-3 | Wed, Period 4-6 | A1-302 |
| Distributed Database Systems | MSc. Tran Thi B | Tue, Period 7-9 | Fri, Period 7-9 | B2-405 |

### 2. Required coordination
- [ ] Students update their personal timetable on the portal themselves.
- [ ] Class officers check attendance and report any schedule conflicts.

> [!NOTE]
> For any questions, contact the Office of Academic Affairs (Room A1-101) or use the ${SITE_NAME} AI Assistant for online support.`,
  },
  {
    id: 'registrationTimeline',
    contentVi: `# KẾ HOẠCH ĐĂNG KÝ HỌC PHẦN HỌC KỲ MỚI

> [!IMPORTANT]
> Cổng đăng ký học phần sẽ mở theo từng khung giờ phân luồng. Hệ thống áp dụng **cơ chế chống nghẽn 4 lớp**, sinh viên không cần gửi lặp lệnh.

### 1. Thời gian đăng ký chi tiết
| Đợt đăng ký | Đối tượng áp dụng | Thời gian bắt đầu | Thời gian kết thúc |
| :--- | :--- | :--- | :--- |
| **Đợt 1** | Sinh viên năm cuối & Khóa luận | 08:00 ngày 15/09/2026 | 23:59 ngày 16/09/2026 |
| **Đợt 2** | Sinh viên năm 3 & Năm 2 | 08:00 ngày 17/09/2026 | 23:59 ngày 18/09/2026 |
| **Đợt 3** | Sinh viên năm 1 & Đăng ký bù | 08:00 ngày 19/09/2026 | 17:00 ngày 20/09/2026 |

### 2. Quy định bắt buộc
1. Học kỳ chính: đăng ký tối thiểu **14 tín chỉ** (trừ học kỳ cuối), hạn mức chuẩn tối đa **28 tín chỉ**. Chỉ khi có đơn được **Phòng Đào tạo phê duyệt**, sinh viên mới được đăng ký tối đa **30 tín chỉ**.
2. Kiểm tra điều kiện học phần tiên quyết trước khi nhấn đăng ký.
3. Học phí cần hoàn tất theo quy định sau khi chốt danh sách chính thức.

> [!TIP]
> Sử dụng tính năng **Lọc theo khoa** trên giao diện Đăng ký học phần để tìm kiếm nhanh mã lớp mong muốn.`,
    contentEn: `# COURSE REGISTRATION PLAN FOR THE NEW TERM

> [!IMPORTANT]
> The course registration portal opens in staggered time windows. The system applies a **four-layer congestion-control mechanism**; students do not need to resend their requests.

### 1. Detailed registration schedule
| Registration phase | Applicable students | Start time | End time |
| :--- | :--- | :--- | :--- |
| **Phase 1** | Final-year students & thesis students | 08:00 on 15/09/2026 | 23:59 on 16/09/2026 |
| **Phase 2** | Third-year & second-year students | 08:00 on 17/09/2026 | 23:59 on 18/09/2026 |
| **Phase 3** | First-year students & make-up registration | 08:00 on 19/09/2026 | 17:00 on 20/09/2026 |

### 2. Mandatory rules
1. Regular term: register for at least **14 credits** (except the final term), with a standard maximum of **28 credits**. Students may register up to **30 credits** only with an application **approved by the Office of Academic Affairs**.
2. Check the prerequisite requirements for each course before clicking register.
3. Tuition fees must be settled as required once the official roster is finalised.

> [!TIP]
> Use the **Filter by faculty** feature on the Course Registration screen to find the course code you need quickly.`,
  },
  {
    id: 'academicPolicy',
    contentVi: `# HƯỚNG DẪN QUY CHẾ ĐÀO TẠO & HỌC VỤ

Tài liệu quy định chi tiết về đánh giá điểm học phần và điều kiện xét tốt nghiệp đại học hệ chính quy:

### 1. Thang điểm đánh giá
- **Điểm quá trình (40-50%)**: Bao gồm điểm chuyên cần, bài tập nhóm và kiểm tra giữa kỳ.
- **Điểm thi kết thúc (50-60%)**: Đánh giá toàn diện chuẩn đầu ra của học phần.
- **Điểm chữ quy đổi**:
  - \`A\` / \`A+\`: 8.5 - 10.0 (Tương đương 4.0 GPA)
  - \`B\` / \`B+\`: 7.0 - 8.4 (Tương đương 3.0 - 3.5 GPA)
  - \`C\` / \`C+\`: 5.5 - 6.9 (Tương đương 2.0 - 2.5 GPA)
  - \`D\` / \`D+\`: 4.0 - 5.4 (Tương đương 1.0 - 1.5 GPA)
  - \`F\`: Dưới 4.0 (Không đạt, phải đăng ký học lại)

### 2. Điều kiện nhận khóa luận tốt nghiệp
- Tích lũy tối thiểu **115 tín chỉ** thuộc khung chương trình đào tạo.
- Điểm trung bình tích lũy (CPA) đạt từ **2.50** trở lên.
- Không trong thời gian bị kỷ luật từ mức khiển trách trở lên.`,
    contentEn: `# ACADEMIC REGULATIONS & ACADEMIC AFFAIRS GUIDE

This document sets out the detailed rules on course assessment and the conditions for graduating from full-time undergraduate programmes:

### 1. Grading scale
- **Coursework (40-50%)**: attendance, group assignments and the midterm test.
- **Final examination (50-60%)**: a comprehensive assessment of the course learning outcomes.
- **Converted letter grades**:
  - \`A\` / \`A+\`: 8.5 - 10.0 (equivalent to 4.0 GPA)
  - \`B\` / \`B+\`: 7.0 - 8.4 (equivalent to 3.0 - 3.5 GPA)
  - \`C\` / \`C+\`: 5.5 - 6.9 (equivalent to 2.0 - 2.5 GPA)
  - \`D\` / \`D+\`: 4.0 - 5.4 (equivalent to 1.0 - 1.5 GPA)
  - \`F\`: Below 4.0 (not passed; the course must be retaken)

### 2. Eligibility for the graduation thesis
- Accumulate at least **115 credits** within the programme curriculum.
- Achieve a cumulative grade point average (CPA) of **2.50** or higher.
- Not be under any disciplinary sanction of a reprimand or above.`,
  },
];

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  className,
  minHeight = '200px',
  disabled = false,
  readOnly = false,
  locale = 'vi',
  hint,
  showTemplates = true,
  id,
  'aria-label': ariaLabel,
}: RichTextEditorProps) {
  const isVi = locale === 'vi';
  const copy = isVi ? editorSurfacesVi.richText : editorSurfacesEn.richText;
  const templateCopy = isVi ? editorSurfacesVi.templates.richText : editorSurfacesEn.templates.richText;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);

  // States
  const [viewMode, setViewMode] = useState<EditorViewMode>('write');
  const viewModeTabs = useRovingTabs(EDITOR_VIEW_MODES, viewMode, setViewMode);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkText, setLinkText] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [helpDialogOpen, setHelpDialogOpen] = useState(false);

  // History stack for Undo/Redo
  const [history, setHistory] = useState<string[]>([value || '']);
  const [historyIndex, setHistoryIndex] = useState(0);
  const isUpdatingFromHistory = useRef(false);

  // Push new state to history if modified by user
  const pushHistory = useCallback((newText: string) => {
    if (isUpdatingFromHistory.current) return;
    setHistory((prev) => {
      const sliced = prev.slice(0, historyIndex + 1);
      if (sliced[sliced.length - 1] === newText) return prev;
      return [...sliced, newText].slice(-30); // max 30 states
    });
    setHistoryIndex((prev) => Math.min(prev + 1, 29));
  }, [historyIndex]);

  const handleTextChange = useCallback((newText: string) => {
    onChange(newText);
    pushHistory(newText);
  }, [onChange, pushHistory]);

  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      isUpdatingFromHistory.current = true;
      const targetText = history[historyIndex - 1];
      setHistoryIndex(historyIndex - 1);
      onChange(targetText);
      setTimeout(() => {
        isUpdatingFromHistory.current = false;
      }, 50);
    }
  }, [history, historyIndex, onChange]);

  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      isUpdatingFromHistory.current = true;
      const targetText = history[historyIndex + 1];
      setHistoryIndex(historyIndex + 1);
      onChange(targetText);
      setTimeout(() => {
        isUpdatingFromHistory.current = false;
      }, 50);
    }
  }, [history, historyIndex, onChange]);

  // Text insertion helper
  const insertText = useCallback((before: string, after: string = '', defaultSelection: string = '') => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const currentVal = textarea.value;

    const selected = currentVal.substring(start, end) || defaultSelection;
    const replacement = `${before}${selected}${after}`;

    const updated = currentVal.substring(0, start) + replacement + currentVal.substring(end);
    handleTextChange(updated);

    setTimeout(() => {
      textarea.focus();
      const newCursorStart = start + before.length;
      const newCursorEnd = newCursorStart + selected.length;
      textarea.setSelectionRange(newCursorStart, newCursorEnd);
    }, 10);
  }, [handleTextChange]);

  // Insert block at line start
  const insertLinePrefix = useCallback((prefix: string, defaultText: string = '') => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const currentVal = textarea.value;

    // Find start of current line
    const lastNewline = currentVal.lastIndexOf('\n', start - 1);
    const lineStart = lastNewline === -1 ? 0 : lastNewline + 1;

    const beforeLine = currentVal.substring(0, lineStart);
    const afterLine = currentVal.substring(lineStart);

    // If current line already has prefix, remove it; else add it
    let updated: string;
    let newCursor: number;

    if (afterLine.startsWith(prefix)) {
      updated = beforeLine + afterLine.substring(prefix.length);
      newCursor = Math.max(lineStart, start - prefix.length);
    } else {
      const addition = afterLine.trim() === '' && defaultText ? `${prefix}${defaultText}` : prefix;
      updated = beforeLine + addition + afterLine;
      newCursor = start + prefix.length;
    }

    handleTextChange(updated);
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(newCursor, newCursor);
    }, 10);
  }, [handleTextChange]);

  // Insert block snippet
  const insertSnippet = useCallback((snippet: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const currentVal = textarea.value;

    const needsNewlineBefore = start > 0 && currentVal[start - 1] !== '\n';
    const needsNewlineAfter = end < currentVal.length && currentVal[end] !== '\n';

    const insertion = `${needsNewlineBefore ? '\n\n' : ''}${snippet}${needsNewlineAfter ? '\n\n' : ''}`;
    const updated = currentVal.substring(0, start) + insertion + currentVal.substring(end);

    handleTextChange(updated);
    setTimeout(() => {
      textarea.focus();
      const cursor = start + insertion.length;
      textarea.setSelectionRange(cursor, cursor);
    }, 10);
  }, [handleTextChange]);

  // Open Link Dialog
  const openLinkModal = () => {
    const textarea = textareaRef.current;
    const selected = textarea ? textarea.value.substring(textarea.selectionStart, textarea.selectionEnd) : '';
    setLinkText(selected || copy.linkTextPlaceholder);
    setLinkUrl('https://');
    setLinkDialogOpen(true);
  };

  const applyLink = () => {
    if (!linkUrl || linkUrl === 'https://') {
      setLinkDialogOpen(false);
      return;
    }
    insertText('[', `](${linkUrl.trim()})`, linkText || 'Link');
    setLinkDialogOpen(false);
  };

  // Keyboard shortcut listener
  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const isMac = typeof window !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
    const modKey = isMac ? event.metaKey : event.ctrlKey;

    if (modKey && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      insertText('**', '**', copy.boldExample);
    } else if (modKey && event.key.toLowerCase() === 'i') {
      event.preventDefault();
      insertText('*', '*', copy.italicExample);
    } else if (modKey && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openLinkModal();
    } else if (modKey && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) {
        handleRedo();
      } else {
        handleUndo();
      }
    } else if (modKey && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      handleRedo();
    } else if (event.key === 'Tab') {
      // Indent with 2 spaces
      event.preventDefault();
      insertText('  ', '');
    } else if (event.key === 'Escape' && isFullscreen) {
      event.preventDefault();
      setIsFullscreen(false);
    }
  };

  // Listen to Escape for fullscreen
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isFullscreen]);

  // Statistics
  const stats = useMemo(() => {
    const text = value || '';
    const chars = text.length;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const minutes = Math.max(1, Math.ceil(words / 200));
    return { chars, words, minutes };
  }, [value]);

  return (
    <div
      ref={editorContainerRef}
      className={cn(
        'group flex flex-col rounded-lg border border-border/80 bg-background transition-all focus-within:border-primary/70 focus-within:ring-2 focus-within:ring-primary/20',
        isFullscreen && 'fixed inset-0 z-[60] m-0 h-screen w-screen rounded-none border-none p-6 shadow-2xl overflow-y-auto',
        disabled && 'opacity-60 pointer-events-none',
        className
      )}
    >
      {/* Top Toolbar */}
      <div
        role="toolbar"
        aria-label={copy.toolbarLabel}
        className="flex flex-wrap items-center justify-between gap-1 border-b border-border/70 bg-secondary/40 px-3 py-2 text-foreground"
      >
        {/* Left Toolbar Actions */}
        <div className="flex flex-wrap items-center gap-0.5">
          {/* History */}
          <button
            type="button"
            onClick={handleUndo}
            disabled={historyIndex <= 0 || readOnly}
            title={copy.undo}
            aria-label={copy.undo}
            className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
          >
            <Undo2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleRedo}
            disabled={historyIndex >= history.length - 1 || readOnly}
            title={copy.redo}
            className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
          >
            <Redo2 className="h-4 w-4" />
          </button>

          <span className="mx-1 h-4 w-px bg-border/80" aria-hidden="true" />

          {/* Text Formats */}
          <button
            type="button"
            onClick={() => insertText('**', '**', copy.boldInsert)}
            disabled={readOnly}
            title={copy.bold}
            className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
          >
            <Bold className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => insertText('*', '*', copy.italicInsert)}
            disabled={readOnly}
            title={copy.italic}
            className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
          >
            <Italic className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => insertText('~~', '~~', copy.strikethroughInsert)}
            disabled={readOnly}
            title={copy.strikethrough}
            className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
          >
            <Strikethrough className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => insertText('`', '`', 'code')}
            disabled={readOnly}
            title={copy.inlineCode}
            className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
          >
            <Code className="h-4 w-4" />
          </button>

          <span className="mx-1 h-4 w-px bg-border/80" aria-hidden="true" />

          {/* Headings */}
          <button
            type="button"
            onClick={() => insertLinePrefix('# ', copy.heading1Insert)}
            disabled={readOnly}
            title={copy.heading1}
            className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
          >
            <Heading1 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => insertLinePrefix('## ', copy.heading2Insert)}
            disabled={readOnly}
            title={copy.heading2}
            className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
          >
            <Heading2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => insertLinePrefix('### ', copy.heading3Insert)}
            disabled={readOnly}
            title={copy.heading3}
            className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
          >
            <Heading3 className="h-4 w-4" />
          </button>

          <span className="mx-1 h-4 w-px bg-border/80" aria-hidden="true" />

          {/* Lists and Blocks */}
          <button
            type="button"
            onClick={() => insertLinePrefix('- ', copy.listItem)}
            disabled={readOnly}
            title={copy.bulletedList}
            className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
          >
            <List className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => insertLinePrefix('1. ', copy.orderedItem)}
            disabled={readOnly}
            title={copy.numberedList}
            className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
          >
            <ListOrdered className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => insertLinePrefix('- [ ] ', copy.taskItem)}
            disabled={readOnly}
            title={copy.taskList}
            className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
          >
            <CheckSquare className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => insertLinePrefix('> ', copy.quoteItem)}
            disabled={readOnly}
            title={copy.blockquote}
            className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
          >
            <Quote className="h-4 w-4" />
          </button>

          <span className="mx-1 h-4 w-px bg-border/80" aria-hidden="true" />

          {/* Alert Callouts */}
          <button
            type="button"
            onClick={() => insertSnippet(`> [!NOTE]\n> ${copy.noteExample}`)}
            disabled={readOnly}
            title={copy.insertNote}
            className="rounded p-1.5 text-blue-600 dark:text-blue-400 transition-colors hover:bg-blue-50 dark:hover:bg-blue-950/40 disabled:opacity-40"
          >
            <AlertCircle className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => insertSnippet(`> [!WARNING]\n> ${copy.warningExample}`)}
            disabled={readOnly}
            title={copy.insertWarning}
            className="rounded p-1.5 text-amber-600 dark:text-amber-400 transition-colors hover:bg-amber-50 dark:hover:bg-amber-950/40 disabled:opacity-40"
          >
            <AlertCircle className="h-4 w-4" />
          </button>

          <span className="mx-1 h-4 w-px bg-border/80" aria-hidden="true" />

          {/* Insertions */}
          <button
            type="button"
            onClick={openLinkModal}
            disabled={readOnly}
            title={copy.insertLink}
            aria-label={copy.insertLink}
            className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
          >
            <LinkIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => insertText('![', '](https://example.com/image.png)', copy.imageDescription)}
            disabled={readOnly}
            title={copy.insertImage}
            className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
          >
            <ImageIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() =>
              insertSnippet(
                `| ${copy.table.header1} | ${copy.table.header2} | ${copy.table.notes} |\n| :--- | :--- | :--- |\n| ${copy.table.row1} | ${copy.table.valueA} | ${copy.table.details} |\n| ${copy.table.row2} | ${copy.table.valueB} | ${copy.table.details} |`
              )
            }
            disabled={readOnly}
            title={copy.table.insert}
            className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
          >
            <Table className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() =>
              insertSnippet('```java\n' + copy.codeComment + '\n```')
            }
            disabled={readOnly}
            title={copy.codeBlock}
            className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
          >
            <FileCode className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => insertSnippet('---')}
            disabled={readOnly}
            title={copy.horizontalRule}
            className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
          >
            <Minus className="h-4 w-4" />
          </button>

          {/* Academic Templates Menu */}
          {showTemplates ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => setTemplatesOpen(!templatesOpen)}
                disabled={readOnly}
                className="inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
                title={copy.templatesTitle}
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{copy.templatesButton}</span>
              </button>

              {templatesOpen ? (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setTemplatesOpen(false)}
                    aria-hidden="true"
                  />
                  <div className="absolute left-0 top-full z-20 mt-1 w-72 rounded-lg border border-border/80 bg-popover p-1 shadow-lg">
                    <div className="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      {copy.quickTemplateTitle}
                    </div>
                    {ACADEMIC_TEMPLATES.map((tmpl, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          handleTextChange(isVi ? tmpl.contentVi : tmpl.contentEn);
                          setTemplatesOpen(false);
                        }}
                        className="w-full text-left rounded-md px-2 py-1.5 text-xs hover:bg-secondary transition-colors"
                      >
                        <div className="font-semibold text-foreground">{templateCopy[tmpl.id].title}</div>
                        <div className="text-[11px] text-muted-foreground line-clamp-1">{templateCopy[tmpl.id].description}</div>
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Right Toolbar Actions: View Modes & Fullscreen */}
        <div className="flex items-center gap-1">
          {/* Mode Switcher */}
          <div className="flex items-center rounded-md border border-border/70 bg-background/80 p-0.5" role="tablist">
            <button
              ref={viewModeTabs.tabRef('write')}
              type="button"
              role="tab"
              aria-selected={viewMode === 'write'}
              tabIndex={viewModeTabs.tabIndex('write')}
              onKeyDown={(event) => viewModeTabs.onKeyDown(event, 0)}
              onClick={() => setViewMode('write')}
              title={copy.viewTabs.writeTitle}
              className={cn(
                'flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors',
                viewMode === 'write' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Edit3 className="h-3.5 w-3.5" />
              <span className="hidden md:inline">{copy.viewTabs.write}</span>
            </button>
            <button
              ref={viewModeTabs.tabRef('split')}
              type="button"
              role="tab"
              aria-selected={viewMode === 'split'}
              tabIndex={viewModeTabs.tabIndex('split')}
              onKeyDown={(event) => viewModeTabs.onKeyDown(event, 1)}
              onClick={() => setViewMode('split')}
              title={copy.viewTabs.splitTitle}
              className={cn(
                'flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors',
                viewMode === 'split' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Columns className="h-3.5 w-3.5" />
              <span className="hidden md:inline">{copy.viewTabs.split}</span>
            </button>
            <button
              ref={viewModeTabs.tabRef('preview')}
              type="button"
              role="tab"
              aria-selected={viewMode === 'preview'}
              tabIndex={viewModeTabs.tabIndex('preview')}
              onKeyDown={(event) => viewModeTabs.onKeyDown(event, 2)}
              onClick={() => setViewMode('preview')}
              title={copy.viewTabs.previewTitle}
              className={cn(
                'flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors',
                viewMode === 'preview' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Eye className="h-3.5 w-3.5" />
              <span className="hidden md:inline">{copy.viewTabs.preview}</span>
            </button>
          </div>

          {/* Help */}
          <button
            type="button"
            onClick={() => setHelpDialogOpen(true)}
            title={copy.formattingGuide}
            className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <HelpCircle className="h-4 w-4" />
          </button>

          {/* Fullscreen Toggle */}
          <button
            type="button"
            onClick={() => setIsFullscreen(!isFullscreen)}
            title={isFullscreen ? copy.exitFullscreen : copy.fullscreen}
            className={cn(
              'rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground',
              isFullscreen && 'bg-primary/20 text-primary'
            )}
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Editor Body */}
      <div className={cn('relative flex-1 min-h-0', isFullscreen && 'h-[calc(100vh-140px)]')}>
        {/* Write Only Mode */}
        {viewMode === 'write' ? (
          <textarea
            id={id}
            ref={textareaRef}
            value={value}
            onChange={(e) => handleTextChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder ?? copy.placeholder}
            disabled={disabled}
            readOnly={readOnly}
            aria-label={ariaLabel || copy.editorArea}
            style={{ minHeight: isFullscreen ? '100%' : minHeight }}
            className="w-full resize-y rounded-b-md border-none bg-transparent p-4 font-mono text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          />
        ) : null}

        {/* Split View Mode */}
        {viewMode === 'split' ? (
          <div className="grid h-full grid-cols-1 divide-y border-b border-border/70 md:grid-cols-2 md:divide-x md:divide-y-0">
            <div className="flex flex-col">
              <div className="border-b border-border/60 bg-secondary/20 px-4 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {copy.markdownCode}
              </div>
              <textarea
                id={id}
                ref={textareaRef}
                value={value}
                onChange={(e) => handleTextChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={placeholder ?? copy.placeholder}
                disabled={disabled}
                readOnly={readOnly}
                aria-label={ariaLabel || copy.editorArea}
                style={{ minHeight: isFullscreen ? '100%' : minHeight }}
                className="w-full flex-1 resize-none border-none bg-transparent p-4 font-mono text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              />
            </div>
            <div className="flex flex-col overflow-y-auto bg-card/40">
              <div className="border-b border-border/60 bg-secondary/20 px-4 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {copy.liveView}
              </div>
              <div className="flex-1 p-4 overflow-y-auto" style={{ minHeight: isFullscreen ? '100%' : minHeight }}>
                <RichContentRenderer
                  content={value}
                  fallbackText={copy.livePreviewPlaceholder}
                />
              </div>
            </div>
          </div>
        ) : null}

        {/* Preview Only Mode */}
        {viewMode === 'preview' ? (
          <div className="p-5 overflow-y-auto bg-card/40" style={{ minHeight: isFullscreen ? '100%' : minHeight }}>
            <RichContentRenderer
              content={value}
              fallbackText={copy.emptyPreview}
            />
          </div>
        ) : null}
      </div>

      {/* Bottom Status / Stats Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 bg-secondary/30 px-3 py-1.5 text-xs text-muted-foreground">
        <div className="flex items-center gap-3">
          <span>
            {stats.chars} {copy.stats.characters}
          </span>
          <span>·</span>
          <span>
            {stats.words} {copy.stats.words}
          </span>
          <span>·</span>
          <span>
            ~{stats.minutes} {copy.stats.readingTime}
          </span>
          {hint ? (
            <>
              <span>·</span>
              <span className="text-muted-foreground/80">{hint}</span>
            </>
          ) : null}
        </div>
        <div className="hidden sm:flex items-center gap-2 text-[11px]">
          <span className="rounded bg-secondary/80 px-1.5 py-0.5 font-mono">Ctrl+B</span> {copy.boldStatus}
          <span className="rounded bg-secondary/80 px-1.5 py-0.5 font-mono">Ctrl+I</span> {copy.italicStatus}
          <span className="rounded bg-secondary/80 px-1.5 py-0.5 font-mono">Ctrl+K</span> {copy.linkStatus}
        </div>
      </div>

      {/* Link Insertion Dialog */}
      {linkDialogOpen ? (
        <Modal
          isOpen={linkDialogOpen}
          onClose={() => setLinkDialogOpen(false)}
          title={copy.linkDialog.title}
          className="max-w-md"
        >
          <div className="space-y-3 text-sm">
            <div>
              <label htmlFor="rich-text-link-text" className="block font-medium text-foreground mb-1">
                {copy.linkDialog.textLabel}
              </label>
              <input
                id="rich-text-link-text"
                type="text"
                value={linkText}
                onChange={(e) => setLinkText(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder={`${SITE_NAME} Portal`}
              />
            </div>
            <div>
              <label htmlFor="rich-text-link-url" className="block font-medium text-foreground mb-1">
                {copy.linkDialog.urlLabel}
              </label>
              <input
                id="rich-text-link-url"
                type="url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="https://..."
              />
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setLinkDialogOpen(false)}
              className="rounded-md border border-border/80 px-3 py-1.5 text-sm font-medium hover:bg-secondary"
            >
              {copy.linkDialog.cancel}
            </button>
            <button
              type="button"
              onClick={applyLink}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              {copy.linkDialog.insert}
            </button>
          </div>
        </Modal>
      ) : null}

      {/* Help / Shortcuts Dialog */}
      {helpDialogOpen ? (
        <Modal
          isOpen={helpDialogOpen}
          onClose={() => setHelpDialogOpen(false)}
          title={copy.helpDialog.title}
          className="max-w-lg"
        >
          <div className="max-h-96 space-y-3 overflow-y-auto text-xs text-foreground/90 leading-relaxed pr-2">
            <div className="grid grid-cols-2 gap-2 border-b border-border/60 pb-2">
              <span className="font-semibold text-primary">{copy.helpDialog.syntax}</span>
              <span className="font-semibold text-primary">{copy.helpDialog.result}</span>
            </div>
            {copy.helpDialog.examples.map((example) => {
              const style = 'style' in example ? example.style : undefined;
              return (
                <div className="grid grid-cols-2 gap-2" key={example.syntax}>
                  <code>{example.syntax}</code>
                  {style === 'strong' ? (
                    <strong>{example.result}</strong>
                  ) : style === 'em' ? (
                    <em>{example.result}</em>
                  ) : (
                    <span>{example.result}</span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-5 flex justify-end">
            <button
              type="button"
              onClick={() => setHelpDialogOpen(false)}
              className="rounded-md bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
            >
              {copy.helpDialog.done}
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
