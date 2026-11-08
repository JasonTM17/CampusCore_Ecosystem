import { expect, test } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';

import { ThemeProvider } from '../../src/design/theme';
import { fillCopy } from '../../src/i18n/academic-messages';
import { operationsMessages } from '../../src/i18n/operations-messages';
import type { RosterRow } from '../../src/screens/operations/lecturer-model';
import { AttendanceRosterRow } from '../../src/screens/operations/AttendanceRosterRow';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test('attendance directory labels distinguish students who share a name', async () => {
  const copy = operationsMessages.vi;
  const rows: RosterRow[] = ['SV001', 'SV002'].map((studentCode, index) => ({
    studentId: `student-${index}`, studentCode, name: 'Nguyen An', status: null, notes: '', stored: false,
  }));
  const onChange = () => {};

  await render(
    <ThemeProvider forcedScheme="light">
      {rows.map((row) => <AttendanceRosterRow key={row.studentId} row={row} copy={copy} onChange={onChange} />)}
    </ThemeProvider>,
  );

  for (const row of rows) {
    expect(await screen.findByLabelText(fillCopy(copy.statusOf, {
      name: `${row.name} (${row.studentCode})`, status: copy.unmarked,
    }))).toBeOnTheScreen();
  }
});
