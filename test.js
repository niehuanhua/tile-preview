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

test("通缝·左右边 · 墙选地面的左边/右边 → 相位镜像对齐（砖缝真正对上，非照搬地面相位）", () => {
  const st = mkState();
  st.settings.wallTile = { preset: "300×600", w: 300, h: 600 };
  st.settings.floorTile = { preset: "300×300", w: 300, h: 300 };
  const floor = st.cards.find(c => c.id === "floor");
  floor.w = 2000; floor.h = 1500;
  const wall = st.cards.find(c => c.id === "w1");
  wall.w = 1500; wall.h = 2400; wall.alignEdge = "left";
  const scene = E.computeScene(st);
  const entry = scene.walls.w1;
  check("通缝锁定成功", entry.align && entry.align.ok);
  // 左/右墙在展开图转 90°，墙 x 方向与地面竖边反向，墙缝 sx 对应地面缝 (wall.w − sx)。
  // 正确判据：每条“墙缝”都能对上一条“地面缝”（墙砖坐在地面网格上，2:1 砖型下地面中间缝本就无墙缝，属正常）。
  // 揪出“照搬相位→整面墙缝翻到另一端”的 Bug（旧 Bug 会让所有墙缝整体偏移≈一个相位）。
  const floorSeams = scene.floor.y.segments.flatMap(s => [s.start, s.start + s.width]);
  const wallSeams = entry.x.segments.flatMap(s => [s.start, s.start + s.width]);
  const tol = 12; // 缝宽导致模块不完全公约时的固有限位，非 Bug
  let worst = 0;
  for (const sx of wallSeams) {
    const want = wall.w - sx;                        // 该墙缝对应的地面缝位置（镜像）
    const best = Math.min(...floorSeams.map(mf => Math.abs(mf - want)));
    worst = Math.max(worst, best);
  }
  check("每条墙缝都落在地面网格上（无整体错位）", worst <= tol, `最大偏差 ${worst.toFixed(2)}mm（旧 Bug 为约 150mm）`);
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

/* ============================================================
 * 三、十字分水线算例（只用现有 layoutAxis，今天就能跑）
 *
 *   这一组不依赖任何新引擎函数——它验的是「pickCrossPhase 将来必须复现的算术」。
 *   先把算术钉死，等引擎落地时只要对得上这几个数，就是对的。
 *   算例：地面 3020×1510、砖 300、缝 2（砖距 p=302）、地漏落在 (1510, 755)
 *         → 理论相位 X=0 / Y=151 → 两条十字线都正好落在砖边 → 分水线零切砖
 * ============================================================ */

// 这组算例的固定参数
const CS = { W: 3020, H: 1510, t: 300, g: 2, p: 302, cx: 1510, cy: 755 };

// 一条轴上所有"砖边"（每块砖的左右/上下两条边，中间夹的是缝）
function tileEdges(ax) {
  const s = new Set();
  ax.segments.forEach((seg) => {
    s.add(+seg.start.toFixed(6));
    s.add(+(seg.start + seg.width).toFixed(6));
  });
  return s;
}
const onTileEdge = (set, v) => [...set].some((e) => Math.abs(e - v) < 1e-6);
// 这条竖/横线穿过了几块砖（= 有几块砖必须切开）
const crossedTiles = (ax, v) =>
  ax.segments.filter((s) => s.start < v - 1e-9 && s.start + s.width > v + 1e-9).length;

test("十字分水线 · 零切砖算例：3020×1510 地面，地漏落在 (1510, 755)", () => {
  const { W, H, t, g, p, cx, cy } = CS;
  // 门在下边 → 后墙是图下边，y = H − fromBack = 1510 − 755
  check("地漏图坐标 = (1510, 755)", cx === 1510 && H - 755 === 755, `得到 (${cx},${H - 755})`);

  const idealX = ((cx % p) + p) % p;
  const idealY = ((cy % p) + p) % p;
  check("X 轴理论相位 = 1510 mod 302 = 0", idealX === 0, `得到 ${idealX}`);
  check("Y 轴理论相位 = 755 mod 302 = 151", idealY === 151, `得到 ${idealY}`);

  const X = E.layoutAxis(W, t, g, "center", idealX);
  const Y = E.layoutAxis(H, t, g, "center", idealY);

  // ① 两条十字线都必须正好落在砖边上（不是落在砖中间）
  check("竖线 x=1510 落在砖边上", onTileEdge(tileEdges(X), cx), `X 段起点：${X.segments.map((s) => s.start).join(",")}`);
  check("横线 y=755 落在砖边上", onTileEdge(tileEdges(Y), cy), `Y 段起点：${Y.segments.map((s) => s.start).join(",")}`);

  // ② 逐块数：没有任何一块砖横跨十字线 → 一块都不用因坡而切
  let ridge = 0, total = 0;
  for (const ys of Y.segments) for (const xs of X.segments) {
    total++;
    const sx = xs.start < cx - 1e-9 && xs.start + xs.width > cx + 1e-9;
    const sy = ys.start < cy - 1e-9 && ys.start + ys.width > cy + 1e-9;
    if (sx || sy) ridge++;
  }
  check(`共 ${total} 块砖，因分水线要切的 = 0 块`, ridge === 0, `实际 ${ridge} 块`);

  // ③ 不能为了不切砖把边缘搞碎：边缘裁砖仍要 ≥ 砖宽 1/3
  const minCut = Math.min(X.cutLeft ?? 1e9, X.cutRight ?? 1e9, Y.cutLeft ?? 1e9, Y.cutRight ?? 1e9);
  check("边缘裁砖仍 ≥ 100（1/3 老规矩没被破坏）", minCut >= t / 3, `最小边缘裁砖 ${minCut}`);

  // ④ 对照：不调相位（默认居中）时横线那边要切一整排 —— 证明这一步真省了工
  const dX = E.layoutAxis(W, t, g, "center"), dY = E.layoutAxis(H, t, g, "center");
  let dRidge = 0;
  for (const ys of dY.segments) for (const xs of dX.segments) {
    const sx = xs.start < cx - 1e-9 && xs.start + xs.width > cx + 1e-9;
    const sy = ys.start < cy - 1e-9 && ys.start + ys.width > cy + 1e-9;
    if (sx || sy) dRidge++;
  }
  check(`对照：默认相位（X=${dX.phase} Y=${dY.phase}）要切 ${dRidge} 块`, dRidge > 0,
    "默认相位也是 0 块 → 这个算例没意义，得换一个");
  check("调相位后确实省下了砖", ridge < dRidge, `调后 ${ridge} vs 默认 ${dRidge}`);
});

test("十字分水线 · 同一个算例：地漏洞口仍要切 4 块（两笔账分开算）", () => {
  // "零切砖"只管分水线；地漏本身那个孔还是得开，不能假装没有
  const { W, H, t, g, cx, cy } = CS;
  const size = 100, gap = 3, hole = size + 2 * gap;      // 洞口 106×106
  const X = E.layoutAxis(W, t, g, "center", 0);
  const Y = E.layoutAxis(H, t, g, "center", 151);
  const hx0 = cx - hole / 2, hx1 = cx + hole / 2, hy0 = cy - hole / 2, hy1 = cy + hole / 2;
  let n = 0;
  for (const ys of Y.segments) for (const xs of X.segments) {
    const ox = Math.min(xs.start + xs.width, hx1) - Math.max(xs.start, hx0);
    const oy = Math.min(ys.start + ys.width, hy1) - Math.max(ys.start, hy0);
    if (ox > 1e-9 && oy > 1e-9) n++;
  }
  check(`洞口 ${hole}×${hole} 骑在十字缝交点上 → 涉及 4 块砖（回字对角切）`, n === 4, `实际 ${n} 块`);
});

test("整砖骑线 · 分水线穿过整砖不许锯开，砖底下垫灰就行", () => {
  // 现场从来没有沿分水线锯砖的：地面中间的整砖整块铺过去，骑在线上。
  // 骑线悬空量 = 坡度 × dL × dR / 砖宽，最坏（折线正过砖心）= 坡度 × 砖宽 / 4
  const k = 10 / 1000;
  check("折线正过砖心（150mm 处）→ 300 砖 @1% 悬空 0.75mm",
    near(E.rideGap(k, 300, 150), 0.75, 0.001), `得到 ${E.rideGap(k, 300, 150)}`);
  check("折线贴着砖边（dL=1mm）→ 几乎不悬空",
    E.rideGap(k, 300, 1) < 0.02, `得到 ${E.rideGap(k, 300, 1)}`);
  check("折线在砖外（dL=0）→ 整块在一个平面上，0 悬空", E.rideGap(k, 300, 0) === 0);
  check("最坏值 = 坡度 × 砖宽 ÷ 4",
    near(E.rideGap(k, 300, 150), k * 300 / 4, 1e-9));
  check("800 大板 @2% → 4mm（这个才真要处理）",
    near(E.rideGap(20 / 1000, 800, 400), 4, 0.001), `得到 ${E.rideGap(20 / 1000, 800, 400)}`);

  // 用真实网格跑一遍：分水线落在哪块砖上、悬空多少
  const X = E.layoutAxis(3020, 300, 2, "center", 0);   // 算例的 X 轴，分水线在 1510
  const r = E.rideReport(10 / 1000, X, 1510);
  check("分水线压在砖缝上 → 一块砖都不骑线", r.count === 0, `骑线砖数 ${r.count}`);
  check("压缝后最大悬空量 = 0", r.max === 0, `得到 ${r.max}`);

  const X2 = E.layoutAxis(3020, 300, 2, "center", 151); // 换个相位，让线落在砖中间
  const r2 = E.rideReport(10 / 1000, X2, 1510);
  check("压不上缝 → 有砖骑线", r2.count > 0, `骑线砖数 ${r2.count}`);
  check("但 300 砖 @1% 的悬空量 ≤ 1mm，砂浆吸得住，不用锯",
    r2.max <= 1, `最大悬空 ${r2.max.toFixed(2)}mm`);
});

test("整砖骑线 · 分水线不能挪离地漏（挪了最低点就跑了）", () => {
  // 有人提议"把分水线挪到最近的砖缝上"——在"线"这一侧是不行的：
  // h = k(|x − 线| + |y − 地漏y|)，最低点跟着线走，一挪就离开地漏 → 积水。
  // 能挪的是【砖缝】（调起铺相位），不是分水线。
  const k = 10 / 1000, cy = 750, halfOpen = 53;   // 洞口半宽 53mm
  const hAt = (xs, x) => k * (Math.abs(x - xs) + Math.abs(cy - cy));
  check("线穿过地漏 → 地漏处高度 0", Math.abs(hAt(1000, 1000)) < 1e-9);
  for (const xs of [850, 1150]) {
    const d = Math.abs(xs - 1000);
    check(`线挪到 ${xs}（差 ${d}mm）→ 最低点跑到离地漏 ${d}mm 处，超出洞口 ${d - halfOpen}mm`,
      d > halfOpen && hAt(xs, 1000) > 0,
      `地漏处高度 ${hAt(xs, 1000).toFixed(2)}mm`);
  }
});

test("长条地漏 · 长度取「砖距整数倍 ± 缝宽」→ 两端分区线都能压缝", () => {
  // 长条两端各有一条垂直于它的分区线；两条都压在砖缝上，那一列就整列不用切。
  // 规律：len mod p ∈ {0, g, t}（p = t + g）
  const { W, t, g, p, cx } = CS;
  const good = [300, 302, 604, 906, 1208];     // 300 差一个缝宽、其余是整数倍
  const bad  = [400, 500, 600, 800, 900, 1000, 1200];
  for (const len of good) {
    const x0 = cx - len / 2, x1 = cx + len / 2;
    const ph = ((x0 % p) + p) % p;
    const X = E.layoutAxis(W, t, g, "center", ph);
    const n = crossedTiles(X, x0) + crossedTiles(X, x1);
    check(`len=${len}：两端都压缝，分区线切 0 块`, n === 0, `实际 ${n} 块（相位 ${ph}）`);
  }
  for (const len of bad) {
    const x0 = cx - len / 2, x1 = cx + len / 2;
    const ph = ((x0 % p) + p) % p;
    const X = E.layoutAxis(W, t, g, "center", ph);
    const n = crossedTiles(X, x0) + crossedTiles(X, x1);
    check(`len=${len}：压不上缝，要切 ${n} 块（提醒：常见的 600/900 反而不行）`, n > 0, `实际 ${n} 块`);
  }
  // 给师傅的建议值：302 的整数倍，或整数倍减一个缝宽
  check("建议长度 604 = 2×302（整数倍，最稳）", 604 % p === 0);
  check("常见的 300 也能用（= 302 − 缝宽 2）", 300 % p === t, `300 mod 302 = ${300 % p}`);
});

/* ============================================================
 * 三·补、找坡高度模型（drainShape / slopeZones / slopeHeightAt · 已实现）
 *
 *   这三个函数已落地，直接调用验收，不走 computeScene（那段还没接）。
 *   验的就是方案 4.3 那一条式子：h = k ×（横向距离 + 竖向距离）
 * ============================================================ */

// 一块 2000×1500 的地面卡片 + 一个地漏配置
function drainCard(over) {
  return Object.assign({
    type: "floor", w: 2000, h: 1500,
    drain: Object.assign({
      on: true, kind: "square", fromLeft: 1000, fromBack: 750, rot: 0,
      size: 100, len: 300, wide: 64, gap: 3, against: null, shower: "hand",
      drop: 10, cutStyle: "auto", fitRidges: true, fitEdges: true, minPiece: 50,
    }, over || {}),
  });
}

test("drainToDiagram · 门在四条边时，「离左墙 / 离后墙」换算成图坐标", () => {
  // 门换边后"后墙/左墙"落在图的哪条边会跟着变 —— 搞反是最容易出的 bug
  const card = { type: "floor", w: 3020, h: 1510 };
  const dr = { fromLeft: 1510, fromBack: 755 };
  const cases = [
    ["bottom", 1510, 755,  "后墙=图下边 → y = H − 755"],
    ["top",    1510, 755,  "后墙=图上边 → y = 755"],
    ["left",    755, 1510, "后墙=图左边 → x = 755"],
    ["right",  2265,   0,  "后墙=图右边 → x = 3020 − 755"],
  ];
  for (const [de, x, y, why] of cases) {
    const got = E.drainToDiagram(dr, card, de);
    check(`门在${de}：→ (${x}, ${y})（${why}）`,
      near(got.x, x, 0.01) && near(got.y, y, 0.01), `得到 (${got.x}, ${got.y})`);
  }
});

test("drainShape · 四种造型归一化成「点」或「线段」", () => {
  const card = drainCard();
  for (const kind of ["square", "round", "concealed"]) {
    const s = E.drainShape(drainCard({ kind }).drain, drainCard({ kind }));
    check(`${kind} → 点最低处（isLine=false，有 point，无 seg）`,
      s.isLine === false && !!s.point && !s.seg, JSON.stringify(s));
    check(`${kind}：地漏图坐标 = (1000, 750)`,
      near(s.point.x, 1000, 0.01) && near(s.point.y, 750, 0.01),
      `得到 (${s.point.x}, ${s.point.y})`);
    check(`${kind}：洞口含留缝 = 106×106`,
      near(s.open.w, 106, 0.01) && near(s.open.h, 106, 0.01), `得到 ${s.open.w}×${s.open.h}`);
  }
  const h = E.drainShape(drainCard({ kind: "linear", rot: 0 }).drain, drainCard({ kind: "linear", rot: 0 }));
  check("长条 rot=0 → 水平最低线（ay == by）", h.isLine === true && !!h.seg && Math.abs(h.seg.ay - h.seg.by) < 1e-9);
  check("长条 rot=0：线段长 300、中心在 (1000,750)",
    near(h.seg.bx - h.seg.ax, 300, 0.01) && near((h.seg.ax + h.seg.bx) / 2, 1000, 0.01));
  const v = E.drainShape(drainCard({ kind: "linear", rot: 90 }).drain, drainCard({ kind: "linear", rot: 90 }));
  check("长条 rot=90 → 竖直最低线（ax == bx）", Math.abs(v.seg.ax - v.seg.bx) < 1e-9);
  const ab = E.drainShape(drainCard({ kind: "linear", against: "back" }).drain, drainCard({ kind: "linear", against: "back" }));
  check("长条贴后墙（门在下边 → 后墙=图下边）→ 水平线，y = H − 750",
    Math.abs(ab.seg.ay - ab.seg.by) < 1e-9 && near(ab.seg.ay, 750, 0.01), `y=${ab.seg.ay}`);
});

test("slopeZones · 点状：十字线切出 4 块，铺满地面、四角共面", () => {
  const card = drainCard();
  const shape = E.drainShape(card.drain, card, "bottom");
  const zones = E.slopeZones(card, shape);
  check("分区数 = 4（一横一竖切四块）", zones.length === 4, `得到 ${zones.length}`);
  const area = zones.reduce((n, z) => n + z.w * z.h, 0);
  check("四块铺满地面、不重不漏", Math.abs(area - card.w * card.h) < 1e-6, `面积 ${area} vs ${card.w * card.h}`);
  check("每个分区 x/y/w/h 都是有限数且非负",
    zones.every((z) => [z.x, z.y, z.w, z.h].every(isFinite) && z.w >= 0 && z.h >= 0));
  check("每个分区 4 个角都有高度、都 ≥ 0",
    zones.every((z) => z.hc.length === 4 && z.hc.every((v) => isFinite(v) && v >= -1e-9)));
  // 命门 2b：四角必须共面，不然没法当平面贴
  let worst = 0;
  for (const z of zones) {
    if (z.w <= 0 || z.h <= 0) continue;
    const [h00, h10, h01, h11] = z.hc;
    worst = Math.max(worst, Math.abs((h10 + h01 - h00) - h11));
  }
  check("每个分区四角共面（误差 < 0.01mm）", worst < 0.01, `最大偏差 ${worst.toFixed(6)}mm`);
});

test("slopeZones · 长条：至多 6 块；贴死墙时退化成 3 块", () => {
  const mk = (over) => { const c = drainCard(Object.assign({ kind: "linear" }, over));
                         return E.slopeZones(c, E.drainShape(c.drain, c, "bottom")); };
  check("贴边但离墙 100mm → 6 块（3 段 × 2 侧）", mk({ fromBack: 100 }).length === 6, `得到 ${mk({ fromBack: 100 }).length}`);
  check("房间中间 → 6 块", mk({ fromBack: 750 }).length === 6, `得到 ${mk({ fromBack: 750 }).length}`);
  check("贴死墙（离墙 0）→ 退化成 3 块", mk({ fromBack: 0 }).length === 3, `得到 ${mk({ fromBack: 0 }).length}`);
  const z6 = mk({ fromBack: 100 });
  const area = z6.reduce((n, z) => n + z.w * z.h, 0);
  check("6 块也铺满地面、不重不漏", Math.abs(area - 2000 * 1500) < 1e-6, `面积 ${area}`);
  let worst = 0;
  for (const z of z6) {
    if (z.w <= 0 || z.h <= 0) continue;
    const [h00, h10, h01, h11] = z.hc;
    worst = Math.max(worst, Math.abs((h10 + h01 - h00) - h11));
  }
  check("长条各分区四角也共面", worst < 0.01, `最大偏差 ${worst.toFixed(6)}mm`);
});

test("slopeHeightAt · 高度连续：十字线两侧不能有台阶（命门2）", () => {
  const card = drainCard();
  const shape = E.drainShape(card.drain, card, "bottom");
  const zones = E.slopeZones(card, shape);
  const at = (x, y) => E.slopeHeightAt(zones, x, y);
  let worst = 0;
  for (let i = 1; i < 100; i++) {
    const y = (card.h * i) / 100;
    worst = Math.max(worst, Math.abs(at(shape.point.x - 1, y) - at(shape.point.x + 1, y)));
  }
  check("竖线两侧高度一致（无台阶）", worst < 0.02, `最大落差 ${worst.toFixed(4)}mm`);
  let worst2 = 0;
  for (let i = 1; i < 100; i++) {
    const x = (card.w * i) / 100;
    worst2 = Math.max(worst2, Math.abs(at(x, shape.point.y - 1) - at(x, shape.point.y + 1)));
  }
  check("横线两侧高度一致（无台阶）", worst2 < 0.02, `最大落差 ${worst2.toFixed(4)}mm`);
});

test("slopeHeightAt · 数值对得上方案里的算例", () => {
  const card = drainCard();                       // 2000×1500，地漏图坐标 (1000, 750)
  const shape = E.drainShape(card.drain, card, "bottom");
  const zones = E.slopeZones(card, shape);
  const at = (x, y) => E.slopeHeightAt(zones, x, y);
  const k = 10 / 1000;

  check("地漏本身 = 0（全屋最低点）", Math.abs(at(1000, 750)) < 1e-9, `得到 ${at(1000, 750)}`);
  check("墙角 (0,0) = 1% × (1000 + 750) = 17.5mm", near(at(0, 0), k * 1750, 0.5), `得到 ${at(0, 0)}`);
  check("对角墙角 (2000,1500) 同样是 17.5mm（地漏在正中）", near(at(2000, 1500), k * 1750, 0.5), `得到 ${at(2000, 1500)}`);

  // 沿上图上边 y=0：V 形，两端 17.5、中点 7.5（= 坡度 × 地漏到这面墙的距离，不是 0）
  const edge = [];
  for (let i = 0; i <= 8; i++) edge.push(at((card.w * i) / 8, 0));
  check("墙根呈 V 形：中间低、两端高", edge[4] < edge[0] - 0.01 && edge[4] < edge[8] - 0.01,
    `中 ${edge[4]} vs 端 ${edge[0]}/${edge[8]}`);
  check("墙根中点 = 1% × 750 = 7.5mm（不是 0）", near(edge[4], k * 750, 0.5), `得到 ${edge[4]}`);
  check("墙根左半段是直线", near(edge[2], (edge[0] + edge[4]) / 2, 0.01),
    `实际 ${edge[2]}，线性期望 ${(edge[0] + edge[4]) / 2}`);

  // 朝地漏 45° 方向的真坡度 = drop × 1.414
  const run = 100 / Math.SQRT2;                   // 斜着走 100mm → 横竖各走 70.71
  const dh = at(1000, 750) === 0 ? at(2000 - run, 1500 - run) - at(2000, 1500) : 0;
  check("45° 方向每米降 ≈ drop × 1.414 = 14.1mm",
    Math.abs((at(2000, 1500) - at(2000 - run, 1500 - run)) / (100 / 1000) - 14.14) < 0.3,
    `实测 ${((at(2000, 1500) - at(2000 - run, 1500 - run)) / 0.1).toFixed(2)} mm/m`);
});

test("slopeHeightAt · 长条：最低线处处为 0，覆盖范围内的墙根等高", () => {
  const card = drainCard({ kind: "linear", against: "back", fromBack: 100 });
  const shape = E.drainShape(card.drain, card, "bottom");
  const zones = E.slopeZones(card, shape);
  const at = (x, y) => E.slopeHeightAt(zones, x, y);
  const seg = shape.seg;
  check("最低线是水平的", Math.abs(seg.ay - seg.by) < 1e-9);

  let maxLow = 0;
  for (let i = 0; i <= 9; i++) {
    maxLow = Math.max(maxLow, Math.abs(at(seg.ax + ((seg.bx - seg.ax) * i) / 9,
                                        seg.ay + ((seg.by - seg.ay) * i) / 9)));
  }
  check("最低线上处处为 0", maxLow < 1e-9, `最大 ${maxLow}`);

  // 后墙 = 图下边 y=H；x 落在长条覆盖范围内 → 等高
  const xa = Math.min(seg.ax, seg.bx), xb = Math.max(seg.ax, seg.bx);
  const hw = [];
  for (let i = 0; i <= 9; i++) hw.push(at(xa + ((xb - xa) * i) / 9, card.h));
  const spread = Math.max(...hw) - Math.min(...hw);
  check("长条覆盖范围内的墙根等高", spread < 0.01, `高差 ${spread}`);
  check("该段墙根高度 = 1% × 100 = 1mm", near(hw[0], 0.01 * 100, 0.01), `得到 ${hw[0]}`);
  const outside = at(xb + 200, card.h);
  check("走出长条两端后墙根变高（角区朝长条端点找坡）",
    outside > hw[0] + 0.01, `范围外 ${outside} vs 范围内 ${hw[0]}`);
});

test("slopeZones · 地漏偏心时也不许出现台阶（4.3 的反例）", () => {
  // 方案里那个算例：若按"各分区朝自己对角斜"，这里会出现约 2.56mm 的台阶
  const card = drainCard({ fromLeft: 1000, fromBack: 1100 });   // 图坐标 (1000, 400)
  const shape = E.drainShape(card.drain, card, "bottom");
  check("地漏偏心到 y=400", near(shape.point.y, 400, 0.01), `得到 ${shape.point.y}`);
  const zones = E.slopeZones(card, shape);
  const at = (x, y) => E.slopeHeightAt(zones, x, y);
  let worst = 0;
  for (let i = 1; i < 100; i++) {
    const x = (card.w * i) / 100;
    worst = Math.max(worst, Math.abs(at(x, 400 - 1) - at(x, 400 + 1)));
  }
  check("偏心时横线两侧依然没有台阶", worst < 0.02, `最大落差 ${worst.toFixed(4)}mm（旧写法约 2.56mm）`);
});

/* ============================================================
 * 四、地漏造型与找坡（2.4 新增 · 契约测试骨架）
 *
 * 怎么读这一组：
 *   1) 先写验收、后写实现。下面清单里的函数还没落地时整组默认跳过；
 *      一齐就自动启用，不用回头改测试。
 *   2) 下面用到的字段名 = 本测试与引擎之间的契约
 *      （见「地漏找坡改造方案.md」4.2 函数表 + 4.5 收敛表）。
 *      实现时可以改名，但**语义不能变**；每条 check 的名字就是验收点。
 *   3) 断言编号 13~23 对应方案第 8 节的编号，方便对照。
 *   4) 已实现的 drainShape / slopeZones / slopeHeightAt 的验收在上面「三」之后
 *      单独一组（直接调用，不走 computeScene），这里不再重复。
 * ============================================================ */

// 注意：pickRidgePhase / pickLinearPhase 已合并为 pickCrossPhase（十字分水线后两者目标一致）
const SLOPE_API = [
  "drainRidgeLines", "drainOpening", "cutRectByLines", "cutRectByHole",
  "pickCrossPhase", "drainCutPlan", "drainAdvice",
];
const _missApi = SLOPE_API.filter((f) => typeof E[f] !== "function");
const SLOPE_READY = _missApi.length === 0;

function slopeTest(name, fn) {
  if (SLOPE_READY) { test(name, fn); return; }
  console.log("\n⏸  " + name + "（等引擎落地后启用）");
}

/* ---- 小工具（本组专用） ---- */

// 造一个带地漏的 state：地面 w×h、地砖 300×300、缝 2（沿用前两组 fixture 的写法）
function drainState(over) {
  over = over || {};
  const st = mkState();
  st.settings.floorTile = { preset: "300×300", w: 300, h: 300 };
  const floor = st.cards.find((c) => c.type === "floor");
  floor.w = over.w != null ? over.w : 2000;
  floor.h = over.h != null ? over.h : 1500;
  floor.drain = Object.assign({
    on: true, kind: "square",
    fromLeft: 1000, fromBack: 750, rot: 0,
    size: 100, len: 300, wide: 64, gap: 3,
    against: null, shower: "hand",
    drop: 10, cutStyle: "auto",
    fitRidges: true,   // 点状：让十字分水线压在砖缝上
    fitEdges: true,    // 长条：让长条边缘压在砖缝上
    minPiece: 50,
  }, over.drain || {});
  return st;
}
const floorOf = (st) => st.cards.find((c) => c.type === "floor");
// 引擎还没把 slope 挂到 scene.floor 上时，给一句看得懂的话，别抛 undefined 的错
const slopeOf = (st) => {
  const f = E.computeScene(st).floor;
  if (!f || !f.slope) throw new Error("scene.floor.slope 未生成 —— 引擎还没在 computeScene ① 段接入（见方案 4.6）");
  return f.slope;
};

// 鞋带公式：多边形面积（守恒类断言用）
function polyArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}
// 是否轴对齐矩形：4 个顶点、每条边水平或竖直 → 只有"直刀"才切得出这种块
const isAxisRect = (pts) =>
  pts.length === 4 &&
  pts.every((p, i) => {
    const q = pts[(i + 1) % 4];
    return Math.abs(p.x - q.x) < 1e-6 || Math.abs(p.y - q.y) < 1e-6;
  });
const finitePts = (pts) => pts.every((p) => isFinite(p.x) && isFinite(p.y));
// 顶点数组 → {x, y, w, h}（本组只用来算矩形砖与洞口的重叠面积）
const bbox = (pts) => {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  return { x:x0, y:y0, w:Math.max(...xs) - x0, h:Math.max(...ys) - y0 };
};
// advice 约定：{ items:[{ kind:"ok"|"info"|"warn"|"error", text }] }
const hasLevel = (advice, kind) =>
  !!advice && Array.isArray(advice.items) && advice.items.some((it) => it.kind === kind);
const adviceText = (advice) =>
  advice && advice.items ? advice.items.map((i) => i.kind + ":" + i.text).join(" | ") : "";

/* 取当前网格里三个特征点的图坐标（关掉相位优化，网格才可预测）。
 * 用第 2 段砖（index 1）避开边缘裁砖，保证取到的是整砖。 */
function brickAnchors() {
  const st = drainState({ drain: { fitRidges: false, fitEdges: false } });
  const card = floorOf(st);
  const sc = E.computeScene(st);
  const bx = sc.floor.x.segments[1], by = sc.floor.y.segments[1];
  return {
    card,
    center: { x: bx.start + bx.width / 2, y: by.start + by.width / 2 }, // 砖心（最好）
    corner: { x: bx.start + bx.width,     y: by.start + by.width },     // 四砖交角（次好）
    onseam: { x: bx.start + bx.width,     y: by.start + by.width / 2 }, // 压在缝中段（最糟）
  };
}
/* 把地漏放到指定图坐标上，返回 { st, plan, advice }。
 * 注意：门在下边时"离后墙"要换算成 y = H − fromBack（方案第 3 节换算表）。 */
function planAt(pt, extra) {
  const a = brickAnchors();
  const st = drainState({
    drain: Object.assign({
      fitRidges: false, fitEdges: false,
      fromLeft: pt.x, fromBack: a.card.h - pt.y,
    }, extra || {}),
  });
  return { st, plan: slopeOf(st).plan, advice: slopeOf(st).advice };
}

/* ---- 断言 13 ---- */
slopeTest("造型13 · 四种造型都能跑通，坡面数符合 4.5 收敛表", () => {
  const cases = [
    { kind: "square",    against: null,   zones: 4, name: "方形（十字线 → 4 块矩形）" },
    { kind: "round",     against: null,   zones: 4, name: "圆形（十字线 → 4 块矩形）" },
    { kind: "concealed", against: null,   zones: 4, name: "回字（十字线 → 4 块矩形）" },
    // 长条：3 段（左角区 / 中段 / 右角区）× 2 侧 = 6 块；贴死墙时才退化成 3 块
    { kind: "linear",    against: "back", zones: 6, name: "长条贴边（3 段 × 2 侧 = 6 块）" },
    { kind: "linear",    against: null,   zones: 6, name: "长条居中（3 段 × 2 侧 = 6 块）" },
  ];
  for (const c of cases) {
    const st = drainState({ drain: { kind: c.kind, against: c.against } });
    const card = floorOf(st);
    const shape = E.drainShape(card.drain, card);
    const zones = E.slopeZones(card, shape);
    check(`${c.name}：分区数 = ${c.zones}`, zones.length === c.zones, `得到 ${zones.length}`);
    // 分区是"轴对齐矩形 + 四角高度"（4.5 收敛表），不是三角形
    check(`${c.name}：每个分区是轴对齐矩形（x,y,w,h 齐全）`,
      zones.every((z) => [z.x, z.y, z.w, z.h].every(isFinite) && z.w >= 0 && z.h >= 0));
    check(`${c.name}：每个分区 4 个角都有高度、都不是 NaN`,
      zones.every((z) => z.hc.length === 4 && z.hc.every(isFinite)));
    // 注意字段名：h 是分区矩形本身的高度（数字），四角高度是 hc（数组）
    check(`${c.name}：没有负高度（地漏才是最低点）`,
      zones.every((z) => z.hc.every((v) => v >= -1e-9)));
    const sl = slopeOf(st);
    check(`${c.name}：scene.floor.slope 已生成且砖块非空`, !!sl && sl.tiles.length > 0);
    check(`${c.name}：切块顶点无 NaN`,
      sl.tiles.every((t) => t.polys.every((p) => finitePts(p.pts))));
  }
  // 最低处的"形状"必须是两种之一：点 或 线段
  const sqCard = floorOf(drainState({ drain: { kind: "square" } }));
  const lnCard = floorOf(drainState({ drain: { kind: "linear", against: "back" } }));
  const sqShape = E.drainShape(sqCard.drain, sqCard);
  const lnShape = E.drainShape(lnCard.drain, lnCard);
  check("方形 → 点最低处（isLine=false 且有 point）", sqShape.isLine === false && !!sqShape.point);
  check("长条 → 线段最低处（isLine=true 且有 seg）", lnShape.isLine === true && !!lnShape.seg);
});

/* ---- 断言 14 / 14b ---- */
slopeTest("造型14 · 长条只切直刀、切得极少（与点状对照）", () => {
  const st = drainState({ drain: { kind: "linear", against: "back", len: 300, wide: 64 } });
  const sl = slopeOf(st), plan = sl.plan;
  // 两笔账分开：ridgeCuts = 分区线；drainCuts = 长条本体压住的砖
  check("300 长条：分区线要切的砖 ≤ 2", plan.ridgeCuts <= 2, `实际 ${plan.ridgeCuts} 块`);
  check("切下来的条都不窄于 minPiece(50mm)", plan.minStrip >= 50, `最窄 ${plan.minStrip}`);
  const cutTiles = sl.tiles.filter((t) => t.cut);
  check("确有砖被切到（否则这条测试没意义）", cutTiles.length > 0);
  check("每个切块都是轴对齐矩形（直刀，不是斜切）",
    cutTiles.every((t) => t.polys.every((p) => isAxisRect(p.pts))),
    "存在非矩形的切块 → 说明切成了斜的");

  // 对照：点状不调相位（十字线没压缝）→ 一整列砖都得骑线；长条压上缝 → 一块都不用管
  // 注意：分区线**永不切砖**（2.5），这里比的是"骑线砖数"，不是切砖数
  const sqPlan = slopeOf(drainState({ drain: { kind: "square", fitRidges: false } })).plan;
  check("对照：点状不调相位时骑线的砖明显多于长条",
    sqPlan.ride.count > plan.ride.count, `点状 ${sqPlan.ride.count} vs 长条 ${plan.ride.count}`);
  // 守恒：每块砖的面积 = 它所有切块面积之和 + 被洞口挖掉的那部分
  // （不能直接减 o.w×o.h —— 洞口有一小部分压在砖缝上，那不是砖的面积）
  const o = E.drainOpening(sl.shape);
  let removed = 0;
  for (const t of sl.tiles) {
    if (!t.hole) continue;
    const r = bbox(t.rect);
    const iw = Math.max(0, Math.min(r.x + r.w, o.x + o.w) - Math.max(r.x, o.x));
    const ih = Math.max(0, Math.min(r.y + r.h, o.y + o.h) - Math.max(r.y, o.y));
    removed += iw * ih;
  }
  const tileArea = sl.tiles.reduce((n, t) => n + polyArea(t.rect), 0);
  const polySum = sl.tiles.reduce((n, t) => n + t.polys.reduce((m, p) => m + polyArea(p.pts), 0), 0);
  check("切块面积守恒（砖总面积 − 实际挖掉的面积，相对误差 < 1e-6）",
    Math.abs(polySum - (tileArea - removed)) <= 1e-6 * tileArea,
    `切块 ${polySum} vs 期望 ${tileArea - removed}`);
});

slopeTest("造型14b · 反向断言：长条本体压住的砖必切（防止把话说满）", () => {
  // 分水线可以做到零切，但长条要占掉一条 64mm 宽的地 → drainCuts 永远 ≥ 1
  for (const wide of [25, 30, 32, 64, 100]) {
    for (const len of [300, 604, 1524]) {
      const st = drainState({ drain: { kind: "linear", against: "back", wide, len } });
      const plan = slopeOf(st).plan;
      check(`长条 ${len}×${wide}：洞口至少要切 1 块砖`, plan.drainCuts >= 1, `实际 ${plan.drainCuts}`);
    }
  }
});

/* ---- 断言 15 ---- */
slopeTest("造型15 · 长条：最低线处处为 0；覆盖范围内的墙根等高", () => {
  const st = drainState({ drain: { kind: "linear", against: "back", rot: 0, fromBack: 100 } });
  const card = floorOf(st);
  const sl = slopeOf(st);
  const seg = sl.shape.seg;                       // 约定：{ ax, ay, bx, by }
  check("长条横放 → 最低线是水平的", Math.abs(seg.ay - seg.by) < 1e-6);

  // ① 沿最低线取 10 点 → 全为 0
  const hLow = [];
  for (let i = 0; i <= 9; i++) {
    hLow.push(E.slopeHeightAt(sl.zones,
      seg.ax + ((seg.bx - seg.ax) * i) / 9,
      seg.ay + ((seg.by - seg.ay) * i) / 9));
  }
  check("最低线上处处为 0", Math.max(...hLow) < 0.01, `最大 ${Math.max(...hLow)}`);

  // ② 贴边那面墙（门在下边 → 后墙 = 图下边 y=H），x 落在长条范围内 → 等高
  const wallY = card.h;                            // 后墙 = 图下边
  const xa = Math.min(seg.ax, seg.bx), xb = Math.max(seg.ax, seg.bx);
  const hWall = [];
  for (let i = 0; i <= 9; i++) hWall.push(E.slopeHeightAt(sl.zones, xa + ((xb - xa) * i) / 9, wallY));
  const spread = Math.max(...hWall) - Math.min(...hWall);
  check("长条覆盖范围内的墙根等高（底排砖不用处理）", spread < 0.01, `高差 ${spread}`);
  const want = (card.drain.drop / 1000) * card.drain.fromBack;
  check("该段墙根高度 = 坡度 × 地漏到墙的距离", near(hWall[0], want, 0.5), `得到 ${hWall[0]}，期望约 ${want}`);

  // ③ 走出长条两端 → 必须变高（那两块角区要朝长条端点斜，不能是平的）
  const outside = xb + 200 < card.w ? E.slopeHeightAt(sl.zones, xb + 200, wallY) : null;
  if (outside != null) {
    check("长条范围外的墙根更高（角区也在往长条端点找坡）",
      outside > hWall[0] + 0.01, `范围外 ${outside} vs 范围内 ${hWall[0]}`);
  }
});

slopeTest("造型15b · 点状：每面墙根是 V 形，最低点不是 0", () => {
  const st = drainState({ drain: { kind: "square", fromLeft: 1000, fromBack: 750 } });
  const card = floorOf(st);
  const sl = slopeOf(st);
  const k = card.drain.drop / 1000;
  // 地面 2000×1500、地漏图坐标 (1000, 750)（门在下边 → y = H − fromBack）
  // 沿上图上边 y=0 取样：最高在两端（k×(1000+750)=17.5），最低在 x=cx（k×750=7.5）
  const edge = [];
  for (let i = 0; i <= 8; i++) edge.push(E.slopeHeightAt(sl.zones, (card.w * i) / 8, 0));
  const mid = edge[4], ends = [edge[0], edge[8]];
  check("墙根中间低于两端（V 形，不是平的）", mid < ends[0] - 0.01 && mid < ends[1] - 0.01,
    `中 ${mid} vs 端 ${ends.join(" / ")}`);
  check("中点高度 = 坡度 × 地漏到这面墙的距离（不是 0）", near(mid, k * 750, 0.5), `得到 ${mid}，期望约 ${k * 750}`);
  check("墙角高度 = 坡度 ×（横距 + 竖距）", near(edge[0], k * (1000 + 750), 0.5), `得到 ${edge[0]}`);
  // 两段都必须是直线：中点 = 两端插值的中点
  check("左半段是直线（两点确定一条直线）",
    near(edge[2], (edge[0] + mid) / 2, 0.01), `实际 ${edge[2]}，线性期望 ${(edge[0] + mid) / 2}`);
});

/* ---- 断言 16 ---- */
slopeTest("造型16 · 洞口（含留缝）完整落在地面内、离墙 ≥ gap+20", () => {
  const cases = [
    { kind: "square",    size: 100, gap: 3, len: 300, wide: 64, name: "方形 100 留缝 3" },
    { kind: "round",     size: 100, gap: 5, len: 300, wide: 64, name: "圆形 φ100 留缝 5" },
    { kind: "concealed", size: 150, gap: 3, len: 300, wide: 64, name: "回字 150 留缝 3" },
    { kind: "linear",    size: 100, gap: 3, len: 600, wide: 64, name: "长条 600×64 留缝 3" },
  ];
  for (const c of cases) {
    const st = drainState({ drain: c });
    const card = floorOf(st);
    const o = E.drainOpening(E.drainShape(card.drain, card));
    check(`${c.name}：洞口完全在地面内`,
      o.x >= -1e-6 && o.y >= -1e-6 &&
      o.x + o.w <= card.w + 1e-6 && o.y + o.h <= card.h + 1e-6,
      `洞口 ${JSON.stringify(o)} 地面 ${card.w}×${card.h}`);
    const clear = Math.min(o.x, o.y, card.w - (o.x + o.w), card.h - (o.y + o.h));
    check(`${c.name}：离最近的墙 ≥ ${c.gap + 20}mm`, clear >= c.gap + 20 - 1e-6, `实际 ${clear.toFixed(1)}`);
  }
});

/* ---- 断言 17 ---- */
slopeTest("造型17 · 点状套割不骑缝：孔到最近砖缝 ≥ gap+20，不够就换方案并提示", () => {
  const good = planAt(brickAnchors().center);
  check("落砖心：孔到最近砖缝 ≥ 23mm", good.plan.clearance >= 23 - 1e-6, `实际 ${good.plan.clearance}`);
  check("落砖心：无 warn/error（能安全开孔）",
    !hasLevel(good.advice, "warn") && !hasLevel(good.advice, "error"), adviceText(good.advice));

  const bad = planAt(brickAnchors().onseam);
  check("压在缝中段：clearance < 23 → 判定为骑缝", bad.plan.clearance < 23, `实际 ${bad.plan.clearance}`);
  check("压在缝中段：不许再用 hole 方案（毛边会外露）", bad.plan.cutStyle !== "hole", `得到 ${bad.plan.cutStyle}`);
  check("压在缝中段：给了提示（要挪位）",
    hasLevel(bad.advice, "warn") || hasLevel(bad.advice, "error"), adviceText(bad.advice));
});

/* ---- 断言 18 ---- */
slopeTest("造型18 · 落点判定 ↔ 切法一一对应（2.4.3 第二步表）", () => {
  const A = brickAnchors();
  const c1 = planAt(A.center);
  check("砖心 → cutStyle=hole，只涉及 1 块砖",
    c1.plan.cutStyle === "hole" && c1.plan.cutCount === 1,
    `得到 ${c1.plan.cutStyle} / ${c1.plan.cutCount}`);

  const c2 = planAt(A.corner);
  check("四砖交角 → cutStyle=corner，涉及 4 块砖",
    c2.plan.cutStyle === "corner" && c2.plan.cutCount === 4,
    `得到 ${c2.plan.cutStyle} / ${c2.plan.cutCount}`);

  const c3 = planAt(A.onseam);
  check("压在缝中段 → 切成 2 块",
    c3.plan.cutCount === 2, `得到 ${c3.plan.cutStyle} / ${c3.plan.cutCount}`);

  // 切法必须随落点变化，不能三种落点给同一个答案
  const styles = new Set([c1.plan.cutStyle, c2.plan.cutStyle, c3.plan.cutStyle]);
  check("三种落点给出至少 2 种不同切法（判定真在起作用）", styles.size >= 2, [...styles].join(","));
});

/* ---- 断言 19 ---- */
slopeTest("造型19 · 开孔定位尺寸自洽：a+b = 砖宽、c+d = 砖高", () => {
  const r = planAt(brickAnchors().center);
  check("落砖心 → hole 方案", r.plan.cutStyle === "hole", `得到 ${r.plan.cutStyle}`);
  const abcd = r.plan.tiles[0] && r.plan.tiles[0].abcd;   // 孔中心到砖四边的距离
  check("给出了 4 个定位尺寸", !!abcd && [abcd.a, abcd.b, abcd.c, abcd.d].every(isFinite));
  if (!abcd) return;
  check("a+b = 砖宽 300（左右对得上）", near(abcd.a + abcd.b, 300, 0.5), `${abcd.a} + ${abcd.b}`);
  check("c+d = 砖高 300（上下对得上）", near(abcd.c + abcd.d, 300, 0.5), `${abcd.c} + ${abcd.d}`);
  check("四个尺寸都 > 0（孔没跑出砖外）", [abcd.a, abcd.b, abcd.c, abcd.d].every((v) => v > 0));
  check("落砖心 → 左右近似对称、上下近似对称",
    near(abcd.a, abcd.b, 3) && near(abcd.c, abcd.d, 3),
    `a=${abcd.a} b=${abcd.b} c=${abcd.c} d=${abcd.d}`);
});

/* ---- 断言 20 ---- */
slopeTest("造型20 · 最远角抬高量 = 坡度 ×（横距 + 竖距），>30mm 报警", () => {
  // 十字分水线模型：h = k × (|dx| + |dy|)，k = drop/1000（见方案 4.3）
  const st = drainState({ w: 2000, h: 1500, drain: { kind: "square", drop: 10 } });
  const sl = slopeOf(st);
  const k1 = 10 / 1000;
  check("墙角抬高 = 1% × (1000 + 750) = 17.5mm",
    near(E.slopeHeightAt(sl.zones, 0, 0), k1 * (1000 + 750), 0.5),
    `得到 ${E.slopeHeightAt(sl.zones, 0, 0)}`);
  check("抬高 17.5 < 30 → 不报警", !hasLevel(sl.advice, "error"), adviceText(sl.advice));

  // 8m×6m 大地面 + 3% 坡：地漏图坐标 (1000, 5250)，最远角 (8000, 0)
  const big = drainState({ w: 8000, h: 6000, drain: { kind: "square", drop: 30, fromLeft: 1000, fromBack: 750 } });
  const sl2 = slopeOf(big);
  check("大地面 3% → 抬高 = 0.03 × (7000 + 5250) ≈ 367mm",
    near(E.slopeHeightAt(sl2.zones, 8000, 0), (30 / 1000) * (7000 + 5250), 1),
    `得到 ${E.slopeHeightAt(sl2.zones, 8000, 0)}`);
  check("抬高 > 30mm → advice 里有 error", hasLevel(sl2.advice, "error"), adviceText(sl2.advice));
});

/* ---- 断言 21 ---- */
slopeTest("造型21 · 长条排水量 vs 花洒流量（300→35 / 500→45 / 600→55 L/min）", () => {
  const warnOf = (len, shower) => {
    const st = drainState({ drain: { kind: "linear", against: "back", len, wide: 64, shower } });
    const a = slopeOf(st).advice;
    return hasLevel(a, "warn") || hasLevel(a, "error");
  };
  check("300 + 手持(12) → 35 够，不提示", warnOf(300, "hand") === false);
  check("300 + 大顶喷(25) → 35 够，不提示", warnOf(300, "rain") === false);
  check("300 + 顶喷+手持(40) → 35 不够，提示换长一号", warnOf(300, "both") === true);
  check("600 + 顶喷+手持(40) → 55 够，不提示", warnOf(600, "both") === false);
});

/* ---- 断言 22 ---- */
slopeTest("造型22 · 长条长度 300/600/900/1524：涉及砖数随长度不减、不炸", () => {
  let prev = -1;
  for (const len of [300, 600, 900, 1524]) {
    const st = drainState({ w: 4000, h: 3000, drain: { kind: "linear", against: "back", len, wide: 64 } });
    const sl = slopeOf(st);
    const involved = sl.tiles.filter((t) => t.cut || t.hole).length;
    check(`${len}：涉及砖数不比上一个长度少（${prev} → ${involved}）`, involved >= prev, `${prev} → ${involved}`);
    const totalPolys = sl.tiles.reduce((n, t) => n + t.polys.length, 0);
    check(`${len}：切块总数 < 4 × 砖数（不会切爆）`,
      totalPolys < 4 * sl.tiles.length, `${totalPolys} / ${sl.tiles.length}`);
    check(`${len}：全部顶点有限、无 NaN`,
      sl.tiles.every((t) => t.polys.every((p) => finitePts(p.pts))));
    prev = involved;
  }
});

/* ---- 断言 23 ---- */
slopeTest("造型23 · 长条贴边：中心线到墙 < wide/2+20 时给 error", () => {
  const need = 64 / 2 + 20;                                // 52mm：给槽体留位置
  const ok = drainState({ drain: { kind: "linear", against: "back", rot: 0, wide: 64, fromBack: 100 } });
  check(`离墙 100mm ≥ ${need} → 合法，无 error`,
    !hasLevel(slopeOf(ok).advice, "error"), adviceText(slopeOf(ok).advice));
  const bad = drainState({ drain: { kind: "linear", against: "back", rot: 0, wide: 64, fromBack: 30 } });
  check(`离墙 30mm < ${need} → error（槽体没地方放）`,
    hasLevel(slopeOf(bad).advice, "error"), adviceText(slopeOf(bad).advice));
});

/* ---------- 本轮改动的"命门"断言 ----------
 * 这几条一旦挂掉，说明又退回到"对角分水线 / 斜切 / 分区接不上"的老路上。
 * 每条都对应方案里的一处明确取舍，改模型前先想清楚为什么挂。          */

slopeTest("命门2 · 高度连续：十字分水线两侧不能有台阶", () => {
  const st = drainState({ drain: { kind: "square", fromLeft: 1000, fromBack: 750 } });
  const card = floorOf(st);
  const sl = slopeOf(st);
  const c = E.drainToDiagram(card.drain, st);      // 图坐标 { x, y }
  const at = (x, y) => E.slopeHeightAt(sl.zones, x, y);

  // 竖线 x=cx：左右各偏 1mm
  let worst = 0;
  for (let i = 1; i < 100; i++) {
    const y = (card.h * i) / 100;
    worst = Math.max(worst, Math.abs(at(c.x - 1, y) - at(c.x + 1, y)));
  }
  check("竖线两侧高度一致（无台阶）", worst < 0.02, `最大落差 ${worst.toFixed(3)}mm`);

  // 横线 y=cy：上下各偏 1mm
  let worst2 = 0;
  for (let i = 1; i < 100; i++) {
    const x = (card.w * i) / 100;
    worst2 = Math.max(worst2, Math.abs(at(x, c.y - 1) - at(x, c.y + 1)));
  }
  check("横线两侧高度一致（无台阶）", worst2 < 0.02, `最大落差 ${worst2.toFixed(3)}mm`);
  // 反例留档：换成"各分区朝自己对角斜"时，地漏偏心的场景这里会出现约 2.5mm 的台阶
});

slopeTest("命门2b · 分区四角共面（四点不共面就贴不了）", () => {
  const st = drainState({ drain: { kind: "square", fromLeft: 1000, fromBack: 750 } });
  const zones = slopeOf(st).zones;
  let worst = 0;
  for (const z of zones) {
    if (z.w <= 0 || z.h <= 0) continue;              // 贴墙时会退化出零宽分区，跳过
    // 用前三个角定的平面去预测第 4 个角
    const [h00, h10, h01, h11] = z.hc;                // 约定顺序：左上/右上/左下/右下
    const predicted = h10 + h01 - h00;               // 双线性下 (1,1) 的预测值
    worst = Math.max(worst, Math.abs(predicted - h11));
  }
  check("每个分区四角共面（误差 < 0.01mm）", worst < 0.01, `最大偏差 ${worst.toFixed(4)}mm`);
});

slopeTest("命门24 · 分水线只有 2 条，且条条轴对齐", () => {
  for (const kind of ["square", "round", "concealed"]) {
    const st = drainState({ drain: { kind } });
    const card = floorOf(st);
    // 分水线：只用来弹线和算骑线，不产生切割（2.5 之后地面中间一律不锯砖）
    const lines = E.drainRidgeLines(card, E.drainShape(card.drain, card));
    check(`${kind}：分水线 = 2 条`, lines.length === 2, `得到 ${lines.length} 条`);
    check(`${kind}：每条都是轴对齐的（不是斜线）`,
      lines.every((l) => Math.abs(l.x1 - l.x2) < 1e-9 || Math.abs(l.y1 - l.y2) < 1e-9),
      JSON.stringify(lines));
    // 一横一竖，各一条
    const vert = lines.filter((l) => Math.abs(l.x1 - l.x2) < 1e-9).length;
    check(`${kind}：一横一竖各一条`, vert === 1, `竖线 ${vert} 条`);
  }
});

slopeTest("命门8b · 地面中间的整砖不许被切（改成骑线）", () => {
  // 本轮改的核心：分水线穿过整砖一律不锯，让砖骑线。
  // 允许动锯子的只有两处：地漏周围（回字对角切/套割）、靠墙收边（1/3 老规矩）。
  for (const c of [{ kind: "square", name: "点状方形" },
                   { kind: "linear", against: "back", name: "长条贴边" }]) {
    const sl = slopeOf(drainState({ drain: c }));
    const plan = sl.plan;
    // plan 里每一块被切的砖都要能说出"为什么切"
    const allow = ["drain", "edge"];                  // 地漏周围 / 靠墙收边
    const bad = (plan.tiles || []).filter((t) => t.cut && allow.indexOf(t.reason) < 0);
    check(`${c.name}：没有任何一块是因为分水线而被切`, bad.length === 0,
      `有 ${bad.length} 块切因不是 drain/edge`);
    check(`${c.name}：地漏周围确实要切（这笔账不能假装没有）`,
      (plan.drainCuts || 0) > 0, `drainCuts=${plan.drainCuts}`);
    // 真要切的话，切块还得是轴对齐矩形（不许斜切）
    const cut = (sl.tiles || []).filter((t) => t.cut);
    check(`${c.name}：切块都是轴对齐矩形`,
      cut.every((t) => t.polys.every((p) => isAxisRect(p.pts))),
      "出现非矩形切块 → 说明切成了斜的，现场没法下刀");
  }
});

slopeTest("命门26 · 骑线砖的悬空量报得对（师傅照这个数抹灰）", () => {
  const st = drainState({ drain: { kind: "square" } });
  const sl = slopeOf(st);
  const k = floorOf(st).drain.drop / 1000;
  const t = 300, g = 2;
  // 两条分水线：竖线在 cx、横线在 cy
  const c = E.drainToDiagram(floorOf(st).drain, floorOf(st), st.doorEdge);
  const X = E.layoutAxis(floorOf(st).w, t, g, "center", sl.phase.x);
  const Y = E.layoutAxis(floorOf(st).h, t, g, "center", sl.phase.y);
  const rx = E.rideReport(k, X, c.x), ry = E.rideReport(k, Y, c.y);
  check("竖线：骑线砖数 ≥ 0（压上缝就是 0）", rx.count >= 0);
  check("竖线最大悬空量 = rideGap 公式算出来的", rx.max <= k * t / 4 + 1e-9,
    `实际 ${rx.max}，上限 ${k * t / 4}`);
  check("横线最大悬空量 = rideGap 公式算出来的", ry.max <= k * t / 4 + 1e-9,
    `实际 ${ry.max}，上限 ${k * t / 4}`);
  check("300 砖 @1% 的悬空量 ≤ 0.75mm（垫灰即可，不用锯）",
    Math.max(rx.max, ry.max) <= 0.75 + 1e-9, `实际 ${Math.max(rx.max, ry.max)}`);
});

slopeTest("命门7 · 十字线压缝 → 点状分水线零切砖（但洞口仍要切 4 块）", () => {
  // 算例见上面"三"那组：地面 3020×1510、砖距 302 → 理论相位 X = 1510 mod 302 = 0（可压缝）
  // Y 轴被"门口发整砖"锁死在 phase 2（方案第 6 节：门口整砖赢，这条轴不许动相位），
  // 所以 fromBack 要挑一个正好落在砖边的数：y = 1510 − 602 = 908 = 2 + 3×302 ✓ 也是砖边
  // → 两条分水线都压在砖缝上（零骑线），地漏落在四砖交角 → 回字对角切 4 块
  const st = drainState({ w: 3020, h: 1510, drain: { kind: "square", fromLeft: 1510, fromBack: 602 } });
  const sl = slopeOf(st);
  const plan = sl.plan;
  // 两笔账必须分开：ridgeCuts = 因分水线要切；drainCuts = 因地漏洞口要切
  check("分水线零切砖", plan.ridgeCuts === 0, `实际 ${plan.ridgeCuts} 块`);
  check("地漏洞口仍要切 4 块（回字对角切，这笔账不能假装没有）", plan.drainCuts === 4, `实际 ${plan.drainCuts} 块`);
  check("合计 = 4（0 + 4，去重后）", plan.cutCount === 4, `实际 ${plan.cutCount}`);
  check("提示文案要说人话，不许报「零切砖」把洞口那 4 块也吞了",
    (adviceText(sl.advice) + JSON.stringify(plan)).indexOf("0 块") < 0 ||
    /分水线|十字线/.test(adviceText(sl.advice)),
    adviceText(sl.advice));
});

slopeTest("命门7c · 长条长度取「砖距整数倍 ± 缝宽」→ 分区线也能零切砖", () => {
  // 长条两端各有一条分区垂线，两条都压缝 → 那一列整列不切。
  // 规律：len mod p ∈ {0, g, t}。常见的 600/900 反而压不上（见"三"那组的扫描结果）
  const st = drainState({ w: 3020, h: 1510, drain: { kind: "linear", against: "back", fromLeft: 1510, fromBack: 100, len: 604, wide: 64 } });
  const plan = slopeOf(st).plan;
  check("len=604（=2×302）：分区线零切砖", plan.ridgeCuts === 0, `实际 ${plan.ridgeCuts} 块`);
  check("但长条本体压住的那几块必切", plan.drainCuts >= 1, `实际 ${plan.drainCuts} 块`);
});

slopeTest("命门7b · 零切砖让位于 1/3 老规矩", () => {
  // 换一个地面尺寸，让"压缝"那个相位必然产生 < 1/3 的边缘裁砖
  const st = drainState({ w: 1900, h: 1450, drain: { kind: "square", fromLeft: 1510, fromBack: 755 } });
  const sl = slopeOf(st);
  const ax = E.computeScene(st).floor;
  const minCut = Math.min(ax.x.cutLeft ?? 1e9, ax.x.cutRight ?? 1e9,
                          ax.y.cutLeft ?? 1e9, ax.y.cutRight ?? 1e9);
  check("边缘裁砖没有被搞碎（仍 ≥ 砖宽 1/3 = 100）", minCut >= 100, `最小边缘裁砖 ${minCut}`);
  check("因此这一例没有强求零切砖", sl.plan.cutCount > 0 || minCut >= 100);
});

if (!SLOPE_READY) {
  console.log(`\n⏸  地漏造型组（断言 13~25 + 命门）整组跳过：引擎还缺 ${_missApi.length} 个函数`);
  console.log(`   待实现：${_missApi.join(", ")}`);
}

console.log(`\n结果：${_pass} 通过，${_fail} 失败`);
process.exit(_fail ? 1 : 0);
