const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const PAGE = 'src/app/admin/thesis/page.tsx';
const ZONES = ['America/Los_Angeles', 'UTC', 'Asia/Tokyo'];
const originalZone = process.env.TZ;

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function inZone(zone, run) {
  process.env.TZ = zone;
  try {
    return run();
  } finally {
    process.env.TZ = originalZone;
  }
}

function loadTs(relativePath, imports = {}) {
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: relativePath,
  }).outputText;
  const moduleRecord = { exports: {} };
  const resolve = (specifier) =>
    Object.prototype.hasOwnProperty.call(imports, specifier) ? imports[specifier] : require(specifier);
  Function('module', 'exports', 'require', output)(moduleRecord, moduleRecord.exports, resolve);
  return moduleRecord.exports;
}

const attendance = loadTs('src/lib/attendance-checkin.ts');
const thesisDatetime = loadTs('src/lib/thesis-datetime.ts', {
  '@/lib/attendance-checkin': attendance,
});

const toCampusInstant = (value) => {
  const iso = attendance.campusLocalDateTimeToUtcIso(value);
  if (!iso) throw new Error('invalid campus datetime');
  return iso;
};

/** Every initializer assigned to one of `names` anywhere in the page. */
function propertyInitializers(source, names) {
  const file = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = new Map(names.map((name) => [name, []]));
  const visit = (node) => {
    if (
      ts.isPropertyAssignment(node)
      && ts.isIdentifier(node.name)
      && found.has(node.name.text)
    ) {
      found.get(node.name.text).push(node.initializer.getText(file));
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

function evaluate(expression, scope) {
  const names = Object.keys(scope);
  const run = new Function(...names, `return (${expression});`);
  return run(...names.map((name) => scope[name]));
}

// One campus wall-clock value per round field, and the instant it denotes.
const FIELDS = {
  registrationStart: ['2026-11-05T09:00', '2026-11-05T02:00:00.000Z'],
  registrationEnd: ['2026-11-05T17:00', '2026-11-05T10:00:00.000Z'],
  lecturerSubmitStart: ['2026-11-06T09:00', '2026-11-06T02:00:00.000Z'],
  lecturerSubmitEnd: ['2026-11-06T17:00', '2026-11-06T10:00:00.000Z'],
  proposalPublishAt: ['2026-11-07T09:00', '2026-11-07T02:00:00.000Z'],
  gvpbDeadline: ['2026-11-08T17:00', '2026-11-08T10:00:00.000Z'],
  reportDate: ['2026-11-09T17:00', '2026-11-09T10:00:00.000Z'],
  defenseDate: ['2026-11-10T09:00', '2026-11-10T02:00:00.000Z'],
};

function roundFormScope() {
  return {
    formStart: FIELDS.registrationStart[0],
    formEnd: FIELDS.registrationEnd[0],
    formLecturerStart: FIELDS.lecturerSubmitStart[0],
    formLecturerEnd: FIELDS.lecturerSubmitEnd[0],
    formProposal: FIELDS.proposalPublishAt[0],
    formGvpb: FIELDS.gvpbDeadline[0],
    formReportDate: FIELDS.reportDate[0],
    formDefenseDate: FIELDS.defenseDate[0],
    needsGvpb: true,
    needsDefense: true,
    toCampusInstant,
    campusLocalDateTimeToUtcIso: attendance.campusLocalDateTimeToUtcIso,
  };
}

test('round create and edit payloads read datetime-local values on the campus clock', () => {
  const source = read(PAGE);
  // The page must route every payload field through the shared campus converter.
  assert.match(
    source,
    /function toCampusInstant\(value: string\): string \{\s*const iso = campusLocalDateTimeToUtcIso\(value\);/,
  );
  const expressions = propertyInitializers(source, Object.keys(FIELDS));
  for (const zone of ZONES) {
    inZone(zone, () => {
      for (const [field, [, expected]] of Object.entries(FIELDS)) {
        const found = expressions.get(field) ?? [];
        assert.ok(
          found.length >= 2,
          `${zone} ${field} must be converted by both createRound and updateRound, found ${found.length}`,
        );
        for (const expression of found) {
          assert.equal(
            evaluate(expression, roundFormScope()),
            expected,
            `${zone} ${field} via ${expression}`,
          );
        }
      }
    });
  }
});

test('empty optional round windows stay omitted', () => {
  const expressions = propertyInitializers(read(PAGE), [
    'proposalPublishAt',
    'gvpbDeadline',
    'reportDate',
    'defenseDate',
  ]);
  const scope = {
    ...roundFormScope(),
    formProposal: '',
    formGvpb: '',
    formReportDate: '',
    formDefenseDate: '',
  };
  for (const [field, found] of expressions) {
    for (const expression of found) {
      assert.equal(evaluate(expression, scope), undefined, `${field} via ${expression}`);
    }
  }
});

test('the extend-deadline dialog converts its value as campus wall time', () => {
  const source = read(PAGE);
  const block = source.slice(
    source.indexOf('const extendReportDeadline = async'),
    source.indexOf('/** The edit modal reuses'),
  );
  const declaration = /const parsed = ([^;]+);/.exec(block);
  assert.ok(declaration, 'extendReportDeadline must keep its parsed value declaration');

  for (const zone of ZONES) {
    inZone(zone, () => {
      const parsed = evaluate(declaration[1], {
        extendDeadlineValue: '2026-11-05T09:00',
        toCampusInstant,
        campusLocalDateTimeToUtcIso: attendance.campusLocalDateTimeToUtcIso,
      });
      assert.equal(
        new Date(parsed).toISOString(),
        '2026-11-05T02:00:00.000Z',
        `${zone} extend-deadline instant`,
      );
    });
  }
});

test('the edit dialog prefills the campus wall time, not the browser wall time', () => {
  for (const zone of ZONES) {
    inZone(zone, () => {
      assert.equal(
        thesisDatetime.toThesisLocalInput('2026-11-05T02:00:00.000Z'),
        '2026-11-05T09:00:00.000',
        `${zone} registration instant`,
      );
      assert.equal(
        thesisDatetime.toThesisLocalInput('2026-11-05T10:00:30.250Z'),
        '2026-11-05T17:00:30.250',
        `${zone} deadline instant`,
      );
      assert.equal(thesisDatetime.toThesisLocalInput(null), '');
      assert.equal(thesisDatetime.toThesisLocalInput('not-a-date'), '');
    });
  }
});
