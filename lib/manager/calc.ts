// Deterministic arithmetic evaluator - no eval, no Function, no model. Used to
// recompute figures a report claims, so "is the math right" is answered by
// code rather than by another LLM.
//
// Grammar:  expr   := term (('+' | '-') term)*
//           term   := unary (('*' | '/') unary)*
//           unary  := '-' unary | power
//           power  := atom ('^' unary)?          (right-associative)
//           atom   := number | '(' expr ')'

export class CalcError extends Error {}

function tokenize(input: string): string[] {
  const src = input.replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-").replace(/,/g, "").replace(/\s+/g, "");
  const tokens = src.match(/\d+\.?\d*(?:e[+-]?\d+)?|\.\d+|[+\-*/^()]/gi);
  if (!tokens || tokens.join("") !== src) throw new CalcError(`unsupported characters in expression: ${input}`);
  return tokens;
}

export function evaluate(expression: string): number {
  const tokens = tokenize(expression);
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function atom(): number {
    const t = next();
    if (t === undefined) throw new CalcError("unexpected end of expression");
    if (t === "(") {
      const v = expr();
      if (next() !== ")") throw new CalcError("missing closing parenthesis");
      return v;
    }
    const n = Number(t);
    if (!Number.isFinite(n)) throw new CalcError(`unexpected token: ${t}`);
    return n;
  }
  function power(): number {
    const base = atom();
    if (peek() === "^") {
      next();
      return Math.pow(base, unary());
    }
    return base;
  }
  function unary(): number {
    if (peek() === "-") {
      next();
      return -unary();
    }
    return power();
  }
  function term(): number {
    let v = unary();
    while (peek() === "*" || peek() === "/") {
      const op = next();
      const rhs = unary();
      if (op === "/" && rhs === 0) throw new CalcError("division by zero");
      v = op === "*" ? v * rhs : v / rhs;
    }
    return v;
  }
  function expr(): number {
    let v = term();
    while (peek() === "+" || peek() === "-") {
      const op = next();
      const rhs = term();
      v = op === "+" ? v + rhs : v - rhs;
    }
    return v;
  }

  const result = expr();
  if (pos !== tokens.length) throw new CalcError(`unexpected token: ${tokens[pos]}`);
  if (!Number.isFinite(result)) throw new CalcError("result is not a finite number");
  return result;
}
