#!/usr/bin/env node
/**
 * Fail a release when the changelog section for the version being tagged is
 * not actually finished.
 *
 * Grepping for the heading is not enough: a section that still contains
 * scaffolding satisfies a grep, and a version number on npm can never be
 * reused, so the changelog has to be checked before anything is published.
 *
 * SCOPING IS LOAD-BEARING. This checks *only* the section belonging to the
 * version passed in. CHANGELOG.md carries an `[Unreleased]` heading above the
 * released section and a preamble saying the project is not yet stable, so a
 * whole-file scan would fail every release forever.
 *
 * STATED LIMIT: the structural checks (heading, date, comparison link, empty
 * section) are exact. The scaffolding check is a phrase list — it only catches
 * wording somebody thought to write down. It is a floor, not a substitute for
 * reading the section before you tag.
 *
 * Usage:
 *   node scripts/check-changelog.mjs <version> [path/to/CHANGELOG.md]
 *   npm run check:changelog -- 0.1.0
 *
 * Exit codes:
 *   0  the section is releasable
 *   1  one or more checks failed (each reported as a ::error annotation)
 *   2  usage error — no version given, or the file could not be read
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;

/**
 * Wording that means the section was templated and never written. Short tokens
 * are matched on word boundaries so "wip" does not match "wipe".
 */
const SCAFFOLDING_PHRASES = [
  "todo",
  "tbd",
  "fixme",
  "wip",
  "xxx",
  "placeholder",
  "lorem ipsum",
  "describe the change",
  "describe your change",
  "your change here",
  "add entries here",
  "add your changes",
  "nothing yet",
  "no changes yet",
  "coming soon",
  "fill this in",
  "summary of changes",
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** GitHub reads workflow commands off stdout; the annotation is the contract. */
function annotate(file, line, message) {
  const location = line === null ? "" : `,line=${line}`;
  console.log(`::error file=${file}${location}::${message}`);
}

function isRealIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Strip HTML comments so a section of nothing but comments reads as empty. */
function stripComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, "");
}

function isLinkDefinition(line) {
  return /^\s*\[[^\]]+\]:\s*\S/.test(line);
}

function main(argv) {
  const args = argv.filter((arg) => arg !== "--");
  const rawVersion = args[0];

  if (!rawVersion) {
    console.log(
      "usage: node scripts/check-changelog.mjs <version> [path/to/CHANGELOG.md]",
    );
    return EXIT_USAGE;
  }

  // Accept both `0.1.0` and the tag form `v0.1.0`.
  const version = rawVersion.replace(/^v/, "");

  const defaultPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "CHANGELOG.md",
  );
  const filePath = args[1] ? path.resolve(args[1]) : defaultPath;

  // `file=` in an annotation is only useful when it is workspace-relative; a
  // path outside the working directory is clearer stated absolutely.
  const relative = path.relative(process.cwd(), filePath);
  const displayPath =
    relative && !relative.startsWith("..") && !path.isAbsolute(relative)
      ? relative
      : filePath;

  let raw;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    console.log(`::error::Could not read ${displayPath}`);
    return EXIT_USAGE;
  }

  const lines = raw.split(/\r?\n/);
  const errors = [];
  const fail = (line, message) => errors.push({ line, message });

  // --- locate this version's own section -----------------------------------

  // The lookahead stops `0.1.0` from matching a `0.1.0-beta.1` heading, which
  // would otherwise be reported as a bad date rather than a missing section.
  const headingPattern = new RegExp(
    `^##\\s+\\[?\\s*v?${escapeRegExp(version)}\\s*\\]?(?=$|[\\s:])(.*)$`,
    "i",
  );

  const matches = [];
  lines.forEach((line, index) => {
    const match = headingPattern.exec(line);
    if (match) matches.push({ index, remainder: match[1] ?? "", text: line });
  });

  if (matches.length === 0) {
    annotate(
      displayPath,
      null,
      `No changelog section for ${version}. Add a "## [${version}] - YYYY-MM-DD" ` +
        `heading, promoting the entries currently under [Unreleased].`,
    );
    console.log(`::error::CHANGELOG check failed for ${version}`);
    return EXIT_FAILED;
  }

  if (matches.length > 1) {
    fail(
      matches[1].index + 1,
      `Found ${matches.length} changelog sections for ${version}. ` +
        `Exactly one is required — which one ships is otherwise ambiguous.`,
    );
  }

  const section = matches[0];
  const headingLine = section.index + 1;

  // --- heading: dated, and not still marked Unreleased ----------------------

  const remainder = section.remainder.trim();

  if (/unreleased/i.test(section.text)) {
    fail(
      headingLine,
      `The ${version} heading is still marked Unreleased. Replace it with the ` +
        `release date: "## [${version}] - YYYY-MM-DD".`,
    );
  } else {
    const dateMatch = /^[-–—]\s*(\S+)(\s+\[YANKED\])?$/.exec(remainder);
    if (!dateMatch) {
      fail(
        headingLine,
        `The ${version} heading has no release date. Expected ` +
          `"## [${version}] - YYYY-MM-DD", got "${section.text.trim()}".`,
      );
    } else if (!isRealIsoDate(dateMatch[1])) {
      fail(
        headingLine,
        `"${dateMatch[1]}" is not a valid ISO date on the ${version} heading. ` +
          `Expected YYYY-MM-DD.`,
      );
    }
  }

  // --- section body: everything up to the next "## " heading ----------------

  let end = lines.length;
  for (let i = section.index + 1; i < lines.length; i += 1) {
    if (/^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }

  const bodyLines = lines.slice(section.index + 1, end);
  const bodyText = bodyLines.join("\n");

  // Link definitions collect at the bottom of the file, which falls inside the
  // last section's body. They are not content.
  const contentLines = stripComments(bodyText)
    .split("\n")
    .filter((line) => line.trim() !== "" && !isLinkDefinition(line));

  const bullets = contentLines.filter((line) => /^\s*[-*+]\s+\S/.test(line));
  const meaningfulBullets = bullets.filter(
    (line) => line.replace(/^\s*[-*+]\s+/, "").trim().length >= 3,
  );

  if (meaningfulBullets.length === 0) {
    fail(
      headingLine,
      `The ${version} section has no entries. A release that changed nothing ` +
        `worth writing down should not be tagged.`,
    );
  }

  // --- comparison link ------------------------------------------------------

  const linkPattern = new RegExp(`^\\s*\\[${escapeRegExp(version)}\\]:\\s*(\\S+)`, "i");
  const linkLine = lines.findIndex((line) => linkPattern.test(line));

  if (linkLine === -1) {
    fail(
      null,
      `No comparison link for ${version}. Add a "[${version}]: https://..." ` +
        `definition at the foot of the file.`,
    );
  } else {
    const url = linkPattern.exec(lines[linkLine])?.[1] ?? "";
    if (!/^https?:\/\/\S+$/.test(url)) {
      fail(linkLine + 1, `The comparison link for ${version} is not a URL: "${url}".`);
    }
  }

  // --- scaffolding wording, scoped to this section --------------------------
  // Checked against the raw body, comments included: a leftover
  // "<!-- describe the change -->" is exactly what this is looking for.

  for (const phrase of SCAFFOLDING_PHRASES) {
    const pattern = new RegExp(`\\b${escapeRegExp(phrase)}\\b`, "i");
    const hitOffset = bodyLines.findIndex((line) => pattern.test(line));
    if (hitOffset !== -1) {
      fail(
        section.index + hitOffset + 2,
        `The ${version} section still contains scaffolding wording ` +
          `("${phrase}"). Write the entry or delete the line.`,
      );
    }
  }

  // --- report ---------------------------------------------------------------

  if (errors.length > 0) {
    for (const error of errors) annotate(displayPath, error.line, error.message);
    console.log(`::error::CHANGELOG check failed for ${version}`);
    return EXIT_FAILED;
  }

  console.log(`CHANGELOG section for ${version} looks releasable.`);
  return EXIT_OK;
}

process.exit(main(process.argv.slice(2)));
