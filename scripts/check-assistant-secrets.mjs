#!/usr/bin/env node

/**
 * Redacted, repository-scoped assistant secret hygiene gate.
 * It reports only a path, line and finding kind; matched credential material
 * is never printed. Ignored files (including local .env files) are excluded by
 * Git so developer credentials are not copied into CI output. Files whose
 * names match credential-store patterns are flagged even when their content
 * is unreadable or benign, unless the name carries a public/example suffix
 * or the path is listed in allowedPaths.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const ignoredDirectories = new Set([
  '.git',
  'node_modules',
  'target',
  '.next',
  '.expo',
  'dist',
  'build',
]);
const credentialStoreDirectories = new Set([
  '.aws',
  '.azure',
  '.ssh',
  '.gnupg',
  '.docker',
  '.kube',
  '.terraform',
  '.gcloud',
  '.ngrok2',
]);
const allowedNameSuffixes = ['.example', '.sample', '.template', '.pub'];
const allowedPaths = new Set([]);
const namePatterns = [
  ['dotenv-file', /^\.env(\..+)?$/],
  ['dotenv-file', /^\.envrc$/],
  ['key-material-file', /\.(pem|key|p12|pfx|p8|jks|keystore|mobileprovision|cer|crt|der)$/i],
  ['ssh-key-file', /^id_(rsa|dsa|ecdsa|ed25519)/],
  [
    'credential-store-file',
    /^(google-services\.json|GoogleService-Info\.plist|credentials\.json|secrets\.json|secrets\..+\.json|service[-_]account.*\.json|.*-service[-_]account.*\.json|client_secret.*\.json|.*\.local\.json|eas\.json\.local|ngrok\.ya?ml|cloudflared\.ya?ml|credentials\.db)$/,
  ],
  ['credential-store-file', /^\.npmrc$/],
  ['credential-store-file', /^\.netrc$/],
  ['credential-store-file', /\.(tfvars|tfstate|kdbx|ovpn|gpg)$/i],
  ['credential-store-file', /\.tfstate\..+$/i],
  ['data-dump-file', /\.(dump|pgdump|dmp|bak|har|heapdump|hprof|rdb)$/i],
  ['data-dump-file', /^dump\.sql$/i],
  ['data-dump-file', /\.sql\.(gz|zip|bz2|xz)$/i],
  ['shell-history-file', /^\.(bash_history|zsh_history|pshistory|node_repl_history|python_history|irb_history)$/],
];
const contentPatterns = [
  ['provider-key', /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ['bearer-token', /\bBearer\s+[A-Za-z0-9._~+/=-]{24,}/i],
  ['private-key-block', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY( BLOCK)?-----/],
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/],
  ['github-token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/],
];

const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard'],
  { cwd: root, encoding: 'utf8' },
)
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((file) => !file.split(/[\\/]/).some((part) => ignoredDirectories.has(part)));

const findings = [];
for (const relative of files) {
  const segments = relative.split(/[\\/]/);
  const basename = segments[segments.length - 1];
  const allowlisted =
    allowedPaths.has(relative) ||
    allowedNameSuffixes.some((suffix) => basename.endsWith(suffix));
  if (!allowlisted) {
    if (segments.some((part) => credentialStoreDirectories.has(part))) {
      findings.push({ file: relative, kind: 'credential-store-file' });
    } else {
      for (const [kind, pattern] of namePatterns) {
        if (pattern.test(basename)) {
          findings.push({ file: relative, kind });
          break;
        }
      }
    }
  }
  const absolute = path.join(root, relative);
  let text;
  try {
    text = readFileSync(absolute, 'utf8');
  } catch {
    continue;
  }
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const [kind, pattern] of contentPatterns) {
      if (pattern.test(line)) findings.push({ file: relative, line: index + 1, kind });
    }
  });
}

if (findings.length > 0) {
  for (const finding of findings) {
    const location = finding.line ? `${finding.file}:${finding.line}` : finding.file;
    console.error(`assistant-secret-check: ${finding.kind} at ${location}`);
  }
  process.exitCode = 1;
} else {
  console.log(`assistant-secret-check: PASS (${files.length} git-visible files scanned; values redacted)`);
}
