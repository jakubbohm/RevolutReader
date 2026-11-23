// Tests for guard.mjs's pure functions: which paths are test code or OpenSpec artifacts the implementer must not
// change, the folders each step allows, how git's status list is read (renames included), and the report the
// check prints. Nothing here calls git; the paths are made up or name this repository's folders.
//
//   node --test ".claude/skills/tdd-apply/scripts/*.test.mjs"
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { guard, guardReport, isForbidden, parseStatus, STEPS } from "./guard.mjs";

const CHANGE = "c900-add-made-up-thing";
const forbidden = (path, step = "green") => isForbidden(path, step, CHANGE);

describe("isForbidden", () => {
  test("lets production code, docs and tooling through", () => {
    for (const path of [
      "src/RevolutReader.Api/Check/AccountCheck.cs",
      "src/RevolutReader.Web/src/app/transactions.ts",
      "src/RevolutReader.Web/src/components/Banner.tsx",
      "docs/conventions/testing.md",
      "CLAUDE.md",
      "infra/main.bicep",
      "Directory.Packages.props",
      ".claude/skills/tdd-apply/scripts/tdd.mjs",
    ]) {
      assert.equal(forbidden(path), false, path);
    }
  });

  test("refuses a path under any tests/ folder", () => {
    assert.equal(forbidden("tests/manual-scenarios.md"), true);
    assert.equal(forbidden("tests/RevolutReader.UnitTests/Check/AccountCheckTests.cs"), true);
    assert.equal(forbidden("tools/api-client/tests/export.js"), true);
    assert.equal(forbidden("Tests/Anything.cs"), true);
  });

  test("refuses a path inside a folder whose name contains Tests", () => {
    assert.equal(forbidden("src/Foo.Tests/Bar.cs"), true);
    assert.equal(forbidden("RevolutReader.UnitTests/Bar.cs"), true);
    assert.equal(forbidden("src/RevolutReader.Api/HarnessSelfTests/Bar.cs"), true);
    assert.equal(forbidden("src/TestsOfThings/deep/er/Bar.cs"), true);
  });

  test("refuses a path inside a Foo.Test or Foo.Tests project folder in any case, as the edit hook does", () => {
    assert.equal(forbidden("src/Foo.Test/Bar.cs"), true);
    assert.equal(forbidden("src/foo.tests/Bar.cs"), true);
  });

  test("does not take a folder that only holds the letters of `tests` for test code", () => {
    assert.equal(forbidden("src/contests/Entry.cs"), false);
    assert.equal(forbidden("src/Latests/Entry.cs"), false);
    assert.equal(forbidden("src/RevolutReader.Api/Tests.cs"), false, "a file, not a folder");
    assert.equal(forbidden("src/Attestation/Entry.cs"), false);
  });

  test("refuses a test project file", () => {
    assert.equal(forbidden("src/RevolutReader.UnitTests.csproj"), true);
    assert.equal(forbidden("src/Foo.Tests.csproj"), true);
    assert.equal(forbidden("src/Foo.Test.csproj"), true);
    assert.equal(forbidden("src/RevolutReader.Api/RevolutReader.Api.csproj"), false);
  });

  test("refuses the frontend's test kit", () => {
    assert.equal(forbidden("src/RevolutReader.Web/src/test/clock.ts"), true);
    assert.equal(forbidden("src/RevolutReader.Web/src/test/deep/er/server.ts"), true);
    assert.equal(forbidden("src/RevolutReader.Web/src/testing.ts"), false);
  });

  test("refuses a *.test.* or *.spec.* JavaScript or TypeScript file anywhere", () => {
    for (const ext of ["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"]) {
      assert.equal(forbidden(`src/RevolutReader.Web/src/app/device.test.${ext}`), true, `.test.${ext}`);
      assert.equal(forbidden(`src/RevolutReader.Web/src/app/device.spec.${ext}`), true, `.spec.${ext}`);
    }
    assert.equal(forbidden(".claude/skills/triage-review/scripts/common.test.mjs"), true);
    assert.equal(forbidden("src/RevolutReader.Web/src/app/DEVICE.TEST.TS"), true);
  });

  test("does not take another file with test or spec in its name for test code", () => {
    assert.equal(forbidden("src/RevolutReader.Web/src/app/contest.ts"), false);
    assert.equal(forbidden("src/RevolutReader.Web/src/app/device.test.md"), false);
    assert.equal(forbidden("src/RevolutReader.Web/src/app/spec.ts"), false);
    assert.equal(forbidden("docs/device.test.ts.md"), false);
  });

  test("refuses everything under openspec/", () => {
    assert.equal(forbidden("openspec/config.yaml"), true);
    assert.equal(forbidden("openspec/specs/account-check/spec.md"), true);
    assert.equal(forbidden(`openspec/changes/${CHANGE}/tasks.md`), true);
    assert.equal(forbidden(`openspec/changes/${CHANGE}/design.md`), true);
    assert.equal(forbidden(`openspec/changes/${CHANGE}/specs/account-check/spec.md`), true);
  });

  test("lets this change's state file and chapter reviews file through, and no other change's", () => {
    assert.equal(forbidden(`openspec/changes/${CHANGE}/.tdd-state.md`), false);
    assert.equal(forbidden(`openspec/changes/${CHANGE}/.chapter-reviews.md`), false);
    assert.equal(forbidden("openspec/changes/c901-another/.tdd-state.md"), true);
    assert.equal(forbidden("openspec/changes/c901-another/.chapter-reviews.md"), true);
    assert.equal(forbidden(`openspec/changes/archive/2026-11-23-${CHANGE}/.tdd-state.md`), true);
    assert.equal(forbidden(`openspec/changes/${CHANGE}/specs/.tdd-state.md`), true);
  });

  test("allows the acceptance drivers in wire and close, and not in green", () => {
    const driver = "tests/RevolutReader.AcceptanceTests/Drivers/FakeBank.cs";

    assert.equal(forbidden(driver, "green"), true);
    assert.equal(forbidden(driver, "wire"), false);
    assert.equal(forbidden(driver, "close"), false);
    assert.equal(forbidden("tests/RevolutReader.AcceptanceTests/Drivers/StandInPages/index.html", "close"), false);
  });

  test("allows the integration project's Wiring folder in wire only", () => {
    const wiring = "tests/RevolutReader.IntegrationTests/Wiring/BankAdapterEdgeCases.cs";

    assert.equal(forbidden(wiring, "green"), true);
    assert.equal(forbidden(wiring, "wire"), false);
    assert.equal(forbidden(wiring, "close"), true);
  });

  test("allows a step's folder even for a file that looks like a test, and nothing next to the folder", () => {
    assert.equal(forbidden("tests/RevolutReader.AcceptanceTests/Drivers/helper.test.ts", "wire"), false);
    assert.equal(forbidden("tests/RevolutReader.AcceptanceTests/Scenarios/AccountCheckScenarios.cs", "wire"), true);
    assert.equal(forbidden("tests/RevolutReader.AcceptanceTests/Dsl/Bank.cs", "close"), true);
    assert.equal(forbidden("tests/RevolutReader.AcceptanceTests/DriversToo/FakeBank.cs", "wire"), true);
    assert.equal(forbidden("tests/RevolutReader.IntegrationTests/Contracts/StoreContract.cs", "wire"), true);
    assert.equal(forbidden("other/tests/RevolutReader.AcceptanceTests/Drivers/FakeBank.cs", "wire"), true);
  });

  test("reads Windows-style paths as the same paths", () => {
    assert.equal(forbidden("tests\\RevolutReader.UnitTests\\Check\\AccountCheckTests.cs"), true);
    assert.equal(forbidden("src\\RevolutReader.Api\\Check\\AccountCheck.cs"), false);
    assert.equal(forbidden("src\\RevolutReader.Web\\src\\test\\clock.ts"), true);
    assert.equal(forbidden(`openspec\\changes\\${CHANGE}\\.tdd-state.md`), false);
    assert.equal(forbidden(`openspec\\changes\\${CHANGE}\\tasks.md`), true);
    assert.equal(forbidden("tests\\RevolutReader.AcceptanceTests\\Drivers\\FakeBank.cs", "wire"), false);
    assert.equal(forbidden("tests\\RevolutReader.IntegrationTests\\Wiring\\Edge.cs", "close"), true);
    assert.equal(forbidden(".\\src\\RevolutReader.Web\\src\\app\\device.test.ts"), true);
  });

  test("refuses a step it does not know", () => {
    assert.deepEqual(STEPS, ["green", "wire", "close"]);
    assert.throws(() => isForbidden("src/a.cs", "red", CHANGE), /green, wire, close/);
  });
});

describe("parseStatus", () => {
  // `git status --porcelain -z`: each entry is `XY <path>` and a NUL; a rename's old path follows as an entry of
  // its own, without a status.
  const z = (...entries) => entries.map((e) => `${e}\0`).join("");

  test("reads each entry's status and path", () => {
    assert.deepEqual(parseStatus(z(" M src/a.cs", "?? src/new folder/b.cs", "D  src/c.cs", "A  src/d.cs")), [
      { status: " M", path: "src/a.cs" },
      { status: "??", path: "src/new folder/b.cs" },
      { status: "D ", path: "src/c.cs" },
      { status: "A ", path: "src/d.cs" },
    ]);
  });

  test("reads a rename's new path and, from the entry after it, its old path", () => {
    assert.deepEqual(parseStatus(z("R  src/new.cs", "tests/Old.cs", " M src/a.cs", "RM src/x.cs", "src/w.cs")), [
      { status: "R ", path: "src/new.cs", from: "tests/Old.cs" },
      { status: " M", path: "src/a.cs" },
      { status: "RM", path: "src/x.cs", from: "src/w.cs" },
    ]);
  });

  test("reads a copy's source like a rename's old path", () => {
    assert.deepEqual(parseStatus(z("C  src/copy.cs", "src/original.cs")), [
      { status: "C ", path: "src/copy.cs", from: "src/original.cs" },
    ]);
  });

  test("keeps a path as git gives it: spaces, quotes, arrows and letters outside ASCII", () => {
    assert.deepEqual(parseStatus(z('?? src/a "quoted" -> name.cs', "?? src/Žluťoučký kůň.cs")), [
      { status: "??", path: 'src/a "quoted" -> name.cs' },
      { status: "??", path: "src/Žluťoučký kůň.cs" },
    ]);
  });

  test("gives no entries for a clean tree", () => {
    assert.deepEqual(parseStatus(""), []);
  });
});

describe("guard", () => {
  const entries = [
    { status: " M", path: "src/RevolutReader.Api/Check/AccountCheck.cs" },
    { status: " M", path: "tests/RevolutReader.UnitTests/Check/AccountCheckTests.cs" },
    { status: "??", path: "tests/RevolutReader.AcceptanceTests/Drivers/FakeBank.cs" },
    { status: " M", path: `openspec/changes/${CHANGE}/.tdd-state.md` },
  ];

  test("splits the changed paths into violations and the others, each in git's order", () => {
    const { violations, others } = guard(entries, "green", CHANGE);

    assert.deepEqual(
      violations.map((e) => e.path),
      [
        "tests/RevolutReader.UnitTests/Check/AccountCheckTests.cs",
        "tests/RevolutReader.AcceptanceTests/Drivers/FakeBank.cs",
      ],
    );
    assert.deepEqual(
      others.map((e) => e.path),
      ["src/RevolutReader.Api/Check/AccountCheck.cs", `openspec/changes/${CHANGE}/.tdd-state.md`],
    );
  });

  test("applies the step's allowed folders", () => {
    assert.deepEqual(
      guard(entries, "wire", CHANGE).violations.map((e) => e.path),
      ["tests/RevolutReader.UnitTests/Check/AccountCheckTests.cs"],
    );
  });

  test("counts a rename as a violation when its old or its new path is forbidden", () => {
    const moved = [
      { status: "R ", path: "src/RevolutReader.Api/Moved.cs", from: "tests/RevolutReader.UnitTests/Moved.cs" },
      { status: "R ", path: "tests/RevolutReader.UnitTests/Arrived.cs", from: "src/RevolutReader.Api/Arrived.cs" },
      { status: "R ", path: "src/RevolutReader.Api/New.cs", from: "src/RevolutReader.Api/Old.cs" },
    ];

    const { violations, others } = guard(moved, "green", CHANGE);

    assert.deepEqual(
      violations.map((e) => e.path),
      ["src/RevolutReader.Api/Moved.cs", "tests/RevolutReader.UnitTests/Arrived.cs"],
    );
    assert.deepEqual(
      others.map((e) => e.path),
      ["src/RevolutReader.Api/New.cs"],
    );
  });

  test("judges a copy by its new path only: its source did not change", () => {
    const copied = [
      { status: "C ", path: "src/RevolutReader.Api/Copy.cs", from: "tests/RevolutReader.UnitTests/Source.cs" },
    ];

    assert.deepEqual(guard(copied, "green", CHANGE).violations, []);
  });
});

describe("guardReport", () => {
  const entry = (i, folder = "src") => ({ status: " M", path: `${folder}/File${i}.cs` });

  test("says ok with the count, then each path with its status", () => {
    const result = {
      violations: [],
      others: [
        { status: " M", path: "src/a.cs" },
        { status: "??", path: "src/b.cs" },
        { status: "R ", path: "src/new.cs", from: "src/old.cs" },
      ],
    };

    assert.deepEqual(guardReport(result), [
      "ok: 3 changed paths",
      "   M src/a.cs",
      "  ?? src/b.cs",
      "  R  src/old.cs -> src/new.cs",
    ]);
  });

  test("says ok for a clean tree and for one path, the first line always in the same words", () => {
    assert.deepEqual(guardReport({ violations: [], others: [] }), ["ok: 0 changed paths"]);
    assert.deepEqual(guardReport({ violations: [], others: [entry(1)] }), ["ok: 1 changed paths", "   M src/File1.cs"]);
  });

  test("lists at most 60 paths, then how many more there are", () => {
    const others = Array.from({ length: 75 }, (_, i) => entry(i + 1));

    const lines = guardReport({ violations: [], others });

    assert.equal(lines.length, 62);
    assert.equal(lines[0], "ok: 75 changed paths");
    assert.equal(lines[60], "   M src/File60.cs");
    assert.equal(lines[61], "  … and 15 more");
  });

  test("lists exactly 60 paths without a count of more", () => {
    const lines = guardReport({ violations: [], others: Array.from({ length: 60 }, (_, i) => entry(i + 1)) });

    assert.equal(lines.length, 61);
    assert.equal(lines.at(-1), "   M src/File60.cs");
  });

  test("names the violations first, then the other changed paths", () => {
    const result = {
      violations: [
        { status: " M", path: "tests/RevolutReader.UnitTests/ATests.cs" },
        { status: "??", path: `openspec/changes/${CHANGE}/design.md` },
      ],
      others: [{ status: " M", path: "src/a.cs" }],
    };

    assert.deepEqual(guardReport(result), [
      "violations (2):",
      "   M tests/RevolutReader.UnitTests/ATests.cs",
      `  ?? openspec/changes/${CHANGE}/design.md`,
      "other changed paths (1):",
      "   M src/a.cs",
    ]);
  });

  test("leaves the second heading out when every changed path is a violation", () => {
    assert.deepEqual(guardReport({ violations: [entry(1, "tests")], others: [] }), [
      "violations (1):",
      "   M tests/File1.cs",
    ]);
  });

  test("caps each of the two lists at 60 paths", () => {
    const result = {
      violations: Array.from({ length: 61 }, (_, i) => entry(i + 1, "tests")),
      others: Array.from({ length: 62 }, (_, i) => entry(i + 1)),
    };

    const lines = guardReport(result);

    assert.equal(lines[0], "violations (61):");
    assert.equal(lines[61], "  … and 1 more");
    assert.equal(lines[62], "other changed paths (62):");
    assert.equal(lines.at(-1), "  … and 2 more");
    assert.equal(lines.length, 1 + 61 + 1 + 61);
  });
});
