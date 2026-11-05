// PreToolUse hook that stops the implementer subagent (.claude/agents/implementer.md) from editing test code and
// OpenSpec artifacts. Exit code 2 blocks the tool call and returns stderr to the agent.
// Registered in .claude/settings.json, not in the agent's frontmatter: frontmatter hooks did not run for subagents
// in C1's check (Claude Code 2.1.318, VS Code extension, 2026-11-05), settings hooks do. So it runs for every session
// and subagent, and restricts only the one whose agent_type is "implementer"; the main session and the test-writer
// pass. The orchestrator's git diff check is the primary guard (docs/conventions/testing.md § Test-first workflow);
// this hook is the second layer. Bash writes are not covered here; the diff check catches them.
import { readFileSync } from "node:fs";

const input = JSON.parse(readFileSync(0, "utf8"));

if (input?.agent_type !== "implementer") process.exit(0);

const raw = input?.tool_input?.file_path ?? "";
const path = raw.replace(/\\/g, "/");

// Folders the implementer may write in, in the groups that allow it (the orchestrator checks the group):
const allowed = [
  /\/tests\/RevolutReader\.AcceptanceTests\/Drivers\//i, // real driver methods, in [wiring] and [close]
  /\/tests\/RevolutReader\.IntegrationTests\/Wiring\//i, // adapter edge-case tests, in [wiring]
];

const denied = [
  /\/tests\//i,                    // any tests/ folder
  /\.Tests?\//i,                   // Foo.Tests/ or Foo.Test/ projects
  /Tests?\.csproj$/i,              // RevolutReader.UnitTests.csproj, Foo.Tests.csproj
  /\.(test|spec)\.[cm]?[jt]sx?$/i, // *.test.ts, *.spec.tsx, ...
  /\/openspec\//i,                 // specs, design and tasks are not the implementer's to change
];

if (allowed.some((r) => r.test(path))) process.exit(0);

if (denied.some((r) => r.test(path))) {
  console.error(
    `Blocked: ${raw} is test code or an OpenSpec artifact. The implementer must not change it. ` +
      `If you believe a test is wrong, stop and report STATUS: BLOCKED to the orchestrator.`
  );
  process.exit(2);
}

process.exit(0);
