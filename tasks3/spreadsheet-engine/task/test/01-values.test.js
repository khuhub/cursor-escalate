import { test } from "node:test";
import assert from "node:assert/strict";
import { Spreadsheet } from "../src/spreadsheet.js";

test("stores and returns an integer", () => {
  const s = new Spreadsheet();
  s.set("A1", "42");
  assert.equal(s.get("A1"), 42);
});

test("stores and returns a decimal", () => {
  const s = new Spreadsheet();
  s.set("A1", "3.14");
  assert.equal(s.get("A1"), 3.14);
});

test("stores and returns a negative number", () => {
  const s = new Spreadsheet();
  s.set("A1", "-7");
  assert.equal(s.get("A1"), -7);
});

test("trims whitespace around numbers", () => {
  const s = new Spreadsheet();
  s.set("A1", " 42 ");
  assert.equal(s.get("A1"), 42);
});

test("stores plain text as-is", () => {
  const s = new Spreadsheet();
  s.set("A1", "hello");
  assert.equal(s.get("A1"), "hello");
});

test("partially numeric strings are text, untrimmed", () => {
  const s = new Spreadsheet();
  s.set("A1", " 12abc ");
  assert.equal(s.get("A1"), " 12abc ");
});

test("empty string is text", () => {
  const s = new Spreadsheet();
  s.set("A1", "");
  assert.equal(s.get("A1"), "");
});

test("unset cell returns null", () => {
  const s = new Spreadsheet();
  assert.equal(s.get("B7"), null);
});

test("set replaces the previous value", () => {
  const s = new Spreadsheet();
  s.set("A1", "1");
  s.set("A1", "two");
  assert.equal(s.get("A1"), "two");
});

test("references are case-insensitive", () => {
  const s = new Spreadsheet();
  s.set("a1", "5");
  assert.equal(s.get("A1"), 5);
  s.set("AB12", "9");
  assert.equal(s.get("ab12"), 9);
});

test("invalid references throw", () => {
  const s = new Spreadsheet();
  assert.throws(() => s.set("1A", "5"));
  assert.throws(() => s.set("A", "5"));
  assert.throws(() => s.get("12"));
  assert.throws(() => s.get("A1B"));
});
