// Reference solution for the spreadsheet-engine task. Held out from the agent;
// used by verify-solution.sh to prove the test suite is satisfiable.

const REF_PATTERN = /^[A-Za-z]+[0-9]+$/;
const FUNCTIONS = new Set(["SUM", "AVG", "MIN", "MAX", "COUNT"]);

class FormulaError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export class Spreadsheet {
  #cells = new Map();

  set(ref, raw) {
    const key = normalizeRef(ref);
    if (raw.startsWith("=")) {
      this.#cells.set(key, { kind: "formula", src: raw.slice(1) });
      return;
    }
    const trimmed = raw.trim();
    const numeric = Number(trimmed);
    if (trimmed !== "" && Number.isFinite(numeric)) {
      this.#cells.set(key, { kind: "value", value: numeric });
    } else {
      this.#cells.set(key, { kind: "value", value: raw });
    }
  }

  get(ref) {
    const key = normalizeRef(ref);
    if (!this.#cells.has(key)) {
      return null;
    }
    try {
      return this.#resolve(key, new Set());
    } catch (error) {
      if (error instanceof FormulaError) {
        return error.code;
      }
      throw error;
    }
  }

  // Returns number | string | null; throws FormulaError for evaluation errors.
  #resolve(key, stack) {
    const cell = this.#cells.get(key);
    if (!cell) {
      return null;
    }
    if (cell.kind === "value") {
      return cell.value;
    }
    if (stack.has(key)) {
      throw new FormulaError("#CYCLE!");
    }
    stack.add(key);
    try {
      const ast = parseFormula(cell.src);
      return evaluateNode(ast, (ref) => this.#resolve(ref, stack));
    } finally {
      stack.delete(key);
    }
  }
}

function normalizeRef(ref) {
  if (typeof ref !== "string" || !REF_PATTERN.test(ref)) {
    throw new Error(`Invalid cell reference: ${ref}`);
  }
  return ref.toUpperCase();
}

// --- tokenizer ---

function tokenize(src) {
  const tokens = [];
  let index = 0;
  while (index < src.length) {
    const ch = src[index];
    if (ch === " " || ch === "\t") {
      index += 1;
      continue;
    }
    if (isDigit(ch) || (ch === "." && isDigit(src[index + 1]))) {
      let end = index;
      while (isDigit(src[end])) end += 1;
      if (src[end] === ".") {
        end += 1;
        if (!isDigit(src[end])) throw new FormulaError("#ERROR!");
        while (isDigit(src[end])) end += 1;
      }
      tokens.push({ type: "number", value: Number(src.slice(index, end)) });
      index = end;
      continue;
    }
    if (isLetter(ch)) {
      let end = index;
      while (isLetter(src[end])) end += 1;
      let digitsEnd = end;
      while (isDigit(src[digitsEnd])) digitsEnd += 1;
      const text = src.slice(index, digitsEnd).toUpperCase();
      tokens.push({ type: "ident", value: text, isRef: digitsEnd > end });
      index = digitsEnd;
      continue;
    }
    if ("+-*/^(),:".includes(ch)) {
      tokens.push({ type: ch });
      index += 1;
      continue;
    }
    throw new FormulaError("#ERROR!");
  }
  tokens.push({ type: "end" });
  return tokens;
}

function isDigit(ch) {
  return ch !== undefined && ch >= "0" && ch <= "9";
}

function isLetter(ch) {
  return ch !== undefined && ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z"));
}

// --- parser ---
//
// expr   := term (('+'|'-') term)*
// term   := factor (('*'|'/') factor)*
// factor := '-' factor | power
// power  := atom ('^' factor)?          (right-associative, unary exponent ok)
// atom   := number | '(' expr ')' | call | ref
// arg    := ref ':' ref | expr

function parseFormula(src) {
  const tokens = tokenize(src);
  let pos = 0;

  const peek = (offset = 0) => tokens[pos + offset];
  const next = () => tokens[pos++];
  const malformed = () => {
    throw new FormulaError("#ERROR!");
  };
  const expect = (type) => {
    if (peek().type !== type) malformed();
    pos += 1;
  };

  function parseExpr() {
    let node = parseTerm();
    while (peek().type === "+" || peek().type === "-") {
      const op = next().type;
      node = { type: "binary", op, left: node, right: parseTerm() };
    }
    return node;
  }

  function parseTerm() {
    let node = parseFactor();
    while (peek().type === "*" || peek().type === "/") {
      const op = next().type;
      node = { type: "binary", op, left: node, right: parseFactor() };
    }
    return node;
  }

  function parseFactor() {
    if (peek().type === "-") {
      next();
      return { type: "negate", operand: parseFactor() };
    }
    return parsePower();
  }

  function parsePower() {
    const base = parseAtom();
    if (peek().type === "^") {
      next();
      return { type: "binary", op: "^", left: base, right: parseFactor() };
    }
    return base;
  }

  function parseAtom() {
    const token = peek();
    if (token.type === "number") {
      next();
      return { type: "number", value: token.value };
    }
    if (token.type === "(") {
      next();
      const inner = parseExpr();
      expect(")");
      return inner;
    }
    if (token.type === "ident") {
      next();
      if (peek().type === "(") {
        if (token.isRef) malformed();
        if (!FUNCTIONS.has(token.value)) throw new FormulaError("#NAME?");
        next();
        if (peek().type === ")") malformed();
        const args = [parseArg()];
        while (peek().type === ",") {
          next();
          args.push(parseArg());
        }
        expect(")");
        return { type: "call", name: token.value, args };
      }
      if (!token.isRef) throw new FormulaError("#NAME?");
      return { type: "ref", ref: token.value };
    }
    malformed();
  }

  function parseArg() {
    if (peek().type === "ident" && peek().isRef && peek(1).type === ":") {
      const from = next().value;
      next();
      const toToken = next();
      if (toToken.type !== "ident" || !toToken.isRef) malformed();
      return { type: "range", from, to: toToken.value };
    }
    return parseExpr();
  }

  const root = parseExpr();
  if (peek().type !== "end") malformed();
  return root;
}

// --- evaluator ---

function evaluateNode(node, resolveRef) {
  switch (node.type) {
    case "number":
      return node.value;
    case "ref":
      return coerceToNumber(resolveRef(node.ref));
    case "negate":
      return -evaluateNode(node.operand, resolveRef);
    case "binary": {
      const left = evaluateNode(node.left, resolveRef);
      const right = evaluateNode(node.right, resolveRef);
      const result = applyOperator(node.op, left, right);
      if (!Number.isFinite(result)) throw new FormulaError("#DIV/0!");
      return result;
    }
    case "call":
      return callFunction(node, resolveRef);
    default:
      throw new FormulaError("#ERROR!");
  }
}

function coerceToNumber(value) {
  if (value === null) return 0;
  if (typeof value === "number") return value;
  throw new FormulaError("#VALUE!");
}

function applyOperator(op, left, right) {
  switch (op) {
    case "+":
      return left + right;
    case "-":
      return left - right;
    case "*":
      return left * right;
    case "/":
      return left / right;
    case "^":
      return left ** right;
    default:
      throw new FormulaError("#ERROR!");
  }
}

function callFunction(node, resolveRef) {
  const numbers = [];
  for (const arg of node.args) {
    if (arg.type === "range") {
      for (const ref of expandRange(arg.from, arg.to)) {
        const value = resolveRef(ref);
        if (typeof value === "number") numbers.push(value);
      }
    } else {
      numbers.push(evaluateNode(arg, resolveRef));
    }
  }
  switch (node.name) {
    case "SUM":
      return numbers.reduce((sum, value) => sum + value, 0);
    case "COUNT":
      return numbers.length;
    case "MIN":
      return numbers.length > 0 ? Math.min(...numbers) : 0;
    case "MAX":
      return numbers.length > 0 ? Math.max(...numbers) : 0;
    case "AVG":
      if (numbers.length === 0) throw new FormulaError("#DIV/0!");
      return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
    default:
      throw new FormulaError("#NAME?");
  }
}

function expandRange(from, to) {
  const a = splitRef(from);
  const b = splitRef(to);
  const colStart = Math.min(a.col, b.col);
  const colEnd = Math.max(a.col, b.col);
  const rowStart = Math.min(a.row, b.row);
  const rowEnd = Math.max(a.row, b.row);
  const refs = [];
  for (let row = rowStart; row <= rowEnd; row += 1) {
    for (let col = colStart; col <= colEnd; col += 1) {
      refs.push(`${columnName(col)}${row}`);
    }
  }
  return refs;
}

function splitRef(ref) {
  let split = 0;
  while (split < ref.length && isLetter(ref[split])) split += 1;
  return { col: columnNumber(ref.slice(0, split)), row: Number(ref.slice(split)) };
}

function columnNumber(letters) {
  let value = 0;
  for (const ch of letters) {
    value = value * 26 + (ch.charCodeAt(0) - 64);
  }
  return value;
}

function columnName(value) {
  let name = "";
  let remaining = value;
  while (remaining > 0) {
    const digit = (remaining - 1) % 26;
    name = String.fromCharCode(65 + digit) + name;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return name;
}
