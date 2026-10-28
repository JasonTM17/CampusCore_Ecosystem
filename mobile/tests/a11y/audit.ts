import { StyleSheet } from 'react-native';

export interface A11yViolation {
  rule: string;
  node: string;
  detail: string;
}

export interface AuditResult {
  elements: number;
  violations: A11yViolation[];
  unknownSize: number;
  alertRegions: number;
}

type JsonNode = {
  type: string;
  props?: Record<string, unknown>;
  children?: (JsonNode | string)[] | null;
};

const INTERACTIVE_ROLES = new Set(['button', 'link', 'tab', 'radio']);

function textOf(node: JsonNode): string {
  let out = '';
  const walk = (n: JsonNode | string) => {
    if (typeof n === 'string') out += n;
    else n.children?.forEach(walk);
  };
  walk(node);
  return out.trim();
}

function hasLabel(node: JsonNode): boolean {
  const p = node.props ?? {};
  return (
    (typeof p.accessibilityLabel === 'string' && p.accessibilityLabel.trim() !== '')
    || textOf(node) !== ''
  );
}

function hiddenOnPurpose(node: JsonNode): boolean {
  const p = node.props ?? {};
  return p.accessibilityElementsHidden === true || p.importantForAccessibility === 'no';
}

function flatSize(node: JsonNode): { h?: number; w?: number } {
  const flat = (StyleSheet.flatten(node.props?.style) ?? {}) as { minHeight?: number; height?: number; minWidth?: number; width?: number };
  return {
    h: flat.minHeight ?? flat.height,
    w: flat.minWidth ?? flat.width,
  };
}

/** Traverse a RNTL toJSON() tree and enforce the M06 accessibility contract. */
export function auditTree(root: JsonNode | null): AuditResult {
  const violations: A11yViolation[] = [];
  let elements = 0;
  let unknownSize = 0;
  let alertRegions = 0;

  const visit = (node: JsonNode | string | null | undefined, ancestors: JsonNode[]) => {
    if (!node || typeof node === 'string') return;
    elements += 1;
    const p = node.props ?? {};
    const role = typeof p.accessibilityRole === 'string' ? p.accessibilityRole : undefined;
    const interactive = Boolean(p.onPress) || (role ? INTERACTIVE_ROLES.has(role) : false);
    const label = p.accessibilityLabel;

    // (a) interactive elements need an accessible name
    if (interactive && !hasLabel(node)) {
      violations.push({ rule: 'a-name', node: `${node.type} role=${role ?? 'none'}`, detail: 'interactive element without accessible name' });
    }
    // (b) TextInput must be labelled
    if (node.type === 'TextInput' && !(typeof label === 'string' && label.trim() !== '')) {
      violations.push({ rule: 'b-input-label', node: 'TextInput', detail: 'missing accessibilityLabel' });
    }
    // (c) Image must be labelled or deliberately hidden
    if (node.type === 'Image' && !(typeof label === 'string' && label.trim() !== '') && !hiddenOnPurpose(node)) {
      violations.push({ rule: 'c-image-label', node: 'Image', detail: 'missing accessibilityLabel and not hidden' });
    }
    // (d) touch target >= 44 when size is determinable
    if (interactive) {
      const { h, w } = flatSize(node);
      if (h !== undefined && h < 44) {
        violations.push({ rule: 'd-touch-height', node: `${node.type} ${label ?? role ?? ''}`, detail: `height ${h} < 44` });
      }
      if (w !== undefined && w < 44) {
        violations.push({ rule: 'd-touch-width', node: `${node.type} ${label ?? role ?? ''}`, detail: `width ${w} < 44` });
      }
      if (h === undefined) unknownSize += 1;
      // (e) an action label must never be hard-truncated (fontScale 1.5 safety):
      // any Text descendant with a fixed numberOfLines inside an interactive
      // node is a violation. Exemption: the node carries a non-empty
      // accessibilityLabel that already conveys the full meaning (e.g.
      // ListRow) — the truncated visual text is then redundant for AT.
      const hasTruncatedText = (n: JsonNode | string): boolean => {
        if (typeof n === 'string') return false;
        if (typeof n.props?.numberOfLines === 'number') return true;
        return Boolean(n.children?.some(hasTruncatedText));
      };
      if (hasTruncatedText(node) && !(typeof label === 'string' && label.trim() !== '')) {
        violations.push({ rule: 'e-truncated-action', node: `${node.type} ${role ?? 'pressable'}`, detail: 'interactive element truncates its label via numberOfLines' });
      }
    }
    // (f) alert semantics: an element claiming role="alert" must actually
    // announce something — require non-empty descendant text. SCOPE NOTE:
    // this only proves "alerts carry content"; it does NOT prove every error
    // state on a screen uses a live region (that needs behavioural fixtures —
    // see primitives InlineError/Toast/Notice tests in tests/component which
    // pin the live-region/alert contract at the primitive level).
    if (p.accessibilityLiveRegion || role === 'alert') alertRegions += 1;
    if (role === 'alert' && textOf(node) === '') {
      violations.push({ rule: 'f-empty-alert', node: 'alert', detail: 'role="alert" element has no readable content' });
    }

    node.children?.forEach((child) => visit(child, [...ancestors, node]));
  };

  visit(root, []);
  return { elements, violations, unknownSize, alertRegions };
}
