/**
 * A faithful port of VS Code's suggest-widget scoring/sorting pipeline, so tests
 * can measure what the user ACTUALLY sees after typing a prefix — not just the
 * empty-prefix sortText order that rankEvalCore measures.
 *
 * Ported from microsoft/vscode (MIT License, Copyright (c) Microsoft Corporation):
 *   src/vs/base/common/filters.ts                        (fuzzyScore, anyScore, graceful)
 *   src/vs/editor/contrib/suggest/browser/completionModel.ts (filter + sort semantics)
 *   src/vs/editor/contrib/suggest/browser/suggest.ts     (initial sortText comparator)
 * Fetched 2026-07-10 from the main branch. Behavioral notes:
 *  - Initial order (idx) = sortText (lowercased) then label — this is the order VS
 *    Code shows for an EMPTY prefix and the tiebreak once the user types.
 *  - With a typed word: items are scored with fuzzyScore (firstMatchCanBeWeak:
 *    false, boostFullMatch: true); NON-MATCHES ARE DROPPED; sort is score desc,
 *    then idx asc (wordDistance is 0 unless editor.suggest.localityBonus).
 *  - filterGraceful (default on) upgrades to fuzzyScoreGracefulAggressive only
 *    when the list has ≤ 2000 items — our real lists historically exceeded that.
 */

/* eslint-disable */

// ---- filters.ts (trimmed to the completion path) --------------------------------

const enum CharCode {
  Tab = 9,
  Space = 32,
  DoubleQuote = 34,
  DollarSign = 36,
  SingleQuote = 39,
  OpenParen = 40,
  CloseParen = 41,
  Dash = 45,
  Period = 46,
  Slash = 47,
  Colon = 58,
  LessThan = 60,
  GreaterThan = 62,
  OpenSquareBracket = 91,
  Backslash = 92,
  CloseSquareBracket = 93,
  Underline = 95,
  OpenCurlyBrace = 123,
  CloseCurlyBrace = 125,
}

/** [score, wordStart, ...matchPositions] */
export type FuzzyScore = [score: number, wordStart: number, ...matches: number[]];

export namespace FuzzyScore {
  export const Default: FuzzyScore = [-100, 0];
}

export interface FuzzyScoreOptions {
  readonly firstMatchCanBeWeak: boolean;
  readonly boostFullMatch: boolean;
}

export const FuzzyScoreOptionsDefault: FuzzyScoreOptions = {
  boostFullMatch: true,
  firstMatchCanBeWeak: false,
};

const _maxLen = 128;

function initTable() {
  const table: number[][] = [];
  const row: number[] = [];
  for (let i = 0; i <= _maxLen; i++) row[i] = 0;
  for (let i = 0; i <= _maxLen; i++) table.push(row.slice(0));
  return table;
}

function initArr(maxLen: number) {
  const row: number[] = [];
  for (let i = 0; i <= maxLen; i++) row[i] = 0;
  return row;
}

const _minWordMatchPos = initArr(2 * _maxLen);
const _maxWordMatchPos = initArr(2 * _maxLen);
const _diag = initTable();
const _table = initTable();
const _arrows = initTable();

function isSeparatorAtPos(value: string, index: number): boolean {
  if (index < 0 || index >= value.length) return false;
  const code = value.codePointAt(index);
  switch (code) {
    case CharCode.Underline:
    case CharCode.Dash:
    case CharCode.Period:
    case CharCode.Space:
    case CharCode.Slash:
    case CharCode.Backslash:
    case CharCode.SingleQuote:
    case CharCode.DoubleQuote:
    case CharCode.Colon:
    case CharCode.DollarSign:
    case CharCode.LessThan:
    case CharCode.GreaterThan:
    case CharCode.OpenParen:
    case CharCode.CloseParen:
    case CharCode.OpenSquareBracket:
    case CharCode.CloseSquareBracket:
    case CharCode.OpenCurlyBrace:
    case CharCode.CloseCurlyBrace:
      return true;
    default:
      return false; // emoji check dropped: CK3 identifiers are ASCII
  }
}

function isWhitespaceAtPos(value: string, index: number): boolean {
  if (index < 0 || index >= value.length) return false;
  const code = value.charCodeAt(index);
  return code === CharCode.Space || code === CharCode.Tab;
}

function isUpperCaseAtPos(pos: number, word: string, wordLow: string): boolean {
  return word[pos] !== wordLow[pos];
}

function isPatternInWord(
  patternLow: string,
  patternPos: number,
  patternLen: number,
  wordLow: string,
  wordPos: number,
  wordLen: number,
  fillMinWordPosArr = false
): boolean {
  while (patternPos < patternLen && wordPos < wordLen) {
    if (patternLow[patternPos] === wordLow[wordPos]) {
      if (fillMinWordPosArr) _minWordMatchPos[patternPos] = wordPos;
      patternPos += 1;
    }
    wordPos += 1;
  }
  return patternPos === patternLen;
}

const enum Arrow {
  Diag = 1,
  Left = 2,
  LeftLeft = 3,
}

export function fuzzyScore(
  pattern: string,
  patternLow: string,
  patternStart: number,
  word: string,
  wordLow: string,
  wordStart: number,
  options: FuzzyScoreOptions = FuzzyScoreOptionsDefault
): FuzzyScore | undefined {
  const patternLen = pattern.length > _maxLen ? _maxLen : pattern.length;
  const wordLen = word.length > _maxLen ? _maxLen : word.length;

  if (patternStart >= patternLen || wordStart >= wordLen || patternLen - patternStart > wordLen - wordStart) {
    return undefined;
  }
  if (!isPatternInWord(patternLow, patternStart, patternLen, wordLow, wordStart, wordLen, true)) {
    return undefined;
  }

  _fillInMaxWordMatchPos(patternLen, wordLen, patternStart, wordStart, patternLow, wordLow);

  let row = 1;
  let column = 1;
  let patternPos = patternStart;
  let wordPos = wordStart;
  const hasStrongFirstMatch = [false];

  for (row = 1, patternPos = patternStart; patternPos < patternLen; row++, patternPos++) {
    const minWordMatchPos = _minWordMatchPos[patternPos];
    const maxWordMatchPos = _maxWordMatchPos[patternPos];
    const nextMaxWordMatchPos = patternPos + 1 < patternLen ? _maxWordMatchPos[patternPos + 1] : wordLen;

    for (
      column = minWordMatchPos - wordStart + 1, wordPos = minWordMatchPos;
      wordPos < nextMaxWordMatchPos;
      column++, wordPos++
    ) {
      let score = Number.MIN_SAFE_INTEGER;
      let canComeDiag = false;

      if (wordPos <= maxWordMatchPos) {
        score = _doScore(
          pattern,
          patternLow,
          patternPos,
          patternStart,
          word,
          wordLow,
          wordPos,
          wordLen,
          wordStart,
          _diag[row - 1][column - 1] === 0,
          hasStrongFirstMatch
        );
      }

      let diagScore = 0;
      if (score !== Number.MIN_SAFE_INTEGER) {
        canComeDiag = true;
        diagScore = score + _table[row - 1][column - 1];
      }

      const canComeLeft = wordPos > minWordMatchPos;
      const leftScore = canComeLeft ? _table[row][column - 1] + (_diag[row][column - 1] > 0 ? -5 : 0) : 0;

      const canComeLeftLeft = wordPos > minWordMatchPos + 1 && _diag[row][column - 1] > 0;
      const leftLeftScore = canComeLeftLeft
        ? _table[row][column - 2] + (_diag[row][column - 2] > 0 ? -5 : 0)
        : 0;

      if (
        canComeLeftLeft &&
        (!canComeLeft || leftLeftScore >= leftScore) &&
        (!canComeDiag || leftLeftScore >= diagScore)
      ) {
        _table[row][column] = leftLeftScore;
        _arrows[row][column] = Arrow.LeftLeft;
        _diag[row][column] = 0;
      } else if (canComeLeft && (!canComeDiag || leftScore >= diagScore)) {
        _table[row][column] = leftScore;
        _arrows[row][column] = Arrow.Left;
        _diag[row][column] = 0;
      } else if (canComeDiag) {
        _table[row][column] = diagScore;
        _arrows[row][column] = Arrow.Diag;
        _diag[row][column] = _diag[row - 1][column - 1] + 1;
      } else {
        throw new Error(`not possible`);
      }
    }
  }

  if (!hasStrongFirstMatch[0] && !options.firstMatchCanBeWeak) {
    return undefined;
  }

  row--;
  column--;

  const result: FuzzyScore = [_table[row][column], wordStart];

  let backwardsDiagLength = 0;
  let maxMatchColumn = 0;

  while (row >= 1) {
    let diagColumn = column;
    do {
      const arrow = _arrows[row][diagColumn];
      if (arrow === Arrow.LeftLeft) {
        diagColumn = diagColumn - 2;
      } else if (arrow === Arrow.Left) {
        diagColumn = diagColumn - 1;
      } else {
        break;
      }
    } while (diagColumn >= 1);

    if (
      backwardsDiagLength > 1 &&
      patternLow[patternStart + row - 1] === wordLow[wordStart + column - 1] &&
      !isUpperCaseAtPos(diagColumn + wordStart - 1, word, wordLow) &&
      backwardsDiagLength + 1 > _diag[row][diagColumn]
    ) {
      diagColumn = column;
    }

    if (diagColumn === column) {
      backwardsDiagLength++;
    } else {
      backwardsDiagLength = 1;
    }

    if (!maxMatchColumn) {
      maxMatchColumn = diagColumn;
    }

    row--;
    column = diagColumn - 1;
    result.push(column);
  }

  if (wordLen - wordStart === patternLen && options.boostFullMatch) {
    result[0] += 2;
  }

  const skippedCharsCount = maxMatchColumn - patternLen;
  result[0] -= skippedCharsCount;

  return result;
}

function _fillInMaxWordMatchPos(
  patternLen: number,
  wordLen: number,
  patternStart: number,
  wordStart: number,
  patternLow: string,
  wordLow: string
) {
  let patternPos = patternLen - 1;
  let wordPos = wordLen - 1;
  while (patternPos >= patternStart && wordPos >= wordStart) {
    if (patternLow[patternPos] === wordLow[wordPos]) {
      _maxWordMatchPos[patternPos] = wordPos;
      patternPos--;
    }
    wordPos--;
  }
}

function _doScore(
  pattern: string,
  patternLow: string,
  patternPos: number,
  patternStart: number,
  word: string,
  wordLow: string,
  wordPos: number,
  wordLen: number,
  wordStart: number,
  newMatchStart: boolean,
  outFirstMatchStrong: boolean[]
): number {
  if (patternLow[patternPos] !== wordLow[wordPos]) {
    return Number.MIN_SAFE_INTEGER;
  }

  let score = 1;
  let isGapLocation = false;
  if (wordPos === patternPos - patternStart) {
    score = pattern[patternPos] === word[wordPos] ? 7 : 5;
  } else if (
    isUpperCaseAtPos(wordPos, word, wordLow) &&
    (wordPos === 0 || !isUpperCaseAtPos(wordPos - 1, word, wordLow))
  ) {
    score = pattern[patternPos] === word[wordPos] ? 7 : 5;
    isGapLocation = true;
  } else if (
    isSeparatorAtPos(wordLow, wordPos) &&
    (wordPos === 0 || !isSeparatorAtPos(wordLow, wordPos - 1))
  ) {
    score = 5;
  } else if (isSeparatorAtPos(wordLow, wordPos - 1) || isWhitespaceAtPos(wordLow, wordPos - 1)) {
    score = 5;
    isGapLocation = true;
  }

  if (score > 1 && patternPos === patternStart) {
    outFirstMatchStrong[0] = true;
  }

  if (!isGapLocation) {
    isGapLocation =
      isUpperCaseAtPos(wordPos, word, wordLow) ||
      isSeparatorAtPos(wordLow, wordPos - 1) ||
      isWhitespaceAtPos(wordLow, wordPos - 1);
  }

  if (patternPos === patternStart) {
    if (wordPos > wordStart) {
      score -= isGapLocation ? 3 : 5;
    }
  } else {
    if (newMatchStart) {
      score += isGapLocation ? 2 : 0;
    } else {
      score += isGapLocation ? 0 : 1;
    }
  }

  if (wordPos + 1 === wordLen) {
    score -= isGapLocation ? 3 : 5;
  }

  return score;
}

export function anyScore(
  pattern: string,
  lowPattern: string,
  patternPos: number,
  word: string,
  lowWord: string,
  wordPos: number
): FuzzyScore {
  const max = Math.min(13, pattern.length);
  for (; patternPos < max; patternPos++) {
    const result = fuzzyScore(pattern, lowPattern, patternPos, word, lowWord, wordPos, {
      firstMatchCanBeWeak: true,
      boostFullMatch: true,
    });
    if (result) return result;
  }
  return [0, wordPos];
}

export function fuzzyScoreGracefulAggressive(
  pattern: string,
  lowPattern: string,
  patternPos: number,
  word: string,
  lowWord: string,
  wordPos: number,
  options?: FuzzyScoreOptions
): FuzzyScore | undefined {
  return fuzzyScoreWithPermutations(pattern, lowPattern, patternPos, word, lowWord, wordPos, true, options);
}

function fuzzyScoreWithPermutations(
  pattern: string,
  lowPattern: string,
  patternPos: number,
  word: string,
  lowWord: string,
  wordPos: number,
  aggressive: boolean,
  options?: FuzzyScoreOptions
): FuzzyScore | undefined {
  let top = fuzzyScore(pattern, lowPattern, patternPos, word, lowWord, wordPos, options);

  if (top && !aggressive) {
    return top;
  }

  if (pattern.length >= 3) {
    const tries = Math.min(7, pattern.length - 1);
    for (let movingPatternPos = patternPos + 1; movingPatternPos < tries; movingPatternPos++) {
      const newPattern = nextTypoPermutation(pattern, movingPatternPos);
      if (newPattern) {
        const candidate = fuzzyScore(
          newPattern,
          newPattern.toLowerCase(),
          patternPos,
          word,
          lowWord,
          wordPos,
          options
        );
        if (candidate) {
          candidate[0] -= 3;
          if (!top || candidate[0] > top[0]) {
            top = candidate;
          }
        }
      }
    }
  }

  return top;
}

function nextTypoPermutation(pattern: string, patternPos: number): string | undefined {
  if (patternPos + 1 >= pattern.length) return undefined;
  const swap1 = pattern[patternPos];
  const swap2 = pattern[patternPos + 1];
  if (swap1 === swap2) return undefined;
  return pattern.slice(0, patternPos) + swap2 + swap1 + pattern.slice(patternPos + 2);
}

// ---- completionModel.ts semantics ------------------------------------------------

export interface SimItem {
  label: string;
  sortText?: string;
  filterText?: string;
}

export interface SimResult<T extends SimItem> {
  item: T;
  score: number;
  /** Position in the initial sortText order (the tiebreak). */
  idx: number;
}

/**
 * suggest.ts defaultComparator: sortText (lowercased) first, then label, applied
 * ONCE to the provider's list — this fixes each item's `idx`.
 */
export function initialSort<T extends SimItem>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const sa = (a.sortText ?? a.label).toLowerCase();
    const sb = (b.sortText ?? b.label).toLowerCase();
    if (sa < sb) return -1;
    if (sa > sb) return 1;
    return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
  });
}

/**
 * What the suggest widget shows for `typedWord`: initial sortText order, then
 * (for a non-empty word) fuzzy-score each item — DROPPING non-matches — and sort
 * by score desc / idx asc. filterGraceful upgrades the scorer for lists ≤ 2000.
 */
export function simulateSuggest<T extends SimItem>(
  items: T[],
  typedWord: string,
  filterGraceful = true
): SimResult<T>[] {
  const sorted = initialSort(items);
  const word = typedWord;
  const wordLow = word.toLowerCase();
  const scoreFn = !filterGraceful || sorted.length > 2000 ? fuzzyScore : fuzzyScoreGracefulAggressive;

  const out: SimResult<T>[] = [];
  for (let idx = 0; idx < sorted.length; idx++) {
    const item = sorted[idx];
    if (word.length === 0) {
      out.push({ item, score: -100, idx });
      continue;
    }
    let score: FuzzyScore | undefined;
    if (typeof item.filterText === "string") {
      score = scoreFn(
        word,
        wordLow,
        0,
        item.filterText,
        item.filterText.toLowerCase(),
        0,
        FuzzyScoreOptionsDefault
      );
    } else {
      score = scoreFn(word, wordLow, 0, item.label, item.label.toLowerCase(), 0, FuzzyScoreOptionsDefault);
    }
    if (!score) continue; // NO match — dropped, exactly like completionModel
    out.push({ item, score: score[0], idx });
  }

  if (word.length > 0) {
    out.sort((a, b) => (a.score !== b.score ? b.score - a.score : a.idx - b.idx));
  }
  return out;
}
