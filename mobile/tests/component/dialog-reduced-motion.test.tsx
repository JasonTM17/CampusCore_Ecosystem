import { expect, jest, test } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { ThemeProvider } from '../../src/design/theme';
import { Dialog } from '../../src/components/ui/index';

type JsonNode = {
  type: string;
  props?: Record<string, unknown>;
  children?: Array<JsonNode | string> | null;
};

function findNode(
  node: JsonNode | Array<JsonNode | string> | string | null | undefined,
  type: string,
): JsonNode | undefined {
  if (!node || typeof node === 'string') return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findNode(child, type);
      if (hit) return hit;
    }
    return undefined;
  }
  if (node.type === type) return node;
  return findNode(node.children, type);
}

test('Dialog skips the fade when the system requests reduced motion', async () => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  await render(
    <ThemeProvider forcedScheme="light">
      <Dialog visible title="Xóa?" confirmLabel="Xóa" onConfirm={() => {}} />
    </ThemeProvider>,
  );
  await waitFor(() => {
    const modal = findNode(screen.toJSON() as unknown as JsonNode, 'Modal');
    expect(modal?.props?.animationType).toBe('none');
  });
});
