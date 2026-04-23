type CatalogKind =
  | 'faculty'
  | 'department'
  | 'course'
  | 'curriculum'
  | 'semester';

type LocalizedCatalogRecord = {
  code?: string | null;
  type?: string | null;
  name?: string | null;
  nameEn?: string | null;
  nameVi?: string | null;
  description?: string | null;
  descriptionEn?: string | null;
  descriptionVi?: string | null;
  academicYear?: { year?: number | null } | null;
};

type LocalizedDefaults = {
  nameEn?: string;
  nameVi?: string;
  descriptionEn?: string;
  descriptionVi?: string;
};

const CATALOG_DEFAULTS: Record<
  Exclude<CatalogKind, 'semester'>,
  Record<string, LocalizedDefaults>
> = {
  faculty: {
    FCS: {
      nameEn: 'Faculty of Computer Science',
      nameVi: 'Khoa Khoa học máy tính',
      descriptionEn: 'Faculty of Computer Science and Information Technology',
      descriptionVi: 'Khoa Khoa học máy tính và công nghệ thông tin',
    },
    ENG: {
      nameEn: 'Faculty of Engineering',
      nameVi: 'Khoa Kỹ thuật',
      descriptionEn: 'Faculty of Engineering',
      descriptionVi: 'Khoa Kỹ thuật',
    },
    FE: {
      nameEn: 'Faculty of Engineering',
      nameVi: 'Khoa Kỹ thuật',
      descriptionEn: 'Faculty of Engineering',
      descriptionVi: 'Khoa Kỹ thuật',
    },
    FBA: {
      nameEn: 'Faculty of Business Administration',
      nameVi: 'Khoa Quản trị kinh doanh',
      descriptionEn: 'Faculty of Business Administration',
      descriptionVi: 'Khoa Quản trị kinh doanh',
    },
  },
  department: {
    CS: {
      nameEn: 'Computer Science',
      nameVi: 'Khoa học máy tính',
      descriptionEn: 'Department of Computer Science',
      descriptionVi: 'Bộ môn Khoa học máy tính',
    },
    CSE: {
      nameEn: 'Computer Science',
      nameVi: 'Khoa học máy tính',
      descriptionEn: 'Department of Computer Science',
      descriptionVi: 'Bộ môn Khoa học máy tính',
    },
    SE: {
      nameEn: 'Software Engineering',
      nameVi: 'Kỹ thuật phần mềm',
      descriptionEn: 'Department of Software Engineering',
      descriptionVi: 'Bộ môn Kỹ thuật phần mềm',
    },
    CE: {
      nameEn: 'Computer Engineering',
      nameVi: 'Kỹ thuật máy tính',
      descriptionEn: 'Department of Computer Engineering',
      descriptionVi: 'Bộ môn Kỹ thuật máy tính',
    },
    BA: {
      nameEn: 'Business Administration',
      nameVi: 'Quản trị kinh doanh',
      descriptionEn: 'Department of Business Administration',
      descriptionVi: 'Bộ môn Quản trị kinh doanh',
    },
  },
  course: {
    CS101: {
      nameEn: 'Introduction to Programming',
      nameVi: 'Nhập môn lập trình',
    },
    CS201: {
      nameEn: 'Data Structures',
      nameVi: 'Cấu trúc dữ liệu',
    },
    CS301: {
      nameEn: 'Algorithms',
      nameVi: 'Giải thuật',
    },
    CS401: {
      nameEn: 'Artificial Intelligence',
      nameVi: 'Trí tuệ nhân tạo',
    },
    SE201: {
      nameEn: 'Software Engineering Principles',
      nameVi: 'Nguyên lý kỹ thuật phần mềm',
    },
    SE301: {
      nameEn: 'Database Systems',
      nameVi: 'Hệ quản trị cơ sở dữ liệu',
    },
    SE401: {
      nameEn: 'Web Development',
      nameVi: 'Phát triển web',
    },
    CE201: {
      nameEn: 'Computer Architecture',
      nameVi: 'Kiến trúc máy tính',
    },
    CE301: {
      nameEn: 'Computer Networks',
      nameVi: 'Mạng máy tính',
    },
    BA101: {
      nameEn: 'Introduction to Business',
      nameVi: 'Nhập môn kinh doanh',
    },
    BA201: {
      nameEn: 'Management Principles',
      nameVi: 'Nguyên lý quản trị',
    },
    COMP101: {
      nameEn: 'Introduction to Computer Science',
      nameVi: 'Nhập môn khoa học máy tính',
    },
    COMP202: {
      nameEn: 'Data Structures',
      nameVi: 'Cấu trúc dữ liệu',
    },
    COMP351: {
      nameEn: 'Promotion Testing',
      nameVi: 'Kiểm thử chuyển chỗ',
    },
  },
  curriculum: {
    CS2025: {
      nameEn: 'Computer Science 2025',
      nameVi: 'Chương trình Khoa học máy tính 2025',
      descriptionEn: 'Computer Science curriculum for the 2025 intake',
      descriptionVi: 'Chương trình Khoa học máy tính cho khóa tuyển sinh 2025',
    },
    CS2026: {
      nameEn: 'Computer Science 2026',
      nameVi: 'Chương trình Khoa học máy tính 2026',
      descriptionEn: 'Computer Science curriculum for the 2026 intake',
      descriptionVi: 'Chương trình Khoa học máy tính cho khóa tuyển sinh 2026',
    },
    SE2025: {
      nameEn: 'Software Engineering 2025',
      nameVi: 'Chương trình Kỹ thuật phần mềm 2025',
      descriptionEn: 'Software Engineering curriculum for the 2025 intake',
      descriptionVi: 'Chương trình Kỹ thuật phần mềm cho khóa tuyển sinh 2025',
    },
  },
};

const SEMESTER_DEFAULTS: Record<string, { labelEn: string; labelVi: string }> =
  {
    SPRING: { labelEn: 'Spring', labelVi: 'Học kỳ Xuân' },
    SUMMER: { labelEn: 'Summer', labelVi: 'Học kỳ Hè' },
    FALL: { labelEn: 'Fall', labelVi: 'Học kỳ Thu' },
  };

function pickText(
  ...values: Array<string | null | undefined>
): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }

    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return undefined;
}

function buildSemesterDefaults(
  record?: LocalizedCatalogRecord | null,
): LocalizedDefaults {
  const type = pickText(record?.type)?.toUpperCase();
  if (!type) {
    return {};
  }

  const labels = SEMESTER_DEFAULTS[type];
  if (!labels) {
    return {};
  }

  const year = record?.academicYear?.year;
  if (typeof year === 'number') {
    return {
      nameEn: `${labels.labelEn} ${year}`,
      nameVi: `${labels.labelVi} ${year}`,
    };
  }

  return {
    nameEn: labels.labelEn,
    nameVi: labels.labelVi,
  };
}

export function getCatalogDefaults(
  kind: CatalogKind,
  record?: LocalizedCatalogRecord | null,
): LocalizedDefaults {
  if (!record) {
    return {};
  }

  if (kind === 'semester') {
    return buildSemesterDefaults(record);
  }

  const code = pickText(record.code)?.toUpperCase();
  if (!code) {
    return {};
  }

  return CATALOG_DEFAULTS[kind][code] ?? {};
}

export function normalizeLocalizedCatalogData(
  kind: CatalogKind,
  input: LocalizedCatalogRecord,
  existing?: LocalizedCatalogRecord | null,
) {
  const defaults = getCatalogDefaults(kind, {
    ...existing,
    ...input,
  });
  const nameEn = pickText(
    input.nameEn,
    input.name,
    existing?.nameEn,
    existing?.name,
    defaults.nameEn,
  );
  const nameVi = pickText(input.nameVi, existing?.nameVi, defaults.nameVi);
  const name = pickText(input.name, nameEn, existing?.name, nameVi);

  const normalized: Record<string, string | null> = {
    name: name ?? null,
    nameEn: nameEn ?? name ?? null,
    nameVi: nameVi ?? null,
  };

  if (kind !== 'semester') {
    const descriptionEn = pickText(
      input.descriptionEn,
      input.description,
      existing?.descriptionEn,
      existing?.description,
      defaults.descriptionEn,
    );
    const descriptionVi = pickText(
      input.descriptionVi,
      existing?.descriptionVi,
      defaults.descriptionVi,
    );
    const description = pickText(
      input.description,
      descriptionEn,
      existing?.description,
      descriptionVi,
    );

    normalized.description = description ?? null;
    normalized.descriptionEn = descriptionEn ?? description ?? null;
    normalized.descriptionVi = descriptionVi ?? null;
  }

  return normalized;
}

export function hydrateLocalizedCatalogRecord<T extends LocalizedCatalogRecord>(
  kind: CatalogKind,
  record: T | null | undefined,
): T | null | undefined {
  if (!record) {
    return record;
  }

  const defaults = getCatalogDefaults(kind, record);
  const nameEn = pickText(record.nameEn, record.name, defaults.nameEn);
  const nameVi = pickText(record.nameVi, defaults.nameVi);
  const hydrated = {
    ...record,
    nameEn,
    nameVi,
  } as T & {
    nameEn?: string | null;
    nameVi?: string | null;
    descriptionEn?: string | null;
    descriptionVi?: string | null;
  };

  if (kind !== 'semester') {
    hydrated.descriptionEn = pickText(
      record.descriptionEn,
      record.description,
      defaults.descriptionEn,
    );
    hydrated.descriptionVi = pickText(
      record.descriptionVi,
      defaults.descriptionVi,
    );
  }

  return hydrated;
}
