// main.ts is mend, the CLI SPEC.md specifies. Base: the kit's starter (MIT), which does sections 1 to 4, 9 and 10
// of SPEC.md. Added here: section 5 (three-tier line matching), section 6 (unified diffs), section 7
// (SEARCH/REPLACE blocks), section 8 (V4A patches), and the R (rename) lines of section 2 in the final report.
// Node 22, the standard library alone; run it as `node main.ts [options] [PATCH]`.
//
// In a trial the grader runs `node /bot/main.ts` with MAKEFUN_ENV_URL set, and then this file hands over to runner.ts
// (the last lines below): keep that hand-over and runner.ts as they are, and write the CLI.

import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

const FORMATS = ['auto', 'unified', 'search-replace', 'v4a', 'json'];

class Exit2 {
  readonly line: string;
  constructor(line: string) {
    this.line = line;
  }
}
class Fail {
  readonly code: string;
  readonly path: string;
  constructor(code: string, path: string) {
    this.code = code;
    this.path = path;
  }
}

const blank = (s: string): boolean => s.trim() === '';

function patchLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (text.endsWith('\n')) lines.pop();
  return lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
}

function safe(p: string): boolean {
  return p !== '' && !p.startsWith('/') && !p.includes('\\') && p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

/** The tree as the edits leave it: changed paths in `now` (null: deleted), the rest read from disk. */
class Tree {
  private readonly orig = new Map<string, string | null>();
  readonly now = new Map<string, string | null>();
  original(p: string): string | null {
    if (!this.orig.has(p)) {
      let v: string | null = null;
      try {
        if (statSync(p).isFile()) v = readFileSync(p, 'utf8');
      } catch {
        v = null;
      }
      this.orig.set(p, v);
    }
    return this.orig.get(p)!;
  }
  get(p: string): string | null {
    return this.now.has(p) ? this.now.get(p)! : this.original(p);
  }
}

type Edit = (tree: Tree) => void;

function detect(lines: string[]): string | null {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) return null;
  if (lines[first]!.trim() === '*** Begin Patch') return 'v4a';
  const c = lines[first]!.trimStart()[0];
  if (c === '[' || c === '{') return 'json';
  if (lines.some((l) => l.trimEnd() === '<<<<<<< SEARCH')) return 'search-replace';
  if (lines.some((l, i) => l.startsWith('diff --git ') || (l.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')))) return 'unified';
  return null;
}

/** One JSON edit object (SPEC.md section 9), or null when it is not one. */
function jsonEdit(v: unknown): Edit | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const p = o.path;
  if (typeof p !== 'string') return null;
  const exists = (tree: Tree): string => {
    if (!safe(p)) throw new Fail('unsafe', p);
    const t = tree.get(p);
    if (t === null) throw new Fail('missing', p);
    return t;
  };
  if (o.command === 'create' && typeof o.file_text === 'string') {
    const text = o.file_text;
    return (tree) => {
      if (!safe(p)) throw new Fail('unsafe', p);
      if (tree.get(p) !== null) throw new Fail('exists', p);
      tree.now.set(p, text);
    };
  }
  if (o.command === 'str_replace' && typeof o.old_str === 'string' && o.old_str !== '' && (o.new_str === undefined || typeof o.new_str === 'string')) {
    const oldStr = o.old_str;
    const newStr = (o.new_str as string | undefined) ?? '';
    return (tree) => {
      const before = exists(tree);
      const nl = before.indexOf('\n');
      const crlf = nl > 0 && before[nl - 1] === '\r';
      const lf = (s: string): string => (crlf ? s.replaceAll('\r\n', '\n') : s);
      const t = lf(before);
      const old = lf(oldStr);
      let count = 0;
      for (let k = t.indexOf(old); k >= 0; k = t.indexOf(old, k + 1)) count += 1;
      if (count === 0) throw new Fail('no-match', p);
      if (count > 1) throw new Fail('ambiguous', p);
      const at = t.indexOf(old);
      const out = t.slice(0, at) + lf(newStr) + t.slice(at + old.length);
      tree.now.set(p, crlf ? out.replaceAll('\n', '\r\n') : out);
    };
  }
  if (o.command === 'insert' && typeof o.insert_line === 'number' && Number.isInteger(o.insert_line) && typeof o.new_str === 'string') {
    const line = o.insert_line;
    const add = patchLines(o.new_str);
    return (tree) => {
      const before = exists(tree);
      const nl = before.indexOf('\n');
      const br = nl > 0 && before[nl - 1] === '\r' ? '\r\n' : '\n';
      const lines = before === '' ? [] : before.split(br);
      const final = before !== '' && before.endsWith(br);
      if (final) lines.pop();
      if (line < 0 || line > lines.length) throw new Fail('no-match', p);
      lines.splice(line, 0, ...add);
      tree.now.set(p, lines.length === 0 ? '' : lines.join(br) + (final ? br : ''));
    };
  }
  return null;
}

function jsonEdits(text: string, lines: string[]): Edit[] {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) throw new Exit2('error: parse 1');
  const edits: Edit[] = [];
  if (lines[first]!.trimStart().startsWith('[')) {
    let v: unknown;
    try {
      v = JSON.parse(text);
    } catch {
      throw new Exit2(`error: parse ${first + 1}`);
    }
    if (!Array.isArray(v)) throw new Exit2(`error: parse ${first + 1}`);
    for (const x of v) {
      const e = jsonEdit(x);
      if (e === null) throw new Exit2(`error: parse ${first + 1}`);
      edits.push(e);
    }
    return edits;
  }
  lines.forEach((l, i) => {
    if (blank(l)) return;
    let e: Edit | null = null;
    try {
      e = jsonEdit(JSON.parse(l));
    } catch {
      e = null;
    }
    if (e === null) throw new Exit2(`error: parse ${i + 1}`);
    edits.push(e);
  });
  return edits;
}

// ---------- Section 3: the file model ----------

interface FileModel {
  br: '\n' | '\r\n';
  lines: string[];
  finalBreak: boolean;
}

function parseFile(text: string): FileModel {
  const nl = text.indexOf('\n');
  const br: '\n' | '\r\n' = nl > 0 && text[nl - 1] === '\r' ? '\r\n' : '\n';
  if (text === '') return { br: '\n', lines: [], finalBreak: false };
  const parts = text.split(br);
  const finalBreak = text.endsWith(br);
  if (finalBreak) parts.pop();
  return { br, lines: parts, finalBreak };
}

function writeFile(m: FileModel): string {
  if (m.lines.length === 0) return '';
  return m.lines.join(m.br) + (m.finalBreak ? m.br : '');
}

// ---------- Section 5: matching lines at three tiers ----------

const leadWS = (s: string): string => /^[ \t]*/.exec(s)![0];
const trailWS = (s: string): string => s.replace(/[ \t]+$/, '');
const bothWS = (s: string): string => s.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');

function tierEq(a: string, b: string, tier: number): boolean {
  if (tier === 0) return a === b;
  if (tier === 1) return trailWS(a) === trailWS(b);
  return bothWS(a) === bothWS(b);
}

interface Found {
  tier: number;
  positions: number[];
}

/** Occurrences of O in lines at the first tier with any, restricted to positions >= from. */
function findTier(lines: string[], O: string[], strict: boolean, from = 0): Found | null {
  const tiers = strict ? [0] : [0, 1, 2];
  for (const t of tiers) {
    const pos: number[] = [];
    for (let i = from; i + O.length <= lines.length; i++) {
      let ok = true;
      for (let j = 0; j < O.length; j++) {
        if (!tierEq(lines[i + j]!, O[j]!, t)) {
          ok = false;
          break;
        }
      }
      if (ok) pos.push(i);
    }
    if (pos.length > 0) return { tier: t, positions: pos };
  }
  return null;
}

/** One line of N: a context line (written as the file's own matched line) or a new line. `brk`: a `\` line follows it. */
interface NEnt {
  ctx: boolean;
  text: string;
  oIdx: number;
  brk: boolean;
}

/** The lines a match writes: context lines from the file, tier-2 re-indentation of the rest. */
function buildLines(lines: string[], pos: number, O: string[], N: NEnt[], tier: number): string[] {
  const F = leadWS(lines[pos] ?? '');
  const P = leadWS(O[0] ?? '');
  return N.map((e) => {
    if (e.ctx) return lines[pos + e.oIdx]!;
    if (tier === 2 && !/^[ \t]*$/.test(e.text) && e.text.startsWith(P)) return F + e.text.slice(P.length);
    return e.text;
  });
}

/** Split hunk/chunk body entries into O (old lines) and N (new entries), in body order. */
function bodyON(body: { kind: string; text: string }[]): { O: string[]; N: NEnt[] } {
  const O: string[] = [];
  const N: NEnt[] = [];
  let prevN: NEnt | null = null;
  for (const b of body) {
    if (b.kind === ' ') {
      O.push(b.text);
      const e: NEnt = { ctx: true, text: b.text, oIdx: O.length - 1, brk: false };
      N.push(e);
      prevN = e;
    } else if (b.kind === '-') {
      O.push(b.text);
      prevN = null;
    } else if (b.kind === '+') {
      const e: NEnt = { ctx: false, text: b.text, oIdx: -1, brk: false };
      N.push(e);
      prevN = e;
    } else if (b.kind === '\\') {
      // A `\` line refers to the body line before it: it flags that line, when that line is one of N.
      if (prevN !== null) prevN.brk = true;
    }
  }
  return { O, N };
}

// ---------- Section 6: unified diffs ----------

interface Hunk {
  A: number;
  body: { kind: string; text: string; emptyLine: boolean }[];
}

interface USection {
  diffOld: string | null;
  diffNew: string | null;
  hdrOld: string | null | undefined;
  hdrNew: string | null | undefined;
  renameFrom: string | null;
  renameTo: string | null;
  newFile: boolean;
  delFile: boolean;
  hunks: Hunk[];
}

/** The path a ---/+++ line names: after the four characters, up to the first tab, spaces removed. */
function hdrPath(l: string): string | null {
  let p = l.slice(4).split('\t')[0]!.replace(/^ +| +$/g, '');
  if (p === '/dev/null') return null;
  if (p.startsWith('a/') || p.startsWith('b/')) p = p.slice(2);
  return p;
}

function barePath(s: string): string {
  let p = s.replace(/^ +| +$/g, '');
  if (p.startsWith('a/') || p.startsWith('b/')) p = p.slice(2);
  return p;
}

function unifiedEdits(lines: string[], strict: boolean, moves: [string, string][]): Edit[] {
  const sections: USection[] = [];
  let cur: USection | null = null;
  let inHeader = false;
  const fresh = (): USection => ({ diffOld: null, diffNew: null, hdrOld: undefined, hdrNew: undefined, renameFrom: null, renameTo: null, newFile: false, delFile: false, hunks: [] });
  let i = 0;
  while (i < lines.length) {
    const l = lines[i]!;
    if (l.startsWith('diff --git ')) {
      const m = /^a\/(.+) b\/(.+)$/.exec(l.slice(11).replace(/ +$/, ''));
      if (m === null) throw new Exit2(`error: parse ${i + 1}`);
      cur = fresh();
      cur.diffOld = m[1]!;
      cur.diffNew = m[2]!;
      sections.push(cur);
      inHeader = true;
      i += 1;
      continue;
    }
    if (l.startsWith('--- ') && i + 1 < lines.length && lines[i + 1]!.startsWith('+++ ')) {
      if (cur !== null && inHeader && cur.hdrOld === undefined) {
        cur.hdrOld = hdrPath(l);
        cur.hdrNew = hdrPath(lines[i + 1]!);
      } else {
        cur = fresh();
        cur.hdrOld = hdrPath(l);
        cur.hdrNew = hdrPath(lines[i + 1]!);
        sections.push(cur);
        inHeader = true;
      }
      i += 2;
      continue;
    }
    if (cur !== null && inHeader && l.startsWith('--- ')) {
      throw new Exit2(`error: parse ${i + 2}`);
    }
    if (cur !== null && inHeader && l.startsWith('rename from ')) {
      cur.renameFrom = barePath(l.slice(12));
      i += 1;
      continue;
    }
    if (cur !== null && inHeader && l.startsWith('rename to ')) {
      cur.renameTo = barePath(l.slice(10));
      i += 1;
      continue;
    }
    if (cur !== null && inHeader && l.startsWith('new file mode')) {
      cur.newFile = true;
      i += 1;
      continue;
    }
    if (cur !== null && inHeader && l.startsWith('deleted file mode')) {
      cur.delFile = true;
      i += 1;
      continue;
    }
    if (l.startsWith('@@')) {
      if (cur === null) throw new Exit2(`error: parse ${i + 1}`);
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(l);
      if (m === null) throw new Exit2(`error: parse ${i + 1}`);
      inHeader = false;
      const body: { kind: string; text: string; emptyLine: boolean }[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const bl = lines[j]!;
        if (bl.startsWith('diff --git ')) break;
        if (bl.startsWith('--- ') && j + 1 < lines.length && lines[j + 1]!.startsWith('+++ ')) break;
        const c = bl[0];
        if (bl === '') body.push({ kind: ' ', text: '', emptyLine: true });
        else if (c === ' ' || c === '-' || c === '+' || c === '\\') body.push({ kind: c, text: bl.slice(1), emptyLine: false });
        else break;
        j += 1;
      }
      while (body.length > 0 && body[body.length - 1]!.emptyLine) body.pop();
      cur.hunks.push({ A: parseInt(m[1]!, 10), body });
      i = j;
      continue;
    }
    i += 1;
  }
  if (sections.length === 0) throw new Exit2('error: parse 1');
  return sections.map((s) => unifiedEdit(s, strict, moves));
}

function unifiedEdit(s: USection, strict: boolean, moves: [string, string][]): Edit {
  const oldPath = s.hdrOld !== undefined ? s.hdrOld : s.renameFrom !== null ? s.renameFrom : s.diffOld;
  const newPath = s.hdrNew !== undefined ? s.hdrNew : s.renameTo !== null ? s.renameTo : s.diffNew;
  const creation = oldPath === null || s.newFile;
  const deletion = !creation && (newPath === null || s.delFile);
  return (tree) => {
    if (oldPath !== null && !safe(oldPath)) throw new Fail('unsafe', oldPath);
    if (newPath !== null && !safe(newPath)) throw new Fail('unsafe', newPath);
    if (creation) {
      const p = newPath!;
      if (tree.get(p) !== null) throw new Fail('exists', p);
      const outLines: string[] = [];
      let lastPlusBrk = false;
      for (const h of s.hunks) {
        let prevPlus = false;
        for (const b of h.body) {
          if (b.kind === '+') {
            outLines.push(b.text);
            prevPlus = true;
            lastPlusBrk = false;
          } else if (b.kind === '\\') {
            if (prevPlus) lastPlusBrk = true;
          } else prevPlus = false;
        }
      }
      tree.now.set(p, writeFile({ br: '\n', lines: outLines, finalBreak: !lastPlusBrk }));
      return;
    }
    if (deletion) {
      const p = oldPath!;
      if (tree.get(p) === null) throw new Fail('missing', p);
      tree.now.set(p, null);
      return;
    }
    const p = oldPath!;
    const before = tree.get(p);
    if (before === null) throw new Fail('missing', p);
    const isMove = newPath !== null && newPath !== oldPath;
    if (isMove && tree.get(newPath!) !== null) throw new Fail('exists', newPath!);
    const model = parseFile(before);
    let d = 0;
    for (const h of s.hunks) {
      const { O, N } = bodyON(h.body);
      if (O.length > 0) {
        const found = findTier(model.lines, O, strict);
        if (found === null) throw new Fail('no-match', p);
        const target = h.A - 1 + d;
        let pos = found.positions[0]!;
        for (const q of found.positions) if (Math.abs(q - target) < Math.abs(pos - target)) pos = q;
        const ranToEnd = pos + O.length === model.lines.length;
        const built = buildLines(model.lines, pos, O, N, found.tier);
        model.lines.splice(pos, O.length, ...built);
        if (ranToEnd) model.finalBreak = N.length === 0 ? true : !N[N.length - 1]!.brk;
        d += N.length - O.length;
      } else {
        const at = Math.min(h.A + d, model.lines.length);
        const ranToEnd = at === model.lines.length;
        const built = N.map((e) => e.text);
        model.lines.splice(at, 0, ...built);
        if (ranToEnd) model.finalBreak = N.length === 0 ? true : !N[N.length - 1]!.brk;
        d += N.length;
      }
    }
    const text = writeFile(model);
    if (isMove) {
      tree.now.set(p, null);
      tree.now.set(newPath!, text);
      moves.push([p, newPath!]);
    } else {
      tree.now.set(p, text);
    }
  };
}

// ---------- Section 7: SEARCH/REPLACE blocks ----------

function srEdits(lines: string[], strict: boolean): Edit[] {
  interface Block {
    path: string;
    oldLines: string[];
    newLines: string[];
  }
  const blocks: Block[] = [];
  let prevPath: string | null = null;
  let after = 0;
  let i = 0;
  while (i < lines.length) {
    if (lines[i]!.trimEnd() !== '<<<<<<< SEARCH') {
      i += 1;
      continue;
    }
    const searchAt = i;
    let path: string | null = null;
    for (let j = searchAt - 1; j >= after; j--) {
      const cand = lines[j]!;
      if (!blank(cand) && !cand.trim().startsWith('```')) {
        path = cand.trim();
        break;
      }
    }
    if (path === null) {
      if (prevPath === null) throw new Exit2(`error: parse ${searchAt + 1}`);
      path = prevPath;
    }
    let eq = -1;
    for (let j = searchAt + 1; j < lines.length; j++) {
      if (lines[j]!.trimEnd() === '=======') {
        eq = j;
        break;
      }
    }
    let rep = -1;
    if (eq >= 0) {
      for (let j = eq + 1; j < lines.length; j++) {
        if (lines[j]!.trimEnd() === '>>>>>>> REPLACE') {
          rep = j;
          break;
        }
      }
    }
    if (eq < 0 || rep < 0) throw new Exit2(`error: parse ${searchAt + 1}`);
    blocks.push({ path, oldLines: lines.slice(searchAt + 1, eq), newLines: lines.slice(eq + 1, rep) });
    prevPath = path;
    after = rep + 1;
    i = rep + 1;
  }
  if (blocks.length === 0) throw new Exit2('error: parse 1');
  return blocks.map((b) => {
    const p = b.path;
    const oldLines = b.oldLines;
    const newLines = b.newLines;
    return (tree: Tree) => {
      if (!safe(p)) throw new Fail('unsafe', p);
      if (oldLines.length === 0) {
        if (tree.get(p) !== null) throw new Fail('exists', p);
        tree.now.set(p, writeFile({ br: '\n', lines: [...newLines], finalBreak: true }));
        return;
      }
      const before = tree.get(p);
      if (before === null) throw new Fail('missing', p);
      const model = parseFile(before);
      const found = findTier(model.lines, oldLines, strict);
      if (found === null) throw new Fail('no-match', p);
      if (found.positions.length > 1) throw new Fail('ambiguous', p);
      const pos = found.positions[0]!;
      const N: NEnt[] = newLines.map((t) => ({ ctx: false, text: t, oIdx: -1, brk: false }));
      const built = buildLines(model.lines, pos, oldLines, N, found.tier);
      model.lines.splice(pos, oldLines.length, ...built);
      tree.now.set(p, writeFile(model));
    };
  });
}

// ---------- Section 8: V4A patches ----------

interface Chunk {
  anchor: string | null;
  body: { kind: string; text: string }[];
  eof: boolean;
}

interface VSection {
  kind: 'add' | 'del' | 'upd';
  path: string;
  startLine: number;
  addLines: string[];
  moveTo: string | null;
  chunks: Chunk[];
}

const V_ADD = '*** Add File: ';
const V_DEL = '*** Delete File: ';
const V_UPD = '*** Update File: ';
const V_MOVE = '*** Move to: ';

function v4aEdits(lines: string[], strict: boolean, moves: [string, string][]): Edit[] {
  const fb = lines.findIndex((l) => !blank(l));
  if (fb < 0) throw new Exit2('error: parse 1');
  if (lines[fb]!.trim() !== '*** Begin Patch') throw new Exit2(`error: parse ${fb + 1}`);
  let lb = -1;
  for (let k = lines.length - 1; k >= 0; k--) {
    if (!blank(lines[k]!)) {
      lb = k;
      break;
    }
  }
  if (lb < 0 || lines[lb]!.trim() !== '*** End Patch') throw new Exit2(`error: parse ${lines.length + 1}`);
  const isStart = (l: string): 'add' | 'del' | 'upd' | null =>
    l.startsWith(V_ADD) ? 'add' : l.startsWith(V_DEL) ? 'del' : l.startsWith(V_UPD) ? 'upd' : null;
  const sections: VSection[] = [];
  let i = fb + 1;
  while (i < lb) {
    const l = lines[i]!;
    if (blank(l)) {
      i += 1;
      continue;
    }
    const kind = isStart(l);
    if (kind === null) throw new Exit2(`error: parse ${i + 1}`);
    const prefix = kind === 'add' ? V_ADD : kind === 'del' ? V_DEL : V_UPD;
    const sec: VSection = { kind, path: l.slice(prefix.length).replace(/^ +| +$/g, ''), startLine: i + 1, addLines: [], moveTo: null, chunks: [] };
    sections.push(sec);
    i += 1;
    if (kind === 'add') {
      const got: string[] = [];
      while (i < lb && isStart(lines[i]!) === null) {
        const bl = lines[i]!;
        if (bl.startsWith('+')) got.push(bl.slice(1));
        else if (bl === '') got.push('');
        else throw new Exit2(`error: parse ${i + 1}`);
        i += 1;
      }
      while (got.length > 0 && got[got.length - 1] === '') got.pop();
      sec.addLines = got;
    } else if (kind === 'del') {
      while (i < lb && isStart(lines[i]!) === null) {
        if (!blank(lines[i]!)) throw new Exit2(`error: parse ${i + 1}`);
        i += 1;
      }
    } else {
      let firstLine = true;
      let cur: Chunk | null = null;
      while (i < lb && isStart(lines[i]!) === null) {
        const bl = lines[i]!;
        if (firstLine && bl.startsWith(V_MOVE)) {
          sec.moveTo = bl.slice(V_MOVE.length).replace(/^ +| +$/g, '');
          firstLine = false;
          i += 1;
          continue;
        }
        firstLine = false;
        if (bl.startsWith('@@')) {
          const anchor = bl.slice(2).replace(/^ +| +$/g, '');
          cur = { anchor: anchor === '' ? null : anchor, body: [], eof: false };
          sec.chunks.push(cur);
          i += 1;
          continue;
        }
        if (bl.trim() === '*** End of File') {
          if (cur === null) {
            cur = { anchor: null, body: [], eof: true };
            sec.chunks.push(cur);
          } else cur.eof = true;
          cur = null;
          i += 1;
          continue;
        }
        const c = bl[0];
        if (bl === '' || c === ' ' || c === '-' || c === '+') {
          if (cur === null) {
            if (sec.chunks.length > 0) throw new Exit2(`error: parse ${i + 1}`);
            cur = { anchor: null, body: [], eof: false };
            sec.chunks.push(cur);
          }
          cur.body.push({ kind: bl === '' ? ' ' : c!, text: bl === '' ? '' : bl.slice(1) });
          i += 1;
          continue;
        }
        throw new Exit2(`error: parse ${i + 1}`);
      }
      // Blank lines at the end of the section are not part of it: drop trailing empty context lines of the last chunk.
      const last = sec.chunks.length > 0 ? sec.chunks[sec.chunks.length - 1]! : null;
      if (last !== null) {
        while (last.body.length > 0) {
          const t = last.body[last.body.length - 1]!;
          if (t.kind === ' ' && t.text === '') last.body.pop();
          else break;
        }
      }
      if (sec.chunks.length === 0 && sec.moveTo === null) throw new Exit2(`error: parse ${sec.startLine}`);
    }
  }
  if (sections.length === 0) throw new Exit2('error: parse 1');
  return sections.map((s) => v4aEdit(s, strict, moves));
}

function v4aEdit(s: VSection, strict: boolean, moves: [string, string][]): Edit {
  const p = s.path;
  return (tree) => {
    if (!safe(p)) throw new Fail('unsafe', p);
    if (s.kind === 'add') {
      if (tree.get(p) !== null) throw new Fail('exists', p);
      tree.now.set(p, writeFile({ br: '\n', lines: [...s.addLines], finalBreak: true }));
      return;
    }
    if (s.kind === 'del') {
      if (tree.get(p) === null) throw new Fail('missing', p);
      tree.now.set(p, null);
      return;
    }
    if (s.moveTo !== null && !safe(s.moveTo)) throw new Fail('unsafe', s.moveTo);
    const before = tree.get(p);
    if (before === null) throw new Fail('missing', p);
    if (s.moveTo !== null && tree.get(s.moveTo) !== null) throw new Fail('exists', s.moveTo);
    const model = parseFile(before);
    let cursor = 0;
    for (const ch of s.chunks) {
      if (ch.anchor !== null) {
        const tiers = strict ? [0] : [0, 1, 2];
        let at = -1;
        for (const t of tiers) {
          for (let k = cursor; k < model.lines.length; k++) {
            if (tierEq(model.lines[k]!, ch.anchor, t)) {
              at = k;
              break;
            }
          }
          if (at >= 0) break;
        }
        if (at < 0) throw new Fail('no-match', p);
        cursor = at + 1;
      }
      const { O, N } = bodyON(ch.body);
      if (O.length > 0) {
        const found = findTier(model.lines, O, strict, cursor);
        if (found === null) throw new Fail('no-match', p);
        let pos = -1;
        for (const q of found.positions) {
          if (!ch.eof || q + O.length === model.lines.length) {
            pos = q;
            break;
          }
        }
        if (pos < 0) throw new Fail('no-match', p);
        const built = buildLines(model.lines, pos, O, N, found.tier);
        model.lines.splice(pos, O.length, ...built);
        cursor = pos + built.length;
      } else {
        const at = ch.eof ? model.lines.length : Math.min(cursor, model.lines.length);
        const built = N.map((e) => e.text);
        model.lines.splice(at, 0, ...built);
        cursor = at + built.length;
      }
    }
    const text = writeFile(model);
    if (s.moveTo !== null) {
      tree.now.set(p, null);
      tree.now.set(s.moveTo, text);
      moves.push([p, s.moveTo]);
    } else {
      tree.now.set(p, text);
    }
  };
}

// ---------- Running (sections 1, 2 and 10) ----------

function run(args: string[]): { code: number; out: string[] } {
  let format: string | null = null;
  let check = false;
  let strict = false;
  const pos: string[] = [];
  let ended = false;
  for (const a of args) {
    if (!ended && a === '--') ended = true;
    else if (!ended && a.startsWith('-') && a !== '-') {
      if (a.startsWith('--format=') && format === null && FORMATS.includes(a.slice(9))) format = a.slice(9);
      else if (a === '--check' && !check) check = true;
      else if (a === '--strict' && !strict) strict = true;
      else return { code: 2, out: ['error: usage'] };
    } else pos.push(a);
  }
  if (pos.length > 1) return { code: 2, out: ['error: usage'] };
  const file = pos.length === 0 || pos[0] === '-' ? null : pos[0]!;
  let text = '';
  try {
    text = readFileSync(file ?? 0, 'utf8');
  } catch {
    if (file !== null) return { code: 2, out: ['error: no-patch'] };
  }
  const lines = patchLines(text);
  const kind = format === null || format === 'auto' ? detect(lines) : format;
  if (kind === null) return { code: 2, out: ['error: format'] };
  const moves: [string, string][] = [];
  let edits: Edit[];
  try {
    if (kind === 'json') edits = jsonEdits(text, lines);
    else if (kind === 'unified') edits = unifiedEdits(lines, strict, moves);
    else if (kind === 'search-replace') edits = srEdits(lines, strict);
    else edits = v4aEdits(lines, strict, moves);
    if (edits.length === 0) throw new Exit2('error: parse 1');
  } catch (e) {
    if (e instanceof Exit2) return { code: 2, out: [e.line] };
    throw e;
  }
  const tree = new Tree();
  const fails: Fail[] = [];
  for (const edit of edits) {
    const before = new Map(tree.now);
    try {
      edit(tree);
    } catch (e) {
      if (!(e instanceof Fail)) throw e;
      tree.now.clear();
      for (const [k, v] of before) tree.now.set(k, v);
      fails.push(e);
    }
  }
  if (fails.length > 0) return { code: 1, out: [...fails.map((f) => `error: ${f.code} ${f.path}`), `failed: ${fails.length} of ${edits.length} edits`] };
  const changed = [...tree.now.keys()].filter((p) => tree.original(p) !== tree.now.get(p)!);
  if (!check) {
    for (const p of changed) {
      const now = tree.now.get(p)!;
      if (now === null) rmSync(p, { force: true });
      else {
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, now);
      }
    }
  }
  const suppressed = new Set<string>();
  const keyed: { key: string; line: string }[] = [];
  for (const [o, n] of moves) {
    if (suppressed.has(o) || suppressed.has(n)) continue;
    if (tree.original(o) !== null && tree.get(o) === null && tree.original(n) === null && tree.get(n) !== null) {
      keyed.push({ key: n, line: `R ${o} -> ${n}` });
      suppressed.add(o);
      suppressed.add(n);
    }
  }
  for (const p of changed) {
    if (suppressed.has(p)) continue;
    const was = tree.original(p);
    const now = tree.now.get(p)!;
    keyed.push({ key: p, line: `${was === null ? 'A' : now === null ? 'D' : 'M'} ${p}` });
  }
  keyed.sort((a, b) => Buffer.compare(Buffer.from(a.key), Buffer.from(b.key)));
  const rows = keyed.map((k) => k.line);
  return { code: 0, out: [...rows, `ok: ${rows.length} ${rows.length === 1 ? 'file' : 'files'}`] };
}


const trialEnv = process.env.MAKEFUN_ENV_URL;
if (trialEnv !== undefined && trialEnv !== '') {
  // A trial: the kit's runner reads the checks from the env and runs this file on each one, without this variable.
  const { runTrial } = await import('./runner.ts');
  await runTrial(trialEnv);
} else {
  const r = run(process.argv.slice(2));
  writeSync(1, r.out.map((l) => `${l}\n`).join(''));
  process.exitCode = r.code;
}
