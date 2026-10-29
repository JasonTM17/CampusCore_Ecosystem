import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testsDirectory = resolve(mobileRoot, "tests");
const compareNames = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

const excludedNodeTests = new Map([
  ["radius-contract.test.mjs", "Runs once from the npm pretest script."],
]);

export function discoverNodeTestFiles() {
  return readdirSync(testsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
    .map((entry) => entry.name)
    .sort(compareNames);
}

export function getNodeTestSelection(files = discoverNodeTestFiles()) {
  const all = [...files].sort(compareNames);
  const selected = [];
  const excluded = [];

  for (const file of all) {
    const reason = excludedNodeTests.get(file);
    if (reason) {
      excluded.push({ file, reason });
    } else {
      selected.push(file);
    }
  }

  return { all, selected, excluded };
}

export function getRequiredNodeTestFiles(args = process.argv.slice(2)) {
  const required = [];

  if (args.length === 0) return required;
  if (args[0] !== "--required") {
    throw new Error("Unexpected Node test runner argument: " + args[0]);
  }

  for (const path of args.slice(1)) {
    if (
      !path ||
      !path.startsWith("tests/") ||
      path.includes("\\") ||
      path.slice("tests/".length).includes("/") ||
      !path.endsWith(".test.mjs")
    ) {
      throw new Error("Required Node tests must be top-level tests/*.test.mjs paths.");
    }

    const file = path.slice("tests/".length);
    if (required.includes(file)) {
      throw new Error("Required Node test was listed more than once: " + path);
    }
    required.push(file);
  }

  return required;
}

function runSelectedTests() {
  const { all, selected, excluded } = getNodeTestSelection();
  let required;

  try {
    required = getRequiredNodeTestFiles();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
    return;
  }

  const missingRequired = required.filter((file) => !selected.includes(file));
  if (missingRequired.length > 0) {
    console.error("Required Node tests were not discovered: " + missingRequired.join(", "));
    process.exitCode = 1;
    return;
  }

  console.log(
    "Node test selection: " +
      selected.length +
      " selected of " +
      all.length +
      "; " +
      excluded.length +
      " explicitly excluded.",
  );
  console.log("Required Node tests selected: " + required.length + ".");
  for (const file of selected) {
    console.log("RUN tests/" + file);
  }
  for (const { file, reason } of excluded) {
    console.log("SKIP tests/" + file + ": " + reason);
  }

  if (selected.length === 0) {
    console.log("SKIP: zero top-level Node tests selected.");
    return;
  }

  const result = spawnSync(
    process.execPath,
    ["--test", ...selected.map((file) => "tests/" + file)],
    { cwd: mobileRoot, stdio: "inherit" },
  );

  if (result.error) {
    console.error("Could not start the Node test runner: " + result.error.message);
    process.exitCode = 1;
    return;
  }

  process.exitCode = result.status ?? 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSelectedTests();
}
