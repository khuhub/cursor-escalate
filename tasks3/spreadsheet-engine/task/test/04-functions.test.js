import { test } from "node:test";
import assert from "node:assert/strict";
import { Spreadsheet } from "../src/spreadsheet.js";

function sheet(cells = {}) {
  const s = new Spreadsheet();
  for (const [ref, raw] of Object.entries(cells)) s.set(ref, raw);
  return s;
}

test("SUM over a column range", () => {
  const s = sheet({ A1: "1", A2: "2", A3: "3", B1: "=SUM(A1:A3)" });
  assert.equal(s.get("B1"), 6);
});

test("SUM with mixed range and scalar arguments", () => {
  const s = sheet({ A1: "1", A2: "2", B1: "4", C1: "=SUM(A1:A2, 10, B1)" });
  assert.equal(s.get("C1"), 17);
});

test("ranges skip text and unset cells", () => {
  const s = sheet({ A1: "1", A2: "note", A4: "3", B1: "=SUM(A1:A5)" });
  assert.equal(s.get("B1"), 4);
});

test("nested function calls", () => {
  const s = sheet({ A1: "1", A2: "2", B1: "5", B2: "9", C1: "=SUM(A1:A2, MAX(B1:B2))" });
  assert.equal(s.get("C1"), 12);
});

test("AVG over a range", () => {
  const s = sheet({ A1: "2", A2: "4", A3: "6", B1: "=AVG(A1:A3)" });
  assert.equal(s.get("B1"), 4);
});

test("AVG with no numbers yields #DIV/0!", () => {
  const s = sheet({ A1: "x", B1: "=AVG(A1:A3)" });
  assert.equal(s.get("B1"), "#DIV/0!");
});

test("MIN and MAX", () => {
  const s = sheet({ A1: "5", A2: "-2", A3: "9", B1: "=MIN(A1:A3)", B2: "=MAX(A1:A3)" });
  assert.equal(s.get("B1"), -2);
  assert.equal(s.get("B2"), 9);
});

test("MIN and MAX with no numbers yield 0", () => {
  const s = sheet({ B1: "=MIN(A1:A3)", B2: "=MAX(A1:A3)" });
  assert.equal(s.get("B1"), 0);
  assert.equal(s.get("B2"), 0);
});

test("COUNT counts only numeric cells", () => {
  const s = sheet({ A1: "1", A2: "two", A4: "4", B1: "=COUNT(A1:A5)" });
  assert.equal(s.get("B1"), 2);
});

test("function names are case-insensitive", () => {
  const s = sheet({ A1: "1", A2: "2", B1: "=sum(a1:a2)" });
  assert.equal(s.get("B1"), 3);
});

test("range corners may be reversed", () => {
  const s = sheet({ A1: "1", B1: "2", C1: "3", D1: "=SUM(C1:A1)" });
  assert.equal(s.get("D1"), 6);
});

test("two-dimensional range", () => {
  const s = sheet({ A1: "1", B1: "2", A2: "3", B2: "4", C1: "=SUM(A1:B2)" });
  assert.equal(s.get("C1"), 10);
});

test("ranges spanning multi-letter columns", () => {
  const s = sheet({ Z1: "1", AA1: "2", AB1: "3", A2: "=SUM(Z1:AB1)" });
  assert.equal(s.get("A2"), 6);
});

test("unknown function yields #NAME?", () => {
  const s = sheet({ A1: "=FOO(1)" });
  assert.equal(s.get("A1"), "#NAME?");
});

test("bare non-reference identifier yields #NAME?", () => {
  const s = sheet({ A1: "=FOO" });
  assert.equal(s.get("A1"), "#NAME?");
});

test("error inside a range propagates", () => {
  const s = sheet({ A1: "1", A2: "=1/0", A3: "3", B1: "=SUM(A1:A3)" });
  assert.equal(s.get("B1"), "#DIV/0!");
});

test("scalar text argument is #VALUE! even though ranges skip text", () => {
  const s = sheet({ A1: "hello", B1: "=SUM(A1)", B2: "=SUM(A1:A1)" });
  assert.equal(s.get("B1"), "#VALUE!");
  assert.equal(s.get("B2"), 0);
});

test("empty argument list is malformed", () => {
  const s = sheet({ A1: "=SUM()" });
  assert.equal(s.get("A1"), "#ERROR!");
});

test("function calls compose with arithmetic", () => {
  const s = sheet({ A1: "2", A2: "3", B1: "=SUM(A1:A2)*2", B2: "=-MAX(A1:A2)" });
  assert.equal(s.get("B1"), 10);
  assert.equal(s.get("B2"), -3);
});
