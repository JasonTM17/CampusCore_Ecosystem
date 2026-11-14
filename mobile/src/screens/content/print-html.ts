// Cross-platform HTML printing: expo-print handles Android/iOS, but its stock
// web shim ignores the `html` option and prints the app page instead. On web we
// render the document into an off-DOM iframe and print that.

import { Platform } from 'react-native';

import * as Print from 'expo-print';

const printHtmlOnWeb = (html: string): Promise<void> =>
  new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.setAttribute('aria-hidden', 'true');
    document.body.appendChild(iframe);
    const win = iframe.contentWindow;
    if (!win) {
      iframe.remove();
      resolve();
      return;
    }
    const cleanup = () => {
      win.onafterprint = null;
      setTimeout(() => iframe.remove(), 0);
      resolve();
    };
    win.onafterprint = cleanup;
    // Some browsers never fire afterprint for iframes; resolve anyway.
    setTimeout(cleanup, 60_000);
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  });

export async function printHtmlDocument(html: string): Promise<void> {
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    await printHtmlOnWeb(html);
    return;
  }
  await Print.printAsync({ html });
}
