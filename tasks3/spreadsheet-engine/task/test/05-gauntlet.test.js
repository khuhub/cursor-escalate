import { test } from "node:test";
import assert from "node:assert/strict";
import { Spreadsheet } from "../src/spreadsheet.js";

test("budget sheet recalculates end to end", () => {
  const s = new Spreadsheet();
  s.set("A1", "12.50");
  s.set("A2", "3");
  s.set("A3", "20");
  s.set("B1", "=SUM(A1:A3)");
  s.set("B2", "0.25");
  s.set("B3", "=B1*B2");
  s.set("B4", "=B1+B3");
  assert.equal(s.get("B4"), 44.375);
  s.set("A3", "100");
  assert.equal(s.get("B1"), 115.5);
  assert.equal(s.get("B4"), 144.375);
});

test("aggregates of aggregates", () => {
  const s = new Spreadsheet();
  s.set("A1", "1");
  s.set("B1", "2");
  s.set("A2", "30");
  s.set("B2", "40");
  s.set("C1", "=SUM(A1:B1)");
  s.set("C2", "=SUM(A2:B2)");
  s.set("D1", "=MAX(C1:C2)");
  assert.equal(s.get("D1"), 70);
});

test("a cell inside its own range argument is a cycle", () => {
  const s = new Spreadsheet();
  s.set("A2", "1");
  s.set("A3", "2");
  s.set("A1", "=SUM(A1:A3)");
  assert.equal(s.get("A1"), "#CYCLE!");
});

test("cycle threaded through a nested function argument", () => {
  const s = new Spreadsheet();
  s.set("B1", "3");
  s.set("B2", "=A1");
  s.set("A1", "=MAX(1, SUM(B1:B2))");
  assert.equal(s.get("A1"), "#CYCLE!");
  assert.equal(s.get("B2"), "#CYCLE!");
});

test("leftmost error wins", () => {
  const s = new Spreadsheet();
  s.set("A1", "oops");
  s.set("B1", "=(A1+0)+(1/0)");
  s.set("B2", "=(1/0)+(A1+0)");
  assert.equal(s.get("B1"), "#VALUE!");
  assert.equal(s.get("B2"), "#DIV/0!");
});

test("deep dependency chains recalculate", () => {
  const s = new Spreadsheet();
  s.set("A1", "1");
  for (let row = 2; row <= 12; row += 1) {
    s.set(`A${row}`, `=A${row - 1}+1`);
  }
  assert.equal(s.get("A12"), 12);
  s.set("A1", "100");
  assert.equal(s.get("A12"), 111);
});

test("everything at once", () => {
  const s = new Spreadsheet();
  s.set("A1", "1");
  s.set("B1", "2");
  s.set("A2", "3");
  s.set("B2", "4");
  s.set("C1", "10");
  s.set("C2", "skip");
  s.set("C3", "20");
  s.set("C4", "30");
  s.set("D1", "5");
  s.set("D2", "ignored");
  s.set("D3", "6");
  // SUM(A1:B2)=10, AVG over C1:C4 numbers (10,20,30)=20, COUNT(D1:D3)=2
  s.set("E1", "=SUM(A1:B2)^2 - avg(C1:C4)*(2+COUNT(D1:D3))");
  assert.equal(s.get("E1"), 20);
  s.set("B2", "14");
  assert.equal(s.get("E1"), 320);
});
