import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const testsDirectory = dirname(fileURLToPath(import.meta.url));
const mobileDirectory = dirname(testsDirectory);
const packageJson = JSON.parse(readFileSync(join(mobileDirectory, "package.json"), "utf8"));
const discoveredFiles = readdirSync(testsDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
  .map((entry) => entry.name)
  .sort();

function testFilesFromCommand(command = "") {
  return Array.from(
    command.matchAll(/(?:^|\s)(tests\/[^\s]+\.test\.mjs)(?=\s|$)/g),
    ([, file]) => file.slice("tests/".length),
  );
}

const testCommand = packageJson.scripts.test ?? "";
const runnerCommand = "node scripts/run-node-tests.mjs";
const pretestFiles = testFilesFromCommand(packageJson.scripts.pretest);
let selection;
let requiredFiles = [];

if (testCommand === runnerCommand || testCommand.startsWith(runnerCommand + " ")) {
  const { getNodeTestSelection, getRequiredNodeTestFiles } = await import(
    "../scripts/run-node-tests.mjs"
  );
  selection = getNodeTestSelection(discoveredFiles);
  const runnerArguments = testCommand.slice(runnerCommand.length).trim().split(/\s+/).filter(Boolean);
  requiredFiles = getRequiredNodeTestFiles(runnerArguments);
} else {
  selection = {
    all: discoveredFiles,
    selected: testFilesFromCommand(testCommand),
    excluded: [],
  };
}

const exclusionReasons = new Map(
  selection.excluded.map(({ file, reason }) => [file, reason]),
);

test("every top-level Node test is selected or explicitly excluded with a reason", () => {
  const selectedFiles = new Set(selection.selected);
  const unaccountedFiles = discoveredFiles.filter((file) => {
    if (selectedFiles.has(file) || pretestFiles.includes(file)) return false;
    const reason = exclusionReasons.get(file);
    return typeof reason !== "string" || reason.trim().length === 0;
  });

  assert.deepEqual(
    unaccountedFiles,
    [],
    "Unaccounted tests/*.test.mjs files: " + unaccountedFiles.join(", "),
  );
});

test("npm test uses the bounded Node test discovery runner in stable order", () => {
  assert.ok(
    testCommand === runnerCommand || testCommand.startsWith(runnerCommand + " "),
  );
  assert.deepEqual(selection.all, discoveredFiles);
  assert.deepEqual(selection.selected, [...selection.selected].sort());
  assert.deepEqual([...requiredFiles].sort(), [
    "phase-six-repair.test.mjs",
    "screen-atlas.test.mjs",
  ]);
  assert.ok(requiredFiles.every((file) => selection.selected.includes(file)));
});

test("locale provider is included in the selected Node tests", () => {
  assert.ok(selection.selected.includes("locale-provider.test.mjs"));
});

test("check-in route is selected exactly once", () => {
  const lifecycleCount = [
    ...selection.selected,
    ...pretestFiles,
  ].filter((file) => file === "checkin-route.test.mjs").length;

  assert.equal(lifecycleCount, 1);
});

test("radius contract runs once through pretest and is excluded with a reason", () => {
  const radiusPretestCount = pretestFiles.filter(
    (file) => file === "radius-contract.test.mjs",
  ).length;

  assert.equal(radiusPretestCount, 1);
  assert.ok(!selection.selected.includes("radius-contract.test.mjs"));
  assert.match(
    exclusionReasons.get("radius-contract.test.mjs") ?? "",
    /pretest/i,
  );
});

test("every exclusion names a discovered file and has a non-empty reason", () => {
  for (const { file, reason } of selection.excluded) {
    assert.ok(discoveredFiles.includes(file), file + " is not a discovered Node test");
    assert.equal(typeof reason, "string");
    assert.ok(reason.trim().length > 0, file + " needs an exclusion reason");
  }
});

test("no Node test runs twice in one npm test lifecycle", () => {
  const duplicated = selection.selected.filter((file) =>
    pretestFiles.includes(file),
  );

  assert.deepEqual(duplicated, []);
});
