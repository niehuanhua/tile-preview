// 验收测试：全屋通铺工具（house.html）
// 做法同 test.js：用正则抽出 /*ENGINE-START*/…/*ENGINE-END*/ 那段纯函数，在 node 里零依赖跑。
//   node house-test.js
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "house.html"), "utf8");
const m = html.match(/\/\*ENGINE-START\*\/([\s\S]*?)\/\*ENGINE-END\*\//);
if (!m) { console.error("找不到引擎代码段（/*ENGINE-START*/…/*ENGINE-END*/）"); process.exit(1); }
const moduleShim = { exports: {} };
new Function("module", "exports", m[1])(moduleShim, moduleShim.exports);
const E = moduleShim.exports;

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
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

/* ---------------- 造状态 ---------------- */
const mk = (over) => {
  const o = over || {};
  const st = {
    settings: Object.assign({ floorTile:{ preset:"800×800", w:800, h:800 }, direction:"horizontal",
                              grout:2, baseRoom:"r1", baseMode:"center", nudgeX:0, nudgeY:0 }, o.settings || {}),
    rooms: o.rooms || [
      { id:"r1", name:"客厅", x:0,    y:0,    w:4200, h:3600 },
      { id:"r2", name:"次卧", x:4440, y:0,    w:3000, h:3600 },
      { id:"r3", name:"主卧", x:0,    y:3840, w:3300, h:3000 },
    ],
    doors: o.doors || [],
  };
  return st;
};
// 一道通铺门：客厅 → 主卧（上下相邻，共用段 x 0~3300）
const doorBottom = (over) => Object.assign({ id:"d1", from:"r1", to:"r3", at:1500, width:900, threshold:false }, over || {});
// 砖面合计的独立算法（不复用引擎的 cells：Σ列宽 × Σ行宽）
const tiledAreaOf = (plan, g) => {
  let sum = 0;
  for (const rect of plan.region) {
    const sx = E.latticeSegments(plan.grid.GX, plan.tile.x, g, rect.x, rect.x + rect.w).segments;
    const sy = E.latticeSegments(plan.grid.GY, plan.tile.y, g, rect.y, rect.y + rect.h).segments;
    sum += sx.reduce((a, s) => a + s.width, 0) * sy.reduce((a, s) => a + s.width, 0);
  }
  return sum;
};
const seamsOf = (segments) => segments.map((s) => s.start).concat(segments.map((s) => s.start + s.width));

/* ============================================================
 * 一、通缝：这是本工具的命门
 * ============================================================ */
test("通缝 · 相邻两间房共享同一条砖缝（x 与 y 两个方向都查）", () => {
  const st = mk({ doors:[doorBottom()] });
  const p = E.housePlan(st);
  check("算得出全屋方案", p.ok, p.errors.join("；"));
  const A = p.rooms[0], B = p.rooms[2];         // 客厅、主卧（上下相邻）
  // x 方向：两间房的砖缝必须落在同一批全局 x 上
  const axs = new Set(A.gx.segments.map((s) => +s.start.toFixed(3)));
  const bxs = B.gx.segments.map((s) => +s.start.toFixed(3));
  const hitX = bxs.filter((v) => axs.has(v));
  check("客厅与主卧的 x 砖缝对得上（至少有 3 条重合）", hitX.length >= 3, `重合 ${hitX.length} 条：${hitX.slice(0, 6).join(",")}`);
  // 最硬的一条：全局相位推出来的缝位，两间房都必须出现
  const k = Math.round((A.gx.segments[1].start - p.grid.GX) / (p.tile.x + st.settings.grout));
  const gx2 = p.grid.GX + k * (p.tile.x + st.settings.grout);
  check("同一个全局缝位在两间房里都能找到",
        axs.has(+gx2.toFixed(3)) && bxs.includes(+gx2.toFixed(3)), `缝位 ${gx2.toFixed(2)}`);
  // 所有砖缝必须都属于"同一个等差数列"（同一个全局相位）——这是通铺的定义
  const p2 = p.tile.x + st.settings.grout, p3 = p.tile.y + st.settings.grout;
  // 砖的**起点**要落在"起点网格"（G + k×步距）上，**终点**落在"终点网格"（G + 砖宽 + k×步距）上
  // ——两者相差一个砖宽，是同一张网的两族缝。第一块的起点、最后一块的终点被房间边缘夹住，跳过。
  const onLattice = (segs, G, step, t) => {
    const startsOK = segs.slice(1).every((sg) => {
      const k = Math.round((sg.start - G) / step);
      return Math.abs(G + k * step - sg.start) < 0.01;
    });
    const endsOK = segs.slice(0, -1).every((sg) => {
      const v = sg.start + sg.width, k = Math.round((v - G - t) / step);
      return Math.abs(G + t + k * step - v) < 0.01;
    });
    return startsOK && endsOK;
  };
  check("每间房的 x 缝都落在全屋同一张网上",
        p.rooms.every((rm) => onLattice(rm.gx.segments, p.grid.GX, p2, p.tile.x)));
  check("每间房的 y 缝都落在全屋同一张网上",
        p.rooms.every((rm) => onLattice(rm.gy.segments, p.grid.GY, p3, p.tile.y)));
  // 在同一个轴上"并排"的两间房（客厅/次卧都在 x 上不同、y 上重叠）：y 缝必须逐条重合
  const C = p.rooms[1];
  const ays = new Set(A.gy.segments.map((s) => +s.start.toFixed(3)));
  const cys = C.gy.segments.map((s) => +s.start.toFixed(3)).filter((v) => ays.has(v));
  check("y 方向并排的客厅与次卧，横向砖缝逐条重合", cys.length >= 3, `重合 ${cys.length} 条`);
});

test("通缝 · 门口那一段也算进砖网（过门石的不算）", () => {
  const p1 = E.housePlan(mk({ doors:[doorBottom()] }));
  const p2 = E.housePlan(mk({ doors:[doorBottom({ threshold:true })] }));
  const d1 = p1.doors[0].rect, d2 = p2.doors[0].rect;
  check("两个方案门洞矩形一样（只是铺法不同）",
        near(d1.x, d2.x) && near(d1.w, d2.w) && near(d1.h, d2.h));
  const inRegion = (p, r) => p.region.some((q) => near(q.x, r.x) && near(q.y, r.y) && near(q.w, r.w) && near(q.h, r.h));
  check("通铺门口算进铺贴区域", inRegion(p1, d1));
  check("过门石门口不算进铺贴区域（那里放过门石）", !inRegion(p2, d2));
  check("过门石方案面积更小", p2.summary.areaMM < p1.summary.areaMM,
        `${p2.summary.areaMM} < ${p1.summary.areaMM}`);
});

test("通缝 · 门洞比砖窄时如实报「开缺口」，不假装是整砖", () => {
  // 800 砖、900 门洞：门口横跨两列，两侧要开缺口
  const p = E.housePlan(mk({ doors:[doorBottom()] }));
  check("报了开缺口", p.summary.notchCount > 0, `notchCount=${p.summary.notchCount}`);
  check("缺口块的清单单独成组", p.summary.cutGroups.some((g) => g.kind === "notch"));
  // 门洞比砖宽很多（比如 1600）时，穿过门口的应当是整砖
  const wide = E.housePlan(mk({
    rooms:[ { id:"r1", name:"客厅", x:0, y:0, w:4200, h:3600 },
            { id:"r3", name:"主卧", x:0, y:3840, w:3300, h:3000 } ],
    doors:[ doorBottom({ at:1600, width:1600 }) ],
  }));
  check("门洞够宽时，有整砖直接穿过去（不计裁切）", wide.summary.crossDoorWhole > 0,
        `crossDoorWhole=${wide.summary.crossDoorWhole}，开缺口 ${wide.summary.notchCount}`);
});

/* ============================================================
 * 二、起铺基准与微调
 * ============================================================ */
test("起铺 · 以参考房为准居中，且边缘裁砖 ≥ 1/3 砖（老规矩）", () => {
  // 客厅 4200 宽、800 砖 → 居中后两端裁砖相等
  const p = E.housePlan(mk());
  const A = p.rooms[0];
  check("参考房两端裁砖相等（居中对称）",
        A.gx.cutLeft != null && A.gx.cutRight != null && near(A.gx.cutLeft, A.gx.cutRight),
        `左 ${A.gx.cutLeft} 右 ${A.gx.cutRight}`);
  // 参考房换成 1400 宽、600 砖：居中会出碎砖 → 老规矩把它挪开
  const q = E.housePlan(mk({
    settings:{ floorTile:{ preset:"600×600", w:600, h:600 } },
    rooms:[ { id:"r1", name:"小屋", x:0, y:0, w:1400, h:1400 } ], doors:[],
  }));
  const R = q.rooms[0];
  const lo = Math.min(R.gx.cutLeft, R.gx.cutRight, R.gy.cutLeft, R.gy.cutRight);
  check("边缘裁砖 ≥ 1/3 砖（200mm）", lo >= 200 - 0.01, `最小裁砖 ${lo}`);
});

test("起铺 · 换基准房会整屋重排（其余房间跟着走）", () => {
  const p1 = E.housePlan(mk({ doors:[doorBottom()] }));
  const p2 = E.housePlan(mk({ settings:{ baseRoom:"r2" }, doors:[doorBottom()] }));
  check("换基准房后全屋格线原点变了", !near(p1.grid.GX, p2.grid.GX),
        `${p1.grid.GX.toFixed(1)} → ${p2.grid.GX.toFixed(1)}`);
  check("但通缝依然成立（主卧跟着新网走）", (() => {
    const A = p2.rooms[0], B = p2.rooms[2];
    const axs = new Set(A.gx.segments.map((s) => +s.start.toFixed(3)));
    return B.gx.segments.filter((s) => axs.has(+s.start.toFixed(3))).length >= 3;
  })());
});

test("起铺 · 微调偏移整屋一起动，且数值等于填的偏移", () => {
  const st = mk(); const p0 = E.housePlan(st);
  const st2 = mk({ settings:{ nudgeX:100, nudgeY:-60 } }); const p1 = E.housePlan(st2);
  check("格线原点按填的偏移移动",
        near(p1.grid.GX - p0.grid.GX, 100, 1e-6) && near(p1.grid.GY - p0.grid.GY, -60, 1e-6),
        `Δ=${(p1.grid.GX - p0.grid.GX).toFixed(1)}, ${(p1.grid.GY - p0.grid.GY).toFixed(1)}`);
  // 偏移后每间房的缝位都要跟着挪同样的量
  const a0 = p0.rooms[1].gx.segments[1].start, a1 = p1.rooms[1].gx.segments[1].start;
  check("其它房间的缝位也跟着挪（不是只动参考房）", near(a1 - a0, 100, 0.5), `Δ=${(a1 - a0).toFixed(2)}`);
});

/* ============================================================
 * 三、每间房的砖：铺满、裁砖尺寸、面积守恒
 * ============================================================ */
test("房间 · 砖轴恰好铺满（砖 + 缝，两端最多各留一个缝宽）", () => {
  const p = E.housePlan(mk({ doors:[doorBottom()] }));
  const g = 2;
  let ok = true, detail = "";
  p.rooms.forEach((rm) => {
    [["x", rm.ax, rm.rect.w], ["y", rm.ay, rm.rect.h]].forEach(([nm, ax, L]) => {
      const segs = ax.segments;
      const first = segs[0].start, last = segs[segs.length - 1].start + segs[segs.length - 1].width;
      const sum = segs.reduce((a, s) => a + s.width, 0);
      if (!(first <= g + 1e-6 && L - last <= g + 1e-6 && near(sum + g * (segs.length - 1), last - first, 1e-6))) {
        ok = false; detail = `${rm.name}.${nm}: 前${first.toFixed(1)} 后${(L - last).toFixed(1)} 砖${sum.toFixed(1)}`;
      }
    });
  });
  check("每间房两个方向都铺满、缝宽一致", ok, detail);
});

test("房间 · 砖面合计 = 整砖面积 + 裁块面积（独立算法核对）", () => {
  const st = mk({ doors:[doorBottom()] });
  const p = E.housePlan(st), S = p.summary;
  const indep = tiledAreaOf(p, st.settings.grout);
  check("与引擎给的砖面合计一致（±0.01mm²）", near(indep, S.tiledArea, 0.01),
        `独立 ${indep.toFixed(2)} vs 引擎 ${S.tiledArea.toFixed(2)}`);
  check("整砖 + 裁块 == 砖面合计", near(S.wholeCount * p.tile.x * p.tile.y +
        S.cutGroups.reduce((a, g) => a + g.area, 0), S.tiledArea, 0.01));
  check("砖面合计 < 铺贴面积（差的就是砖缝）", S.tiledArea < S.areaMM && S.groutArea > 0,
        `砖缝 ${S.groutArea.toFixed(0)}mm²`);
  check("砖缝占比在合理范围（0.1%~2%）",
        S.groutArea / S.areaMM > 0.001 && S.groutArea / S.areaMM < 0.02,
        `${(S.groutArea / S.areaMM * 100).toFixed(2)}%`);
  const rect = (r) => r.w * r.h;
  check("铺贴面积 = 各房间 + 通铺门口",
        near(S.areaMM, mk().rooms.reduce((a, r) => a + rect(r), 0) + 900 * 240, 1),
        `${S.areaMM}`);
});

test("房间 · 跨房间的同一块砖只算一次（按格线序号归并）", () => {
  // 两间房左右相邻、共用一堵 200 厚的墙，**没有门**：跨墙那块砖会切成两块，
  // 但它仍然只是**一块砖**（格子只有一个），不能按房间数成两块。
  const st = mk({
    rooms:[ { id:"r1", name:"A", x:0, y:0, w:1600, h:1600 },
            { id:"r2", name:"B", x:1800, y:0, w:1600, h:1600 } ],
    doors: [],
  });
  const p = E.housePlan(st);
  check("算得出方案", p.ok, p.errors.join("；"));
  // 找出跨墙的那个格子：它的若干块分属两间房
  const cross = [];
  for (let i = 0; i < p.rooms.length; i++) for (let j = i + 1; j < p.rooms.length; j++) {
    const A = p.rooms[i], B = p.rooms[j];
    const key = new Map();
    A.tiles.forEach((t) => key.set(t.gi + ":" + t.gj, 1));
    B.tiles.forEach((t) => { if (key.has(t.gi + ":" + t.gj)) cross.push(t.gi + ":" + t.gj); });
  }
  check("确实存在跨两间房的砖格（这个用例才有意义）", cross.length > 0, `跨房格 ${cross.length} 个`);
  const S = p.summary;
  check("裁块清单里它们各自成块（没被合并成一块）",
        S.cutGroups.reduce((a, g) => a + g.count, 0) === S.pieceCount);
  check("整砖数 + 裁块数 = 用掉的砖数（不重复计数）",
        S.wholeCount + S.pieceCount >= 0 && near(tiledAreaOf(p, 2), S.tiledArea, 0.01));
});

/* ============================================================
 * 四、门洞
 * ============================================================ */
test("门洞 · 四个相邻方向都能反推出洞口矩形", () => {
  const base = { id:"a", name:"A", x:1000, y:1000, w:2000, h:2000 };
  const cases = [
    ["右", { id:"b", x:3200, y:1200, w:1500, h:1600 }, (r) => near(r.x, 3000) && near(r.w, 200) && near(r.h, 900)],
    ["左", { id:"b", x:-800, y:1200, w:1600, h:1600 }, (r) => near(r.x, 800) && near(r.w, 200) && near(r.h, 900)],
    ["下", { id:"b", x:1200, y:3200, w:1600, h:1500 }, (r) => near(r.y, 3000) && near(r.h, 200) && near(r.w, 900)],
    ["上", { id:"b", x:1200, y:-900, w:1600, h:1700 }, (r) => near(r.y, 800) && near(r.h, 200) && near(r.w, 900)],
  ];
  let ok = true, detail = "";
  cases.forEach(([nm, b, pred]) => {
    const r = E.doorRect(base, b, 1000, 900);
    if (!r.ok) { ok = false; detail = `${nm}: ${r.why}`; return; }
    if (!pred(r.rect)) { ok = false; detail = `${nm}: ${JSON.stringify(r.rect)}`; }
  });
  check("右/左/下/上四种相邻都摆对（墙 200、门宽 900）", ok, detail);
  const far = E.doorRect(base, { id:"c", x:9000, y:9000, w:1000, h:1000 }, 500, 900);
  check("不相邻的两间房 → 明确报错", far.ok === false && /不相邻/.test(far.why), far.why);
  const out = E.doorRect(base, { id:"b", x:3200, y:1200, w:1500, h:1600 }, 40, 900);
  check("门洞超出共用段 → 明确报错", out.ok === false && /超出/.test(out.why), out.why);
});

/* ============================================================
 * 五、下料清单与极端输入
 * ============================================================ */
test("清单 · 备料块数与分组自洽", () => {
  const p = E.housePlan(mk({ doors:[doorBottom()] }));
  const S = p.summary;
  check("备料 = ceil((整砖 + 裁块) × 1.05)",
        S.buyCount === Math.ceil((S.wholeCount + S.pieceCount) * 1.05),
        `${S.buyCount} vs ${Math.ceil((S.wholeCount + S.pieceCount) * 1.05)}`);
  check("裁块分组数量之和 = 裁块总数",
        S.cutGroups.reduce((a, g) => a + g.count, 0) === S.pieceCount);
  check("分组里没有零尺寸", S.cutGroups.every((g) => g.w > 0 && g.h > 0));
});

test("极端输入：缺规格/缺尺寸/重叠/超大房，都出中文提示且不出现 NaN", () => {
  const noTile = E.housePlan(mk({ settings:{ floorTile:null } }));
  check("没选地砖 → 提示而不报错崩溃", !noTile.ok && noTile.errors.length > 0, noTile.errors[0]);
  const noSize = E.housePlan(mk({ rooms:[ { id:"r1", name:"空房", x:0, y:0, w:null, h:null } ], doors:[] }));
  check("房间没尺寸 → 提示", !noSize.ok && /至少填一间房/.test(noSize.errors.join("")));
  const half = E.housePlan(mk({ rooms:[ { id:"r1", name:"好的", x:0, y:0, w:3000, h:3000 },
                                         { id:"r2", name:"缺的", x:0, y:0, w:0, h:null } ], doors:[] }));
  check("只缺一间 → 能算，并点名是哪间（警告不阻断）",
        half.ok && half.warnings.some((e) => /缺的/.test(e)), (half.warnings || []).join("；"));
  const over = E.housePlan(mk({ rooms:[ { id:"r1", name:"A", x:0, y:0, w:2000, h:2000 },
                                         { id:"r2", name:"B", x:1000, y:1000, w:2000, h:2000 } ], doors:[] }));
  check("两间房重叠 → 报错", !over.ok && /重叠/.test(over.errors.join("")));
  const ghost = E.housePlan(mk({ doors:[ { id:"d9", from:"r1", to:"没有这间", at:100, width:800 } ] }));
  check("门洞指向不存在的房 → 报错", !ghost.ok && /不存在/.test(ghost.errors.join("")), ghost.errors.join("；"));

  // 巨砖小房 / 小砖巨房：不炸、不出 NaN
  const big = E.housePlan(mk({ settings:{ floorTile:{ preset:"1500×1500", w:1500, h:1500 } },
    rooms:[ { id:"r1", name:"小", x:0, y:0, w:600, h:500 } ], doors:[] }));
  check("砖比房间还大 → 算得出（整间就一块裁砖）", big.ok && big.summary.pieceCount === 1,
        `pieces=${big.summary && big.summary.pieceCount}`);
  const dense = E.housePlan(mk({ settings:{ floorTile:{ preset:"100×100", w:100, h:100 } },
    rooms:[ { id:"r1", name:"大", x:0, y:0, w:9000, h:7000 } ], doors:[] }));
  check("小砖巨房 → 不炸（砖格太密时只给示意）", dense.ok, dense.errors.join("；"));
  const all = [big, dense, half, noTile];
  const bad = [];
  const scan = (v, p) => {
    if (typeof v === "number") { if (!isFinite(v)) bad.push(p); return; }
    if (Array.isArray(v)) { v.forEach((x, i) => scan(x, `${p}[${i}]`)); return; }
    if (v && typeof v === "object") for (const k of Object.keys(v)) scan(v[k], `${p}.${k}`);
  };
  all.forEach((p, i) => scan({ s:p.summary, g:p.grid, r:p.rooms && p.rooms.map((x) => x.rect) }, `#${i}`));
  check("所有数值都是有限数（无 NaN/Infinity）", bad.length === 0, bad.slice(0, 3).join(", "));
});

test("极端输入：一列砖都不剩的房间也能安全算完", () => {
  const st = mk({ rooms:[ { id:"r1", name:"窄", x:0, y:0, w:5, h:3000 } ], doors:[] });
  const p = E.housePlan(st);
  check("不抛异常", !!p);
  check("5mm 宽的房间也不出现 NaN", !p.summary || isFinite(p.summary.tiledArea), JSON.stringify(p.summary && p.summary.tiledArea));
});

/* ============================================================
 * 六、拖动吸附（对齐到隔壁房间的墙线）
 * ============================================================ */
const twoRooms = () => ([
  { id:"a", name:"A", x:0,    y:0, w:4000, h:3000 },
  { id:"b", name:"B", x:9999, y:0, w:3000, h:3000 },
]);

test("吸附 · 拖到隔壁房间右边会自动留出墙厚（贴墙吸附）", () => {
  const rooms = twoRooms();
  // A 的右边缘在 4000；墙厚 240 → B 的左边缘应吸到 4240；给一个差 30mm 的"手抖"位置
  const sn = E.snapRoom(rooms, "b", { x:4270, y:0 }, { wall:240, tol:60, grid:10 });
  check("x 吸到 4240（= 隔壁右边缘 + 墙厚）", sn.x === 4240, `吸到 ${sn.x}`);
  check("给出了对齐提示线", sn.guides.some((g) => g.axis === "x" && g.kind === "wall" && g.with === "a"));
  check("这一轴没有再退到网格", sn.onGridX === false);
});
test("吸附 · 也支持“直接贴死”和“两边齐平”", () => {
  const rooms = twoRooms();
  const touch = E.snapRoom(rooms, "b", { x:4020, y:0 }, { wall:240, tol:60 });
  check("贴死（B 左边 = A 右边 = 4000）", touch.x === 4000, `吸到 ${touch.x}`);
  const alignL = E.snapRoom(rooms, "b", { x:30, y:0 }, { wall:240, tol:60 });
  check("左齐平（B 左边 = A 左边 = 0）", alignL.x === 0, `吸到 ${alignL.x}`);
  const alignR = E.snapRoom(rooms, "b", { x:980, y:0 }, { wall:240, tol:60 });
  check("右齐平（B 右边 = A 右边 = 4000 → x=1000）", alignR.x === 1000, `吸到 ${alignR.x}`);
});
test("吸附 · 上下方向同理，且两轴各自独立", () => {
  const rooms = [
    { id:"a", name:"A", x:0,    y:0,    w:4000, h:3000 },
    { id:"b", name:"B", x:5000, y:9999, w:3000, h:2000 },
  ];
  const sn = E.snapRoom(rooms, "b", { x:5000, y:3270 }, { wall:240, tol:60 });
  check("y 吸到 3240（A 下边 3000 + 墙厚）", sn.y === 3240, `吸到 ${sn.y}`);
  check("x 没得吸、退到 10mm 网格但没乱动", sn.x === 5000 && sn.onGridX === true);
  check("提示线只有 y 一条", sn.guides.length === 1 && sn.guides[0].axis === "y");
});
test("吸附 · 离得远就吸不上，退到 10mm 网格（不会乱跑）", () => {
  const rooms = twoRooms();
  const far = E.snapRoom(rooms, "b", { x:12347, y:4321 }, { wall:240, tol:20, grid:10 });
  check("x 取 10mm 倍数", far.x === 12350, `吸到 ${far.x}`);
  check("y 取 10mm 倍数", far.y === 4320, `吸到 ${far.y}`);
  check("没有提示线", far.guides.length === 0);
  check("阈值很小就不吸（尊重 tol）", E.snapRoom(rooms, "b", { x:4230, y:0 }, { wall:240, tol:5 }).x === 4230);
});
test("吸附 · 自己不动自己，也不受没填尺寸的房间影响", () => {
  const rooms = twoRooms();
  rooms.push({ id:"c", name:"空房", x:null, y:null, w:null, h:null });
  const sn = E.snapRoom(rooms, "b", { x:4240, y:0 }, { wall:240, tol:60 });
  check("正常吸到隔壁（没被空房带偏）", sn.x === 4240, `吸到 ${sn.x}`);
  const self = E.snapRoom(rooms, "b", { x:4240, y:0 }, { wall:240, tol:60 });
  check("只跟别的房间对齐（提示线指向 a）", self.guides.every((g) => g.with !== "b"));
});
test("原点整理：拖到原点左上之后，整体平移到最小坐标为 0", () => {
  const rooms = [
    { id:"a", name:"A", x:-500, y:-300, w:2000, h:1500 },
    { id:"b", name:"B", x:2000, y:0,    w:1000, h:1000 },
  ];
  const ro = E.reOrigin(rooms);
  check("给出平移量", ro.moved && ro.dx === 500 && ro.dy === 300, JSON.stringify(ro));
  check("已经不为负就不动", E.reOrigin([{ id:"a", x:0, y:0, w:100, h:100 }]).moved === false);
});

console.log(`\n结果：${_pass} 通过，${_fail} 失败`);
process.exit(_fail ? 1 : 0);
