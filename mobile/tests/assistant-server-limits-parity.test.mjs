import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The Java service is the authority for the assistant limits; the mobile constants
// must equal what it enforces. Each value is read from the Java source, and the test
// fails loudly when a declaration moves instead of passing on a stale number.
const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assistantJava = path.resolve(
  mobileRoot,
  '../java-services/restful-api/src/main/java/io/campuscore/restfulapi/thesis/assistant',
);
const applicationYml = path.resolve(mobileRoot, '../java-services/restful-api/src/main/resources/application.yml');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-assistant-server-limits-'));

async function compile(relative) {
  const { outputText } = ts.transpileModule(fs.readFileSync(path.join(mobileRoot, relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  const target = path.join(tempRoot, path.basename(relative).replace('.ts', '.mjs'));
  fs.writeFileSync(target, outputText);
  return import(pathToFileURL(target).href);
}

const limits = await compile('src/api/assistant-limits.ts');
const read = (file) => fs.readFileSync(file, 'utf8');

function required(source, pattern, label) {
  const match = pattern.exec(source);
  assert.ok(match, `${label} declaration not found; the Java source moved`);
  return match;
}

test('message length equals the server request cap', () => {
  const dtos = read(path.join(assistantJava, 'ThesisAssistantDtos.java'));
  const cap = Number(required(dtos, /@Size\(max = (\d+), message = "message must contain at most/, 'ChatRequest.message cap')[1]);
  assert.equal(limits.ASSISTANT_MAX_MESSAGE_CHARS, cap);
  const properties = read(path.join(assistantJava, 'AssistantProperties.java'));
  assert.equal(Number(required(properties, /maxMessageChars = clamp\(maxMessageChars, \d+, ([\d_]+)\)/, 'maxMessageChars clamp')[1].replaceAll('_', '')), cap);
  assert.equal(Number(required(read(applicationYml), /max-message-chars: \$\{ASSISTANT_MAX_MESSAGE_CHARS:(\d+)\}/, 'max-message-chars')[1]), cap);
});

test('daily turn allowance equals the server default and ceiling', () => {
  const properties = read(path.join(assistantJava, 'AssistantProperties.java'));
  const ceiling = Number(required(properties, /userDailyQuota = clamp\(userDailyQuota, \d+, (\d+)\)/, 'userDailyQuota clamp')[1]);
  const configured = Number(required(read(applicationYml), /user-daily-quota: \$\{ASSISTANT_USER_DAILY_QUOTA:(\d+)\}/, 'user-daily-quota')[1]);
  assert.equal(limits.ASSISTANT_USER_DAILY_QUOTA, configured);
  assert.ok(limits.ASSISTANT_USER_DAILY_QUOTA <= ceiling);
});

test('scopes and feedback reasons equal the server patterns', () => {
  const dtos = read(path.join(assistantJava, 'ThesisAssistantDtos.java'));
  const scopes = required(dtos, /regexp = "\^\(([a-z|]+)\)\$", message = "scope must be/, 'scope pattern')[1].split('|');
  assert.deepEqual([...limits.ASSISTANT_SCOPES].sort(), scopes.sort());
  const reasons = required(dtos, /regexp = "\^\((HELPFUL[A-Z_|]+)\)\$",/, 'feedback reason pattern')[1].split('|');
  assert.deepEqual([...limits.ASSISTANT_FEEDBACK_REASONS].sort(), reasons.sort());
});

test('page sizes equal the server defaults and stay within the server clamps', () => {
  const repository = read(path.join(assistantJava, 'ThesisAssistantRepository.java'));
  const pattern = /int limit = Math\.max\(1, Math\.min\(requestedLimit <= 0 \? (\d+) : requestedLimit, (\d+)\)\);/g;
  const found = [...repository.matchAll(pattern)].map((match) => ({ fallback: Number(match[1]), max: Number(match[2]) }));
  assert.equal(found.length, 2, 'expected the conversation and message page clamps');
  const [conversations, messages] = found;
  assert.equal(limits.ASSISTANT_CONVERSATION_PAGE_SIZE, conversations.fallback);
  assert.ok(limits.ASSISTANT_CONVERSATION_PAGE_SIZE <= conversations.max);
  assert.equal(limits.ASSISTANT_MESSAGE_PAGE_SIZE, messages.fallback);
  assert.ok(limits.ASSISTANT_MESSAGE_PAGE_SIZE <= messages.max);
});
