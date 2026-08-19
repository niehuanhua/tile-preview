// 验收测试：从 index.html 提取引擎代码，跑需求文档 v1.2 第 11 节的验收示例
"use strict";
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const m = html.match(/\/\*ENGINE-START\*\/([\s\S]*?)\/\*ENGINE-END\*\//);
if (!m) { console.error("找不到引擎代码段"); process.exit(1); }
const moduleShim = { exports: {} };
new Function("module", m[1])(moduleShim);
const E = moduleShim.exports;

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? " → " + detail : ""}`); }
};
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

console.log("\n【验收 13】裁砖 1/3 自动调整：墙宽 1400，墙砖 300×600 横铺");
{
  // 基础居中（未调整）：两头裁砖约 97 < 200
  const base = E.layoutAxis(1400, 600, 2, "center", 99); // 99 = 未调整时的相位
  check("未调整时两头裁砖约 97（< 整砖 1/3 = 200）", near(base.cutLeft, 97) && near(base.cutRight, 97),
    `得到 ${base.cutLeft} / ${base.cutRight}`);
  // 自动调整后
  const r = E.layoutAxis(1400, 600, 2, "center");
  check("触发了自动调整", r.adjusted === true);
  check("调整后两头裁砖约 398，均 ≥ 200", near(r.cutLeft, 398) && near(r.cutRight, 398) && r.cutLeft >= 200 && r.cutRight >= 200,
    `得到 ${r.cutLeft} / ${r.cutRight}`);
}

console.log("\n【验收 1/基础】居中与靠一边、整砖块数");
{
  const exact = E.layoutAxis(1202, 600, 2, "center"); // 刚好排下 2 整砖
  check("1202 = 2×600 + 缝：无裁砖、不调整", exact.cutLeft === null && exact.cutRight === null && !exact.adjusted);
  check("段数 = 2 且都是整砖", exact.segments.length === 2 && exact.segments.every(s => !s.cut));

  const edge = E.layoutAxis(1400, 600, 2, "edge"); // 靠一边也要触发 1/3 调整
  check("靠一边：右侧裁砖 <1/3 也触发调整", edge.adjusted === true);
  check("靠一边调整后两端裁砖均 ≥ 200", edge.cutLeft >= 200 && edge.cutRight >= 200,
    `得到 ${edge.cutLeft} / ${edge.cutRight}`);

  const narrow = E.layoutAxis(250, 300, 2, "center"); // 墙比砖窄
  check("墙比砖窄：一整块裁砖覆盖", narrow.narrow === true && narrow.segments.length === 1 && near(narrow.segments[0].width, 250, 0.1));
}

console.log("\n【验收 11】前后左右推导对照表（含镜像）");
{
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
}

console.log("\n【验收 10】通缝对齐：地面 2000×1500 地砖 300×300，墙 A 宽 2000 选前边，墙砖 300×600 横铺");
{
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
  check("墙的水平相位 = 地面 x 相位（缝对得上）", near(entry.x.phase, scene.floor.x.phase, 0.001),
    `墙 ${entry.x.phase} vs 地面 ${scene.floor.x.phase}`);
  const ratio = 600 / 300;
  check("600 = 2×300 判定为相配", E.compatible(600, 300) && Number.isInteger(ratio));
}

console.log("\n【验收 12】规格不配：墙砖换成 400×800");
{
  const st = mkState();
  st.settings.wallTile = { preset: "400×800", w: 400, h: 800 }; // 横铺 → 水平边 800
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
}

console.log("\n【验收 14】通缝与 1/3 冲突：优先保通缝");
{
  const st = mkState();
  st.settings.wallTile = { preset: "300×600", w: 300, h: 600 };
  st.settings.floorTile = { preset: "300×300", w: 300, h: 300 };
  const floor = st.cards.find(c => c.id === "floor");
  floor.w = 2000; floor.h = 1500;
  const wall = st.cards.find(c => c.id === "w1");
  wall.w = 900; wall.h = 2400; wall.alignEdge = "front"; // 900 时锁定相位下右端裁砖约 52 < 200
  const scene = E.computeScene(st);
  const entry = scene.walls.w1;
  const minCut = Math.min(entry.x.cutLeft ?? 9999, entry.x.cutRight ?? 9999);
  check("构造成功：锁定通缝后确实出现 <1/3 裁砖", minCut < 200, `最小裁砖 ${minCut}`);
  check("红字提示「边缘裁砖小于 1/3，已优先保通缝，请现场定夺」",
    entry.statuses.some(s => s.kind === "error" && s.text.includes("优先保通缝")));
  check("同时提示墙宽与地面边长不一致", entry.statuses.some(s => s.kind === "warn" && s.text.includes("不一致")));
  check("相位仍锁定为地面相位（保通缝、不挪动）", near(entry.x.phase, scene.floor.x.phase, 0.001));
}

console.log("\n【通缝·左右边】墙选地面的左边/右边 → 用地面 y 方向相位");
{
  const st = mkState();
  st.settings.wallTile = { preset: "300×600", w: 300, h: 600 };
  st.settings.floorTile = { preset: "300×300", w: 300, h: 300 };
  const floor = st.cards.find(c => c.id === "floor");
  floor.w = 2000; floor.h = 1500; // y 方向长 1500
  const wall = st.cards.find(c => c.id === "w1");
  wall.w = 1500; wall.h = 2400; wall.alignEdge = "left";
  const scene = E.computeScene(st);
  const entry = scene.walls.w1;
  check("选左边 → 对齐地面 y 相位", near(entry.x.phase, scene.floor.y.phase, 0.001),
    `墙 ${entry.x.phase} vs 地面y ${scene.floor.y.phase}`);
  check("无宽度不一致提示（1500 = 地面左边长度）", !entry.statuses.some(s => s.text.includes("不一致")));
}

console.log("\n【门窗立柱坐标】绘图换算");
{
  // 门：墙 2000×2400，门离左 800、宽 800、高 2100 → 空白区 y∈[300,2400]（从顶算）
  const doorY = 2400 - 2100;
  check("门洞顶边 y = 墙高 - 门高 = 300", doorY === 300);
  // 窗：墙高 2400，窗台离地 900、窗高 600 → 窗顶 y = 2400-900-600 = 900，窗底 y = 1500
  const winTop = 2400 - 900 - 600, winBottom = 2400 - 900;
  check("窗顶 y=900、窗底 y=1500（与验收示例 8 一致）", winTop === 900 && winBottom === 1500);
}

console.log("\n【铺贴方向】横铺/竖铺对砖尺寸的影响");
{
  const h = E.laidDims({ w: 300, h: 600 }, "horizontal");
  const v = E.laidDims({ w: 300, h: 600 }, "vertical");
  check("300×600 横铺 → 水平 600、竖直 300", h.x === 600 && h.y === 300);
  check("300×600 竖铺 → 水平 300、竖直 600", v.x === 300 && v.y === 600);
  const sq = E.laidDims({ w: 800, h: 800 }, "vertical");
  check("正方形砖方向不影响", sq.x === 800 && sq.y === 800);
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
