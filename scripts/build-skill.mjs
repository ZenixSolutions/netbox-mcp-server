#!/usr/bin/env node
/**
 * Package a skill directory into the two artifacts a release ships.
 *
 * 1. `dist/skills/<name>.skill` — a zip archive whose entries are prefixed with
 *    the skill's own directory name (`netbox-modeling/SKILL.md`, …), which is
 *    the layout a client expects when it unpacks one. This is what a user
 *    installs into a skills directory.
 *
 * 2. `dist/skills/<name>.md` — the same source flattened into one document:
 *    `SKILL.md` first, then every `references/*.md` inline under its own
 *    heading, with the cross-references between them rewritten to in-document
 *    anchors. This is what gets uploaded to a surface that takes a single
 *    knowledge file rather than a skill folder.
 *
 * Both come from the same tree, so they cannot disagree.
 *
 * DEPENDENCY-FREE ON PURPOSE. This repository ships an MCP server; adding an
 * archiver to its dev dependencies to produce one zip a release is a poor
 * trade. `node:zlib` supplies the only hard part (deflate); the container
 * format below is ~90 lines of header writing.
 *
 * Validation runs before packaging, because a skill that fails to load is
 * indistinguishable from one that was never delivered: the frontmatter must
 * parse, `name` must match the directory and the 64-character limit, and
 * `description` must exist and stay under 1024 characters.
 *
 * Usage:
 *   node scripts/build-skill.mjs [skill-name] [--out-dir <dir>]
 *   npm run build:skill
 *
 * Exit codes:
 *   0  both artifacts were written
 *   1  validation failed
 *   2  usage error — no such skill directory
 */

import { Buffer } from "node:buffer";
import { deflateRawSync } from "node:zlib";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;

const DEFAULT_SKILL = "netbox-modeling";
const MAX_NAME = 64;
const MAX_DESCRIPTION = 1024;

/** Never packaged, wherever they appear in the tree. */
const EXCLUDED_DIRECTORIES = new Set(["__pycache__", "node_modules", ".git"]);
const EXCLUDED_FILES = new Set([".DS_Store"]);
/** Excluded only at the skill root: evals are a development artifact. */
const ROOT_EXCLUDED_DIRECTORIES = new Set(["evals"]);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// Zip container
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS date/time, the only timestamp a zip local header can carry. */
function dosDateTime(date) {
  const year = Math.max(date.getFullYear(), 1980);
  return {
    time:
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/**
 * Build a zip archive from `[{ name, data, mtime }]`.
 *
 * Every entry is deflated; the language-encoding flag (bit 11) is set so the
 * names are read as UTF-8 rather than CP437.
 */
function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const compressed = deflateRawSync(entry.data, { level: 9 });
    const crc = crc32(entry.data);
    const { time, date } = dosDateTime(entry.mtime);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4); // made by: UNIX, spec 3.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attributes
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external attributes: 0644
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralDirectory, end]);
}

// ---------------------------------------------------------------------------
// Collection and validation
// ---------------------------------------------------------------------------

/** Every packageable file under `dir`, sorted, so two builds agree. */
function collectFiles(dir, prefix = "") {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRECTORIES.has(entry.name)) continue;
      if (prefix === "" && ROOT_EXCLUDED_DIRECTORIES.has(entry.name)) continue;
      found.push(...collectFiles(path.join(dir, entry.name), relative));
      continue;
    }
    if (!entry.isFile()) continue;
    if (EXCLUDED_FILES.has(entry.name) || entry.name.endsWith(".pyc")) continue;
    found.push(relative);
  }
  return found;
}

/**
 * Read `name` and `description` out of the SKILL.md frontmatter.
 *
 * Deliberately not a YAML parser: the frontmatter of a skill is two scalar
 * keys, one of which is a folded block. Anything more elaborate than that is
 * a reason to fail loudly rather than to grow a parser.
 */
function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!match) return { errors: ["SKILL.md has no YAML frontmatter block."] };

  const body = match[1];
  const errors = [];
  const fields = {};
  const lines = body.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const keyed = /^([A-Za-z][\w-]*):[ \t]*(.*)$/.exec(lines[i]);
    if (!keyed) continue;
    const [, key, inline] = keyed;
    if (inline === ">-" || inline === ">" || inline === "|" || inline === "|-") {
      const parts = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) {
        parts.push(lines[++i].trim());
      }
      fields[key] = parts.join(" ").trim();
    } else {
      fields[key] = inline.trim().replace(/^["']|["']$/g, "");
    }
  }

  return { fields, errors };
}

function validate(skillName, skillDir, files) {
  const errors = [];

  if (!files.includes("SKILL.md")) {
    errors.push("SKILL.md is missing from the skill root.");
    return errors;
  }
  const nested = files.filter((f) => f !== "SKILL.md" && f.endsWith("SKILL.md"));
  if (nested.length > 0) {
    errors.push(
      `A skill must contain exactly one SKILL.md; also found: ${nested.join(", ")}.`,
    );
  }

  const { fields, errors: frontmatterErrors } = parseFrontmatter(
    readFileSync(path.join(skillDir, "SKILL.md"), "utf8"),
  );
  errors.push(...frontmatterErrors);
  if (!fields) return errors;

  const name = fields.name;
  if (!name) {
    errors.push("Frontmatter has no `name`.");
  } else {
    if (name !== skillName) {
      errors.push(
        `Frontmatter name "${name}" does not match the directory "${skillName}".`,
      );
    }
    if (name.length > MAX_NAME) {
      errors.push(
        `Frontmatter name is ${name.length} characters; the limit is ${MAX_NAME}.`,
      );
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
      errors.push(`Frontmatter name "${name}" is not lowercase-hyphenated.`);
    }
  }

  const description = fields.description;
  if (!description) {
    errors.push(
      "Frontmatter has no `description` — a model cannot decide to load the skill without one.",
    );
  } else if (description.length > MAX_DESCRIPTION) {
    errors.push(
      `Frontmatter description is ${description.length} characters; the limit is ${MAX_DESCRIPTION}.`,
    );
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Flattened single-file document
// ---------------------------------------------------------------------------

/**
 * The skill's progressive disclosure is a feature in a client that can read a
 * folder on demand, and an obstacle on a surface that accepts one file. The
 * flattened build exists for the second case: same words, one document.
 *
 * Two things have to be fixed up on the way in, or the result is subtly wrong
 * rather than merely long:
 *
 *   - A reference file opens with its own `#` title. Six H1s in one document
 *     is not a document, so every heading in a reference is demoted one level
 *     and its title becomes the section heading.
 *   - The files point at each other by relative path (`references/build-order.md`).
 *     In a single file that path resolves to nothing, so each mention is
 *     rewritten to an anchor that exists in the same document.
 *
 * Both rewrites skip fenced code blocks, where a leading `#` is a shell
 * comment and a path is a literal the reader is meant to copy.
 */

/** `references/build-order.md` → `ref-build-order`; `SKILL.md` → `skill-md`. */
function anchorFor(relativePath) {
  if (relativePath === "SKILL.md") return "skill-md";
  const base = path.basename(relativePath, ".md");
  return `ref-${base}`;
}

function stripFrontmatter(text) {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
}

/** The first `# Title` line, or undefined. */
function firstHeading(text) {
  const match = /^#[ \t]+(.+?)[ \t]*$/m.exec(text);
  return match ? match[1] : undefined;
}

/** Drop the leading `# Title` line and any blank lines that followed it. */
function stripFirstHeading(text) {
  return text.replace(/^#[ \t]+.+?[ \t]*\r?\n(?:[ \t]*\r?\n)*/, "");
}

/**
 * Apply `transform` to every line that is not inside a fenced code block.
 *
 * A fence is ``` or ~~~ at the start of a line; the fence lines themselves are
 * left alone, which is what keeps a ```` ```json ```` info string intact.
 */
function mapProseLines(text, transform) {
  let inFence = false;
  return text
    .split("\n")
    .map((line) => {
      if (/^\s*(?:```|~~~)/.test(line)) {
        inFence = !inFence;
        return line;
      }
      return inFence ? line : transform(line);
    })
    .join("\n");
}

/** `## Contents` → `### Contents`, capped at H6, prose lines only. */
function demoteHeadings(text) {
  return mapProseLines(text, (line) =>
    line.replace(/^(#{1,6})([ \t]+)/, (whole, hashes, space) =>
      hashes.length < 6 ? `#${hashes}${space}` : whole,
    ),
  );
}

/**
 * Rewrite every mention of another file in the skill to an in-document anchor.
 *
 * `targets` maps a relative path (`references/build-order.md`) to its anchor.
 * A mention of something not in that map is left exactly as it was: an unknown
 * path is a bug in the skill, and silently linking it somewhere would hide it.
 *
 * Three forms are handled, in this order, because each pass has to not undo
 * the previous one:
 *   1. `[text](references/foo.md)`      → `[text](#ref-foo)`
 *   2. `` `references/foo.md` ``        → `` [`references/foo.md`](#ref-foo) ``
 *   3. bare `references/foo.md`         → `[references/foo.md](#ref-foo)`
 */
function rewriteCrossReferences(text, targets) {
  const resolve = (raw) => targets.get(raw.replace(/^\.\//, ""));

  return mapProseLines(text, (line) => {
    let out = line;

    // 1. Existing markdown links.
    out = out.replace(
      /\[([^\]]*)\]\((\.?\/?(?:references\/)?[A-Za-z0-9_-]+\.md)(#[^)]*)?\)/g,
      (whole, label, target) => {
        const anchor = resolve(target);
        return anchor ? `[${label}](#${anchor})` : whole;
      },
    );

    // 2. Code spans. Skip one already sitting in a link's label, which pass 1
    //    may just have produced, or the source may have written by hand.
    out = out.replace(
      /`(\.?\/?(?:references\/)?[A-Za-z0-9_-]+\.md)`(\]\()?/g,
      (whole, target, followedByLink) => {
        if (followedByLink) return whole;
        const anchor = resolve(target);
        return anchor ? `[\`${target}\`](#${anchor})` : whole;
      },
    );

    // 3. Bare mentions. The lookbehind keeps this off anything the passes
    //    above produced, and off a path that is part of a longer token.
    out = out.replace(
      /(?<![[\w`/.-])(\.?\/?(?:references\/[A-Za-z0-9_-]+|SKILL)\.md)(?![\w`)])/g,
      (whole, target) => {
        const anchor = resolve(target);
        return anchor ? `[${target}](#${anchor})` : whole;
      },
    );

    return out;
  });
}

/**
 * Build the flattened document.
 *
 * `files` is the same list the archive is built from, so the two artifacts
 * always describe the same tree. Anything that is not markdown cannot be
 * inlined; it is named in a closing note rather than dropped in silence.
 */
function buildFlattenedDocument(skill, skillDir, files) {
  const markdown = files.filter((f) => f.endsWith(".md"));
  const others = files.filter((f) => !f.endsWith(".md"));
  const references = markdown.filter((f) => f !== "SKILL.md").sort();

  const targets = new Map(
    [...markdown].map((relative) => [relative, anchorFor(relative)]),
  );

  const read = (relative) => readFileSync(path.join(skillDir, relative), "utf8");
  const section = (body) => rewriteCrossReferences(body, targets).trim();

  const parts = [
    `<!--`,
    `  ${skill} — every file of skills/${skill}/ flattened into one document.`,
    `  Generated by scripts/build-skill.mjs. Do not edit; edit the skill instead.`,
    `  Sources, in order: ${[...markdown.filter((f) => f === "SKILL.md"), ...references].join(", ")}`,
    `-->`,
    ``,
    `<a id="${anchorFor("SKILL.md")}"></a>`,
    ``,
    section(stripFrontmatter(read("SKILL.md"))),
  ];

  for (const relative of references) {
    const body = read(relative);
    const title = firstHeading(body) ?? path.basename(relative, ".md");
    parts.push(
      ``,
      `---`,
      ``,
      `<a id="${anchorFor(relative)}"></a>`,
      ``,
      `## ${relative} — ${title}`,
      ``,
      section(demoteHeadings(stripFirstHeading(body))),
    );
  }

  if (others.length > 0) {
    parts.push(
      ``,
      `---`,
      ``,
      `## Files not included above`,
      ``,
      `These ship in ${skill}.skill but are not markdown, so they cannot be inlined here:`,
      ``,
      ...others.map((relative) => `- \`${relative}\``),
    );
  }

  return `${parts.join("\n").trimEnd()}\n`;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  let skill = DEFAULT_SKILL;
  let outDir = path.join(repoRoot, "dist", "skills");
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out-dir") {
      const value = argv[++i];
      if (!value) {
        console.error("Error: --out-dir needs a directory.");
        process.exit(EXIT_USAGE);
      }
      outDir = path.resolve(value);
    } else if (arg.startsWith("--")) {
      console.error(`Error: unknown option ${arg}.`);
      process.exit(EXIT_USAGE);
    } else {
      skill = arg;
    }
  }
  return { skill, outDir };
}

function main() {
  const { skill, outDir } = parseArgs(process.argv.slice(2));
  const skillDir = path.join(repoRoot, "skills", skill);

  let stats;
  try {
    stats = statSync(skillDir);
  } catch {
    console.error(`Error: no skill directory at ${skillDir}.`);
    process.exit(EXIT_USAGE);
  }
  if (!stats.isDirectory()) {
    console.error(`Error: ${skillDir} is not a directory.`);
    process.exit(EXIT_USAGE);
  }

  const files = collectFiles(skillDir);
  const errors = validate(skill, skillDir, files);
  if (errors.length > 0) {
    console.error(`Cannot package ${skill}:`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(EXIT_FAILED);
  }

  const entries = files.map((relative) => {
    const absolute = path.join(skillDir, relative);
    return {
      name: `${skill}/${relative}`,
      data: readFileSync(absolute),
      mtime: statSync(absolute).mtime,
    };
  });

  const archive = buildZip(entries);
  const flattened = Buffer.from(buildFlattenedDocument(skill, skillDir, files), "utf8");

  mkdirSync(outDir, { recursive: true });
  const archivePath = path.join(outDir, `${skill}.skill`);
  const flattenedPath = path.join(outDir, `${skill}.md`);
  writeFileSync(archivePath, archive);
  writeFileSync(flattenedPath, flattened);

  const uncompressed = entries.reduce((total, entry) => total + entry.data.length, 0);
  const markdownCount = files.filter((f) => f.endsWith(".md")).length;

  console.error(`Packaged ${entries.length} file(s) from skills/${skill}/:`);
  for (const entry of entries) console.error(`  ${entry.name}`);
  console.error(
    `Wrote ${path.relative(repoRoot, archivePath)} — ${archive.length} bytes (from ${uncompressed}).`,
  );
  console.error(
    `Wrote ${path.relative(repoRoot, flattenedPath)} — ${flattened.length} bytes (${markdownCount} markdown file(s) flattened).`,
  );
  process.exit(EXIT_OK);
}

main();
