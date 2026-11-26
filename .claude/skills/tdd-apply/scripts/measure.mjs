// What one /tdd-apply or /triage-review run cost, read from Claude Code's own transcripts after the run (GitHub
// issue 67). Run by hand, never in CI; it only reads, and prints plain text:
//
//   node .claude/skills/tdd-apply/scripts/measure.mjs <main session's transcript .jsonl> [more transcripts]
//        [--from <ISO time>] [--to <ISO time>]
//
// The transcript of a session is `<Claude's projects folder>/<project>/<session id>.jsonl`; its agents' transcripts
// lie next to it, in `<session id>/subagents/` (`agent-<id>.jsonl` with `agent-<id>.meta.json`, a workflow's agents
// one folder deeper), and are found from there. Name a second transcript when the run went on in a new session.
// `--from` and `--to` cut the run out of a longer session (2026-05-03T09:00:00Z; without a zone: local time).
//
// It prints
// - per agent, the main session first and every agent under the one that started it: the context at its first and
//   last API call and the largest, its own output, what it took in, and its tool calls by kind;
// - for the run: the working time, the completed steps with the working minutes of each (and the slices' average
//   and median), the weighted tokens by agent type, and what the runners' progress notes cost the main session.
//
// How the numbers are made:
// - One API call is one message id. Its records (one per block of the answer) all repeat the call's usage; the
//   last one counts. The context of a call is everything it was sent: input + cache reads + cache writes.
// - Taken in: what came into the context between two calls beyond the agent's own output (tool results, messages,
//   attached rules). A step in which the context got smaller is a cut (a compaction) and is counted apart.
// - Weighted tokens: input + 1.25 × cache written for 5 minutes + 2 × cache written for 1 hour + 0.1 × cache read
//   + 5 × output: the ratios between Anthropic's price classes, in input tokens of the row's model; not a price.
// - Working time: the time from the first to the last record minus every standstill of the whole run (the main
//   session and all agents) that ended with input from outside: the owner's typing or command, an answer to a
//   question dialog, a message from another session.
// - A progress note is a runner's message to the main session that is one line ending in `completed at HH:MM`
//   (`tdd.mjs progress`). One that arrives while the main session is idle starts a turn of its own, and that turn's
//   API calls are its cost.
// - A step is what a runner reports done through the bookkeeping script (`tdd.mjs commit … --done "<step>"`,
//   `tdd.mjs progress --step "<step>"`); stepsOf says what counts in a transcript from before those. Its working
//   minutes run from the step before it, without the waits.
// - Shell calls (Bash and PowerShell) are read as commands: classifyShell says how.
//
// What it does not see: a wait for a permission prompt (that is working time here); an input the owner typed while
// the main session was working (it ends no standstill); what a script file run by its path did, beyond the
// harness's own record of changed files.
//
// The pure parts are exported and tested in measure.test.mjs on made-up transcripts (fixtures/measure/); only
// loadRun and main touch files. Of a transcript's texts it prints only the agents' short descriptions, the names
// of slash commands and the steps' names (in an older transcript: a step commit's tag and summary); never a
// prompt, a report, a command or a tool's output.
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const USAGE = `node .claude/skills/tdd-apply/scripts/measure.mjs <main session's transcript .jsonl> [more transcripts]
     [--from <ISO time>] [--to <ISO time>]`;

// --- Tokens ---------------------------------------------------------------------------------------------------

// One API call's usage as the five price classes and the context it was sent. A usage that does not say for how
// long its cache was written (an older transcript) counts as written for 5 minutes, the default.
export function readUsage(usage) {
  const split = usage.cache_creation ?? {};
  const write5m = split.ephemeral_5m_input_tokens ?? 0;
  const write1h = split.ephemeral_1h_input_tokens ?? 0;
  const written = usage.cache_creation_input_tokens ?? write5m + write1h;
  const input = usage.input_tokens ?? 0;
  const read = usage.cache_read_input_tokens ?? 0;
  return {
    input,
    write5m: write5m + write1h === 0 ? written : write5m,
    write1h,
    read,
    output: usage.output_tokens ?? 0,
    context: input + read + written,
  };
}

export function weighted(tokens) {
  return tokens.input + 1.25 * tokens.write5m + 2 * tokens.write1h + 0.1 * tokens.read + 5 * tokens.output;
}

const PRICE_CLASSES = ["input", "write5m", "write1h", "read", "output"];

// --- Shell commands -------------------------------------------------------------------------------------------

// One shell call as its simple commands, in order: each one's `words` (quotes removed), the files its output is
// redirected into (`writes`) and the texts of its here-documents (`heredocs`). A variable the call itself sets
// (`T="node tdd.mjs"; $T run …`) is replaced where it is used, split into words when unquoted, as the shell does;
// any other variable stays as written. A command inside `$(…)` or backticks is listed too, before the command that
// holds it. Good enough to tell what a call does; not a shell.
export function shellCommands(command, { powershell = false, vars = new Map() } = {}) {
  const text = String(command ?? "");
  const end = text.length;
  const commands = [];
  const waiting = []; // here-documents whose text starts after the next line break
  let current = { words: [], writes: [], heredocs: [] };
  let word = null; // the word being read; null between words
  let next = "word"; // what the next word is: a word, the file of a redirection ("write"), or nothing to keep
  let i = 0;
  const escape = powershell ? "`" : "\\";

  const endWord = () => {
    if (word === null) return;
    if (next === "write") current.writes.push(word);
    else if (next === "word") current.words.push(word);
    word = null;
    next = "word";
  };
  const endCommand = () => {
    endWord();
    next = "word";
    remember(current.words, vars);
    if (current.words.length + current.writes.length + current.heredocs.length > 0) commands.push(current);
    current = { words: [], writes: [], heredocs: [] };
  };
  const add = (piece) => {
    word = (word ?? "") + piece;
  };
  // A variable's value where it is used: inside quotes as it is, outside split into words.
  const expand = (name, written, quoted) => {
    if (!vars.has(name)) return add(written);
    if (quoted) return add(vars.get(name));
    const [first, ...more] = vars.get(name).split(/\s+/).filter(Boolean);
    if (first !== undefined) add(first);
    for (const piece of more) {
      endWord();
      add(piece);
    }
  };
  // What follows a `$` at i: a command's output, a variable, or the character itself.
  const dollar = (quoted) => {
    if (text[i + 1] === "(") {
      const close = closingParenthesis(text, i + 2);
      commands.push(...shellCommands(text.slice(i + 2, close), { powershell, vars: new Map(vars) }));
      add(text.slice(i, close + 1));
      i = close + 1;
      return;
    }
    const ahead = text.slice(i, i + 120);
    const scoped = powershell ? /^\$[A-Za-z_][A-Za-z0-9_]*:[A-Za-z_][A-Za-z0-9_]*/.exec(ahead) : null; // $env:TEMP
    const named = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}/.exec(ahead) ?? /^\$([A-Za-z_][A-Za-z0-9_]*)/.exec(ahead);
    if (scoped) add(scoped[0]);
    else if (named) expand(named[1], named[0], quoted);
    else add("$");
    i += (scoped ?? named)?.[0].length ?? 1;
  };
  const heredocs = () => {
    for (const doc of waiting.splice(0)) {
      const lines = [];
      while (i < end) {
        const stop = text.indexOf("\n", i);
        const line = text.slice(i, stop === -1 ? end : stop).replace(/\r$/, "");
        i = stop === -1 ? end : stop + 1;
        if ((doc.strip ? line.replace(/^\t+/, "") : line) === doc.delimiter) break;
        lines.push(line);
      }
      doc.command.heredocs.push(lines.join("\n"));
    }
  };

  while (i < end) {
    const c = text[i];
    const after = text[i + 1];
    if (c === "\n") {
      endCommand();
      i += 1;
      heredocs();
    } else if (c === " " || c === "\t" || c === "\r") {
      endWord();
      i += 1;
    } else if (c === escape && after !== undefined) {
      if (after !== "\n") add(after); // an escaped line break joins two lines
      i += 2;
    } else if (powershell && c === "@" && (after === "'" || after === '"') && /^[ \t]*\r?\n/.test(text.slice(i + 2))) {
      const close = text.indexOf(`\n${after}@`, i + 2); // a PowerShell here-string
      add(text.slice(text.indexOf("\n", i) + 1, close === -1 ? end : close));
      i = close === -1 ? end : close + 3;
    } else if (c === "'") {
      const close = text.indexOf("'", i + 1);
      add(text.slice(i + 1, close === -1 ? end : close));
      i = close === -1 ? end : close + 1;
    } else if (c === '"') {
      add("");
      i += 1;
      while (i < end && text[i] !== '"') {
        if (text[i] === escape && i + 1 < end) {
          const escaped = text[i + 1];
          if (escaped !== "\n") add(powershell || '"\\$`'.includes(escaped) ? escaped : `\\${escaped}`);
          i += 2;
        } else if (text[i] === "$") dollar(true);
        else add(text[i++]);
      }
      i += 1;
    } else if (c === "$" && after === "'") {
      const close = text.indexOf("'", i + 2);
      add(text.slice(i + 2, close === -1 ? end : close));
      i = close === -1 ? end : close + 1;
    } else if (c === "$") {
      dollar(false);
    } else if (c === "`") {
      const close = text.indexOf("`", i + 1); // not PowerShell: there the backtick was read as the escape above
      const inner = text.slice(i + 1, close === -1 ? end : close);
      commands.push(...shellCommands(inner, { powershell, vars: new Map(vars) }));
      add(`\`${inner}\``);
      i = close === -1 ? end : close + 1;
    } else if (c === "#" && word === null) {
      const stop = text.indexOf("\n", i);
      i = stop === -1 ? end : stop;
    } else if (word === null && (text.startsWith("((", i) || text.startsWith("[[ ", i))) {
      const close = text.indexOf(c === "(" ? "))" : " ]]", i + 2); // arithmetic or a test: its `>` compares
      i = close === -1 ? end : close + (c === "(" ? 2 : 3);
    } else if (c === ";") {
      endCommand();
      i += 1;
    } else if (c === "|") {
      endCommand();
      i += after === "|" || after === "&" ? 2 : 1;
    } else if (c === "&" && after === ">") {
      endWord(); // &> file: both outputs into a file
      i += text[i + 2] === ">" ? 3 : 2;
      next = "write";
    } else if (c === "&") {
      endCommand();
      i += after === "&" ? 2 : 1;
    } else if (c === ">") {
      if (word !== null && /^\d+$/.test(word)) word = null; // 2> file: the number belongs to the operator
      endWord();
      i += after === ">" || after === "|" ? 2 : 1;
      if (text[i] === "&" && /[\d-]/.test(text[i + 1] ?? "")) {
        i += 1; // 2>&1: into another output, no file
        while (/[\d-]/.test(text[i] ?? "")) i += 1;
      } else {
        if (text[i] === "&") i += 1;
        next = "write";
      }
    } else if (c === "<" && after === "<" && text[i + 2] !== "<") {
      endWord();
      i += 2;
      const strip = text[i] === "-";
      const name = /^-?[ \t]*(?:'([^'\n]*)'|"([^"\n]*)"|\\?([^\s;&|<>()]+))/.exec(text.slice(i, i + 200));
      i += name ? name[0].length : 0;
      if (name) waiting.push({ delimiter: name[1] ?? name[2] ?? name[3], strip, command: current });
    } else if (c === "<") {
      if (word !== null && /^\d+$/.test(word)) word = null;
      endWord();
      i += text.startsWith("<<<", i) ? 3 : 1;
      if (text[i] === "&") {
        i += 1;
        while (/[\d-]/.test(text[i] ?? "")) i += 1;
      } else next = "skip"; // the file or the text a command reads is not a word of it
    } else if (c === "(" || c === ")") {
      endWord(); // grouping
      i += 1;
    } else {
      add(c);
      i += 1;
    }
  }
  endCommand();
  return commands;
}

// Where the `)` of a `$(` is, given the place after the `(`: quotes and inner parentheses skipped.
function closingParenthesis(text, start) {
  let depth = 1;
  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    if (c === "\\") i += 1;
    else if (c === "'" || c === '"') {
      const close = text.indexOf(c, i + 1);
      if (close === -1) return text.length;
      i = close;
    } else if (c === "(") depth += 1;
    else if (c === ")" && --depth === 0) return i;
  }
  return text.length;
}

const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/;
const DECLARING = new Set(["export", "local", "declare", "readonly", "typeset"]);

// Keeps what a command that only sets variables sets: `T="node x"`, `export A=1 B=2`, PowerShell's `$T = "x"`.
function remember(words, vars) {
  if (words.length === 3 && /^\$[A-Za-z_]\w*$/.test(words[0]) && words[1] === "=") {
    vars.set(words[0].slice(1), words[2]);
    return;
  }
  const set = DECLARING.has(words[0]) ? words.slice(1) : words;
  if (set.length === 0 || !set.every((w) => ASSIGNMENT.test(w))) return;
  for (const w of set) {
    const [, name, value] = ASSIGNMENT.exec(w);
    vars.set(name, value);
  }
}

// Words before the command itself: shell keywords, and commands that only start another one.
const LEADING = new Set(
  "do then else elif if while until ! { } time exec command builtin nohup sudo env fi done".split(" "),
);
// Options of such commands that take a value.
const TIMEOUT_VALUED = new Set(["-s", "--signal", "-k", "--kill-after"]);
const XARGS_VALUED = new Set(["-n", "-I", "-P", "-L", "-d", "-s", "-E", "-a"]);

const DOTNET_RUNS = new Set(["test", "build", "run", "format", "publish", "msbuild", "pack", "restore"]);
const NPM_RUNS = new Set(["test", "t", "tst", "run", "run-script", "exec", "x"]);
const NPM_VALUED = new Set(["--prefix", "-C", "--workspace", "-w"]);
const BUILD_TOOLS = new Set(["npx", "vitest", "tsc", "tsgo", "eslint", "oxlint", "prettier"]);
const READERS = new Set(["cat", "head", "tail", "nl", "less", "more", "bat", "get-content", "gc"]);
const READER_VALUED = new Set(["-n", "-c", "--lines", "--bytes"]);
const WRITERS = new Set(["tee", "tee-object", "set-content", "add-content", "out-file"]);
// PowerShell parameters of the cmdlets above: those that name the file, and the others that take a value.
const CMDLET_FILE = new Set(["-path", "-literalpath", "-filepath"]);
const CMDLET_VALUED = new Set(
  "-totalcount -tail -first -last -head -encoding -delimiter -readcount -value -width -inputobject".split(" "),
);
const NODE_VALUED = new Set(["-r", "--require", "--import", "--loader", "--experimental-loader", "--env-file", "-C"]);
const PYTHON_VALUED = new Set(["-W", "-X", "-m"]);
const SHELLS = new Set(["bash", "sh", "zsh", "pwsh", "powershell"]);

// What file-writing code looks like in a script given on the command line.
const NODE_WRITES =
  /\b(?:writeFile|appendFile|copyFile|rename)(?:Sync)?\s*\(|\b(?:rm|unlink)Sync\s*\(|\bcreateWriteStream\s*\(/;
const PYTHON_WRITES = new RegExp(
  [
    // open(path, "w"): a mode of its own letters that writes, appends or creates; a path's text is no mode
    String.raw`\bopen\s*\([^)\n]*,\s*(?:mode\s*=\s*)?["'](?=[rwaxbt+]{1,4}["'])[rbt]*[wax+]`,
    String.raw`\.write_(?:text|bytes)\s*\(`,
    String.raw`\bshutil\.(?:copy\w*|move)\s*\(`,
    String.raw`\bos\.(?:remove|rename|replace|unlink)\s*\(`,
  ].join("|"),
);
const POWERSHELL_WRITES = /\[(?:System\.)?IO\.File\]::(?:Write|Append)/i;

// Variables that name a place outside any repository: the temp folders and the user's own.
const OUTSIDE_VARIABLES = /^(?:TMP|TEMP|TMPDIR|HOME|USERPROFILE|APPDATA|LOCALAPPDATA)$/i;

const fileName = (word) => word.replace(/^.*[\\/]/, "");
const commandName = (word) =>
  fileName(word)
    .replace(/\.(?:exe|cmd|bat)$/i, "")
    .toLowerCase();

// A path with `/` between its parts, `.` and `..` worked out, and Git Bash's `/d/…` as the drive `d:/…` when the
// repository is on a drive. Drive paths in lower case: Windows does not tell the cases apart.
function normalised(path, onDrive) {
  let p = path.replace(/\\/g, "/");
  if (onDrive && /^\/[A-Za-z](\/|$)/.test(p)) p = `${p[1]}:${p.slice(2) || "/"}`;
  const drive = /^[A-Za-z]:/.test(p) ? p.slice(0, 2) : "";
  const absolute = drive ? p[2] === "/" : p.startsWith("/");
  const parts = [];
  for (const part of p.slice(drive.length).split("/")) {
    if (part === "" || part === ".") continue;
    if (part === ".." && parts.length > 0 && parts.at(-1) !== "..") parts.pop();
    else parts.push(part);
  }
  const whole = `${drive}${absolute ? "/" : ""}${parts.join("/")}`;
  return onDrive ? whole.toLowerCase() : whole;
}

const isAbsolute = (path) => /^(?:[A-Za-z]:)?\//.test(path);
// Temp folders by their path, for a transcript that does not say where the repository is.
const TEMP_PATH = /^\/(?:tmp|var\/tmp)(?:\/|$)|\/AppData\/Local\/Temp(?:\/|$)/i;

// Where a shell call's path lies: "inside" the repository (the folder `root`), "outside" it, or "unknown".
// `folder` is where the command runs: `root` or a folder a `cd` named; "" when the transcript does not say where
// the repository is (a relative path is then taken as the repository's); null after a `cd` that cannot be
// followed. Outside are also the null device, the user's own folder, the temp folders by their variables, and the
// repository's git folder; unknown is a path that holds any other variable the call did not set, or a command's
// output.
function located(path, { root, folder }) {
  const raw = path.trim();
  if (raw === "" || raw === "-") return "unknown";
  if (/^(?:\/dev\/|NUL$|\$null$|~)/i.test(raw)) return "outside";
  if (/\$\(|`/.test(raw)) return /\bmktemp\b/.test(raw) ? "outside" : "unknown";
  const variable = /\$(?:env:)?\{?([A-Za-z_][A-Za-z0-9_]*)|%([A-Za-z_][A-Za-z0-9_]*)%/.exec(raw);
  if (variable) return OUTSIDE_VARIABLES.test(variable[1] ?? variable[2]) ? "outside" : "unknown";
  const onDrive = /^[A-Za-z]:/.test(root ?? "");
  let whole = normalised(raw, onDrive);
  if (!isAbsolute(whole)) {
    if (folder === null) return "unknown";
    if (!isAbsolute(normalised(folder, onDrive))) return "inside";
    whole = normalised(`${folder}/${whole}`, onDrive);
  }
  if (root === null) return TEMP_PATH.test(whole) ? "outside" : "unknown";
  const top = normalised(root, onDrive);
  if (whole !== top && !whole.startsWith(`${top}/`)) return "outside";
  return /^\.git(\/|$)/.test(whole.slice(top.length + 1)) ? "outside" : "inside";
}

// The arguments of a command that are not options, the values of the options in `valued` left out.
function plainArguments(args, valued = new Set()) {
  const plain = [];
  for (let k = 0; k < args.length; k += 1) {
    if (args[k] === "--") return [...plain, ...args.slice(k + 1)];
    if (valued.has(args[k])) k += 1;
    else if (!/^[-+]./.test(args[k])) plain.push(args[k]);
  }
  return plain;
}

// What a cmdlet names as its file: `-Path x` (or -LiteralPath, -FilePath), else its first plain argument.
function cmdletFiles(args) {
  const files = [];
  const plain = [];
  for (let k = 0; k < args.length; k += 1) {
    const option = args[k].toLowerCase();
    if (CMDLET_FILE.has(option)) files.push(args[++k] ?? "");
    else if (CMDLET_VALUED.has(option)) k += 1;
    else if (!args[k].startsWith("-")) plain.push(args[k]);
  }
  return files.length > 0 ? files : plain.slice(0, 1);
}

// sed's arguments: whether it changes its files in place, and the files (its script is the first plain argument
// unless -e or -f gave one).
function sedArguments(args) {
  let inPlace = false;
  let scripted = false;
  const plain = [];
  for (let k = 0; k < args.length; k += 1) {
    const a = args[k];
    if (a === "--") {
      plain.push(...args.slice(k + 1));
      break;
    }
    if (/^--in-place/.test(a) || /^-[nErsuzb]*i/.test(a)) inPlace = true;
    else if (/^-[nErsuzb]*[ef]$/.test(a) || a === "--expression" || a === "--file") {
      scripted = true;
      k += 1;
    } else if (/^--(?:expression|file)=/.test(a)) scripted = true;
    else if (a === "-l" || a === "--line-length") k += 1;
    else if (!/^-./.test(a)) plain.push(a);
  }
  return { inPlace, files: scripted ? plain : plain.slice(1) };
}

// How node or python was started: the script text given on the command line, the script file, or neither, which
// means it reads its script from a here-document or a pipe.
function interpreterArguments(args, inlineOptions, valued) {
  for (let k = 0; k < args.length; k += 1) {
    if (inlineOptions.has(args[k])) return { inline: args[k + 1] ?? "", after: args.slice(k + 2) };
    if (args[k] === "-") return { after: args.slice(k + 1) };
    if (valued.has(args[k])) k += 1;
    else if (!args[k].startsWith("-")) return { file: args[k], after: args.slice(k + 1) };
  }
  return { after: [] };
}

const NODE_INLINE = new Set(["-e", "--eval", "-p", "--print", "-pe"]);
const PYTHON_INLINE = new Set(["-c"]);

// A command's words from the command itself on: without the keywords, the variables set for it, `timeout 60` and
// `xargs -0` before it.
function withoutLeading(words) {
  let rest = words;
  for (;;) {
    const first = rest[0];
    if (first === undefined) return rest;
    const name = commandName(first);
    if (LEADING.has(first) || ASSIGNMENT.test(first)) rest = rest.slice(1);
    else if (name === "timeout") {
      rest = rest.slice(1);
      while (rest[0]?.startsWith("-")) rest = rest.slice(TIMEOUT_VALUED.has(rest[0]) ? 2 : 1);
      rest = rest.slice(1); // the time
    } else if (name === "xargs") {
      rest = rest.slice(1);
      while (rest[0]?.startsWith("-")) rest = rest.slice(XARGS_VALUED.has(rest[0]) ? 2 : 1);
    } else return rest;
  }
}

// The bookkeeping script's command in a shell command, `node …/tdd.mjs <command> <arguments>`, or null.
function tddCall(words) {
  if (words.length === 0 || commandName(words[0]) !== "node") return null;
  const started = interpreterArguments(words.slice(1), NODE_INLINE, NODE_VALUED);
  if (started.file === undefined || fileName(started.file) !== "tdd.mjs") return null;
  return { command: started.after[0], args: started.after.slice(1) };
}

// The value of an option among a command's arguments, `--name value` or `--name=value`; null when it is not there.
function optionValue(args, name) {
  const at = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (at === -1) return null;
  return args[at] === `--${name}` ? (args[at + 1] ?? null) : args[at].slice(name.length + 3);
}

// The steps one shell call reports through the bookkeeping script, in order: for `tdd.mjs commit`
// { kind: "commit", tag, summary, done } (null for an option it does not give), for `tdd.mjs progress --step <text>`
// { kind: "progress", step }. The wrapper is found as in classifyShell, also behind a variable of the call.
export function stepCalls(command, { powershell = false } = {}) {
  const found = [];
  for (const { words } of shellCommands(command, { powershell })) {
    const call = tddCall(withoutLeading(words));
    if (call?.command === "commit") {
      const value = (name) => optionValue(call.args, name);
      found.push({ kind: "commit", tag: value("tag"), summary: value("summary"), done: value("done") });
    } else if (call?.command === "progress" && optionValue(call.args, "step") !== null) {
      found.push({ kind: "progress", step: optionValue(call.args, "step") });
    }
  }
  return found;
}

// What one shell call (the text of a Bash or PowerShell tool call) does, as far as its text shows:
// - `scriptEdit`: it changes a file of the repository without Edit or Write: `sed -i`, `perl -i`, `awk -i inplace`,
//   output redirected into a file (`>`, `>>`, a here-document into `cat > file`), `tee` and PowerShell's
//   Set-Content, Add-Content and Out-File, `patch`, `git apply`, or a node or python script given on the command
//   line or in a here-document that holds file-writing code. A target plainly outside the repository (a temp
//   folder, the null device) does not count; one that cannot be told does.
// - `outsideScript`: it runs a node or python script file from outside the repository. Whether that changed files
//   the text cannot show: readTranscript counts it as a script edit when the harness recorded changed files.
// - `reads`: its commands whose plain purpose is to read a file of the repository: cat, head, tail, nl, less, more
//   and sed without -i (PowerShell: Get-Content) given a path inside the repository. A `| tail` on another
//   command's output has no path and is not one; a log or a spilled tool result outside the repository neither.
// - `wrapped`: its test and build runs through the wrapper, `tdd.mjs run`.
// - `bare`: its test and build commands not going through it: `dotnet test|build|run|format|publish|msbuild|pack|
//   restore`, `npm test|run|exec`, `npx …`, `vitest`, `tsc`, `tsgo`, `eslint`, `oxlint`, `prettier`, `node --test`.
// `root` is the repository's folder and `cwd` the folder the call starts in (both from the transcript); a `cd`
// inside the call moves what its later commands' relative paths mean.
export function classifyShell(command, { root = null, cwd = root, powershell = false } = {}) {
  const found = { scriptEdit: false, outsideScript: false, reads: 0, wrapped: 0, bare: 0 };
  const state = { root, folder: cwd ?? root ?? "", powershell, found };
  if (powershell && POWERSHELL_WRITES.test(String(command ?? ""))) found.scriptEdit = true;
  for (const one of shellCommands(command, { powershell })) classifyCommand(one, state);
  return found;
}

function classifyCommand({ words, writes, heredocs }, state) {
  const { found } = state;
  const where = () => ({ root: state.root, folder: state.folder });
  // Counts as a change of the repository: some target that is not plainly outside it, or no target named at all.
  const mayBeInside = (targets) => targets.length === 0 || targets.some((t) => located(t, where()) !== "outside");
  if (writes.length > 0 && writes.some((t) => located(t, where()) !== "outside")) found.scriptEdit = true;

  const rest = withoutLeading(words);
  if (rest.length === 0) return;
  const bookkeeping = tddCall(rest);
  if (bookkeeping !== null) {
    if (bookkeeping.command === "run") found.wrapped += 1; // what it wraps is not a command of the call
    return;
  }
  const name = commandName(rest[0]);
  const args = rest.slice(1);

  if (name === "cd" || name === "pushd" || name === "set-location") {
    // The folder the call's later commands run in; one that cannot be followed leaves it unknown.
    const to = plainArguments(args)[0] ?? "";
    const followed = to !== "" && to !== "-" && !/[$`%~]/.test(to);
    const target = followed ? normalised(to, /^[A-Za-z]:/.test(state.root ?? "")) : null;
    if (target === null || state.folder === null) state.folder = null;
    else state.folder = isAbsolute(target) || state.folder === "" ? target : `${state.folder}/${target}`;
  } else if (SHELLS.has(name)) {
    // bash -c "…": the commands in the text it is given.
    const at = args.findIndex((a) => /^-(?:l?c|command)$/i.test(a));
    if (at !== -1 && args[at + 1] !== undefined) {
      const inner = { ...state, powershell: name === "pwsh" || name === "powershell" };
      for (const one of shellCommands(args[at + 1], { powershell: inner.powershell })) classifyCommand(one, inner);
    }
  } else if (name === "find") {
    const at = args.findIndex((a) => a === "-exec" || a === "-execdir" || a === "-ok");
    if (at !== -1) {
      const stop = args.findIndex((a, k) => k > at && (a === ";" || a === "+"));
      const inner = args.slice(at + 1, stop === -1 ? undefined : stop).filter((a) => a !== "{}");
      classifyCommand({ words: inner, writes: [], heredocs: [] }, state);
    }
  } else if (name === "sed") {
    const { inPlace, files } = sedArguments(args);
    if (inPlace && mayBeInside(files)) found.scriptEdit = true;
    if (!inPlace && files.some((f) => located(f, where()) === "inside")) found.reads += 1;
  } else if (name === "perl") {
    const files = args.filter((a, k) => !a.startsWith("-") && !/^-[0-9A-Za-z.]*e$/.test(args[k - 1] ?? ""));
    if (args.some((a) => /^-(?![MmI])[0-9A-Za-z]*i/.test(a)) && mayBeInside(files)) found.scriptEdit = true;
  } else if (name === "awk" || name === "gawk") {
    if (args.some((a, k) => a === "-i" && args[k + 1] === "inplace")) found.scriptEdit = true;
  } else if (name === "patch") {
    if (!args.includes("--dry-run")) found.scriptEdit = true;
  } else if (name === "git") {
    const sub = plainArguments(args, new Set(["-C", "-c", "--git-dir", "--work-tree"]));
    if (sub[0] === "apply" && !args.some((a) => /^--(?:check|stat|numstat|summary)$/.test(a))) found.scriptEdit = true;
  } else if (WRITERS.has(name)) {
    const files = name === "tee" ? plainArguments(args) : cmdletFiles(args);
    if (files.length > 0 && mayBeInside(files)) found.scriptEdit = true;
  } else if (READERS.has(name) || (state.powershell && name === "type")) {
    const files = /^(?:get-content|gc|type)$/.test(name) ? cmdletFiles(args) : plainArguments(args, READER_VALUED);
    if (files.some((f) => located(f, where()) === "inside")) found.reads += 1;
  } else if (name === "node") {
    const started = interpreterArguments(args, NODE_INLINE, NODE_VALUED);
    if (args.slice(0, args.length - started.after.length).includes("--test")) found.bare += 1;
    else if (started.file !== undefined && located(started.file, where()) === "outside") found.outsideScript = true;
    const script = started.inline ?? (started.file === undefined ? heredocs.join("\n") : "");
    if (NODE_WRITES.test(script)) found.scriptEdit = true;
  } else if (name === "python" || name === "python3" || name === "py") {
    const started = interpreterArguments(args, PYTHON_INLINE, PYTHON_VALUED);
    if (started.file !== undefined && located(started.file, where()) === "outside") found.outsideScript = true;
    const script = started.inline ?? (started.file === undefined ? heredocs.join("\n") : "");
    if (PYTHON_WRITES.test(script)) found.scriptEdit = true;
  } else if (name === "dotnet") {
    if (DOTNET_RUNS.has(plainArguments(args)[0])) found.bare += 1;
  } else if (name === "npm") {
    if (NPM_RUNS.has(plainArguments(args, NPM_VALUED)[0])) found.bare += 1;
  } else if (BUILD_TOOLS.has(name)) {
    found.bare += 1;
  }
}

// --- Tool calls -----------------------------------------------------------------------------------------------

const GRAPH = "mcp__codebase-memory-mcp__";
// The code graph server's tools that build or manage the index and look nothing up in the code.
const GRAPH_INDEX = new Set(["index_repository", "index_status", "delete_project", "list_projects"]);
const EDITORS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

// The kind of one tool call: "graph" (a code graph lookup), "index" (the same server building or managing its
// index), "read", "search" (Grep, Glob), "edit" (Edit, Write), "shell" (Bash, PowerShell; with `shell`, what
// classifyShell says of its command, and `steps`, what stepCalls finds in it), "agent" (an agent started),
// "message" (SendMessage) or "other".
export function classifyTool(name, input, where = {}) {
  if (name.startsWith(GRAPH)) return { kind: GRAPH_INDEX.has(name.slice(GRAPH.length)) ? "index" : "graph" };
  if (name === "Read") return { kind: "read" };
  if (name === "Grep" || name === "Glob") return { kind: "search" };
  if (EDITORS.has(name)) return { kind: "edit" };
  if (name === "Bash" || name === "PowerShell") {
    const powershell = name === "PowerShell";
    return {
      kind: "shell",
      shell: classifyShell(input?.command, { ...where, powershell }),
      steps: stepCalls(input?.command, { powershell }),
    };
  }
  if (name === "Agent" || name === "Task") return { kind: "agent" };
  if (name === "SendMessage") return { kind: "message" };
  return { kind: "other" };
}

// --- One transcript -------------------------------------------------------------------------------------------

const textOf = (content) =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((block) => (block.type === "text" ? block.text : "")).join(" ")
      : "";
const blocksOf = (content) => (Array.isArray(content) ? content : []);
const hasToolResult = (content) => blocksOf(content).some((block) => block.type === "tool_result");

// The step a progress note reports, or null when the text is not one: one line ending in `completed at HH:MM`
// (seconds allowed). Lines the harness puts before an agent's message (a tag alone on its line and the sentence
// under it) are not part of the message.
export function progressStep(body) {
  const lines = String(body ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length > 1 && /^<[a-z][a-z-]*\/>$/.test(lines[0])) lines.splice(0, 2);
  if (lines.length !== 1) return null;
  return /^(.+) completed at (?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.exec(lines[0])?.[1] ?? null;
}

// The message an agent sent, out of the frame it arrives in.
function agentMessage(text, origin) {
  if (typeof origin?.body === "string") return origin.body;
  return /<agent-message from="[^"]*">\s*([\s\S]*?)\s*<\/agent-message>/.exec(text)?.[1] ?? "";
}

// How the texts the harness adds to an older transcript begin: a local command's output, a notice, a compaction's
// summary, a reminder, a skill's text, an agent's report.
const MACHINE_TEXT = new RegExp(
  [
    "^<local-command-stdout>",
    "SYSTEM NOTIFICATION",
    "^This session is being continued",
    "^<artifact-content-authored-by-others",
    "^<system-reminder>",
    "^Base directory for this skill",
    String.raw`^\[Subagent`,
  ].join("|"),
);

// What one prompt of the main session's transcript (a user record that is not a tool result) is:
// - "owner": typed by the owner, or a command of his (also one that runs without the model, like /compact);
// - "session": a message from another Claude session, which is input from outside the run too;
// - "note": an agent's progress note; "handback": an agent's final report; "agent": any other message of an agent;
// - "notification": a background task's notice; "machine": what the harness adds (a skill's text, a reminder, a
//   local command's output, a compaction's summary).
// The record says where it came from (`origin`) in newer transcripts; older ones are told by their text.
export function inputKind(record) {
  const text = textOf(record.message?.content).trim();
  const head = text.slice(0, 200);
  const origin = record.origin;
  if (/<agent-message from=/.test(head)) {
    const body = agentMessage(text, origin);
    if (origin?.handback === true || /^\[Subagent hand-back\]/.test(body)) return "handback";
    return progressStep(body) === null ? "agent" : "note";
  }
  if (/<cross-session-message/.test(head)) return "session";
  if (origin?.kind === "task-notification" || /^<task-notification>/.test(text)) return "notification";
  if (origin) return origin.kind === "human" ? "owner" : "machine";
  if (MACHINE_TEXT.test(text)) return "machine";
  if (record.isMeta && !/^<local-command-caveat>/.test(text)) return "machine";
  if (record.isCompactSummary) return "machine";
  return "owner";
}

// How an input of the owner is named in the report: never its text.
function inputLabel(record, kind) {
  if (kind === "session") return "message from another session";
  const text = textOf(record.message?.content);
  const command = /<command-name>\s*(\/[\w:.-]+)\s*<\/command-name>/.exec(text)?.[1];
  if (command) return `command ${command}`;
  return /^\s*<local-command-caveat>/.test(text) ? "local command" : "typed";
}

// Whether the harness recorded files changed by a shell call (the result record's `toolUseResult.bashEditDiff`).
function changedFiles(result) {
  const diff = result?.bashEditDiff;
  return Boolean(diff) && (diff.files?.length ?? 0) + (diff.moreFiles ?? 0) + (diff.changedFiles?.length ?? 0) > 0;
}

// One transcript (the text of a .jsonl file) as what the measurement needs; `main` says it is the main session's,
// whose prompts are told apart. Nothing is cut to a time window here: every entry carries its time (`at`, ms).
// - `calls`: the API calls in order, each { at, model, input, write5m, write1h, read, output, context, turn };
// - `tools`: the tool calls, each { at, name, kind, turn }, a shell call with `shell` and `steps` as classifyTool
//   gives them, and `failed: true` when its result is recorded as an error;
// - `events`: one per record of the conversation, { at, kind: "work" | "owner", label? }: what the working time
//   is counted from;
// - `turns` (main only): what started each turn, { at, kind } with inputKind's kinds; a call's and a tool call's
//   `turn` is its index, -1 before the first;
// - `absorbed` (main only): the times of progress notes that arrived while the session was working, which start
//   no turn;
// - `cwd`: the folder the session started in.
export function readTranscript(text, { main = false } = {}) {
  const calls = new Map();
  const tools = new Map();
  const events = [];
  const turns = [];
  const absorbed = [];
  const questions = new Set();
  let cwd = null;
  for (const raw of String(text).split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("{")) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue; // a line cut off while the session was still writing
    }
    if (cwd === null && typeof record.cwd === "string") cwd = record.cwd;
    const at = Date.parse(record.timestamp ?? record.attachment?.timestamp ?? "");
    if (!Number.isFinite(at)) continue;
    const content = record.message?.content;

    if (record.type === "attachment") {
      const queued = record.attachment ?? {};
      if (!main || queued.type !== "queued_command" || queued.origin?.handback === true) continue;
      const prompt = String(queued.prompt ?? "");
      if (queued.origin?.kind !== "peer" && !/<agent-message from=/.test(prompt.slice(0, 200))) continue;
      if (progressStep(agentMessage(prompt, queued.origin)) !== null) absorbed.push(at);
    } else if (record.type === "assistant") {
      const message = record.message ?? {};
      if (message.usage && message.model !== "<synthetic>") {
        const id = message.id ?? record.requestId ?? record.uuid ?? `at ${at}`;
        const known = calls.get(id);
        calls.set(id, {
          at: known?.at ?? at,
          turn: known?.turn ?? turns.length - 1,
          model: message.model ?? "unknown",
          ...readUsage(message.usage),
        });
      }
      for (const block of blocksOf(content)) {
        if (block.type !== "tool_use" || tools.has(block.id)) continue;
        const where = { root: cwd, cwd: typeof record.cwd === "string" ? record.cwd : cwd };
        tools.set(block.id, {
          at,
          name: block.name,
          turn: turns.length - 1,
          ...classifyTool(String(block.name), block.input, where),
        });
        if (block.name === "AskUserQuestion") questions.add(block.id);
      }
      events.push({ at, kind: "work" });
    } else if (record.type === "user" && hasToolResult(content)) {
      let answered = false;
      for (const block of blocksOf(content)) {
        if (block.type !== "tool_result") continue;
        if (questions.has(block.tool_use_id)) answered = true;
        const tool = tools.get(block.tool_use_id);
        if (tool && block.is_error === true) tool.failed = true; // for a shell call: a non-zero exit
        if (tool?.shell?.outsideScript && changedFiles(record.toolUseResult)) tool.shell.scriptEdit = true;
      }
      if (main && answered) events.push({ at, kind: "owner", label: "answer to a question dialog" });
      else events.push({ at, kind: "work" });
    } else if (record.type === "user") {
      const kind = main ? inputKind(record) : "machine";
      if (main && kind !== "machine") turns.push({ at, kind });
      if (kind === "owner" || kind === "session") events.push({ at, kind: "owner", label: inputLabel(record, kind) });
      else events.push({ at, kind: "work" });
    }
  }
  return { cwd, calls: [...calls.values()], tools: [...tools.values()], events, turns, absorbed };
}

// --- Numbers --------------------------------------------------------------------------------------------------

// Whether a time lies inside a window: { from, to } in ms, either may be left out.
const within =
  ({ from = -Infinity, to = Infinity } = {}) =>
  (at) =>
    at >= from && at <= to;

const sum = (numbers) => numbers.reduce((a, b) => a + b, 0);

// An agent's context over its API calls: the number of calls, the context at the first and the last and the
// largest, its own output, and what it took in: for every step from one call to the next, how much more the next
// call was sent than the call before plus that call's own output. A step in which it was sent less is a cut of the
// context (a compaction); `cuts` counts those, and they add nothing to `takenIn`.
// So, without a cut: last = first + takenIn + the output of every call but the last.
export function contextNumbers(calls) {
  if (calls.length === 0) return { calls: 0, first: 0, last: 0, peak: 0, output: 0, takenIn: 0, cuts: 0 };
  let takenIn = 0;
  let cuts = 0;
  for (let k = 1; k < calls.length; k += 1) {
    const step = calls[k].context - calls[k - 1].context - calls[k - 1].output;
    if (step < 0) cuts += 1;
    else takenIn += step;
  }
  return {
    calls: calls.length,
    first: calls[0].context,
    last: calls.at(-1).context,
    peak: Math.max(...calls.map((call) => call.context)),
    output: sum(calls.map((call) => call.output)),
    takenIn,
    cuts,
  };
}

// An agent's tool calls by kind. `scriptEdits` counts shell calls, `shellReads`, `wrappedRuns` and `bareRuns` the
// commands inside them (one call can hold three runs).
export function toolNumbers(tools) {
  const count = (kind) => tools.filter((tool) => tool.kind === kind).length;
  const shells = tools.filter((tool) => tool.kind === "shell").map((tool) => tool.shell);
  return {
    graph: count("graph"),
    index: count("index"),
    read: count("read"),
    search: count("search"),
    edit: count("edit"),
    shell: shells.length,
    scriptEdits: shells.filter((shell) => shell.scriptEdit).length,
    shellReads: sum(shells.map((shell) => shell.reads)),
    wrappedRuns: sum(shells.map((shell) => shell.wrapped)),
    bareRuns: sum(shells.map((shell) => shell.bare)),
    agents: count("agent"),
    messages: count("message"),
    other: count("other"),
  };
}

// What the progress notes cost the main session inside a window: how many started a turn of their own, those
// turns' API calls, tool calls (the rule is none) and weighted tokens, and how many arrived while it was working.
export function noteNumbers(transcript, window) {
  const inside = within(window);
  const started = new Set(
    transcript.turns.flatMap((turn, index) => (turn.kind === "note" && inside(turn.at) ? [index] : [])),
  );
  const calls = transcript.calls.filter((call) => started.has(call.turn));
  return {
    turns: started.size,
    absorbed: transcript.absorbed.filter(inside).length,
    calls: calls.length,
    toolCalls: transcript.tools.filter((tool) => started.has(tool.turn)).length,
    weighted: sum(calls.map(weighted)),
  };
}

const STANDSTILL = 120_000; // a gap between two records of the whole run that is listed: over 2 minutes

// The working time of a run inside a window, from every transcript's events together ({ at, kind, label, source }):
// `span` from the first to the last, `waits` the standstills that ended with input from outside (each in `inputs`
// with the wait before it), `working` the rest. `standstills` are the other gaps over 2 minutes (a long command,
// or dead time), `idle` their sum; they are working time. Null when the window holds no event.
export function workingTime(events, window) {
  const inWindow = within(window);
  const inside = events.filter((event) => inWindow(event.at)).sort((a, b) => a.at - b.at); // ties keep their order
  if (inside.length === 0) return null;
  const inputs = [];
  const standstills = [];
  inside.forEach((event, k) => {
    const gap = k === 0 ? 0 : event.at - inside[k - 1].at;
    if (event.kind === "owner") inputs.push({ at: event.at, wait: gap, label: event.label });
    else if (gap > STANDSTILL) {
      standstills.push({ at: event.at, gap, before: inside[k - 1].source, after: event.source });
    }
  });
  const span = inside.at(-1).at - inside[0].at;
  const waits = sum(inputs.map((input) => input.wait));
  return {
    start: inside[0].at,
    end: inside.at(-1).at,
    span,
    waits,
    working: span - waits,
    idle: sum(standstills.map((gap) => gap.gap)),
    inputs,
    standstills,
  };
}

// The tags of a commit that ends a step, for a transcript made before a commit could name its step.
const STEP_TAGS = new Set(["close", "accept", "chapter", "chapter-review", "review"]);

// What a step's text says it is: a slice (`<chapter>, slice <n>`), a task group of an unsliced change
// (`<chapter>, group <n>`), a finding of a fix round (`Finding <id>`), or another step.
function stepKind(text) {
  if (/^.+, slice \d+$/i.test(text)) return "slice";
  if (/^.+, group \d+$/i.test(text)) return "group";
  return /^Finding \S/.test(text) ? "finding" : "other";
}

// The completed steps of a run in time order, each { at, who, text, kind }, from its runners' tool calls
// (`callers`: { who, tools }, the tools as readTranscript gives them). A step is a `tdd.mjs commit` that names it
// with `--done`, or a `tdd.mjs progress --step`. When the run has neither (a transcript from before they existed),
// a commit tagged close, accept, chapter, chapter-review or review is one, its text `<tag>: <summary>`: close is
// a slice, chapter-review and review are findings. A call recorded as failed gives no step.
export function stepsOf(callers) {
  const calls = callers.flatMap(({ who, tools }) =>
    tools
      .filter((tool) => !tool.failed)
      .flatMap((tool) => (tool.steps ?? []).map((call) => ({ ...call, at: tool.at, who }))),
  );
  const named = calls.some((call) => call.kind === "progress" || call.done !== null);
  const steps = [];
  for (const { at, who, kind, step, done, tag, summary } of calls) {
    const text = kind === "progress" ? step : done;
    if (text !== null) steps.push({ at, who, text, kind: stepKind(text) });
    else if (!named && STEP_TAGS.has(tag)) {
      const byTag = tag === "close" ? "slice" : tag === "accept" || tag === "chapter" ? "other" : "finding";
      steps.push({ at, who, text: summary === null ? tag : `${tag}: ${summary}`, kind: byTag });
    }
  }
  return steps.sort((a, b) => a.at - b.at);
}

// The steps with the working time of each (`working`, ms): from the step before it, or from `start` for the first,
// without the waits for input from outside that fall between the two (`inputs` as workingTime gives them).
export function stepTimes(steps, { start, inputs }) {
  let before = start;
  return steps.map((step) => {
    const waits = inputs.filter((input) => input.at > before && input.at <= step.at).map((input) => input.wait);
    const timed = { ...step, working: step.at - before - sum(waits) };
    before = step.at;
    return timed;
  });
}

// How many of the timed steps are of a kind, and their average and median working time (ms).
export function stepStatistics(steps, kind) {
  const times = steps
    .filter((step) => step.kind === kind)
    .map((step) => step.working)
    .sort((a, b) => a - b);
  if (times.length === 0) return { count: 0, average: 0, median: 0 };
  const middle = Math.floor(times.length / 2);
  const median = times.length % 2 === 1 ? times[middle] : (times[middle - 1] + times[middle]) / 2;
  return { count: times.length, average: sum(times) / times.length, median };
}

// The type an agent is counted under, from its meta file: its agent type (`chapter-runner`, the runner's name
// before the update, is `runner`); a skill's own agent by its name (`code-review`); a workflow's agent by its
// phase (`workflow investigate`) unless it runs as a type of its own.
export function agentType(meta = {}) {
  const type = meta.agentType === "chapter-runner" ? "runner" : meta.agentType;
  if (meta.inWorkflowRun && (!type || type === "workflow-subagent")) {
    const phase = String(meta.workflowPhase ?? meta.description ?? "")
      .split(":")[0]
      .trim()
      .toLowerCase();
    return phase ? `workflow ${phase}` : "workflow";
  }
  if (meta.name && (!type || type === "general-purpose")) return String(meta.name);
  return type || "unknown";
}

// The weighted tokens of a run by agent type and model: `members` are { type, calls }, one per transcript, the
// calls already cut to the window. Rows from the most expensive down, and their total.
export function weightedByType(members) {
  const nothing = () => ({ agents: 0, calls: 0, input: 0, write5m: 0, write1h: 0, read: 0, output: 0 });
  const groups = new Map();
  const total = nothing();
  for (const { type, calls } of members) {
    const seen = new Set(); // the groups this transcript is already counted in as an agent
    for (const call of calls) {
      const model = call.model.replace(/^claude-/, "");
      const key = `${type}\n${model}`;
      const group = groups.get(key) ?? { type, model, ...nothing() };
      if (!seen.has(key)) group.agents += 1;
      seen.add(key);
      group.calls += 1;
      for (const name of PRICE_CLASSES) group[name] += call[name];
      groups.set(key, group);
    }
    if (calls.length > 0) total.agents += 1;
  }
  const rows = [...groups.values()].map((group) => ({ ...group, weighted: weighted(group) }));
  rows.sort((a, b) => b.weighted - a.weighted);
  for (const row of rows) for (const name of ["calls", ...PRICE_CLASSES]) total[name] += row[name];
  return { rows, total: { ...total, weighted: sum(rows.map((row) => row.weighted)) } };
}

// --- The report -----------------------------------------------------------------------------------------------

const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const clock = (ms) => new Date(ms).toISOString().slice(11, 16);
const clockSeconds = (ms) => new Date(ms).toISOString().slice(11, 19);
const minutes = (ms) => (ms / 60_000).toFixed(1);
const thousands = (n) => `${Math.round(n / 1000)}k`;
const millions = (n) => `${(n / 1_000_000).toFixed(2)}M`;
const cut = (text, width) => (text.length > width ? `${text.slice(0, Math.max(width - 1, 0))}…` : text);

const WIDTH = 118; // the widest line printed

// Rows of cells as lines with the columns lined up: the columns in `left` to the left, the others to the right,
// `gap` between them.
function table(rows, left = [0], gap = "  ") {
  if (rows.length === 0) return [];
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => String(row[column]).length)));
  return rows.map((row) =>
    row
      .map((cell, column) =>
        left.includes(column) ? String(cell).padEnd(widths[column]) : String(cell).padStart(widths[column]),
      )
      .join(gap)
      .trimEnd(),
  );
}

// The agents of one session in the order they are printed: each under the agent that started it (its meta file's
// `parentAgentId`, when it has one and that agent is known), by their first record's time. Adds `depth`.
export function nested(agents) {
  const ids = new Set(agents.map((agent) => agent.id));
  const parentOf = (agent) => (ids.has(agent.meta?.parentAgentId) ? agent.meta.parentAgentId : null);
  const ordered = [];
  const place = (parent, depth) => {
    for (const agent of agents.filter((a) => parentOf(a) === parent).sort((a, b) => a.first - b.first)) {
      ordered.push({ ...agent, depth });
      place(agent.id, depth + 1);
    }
  };
  place(null, 1);
  return ordered;
}

// The transcripts of a run that have a record in the window, in the order they are printed: each main session,
// then its agents as `nested` orders them. A member carries who it is (`who` with its indent, `source` without),
// its type and description, and its calls, tool calls and first and last record inside the window.
function membersOf(sessions, window) {
  const inWindow = within(window);
  const inside = (entry) => inWindow(entry.at);
  const members = [];
  const add = (who, type, description, depth, transcript) => {
    const events = transcript.events.filter(inside);
    if (events.length === 0) return;
    members.push({
      who: `${"  ".repeat(depth)}${who}`,
      source: who,
      type,
      description,
      main: depth === 0,
      transcript,
      calls: transcript.calls.filter(inside),
      tools: transcript.tools.filter(inside),
      first: events[0].at,
      last: events.at(-1).at,
    });
  };
  for (const session of sessions) {
    add(`main ${session.id.slice(0, 8)}`, "main session", "", 0, session.transcript);
    const agents = session.agents
      .map((agent) => ({ ...agent, first: agent.transcript.events.find(inside)?.at }))
      .filter((agent) => agent.first !== undefined);
    for (const agent of nested(agents)) {
      const type = agentType(agent.meta);
      const description = String(agent.meta?.description ?? "");
      add(`${type} ${agent.id.slice(0, 8)}`, type, description, agent.depth, agent.transcript);
    }
  }
  return members;
}

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const moment = (ms) => `${day(ms)} ${clockSeconds(ms)}`;

function contextLines(members) {
  const numbers = members.map((member) => contextNumbers(member.calls));
  const rows = [
    ["who", "start", "min", "calls", "first", "last", "peak", "output", "taken in", "description"],
    ...members.map((member, k) => [
      member.who,
      clock(member.first),
      minutes(member.last - member.first),
      numbers[k].calls,
      thousands(numbers[k].first),
      thousands(numbers[k].last),
      thousands(numbers[k].peak),
      thousands(numbers[k].output),
      `${thousands(numbers[k].takenIn)}${numbers[k].cuts > 0 ? "*" : ""}`,
      member.description,
    ]),
  ];
  // The description takes the room the numbers leave.
  const room = WIDTH - (table(rows.map((row) => row.slice(0, -1)))[0].length + 2);
  for (const row of rows) row[9] = cut(row[9], Math.max(room, 12));
  return [
    "AGENTS: CONTEXT (tokens, in thousands; times in UTC; an agent stands under the one that started it)",
    ...table(rows, [0, 9]),
    "  start, min   its first record, and the minutes to its last",
    "  first, last, peak   what its first and its last API call were sent, and the most any call was sent",
    "  output       what it wrote itself: thinking, text and tool calls",
    "  taken in     what came in between its calls: tool results, messages, attached rules",
    ...(numbers.some((n) => n.cuts > 0)
      ? ["  *            its context was cut on the way (a compaction); taken in counts the growth only"]
      : []),
  ];
}

function toolLines(members) {
  const head = "who graph index Read search edit | shell edits reads tdd-run bare | Agent Send other".split(" ");
  const rows = members.map((member) => {
    const n = toolNumbers(member.tools);
    const shell = [n.shell, n.scriptEdits, n.shellReads, n.wrappedRuns, n.bareRuns];
    return [
      `${member.who} `,
      n.graph,
      n.index,
      n.read,
      n.search,
      n.edit,
      "|",
      ...shell,
      "|",
      n.agents,
      n.messages,
      n.other,
    ];
  });
  return [
    "AGENTS: TOOL CALLS",
    ...table([head, ...rows], [0], " "),
    "  graph    code graph lookups (tools named mcp__codebase-memory-mcp__*); index: the same server's calls that",
    "           build or manage its index",
    "  search   Grep and Glob · edit: Edit and Write · Send: SendMessage",
    "  shell    Bash and PowerShell calls. Of them and in them:",
    "  edits    calls that change a file of the repository without Edit or Write: sed -i, perl -i, output sent",
    "           into a file (> or a here-document, tee), patch, git apply, a node or python script on the command",
    "           line that writes files; a script file run from outside the repository when the harness recorded",
    "           changed files after it. Not counted: a temp folder or the null device as the target",
    "  reads    commands whose plain purpose is to read a file of the repository: cat, head, tail, sed without -i",
    "           on a path inside it. Not counted: `| tail` on a command's output, a log or a saved tool result",
    "           outside the repository, grep",
    "  tdd-run  test and build runs through the wrapper (tdd.mjs run), each run counted",
    "  bare     test and build commands not going through it: dotnet test/build/run/format/publish/restore,",
    "           npm test/run/exec, npx, vitest, tsc, eslint, oxlint, prettier, node --test",
  ];
}

function timeLines(time) {
  const totals = [
    ["  from first to last record", `${minutes(time.span)} min`],
    ["  waits for input from outside", `${minutes(time.waits)} min`],
    ["  working", `${minutes(time.working)} min`],
  ];
  const inputs = time.inputs.map((input) => [`    ${moment(input.at)}`, `${minutes(input.wait)} min`, input.label]);
  const standstills = time.standstills.map((gap) => [
    `    ${moment(gap.at)}`,
    `${minutes(gap.gap)} min`,
    gap.before === gap.after ? `inside ${gap.after}` : `between ${gap.before} and ${gap.after}`,
  ]);
  return [
    "WORKING TIME (UTC)",
    ...table(totals),
    "  A wait is a standstill of the whole run (the main session and every agent) that ended with the owner's",
    "  input: typing, a command, an answer to a question dialog, a message from another session.",
    ...(inputs.length > 0 ? ["  The inputs, each with the wait before it:", ...table(inputs, [0, 2])] : []),
    "  Other standstills over 2 minutes (a long command, or dead time; they are working time): " +
      `${time.standstills.length}, ${minutes(time.idle)} min`,
    ...table(standstills, [0, 2]),
  ];
}

function stepLines(members, time) {
  const runners = members.filter((member) => member.type === "runner");
  const steps = stepTimes(stepsOf(runners.map((member) => ({ who: member.source, tools: member.tools }))), time);
  const rows = steps.map((step) => [`  ${moment(step.at)}`, cut(step.text, 60), step.who, minutes(step.working)]);
  const summary = (name, kind, always) => {
    const { count, average, median } = stepStatistics(steps, kind);
    if (count === 0) return always ? [`  ${name}: 0`] : [];
    return [`  ${name}: ${count}, average ${minutes(average)} min, median ${minutes(median)} min`];
  };
  return [
    "STEPS (UTC; the last column is the working minutes since the step before, for the first step since the start)",
    ...(rows.length > 0 ? table(rows, [0, 1, 2]) : ["  none"]),
    ...summary("slices", "slice", true),
    ...summary("task groups", "group", false),
    ...summary("findings", "finding", false),
    '  A step is a runner\'s `tdd.mjs commit … --done "<step>"` or `tdd.mjs progress --step "<step>"`. In a',
    "  transcript made before those, it is a runner's commit tagged close, accept, chapter, chapter-review or",
    "  review, shown as `tag: summary`. A call that was refused (the transcript records a non-zero exit) is not",
    "  counted. The minutes leave out the waits for input from outside, as WORKING TIME does.",
    "  Slices: `<chapter>, slice <n>`, or the tag close. Task groups: `<chapter>, group <n>`. Findings:",
    "  `Finding <id>`, or the tags chapter-review and review.",
  ];
}

function tokenLines(members) {
  const { rows, total } = weightedByType(members);
  const cells = (row, first) => [
    ...first,
    row.agents,
    row.calls,
    thousands(row.input),
    thousands(row.write5m),
    thousands(row.write1h),
    thousands(row.read),
    thousands(row.output),
    millions(row.weighted),
  ];
  const head = [
    "type",
    "model",
    "agents",
    "calls",
    "input",
    "write 5m",
    "write 1h",
    "cache read",
    "output",
    "weighted",
  ];
  return [
    "WEIGHTED TOKENS BY AGENT TYPE (tokens in thousands, weighted in millions)",
    ...table([head, ...rows.map((row) => cells(row, [row.type, row.model])), cells(total, ["TOTAL", ""])], [0, 1]),
    "  weighted = input + 1.25 × cache written for 5 minutes + 2 × cache written for 1 hour + 0.1 × cache read",
    "  + 5 × output, each API call once: the ratios between the price classes, in input tokens of the row's",
    "  model. Not a price; the total adds the rows as they are.",
  ];
}

function noteLines(members, window) {
  const notes = { turns: 0, absorbed: 0, calls: 0, toolCalls: 0, weighted: 0 };
  for (const member of members.filter((m) => m.main)) {
    const more = noteNumbers(member.transcript, window);
    for (const name of Object.keys(notes)) notes[name] += more[name];
  }
  const lines = [
    "PROGRESS NOTES (a runner's one line to the main session, `<step> completed at HH:MM`)",
    `  received ${notes.turns + notes.absorbed}: ${notes.turns} started a turn of the main session, ` +
      `${notes.absorbed} arrived while it was working`,
  ];
  if (notes.turns > 0) {
    lines.push(
      `  the turns they started cost ${thousands(notes.weighted)} weighted tokens ` +
        `(${thousands(notes.weighted / notes.turns)} a turn) in ${plural(notes.calls, "API call")}, ` +
        `with ${plural(notes.toolCalls, "tool call")} (the rule: none)`,
    );
  }
  return lines;
}

// The whole report as lines. `sessions` are the main sessions in the order given, each { id, transcript, agents },
// an agent being { id, meta, transcript } (transcripts as readTranscript gives them); `window` is { from, to } in
// ms, either may be left out.
export function report(sessions, window = {}) {
  const members = membersOf(sessions, window);
  if (members.length === 0) return ["No record in the window."];
  const events = members.flatMap((member) =>
    member.transcript.events.map((event) => ({ ...event, source: member.source })),
  );
  const time = workingTime(events, window);
  const agents = members.filter((member) => !member.main).length;
  return [
    `RUN  ${moment(time.start)} → ${moment(time.end)} UTC · ` +
      `${plural(members.length - agents, "main session")}, ${plural(agents, "agent")}`,
    "",
    ...contextLines(members),
    "",
    ...toolLines(members),
    "",
    ...timeLines(time),
    "",
    ...stepLines(members, time),
    "",
    ...tokenLines(members),
    "",
    ...noteLines(members, window),
  ];
}

// --- Files ----------------------------------------------------------------------------------------------------

function agentFilesUnder(folder) {
  if (!existsSync(folder)) return [];
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) return agentFilesUnder(path);
    return /^agent-.+\.jsonl$/.test(entry.name) ? [path] : [];
  });
}

// One main session's transcript and its agents', read from disk: { id, transcript, agents }, an agent being
// { id, meta, transcript }. A missing or unreadable meta file leaves the agent's type unknown.
export function loadRun(mainPath) {
  const id = basename(mainPath, ".jsonl");
  const agents = agentFilesUnder(join(dirname(mainPath), id, "subagents")).map((path) => {
    let meta = {};
    try {
      meta = JSON.parse(readFileSync(path.replace(/\.jsonl$/, ".meta.json"), "utf8"));
    } catch {
      // no meta file
    }
    const agentId = basename(path, ".jsonl").replace(/^agent-/, "");
    return { id: agentId, meta, transcript: readTranscript(readFileSync(path, "utf8")) };
  });
  return { id, transcript: readTranscript(readFileSync(mainPath, "utf8"), { main: true }), agents };
}

// The command line as { paths, window }; throws with the line to print when it is not understood.
export function parseArguments(argv) {
  const paths = [];
  const window = {};
  for (let k = 0; k < argv.length; k += 1) {
    if (argv[k] === "--from" || argv[k] === "--to") {
      const at = Date.parse(argv[k + 1] ?? "");
      if (!Number.isFinite(at)) throw new Error(`${argv[k]} needs an ISO time, like 2026-05-03T09:00:00Z`);
      window[argv[k].slice(2)] = at;
      k += 1;
    } else if (argv[k].startsWith("--")) throw new Error(`unknown option ${argv[k]}`);
    else paths.push(argv[k]);
  }
  if (paths.length === 0) throw new Error("name the main session's transcript (.jsonl)");
  return { paths, window };
}

export function main(argv) {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${USAGE}\n`);
    return argv.length === 0 ? 1 : 0;
  }
  try {
    const { paths, window } = parseArguments(argv);
    for (const path of paths) if (!existsSync(path)) throw new Error(`no such file: ${path}`);
    process.stdout.write(`${report(paths.map(loadRun), window).join("\n")}\n`);
    return 0;
  } catch (e) {
    process.stderr.write(`ERROR: ${e.message}\n`);
    return 1;
  }
}

// Whether this file is the script Node was started with, and not imported by a test.
function startedDirectly() {
  const same = (path) => {
    let real = path;
    try {
      real = realpathSync.native(path);
    } catch {
      // compared as given
    }
    return process.platform === "win32" ? real.toLowerCase() : real;
  };
  return Boolean(process.argv[1]) && same(resolve(process.argv[1])) === same(fileURLToPath(import.meta.url));
}

if (startedDirectly()) process.exitCode = main(process.argv.slice(2));
