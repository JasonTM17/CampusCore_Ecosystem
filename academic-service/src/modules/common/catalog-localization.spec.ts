import {
  hydrateLocalizedCatalogRecord,
  normalizeLocalizedCatalogData,
} from './catalog-localization';

describe('catalog-localization', () => {
  it('hydrates fallback Vietnamese labels for supported catalog codes', () => {
    const department = hydrateLocalizedCatalogRecord('department', {
      code: 'CSE',
      name: 'Computer Science',
    } as {
      code: string;
      name: string;
      nameEn?: string | null;
      nameVi?: string | null;
    });

    expect(department?.nameEn).toBe('Computer Science');
    expect(department?.nameVi).toBe('Khoa học máy tính');
  });

  it('hydrates semester names from type and academic year when localized fields are absent', () => {
    const semester = hydrateLocalizedCatalogRecord('semester', {
      name: 'Fall 2026',
      type: 'FALL',
      academicYear: { year: 2026 },
    } as {
      name: string;
      type: string;
      academicYear: { year: number };
      nameEn?: string | null;
      nameVi?: string | null;
    });

    expect(semester?.nameEn).toBe('Fall 2026');
    expect(semester?.nameVi).toBe('Học kỳ Thu 2026');
  });

  it('normalizes bilingual curriculum defaults for supported catalog codes', () => {
    const curriculum = normalizeLocalizedCatalogData('curriculum', {
      code: 'CS2026',
      name: 'Computer Science 2026',
    });

    expect(curriculum.nameEn).toBe('Computer Science 2026');
    expect(curriculum.nameVi).toBe('Chương trình Khoa học máy tính 2026');
    expect(curriculum.descriptionVi).toBe(
      'Chương trình Khoa học máy tính cho khóa tuyển sinh 2026',
    );
  });
});
