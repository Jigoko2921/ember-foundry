// Ember Foundry's hand-in (Node 22, standard library only). The game is this directory's game/
// folder: plain static files the browser loads as ES modules, with three.js from an import map.
// This program copies game/ and screenshots/ from beside itself into the output directory
// (MAKEFUN_OUTPUT_DIR, or /output under the grader) and writes dossier.json there — the summary the
// judge reads — with the vendored make.fun library, so what is scored is exactly what this repo
// holds. Nothing of the entry is read over the network and nothing is built: every byte handed in
// is a byte committed here.
//
// The copy order matters: game/ and screenshots/ land in the output directory first, because
// buildDossier() walks that directory, not this one. It reads game/ (sources for the dossier's
// text, assets and vendored files for its counts), screenshots/ (the images, the first by name the
// cover) and refuses an entry the scorer would refuse.
//
// Serve it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

/** This entry's own directory: game/ and screenshots/ sit beside this file, not beside the cwd. */
const here = fileURLToPath(new URL('.', import.meta.url));
/** Where the hand-in is assembled: /output under the grader, MAKEFUN_OUTPUT_DIR outside it. */
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// game/ is required (it is the entry) and is copied whole, three.js and all.
mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });

// screenshots/ is copied when present; buildDossier refuses an entry without one, so a missing
// screenshots/ fails here with that message rather than an ENOENT from the copy.
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });
}

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the bytes; the others
// refuse an entry the scorer would refuse (more than 4 screenshots or one over 256 KiB; more than
// 993 files in game/ or 48 MiB of game files, in all: game/ counts beside /output's own 1000-entry
// cap, its screenshots/ and dossier.json). Passing them all makes this program fail exactly where
// the gate would, instead of shipping an entry the judge rejects.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
  }),
);
