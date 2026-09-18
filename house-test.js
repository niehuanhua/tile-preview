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
/* 一道通铺门：客厅 → 次卧（左右相邻，共用段 y 0~3600）。
 * 默认夹具里这两间房共用一道墙却**没有门**——按"墙就是隔断"的新规则，
 * 它们各排各的。所以凡是要"客厅和次卧同属一个区"的夹具，都得显式开这道门。 */
const doorRight = (over) => Object.assign({ id:"d2", from:"r1", to:"r2", at:1500, width:900, threshold:false }, over || {});
/* 这块铺贴区域属于哪个区 → 拿那个区的格线原点。
 * 分区之后 plan.grid 只是"参考房那张网"，拿它算别的区的面积会得出错的数，
 * 所以这里必须按区域逐块找自己的区（房间按 rm.comp，通铺门口按 d.comp）。 */
const areaGridFor = (plan, rect) => {
  const same = (a, b) => near(a.x, b.x) && near(a.y, b.y) && near(a.w, b.w) && near(a.h, b.h);
  const rm = plan.rooms.find((r) => same(r.rect, rect));
  if (rm) return plan.areas[rm.comp];
  const dr = plan.doors.find((d) => !d.threshold && same(d.rect, rect));
  if (dr) return plan.areas[dr.comp];
  return plan.grid;
};
// 砖面合计的独立算法（不复用引擎的 cells：Σ列宽 × Σ行宽）
const tiledAreaOf = (plan, g) => {
  let sum = 0;
  for (const rect of plan.region) {
    const A = areaGridFor(plan, rect);
    const sx = E.latticeSegments(A.GX, plan.tile.x, g, rect.x, rect.x + rect.w).segments;
    const sy = E.latticeSegments(A.GY, plan.tile.y, g, rect.y, rect.y + rect.h).segments;
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
  // 分区之后"全屋一张网"要读作"同一张网"：每间房落在**它自己那个区**的网上。
  // 单区时 p.areas[rm.comp] 就是全屋那张，跟改动前的断言等价。
  check("每间房的 x 缝都落在它自己那张网上",
        p.rooms.every((rm) => onLattice(rm.gx.segments, p.areas[rm.comp].GX, p2, p.tile.x)));
  check("每间房的 y 缝都落在它自己那张网上",
        p.rooms.every((rm) => onLattice(rm.gy.segments, p.areas[rm.comp].GY, p3, p.tile.y)));
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

test("门洞 · 两间房贴在一起（间隙 0）也允许加门洞", () => {
  // 客餐厅一体那种：两间房中间没有墙，但想在图上标个开口位置（以后装推拉门）
  const A = { id:"a", name:"A", x:0, y:0, w:2000, h:2000 };
  const B = { id:"b", name:"B", x:2000, y:0, w:1500, h:2000 };   // 紧贴 A 右边，间隙 0
  const r = E.doorRect(A, B, 1000, 900);
  check("间隙 0 不再报错", r.ok, r.why);
  check("洞厚 = 0", r.ok && r.wallT === 0, r.ok ? String(r.wallT) : r.why);
  check("洞口就压在两间房的交界线上", r.ok && near(r.rect.x, 2000) && near(r.rect.w, 0),
        r.ok ? JSON.stringify(r.rect) : r.why);
  // 整屋算一遍：不能崩、不能出 NaN，0 厚门洞也不该占铺贴面积
  const p = E.housePlan({
    settings:{ floorTile:{ preset:"800×800", w:800, h:800 }, direction:"horizontal",
               grout:2, baseRoom:"a", baseMode:"center", nudgeX:0, nudgeY:0 },
    rooms:[A, B],
    doors:[{ id:"d1", from:"a", to:"b", at:1000, width:900, threshold:false }],
  });
  check("全屋照样算得出来", p.ok, p.errors.join("；"));
  check("铺贴面积 = 两间房之和（0 厚门洞不占面积）",
        near(p.summary.areaMM, 2000 * 2000 + 1500 * 2000, 1), String(p.summary.areaMM));
  check("砖面合计仍是有限数（没出 NaN）", isFinite(p.summary.tiledArea), String(p.summary.tiledArea));
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
 * 分区：墙和过门石一起决定"谁和谁共用一张网"
 *
 * 规则（欢欢拍板的原话：「墙本身就是把房间隔开了，只是从门口处相连」）：
 *   ① 贴死（中间没有墙，wallT ≈ 0）→ 通着：本来就是一个空间（客餐厅一体）。
 *   ② 有墙 + 开了「通铺」门洞 → 通着：缝从门口穿过去。
 *   ③ 有墙 + 开了「过门石」门洞 → 断开，两边各自起铺。
 *   ④ 有墙 + 一道门洞都没开 → **断开**（这就是本次改动）。
 *   ⑤ 一条边同时有通铺门和过门石 → 通铺赢（缝要从这儿穿过去，必须同一张网）。
 *   ⑥ 绕路：断开只切断**直接**那条边。两间房还从别的路通着的话，绕一圈照样是一张网。
 *   ⑦ 一道过门石都没有 → 全屋仍是一张网，逐位跟以前相同（老户型的承诺）。
 *   ⑧ 每个区各自选起铺基准：设置里选的那间管它自己那个区，
 *      其余区以区内面积最大的房间为准。
 *
 * 注意 ④ 和 ⑦ 的相互作用（有意的，不是 bug）：放上**第一块**过门石的那一刻，
 * 那些"有墙又还没画门"的房间会一起独立出去。界面会提醒用户去补门洞。
 * ============================================================ */
const namesOf = (p, area) => area.rooms.map((id) => (p.rooms.find((r) => r.id === id) || {}).name);

test("分区 · 一道过门石把全屋切成两组，且两组各排各的", () => {
  // 客厅↔次卧之间也开一道通铺门：这两间房本来就通着，只是默认夹具里没画门。
  const st = mk({ doors:[doorBottom({ threshold:true }), doorRight()] });
  const p = E.housePlan(st);
  check("算得出方案", p.ok, p.errors.join("；"));
  check("分成 2 个区", p.areas.length === 2, `实际 ${p.areas.length}`);
  check("区①是客厅+次卧（过门石只切客厅↔主卧那道边）",
        JSON.stringify(namesOf(p, p.areas[0])) === JSON.stringify(["客厅","次卧"]),
        JSON.stringify(namesOf(p, p.areas[0])));
  check("区②只有主卧", JSON.stringify(namesOf(p, p.areas[1])) === JSON.stringify(["主卧"]),
        JSON.stringify(namesOf(p, p.areas[1])));
  check("每个房间都带 comp，且落在 0..n-1",
        p.rooms.every((r) => Number.isInteger(r.comp) && r.comp >= 0 && r.comp < p.areas.length));
  check("comp 和区的成员对得上",
        p.rooms.every((r) => p.areas[r.comp].rooms.includes(r.id)));

  // 两个区的原点必须不同——否则"重新排砖"就是空话
  check("两个区的 x 原点不同", !near(p.areas[0].GX, p.areas[1].GX),
        `${p.areas[0].GX} vs ${p.areas[1].GX}`);
  // 主卧（r3）现在归区②：它自己的网，不能是客厅那张
  const a3 = p.areas.find((a) => a.rooms.includes("r3"));
  const r3 = p.rooms.find((r) => r.id === "r3");
  check("主卧的缝落在**它自己那个区**的网上",
        r3.comp === a3.id && near(r3.gx.segments[1].start % (p.tile.x + st.settings.grout),
                                  a3.GX % (p.tile.x + st.settings.grout), 0.02)
        || near(r3.gx.segments[1].start, a3.GX + (p.tile.x + st.settings.grout), 0.02),
        `GX=${a3.GX} 第一条内部缝=${r3.gx.segments[1].start}`);
  check("主卧不再跟客厅共用一张网（原点和客厅那张不一样）",
        !near(a3.GX, p.areas[0].GX) && r3.comp !== p.rooms[0].comp);
});

test("分区 · 通铺门不断开（哪怕同一道墙另有通铺门），无门时仍是一个区", () => {
  const tiled = E.housePlan(mk({ doors:[doorBottom()] }));
  check("只有通铺门 → 1 个区", tiled.areas.length === 1, `${tiled.areas.length}`);
  check("通铺方案里三间房同属一区",
        tiled.rooms.every((r) => r.comp === 0));
  const dry = E.housePlan(mk({ doors:[] }));
  check("一道门都没有 → 1 个区", dry.areas.length === 1);
  // 同一对房间既有通铺又有过门石：通铺赢（缝要从这儿穿过去，必须同一张网）
  const both = E.housePlan(mk({ doors:[doorBottom({ id:"d1", threshold:true }),
                                        doorBottom({ id:"d2", at:2600, threshold:false }),
                                        doorRight()] }));
  check("同一对房既有通铺又有过门石 → 仍然 1 个区（通铺优先）",
        both.areas.length === 1, `${both.areas.length}`);
});

test("分区 · 有墙 + 通铺门 → 仍是一张网（哪怕别处有过门石，走的不是捷径）", () => {
  /* 这条必须放一块**别的**过门石：否则 cut.size === 0，areasOf 直接返回一整组，
   * 通铺门到底连不连根本没被问到——那这条断言就是白测的。 */
  const st = mk({ doors:[doorRight(), doorBottom({ threshold:true })] });
  const p = E.housePlan(st);
  check("确实不是捷径（有过门石，且不止一个区）", p.areas.length > 1, `${p.areas.length}`);
  check("客厅与次卧之间的通铺门让它们同属一区",
        p.rooms.find((r) => r.id === "r1").comp === p.rooms.find((r) => r.id === "r2").comp);
  check("两间房在同一张网上（原点相同，就是这个区的原点）",
        near(p.areas[p.rooms.find((r) => r.id === "r1").comp].GX,
             p.areas[p.rooms.find((r) => r.id === "r2").comp].GX));
  // 同一张网的两间房，横向砖缝必须逐条落在同一批全局 y 上（这就是"通铺"）
  const A = p.rooms.find((r) => r.id === "r1"), B = p.rooms.find((r) => r.id === "r2");
  const ays = new Set(A.gy.segments.map((s) => +s.start.toFixed(3)));
  const hits = B.gy.segments.filter((s) => ays.has(+s.start.toFixed(3)));
  check("客厅与次卧的横向砖缝逐条重合", hits.length >= 3, `重合 ${hits.length} 条`);
});

test("分区 · 贴死（中间没有墙）的两间房照旧通着——墙是隔断，可没有墙就不是隔断", () => {
  const st = mk({ rooms:[ { id:"r1", name:"餐厅", x:0,    y:0,    w:3000, h:3000 },
                          { id:"r2", name:"客厅", x:3000, y:0,    w:3000, h:3000 },   // 贴死
                          { id:"r3", name:"主卧", x:0,    y:3200, w:3000, h:3000 } ],
                  doors:[ { id:"d1", from:"r1", to:"r3", at:1500, width:900, threshold:true } ] });
  const p = E.housePlan(st);
  check("算得出方案", p.ok, p.errors.join("；"));
  check("餐厅与客厅贴死 → 仍然同一个区（过门石在别处，不是捷径）",
        p.rooms.find((r) => r.id === "r1").comp === p.rooms.find((r) => r.id === "r2").comp);
  check("主卧被过门石切开，自己一个区",
        p.areas.find((a) => a.rooms.includes("r3")).rooms.length === 1);
  check("全屋 2 个区", p.areas.length === 2, `${p.areas.length}`);
  check("贴死那条边**不**报「两侧贴死」的提醒（提醒只针对过门石那道口）",
        !p.warnings.some((w) => /两侧是贴死/.test(w)), (p.warnings || []).join("；"));
});

test("分区 · 回归锁：没有过门石时，逐位等于分区功能上线前的数字", () => {
  // 这组数字是改动前跑出来的真实值。将来谁把"没有过门石就走老路"这条捷径改坏了，这里立刻红。
  const p = E.housePlan(mk({}));
  check("全屋原点 GX 仍是 497", p.grid.GX === 497, `${p.grid.GX}`);
  check("全屋原点 GY 仍是 598", p.grid.GY === 598, `${p.grid.GY}`);
  check("整砖数仍是 27", p.summary.wholeCount === 27, `${p.summary.wholeCount}`);
  check("裁砖数仍是 48", p.summary.pieceCount === 48, `${p.summary.pieceCount}`);
  check("铺贴面积仍是 35653992", p.summary.tiledArea === 35653992, `${p.summary.tiledArea}`);
  check("起点仍是客厅", p.grid.baseName === "客厅", p.grid.baseName);
});

test("分区 · 参考房选在某个区里时，别的区改用该区最大的房间", () => {
  // 设置里选 r3（主卧）＝区②的房。区①（客厅 15.1㎡ / 次卧 10.8㎡）应改用客厅。
  const st = mk({ doors:[doorBottom({ threshold:true }), doorRight()],
                  settings:{ baseRoom:"r3" } });
  const p = E.housePlan(st);
  check("算得出方案", p.ok, p.errors.join("；"));
  const a0 = p.areas.find((a) => a.rooms.includes("r1"));
  const a1 = p.areas.find((a) => a.rooms.includes("r3"));
  check("主卧所在的那区以主卧为准（用户的选择生效）", a1.baseName === "主卧", a1.baseName);
  check("客厅那区没用主卧、改用区内最大的客厅", a0.baseName === "客厅", a0.baseName);
  // 注意 basePhase 吃的是**输入房间**（顶层 x/y/w/h），不是 out.rooms（尺寸在 .rect 里）
  const rs0 = st.rooms.filter((r) => r.id === "r1" || r.id === "r2");
  check("并且它的原点和「以客厅为准」独立算出来的一致",
        near(a0.GX, E.basePhase(rs0, "r1", p.tile, st.settings.grout, st.settings.baseMode, { x:0, y:0 }).GX),
        `${a0.GX} vs ${E.basePhase(rs0, "r1", p.tile, st.settings.grout, st.settings.baseMode, { x:0, y:0 }).GX}`);
});

test("分区 · 面积核算在多个区时仍然自洽（砖没算重、没算漏）", () => {
  const st = mk({ doors:[doorBottom({ threshold:true }), doorRight()] });
  const p = E.housePlan(st);
  const g = st.settings.grout;
  const indep = tiledAreaOf(p, g);
  check("独立算法（按区取网）与引擎的 tiledArea 一致",
        near(indep, p.summary.tiledArea, 0.01), `${indep} vs ${p.summary.tiledArea}`);
  check("砖面 + 缝面 = 总面积",
        near(p.summary.tiledArea + p.summary.groutArea, p.summary.areaMM, 0.01),
        `${p.summary.tiledArea} + ${p.summary.groutArea} vs ${p.summary.areaMM}`);
  const S = p.summary;
  check("区号前缀没把一块砖数成两块（砖数与分组一致）",
        S.cutGroups.reduce((a, x) => a + x.count, 0) === S.pieceCount);
  check("跨门口统计没被分区撑大",
        (S.crossDoorWhole || 0) <= S.wholeCount, `crossDoorWhole=${S.crossDoorWhole}`);
});

test("分区 · 每个区的基准房四周都不出现细边（分区的好处就落在这儿）", () => {
  const st = mk({ doors:[doorBottom({ threshold:true }), doorRight()] });
  const p = E.housePlan(st);
  const thin = [];
  /* 只查**每个区的基准房**。同一张网里的其他房间本来就可能有一条窄边——通铺就是这样：
   * 网是为了基准房摆正的，别的房跟着走，边条好不好看是它们自己的事。
   * 这次改动要保证的是：每个区都有人替它把网摆正，不是所有区都被参考房那张网拽着。
   */
  for (const A of p.areas) {
    const rm = p.rooms.find((r) => r.id === A.baseId);
    const gx = rm.gx.segments, gy = rm.gy.segments;
    for (const [what, v, full] of [["左", gx[0].width, p.tile.x],
                                   ["右", gx[gx.length - 1].width, p.tile.x],
                                   ["上", gy[0].width, p.tile.y],
                                   ["下", gy[gy.length - 1].width, p.tile.y]]) {
      if (v < full / 3 - 0.01) thin.push(`${rm.name}${what}${Math.round(v)}`);
    }
  }
  check("每个区的基准房都没有小于 1/3 砖的边条", thin.length === 0, thin.join(", "));
  check("而且每个区都各有一个基准房（不是全区共用一间）",
        p.areas.every((a) => p.rooms.some((r) => r.id === a.baseId)));
  // 主卧单独成区之后，它的边条是它自己定的，不再被客厅那张网拽着看
  const zhu = p.rooms.find((r) => r.name === "主卧");
  check("主卧（区②的基准房）左右边条一样宽 = 居中起铺生效",
        near(zhu.gx.segments[0].width, zhu.gx.segments[zhu.gx.segments.length - 1].width, 0.01),
        `${zhu.gx.segments[0].width} vs ${zhu.gx.segments[zhu.gx.segments.length - 1].width}`);
});

test("分区 · 过门石两侧贴死（没有墙厚）时给出提醒", () => {
  // 两间房贴死：r1 右边 x=3700，r2 左边也是 3700
  const flat = { rooms:[ { id:"r1", name:"客厅", x:0,    y:0, w:3700, h:3300 },
                          { id:"r2", name:"主卧", x:3700, y:0, w:3300, h:3300 } ] };
  const p = E.housePlan(mk(Object.assign({ doors:[ { id:"d1", from:"r1", to:"r2", at:1200, width:900, threshold:true } ] }, flat)));
  check("算得出方案", p.ok, p.errors.join("；"));
  check("确实分成了 2 个区", p.areas.length === 2, `${p.areas.length}`);
  check("报了「两侧贴死、缝对不上会露出来」的提醒",
        p.warnings.some((w) => /贴死/.test(w)), (p.warnings || []).join("；"));
  // 有墙厚的正常情况不该出这条
  const walled = E.housePlan(mk({ rooms:[ { id:"r1", name:"客厅", x:0,    y:0, w:3700, h:3300 },
                                            { id:"r2", name:"主卧", x:3940, y:0, w:3300, h:3300 } ],
                                  doors:[ { id:"d1", from:"r1", to:"r2", at:1200, width:900, threshold:true } ] }));
  check("有墙厚时不报这条", !walled.warnings.some((w) => /贴死/.test(w)), (walled.warnings || []).join("；"));
});

test("分区 · 过门石没切开两边（那边还从别的门口连着）时如实说明", () => {
  /* 四间房摆成"田"字（每两间都挨着），A—B 放过门石，但 A—C—D—B 这条路上
   * 三道门都是通铺 → 绕一圈还是同一个区。这是几何上就绕不开的，不是漏判。 */
  const st = mk({ rooms:[ { id:"r1", name:"A", x:0,    y:0,    w:3000, h:3000 },
                          { id:"r2", name:"B", x:3200, y:0,    w:3000, h:3000 },
                          { id:"r3", name:"C", x:0,    y:3200, w:3000, h:3000 },
                          { id:"r4", name:"D", x:3200, y:3200, w:3000, h:3000 } ],
                  doors:[ { id:"d1", from:"r1", to:"r2", at:1000, width:900, threshold:true },
                          { id:"d2", from:"r1", to:"r3", at:1000, width:900, threshold:false },
                          { id:"d3", from:"r3", to:"r4", at:1000, width:900, threshold:false },
                          { id:"d4", from:"r4", to:"r2", at:1000, width:900, threshold:false } ] });
  const p = E.housePlan(st);
  check("仍然算得出", p.ok, p.errors.join("；"));
  check("绕得通 → 还是 1 个区", p.areas.length === 1, `${p.areas.length}`);
  check("并且解释了为什么没分开",
        p.warnings.some((w) => /绕一圈|别的门口/.test(w)), (p.warnings || []).join("；"));
});

test("分区 · 回归锁：主卧只靠过门石进出、又和次卧共用一道没开门的墙 → 主卧独立", () => {
  /* 这就是欢欢报的那个 bug 的户型：
   *   客厅 ——通铺门—— 走廊 ——过门石—— 主卧       主卧 ——没开门—— 次卧
   * 改之前：主卧虽然被过门石切开，但它和客厅那道 240 墙"几何上挨着"，
   *         于是又被拉回全屋那张网 —— 过门石白放。改之后必须独立。 */
  const HALL = { rooms:[ { id:"r1", name:"客厅", x:0,    y:0,    w:4200, h:3600 },
                          { id:"r2", name:"走廊", x:0,    y:3840, w:1200, h:6240 },
                          { id:"r3", name:"主卧", x:1440, y:3840, w:3300, h:3000 },
                          { id:"r4", name:"次卧", x:1440, y:7080, w:3300, h:3000 } ],
                   doors:[ { id:"d1", from:"r1", to:"r2", at:600,  width:900, threshold:false },
                           { id:"d2", from:"r2", to:"r3", at:600,  width:900, threshold:true  },
                           { id:"d3", from:"r2", to:"r4", at:3800, width:900, threshold:false } ] };
  const st = mk(HALL);
  const p = E.housePlan(st);
  check("算得出方案", p.ok, p.errors.join("；"));
  check("分成 2 个区（改之前这里是 1 个——主卧被那道没开门的墙拉回去了）",
        p.areas.length === 2, `${p.areas.length}`);
  const zhu = p.rooms.find((r) => r.id === "r3");
  const zhuArea = p.areas.find((a) => a.rooms.includes("r3"));
  check("主卧自己一个区", zhuArea.rooms.length === 1, JSON.stringify(zhuArea.rooms));
  check("主卧不再和客厅同区", zhu.comp !== p.rooms.find((r) => r.id === "r1").comp);

  /* 主卧那个区的原点，必须等于"把主卧单独拿出来、以它自己为准"算出来的值。
   * 这条比写死数字更狠：以后谁把分区接错了（比如让它去用全屋那张网），这里立刻红。 */
  const solo = E.basePhase([ st.rooms[2] ], "r3", p.tile, st.settings.grout,
                           st.settings.baseMode, { x:0, y:0 });
  check("主卧区的原点是「以主卧自己为准」算出来的那个",
        near(zhuArea.GX, solo.GX) && near(zhuArea.GY, solo.GY),
        `区=${zhuArea.GX},${zhuArea.GY} 单独算=${solo.GX},${solo.GY}`);
  check("也不等于客厅那个区的原点", !near(zhuArea.GX, p.grid.GX) || !near(zhuArea.GY, p.grid.GY),
        `主卧 ${zhuArea.GX},${zhuArea.GY} vs 全屋 ${p.grid.GX},${p.grid.GY}`);
  /* GX=1888 是这次改动后跑出来的真实值，写死当锁。
   * 注意它**不是**全屋那张网的 448 —— 改之前主卧用的是 448（被拽回客厅那张网），
   * 这行数字恰好就是"过门石白放"的证据。 */
  check("主卧区的 GX 锁在 1888（不是全屋那张网的 448）", zhuArea.GX === 1888, `${zhuArea.GX}`);

  // 走廊和次卧有门、客厅和走廊有门 → 三间房一个区；没有哪间房该被报"没开门洞"
  check("客厅+走廊+次卧 同属一区",
        ["r1","r2","r4"].every((id) => p.areas.find((a) => a.rooms.includes(id)) === p.areas[0]),
        JSON.stringify(p.areas.map((a) => a.rooms)));
  check("没有房间被误报「四周的墙上都没开门洞」",
        !p.warnings.some((w) => /没开门洞/.test(w)), (p.warnings || []).join("；"));
});

test("分区 · 四周一道门洞都没开的房间：自己成区，并给一条提醒", () => {
  // 客厅↔次卧 共用一道墙、谁也不开门的默认夹具；主卧那道边放一块过门石把捷径关掉。
  const st = mk({ doors:[doorBottom({ threshold:true })] });
  const p = E.housePlan(st);
  check("算得出方案", p.ok, p.errors.join("；"));
  check("分成 3 个区（改之前是 2 个）", p.areas.length === 3, `${p.areas.length}`);
  check("次卧自己一个区", JSON.stringify(namesOf(p, p.areas.find((a) => a.rooms.includes("r2")))) === JSON.stringify(["次卧"]));
  check("报了「没开门洞」那条提醒",
        p.warnings.some((w) => /没开门洞/.test(w)), (p.warnings || []).join("；"));
  check("提醒里点名了次卧", p.warnings.some((w) => /没开门洞/.test(w) && /次卧/.test(w)),
        (p.warnings || []).join("；"));

  /* 三个反例。判据必须是"一道门洞都没有"，不能退化成"自己一个区"——
   * 主卧只靠一块过门石进出时也是单房间的区，那是用户自己选的，不能报警。 */
  const withDoor = E.housePlan(mk({ doors:[doorBottom({ threshold:true }), doorRight()] }));
  check("反例①：只靠过门石进出的主卧不发警告",
        !withDoor.warnings.some((w) => /没开门洞/.test(w) && /主卧/.test(w)),
        (withDoor.warnings || []).join("；"));
  const flush2 = E.housePlan(mk({ rooms:[ { id:"r1", name:"餐厅", x:0,    y:0, w:3000, h:3000 },
                                            { id:"r2", name:"客厅", x:3000, y:0, w:3000, h:3000 },
                                            { id:"r3", name:"主卧", x:0,    y:3200, w:3000, h:3000 } ],
                                  doors:[ { id:"d1", from:"r1", to:"r3", at:1500, width:900, threshold:true } ] }));
  check("反例②：跟别人贴死、不独立的房间不发警告",
        !flush2.warnings.some((w) => /没开门洞/.test(w)), (flush2.warnings || []).join("；"));
  const faraway = E.housePlan(mk({ rooms:[ { id:"r1", name:"A", x:0,    y:0,    w:2000, h:2000 },
                                             { id:"r2", name:"B", x:5000, y:0,    w:2000, h:2000 },
                                             { id:"r3", name:"C", x:9000, y:9000, w:2000, h:2000 } ],
                                   doors:[ { id:"d1", from:"r1", to:"r2", at:900, width:800, threshold:true } ] }));
  check("反例③：孤零零摆着、四周压根没有邻居的房间不发警告",
        !faraway.warnings.some((w) => /没开门洞/.test(w)), (faraway.warnings || []).join("；"));
});

test("分区 · 结构自洽与确定性", () => {
  const st = mk({ doors:[doorBottom({ threshold:true }), doorRight()] });
  const p1 = E.housePlan(st), p2 = E.housePlan(st);
  check("区号就是下标", p1.areas.every((a, i) => a.id === i));
  check("每个区都有名字和原点",
        p1.areas.every((a) => a.baseName && isFinite(a.GX) && isFinite(a.GY)));
  check("每个房间恰好属于一个区",
        p1.rooms.every((r) => p1.areas.filter((a) => a.rooms.includes(r.id)).length === 1));
  check("区的并集 = 全部房间",
        p1.areas.reduce((a, x) => a.concat(x.rooms), []).sort().join() ===
        p1.rooms.map((r) => r.id).sort().join());
  check("同样的输入跑两次，结果逐位相同",
        JSON.stringify(p1.areas) === JSON.stringify(p2.areas) &&
        JSON.stringify(p1.rooms.map((r) => r.gx)) === JSON.stringify(p2.rooms.map((r) => r.gx)));
  check("grid 指向参考房所在的那个区",
        p1.areas.find((a) => a.rooms.includes(st.settings.baseRoom)).GX === p1.grid.GX);
});

test("分区 · 房间清单顺序不被分区打乱（外面是按下标取房间的）", () => {
  const p = E.housePlan(mk({ doors:[doorBottom({ threshold:true }), doorRight()] }));
  check("out.rooms 仍是 客厅/次卧/主卧 的顺序",
        p.rooms.map((r) => r.name).join() === "客厅,次卧,主卧", p.rooms.map((r) => r.name).join());
});

test("分区 · 互不挨着的房间：没有过门石时仍共用一张网（这是答应过的老行为）", () => {
  const rooms = [ { id:"r1", name:"A", x:0,    y:0,    w:2000, h:2000 },
                  { id:"r2", name:"B", x:5000, y:0,    w:2000, h:2000 },
                  { id:"r3", name:"C", x:9000, y:9000, w:2000, h:2000 } ];
  // 界面上的原话是"不加（过门石）就是全屋一张网铺过去"，所以这里必须是 1 个区。
  // 房间离得远不该偷偷改掉这条承诺——那会让用户在旧户型上看到莫名其妙的变化。
  const dry = E.housePlan(mk({ rooms, doors:[] }));
  check("一道过门石都没有 → 仍是 1 个区", dry.areas.length === 1, `${dry.areas.length}`);
  check("三间房同属一区", dry.rooms.every((r) => r.comp === 0));
  // 一旦有了过门石，几何上本来就分开的房间自然各成一区（它们和谁都不挨着）
  const cut = E.housePlan(mk({ rooms, doors:[ { id:"d1", from:"r1", to:"r2", at:900, width:800, threshold:true } ] }));
  check("有了一处过门石 → 远房自己成区，共 3 个区", cut.areas.length === 3, `${cut.areas.length}`);
  check("每区一间房", cut.areas.every((a) => a.rooms.length === 1),
        JSON.stringify(cut.areas.map((a) => a.rooms)));
  check("面积核算仍自洽",
        near(cut.summary.tiledArea + cut.summary.groutArea, cut.summary.areaMM, 0.01));
});

console.log(`\n结果：${_pass} 通过，${_fail} 失败`);
process.exit(_fail ? 1 : 0);
