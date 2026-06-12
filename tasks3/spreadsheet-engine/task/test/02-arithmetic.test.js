import { test } from "node:test";
import assert from "node:assert/strict";
import { Spreadsheet } from "../src/spreadsheet.js";

function evaluate(formula) {
  const s = new Spreadsheet();
  s.set("A1", formula);
  return s.get("A1");
}

test("adds literals", () => {
  assert.equal(evaluate("=1+2"), 3);
});

test("multiplication binds tighter than addition", () => {
  assert.equal(evaluate("=2+3*4"), 14);
});

test("parentheses override precedence", () => {
  assert.equal(evaluate("=(2+3)*4"), 20);
});

test("subtraction is left-associative", () => {
  assert.equal(evaluate("=10-2-3"), 5);
});

test("division is left-associative", () => {
  assert.equal(evaluate("=20/4/5"), 1);
});

test("power operator", () => {
  assert.equal(evaluate("=2^3"), 8);
});

test("power is right-associative", () => {
  assert.equal(evaluate("=2^3^2"), 512);
});

test("power binds tighter than unary minus", () => {
  assert.equal(evaluate("=-3^2"), -9);
  assert.equal(evaluate("=(-3)^2"), 9);
});

test("unary minus allowed in the exponent", () => {
  assert.equal(evaluate("=2^-2"), 0.25);
});

test("double unary minus", () => {
  assert.equal(evaluate("=--4"), 4);
});

test("unary minus over a parenthesized expression", () => {
  assert.equal(evaluate("=-(3+1)"), -4);
});

test("whitespace between tokens is ignored", () => {
  assert.equal(evaluate("= 1 + 2 * 3 "), 7);
});

test("leading-dot decimals", () => {
  assert.equal(evaluate("=.5*4"), 2);
});

test("division by zero", () => {
  assert.equal(evaluate("=1/0"), "#DIV/0!");
  assert.equal(evaluate("=0/0"), "#DIV/0!");
});

test("non-finite power result", () => {
  assert.equal(evaluate("=0^-1"), "#DIV/0!");
});

test("malformed formulas", () => {
  assert.equal(evaluate("=1+"), "#ERROR!");
  assert.equal(evaluate("=(1+2"), "#ERROR!");
  assert.equal(evaluate("="), "#ERROR!");
  assert.equal(evaluate("=1 2"), "#ERROR!");
  assert.equal(evaluate("=1..2"), "#ERROR!");
});
