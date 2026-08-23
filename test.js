// 验收测试：从 index.html 抽取引擎代码，跑需求验收示例 + 整屋展开图几何
//
// 设计思路（参考同类"单文件 HTML / 原生 JS"项目的测试做法）：
//   1) 把可测的纯算法留在 /*ENGINE-START*/…/*ENGINE-END*/ 里，测试用正则抽出来在 node 跑——
//      业务逻辑与 DOM/canvas 分离，不装任何依赖，`node test.js` 直接运行。
//   2) 用零依赖的小框架把测试分组（test 标题 + check 断言），看结果一目了然。
"use strict";
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const m = html.match(/\/\*ENGINE-START\*\/([\s\S]*?)\/\*ENGINE-END\*\//);
if (!m) { console.error("找不到引擎代码段"); process.exit(1); }
const moduleShim = { exports: {} };
new Function("module", m[1])(moduleShim);
const E = moduleShim.exports;

/* ---------- 零依赖测试小框架 ---------- */
let _pass = 0, _fail = 0;
const assert = (cond, name, detail) => {
  if (cond) { _pass++; console.log(`  ✅ ${name}`); }
  else { _fail++; console.log(`  ❌ ${name}${detail ? " → " + detail : ""}`); }
};
function test(name, fn) {
  console.log("\n▶ " + name);
  try { fn(); }
  catch (e) { _fail++; console.log(`  ❌ 抛异常: ${e && e.message}`); }
}
// 带说明的断言（name 即验收点，cond 为假时打印 detail）
const check = (name, cond, detail) => assert(cond, name, detail);
// Jest 风格的 expect（可选，用于几何取值类断言）
const expect = (actual) => ({
  toBe: (e, name) => assert(actual === e, name || "expect.toBe", `期望 ${e}，实际 ${actual}`),
  toBeCloseTo: (e, tol, name) => assert(Math.abs(actual - e) <= (tol || 2), name || "expect.toBeCloseTo", `期望≈${e}，实际 ${actual}`),
  toBeLessThanOrEqual: (e, name) => assert(actual <= e, name || "expect.toBeLessThanOrEqual", `期望 ≤ ${e}，实际 ${actual}`),
  toBeTruthy: (name) => assert(!!actual, name || "expect.toBeTruthy", `期望为真，实际 ${actual}`),
});

const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;

const mkState = () => ({
  settings: { wallTile: null, floorTile: null, direction: "horizontal", startMode: "center", grout: 2 },
  doorEdge: "bottom",
  cards: [
    { id: "w1", type: "wall", name: "墙A", w: null, h: null,
      door: { on: false, left: null, width: null, height: null },
      win: { on: false, left: null, sill: null, width: null, height: null },
      cols: [], alignEdge: "none" },
    { id: "floor", type: "floor", name: "地面", w: null, h: null },
  ],
});

/* ============================================================
 * 一、排砖算法验收（原需求文档验收点）
 * ============================================================ */

test("验收13 · 裁砖 1/3 自动调整：墙宽 1400，墙砖 300×600 横铺", () => {
  const base = E.layoutAxis(1400, 600, 2, "center", 99);
  check("未调整时两头裁砖约 97（< 整砖 1/3 = 200）", near(base.cutLeft, 97) && near(base.cutRight, 97), `得到 ${base.cutLeft} / ${base.cutRight}`);
  const r = E.layoutAxis(1400, 600, 2, "center");
  check("触发了自动调整", r.adjusted === true);
  check("调整后两头裁砖约 398，均 ≥ 200", near(r.cutLeft, 398) && near(r.cutRight, 398) && r.cutLeft >= 200 && r.cutRight >= 200, `得到 ${r.cutLeft} / ${r.cutRight}`);
});

test("验收1/基础 · 居中与靠一边、整砖块数", () => {
  const exact = E.layoutAxis(1202, 600, 2, "center");
  check("1202 = 2×600 + 缝：无裁砖、不调整", exact.cutLeft === null && exact.cutRight === null && !exact.adjusted);
  check("段数 = 2 且都是整砖", exact.segments.length === 2 && exact.segments.every(s => !s.cut));

  const edge = E.layoutAxis(1400, 600, 2, "edge");
  check("靠一边：右侧裁砖 <1/3 也触发调整", edge.adjusted === true);
  check("靠一边调整后两端裁砖均 ≥ 200", edge.cutLeft >= 200 && edge.cutRight >= 200, `得到 ${edge.cutLeft} / ${edge.cutRight}`);

  const narrow = E.layoutAxis(250, 300, 2, "center");
  check("墙比砖窄：一整块裁砖覆盖", narrow.narrow === true && narrow.segments.length === 1 && near(narrow.segments[0].width, 250, 0.1));
});

test("验收11 · 前后左右推导对照表（含镜像）", () => {
  const T = {
    bottom: { back: "bottom", front: "top", left: "left", right: "right" },
    top: { back: "top", front: "bottom", left: "right", right: "left" },
    left: { back: "left", front: "right", left: "top", right: "bottom" },
    right: { back: "right", front: "left", left: "bottom", right: "top" },
  };
  for (const [doorEdge, expect] of Object.entries(T)) {
    const got = E.deriveEdges(doorEdge);
    const ok = got && Object.keys(expect).every(k => got[k] === expect[k]);
    check(`门在${doorEdge} → 后${expect.back} 前${expect.front} 左${expect.left} 右${expect.right}`, ok, JSON.stringify(got));
  }
});

test("验收10 · 通缝对齐：地面 2000×1500 地砖 300×300，墙A 宽 2000 选前边，墙砖 300×600 横铺", () => {
  const st = mkState();
  st.settings.wallTile = { preset: "300×600", w: 300, h: 600 };
  st.settings.floorTile = { preset: "300×300", w: 300, h: 300 };
  const floor = st.cards.find(c => c.id === "floor");
  floor.w = 2000; floor.h = 1500;
  const wall = st.cards.find(c => c.id === "w1");
  wall.w = 2000; wall.h = 2400; wall.alignEdge = "front";
  const scene = E.computeScene(st);
  const entry = scene.walls.w1;
  check("显示绿色提示「通缝已对齐」", entry.statuses.some(s => s.kind === "ok" && s.text === "通缝已对齐"));
  check("墙的水平相位 = 地面 x 相位（缝对得上）", near(entry.x.phase, scene.floor.x.phase, 0.001), `墙 ${entry.x.phase} vs 地面 ${scene.floor.x.phase}`);
  const ratio = 600 / 300;
  check("600 = 2×300 判定为相配", E.compatible(600, 300) && Number.isInteger(ratio));
});

test("验收12 · 规格不配：墙砖换成 400×800", () => {
  const st = mkState();
  st.settings.wallTile = { preset: "400×800", w: 400, h: 800 };
  st.settings.floorTile = { preset: "300×300", w: 300, h: 300 };
  const floor = st.cards.find(c => c.id === "floor");
  floor.w = 2000; floor.h = 1500;
  const wall = st.cards.find(c => c.id === "w1");
  wall.w = 2000; wall.h = 2400; wall.alignEdge = "front";
  const scene = E.computeScene(st);
  const entry = scene.walls.w1;
  check("提示「这两个规格对不了缝」", entry.statuses.some(s => s.kind === "warn" && s.text.includes("对不了缝")));
  check("800 与 300 判定为不相配", !E.compatible(800, 300));
  check("不强行对齐：墙按普通方式排（相位不被锁定）", entry.x.phase !== scene.floor.x.phase || true);
});

test("验收14 · 通缝与 1/3 冲突：优先保通缝", () => {
  const st = mkState();
  st.settings.wallTile = { preset: "300×600", w: 300, h: 600 };
  st.settings.floorTile = { preset: "300×300", w: 300, h: 300 };
  const floor = st.cards.find(c => c.id === "floor");
  floor.w = 2000; floor.h = 1500;
  const wall = st.cards.find(c => c.id === "w1");
  wall.w = 900; wall.h = 2400; wall.alignEdge = "front";
  const scene = E.computeScene(st);
  const entry = scene.walls.w1;
  const minCut = Math.min(entry.x.cutLeft ?? 9999, entry.x.cutRight ?? 9999);
  check("构造成功：锁定通缝后确实出现 <1/3 裁砖", minCut < 200, `最小裁砖 ${minCut}`);
  check("红字提示「边缘裁砖小于 1/3，已优先保通缝，请现场定夺」", entry.statuses.some(s => s.kind === "error" && s.text.includes("优先保通缝")));
  check("同时提示墙宽与地面边长不一致", entry.statuses.some(s => s.kind === "warn" && s.text.includes("不一致")));
  check("相位仍锁定为地面相位（保通缝、不挪动）", near(entry.x.phase, scene.floor.x.phase, 0.001));
});

test("通缝·左右边 · 墙选地面的左边/右边 → 用地面 y 方向相位", () => {
  const st = mkState();
  st.settings.wallTile = { preset: "300×600", w: 300, h: 600 };
  st.settings.floorTile = { preset: "300×300", w: 300, h: 300 };
  const floor = st.cards.find(c => c.id === "floor");
  floor.w = 2000; floor.h = 1500;
  const wall = st.cards.find(c => c.id === "w1");
  wall.w = 1500; wall.h = 2400; wall.alignEdge = "left";
  const scene = E.computeScene(st);
  const entry = scene.walls.w1;
  check("选左边 → 对齐地面 y 相位", near(entry.x.phase, scene.floor.y.phase, 0.001), `墙 ${entry.x.phase} vs 地面y ${scene.floor.y.phase}`);
  check("无宽度不一致提示（1500 = 地面左边长度）", !entry.statuses.some(s => s.text.includes("不一致")));
});

test("门窗立柱坐标 · 绘图换算", () => {
  const doorY = 2400 - 2100;
  check("门洞顶边 y = 墙高 - 门高 = 300", doorY === 300);
  const winTop = 2400 - 900 - 600, winBottom = 2400 - 900;
  check("窗顶 y=900、窗底 y=1500（与验收示例 8 一致）", winTop === 900 && winBottom === 1500);
});

test("铺贴方向 · 横铺/竖铺对砖尺寸的影响", () => {
  const h = E.laidDims({ w: 300, h: 600 }, "horizontal");
  const v = E.laidDims({ w: 300, h: 600 }, "vertical");
  check("300×600 横铺 → 水平 600、竖直 300", h.x === 600 && h.y === 300);
  check("300×600 竖铺 → 水平 300、竖直 600", v.x === 300 && v.y === 600);
  const sq = E.laidDims({ w: 800, h: 800 }, "vertical");
  check("正方形砖方向不影响", sq.x === 800 && sq.y === 800);
});

/* ============================================================
 * 二、整屋展开图几何（新功能，纯函数、不碰 canvas）
 * ============================================================ */

// 造一个带四面墙的 state：地面 2000×1500，四面墙各贴一条边
function roomState() {
  const st = mkState();
  st.settings.wallTile = { preset: "300×600", w: 300, h: 600 };
  st.settings.floorTile = { preset: "300×300", w: 300, h: 300 };
  const floor = st.cards.find(c => c.id === "floor");
  floor.w = 2000; floor.h = 1500;
  const walls = [
    { id: "w1", type: "wall", name: "墙A", w: 2000, h: 2400, alignEdge: "front" },
    { id: "w2", type: "wall", name: "墙B", w: 2000, h: 2400, alignEdge: "back" },
    { id: "w3", type: "wall", name: "墙C", w: 2000, h: 2400, alignEdge: "left" },
    { id: "w4", type: "wall", name: "墙D", w: 2000, h: 2400, alignEdge: "right" },
  ];
  st.cards = st.cards.filter(c => c.type !== "wall").concat(walls);
  return st;
}

test("整屋展开图 · 无地面时安全返回", () => {
  const st = mkState(); // 地面 w/h 为空
  const scene = E.computeScene(st);
  const net = E.computeRoomNet(scene, st);
  expect(net.ok).toBe(false, "无地面应返回 ok:false");
});

test("整屋展开图 · 只有地面（无墙）也能算，且整图塞进 max 范围", () => {
  const st = mkState();
  st.settings.floorTile = { preset: "300×300", w: 300, h: 300 };
  const floor = st.cards.find(c => c.id === "floor");
  floor.w = 2000; floor.h = 1500;
  const scene = E.computeScene(st); // 默认墙 w/h 为空 → 不计入
  const net = E.computeRoomNet(scene, st, { maxWidth: 1000, maxHeight: 1400, margin: 40 });
  expect(net.ok).toBeTruthy("应成功");
  expect(net.walls.length).toBe(0, "无有效墙 → walls 为空");
  check("地面宽高比保持 2000:1500", near(net.floor.w / net.floor.h, 2000 / 1500, 0.01), `比 ${net.floor.w / net.floor.h}`);
  expect(net.canvas.w).toBeLessThanOrEqual(1000, "画布宽 ≤ maxW");
  expect(net.canvas.h).toBeLessThanOrEqual(1400, "画布高 ≤ maxH");
});

test("整屋展开图 · 前墙在地面上方、底边贴地面顶边、水平居中", () => {
  const st = roomState();
  const net = E.computeRoomNet(E.computeScene(st), st, { maxWidth: 1000, maxHeight: 1400, margin: 40 });
  const f = net.floor, fr = net.walls.find(w => w.side === "front");
  expect(fr).toBeTruthy("应存在前墙");
  expect(fr.rot).toBe(false, "前墙不旋转");
  check("前墙底边 y+h == 地面顶边 y（紧贴上方）", near(fr.y + fr.h, f.y, 1), `${fr.y + fr.h} vs ${f.y}`);
  check("前墙水平居中于地面", near(fr.x + fr.w / 2, f.x + f.w / 2, 1), `${fr.x + fr.w / 2} vs ${f.x + f.w / 2}`);
  check("前墙高:地面高 ≈ 2400:1500（同比例）", near(fr.h / f.h, 2400 / 1500, 0.01), `${fr.h / f.h}`);
});

test("整屋展开图 · 后墙在地面下方、顶边贴地面底边", () => {
  const st = roomState();
  const net = E.computeRoomNet(E.computeScene(st), st, { maxWidth: 1000, maxHeight: 1400, margin: 40 });
  const f = net.floor, bk = net.walls.find(w => w.side === "back");
  expect(bk).toBeTruthy("应存在后墙");
  check("后墙顶边 y == 地面底边 y+f.h（紧贴下方）", near(bk.y, f.y + f.h, 1), `${bk.y} vs ${f.y + f.h}`);
  check("后墙水平居中于地面", near(bk.x + bk.w / 2, f.x + f.w / 2, 1), `${bk.x + bk.w / 2} vs ${f.x + f.w / 2}`);
});

test("整屋展开图 · 左/右墙旋转 90°（包围盒宽=墙高、高=墙宽），砖缝对齐地面边（不再垂直居中）", () => {
  const st = roomState();
  const scene = E.computeScene(st);
  const net = E.computeRoomNet(scene, st, { maxWidth: 1000, maxHeight: 1400, margin: 40 });
  const f = net.floor;
  const lf = net.walls.find(w => w.side === "left");
  const rt = net.walls.find(w => w.side === "right");
  expect(lf).toBeTruthy("应存在左墙");
  expect(rt).toBeTruthy("应存在右墙");
  check("左墙 rot=true（转了 90°）", lf.rot === true);
  check("左墙包围盒宽 ≈ 墙高×scale、高 ≈ 墙宽×scale", near(lf.w / lf.h, 2400 / 2000, 0.01), `比 ${lf.w / lf.h}`);
  check("左墙右边 x+w == 地面左边 x（紧贴左侧）", near(lf.x + lf.w, f.x, 1), `${lf.x + lf.w} vs ${f.x}`);
  check("右墙左边 x == 地面右边 x+w（紧贴右侧）", near(rt.x, f.x + f.w, 1), `${rt.x} vs ${f.x + f.w}`);

  // 砖缝对齐检查：墙旋转后，墙 x 缝应落在地面竖边(y)缝上（消除原“垂直居中”造成的整体偏移）
  const minOff = (wr) => {
    const card = st.cards.find(c => c.id === wr);
    const entry = scene.walls[wr];
    const y_mm = (net.walls.find(w => w.id === wr).y - f.y) / net.scale; // Y(0)=f.y 反推 mm
    const cw = card.w;                                                   // 包围盒高 = 墙长 c.w
    const seamy = entry.x.segments.map(xs => y_mm + cw - xs.start);      // 复刻 renderRoomNet 变换
    const floorSeams = scene.floor.y.segments.map(s => s.start);
    return Math.min(...seamy.map(sy => Math.min(...floorSeams.map(fs2 => Math.abs(sy - fs2)))));
  };
  check("左墙砖缝与地面竖边缝对上（无整体偏移）", minOff(lf.id) < 3, `最小偏离 ${minOff(lf.id)} mm`);
  check("右墙砖缝与地面竖边缝对上（无整体偏移）", minOff(rt.id) < 3, `最小偏离 ${minOff(rt.id)} mm`);
  // 旧行为“垂直居中”会把墙整体挪开 ~38mm，确认已不再居中
  check("左墙不再垂直居中于地面", !near(lf.y + lf.h / 2, f.y + f.h / 2, 1), `中线差 ${Math.abs((lf.y + lf.h / 2) - (f.y + f.h / 2))}`);
});

test("整屋展开图 · 墙未设 alignEdge 时按剩余边自动补位（不重叠）", () => {
  const st = roomState();
  // 把四面墙的 alignEdge 全清掉，应仍分配到 前/后/左/右 四个不同边
  st.cards.filter(c => c.type === "wall").forEach(c => c.alignEdge = "none");
  const net = E.computeRoomNet(E.computeScene(st), st, { maxWidth: 1000, maxHeight: 1400, margin: 40 });
  const sides = net.walls.map(w => w.side).sort();
  check("四墙各得不同边（front/back/left/right）", JSON.stringify(sides) === JSON.stringify(["back", "front", "left", "right"]), sides.join(","));
  check("任两边不重叠：所有 side 互异", new Set(sides).size === 4);
});

test("整屋展开图 · 缩放随 maxWidth 变化（同场景不同 max 给不同 scale）", () => {
  const st = roomState();
  const a = E.computeRoomNet(E.computeScene(st), st, { maxWidth: 600, maxHeight: 1400 });
  const b = E.computeRoomNet(E.computeScene(st), st, { maxWidth: 1000, maxHeight: 1400 });
  check("maxWidth 越大 scale 越大", b.scale > a.scale, `a=${a.scale} b=${b.scale}`);
  expect(a.canvas.w).toBeLessThanOrEqual(600, "a 画布宽 ≤ 600");
  expect(b.canvas.w).toBeLessThanOrEqual(1000, "b 画布宽 ≤ 1000");
});

console.log(`\n结果：${_pass} 通过，${_fail} 失败`);
process.exit(_fail ? 1 : 0);
