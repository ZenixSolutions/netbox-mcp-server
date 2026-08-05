#!/usr/bin/env node
/**
 * Package a skill directory into a `.skill` file for delivery to a user.
 *
 * A `.skill` file is a zip archive whose entries are prefixed with the skill's
 * own directory name (`netbox-modeling/SKILL.md`, …), which is the layout a
 * client expects when it unpacks one.
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
 *   0  the .skill file was written
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
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${skill}.skill`);
  writeFileSync(outPath, archive);

  const uncompressed = entries.reduce((total, entry) => total + entry.data.length, 0);
  console.error(`Packaged ${entries.length} file(s) from skills/${skill}/:`);
  for (const entry of entries) console.error(`  ${entry.name}`);
  console.error(
    `Wrote ${path.relative(repoRoot, outPath)} — ${archive.length} bytes (from ${uncompressed}).`,
  );
  process.exit(EXIT_OK);
}

main();
