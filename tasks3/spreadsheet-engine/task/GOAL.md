# Goal: implement a mini spreadsheet engine

Implement `src/spreadsheet.js` so that every test under `test/` passes (`npm test`).
Do NOT modify anything under `test/`, `package.json`, or this file. The verifier
restores pristine copies of those files before grading, so editing them only wastes
an iteration.

## API

`src/spreadsheet.js` is an ES module exporting a `Spreadsheet` class:

- `set(ref, raw)` — store a value in a cell. `raw` is always a string.
- `get(ref)` — return the computed value of a cell.

Cell references are one or more letters followed by one or more digits (`A1`,
`b12`, `AA10`) and are case-insensitive everywhere (`set("a1", ...)` and
`get("A1")` address the same cell). `set` or `get` with an invalid reference
(e.g. `"1A"`, `"A"`, `"12"`) must throw an `Error`.

## Stored values

- If `raw` starts with `=` (no leading whitespace), the cell holds a formula.
- Otherwise, trim `raw`; if the trimmed string is non-empty and `Number(trimmed)`
  is finite, the cell holds that number (so `" 42 "` stores the number `42`).
- Otherwise the cell holds the original, untrimmed string as text (`"12abc"` and
  `""` are text).
- `get` on a cell that was never set returns `null`.
- Setting a cell always replaces whatever was there before.

## Formula language

After the leading `=`, a formula is an expression. Whitespace is allowed between
tokens.

- Number literals: `42`, `3.14`, `.5`.
- Operators: `+ - * /` and `^` (power), plus unary minus and parentheses.
- Precedence (loosest to tightest): `+ -`, then `* /`, then unary minus, then `^`.
  - `^` is right-associative: `=2^3^2` is `512`.
  - `^` binds tighter than unary minus: `=-3^2` is `-9`, `=(-3)^2` is `9`.
  - A unary expression may appear as an exponent: `=2^-2` is `0.25`.
  - `+ - * /` are left-associative: `=10-2-3` is `5`.
- Cell references: `=A1+B2*2`. A reference to an unset (or empty) cell evaluates
  to `0` in an expression.
- Functions: `SUM`, `AVG`, `MIN`, `MAX`, `COUNT`. Names are case-insensitive.
  Arguments are separated by commas; each argument is either an expression or a
  rectangular range `A1:B3`. Function calls may be nested and used inside
  expressions (`=SUM(A1:A2, MAX(B1:B2))*2`). A call must have at least one
  argument: `=SUM()` is malformed.
- Ranges are only valid as function arguments. Corners may be given in any order
  (`C3:A1` means `A1:C3`) and columns beyond `Z` follow the usual spreadsheet
  scheme (`Z`, `AA`, `AB`, ...).

### Function semantics

Collect candidate values left-to-right (arguments in order; range cells in
row-major order):

- A range contributes the numeric values of its cells. Text cells and unset
  cells inside a range are skipped. If a cell in the range evaluates to an
  error, the call evaluates to that error.
- A non-range argument is an ordinary expression, with expression coercion
  rules: unset references count as `0`, and a reference to a text cell is a
  `#VALUE!` error. So `=SUM(A1)` on a text `A1` is `#VALUE!`, while
  `=SUM(A1:A1)` skips it.

Then:

- `SUM` — sum of collected numbers (`0` if none).
- `COUNT` — how many numbers were collected.
- `MIN` / `MAX` — minimum / maximum (`0` if no numbers were collected).
- `AVG` — arithmetic mean; if no numbers were collected, `#DIV/0!`.

## Errors

Errors are returned from `get` as plain strings:

- `#DIV/0!` — any arithmetic result that is not finite (`=1/0`, `=0/0`, `=0^-1`),
  or `AVG` over zero numbers.
- `#VALUE!` — a text cell used in an arithmetic context.
- `#NAME?` — a call to an unknown function (`=FOO(1)`), or a bare identifier
  that is not a cell reference (`=FOO`).
- `#ERROR!` — any malformed formula (`=1+`, `=(1+2`, `=`, `=1 2`, `=SUM()`).
- `#CYCLE!` — the cell participates in a reference cycle, directly (`A1: =A1+1`),
  mutually, or through a range (`A1: =SUM(A1:A3)`).

Errors propagate: if evaluating any operand, argument, or referenced cell yields
an error, the whole formula yields that error. When several operands would
error, the leftmost one wins (operands and arguments are evaluated left to
right). A cell that merely references a cycle (without being part of it) also
evaluates to `#CYCLE!` through propagation.

## Recalculation

`get` must always reflect the current state: after changing any cell, every
formula that depends on it (directly or transitively) returns the updated value
on its next `get`. Replacing a formula with a literal, or rewriting a cell so a
former cycle is broken, must restore correct values everywhere.

## Constraints

- Pure Node 22+, ES modules, no dependencies, no child processes.
- Keep the whole implementation in `src/spreadsheet.js`.
