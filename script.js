/* OS-1 Fork() Tree Solver
   Course-style fork() simulator: parser -> compiler -> tiny VM.
   Convention (course style): the parent finishes its run before its children run,
   and processes are numbered in creation order: P0, P1, P2, ...  */
'use strict';

/* ============================ ENGINE ============================ */
const Engine = (() => {

  function normalize(src) {
    return String(src)
      .replace(/^\s*#.*$/gm, '')                 // strip #include lines
      .replace(/[\u201C\u201D\u201E]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/\u2264/g, '<=').replace(/\u2265/g, '>=')
      .replace(/\u2014/g, '--').replace(/\u2013/g, '-');
  }

  function fail(msg) {
    const e = new Error(msg + '. This syntax is not supported yet. Try using the supported OS-1 subset.');
    e.friendly = true;
    throw e;
  }

  const TWO = ['&&', '||', '++', '--', '+=', '-=', '<=', '>=', '==', '!='];

  function tokenize(src) {
    const toks = [];
    let i = 0;
    const n = src.length;
    const isD = c => c >= '0' && c <= '9';
    const isW = c => /[A-Za-z_]/.test(c);
    while (i < n) {
      const c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '/' && src[i + 1] === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
      if (c === '"' || c === "'") {
        const q = c; let s = ''; i++;
        while (i < n && src[i] !== q) {
          if (src[i] === '\\' && src[i + 1] === 'n') { s += '\\n'; i += 2; continue; }
          s += src[i++];
        }
        if (i >= n) fail('Missing closing quote');
        i++;
        toks.push({ t: 'str', v: s });
        continue;
      }
      if (isD(c)) { let s = ''; while (i < n && isD(src[i])) s += src[i++]; toks.push({ t: 'num', v: +s }); continue; }
      if (isW(c)) { let s = ''; while (i < n && /[A-Za-z0-9_]/.test(src[i])) s += src[i++]; toks.push({ t: 'id', v: s }); continue; }
      const two = src.substr(i, 2);
      if (TWO.indexOf(two) >= 0) { toks.push({ t: 'p', v: two }); i += 2; continue; }
      if ('(){};,!+-*/%<>='.indexOf(c) >= 0) { toks.push({ t: 'p', v: c }); i++; continue; }
      fail('Unexpected character "' + c + '"');
    }
    return toks;
  }

  function parse(src) {
    const toks = tokenize(normalize(src));
    if (!toks.length) fail('The input is empty');
    let pos = 0;
    const peek = (o = 0) => toks[pos + o] || { t: 'eof', v: null };
    const isP = (v, o = 0) => { const t = peek(o); return t.t === 'p' && t.v === v; };
    const isId = (v, o = 0) => { const t = peek(o); return t.t === 'id' && t.v === v; };
    const eatP = v => { if (!isP(v)) fail('Expected "' + v + '" but found "' + (peek().v === null ? 'end of code' : peek().v) + '"'); pos++; };

    // unwrap  void main() { ... }  /  int main() { ... }
    let stmts;
    if ((isId('void') || isId('int')) && isId('main', 1)) {
      pos += 2; eatP('('); if (isId('void')) pos++; eatP(')'); eatP('{');
      stmts = parseStmts('}');
      eatP('}');
      if (pos < toks.length) fail('Unexpected code after the closing } of main()');
    } else {
      stmts = parseStmts(null);
    }
    return stmts;

    function parseStmts(end) {
      const out = [];
      while (pos < toks.length && !(end && isP(end))) out.push(parseStmt());
      return out;
    }

    function parseStmt() {
      if (isP(';')) { pos++; return { k: 'empty' }; }
      if (isP('{')) { pos++; const b = parseStmts('}'); eatP('}'); return { k: 'block', body: b }; }
      if (isId('int')) {
        pos++; const decls = [];
        while (true) {
          const t = peek(); if (t.t !== 'id') fail('Expected a variable name after "int"');
          pos++; let init = null;
          if (isP('=')) { pos++; init = parseOr(); }
          decls.push({ name: t.v, init });
          if (isP(',')) { pos++; continue; }
          break;
        }
        eatP(';');
        return { k: 'decl', decls };
      }
      if (isId('if')) {
        pos++; eatP('('); const c = parseExpr(); eatP(')');
        const then = parseStmt();
        let els = null;
        if (isId('else')) { pos++; els = parseStmt(); }
        return { k: 'if', cond: c, then, els };
      }
      if (isId('for')) {
        pos++; eatP('(');
        const init = isP(';') ? null : parseExpr(); eatP(';');
        const cond = isP(';') ? null : parseExpr(); eatP(';');
        const upd = isP(')') ? null : parseExpr(); eatP(')');
        const body = parseStmt();
        return { k: 'for', init, cond, upd, body };
      }
      if (isId('while')) {
        pos++; eatP('('); const c = parseExpr(); eatP(')');
        const body = parseStmt();
        return { k: 'for', init: null, cond: c, upd: null, body };
      }
      if (isId('break')) { pos++; eatP(';'); return { k: 'break' }; }
      if (isId('return')) { pos++; if (!isP(';')) parseExpr(); eatP(';'); return { k: 'exit' }; }
      if (isId('exit')) { pos++; eatP('('); if (!isP(')')) parseExpr(); eatP(')'); eatP(';'); return { k: 'exit' }; }
      if (isId('printf')) {
        pos++; eatP('(');
        const t = peek(); if (t.t !== 'str') fail('printf needs a quoted string, e.g. printf("hello")');
        pos++;
        const args = [];
        while (isP(',')) { pos++; args.push(parseExpr()); }
        eatP(')'); eatP(';');
        return { k: 'print', fmt: t.v, args };
      }
      const e = parseExpr(); eatP(';');
      return { k: 'expr', expr: e };
    }

    function parseExpr() { return parseAssign(); }
    function parseAssign() {
      const t = peek();
      if (t.t === 'id' && t.v !== 'fork') {
        const nx = peek(1);
        if (nx.t === 'p' && (nx.v === '=' || nx.v === '+=' || nx.v === '-=')) {
          pos += 2;
          const rhs = parseAssign();
          return { k: 'assign', op: nx.v, name: t.v, rhs };
        }
      }
      return parseOr();
    }
    function parseOr() { let l = parseAnd(); while (isP('||')) { pos++; l = { k: 'or', l, r: parseAnd() }; } return l; }
    function parseAnd() { let l = parseEq(); while (isP('&&')) { pos++; l = { k: 'and', l, r: parseEq() }; } return l; }
    function parseEq() { let l = parseRel(); while (isP('==') || isP('!=')) { const op = peek().v; pos++; l = { k: 'bin', op, l, r: parseRel() }; } return l; }
    function parseRel() { let l = parseAdd(); while (isP('<') || isP('<=') || isP('>') || isP('>=')) { const op = peek().v; pos++; l = { k: 'bin', op, l, r: parseAdd() }; } return l; }
    function parseAdd() { let l = parseMul(); while (isP('+') || isP('-')) { const op = peek().v; pos++; l = { k: 'bin', op, l, r: parseMul() }; } return l; }
    function parseMul() { let l = parseUnary(); while (isP('*') || isP('/') || isP('%')) { const op = peek().v; pos++; l = { k: 'bin', op, l, r: parseUnary() }; } return l; }
    function parseUnary() {
      if (isP('!')) { pos++; return { k: 'not', e: parseUnary() }; }
      if (isP('-')) { pos++; return { k: 'neg', e: parseUnary() }; }
      if (isP('++') || isP('--')) {
        const op = peek().v; pos++;
        const t = peek(); if (t.t !== 'id') fail('Expected a variable after ' + op);
        pos++;
        return { k: 'pre', op, name: t.v };
      }
      return parsePostfix();
    }
    function parsePostfix() {
      const e = parsePrimary();
      if (e.k === 'var' && (isP('++') || isP('--'))) { const op = peek().v; pos++; return { k: 'post', op, name: e.name }; }
      return e;
    }
    function parsePrimary() {
      const t = peek();
      if (t.t === 'num') { pos++; return { k: 'num', v: t.v }; }
      if (isP('(')) { pos++; const e = parseExpr(); eatP(')'); return e; }
      if (t.t === 'id' && t.v === 'fork') { pos++; eatP('('); eatP(')'); return { k: 'fork' }; }
      if (t.t === 'id') { pos++; return { k: 'var', name: t.v }; }
      fail('Unexpected token "' + (t.v === null ? 'end of code' : t.v) + '"');
    }
  }

  function compile(stmts) {
    const code = [];
    let forkSites = 0;
    const emit = ins => (code.push(ins), code.length - 1);
    const loopStack = [];

    function cStmts(list) { list.forEach(cStmt); }
    function cStmt(s) {
      switch (s.k) {
        case 'empty': break;
        case 'block': cStmts(s.body); break;
        case 'decl':
          s.decls.forEach(d => {
            if (d.init) cExpr(d.init); else emit({ op: 'NUM', v: 0 });
            emit({ op: 'STORE', name: d.name });
            emit({ op: 'POP' });
          });
          break;
        case 'if': {
          cExpr(s.cond);
          const jz = emit({ op: 'JZ', t: 0 });
          cStmt(s.then);
          if (s.els) {
            const j = emit({ op: 'JMP', t: 0 });
            code[jz].t = code.length;
            cStmt(s.els);
            code[j].t = code.length;
          } else {
            code[jz].t = code.length;
          }
          break;
        }
        case 'for': {
          if (s.init) { cExpr(s.init); emit({ op: 'POP' }); }
          const Lcond = code.length;
          let jz = -1;
          if (s.cond) { cExpr(s.cond); jz = emit({ op: 'JZ', t: 0 }); }
          const breaks = [];
          loopStack.push(breaks);
          cStmt(s.body);
          loopStack.pop();
          if (s.upd) { cExpr(s.upd); emit({ op: 'POP' }); }
          emit({ op: 'JMP', t: Lcond });
          const Lend = code.length;
          if (jz >= 0) code[jz].t = Lend;
          breaks.forEach(b => { code[b].t = Lend; });
          break;
        }
        case 'break': {
          if (loopStack.length) {
            emit({ op: 'LOG', kind: 'break', inLoop: true });
            const j = emit({ op: 'JMP', t: 0 });
            loopStack[loopStack.length - 1].push(j);
          } else {
            emit({ op: 'LOG', kind: 'break', inLoop: false });
            emit({ op: 'EXIT', reason: 'break' });
          }
          break;
        }
        case 'exit': emit({ op: 'EXIT', reason: 'exit' }); break;
        case 'print': {
          s.args.forEach(a => cExpr(a));
          emit({ op: 'PRINT', fmt: s.fmt, argc: s.args.length });
          break;
        }
        case 'expr': cExpr(s.expr); emit({ op: 'POP' }); break;
        default: fail('Unsupported statement');
      }
    }

    function cExpr(e) {
      switch (e.k) {
        case 'num': emit({ op: 'NUM', v: e.v }); break;
        case 'var': emit({ op: 'LOAD', name: e.name }); break;
        case 'fork': forkSites++; emit({ op: 'FORK', site: forkSites }); break;
        case 'not': cExpr(e.e); emit({ op: 'NOT' }); break;
        case 'neg': cExpr(e.e); emit({ op: 'NEG' }); break;
        case 'or': { cExpr(e.l); const j = emit({ op: 'JNZK', t: 0 }); emit({ op: 'POP' }); cExpr(e.r); code[j].t = code.length; break; }
        case 'and': { cExpr(e.l); const j = emit({ op: 'JZK', t: 0 }); emit({ op: 'POP' }); cExpr(e.r); code[j].t = code.length; break; }
        case 'bin': cExpr(e.l); cExpr(e.r); emit({ op: 'BIN', o: e.op }); break;
        case 'assign':
          cExpr(e.rhs);
          emit(e.op === '=' ? { op: 'STORE', name: e.name } : { op: 'OPEQ', name: e.name, o: e.op });
          break;
        case 'pre': emit({ op: 'CREMENT', name: e.name, o: e.op, post: false }); break;
        case 'post': emit({ op: 'CREMENT', name: e.name, o: e.op, post: true }); break;
        default: fail('Unsupported expression');
      }
    }

    cStmts(stmts);
    emit({ op: 'HALT' });
    return { code, forkSites };
  }

  function simulate(code, opts) {
    opts = opts || {};
    const MAXP = opts.maxProcs || 600;
    const MAXS = opts.maxSteps || 400000;
    let steps = 0;
    let pidCounter = 1;
    const procs = [{ pid: 0, parent: null, pc: 0, stack: [], vars: {}, prints: [], forks: [], exit: 'running' }];
    const edges = [];
    const log = [];
    const L = m => log.push(m);
    L('Start with P0 (the original process). Course convention: a parent finishes its run before its children start, and children are numbered in creation order.');

    function finalVars(p) {
      const ks = Object.keys(p.vars);
      return ks.length ? ' with ' + ks.map(k => k + ' = ' + p.vars[k]).join(', ') : '';
    }

    function runProc(p) {
      while (true) {
        if (++steps > MAXS) { const e = new Error('Simulation stopped: the code runs too long (possible infinite loop).'); e.friendly = true; throw e; }
        const ins = code[p.pc];
        if (!ins || ins.op === 'HALT') {
          p.exit = 'finished';
          L('P' + p.pid + ' reaches the end of main()' + finalVars(p) + '.');
          return;
        }
        switch (ins.op) {
          case 'NUM': p.stack.push(ins.v); p.pc++; break;
          case 'LOAD': p.stack.push(p.vars[ins.name] || 0); p.pc++; break;
          case 'STORE': { const v = p.stack.pop(); p.vars[ins.name] = v; p.stack.push(v); p.pc++; break; }
          case 'OPEQ': { const v = p.stack.pop(); const cur = p.vars[ins.name] || 0; const nv = ins.o === '+=' ? cur + v : cur - v; p.vars[ins.name] = nv; p.stack.push(nv); p.pc++; break; }
          case 'CREMENT': { const cur = p.vars[ins.name] || 0; const nv = ins.o === '++' ? cur + 1 : cur - 1; p.vars[ins.name] = nv; p.stack.push(ins.post ? cur : nv); p.pc++; break; }
          case 'POP': p.stack.pop(); p.pc++; break;
          case 'NOT': p.stack.push(p.stack.pop() ? 0 : 1); p.pc++; break;
          case 'NEG': p.stack.push(-p.stack.pop()); p.pc++; break;
          case 'BIN': {
            const b = p.stack.pop(), a = p.stack.pop();
            let r = 0;
            switch (ins.o) {
              case '+': r = a + b; break;
              case '-': r = a - b; break;
              case '*': r = a * b; break;
              case '/': r = b === 0 ? 0 : Math.trunc(a / b); break;
              case '%': r = b === 0 ? 0 : a % b; break;
              case '<': r = a < b ? 1 : 0; break;
              case '<=': r = a <= b ? 1 : 0; break;
              case '>': r = a > b ? 1 : 0; break;
              case '>=': r = a >= b ? 1 : 0; break;
              case '==': r = a === b ? 1 : 0; break;
              case '!=': r = a !== b ? 1 : 0; break;
            }
            p.stack.push(r); p.pc++; break;
          }
          case 'JMP': p.pc = ins.t; break;
          case 'JZ': p.pc = (p.stack.pop() === 0) ? ins.t : p.pc + 1; break;
          case 'JZK': p.pc = (p.stack[p.stack.length - 1] === 0) ? ins.t : p.pc + 1; break;
          case 'JNZK': p.pc = (p.stack[p.stack.length - 1] !== 0) ? ins.t : p.pc + 1; break;
          case 'FORK': {
            if (procs.length >= MAXP) { const e = new Error('Too many processes (more than ' + MAXP + '). Reduce the number of fork() calls.'); e.friendly = true; throw e; }
            const child = { pid: pidCounter++, parent: p.pid, pc: p.pc + 1, stack: p.stack.concat([0]), vars: Object.assign({}, p.vars), prints: [], forks: [], exit: 'running' };
            procs.push(child);
            edges.push({ from: p.pid, to: child.pid, site: ins.site });
            p.forks.push({ site: ins.site, child: child.pid });
            L('P' + p.pid + ' executes fork() #' + ins.site + ' \u2192 creates P' + child.pid + '. In P' + p.pid + ' fork() returns non-zero (true); in P' + child.pid + ' it returns 0 (false).');
            p.stack.push(child.pid);
            p.pc++;
            break;
          }
          case 'PRINT': {
            const args = [];
            for (let k = 0; k < ins.argc; k++) args.unshift(p.stack.pop());
            let ai = 0;
            const out = ins.fmt.replace(/%d/g, () => String(args[ai++] !== undefined ? args[ai - 1] : 0));
            p.prints.push(out);
            L('P' + p.pid + ' prints "' + out + '".');
            p.pc++;
            break;
          }
          case 'LOG':
            if (ins.kind === 'break') L('P' + p.pid + ' hits break \u2192 ' + (ins.inLoop ? 'it leaves the current loop.' : 'it stops here (course-style: the process stops).'));
            p.pc++;
            break;
          case 'EXIT':
            p.exit = ins.reason === 'break' ? 'stopped by break' : 'called exit()';
            L('P' + p.pid + ' stops' + finalVars(p) + '.');
            return;
          default: fail('Unknown instruction');
        }
      }
    }

    for (let qi = 0; qi < procs.length; qi++) {
      const p = procs[qi];
      if (qi > 0) L('P' + p.pid + ' (child of P' + p.parent + ') resumes right after the fork() that created it, with a copy of the variables.');
      runProc(p);
    }

    const printCounts = {};
    let totalPrints = 0;
    procs.forEach(p => p.prints.forEach(m => { printCounts[m] = (printCounts[m] || 0) + 1; totalPrints++; }));

    L('Final result: ' + procs.length + ' process' + (procs.length === 1 ? '' : 'es') + ' in total (' + procs.map(p => 'P' + p.pid).join(', ') + ').');

    return { processes: procs, edges, log, printCounts, totalPrints };
  }

  function run(source, opts) {
    const ast = parse(source);
    const c = compile(ast);
    const sim = simulate(c.code, opts);
    sim.forkSites = c.forkSites;
    return sim;
  }

  return { run, normalize };
})();

/* ============================ TREE -> CODE ============================ */
const TreeCode = (() => {

  function fail(msg) { const e = new Error(msg); e.friendly = true; throw e; }

  function parseTree(text) {
    const children = {};
    const seenChild = new Set();
    const nodes = [];
    const nodeSet = new Set();
    const addNode = x => { if (!nodeSet.has(x)) { nodeSet.add(x); nodes.push(x); } };
    const lines = String(text).split(/\n+/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) fail('Describe the tree first, e.g.  P0 -> P1, P2');
    lines.forEach(line => {
      const parts = line.split(/->|:/);
      if (parts.length < 2) fail('Cannot read the line "' + line + '". Use:  P0 -> P1, P2   or   P0: P1 P2');
      const parent = parts[0].trim();
      if (!parent || /[\s,]/.test(parent)) fail('Cannot read the parent name in "' + line + '"');
      const kids = parts.slice(1).join(' ').split(/[\s,]+/).filter(Boolean);
      if (!kids.length) fail('The line "' + line + '" lists no children');
      addNode(parent);
      if (!children[parent]) children[parent] = [];
      kids.forEach(k => {
        if (k === parent) fail('"' + k + '" cannot be its own child');
        if (seenChild.has(k)) fail('"' + k + '" appears as a child twice \u2014 each process has exactly one parent');
        seenChild.add(k);
        children[parent].push(k);
        addNode(k);
      });
    });
    const roots = nodes.filter(x => !seenChild.has(x));
    if (roots.length === 0) fail('The tree contains a cycle \u2014 no root found');
    if (roots.length > 1) fail('The tree must have exactly one root, but found: ' + roots.join(', '));
    const root = roots[0];
    const bfs = [root];
    for (let i = 0; i < bfs.length; i++) {
      (children[bfs[i]] || []).forEach(c => bfs.push(c));
      if (bfs.length > nodes.length) fail('The tree contains a cycle');
    }
    if (bfs.length !== nodes.length) fail('Some processes are not connected to the root ' + root);
    return { children, root, nodes, bfs };
  }

  function genOrdered(tree) {
    const lines = ['void main() {'];
    (function walk(node, indent) {
      const kids = tree.children[node] || [];
      kids.forEach(k => {
        lines.push(indent + 'if (fork() == 0) {      /* ' + node + ' creates ' + k + ' (fork returns 0 only inside ' + k + ') */');
        walk(k, indent + '    ');
        lines.push(indent + '    exit(0);             /* ' + k + ' finishes here and never runs ' + node + "'s remaining forks */");
        lines.push(indent + '}');
      });
      if (!kids.length) lines.push(indent + '/* ' + node + ' creates no children */');
    })(tree.root, '    ');
    lines.push('}');
    return lines.join('\n');
  }

  function genNested(tree) {
    const lines = ['void main() {'];
    (function walk(node, indent) {
      const kids = tree.children[node] || [];
      if (!kids.length) { lines.push(indent + '/* ' + node + ' creates no children */'); return; }
      (function emitKid(idx, ind) {
        if (idx >= kids.length) { lines.push(ind + '/* still ' + node + ' \u2014 all of its children are created */'); return; }
        lines.push(ind + 'if (fork() == 0) {      /* child ' + kids[idx] + ' */');
        walk(kids[idx], ind + '    ');
        lines.push(ind + '} else {                /* still ' + node + ' */');
        emitKid(idx + 1, ind + '    ');
        lines.push(ind + '}');
      })(0, indent);
    })(tree.root, '    ');
    lines.push('}');
    return lines.join('\n');
  }

  /* Try to express the tree as ONE fork() expression using &&, ||, +, *, !.
     Returns { expr, method } or null when impossible / too large to search.
     Every candidate is verified by running it through the simulator. */
  function genExpression(tree) {
    if (tree.bfs.length < 2) return null;
    const root = tree.bfs[0];
    const kidsOf = lab => tree.children[lab] || [];
    const idx = {}; tree.bfs.forEach((l, i) => { idx[l] = i; });
    const wanted = [];
    tree.bfs.forEach(l => kidsOf(l).forEach(c => wanted.push(idx[l] + '>' + idx[c])));
    const wantedStr = wanted.sort().join(' ');
    const verify = expr => {
      try {
        const r = Engine.run(expr + ';');
        return r.processes.length === tree.bfs.length &&
          r.edges.map(e => e.from + '>' + e.to).sort().join(' ') === wantedStr;
      } catch (e) { return false; }
    };
    const stripOuter = e => {
      if (e[0] !== '(') return e;
      let d = 0;
      for (let i = 0; i < e.length; i++) {
        if (e[i] === '(') d++;
        else if (e[i] === ')') { d--; if (d === 0) return i === e.length - 1 ? e.slice(1, -1) : e; }
      }
      return e;
    };
    /* 1) direct pattern: at every node, only the LAST-created child may have its own children.
       Star of leaves -> fork() && fork() && ...; chain -> fork() || ...; combinations nest on the last child. */
    const shapeOK = lab => kidsOf(lab).every((k, i, arr) =>
      !kidsOf(k).length || (i === arr.length - 1 && shapeOK(k)));
    const build = lab => kidsOf(lab).map(k => {
      if (!kidsOf(k).length) return 'fork()';
      const sub = build(k);
      return '(fork() || ' + (kidsOf(k).length > 1 ? '(' + sub + ')' : sub) + ')';
    }).join(' && ');
    /* 2) sequential doubling helper: subtree of 2^F nodes may be fork() + fork() + ... */
    const subSize = lab => 1 + kidsOf(lab).reduce((s, k) => s + subSize(k), 0);
    /* 3) uniform branches: the root creates k children with an && star; all k children end
       falsy, so they ALL evaluate the || right side and each builds the same subtree.
       (This is the shape of course example 7: fork() && fork() || (fork() && fork()).) */
    function candList(lab, depth) {
      const kids = kidsOf(lab);
      const out = [];
      if (!kids.length || depth > 4) return out;
      if (shapeOK(lab)) out.push(build(lab));
      const f = Math.log2(subSize(lab));
      if (Number.isInteger(f) && f >= 1 && f <= 4) out.push(new Array(f).fill('fork()').join(' + '));
      if (kids.every(k => kidsOf(k).length)) {
        const lhs = new Array(kids.length).fill('fork()').join(' && ');
        for (const sub of candList(kids[0], depth + 1)) out.push(lhs + ' || (' + sub + ')');
      }
      return out;
    }
    for (const cand of candList(root, 0)) {
      const e = stripOuter(cand);
      if (verify(e)) return { expr: e, method: 'pattern' };
    }
    /* 4) bounded brute-force search for small trees (up to 5 processes = 4 forks) */
    const forks = tree.bfs.length - 1;
    if (forks <= 4) {
      const memo = [null, ['fork()', '!fork()']];
      for (let k = 2; k <= forks; k++) {
        const list = [];
        for (let i = 1; i < k; i++)
          for (const a of memo[i]) for (const b of memo[k - i])
            for (const op of ['&&', '||', '+', '*'])
              list.push('(' + a + ' ' + op + ' ' + b + ')');
        memo[k] = list;
      }
      for (const cand of memo[forks]) {
        const e = stripOuter(cand);
        if (verify(e)) return { expr: e, method: 'search' };
      }
    }
    return null;
  }

  return { parseTree, genOrdered, genNested, genExpression };
})();

/* ============================ PRACTICE GENERATOR ============================ */
const Generator = (() => {
  const T = [];
  const t = (level, tags, ask, code) => T.push({ level, tags, ask, code });

  const ASK_TREE = 'Draw the process tree and find the total number of processes.';
  const ASK_PRINT = 'Draw the process tree and count how many times each message is printed.';
  const ASK_X = 'Find the final value of x in every process, and the total number of processes.';

  // ---- EASY ----
  t('easy', [], ASK_TREE, 'fork();');
  t('easy', [], ASK_TREE, 'fork();\nfork();');
  t('easy', [], ASK_TREE, 'fork();\nfork();\nfork();');
  t('easy', ['andor'], ASK_TREE + ' Careful with short-circuiting!', 'fork() || fork();');
  t('easy', ['andor'], ASK_TREE + ' Careful with short-circuiting!', 'fork() && fork();');
  t('easy', ['plus'], ASK_TREE, 'fork() + fork();');
  t('easy', ['plus'], ASK_TREE, 'fork() * fork();');
  // ---- MEDIUM ----
  t('medium', ['iffork', 'loops'], ASK_TREE + ' Which processes keep forking?', 'void main() {\n    int i;\n    for (i = 0; i < 3; i++) {\n        if (fork())\n            break;\n    }\n}');
  t('medium', ['ifnot', 'loops'], ASK_TREE + ' Which process keeps forking?', 'void main() {\n    int i;\n    for (i = 0; i < 3; i++) {\n        if (!fork())\n            break;\n    }\n}');
  t('medium', ['ifnot', 'printf'], ASK_PRINT, 'void main() {\n    if (!fork())\n        if (!fork())\n            printf("Im in");\n    fork();\n    printf("I am out");\n}');
  t('medium', ['iffork', 'printf'], ASK_PRINT, 'void main() {\n    if (fork())\n        printf("parent");\n    else\n        printf("child");\n    fork();\n    printf("done");\n}');
  t('medium', ['andor', 'printf'], ASK_PRINT, 'void main() {\n    fork() && fork();\n    printf("hello");\n}');
  t('medium', ['andor', 'printf'], ASK_PRINT, 'void main() {\n    fork() || fork();\n    printf("done");\n}');
  // ---- HARD ----
  t('hard', ['andor'], ASK_TREE + ' Respect the parentheses and short-circuit rules.', 'fork() && fork() || (fork() && fork());');
  t('hard', ['andor'], ASK_TREE + ' Respect the parentheses and short-circuit rules.', 'fork() || (fork() && fork());');
  t('hard', ['andor'], ASK_TREE + ' Respect the parentheses and short-circuit rules.', 'fork() && (fork() || fork());');
  t('hard', ['loops', 'xvar', 'iffork'], ASK_X, 'void main() {\n    int i, j, n = 2, x = 0;\n    for (i = 1; i <= n; i++) {\n        for (j = i; j <= n; j++) {\n            if (fork()) {\n                x++;\n                break;\n            } else {\n                i++;\n                x--;\n            }\n        }\n    }\n}');
  t('hard', ['loops', 'xvar', 'iffork'], ASK_X, 'void main() {\n    int i, n = 2, x = 3;\n    for (i = 0; i < n; i++) {\n        if (fork())\n            x += 2;\n        else\n            x--;\n    }\n}');
  t('hard', ['ifnot', 'printf', 'loops'], ASK_PRINT, 'void main() {\n    int i;\n    for (i = 0; i < 2; i++) {\n        if (!fork())\n            printf("child");\n    }\n    printf("end");\n}');

  /* ---- random tree questions (Tree -> Code) ---- */
  const ASK_T2C = 'Write fork() C code that creates exactly this process tree. P0 is the original process and children are numbered in creation order.';
  const ASK_T2E = 'Write ONE fork() expression (using &&, ||, + and ! if needed) that creates exactly this process tree. P0 is the original process and children are numbered in creation order.';
  function treeSize(level) {
    return level === 'easy' ? 3 + Math.floor(Math.random() * 2)
         : level === 'medium' ? 5 + Math.floor(Math.random() * 2)
         : 7 + Math.floor(Math.random() * 3);
  }
  function randomTreeText(level) {
    const n = treeSize(level);
    const maxKids = level === 'easy' ? 2 : 3;
    const parent = [null], kidCount = [0];
    for (let i = 1; i < n; i++) {
      const cand = [];
      for (let j = 0; j < i; j++) if (kidCount[j] < maxKids) cand.push(j);
      const p = cand[Math.floor(Math.random() * cand.length)];
      parent.push(p); kidCount[p]++; kidCount.push(0);
    }
    const children = {};
    parent.forEach((p, i) => { if (p !== null) (children[p] = children[p] || []).push(i); });
    const order = [0];
    for (let q = 0; q < order.length; q++) (children[order[q]] || []).forEach(c => order.push(c));
    const label = {}; order.forEach((old, i) => { label[old] = 'P' + i; });
    return order.filter(o => (children[o] || []).length)
      .map(o => label[o] + ' -> ' + children[o].map(c => label[c]).join(', ')).join('\n');
  }
  /* Random tree that is GUARANTEED to be expressible as one fork() expression:
     at every node only the last-created child keeps forking (chains, stars, mixes). */
  function exprTreeText(level) {
    const n = treeSize(level), maxKids = level === 'easy' ? 2 : 3;
    const children = {}; let cur = 0, next = 1;
    while (next < n) {
      const k = Math.min(1 + Math.floor(Math.random() * maxKids), n - next);
      children[cur] = [];
      for (let i = 0; i < k; i++) children[cur].push(next + i);
      next += k; cur = next - 1;
    }
    return Object.keys(children).map(p => 'P' + p + ' -> ' + children[p].map(c => 'P' + c).join(', ')).join('\n');
  }
  function isExpressible(treeText) {
    try { return !!TreeCode.genExpression(TreeCode.parseTree(treeText)); } catch (e) { return false; }
  }
  function treeAsk(level, exprMode) {
    let ask = exprMode ? ASK_T2E : ASK_T2C;
    if (level === 'hard') ask += ' Also state how many fork() calls are needed (one per edge).';
    return ask;
  }
  function generateTree(level, exprMode) {
    let treeText = null;
    if (exprMode) {
      /* only accept trees VERIFIED to have a fork() expression solution */
      for (let a = 0; a < 150 && !treeText; a++) {
        const t = randomTreeText(level);
        if (isExpressible(t)) treeText = t;
      }
      if (!treeText) treeText = exprTreeText(level);
    } else {
      treeText = randomTreeText(level);
    }
    return { type: 'tree2code', level, exprMode: !!exprMode, treeText, ask: treeAsk(level, exprMode), note: '' };
  }

  let lastIdx = -1;
  function generate(opts) {
    const enabled = opts.tags;
    let pool = T.filter(x => x.level === opts.level && x.tags.every(tag => enabled[tag]));
    let note = '';
    if (!pool.length) {
      pool = T.filter(x => x.level === opts.level);
      note = 'No question matches all the selected options for this difficulty \u2014 showing a ' + opts.level + ' question anyway.';
    }
    let idx = Math.floor(Math.random() * pool.length);
    if (pool.length > 1 && T.indexOf(pool[idx]) === lastIdx) idx = (idx + 1) % pool.length;
    lastIdx = T.indexOf(pool[idx]);
    return { type: 'code2tree', code: pool[idx].code, ask: pool[idx].ask, note };
  }

  return { generate, generateTree, treeAsk, isExpressible, templates: T };
})();

/* ============================ NODE EXPORT (for tests) ============================ */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Engine, TreeCode, Generator };
}

/* ============================ UI ============================ */
if (typeof document !== 'undefined') (function UI() {

  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const EX_MAIN = 'void main() {\n    if (!fork())\n        if (!fork())\n            printf("Im in");\n    fork();\n    printf("I am out");\n}';
  const EX_LOOP = 'void main() {\n    int i, j, n = 2, x = 0;\n    for (i = 1; i <= n; i++) {\n        for (j = i; j <= n; j++) {\n            if (fork()) {\n                x++;\n                break;\n            } else {\n                i++;\n                x--;\n            }\n        }\n    }\n}';
  const EX_TREE = 'P0 -> P1, P2\nP1 -> P3\nP2 -> P4, P5';

  /* ---------- view switching ---------- */
  function show(view) {
    document.querySelectorAll('.view').forEach(v => { v.hidden = (v.id !== 'view-' + view); });
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('.nav-btn').forEach(b => b.addEventListener('click', () => show(b.dataset.view)));

  /* ---------- error helper ---------- */
  function showError(sel, err) {
    const el = $(sel);
    el.textContent = err && err.message ? err.message : String(err);
    el.hidden = false;
  }
  function hideError(sel) { $(sel).hidden = true; }

  /* ---------- tree SVG ---------- */
  const PAL = ['#2F6FED', '#12B76A', '#F79009', '#9E77ED', '#F04438', '#0E9384', '#DD2590', '#5925DC'];

  function buildTreeSVG(processes, edges, opts) {
    opts = opts || {};
    const label = opts.label || (p => 'P' + p.pid);
    const kids = {};
    processes.forEach(p => { kids[p.pid] = []; });
    edges.forEach(e => kids[e.from].push(e.to));
    const X = {}, D = {};
    let leaf = 0, maxD = 0;
    (function dfs(id, d) {
      D[id] = d; if (d > maxD) maxD = d;
      const ks = kids[id];
      if (!ks.length) { X[id] = leaf++; return; }
      ks.forEach(k => dfs(k, d + 1));
      X[id] = (X[ks[0]] + X[ks[ks.length - 1]]) / 2;
    })(0, 0);
    const GX = 96, GY = 94, PAD = 30, NW = 58, NH = 32;
    const W = Math.max(1, leaf) * GX + PAD, H = (maxD + 1) * GY + PAD + 14;
    const cx = id => X[id] * GX + PAD / 2 + GX / 2;
    const cy = id => D[id] * GY + PAD / 2 + NH;
    let s = '';
    edges.forEach(e => {
      s += '<line x1="' + cx(e.from) + '" y1="' + (cy(e.from) + NH / 2) + '" x2="' + cx(e.to) + '" y2="' + (cy(e.to) - NH / 2) + '" stroke="#B9C0CC" stroke-width="2"/>';
    });
    processes.forEach(p => {
      const c = PAL[D[p.pid] % PAL.length];
      let sub = '';
      if (opts.subLabel) sub = opts.subLabel(p) || '';
      const tipParts = [label(p) + ' \u2014 parent: ' + (p.parent === null || p.parent === undefined ? '\u2014' : label(processes[p.parent]))];
      if (p.prints && p.prints.length) tipParts.push('prints: ' + p.prints.map(x => '"' + x + '"').join(', '));
      if (p.vars && Object.keys(p.vars).length) tipParts.push(Object.keys(p.vars).map(k => k + '=' + p.vars[k]).join(', '));
      s += '<g>';
      s += '<rect x="' + (cx(p.pid) - NW / 2) + '" y="' + (cy(p.pid) - NH / 2) + '" width="' + NW + '" height="' + NH + '" rx="9" fill="' + c + '"/>';
      s += '<text x="' + cx(p.pid) + '" y="' + (cy(p.pid) + 5) + '" text-anchor="middle" font-size="14" font-weight="700" fill="#fff" font-family="ui-monospace,Menlo,Consolas,monospace">' + esc(label(p)) + '</text>';
      if (sub) s += '<text x="' + cx(p.pid) + '" y="' + (cy(p.pid) + NH / 2 + 14) + '" text-anchor="middle" font-size="10.5" fill="#5B6472" font-family="ui-monospace,Menlo,Consolas,monospace">' + esc(sub) + '</text>';
      s += '<title>' + esc(tipParts.join(' | ')) + '</title></g>';
    });
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" data-basew="' + W + '">' + s + '</svg>';
  }

  function treeCardHTML(svg, hint) {
    return '<div class="card"><h3>Process tree</h3>' +
      '<div class="tree-toolbar">' +
      '<button class="btn" data-act="zoom-out" title="Zoom out">\u2212</button>' +
      '<button class="btn" data-act="zoom-reset">100%</button>' +
      '<button class="btn" data-act="zoom-in" title="Zoom in">+</button>' +
      '<button class="btn" data-act="png">Export PNG</button>' +
      '<button class="btn" data-act="print">Print / Save as PDF</button>' +
      '<button class="btn" data-act="copy-steps">Copy explanation</button>' +
      '</div>' +
      '<div class="tree-wrap" data-zoom="1">' + svg + '</div>' +
      '<p class="hint">' + (hint || 'Hover a node for details. Colors show the generation (depth) of each process.') + '</p></div>';
  }

  /* ---------- solution rendering ---------- */
  const solutions = {};
  let uid = 0;

  function renderSolution(containerSel, res, opts) {
    opts = opts || {};
    uid++;
    solutions[uid] = res;
    const anyPrints = res.totalPrints > 0;
    const anyVars = res.processes.some(p => Object.keys(p.vars).length > 0);
    const hasX = res.processes.some(p => 'x' in p.vars);
    const xs = hasX ? res.processes.map(p => p.vars.x || 0) : [];

    let html = '<div data-sid="' + uid + '">';

    /* summary */
    html += '<div class="card"><h3>Result summary</h3><div class="fact-grid">' +
      '<div class="fact"><b>' + res.processes.length + '</b><span>total processes</span></div>' +
      '<div class="fact"><b>' + res.edges.length + '</b><span>fork() calls executed</span></div>' +
      (anyPrints ? '<div class="fact"><b>' + res.totalPrints + '</b><span>total printed lines</span></div>' : '') +
      (hasX ? '<div class="fact"><b>' + Math.min.apply(null, xs) + ' \u2026 ' + Math.max.apply(null, xs) + '</b><span>min \u2026 max final x</span></div>' : '') +
      '</div></div>';

    /* tree */
    const svg = buildTreeSVG(res.processes, res.edges, {
      subLabel: p => {
        if (hasX) return 'x=' + (p.vars.x || 0);
        if (p.prints.length) { const f = p.prints[0]; return '"' + (f.length > 9 ? f.slice(0, 8) + '\u2026' : f) + '"' + (p.prints.length > 1 ? ' +' + (p.prints.length - 1) : ''); }
        return '';
      }
    });
    html += treeCardHTML(svg);

    /* process table */
    html += '<div class="card"><h3>Processes</h3><div class="table-scroll"><table><thead><tr>' +
      '<th>Process</th><th>Parent</th><th>fork() calls it made</th><th>Printed output</th>' + (anyVars ? '<th>Final variables</th>' : '') + '<th>Ended</th>' +
      '</tr></thead><tbody>';
    res.processes.forEach(p => {
      const forks = p.forks.length ? p.forks.map(f => '#' + f.site + ' \u2192 P' + f.child).join(', ') : '\u2014';
      const prints = p.prints.length ? p.prints.map(x => '"' + esc(x) + '"').join('<br>') : '\u2014';
      const vars = Object.keys(p.vars).length ? Object.keys(p.vars).map(k => k + ' = ' + p.vars[k]).join(', ') : '\u2014';
      const ended = p.exit === 'finished' ? 'end of main()' : p.exit;
      html += '<tr><td><b>P' + p.pid + '</b></td><td>' + (p.parent === null ? '\u2014' : 'P' + p.parent) + '</td><td>' + forks + '</td><td>' + prints + '</td>' + (anyVars ? '<td>' + vars + '</td>' : '') + '<td>' + ended + '</td></tr>';
    });
    html += '</tbody></table></div></div>';

    /* print counts */
    if (anyPrints) {
      html += '<div class="card"><h3>Printed output counts</h3><div class="table-scroll"><table><thead><tr><th>Message</th><th>Printed by</th><th>Times printed</th></tr></thead><tbody>';
      Object.keys(res.printCounts).forEach(msg => {
        const by = res.processes.filter(p => p.prints.indexOf(msg) >= 0).map(p => 'P' + p.pid).join(', ');
        html += '<tr><td>"' + esc(msg) + '"</td><td>' + by + '</td><td><b>' + res.printCounts[msg] + '</b></td></tr>';
      });
      html += '</tbody></table></div><p class="hint">Actual runtime order may vary \u2014 the OS can schedule the processes in any order. The counts are what matter.</p></div>';
    }

    /* x values */
    if (hasX) {
      html += '<div class="card"><h3>Final x values</h3><div class="table-scroll"><table><thead><tr><th>Process</th><th>Final x</th></tr></thead><tbody>' +
        res.processes.map(p => '<tr><td>P' + p.pid + '</td><td><b>' + (p.vars.x || 0) + '</b></td></tr>').join('') +
        '</tbody></table></div><p class="hint">Minimum x = <b>' + Math.min.apply(null, xs) + '</b>, maximum x = <b>' + Math.max.apply(null, xs) + '</b>, across ' + res.processes.length + ' final processes.</p></div>';
    }

    /* steps */
    const MAXSHOW = 200;
    const stepsShown = res.log.slice(0, MAXSHOW);
    html += '<div class="card"><h3>Step-by-step explanation</h3><ol class="steps-list">' +
      stepsShown.map(s => '<li>' + esc(s) + '</li>').join('') +
      '</ol>' + (res.log.length > MAXSHOW ? '<p class="hint">Showing the first ' + MAXSHOW + ' of ' + res.log.length + ' steps.</p>' : '') + '</div>';

    html += '</div>';
    $(containerSel).innerHTML = html;
  }

  /* ---------- toolbar actions (delegated) ---------- */
  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const card = btn.closest('.card');
    const wrap = card ? card.querySelector('.tree-wrap') : null;
    const act = btn.dataset.act;
    if ((act === 'zoom-in' || act === 'zoom-out' || act === 'zoom-reset') && wrap) {
      let z = parseFloat(wrap.dataset.zoom || '1');
      if (act === 'zoom-in') z = Math.min(3, z * 1.25);
      if (act === 'zoom-out') z = Math.max(0.3, z / 1.25);
      if (act === 'zoom-reset') z = 1;
      wrap.dataset.zoom = z;
      const svg = wrap.querySelector('svg');
      const bw = parseFloat(svg.dataset.basew);
      svg.style.width = (bw * z) + 'px';
      svg.style.height = 'auto';
      return;
    }
    if (act === 'png' && wrap) {
      const svg = wrap.querySelector('svg');
      try {
        const xml = new XMLSerializer().serializeToString(svg);
        const img = new Image();
        img.onload = function () {
          const c = document.createElement('canvas');
          c.width = img.width * 2; c.height = img.height * 2;
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
          ctx.scale(2, 2); ctx.drawImage(img, 0, 0);
          const a = document.createElement('a');
          a.download = 'process-tree.png';
          a.href = c.toDataURL('image/png');
          a.click();
        };
        img.onerror = function () { window.print(); };
        img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
      } catch (err) { window.print(); }
      return;
    }
    if (act === 'print') { window.print(); return; }
    if (act === 'copy-steps') {
      const holder = btn.closest('[data-sid]');
      const res = holder ? solutions[holder.dataset.sid] : null;
      const text = res ? res.log.map((s, i) => (i + 1) + '. ' + s).join('\n') : '';
      const done = () => { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy explanation'; }, 1500); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, done);
      else done();
      return;
    }
    if (act === 'copy-code') {
      const pre = card ? card.querySelector('.codebox') : null;
      if (pre) {
        const done = () => { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy code'; }, 1500); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(pre.textContent).then(done, done);
        else done();
      }
      return;
    }
  });

  /* ---------- Code -> Tree ---------- */
  function solveCode() {
    hideError('#code-error');
    $('#code-results').innerHTML = '';
    const src = $('#code-input').value;
    try {
      const res = Engine.run(src);
      renderSolution('#code-results', res);
    } catch (err) { showError('#code-error', err); }
  }
  $('#btn-code-solve').addEventListener('click', solveCode);
  $('#btn-code-example').addEventListener('click', () => { $('#code-input').value = EX_MAIN; solveCode(); });
  $('#btn-code-loop').addEventListener('click', () => { $('#code-input').value = EX_LOOP; solveCode(); });
  $('#btn-code-clear').addEventListener('click', () => { $('#code-input').value = ''; $('#code-results').innerHTML = ''; hideError('#code-error'); });

  /* ---------- Expression ---------- */
  function solveExpr() {
    hideError('#expr-error');
    $('#expr-results').innerHTML = '';
    let src = $('#expr-input').value.trim();
    if (!src) { showError('#expr-error', new Error('Type a fork expression first, e.g.  fork() || fork()')); return; }
    if (!/;\s*$/.test(src)) src += ';';
    try {
      const res = Engine.run(src);
      renderSolution('#expr-results', res);
    } catch (err) { showError('#expr-error', err); }
  }
  $('#btn-expr-solve').addEventListener('click', solveExpr);
  $('#expr-input').addEventListener('keydown', e => { if (e.key === 'Enter') solveExpr(); });
  document.querySelectorAll('[data-expr]').forEach(chip => chip.addEventListener('click', () => { $('#expr-input').value = chip.dataset.expr; solveExpr(); }));

  /* ---------- Tree -> Code ---------- */
  function renderTreeToCode(treeText, mode, containerSel) {
      const tree = TreeCode.parseTree(treeText);
      const exprRes = mode === 'expr' ? TreeCode.genExpression(tree) : null;
      const exprFallback = mode === 'expr' && !exprRes;
      const codeText = mode === 'expr'
        ? (exprRes ? exprRes.expr + ';' : TreeCode.genOrdered(tree))
        : (mode === 'ordered' ? TreeCode.genOrdered(tree) : TreeCode.genNested(tree));

      /* pseudo-processes for the user's tree drawing */
      const idx = {}; tree.bfs.forEach((lab, i) => { idx[lab] = i; });
      const pProcs = tree.bfs.map((lab, i) => ({ pid: i, parent: null, prints: [], vars: {}, forks: [] }));
      const pEdges = [];
      tree.bfs.forEach(lab => (tree.children[lab] || []).forEach(k => { pEdges.push({ from: idx[lab], to: idx[k] }); pProcs[idx[k]].parent = idx[lab]; }));

      /* verify by running the generated code through the simulator */
      const res = Engine.run(codeText);
      const wanted = {}; pEdges.forEach(e => { wanted[e.from + '>' + e.to] = true; });
      const match = res.processes.length === tree.bfs.length && res.edges.every(e => wanted[e.from + '>' + e.to]) && res.edges.length === pEdges.length;

      /* label mapping note */
      const plain = tree.bfs.every((lab, i) => lab.toUpperCase() === 'P' + i);
      let mapNote = '';
      if (!plain) {
        mapNote = '<p class="hint">Creation-order mapping: ' + tree.bfs.map((lab, i) => 'P' + i + ' = ' + esc(lab)).join(', ') + '.</p>';
      }

      let html = '';
      html += '<div class="card"><h3>Your tree</h3><div class="fact-grid">' +
        '<div class="fact"><b>' + tree.nodes.length + '</b><span>nodes (processes)</span></div>' +
        '<div class="fact"><b>' + pEdges.length + '</b><span>edges (fork calls)</span></div>' +
        '<div class="fact"><b>' + (mode === 'expr' ? 'expression' : mode === 'ordered' ? 'P0, P1, P2\u2026' : 'any valid') + '</b><span>output style</span></div>' +
        '</div>' + mapNote +
        '<div class="table-scroll"><table><thead><tr><th>Parent</th><th>Children (creation order)</th></tr></thead><tbody>' +
        tree.bfs.filter(lab => (tree.children[lab] || []).length).map(lab => '<tr><td><b>' + esc(lab) + '</b></td><td>' + tree.children[lab].map(esc).join(', ') + '</td></tr>').join('') +
        '</tbody></table></div>' +
        '<div class="tree-toolbar"></div><div class="tree-wrap" data-zoom="1">' + buildTreeSVG(pProcs, pEdges, { label: p => tree.bfs[p.pid] }) + '</div></div>';

      html += '<div class="card"><h3>' + (mode === 'expr' ? (exprFallback ? 'Generated fork() code (expression not possible)' : 'Generated fork() expression') : 'Generated fork() code') + '</h3>' +
        (exprFallback ? '<div class="error" style="display:block">This exact tree cannot be produced by a single fork() expression with the OS-1 operators (or it is too large to search). Expressions can only build certain shapes: chains via ||, stars via &amp;&amp;, sequential doubling via + or *, and combinations where only the last-created child keeps forking. Showing ordered C code instead \u2014 C code can build any tree.</div>' : '') +
        '<div class="btn-row"><button class="btn" data-act="copy-code">Copy code</button></div>' +
        '<pre class="codebox">' + esc(codeText) + '</pre>' +
        '<p class="hint">' + (mode === 'expr' && exprRes
          ? 'How to read it: with <code>&amp;&amp;</code> only the parent (fork() \u2260 0) evaluates the right side; with <code>||</code> only the child (fork() = 0) evaluates the right side; with <code>+</code> and <code>*</code> both sides always run; <code>!</code> swaps the parent/child roles. Parentheses are evaluated first.'
          : mode === 'ordered' || exprFallback
          ? 'Each <code>if (fork() == 0) { \u2026 exit(0); }</code> block is one child. A parent creates all of its children first, so processes are created exactly in P0, P1, P2\u2026 (BFS) order under the course convention.'
          : 'Nested style without exit(): each child lives inside the <code>if (fork() == 0)</code> branch and the parent continues in the <code>else</code> branch. Any code that produces this parent\u2013child structure is a valid answer.') + '</p>' +
        (match ? '<span class="ok-badge">\u2713 Verified \u2014 running this code produces exactly your tree (' + res.processes.length + ' processes)</span>'
               : '<span class="error" style="display:inline-block">Verification mismatch \u2014 please double-check the tree description.</span>') +
        '</div>';

      /* explanation from the simulator run */
      uid++; solutions[uid] = res;
      html += '<div data-sid="' + uid + '"><div class="card"><h3>How this code builds the tree \u2014 step by step</h3><ol class="steps-list">' +
        res.log.slice(0, 200).map(s => '<li>' + esc(s) + '</li>').join('') + '</ol>' +
        '<div class="tree-toolbar"><button class="btn" data-act="copy-steps">Copy explanation</button></div></div></div>';

      $(containerSel).innerHTML = html;
  }
  function genTree() {
    hideError('#tree-error');
    $('#tree-results').innerHTML = '';
    try {
      renderTreeToCode($('#tree-input').value, document.querySelector('input[name="gen-order"]:checked').value, '#tree-results');
    } catch (err) { showError('#tree-error', err); }
  }
  $('#btn-tree-generate').addEventListener('click', genTree);
  $('#btn-tree-example').addEventListener('click', () => { $('#tree-input').value = EX_TREE; genTree(); });

  /* ---------- Practice ---------- */
  let currentQ = null;
  function qType() { return $('#g-qtype').value; }
  function syncPracticeOptions() {
    const t2c = qType() === 'tree2code';
    $('#practice-toggles').style.display = t2c ? 'none' : '';
    $('#practice-codestyle').style.display = t2c ? '' : 'none';
  }
  function questionTreeHTML(treeText) {
    const tree = TreeCode.parseTree(treeText);
    const idx = {}; tree.bfs.forEach((lab, i) => { idx[lab] = i; });
    const pProcs = tree.bfs.map((lab, i) => ({ pid: i, parent: null, prints: [], vars: {}, forks: [] }));
    const pEdges = [];
    tree.bfs.forEach(lab => (tree.children[lab] || []).forEach(k => { pEdges.push({ from: idx[lab], to: idx[k] }); pProcs[idx[k]].parent = idx[lab]; }));
    return '<div class="tree-wrap" data-zoom="1">' + buildTreeSVG(pProcs, pEdges, { label: p => tree.bfs[p.pid] }) + '</div>';
  }
  function genQuestion() {
    const level = $('#g-diff').value;
    if (qType() === 'tree2code') {
      const exprMode = document.querySelector('input[name="p-gen-order"]:checked').value === 'expr';
      currentQ = Generator.generateTree(level, exprMode);
      $('#q-title').textContent = 'Question \u2014 Tree \u2192 ' + (exprMode ? 'Expression' : 'Code') + ' (' + level + ')';
      $('#q-code').textContent = currentQ.treeText;
      $('#q-tree').innerHTML = questionTreeHTML(currentQ.treeText);
    } else {
      const opts = {
        level,
        tags: {
          iffork: $('#chk-iffork').checked,
          ifnot: $('#chk-ifnot').checked,
          andor: $('#chk-andor').checked,
          plus: $('#chk-plus').checked,
          loops: $('#chk-loops').checked,
          printf: $('#chk-printf').checked,
          xvar: $('#chk-xvar').checked
        }
      };
      currentQ = Generator.generate(opts);
      $('#q-title').textContent = 'Question \u2014 Code \u2192 Tree (' + level + ')';
      $('#q-code').textContent = currentQ.code;
      $('#q-tree').innerHTML = '';
    }
    $('#q-card').hidden = false;
    $('#q-text').textContent = currentQ.ask;
    $('#practice-results').innerHTML = '';
    $('#btn-reveal').hidden = false;
    $('#btn-newq').hidden = false;
    const note = $('#practice-note');
    note.hidden = !currentQ.note;
    note.textContent = currentQ.note || '';
  }
  function revealSolution() {
    if (!currentQ) return;
    try {
      if (currentQ.type === 'tree2code') {
        const mode = document.querySelector('input[name="p-gen-order"]:checked').value;
        renderTreeToCode(currentQ.treeText, mode, '#practice-results');
      } else {
        const res = Engine.run(currentQ.code);
        renderSolution('#practice-results', res);
      }
    } catch (err) {
      $('#practice-results').innerHTML = '<div class="error">' + esc(err.message) + '</div>';
    }
  }
  $('#g-qtype').addEventListener('change', syncPracticeOptions);
  /* If the user switches the solution style AFTER a tree question was generated,
     keep the question consistent: expression mode must always show a solvable tree. */
  document.querySelectorAll('input[name="p-gen-order"]').forEach(r => r.addEventListener('change', () => {
    if (!currentQ || currentQ.type !== 'tree2code' || $('#q-card').hidden) return;
    const exprMode = document.querySelector('input[name="p-gen-order"]:checked').value === 'expr';
    if (exprMode && !Generator.isExpressible(currentQ.treeText)) {
      genQuestion();
      const note = $('#practice-note');
      note.hidden = false;
      note.textContent = 'New tree generated \u2014 the previous tree could not be written as a single fork() expression.';
      return;
    }
    currentQ.exprMode = exprMode;
    currentQ.ask = Generator.treeAsk(currentQ.level, exprMode);
    $('#q-text').textContent = currentQ.ask;
    $('#q-title').textContent = 'Question \u2014 Tree \u2192 ' + (exprMode ? 'Expression' : 'Code') + ' (' + currentQ.level + ')';
    $('#practice-results').innerHTML = '';
  }));
  syncPracticeOptions();
  $('#btn-generate').addEventListener('click', genQuestion);
  $('#btn-newq').addEventListener('click', genQuestion);
  $('#btn-reveal').addEventListener('click', revealSolution);

  /* ---------- QA / demo hash hooks ---------- */
  function handleHash() {
    const h = location.hash;
    if (h === '#demo-code') { show('code'); $('#code-input').value = EX_MAIN; solveCode(); }
    else if (h === '#demo-loop') { show('code'); $('#code-input').value = EX_LOOP; solveCode(); }
    else if (h === '#demo-expr') { show('expr'); $('#expr-input').value = 'fork() && fork() || (fork() && fork())'; solveExpr(); }
    else if (h === '#demo-tree') { show('tree'); $('#tree-input').value = EX_TREE; genTree(); }
    else if (h === '#demo-tree-expr') { show('tree'); $('#tree-input').value = 'P0 -> P1, P2\nP1 -> P3, P4\nP2 -> P5, P6'; document.querySelector('input[name="gen-order"][value="expr"]').checked = true; genTree(); }
    else if (h === '#demo-practice') { show('practice'); $('#g-diff').value = 'hard'; genQuestion(); revealSolution(); }
    else if (h === '#demo-practice-tree') { show('practice'); $('#g-qtype').value = 'tree2code'; syncPracticeOptions(); $('#g-diff').value = 'medium'; genQuestion(); revealSolution(); }
  }
  handleHash();
})();
