import { test } from "node:test";
import assert from "node:assert/strict";
import { Spreadsheet } from "../src/spreadsheet.js";

test("formula referencing other cells", () => {
  const s = new Spreadsheet();
  s.set("A1", "2");
  s.set("B2", "3");
  s.set("C1", "=A1+B2*2");
  assert.equal(s.get("C1"), 8);
});

test("references in formulas are case-insensitive", () => {
  const s = new Spreadsheet();
  s.set("A1", "4");
  s.set("B1", "=a1*a1");
  assert.equal(s.get("B1"), 16);
});

test("unset references evaluate to zero", () => {
  const s = new Spreadsheet();
  s.set("A1", "=Z99+5");
  assert.equal(s.get("A1"), 5);
});

test("changing a dependency updates dependents", () => {
  const s = new Spreadsheet();
  s.set("A1", "1");
  s.set("B1", "=A1*10");
  s.set("C1", "=B1+1");
  assert.equal(s.get("C1"), 11);
  s.set("A1", "5");
  assert.equal(s.get("B1"), 50);
  assert.equal(s.get("C1"), 51);
});

test("replacing a formula with a literal", () => {
  const s = new Spreadsheet();
  s.set("A1", "=1+1");
  assert.equal(s.get("A1"), 2);
  s.set("A1", "7");
  assert.equal(s.get("A1"), 7);
});

test("text in arithmetic yields #VALUE!", () => {
  const s = new Spreadsheet();
  s.set("A1", "hello");
  s.set("B1", "=A1+1");
  assert.equal(s.get("B1"), "#VALUE!");
});

test("errors propagate through references", () => {
  const s = new Spreadsheet();
  s.set("A1", "=1/0");
  s.set("B1", "=A1+1");
  s.set("C1", "=B1*2");
  assert.equal(s.get("C1"), "#DIV/0!");
});

test("self-reference yields #CYCLE!", () => {
  const s = new Spreadsheet();
  s.set("A1", "=A1+1");
  assert.equal(s.get("A1"), "#CYCLE!");
});

test("mutual cycle yields #CYCLE! for both cells", () => {
  const s = new Spreadsheet();
  s.set("A1", "=B1+1");
  s.set("B1", "=A1+1");
  assert.equal(s.get("A1"), "#CYCLE!");
  assert.equal(s.get("B1"), "#CYCLE!");
});

test("three-cell cycle yields #CYCLE!", () => {
  const s = new Spreadsheet();
  s.set("A1", "=B1");
  s.set("B1", "=C1");
  s.set("C1", "=A1");
  assert.equal(s.get("A1"), "#CYCLE!");
  assert.equal(s.get("B1"), "#CYCLE!");
  assert.equal(s.get("C1"), "#CYCLE!");
});

test("cells downstream of a cycle also see #CYCLE!", () => {
  const s = new Spreadsheet();
  s.set("A1", "=B1");
  s.set("B1", "=A1");
  s.set("C1", "=A1+1");
  assert.equal(s.get("C1"), "#CYCLE!");
});

test("breaking a cycle restores values", () => {
  const s = new Spreadsheet();
  s.set("A1", "=B1+1");
  s.set("B1", "=A1+1");
  assert.equal(s.get("A1"), "#CYCLE!");
  s.set("B1", "10");
  assert.equal(s.get("A1"), 11);
  assert.equal(s.get("B1"), 10);
});
