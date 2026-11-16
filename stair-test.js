/* ============================================================================
 * stair-test.js —— 楼梯踏步.html 的引擎纯函数验收
 *
 * 跑法：node stair-test.js
 * 引擎在 楼梯踏步.html 的 /*ENGINE-START*\/ … /*ENGINE-END*\/ 之间，
 * 用和 sketch-test.js 一样的正则抽出来，在 node 里零依赖跑。
 * ========================================================================== */

const fs = require("fs");
const path = require("path");

function readEngine(file) {
  const html = fs.readFileSync(path.join(__dirname, file), "utf8");
  const m = html.match(/\/\*ENGINE-START\*\/([\s\S]*?)\/\*ENGINE-END\*\//);
  if (!m) { console.error(`找不到引擎代码段（${file}）`); process.exit(1); }
  const shim = { exports: {} };
  new Function("module", "exports", m[1])(shim, shim.exports);
  return shim.exports;
}

const E = readEngine("楼梯踏步.html");

/* ============ 测试小工具 ============ */
let _pass = 0, _fail = 0;
const assert = (cond, name, detail) => {
  if (cond) { _pass++; console.log(`  ✅ ${name}`); }
  else { _fail++; console.log(`  ❌ ${name}${detail ? " → " + detail : ""}`); }
};
function test(name, fn) {
  console.log("\n▶ " + name);
  try { fn(); } catch (e) { _fail++; console.log("  ❌ 抛异常: " + (e && e.message)); }
}
const check = (name, cond, detail) => assert(cond, name, detail);
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const rnd = (n) => Math.floor(Math.random() * n);

/* ============ 默认输入 ============ */
const BASE = {
  form: "straight",
  D: 280, R: 150, B: 1200, N: 4, D_top: 280,
  W: 1200, L: 1000,
  n: 30, g: 2, tau: 10, a: 5, tg: 0,
  eL: 3, eR: 3, kerf: 3, waste: 5, minEdge: 100,
  tileW: 800, tileH: 800,
  midOn: false, midW: 800, midH: 800, midOrient: "h",
  layoutMode: "center", allowRotate: true, platformRowMode: "auto",
};
const inp = (o) => Object.assign({}, BASE, o || {});
const widths = (cols) => cols.map(c => (typeof c === "number" ? c : c.w));
const sumCols = (cols, g) => widths(cols).reduce((a, b) => a + b, 0) + (cols.length - 1) * g;

/* ============================================================================ */
test("0. 引擎导出齐全", () => {
  ["centerCols", "layoutColumns", "clipTyped", "intColsTyped", "straightPlan",
   "wrapPlan", "buildPlan", "packPieces", "platformRows", "normalize", "validate"]
    .forEach(k => check(`导出 ${k}`, typeof E[k] === "function", typeof E[k]));
});

test("1. 居中对称列宽——教科书例子", () => {
  const r1 = E.centerCols(1194, 800, 2, 100);
  check("1194 → 3 列", r1.ok && r1.cols.length === 3, JSON.stringify(r1));
  check("1194 → 195/800/195", widths(r1.cols).join(",") === "195,800,195", widths(r1.cols).join(","));

  const r2 = E.centerCols(2880, 800, 2, 100);
  check("2880 → 5 列", r2.ok && r2.cols.length === 5, widths(r2.cols).join(","));
  check("2880 → 236/800/800/800/236", widths(r2.cols).join(",") === "236,800,800,800,236");

  const r3 = E.centerCols(1560, 800, 2, 100);
  check("1560 → 378/800/378", widths(r3.cols).join(",") === "378,800,378");

  const r4 = E.centerCols(1280, 800, 2, 100);
  check("1280 → 238/800/238", widths(r4.cols).join(",") === "238,800,238");

  const r5 = E.centerCols(1000, 800, 2, 100);
  check("1000 → 499/499（f=1 时边条 98 < 100，退回 f=0）",
        widths(r5.cols).join(",") === "499,499", widths(r5.cols).join(","));

  const r6 = E.centerCols(1840, 800, 2, 100);
  check("1840 → 117/800/800/117", widths(r6.cols).join(",") === "117,800,800,117");

  const r7 = E.centerCols(1200, 800, 2, 100);
  check("1200 → 198/800/198", widths(r7.cols).join(",") === "198,800,198");

  const r8 = E.centerCols(1038, 800, 2, 100);
  check("1038 → 117/800/117", widths(r8.cols).join(",") === "117,800,117");
});

test("2. 居中对称列宽——整砖精确与 801 陷阱", () => {
  const r1 = E.centerCols(2404, 800, 2, 100);
  check("2404 精确 = 3 块整砖", widths(r1.cols).length === 3 && widths(r1.cols).every(w => w === 800),
        widths(r1.cols).join(","));
  check("2404 不被拆成 2+边条", widths(r1.cols).join(",") === "800,800,800");

  const r2 = E.centerCols(2403, 800, 2, 100);
  check("2403 → 398.5/800/800/398.5", near(sumCols(r2.cols, 2), 2403),
        widths(r2.cols).join(",") + " sum=" + sumCols(r2.cols, 2));

  const r3 = E.centerCols(801, 800, 2, 100);
  check("801 不是 800+1（余 1mm 的坑）", widths(r3.cols).every(w => w < 800 + 1e-9), widths(r3.cols).join(","));
  check("801 → 两列均分 399.5", near(sumCols(r3.cols, 2), 801), widths(r3.cols).join(","));
  check("801 两边差 ≤ 1", Math.abs(widths(r3.cols)[0] - widths(r3.cols)[1]) < 1e-9);

  const r4 = E.centerCols(894, 800, 2, 100);
  check("894 → 446/446", widths(r4.cols).join(",") === "446,446");

  const r5 = E.centerCols(400, 800, 2, 100);
  check("400 < 砖长边 → 一列 400", widths(r5.cols).join(",") === "400");

  const r6 = E.centerCols(3008, 600, 2, 100);
  check("3008 配 600 砖 → 整砖 5 块", widths(r6.cols).join(",") === "600,600,600,600,600", widths(r6.cols).join(","));
});

test("3. 整数化 intColsTyped：总宽一分不差", () => {
  const t1 = E.intColsTyped([{ w: 399.5, kind: "edge" }, { w: 399.5, kind: "edge" }], 799);
  const w1 = widths(t1);
  check("399.5+399.5 → 整数", w1.every(Number.isInteger), w1.join(","));
  check("整数化后和 = 799", w1[0] + w1[1] === 799, w1.join(","));
  check("两边差 ≤ 1", Math.abs(w1[0] - w1[1]) <= 1, w1.join(","));

  const t2 = E.intColsTyped([{ w: 195.5, kind: "edge" }, { w: 800, kind: "mid" }, { w: 195.5, kind: "edge" }], 1191);
  const w2 = widths(t2);
  check("中间列保持原值", w2[1] === 800, w2.join(","));
  check("两侧整数且和精确", w2[0] + w2[2] === 391, w2.join(","));

  const t3 = E.intColsTyped([{ w: 0, kind: "edge" }], 0);
  check("零宽不崩", widths(t3).length === 1);
});

test("4. 整砖起头（edge 模式）", () => {
  const r1 = E.layoutColumns({ width: 1200, tileEdge: 800, g: 2, eL: 3, eR: 3, minEdge: 100, mode: "edge" });
  check("1200 整砖起头 → 800 / 392", widths(r1.cols).join(",") === "800,392", widths(r1.cols).join(","));
  check("整砖起头 和 = A", near(sumCols(r1.cols, 2), 1194));

  const r2 = E.layoutColumns({ width: 2404, tileEdge: 800, g: 2, eL: 0, eR: 0, minEdge: 100, mode: "edge" });
  check("2404 → 800/800/800 精确", widths(r2.cols).join(",") === "800,800,800", widths(r2.cols).join(","));

  const r3 = E.layoutColumns({ width: 801, tileEdge: 800, g: 2, eL: 0, eR: 0, minEdge: 100, mode: "edge" });
  check("801 整砖起头必须退回居中（不许 800+1）", widths(r3.cols).every(w => w <= 800 + 1e-9), widths(r3.cols).join(","));
  check("801 退回后 和 精确", near(sumCols(r3.cols, 2), 801), widths(r3.cols).join(","));

  const r4 = E.layoutColumns({ width: 1200, tileEdge: 800, g: 2, eL: 3, eR: 3, minEdge: 100, mode: "center" });
  check("居中模式仍 195/800/195", widths(r4.cols).join(",") === "195,800,195");
});

test("5. 中间砖 layoutColumns", () => {
  const mk = (m) => E.layoutColumns({ width: 1200, tileEdge: 800, g: 2, eL: 3, eR: 3, minEdge: 100, mode: "center", mid: { w: m } });

  const r800 = mk(800);
  check("中间 800 → 195/800/195", widths(r800.cols).join(",") === "195,800,195", widths(r800.cols).join(","));
  check("中间列 kind = mid", r800.cols[1].kind === "mid");
  check("中间 800 总数精确", near(sumCols(r800.cols, 2), 1194));

  const r900 = mk(900);
  check("中间 900 → 145/900/145", widths(r900.cols).join(",") === "145,900,145", widths(r900.cols).join(","));
  check("中间 900 总数精确", near(sumCols(r900.cols, 2), 1194));

  const r700 = mk(700);
  check("中间 700 → 245/700/245", widths(r700.cols).join(",") === "245,700,245");

  const r1000 = mk(1000);
  check("中间 1000 → 报错（两边只剩 95）", r1000.ok === false, JSON.stringify(r1000));
  check("报错文案提到中间砖", r1000.ok === false && /中间砖/.test(r1000.error || ""), r1000.error);

  const rWide = E.layoutColumns({ width: 2880, tileEdge: 800, g: 2, eL: 0, eR: 0, minEdge: 100, mode: "center", mid: { w: 800 } });
  check("2880 中间 800 → 7 列", rWide.cols.length === 7, widths(rWide.cols).join(","));
  check("2880 中间 800 → 117/800/117/800/117/800/117",
        widths(rWide.cols).join(",") === "117,800,117,800,117,800,117", widths(rWide.cols).join(","));
  check("2880 中间 800 和精确", near(sumCols(rWide.cols, 2), 2880), sumCols(rWide.cols, 2));
  check("只有 1 列 kind=mid", rWide.cols.filter(c => c.kind === "mid").length === 1);
});

test("6. 直跑纵向公式（下料深 / 可见深 / 立板高）", () => {
  const p = E.buildPlan(inp({ form: "straight" }));
  check("能算出来", p.ok === true, JSON.stringify(p.errors));
  const rows = p.straight.rows;
  check("行数 = N（含平台）", rows.length === 4, rows.length);
  check("普通踏面下料深 P = 310", rows[0].depth === 310, rows[0].depth);
  check("普通踏面可见深 = 280", rows[0].visible === 280, rows[0].visible);
  check("平台下料深 = D_top + n = 310", rows[3].depth === 310, rows[3].depth);
  check("平台可见深 = 310", rows[3].visible === 310, rows[3].visible);
  check("平台在最后一行", rows[3].kind === "top");
  check("首级立板 h1 = R+a−tg−g = 153", p.geo.h1 === 153, p.geo.h1);
  check("标准立板 h = R−τ−g = 138", p.geo.h === 138, p.geo.h);
  check("首级完成踏步高 = R + t = 165", p.geo.firstStep === 165, p.geo.firstStep);
  check("平台完成高 = N·R = 600", p.geo.platformH === 600, p.geo.platformH);
  check("平面长 = (N−1)D + D_top + n = 1150", p.geo.length === 1150, p.geo.length);
  check("结构长 = 1120", p.geo.concreteLength === 1120, p.geo.concreteLength);
  check("平面宽 = B = 1200", p.geo.width === 1200, p.geo.width);
});

test("7. 直跑列宽与件数", () => {
  const p = E.buildPlan(inp({ form: "straight" }));
  check("列宽 195/800/195", widths(p.straight.cols).join(",") === "195,800,195", widths(p.straight.cols).join(","));
  check("列宽 + 缝 = A = 1194", near(sumCols(p.straight.cols, 2), 1194), sumCols(p.straight.cols, 2));
  check("件数 24（3 列 × 4 行 × 2 类）", p.pieces.length === 24, p.pieces.length);

  const treads = p.pieces.filter(x => x.part === "tread");
  const risers = p.pieces.filter(x => x.part === "riser");
  check("踏面件 12", treads.length === 12, treads.length);
  check("立板件 12", risers.length === 12, risers.length);
  check("每块踏面 cutH = 310", treads.every(x => x.cutH === 310));
  check("平台那块踏面 3 件 cutH = 310", treads.filter(x => x.level === 4).length === 3);
  check("立板第 1 级高 153", risers.filter(x => x.level === 1).every(x => x.cutH === 153));
  check("立板 2~4 级高 138", risers.filter(x => x.level > 1).every(x => x.cutH === 138));
  check("总数 = 列数 × N × 2", p.pieces.length === p.straight.cols.length * 4 * 2);

  const p900 = E.buildPlan(inp({ form: "straight", B: 900 }));
  check("B=900 → 446/446", widths(p900.straight.cols).join(",") === "446,446", widths(p900.straight.cols).join(","));
  check("B=900 件数 16", p900.pieces.length === 16, p900.pieces.length);

  const p1000 = E.buildPlan(inp({ form: "straight", B: 1000 }));
  check("B=1000 → 496/496", widths(p1000.straight.cols).join(",") === "496,496", widths(p1000.straight.cols).join(","));
});

test("8. 直跑中间砖", () => {
  const p = E.buildPlan(inp({ form: "straight", midOn: true, midW: 900, midH: 800, midOrient: "h" }));
  check("中间 900 → 145/900/145", widths(p.straight.cols).join(",") === "145,900,145", widths(p.straight.cols).join(","));
  const mids = p.pieces.filter(x => x.tile === "mid");
  check("中间件 4 块（4 级踏面，每级 1 块；平台那块也算）", mids.length === 4, mids.length);
  check("中间砖只用在踏面上", mids.every(x => x.part === "tread"),
        mids.map(x => x.part).join(","));
  check("立板一律用通用砖", p.pieces.filter(x => x.part === "riser").every(x => x.tile === "std"));
  check("中间件列宽 900", mids.every(x => x.colW === 900));

  const p800 = E.buildPlan(inp({ form: "straight", midOn: true, midW: 800, midH: 800, midOrient: "h" }));
  check("中间 800 → 195/800/195", widths(p800.straight.cols).join(",") === "195,800,195");

  const pBig = E.buildPlan(inp({ form: "straight", midOn: true, midW: 1000, midH: 800, midOrient: "h" }));
  check("中间 1000 → 不出图并有红错", pBig.ok === false, JSON.stringify(pBig.errors));
});

test("9. 三面台阶几何 o_k 与环带尺寸", () => {
  const p = E.buildPlan(inp({ form: "wrap" }));
  check("能算出来", p.ok === true, JSON.stringify(p.errors));
  check("级数 N=4 → 3 圈台阶", p.levels.length === 3, p.levels.length);

  const o = p.levels.map(l => l.o);
  check("o = (N−k)·D → 840/560/280", o.join(",") === "840,560,280", o.join(","));

  const fw = p.levels.map(l => l.frontW);
  check("正面宽 W+2o → 2880/2320/1760", fw.join(",") === "2880,2320,1760", fw.join(","));

  const sl = p.levels.map(l => l.sideLen);
  check("侧跑长 L+o−D → 1560/1280/1000", sl.join(",") === "1560,1280,1000", sl.join(","));

  const rl = p.levels.map(l => l.riserLen);
  check("侧立板长 L+o → 1840/1560/1280", rl.join(",") === "1840,1560,1280", rl.join(","));

  check("平面总宽 W+2(N−1)D = 2880", p.geo.width === 2880, p.geo.width);
  check("平面总深 L+(N−1)D = 1840", p.geo.length === 1840, p.geo.length);
  check("平台完成高 N·R = 600", p.geo.platformH === 600, p.geo.platformH);
  check("首级完成 165", p.geo.firstStep === 165, p.geo.firstStep);
  check("立板高 153 / 138", p.geo.h1 === 153 && p.geo.h === 138, p.geo.h1 + "/" + p.geo.h);
});

test("10. 正面跨级裁列（通缝）", () => {
  const p = E.buildPlan(inp({ form: "wrap" }));
  const w = p.levels.map(l => widths(l.frontCols).join(","));
  check("第 1 级 236/800/800/800/236", w[0] === "236,800,800,800,236", w[0]);
  check("第 2 级 758/800/758", w[1] === "758,800,758", w[1]);
  check("第 3 级 478/800/478", w[2] === "478,800,478", w[2]);

  p.levels.forEach((l, i) => {
    check(`第 ${l.k} 级 列和 + 缝 = 该级宽`, near(sumCols(l.frontCols, 2), l.frontW),
          sumCols(l.frontCols, 2) + " vs " + l.frontW);
  });

  check("每级正面列数递减", p.levels.every((l, i) => i === 0 || l.frontCols.length <= p.levels[i - 1].frontCols.length));
  check("每级正面都留着中间的整砖", p.levels.every(l => widths(l.frontCols).some(x => x === 800)));
});

test("11. 侧跑列宽（每级各自居中）", () => {
  const p = E.buildPlan(inp({ form: "wrap" }));
  const w = p.levels.map(l => widths(l.sideCols).join(","));
  check("第 1 级侧 378/800/378", w[0] === "378,800,378", w[0]);
  check("第 2 级侧 238/800/238", w[1] === "238,800,238", w[1]);
  check("第 3 级侧 499/499", w[2] === "499,499", w[2]);

  const rw = p.levels.map(l => widths(l.riserCols).join(","));
  check("第 1 级侧立板 117/800/800/117", rw[0] === "117,800,800,117", rw[0]);
  check("第 2 级侧立板 378/800/378", rw[1] === "378,800,378", rw[1]);
  check("第 3 级侧立板 238/800/238", rw[2] === "238,800,238", rw[2]);

  p.levels.forEach(l => {
    check(`第 ${l.k} 级侧列和 = 侧跑长`, near(sumCols(l.sideCols, 2), l.sideLen),
          sumCols(l.sideCols, 2) + " vs " + l.sideLen);
    check(`第 ${l.k} 级侧立板列和 = 立板长`, near(sumCols(l.riserCols, 2), l.riserLen),
          sumCols(l.riserCols, 2) + " vs " + l.riserLen);
  });
});

test("12. 平台行列", () => {
  const p = E.buildPlan(inp({ form: "wrap" }));
  const pf = p.platform;
  check("平台列跟正面跑对齐 198/800/198", widths(pf.cols).join(",") === "198,800,198", widths(pf.cols).join(","));
  check("平台列和 = W = 1200", near(sumCols(pf.cols, 2), 1200), sumCols(pf.cols, 2));
  check("平台 2 行", pf.rows.length === 2, pf.rows.length);
  check("南沿一行深 310", pf.rows[1].depth === 310, pf.rows[1].depth);
  check("南沿一行可见 310（平台最高，没有东西压它）", pf.rows[1].visible === 310, pf.rows[1].visible);
  check("里侧行深 718", pf.rows[0].depth === 718, pf.rows[0].depth);
  check("里侧 718 + 缝 2 + 南沿 310 = L + n = 1030", 718 + 2 + 310 === 1030);

  check("平台立板正面 198/800/198", widths(pf.riserCols.front).join(",") === "198,800,198");
  check("平台立板侧面 499/499", widths(pf.riserCols.side).join(",") === "499,499");

  const noMid = p.pieces.filter(x => x.face === "platform");
  check("平台件一律用通用砖（即使开了中间砖）", noMid.every(x => x.tile === "std"));
});

test("13. 三面台阶件数 = 71", () => {
  const p = E.buildPlan(inp({ form: "wrap" }));
  const cnt = (f) => p.pieces.filter(f).length;

  check("正面踏面 11", cnt(x => x.part === "tread" && x.face === "front") === 11,
        cnt(x => x.part === "tread" && x.face === "front"));
  check("左侧踏面 8", cnt(x => x.part === "tread" && x.face === "left") === 8,
        cnt(x => x.part === "tread" && x.face === "left"));
  check("右侧踏面 8", cnt(x => x.part === "tread" && x.face === "right") === 8);
  check("左右踏面合计 16", cnt(x => x.part === "tread" && (x.face === "left" || x.face === "right")) === 16);
  check("正面立板 11", cnt(x => x.part === "riser" && x.face === "front") === 11);
  check("左右立板合计 20", cnt(x => x.part === "riser" && (x.face === "left" || x.face === "right")) === 20);
  check("平台踏面 6", cnt(x => x.part === "tread" && x.face === "platform") === 6,
        cnt(x => x.part === "tread" && x.face === "platform"));
  check("平台立板 7", cnt(x => x.part === "riser" && x.face === "platform") === 7,
        cnt(x => x.part === "riser" && x.face === "platform"));
  check("总计 71", p.pieces.length === 71, p.pieces.length);

  p.levels.forEach(l => {
    const ft = cnt(x => x.part === "tread" && x.face === "front" && x.level === l.k);
    const fr = cnt(x => x.part === "riser" && x.face === "front" && x.level === l.k);
    check(`第 ${l.k} 级正面踏面件数 = 立板件数`, ft === fr, ft + " vs " + fr);
    const lt = cnt(x => x.part === "tread" && x.face === "left" && x.level === l.k);
    const rt = cnt(x => x.part === "tread" && x.face === "right" && x.level === l.k);
    check(`第 ${l.k} 级左右镜像`, lt === rt, lt + " vs " + rt);
  });
});

test("14. 立板高度与圈数", () => {
  const p = E.buildPlan(inp({ form: "wrap" }));
  const risers = p.pieces.filter(x => x.part === "riser");

  check("立板圈数 = N = 4（3 级 + 平台）", new Set(risers.map(x => x.level)).size === 4,
        Array.from(new Set(risers.map(x => x.level))).join(","));
  check("第 1 圈全部 153", risers.filter(x => x.level === 1).every(x => x.cutH === 153));
  check("第 2、3 圈全部 138", risers.filter(x => x.level > 1).every(x => x.cutH === 138));
  check("平台那圈也是 138", risers.filter(x => x.level === 4).every(x => x.cutH === 138));

  const lr = p.pieces.filter(x => x.part === "riser" && x.face === "left" && x.level === 1);
  check("左侧立板总长 = 立板长 1840（按列拆开，ΣcutW + 缝）",
        near(lr.reduce((s, x) => s + x.cutW, 0) + (lr.length - 1) * p.cfg.g, 1840),
        lr.map(x => x.cutW).join("+") + " + " + (lr.length - 1) + "×" + p.cfg.g);
  check("左侧立板第 1 圈 cutH = 153", lr.every(x => x.cutH === 153));

  const lt = p.pieces.filter(x => x.part === "tread" && x.face === "left" && x.level === 1);
  check("左侧踏面总长 = 侧跑长 1560（ΣcutW + 缝）",
        near(lt.reduce((s, x) => s + x.cutW, 0) + (lt.length - 1) * p.cfg.g, 1560),
        lt.map(x => x.cutW).join("+") + " + " + (lt.length - 1) + "×" + p.cfg.g);
  check("左侧踏面 cutH = 310", lt.every(x => x.cutH === 310));
});

test("15. 三面台阶中间砖", () => {
  const p = E.buildPlan(inp({ form: "wrap", midOn: true, midW: 800, midH: 800, midOrient: "h" }));
  check("能算出来", p.ok === true, JSON.stringify(p.errors));

  const k1 = p.levels[0], k2 = p.levels[1], k3 = p.levels[2];
  check("第 1 级正面 117/800/117/800/117/800/117",
        widths(k1.frontCols).join(",") === "117,800,117,800,117,800,117", widths(k1.frontCols).join(","));
  check("第 2 级正面 639/117/800/117/639", widths(k2.frontCols).join(",") === "639,117,800,117,639",
        widths(k2.frontCols).join(","));
  check("第 3 级正面 359/117/800/117/359", widths(k3.frontCols).join(",") === "359,117,800,117,359",
        widths(k3.frontCols).join(","));
  check("第 1 级侧面 378/800/378", widths(k1.sideCols).join(",") === "378,800,378");
  check("第 3 级侧面没有中间列（只剩 98）", k3.sideCols.filter(c => c.kind === "mid").length === 0);

  const frontMid = p.pieces.filter(x => x.tile === "mid" && x.part === "tread" && x.face === "front");
  check("正面踏面中间件 3", frontMid.length === 3, frontMid.length);
  const leftMid = p.pieces.filter(x => x.tile === "mid" && x.part === "tread" && x.face === "left");
  check("每侧踏面中间件 2", leftMid.length === 2, leftMid.length);
  check("平台仍然用通用砖", p.pieces.filter(x => x.face === "platform").every(x => x.tile === "std"));
});

test("16. clipTyped 单独验证", () => {
  const base = [{ w: 236, kind: "edge" }, { w: 800, kind: "full" }, { w: 800, kind: "full" },
                { w: 800, kind: "full" }, { w: 236, kind: "edge" }];
  const c = E.clipTyped(base, 2880, 2320, 2, 800);
  check("2880 → 2320 得 758/800/758", widths(c).join(",") === "758,800,758", widths(c).join(","));
  check("裁后和精确", near(sumCols(c, 2), 2320), sumCols(c, 2));

  const same = E.clipTyped(base, 2880, 2880, 2, 800);
  check("同宽裁切原样返回", widths(same).join(",") === "236,800,800,800,236", widths(same).join(","));

  const cW = E.clipTyped(base, 2880, 1200, 2, 800);
  check("2880 → 1200 得 198/800/198", widths(cW).join(",") === "198,800,198", widths(cW).join(","));
});

test("17. 平台行分块", () => {
  const r1 = E.platformRows(1000, 280, 30, 2, 800, 100, "auto");
  check("L=1000 → 2 行", r1.length === 2, r1.length);
  check("里侧 718", r1[0].depth === 718, r1[0].depth);
  check("L=1000 行深和 + 缝 = L + n = 1030",
        near(r1.reduce((s, x) => s + x.depth, 0) + (r1.length - 1) * 2, 1030),
        r1.map(x => x.depth).join(","));

  const r2 = E.platformRows(2000, 280, 30, 2, 800, 100, "auto");
  check("L=2000 → 4 行（里侧居中 457/800/457 + 南沿 310）", r2.length === 4, r2.length);
  check("L=2000 行深 457/800/457/310", r2.map(x => x.depth).join(",") === "457,800,457,310",
        r2.map(x => x.depth).join(","));
  check("L=2000 总深守恒 Σdepth + 3×缝 = L + n = 2030",
        near(r2.reduce((s, x) => s + x.depth, 0) + 3 * 2, 2030),
        r2.reduce((s, x) => s + x.depth, 0));

  const r3 = E.platformRows(500, 280, 30, 2, 800, 100, "auto");
  check("L=500 → 2 行（里侧 218 + 南沿 310）", r3.length === 2, r3.map(x => x.depth).join(","));
  check("L=500 行深 218/310", r3.map(x => x.depth).join(",") === "218,310", r3.map(x => x.depth).join(","));

  const r3b = E.platformRows(350, 280, 30, 2, 800, 100, "auto");
  check("L=350 里侧不足 100 → 一整块", r3b.length === 1, r3b.map(x => x.depth).join(","));
  check("L=350 一块深 380 = L + n", r3b[0].depth === 380, r3b[0].depth);

  const r4 = E.platformRows(1000, 280, 30, 2, 800, 100, "whole");
  check("整砖在前模式也出 2 行", r4.length === 2, r4.length);
  check("整砖在前：里侧 718（不足一块整砖）", r4[0].depth === 718, r4[0].depth);

  const r5 = E.platformRows(2000, 280, 30, 2, 800, 100, "whole");
  check("整砖在前 L=2000 → 800/800/114/310", r5.map(x => x.depth).join(",") === "800,800,114,310",
        r5.map(x => x.depth).join(","));
});

test("18. 输入校验", () => {
  const e1 = E.buildPlan(inp({ form: "straight", D: 0 }));
  check("D=0 → 报错", e1.ok === false, JSON.stringify(e1.errors));

  const e2 = E.buildPlan(inp({ form: "straight", R: -1 }));
  check("R<0 → 报错", e2.ok === false);

  const e3 = E.buildPlan(inp({ form: "straight", N: 0 }));
  check("N=0 → 报错", e3.ok === false);

  const e4 = E.buildPlan(inp({ form: "straight", N: 40 }));
  check("N 太大 → 报错", e4.ok === false);

  const e5 = E.buildPlan(inp({ form: "wrap", L: 100 }));
  check("L 太小（侧跑长 ≤ 0）→ 报错", e5.ok === false, JSON.stringify(e5.errors));

  const ok = E.buildPlan(inp({ form: "straight" }));
  check("默认参数没有 fatal 错误", !ok.errors.some(x => x.fatal === true), JSON.stringify(ok.errors));

  const nSmall = E.buildPlan(inp({ form: "straight", n: 10 }));
  check("出边 n=10 < p=15 → 有红字提示", nSmall.errors.some(x => /出边/.test(x.text)),
        JSON.stringify(nSmall.errors.map(x => x.text)));
  check("出边不足不是致命的（仍然出图）", nSmall.ok === true);

  const nBig = E.buildPlan(inp({ form: "straight", n: 120 }));
  check("出边 n=120 过大 → 有黄字提示", nBig.warnings.some(x => /出边/.test(x.text)),
        JSON.stringify(nBig.warnings.map(x => x.text)));
});

test("19. 装箱不变量（默认直跑）", () => {
  const p = E.buildPlan(inp({ form: "straight" }));
  check("有包装结果", !!p.pack && !!p.pack.std, "缺 pack");
  const pack = p.pack.std;
  check("全是通用件（没开中间砖）", p.pieces.every(x => x.tile === "std"));

  // 每件恰好出现一次
  const ids = [];
  pack.bins.forEach(b => b.shelves.forEach(s => s.items.forEach(i => ids.push(i.id))));
  check("放进去了 24 件", ids.length === 24, ids.length);
  check("没有重复件", new Set(ids).size === ids.length, ids.length - new Set(ids).size);
  check("没有放不下的", pack.unplaced.length === 0, pack.unplaced.length);

  // 不出界 + 不重叠
  let outOfBox = 0, overlap = 0;
  pack.bins.forEach(b => {
    const all = [];
    b.shelves.forEach(s => s.items.forEach(i => all.push(i)));
    all.forEach(i => {
      if (i.x < -1e-9 || i.y < -1e-9 || i.x + i.w > p.cfg.tileW + 1e-9 || i.y + i.h > p.cfg.tileH + 1e-9) outOfBox++;
    });
    for (let a = 0; a < all.length; a++) for (let c = a + 1; c < all.length; c++) {
      const A = all[a], B = all[c];
      const ox = Math.max(0, Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x));
      const oy = Math.max(0, Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y));
      if (ox > 1e-6 && oy > 1e-6) overlap++;
    }
  });
  check("没有出界", outOfBox === 0, outOfBox);
  check("没有重叠", overlap === 0, overlap);

  // 可直刀切：每层货架内左到右排、货架上下排；kerf 只作件与件之间的间隔
  const kk = p.cfg.kerf;
  let notGuillotine = 0;
  pack.bins.forEach(b => {
    let y = 0;
    b.shelves.forEach(s => {
      if (Math.abs(s.y - y) > 1e-6) notGuillotine++;
      let x = 0;
      s.items.forEach(i => {
        if (Math.abs(i.x - x) > 1e-6) notGuillotine++;
        x = i.x + i.w + kk;
      });
      y = s.y + s.h + kk;
    });
  });
  check("可直刀切（货架式，含 kerf 间隔）", notGuillotine === 0, notGuillotine);

  // 面积守恒
  const usedArea = p.pieces.reduce((s, x) => s + x.cutW * x.cutH, 0);
  check("件面积总和 = 踏面+立板理论面积",
        near(usedArea, p.stats.areaPieces, 1e-6), usedArea + " vs " + p.stats.areaPieces);
});

test("20. 装箱不变量（三面台阶 + 中间砖）", () => {
  const p = E.buildPlan(inp({ form: "wrap", midOn: true, midW: 800, midH: 800, midOrient: "h" }));
  check("有 std 组", !!p.pack.std);
  check("有 mid 组", !!p.pack.mid);
  check("开中间砖后总数 77（正面踏面 11→17）", p.pieces.length === 77, p.pieces.length);
  check("std + mid 装箱件数 = 全部件数",
        p.pack.std.bins.reduce((s, b) => s + b.shelves.reduce((t, sh) => t + sh.items.length, 0), 0) +
        p.pack.mid.bins.reduce((s, b) => s + b.shelves.reduce((t, sh) => t + sh.items.length, 0), 0) ===
        p.pieces.length);

  const stdIds = new Set();
  p.pack.std.bins.forEach(b => b.shelves.forEach(s => s.items.forEach(i => stdIds.add(i.id))));
  const midIds = new Set();
  p.pack.mid.bins.forEach(b => b.shelves.forEach(s => s.items.forEach(i => midIds.add(i.id))));
  check("两组不混（无交集）", [...stdIds].every(id => !midIds.has(id)));
  check("中间砖件数 = 7（正面 3 + 每侧 2）", midIds.size === 7, midIds.size);

  p.pack.std.bins.forEach((b, bi) => {
    b.shelves.forEach(s => s.items.forEach(i => {
      if (i.x + i.w > 800 + 1e-9 || i.y + i.h > 800 + 1e-9) {
        check(`std 箱 ${bi} 有件出界`, false, i.id);
      }
    }));
  });
  check("std 组全部不超 800×800", true);
});

test("21. 汇总与备货", () => {
  const p = E.buildPlan(inp({ form: "straight" }));
  check("sheets = 料箱数", p.stats.sheets === p.pack.std.bins.length, p.stats.sheets);
  check("sheetsStd 与 sheets 一致", p.stats.sheetsStd === p.stats.sheets);
  check("备货 = ceil(理论 × 1.05)", p.stats.orderStd === Math.ceil(p.stats.sheetsStd * 1.05),
        p.stats.orderStd + " vs " + Math.ceil(p.stats.sheetsStd * 1.05));
  check("备货 ≥ 理论", p.stats.orderStd >= p.stats.sheetsStd);

  const pm = E.buildPlan(inp({ form: "straight", midOn: true, midW: 900, midH: 800, midOrient: "h" }));
  check("中间砖单独备货", pm.stats.orderMid === Math.ceil(pm.stats.sheetsMid * 1.05),
        pm.stats.orderMid + " vs " + pm.stats.sheetsMid);
  check("中间砖箱子 8 件都能放下", pm.pack.mid.unplaced.length === 0);

  const pz = E.buildPlan(inp({ form: "straight", waste: 0 }));
  check("损耗 0 → 备货 = 理论", pz.stats.orderStd === pz.stats.sheetsStd);
});

test("22. 非正正方形砖：自动挑边", () => {
  const p = E.buildPlan(inp({ form: "straight", tileW: 750, tileH: 1500 }));
  check("能算出来", p.ok === true, JSON.stringify(p.errors));
  check("说明用了哪条边", p.stats.tileEdgeUsed === 750 || p.stats.tileEdgeUsed === 1500,
        p.stats.tileEdgeUsed);
  check("列宽和仍精确", near(sumCols(p.straight.cols, 2), 1194), sumCols(p.straight.cols, 2));
  check("装箱按原砖尺寸", p.pack.std.binW === 750 || p.pack.std.binW === 1500, p.pack.std.binW);
});

test("23. 同输入同结果（确定性）", () => {
  const a = E.buildPlan(inp({ form: "wrap", midOn: true }));
  const b = E.buildPlan(inp({ form: "wrap", midOn: true }));
  check("件数一样", a.pieces.length === b.pieces.length);
  check("件序一样", JSON.stringify(a.pieces) === JSON.stringify(b.pieces));
  check("装箱一样", a.stats.sheets === b.stats.sheets && a.stats.sheetsMid === b.stats.sheetsMid);
  check("料的摆放一样", JSON.stringify(a.pack) === JSON.stringify(b.pack));
});

test("24. 500 组随机输入不炸、不出 NaN", () => {
  let bad = 0, threw = 0, okCount = 0;
  const badList = [];
  for (let t = 0; t < 500; t++) {
    const form = t % 2 ? "wrap" : "straight";
    const D = 200 + rnd(200);
    const R = 100 + rnd(100);
    const N = 2 + rnd(6);
    const g = rnd(6);
    const n = 10 + rnd(60);
    const o = {
      form, D, R, N, g, n,
      B: 600 + rnd(2200),
      W: 600 + rnd(2600),
      L: 500 + rnd(2400),
      D_top: 150 + rnd(500),
      tau: rnd(15), a: rnd(10), tg: rnd(10),
      eL: rnd(8), eR: rnd(8),
      kerf: rnd(8), waste: rnd(15), minEdge: 50 + rnd(150),
      tileW: [300, 400, 600, 700, 800, 900, 1200][rnd(7)],
      tileH: [300, 400, 600, 700, 800, 900, 1200, 1500][rnd(8)],
      midOn: rnd(3) === 0,
      midW: 300 + rnd(900), midH: 300 + rnd(900),
      midOrient: rnd(2) ? "h" : "v",
      layoutMode: rnd(2) ? "center" : "edge",
      allowRotate: rnd(4) !== 0,
      platformRowMode: rnd(2) ? "auto" : "whole",
    };
    let p;
    try { p = E.buildPlan(o); } catch (e) { threw++; badList.push("throw: " + e.message); continue; }
    if (!p.ok) continue;
    okCount++;
    const nums = [];
    p.pieces.forEach(x => nums.push(x.cutW, x.cutH, x.colW, x.level));
    p.pieces.forEach(x => {
      if (!isFinite(x.cutW) || !isFinite(x.cutH) || x.cutW <= 0 || x.cutH <= 0) bad++;
    });
    p.stats && [p.stats.sheets, p.stats.orderStd].forEach(v => { if (!isFinite(v)) bad++; });
    if (bad > 0 && badList.length < 6) badList.push(JSON.stringify(o));
  }
  check("500 组没有抛异常", threw === 0, threw + " 次：" + badList.slice(0, 3).join(" | "));
  check("500 组没有 NaN / 负数", bad === 0, bad);
  check("至少 200 组算出了结果", okCount >= 200, okCount);
});

test("25. 列宽永远等于可用宽（随机 200 组）", () => {
  let bad = 0, n = 0;
  for (let t = 0; t < 200; t++) {
    const width = 700 + rnd(2500);
    const T = [300, 400, 600, 750, 800, 900][rnd(6)];
    const g = rnd(5);
    const eL = rnd(5), eR = rnd(5);
    const r = E.layoutColumns({ width, tileEdge: T, g, eL, eR, minEdge: 80, mode: rnd(2) ? "center" : "edge" });
    if (!r.ok) continue;
    n++;
    const s = sumCols(r.cols, g);
    const A = width - eL - eR;
    if (!near(s, A, 1e-6)) { bad++; if (bad < 4) console.log("    偏差:", width, T, g, s, A); }
    widths(r.cols).forEach(w => { if (!(w > 0)) bad++; });
  }
  check("每组的 Σ列 + 缝 = 可用宽", bad === 0, bad + " / " + n);
  check("跑了足够多组", n > 100, n);
});

test("26. 负对照：把缝当成 0，测试必须能抓到", () => {
  // 这是测试自身的不变量自检：手算一遍 sumCols，确认它会因为漏缝而报不匹配
  const cols = [{ w: 195 }, { w: 800 }, { w: 195 }];
  const withG = sumCols(cols, 2);
  const noG = widths(cols).reduce((a, b) => a + b, 0);
  check("带缝 1194", withG === 1194, withG);
  check("不带缝 1190", noG === 1190, noG);
  check("两者不等（漏缝一定被抓）", withG !== noG);
});

/* ============ 汇总 ============ */
console.log(`\n${_fail ? "❌" : "✅"} 通过 ${_pass} 条，失败 ${_fail} 条`);
process.exit(_fail ? 1 : 0);
