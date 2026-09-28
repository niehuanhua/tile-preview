/* sketch-test.js —— 房间布局草图.html 的验收
 *
 * 跑法：node sketch-test.js
 *
 * 最要紧的两条：
 *   测试 1  草图的 exportDoors 倒出来的门，喂进 house.html 的真引擎必须全部合法
 *           （house.html 遇到不合法门洞是**跳过那道门**、红字提醒、其余照排——
 *            不是白屏。所以串味的代价不是"一眼看出来"，而是那道门**悄没声地没了**：
 *            两间房不再连通 → 分区规则跟着变 → 全屋砖缝对不上、下料清单也是错的。
 *            只有机器能抓住这种错。）
 *   测试 2  草图的 doorAxis/doorRectOf 和 house.html 的 doorRect 逐字段一致
 *           （就是这条把「改了 house.html 要同步改草图」从注释变成机器检查）
 *
 * 抽取引擎段的办法和 house-test.js:7-12 一样：正则抠出 ENGINE 两行标记之间的代码，
 * 用 new Function 塞进独立作用域跑。所以引擎段里**不能引用 state/canvas**。
 */
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

const S = readEngine("房间布局草图.html");
const H = readEngine("house.html");

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

/* ============ 测试 1：跨工具契约（最要紧的一条） ============
 * house.html 遇到不合法门洞是**跳过那道门 + 红字**（house.html:791 的 continue），
 * 其余照常排砖、照常出清单。所以草图导出的每一道门都必须能被 house.html 的
 * 真引擎接受——被跳过的那道门不会报错崩掉，只会**安安静静地消失**。 */

const SETTINGS = {
  floorTile: { preset: "750×1500", w: 750, h: 1500 },
  direction: "horizontal", grout: 2, baseRoom: null, baseMode: "center",
  nudgeX: 0, nudgeY: 0, showCuts: true, wall: 240,
};

/* 户型的原点偏移：整个户型画在草图坐标系的哪儿。
 *
 * ★ 这是这个夹具里最要紧的一个参数，别把它改回「只取 0 或 0.5」。
 *   门在草图里存的是**草图坐标**（x/y 是绝对毫米），而房间在导出时会被
 *   整体平移 (minX, minY) 并取整。exportDoors 里凡是拿门的位置去和
 *   「用导出坐标算出来的共用段 ax.lo/ax.hi」比大小的地方，都必须先把门
 *   减掉这个原点，否则就是拿两把不同的尺子量同一段墙。
 *   偏移是 0 或 0.5 的时候，这个错最多只差半毫米——**完全看不出来**，
 *   这正是它当初能躲过 84 条断言的原因。所以这里必须掺进上千毫米的
 *   整数偏移，而且**正负都要有**：用户把房间往左上拖，minX/minY 就是负的，
 *   那才是线上真正会踩到的户型（拖动那边没有「不许出画布左上」的钳位）。 */
const orgPick = () => {
  const r = Math.random();
  if (r < 0.30) return 0.5;                     // 半毫米：逼出「at 必须用取整平移后的房间重算」
  if (r < 0.45) return 0;                       // 原点恰好在角上：这个 bug 在这里隐身
  if (r < 0.75) return (1 + rnd(9)) * 1000;     // 大正偏移
  return -(1 + rnd(9)) * 1000;                  // 大负偏移（房间被拖到左上）
};

/* 造一份真实形状的户型：cols 列 × rows 行的规整网格。
 * 网格保证「相邻关系明确、缝里不会莫名夹着第三间房」，好把测试火力集中在导出换算上。
 * 故意掺进去的脏东西：
 *   gx/gy = 0        —— 走 wallT = 0 那条特殊路径
 *   orgX/orgY        —— 整体上千毫米的偏移（可正可负），见上面 orgPick
 *   id 打乱          —— 按下标硬映射 id 的实现会露馅
 *   奇数码宽          —— 逼出「取整后再夹一次」那条 */
function gridPlan() {
  const cols = 2 + rnd(3), rows = Math.random() < 0.5 ? 1 : 2;
  const gx = Math.random() < 0.4 ? 0 : 240;
  const gy = Math.random() < 0.5 ? 0 : 240;
  const orgX = orgPick(), orgY = orgPick();
  const colW = [], rowH = [];
  for (let i = 0; i < cols; i++) colW.push((10 + rnd(15)) * 100);
  for (let j = 0; j < rows; j++) rowH.push((10 + rnd(15)) * 100);

  const rooms = [], doors = [];
  let dn = 0;
  const put = (i, j) => {
    let x = orgX;
    for (let k = 0; k < i; k++) x += colW[k] + gx;
    let y = orgY;
    for (let k = 0; k < j; k++) y += rowH[k] + gy;
    return { id: "s" + ((j * cols + i) * 7 + 3) % 23, name: `房${j}${i}`,
             x, y, w: colW[i], h: rowH[j] };
  };
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) rooms.push(put(i, j));

  const add = (A, B, vertical, lo, hi) => {
    const span = hi - lo;
    const w = Math.random() < 0.3 ? 901 : 900;
    if (span < w) return;                       // 墙比门窄，是测试 3 的活儿，这里不造
    const roll = Math.random();
    let pos;
    if (roll < 0.3) pos = lo + w / 2;           // 最危险的边界：正好贴着共用段一端
    else if (roll < 0.6) pos = hi - w / 2;      // 另一端
    else pos = lo + w / 2 + Math.random() * (span - w);
    const d = { id: "d" + (++dn), a: A.id, b: B.id, width: w,
                threshold: Math.random() < 0.3 };
    if (vertical) { d.y = pos; d.x = (A.x + A.w + B.x) / 2; }
    else          { d.x = pos; d.y = (A.y + A.h + B.y) / 2; }
    doors.push(d);
  };
  for (let j = 0; j < rows; j++) for (let i = 0; i + 1 < cols; i++) {
    if (Math.random() < 0.65) {
      const A = put(i, j), B = put(i + 1, j);
      add(A, B, true, Math.max(A.y, B.y), Math.min(A.y + A.h, B.y + B.h));
    }
  }
  for (let j = 0; j + 1 < rows; j++) for (let i = 0; i < cols; i++) {
    if (Math.random() < 0.65) {
      const A = put(i, j), B = put(i, j + 1);
      add(A, B, false, Math.max(A.x, B.x), Math.min(A.x + A.w, B.x + B.w));
    }
  }
  return { rooms, doors };
}

test("测试 1：草图导出的每道门，house.html 都认（含整屋出图）", () => {
  let nPlans = 0, nDoors = 0, nDropped = 0, nZeroGap = 0, nBigOrg = 0;
  let badDoor = null, badPlan = null, badPos = null;
  for (let round = 0; round < 300; round++) {
    const { rooms: sketchRooms, doors: sketchDoors } = gridPlan();
    if (!sketchRooms.length) continue;
    nPlans++;
    if (sketchRooms.some((r, i) => i && r.x !== sketchRooms[i-1].x + sketchRooms[i-1].w &&
                                   r.y !== sketchRooms[i-1].y + sketchRooms[i-1].h)) { /* 网格形状，不校验 */ }

    /* 完全照抄 房间布局草图.html 的 #apply 那三步：平移 → 取整 → 建 idMap。
     * 测试必须和生产走同一条路，否则测得再绿也不算数。 */
    const minX = Math.min(...sketchRooms.map(r => r.x));
    const minY = Math.min(...sketchRooms.map(r => r.y));
    const roomsFinal = sketchRooms.map((r, i) => ({
      id: "r" + (i + 1), name: r.name,
      x: Math.round(r.x - minX), y: Math.round(r.y - minY),
      w: Math.round(r.w), h: Math.round(r.h),
    }));
    const idMap = {};
    sketchRooms.forEach((r, i) => { idMap[r.id] = roomsFinal[i].id; });

    // 整份户型的原点：门存的是草图坐标，房间已经平移过，两者差的就是这个量
    if (Math.abs(minX) > 500 || Math.abs(minY) > 500) nBigOrg++;

    const { list, dropped } = S.exportDoors(roomsFinal, sketchDoors, idMap, { x: minX, y: minY });
    nDoors += list.length; nDropped += dropped.length;

    // 一道都不许凭空消失：留下的 + 丢掉的 = 草图里画的总数
    if (list.length + dropped.length !== sketchDoors.length && !badDoor) {
      badDoor = { why: `门数对不上：留下 ${list.length} + 丢掉 ${dropped.length} ≠ 草图 ${sketchDoors.length}` };
    }

    // ★ 每道门都喂进 house.html 的**真** doorRect：
    //   ① 它得认（不认就整张图白屏）；② 它算出来的门心，得和草图画的位置对得上。
    const byId = {}; for (const r of roomsFinal) byId[r.id] = r;
    const sketchById = {}; for (const d of sketchDoors) sketchById[d.id] = d;
    for (const d of list) {
      const chk = H.doorRect(byId[d.from], byId[d.to], d.at, d.width);
      if (!chk.ok) {
        if (!badDoor) badDoor = { why:`house.html 拒收：${chk.why}`, d, rooms: roomsFinal };
        continue;
      }
      /* ★★ 位置校验——这条才是能抓住「门整体错位」的那一条。
       * 光验合法性抓不到它：错位后的门**往往仍然合法**（墙上有别的位置可以放），
       * house.html 照收不误，然后默默画在错误的地方。
       * 期望值 = 门的草图坐标 − 平移量，也就是用户在图里看到的那一行。
       * 容差 0.5mm：导出时会 Math.round，奇数门宽可能蹭出半毫米再夹回来。 */
      const sd = sketchById[d.id];
      if (!sd) continue;                       // 门丢了由上面那条报，这里不重复报
      const got = chk.vertical ? chk.rect.y + chk.rect.h / 2 : chk.rect.x + chk.rect.w / 2;
      const want = (chk.vertical ? sd.y - minY : sd.x - minX);
      if (Math.abs(got - want) > 0.5 + 1e-6 && !badPos) {
        badPos = { id: d.id, 竖墙: chk.vertical, 门心该在: want, 实际: got, 错位: got - want,
                   minX, minY, 草图里的门: sd, rooms: roomsFinal };
      }
    }

    // 再走一整遍 housePlan：门不合法就会进 errors，plan.ok 变 false → 真机上白屏
    const plan = H.housePlan({ settings: SETTINGS, rooms: roomsFinal, doors: list });
    if (!plan.ok && !badPlan) {
      badPlan = { errors: plan.errors, rooms: roomsFinal, doors: list };
    }
    if (plan.doors.length !== list.length && !badPlan) {
      badPlan = { errors: [`housePlan 只认了 ${plan.doors.length} 道门，导出的是 ${list.length} 道`] };
    }
    if (roomsFinal.some((r, i) => i && r.x === roomsFinal[i-1].x + roomsFinal[i-1].w)) nZeroGap++;
  }

  console.log(`     ${nPlans} 份户型、导出 ${nDoors} 道门（丢掉 ${nDropped} 道）、` +
              `${nZeroGap} 处贴死（wallT 可能是 0）、${nBigOrg} 份户型原点离得远`);
  check("300 份随机户型，每道导出的门 house.html 都认", !badDoor,
        badDoor ? JSON.stringify(badDoor).slice(0, 500) : "");
  check("300 份户型 housePlan 全部 plan.ok = true（真机上不会白屏）", !badPlan,
        badPlan ? JSON.stringify(badPlan).slice(0, 500) : "");
  /* ★ 这条是「过门石导过去位置不对」那个 bug 的回归锁。
   * 它必须和上面那条「house 认不认」分开：门错位之后**仍然是合法的**，
   * 只验合法性永远抓不到，只有比坐标才抓得到。 */
  check("每道导出的门，位置和草图里画的一致（错位 ≤ 0.5mm 取整误差）", !badPos,
        badPos ? JSON.stringify(badPos).slice(0, 500) : "");
  check("样本真的覆盖到了门（否则这条测试是空转）", nDoors > 300, `只有 ${nDoors} 道`);
  check("样本真的覆盖到了贴死模式（wallT = 0 那条分支）", nZeroGap > 20, `只有 ${nZeroGap} 处`);
  check("样本真的覆盖到了原点远离零点的户型（否则位置锁是空转）", nBigOrg > 30,
        `只有 ${nBigOrg} 份；原点偏移全在 0 附近时，门错位这个 bug 只差半毫米，测不出来`);
});

/* ============ 测试 1b：导出坐标换算（定点回归锁） ============
 * 「房间布局草图里的过门石，导进全屋通铺位置不对」——就是这里错。
 *
 * 病根：exportDoors 拿 d.x/d.y（**草图坐标**）去和 ax.lo/ax.hi
 * （用**导出后**的房间算的）比大小，两套坐标系差一个 (minX, minY)。
 * 只要户型没贴着自己的原点画，每道门就会沿它那道墙整体平移 (minX, minY)，
 * 而平移后的门**往往仍然合法**，house.html 照收不误，只是默默画错位置。
 *
 * 测试 1 是随机的、覆盖面广；这里是定点的、数字是给人看的，
 * 坏掉的时候一眼就知道错在哪个方向、错了多少。 */
test("测试 1b：零件不动（原点不为零时，门不能被平移量带跑）", () => {
  /* 走一遍 房间布局草图.html #apply 的那三步，一字不改 */
  const exportOf = (sketchRooms, sketchDoors) => {
    const minX = Math.min(...sketchRooms.map(r => r.x));
    const minY = Math.min(...sketchRooms.map(r => r.y));
    const roomsFinal = sketchRooms.map((r, i) => ({
      id: "r" + (i + 1), name: r.name,
      x: Math.round(r.x - minX), y: Math.round(r.y - minY),
      w: Math.round(r.w), h: Math.round(r.h),
    }));
    const idMap = {};
    sketchRooms.forEach((r, i) => { idMap[r.id] = roomsFinal[i].id; });
    return Object.assign({ roomsFinal, minX, minY },
      S.exportDoors(roomsFinal, sketchDoors, idMap, { x: minX, y: minY }));
  };
  /* 门心在 house.html 那边落在墙轴的哪个坐标上 */
  const centerOf = (roomsFinal, d) => {
    const byId = {}; for (const r of roomsFinal) byId[r.id] = r;
    const chk = H.doorRect(byId[d.from], byId[d.to], d.at, d.width);
    if (!chk.ok) return { ok: false, why: chk.why };
    return { ok: true, vertical: chk.vertical,
             got: chk.vertical ? chk.rect.y + chk.rect.h / 2 : chk.rect.x + chk.rect.w / 2 };
  };

  /* —— 用例 A：2026-09-23 线上复现用的那份户型。
   * 主卧被往上拖了 1200（y = −1200），于是 minY = −1200；
   * 过门石在草图里 y = 3440（客厅 r2 与次卧 r3 之间那道竖墙），
   * 导出后该落在 y = 3440 − (−1200) = 4640。坏的时候落在 3440，差 1200mm。 */
  const A = [
    { id: "a", name: "主卧", x: 0,    y: -1200, w: 3000, h: 2400 },
    { id: "b", name: "客厅", x: 0,    y: 1440,  w: 4200, h: 3600 },
    { id: "c", name: "次卧", x: 4440, y: 1440,  w: 3000, h: 3600 },
  ];
  const doorA = { id: "d1", a: "b", b: "c", x: 4320, y: 3440, width: 900, threshold: true };
  const rA = exportOf(A, [doorA]);
  check("用例 A：过门石导出成功（没有被丢掉）", rA.list.length === 1 && rA.dropped.length === 0,
        rA.dropped[0] && rA.dropped[0].why);
  const cA = rA.list.length ? centerOf(rA.roomsFinal, rA.list[0]) : { ok: false };
  check(`用例 A：minY 明明是 −1200，门心仍该在 4640（实际 ${
        cA.ok ? cA.got : "house 拒收 " + cA.why}）`,
        cA.ok && near(cA.got, 4640, 0.5 + 1e-6));
  check(`用例 A：门心真的被平移量带跑了才叫 bug（错位 ${cA.ok ? cA.got - 4640 : "?"}mm）`,
        cA.ok && Math.abs(cA.got - 4640) <= 0.5 + 1e-6);

  /* —— 用例 B：横墙、大正偏移、门摆在共用段正中间。
   * 两间房整体画在 (8100, 3700) 那一带，minX = 8100、minY = 3700。
   * 门在草图里 x = 9700（客厅 r1 下边那道横墙的正中），导出后该还在 1600。 */
  const B = [
    { id: "a", name: "客厅", x: 8100, y: 3700, w: 3200, h: 3000 },
    { id: "b", name: "主卧", x: 8100, y: 6940, w: 3200, h: 3000 },
  ];
  const doorB = { id: "d2", a: "a", b: "b", x: 9700, y: 6820, width: 900, threshold: false };
  const rB = exportOf(B, [doorB]);
  check("用例 B：通铺门（横墙）导出成功", rB.list.length === 1 && rB.dropped.length === 0,
        rB.dropped[0] && rB.dropped[0].why);
  const cB = rB.list.length ? centerOf(rB.roomsFinal, rB.list[0]) : { ok: false };
  check(`用例 B：整体平移 (8100, 3700) 之后门心仍该在 1600（实际 ${
        cB.ok ? cB.got : "house 拒收 " + cB.why}）`,
        cB.ok && near(cB.got, 9700 - 8100, 0.5 + 1e-6));

  /* —— 用例 C：原点恰好在 (0, 0) 时，导出结果必须和以前**逐位一样**。
   * 这条防的是「修 bug 顺手把正常户型也改了」——老户型的位置一个毫米都不许动。 */
  const C = [
    { id: "a", name: "客厅", x: 0, y: 0, w: 3000, h: 3000 },
    { id: "b", name: "主卧", x: 3240, y: 0, w: 3000, h: 3000 },
  ];
  const doorC = { id: "d3", a: "a", b: "b", x: 3120, y: 1500, width: 900, threshold: true };
  const rC = exportOf(C, [doorC]);
  check("用例 C：原点在 (0,0) 的老户型，结果和从前逐位相同（at = 1500，from 取 r1）",
        rC.list.length === 1 && rC.list[0].at === 1500 && rC.list[0].from === "r1" && rC.list[0].to === "r2");
  /* 不传 origin 时也必须退化成「原点 = 0」——3b 那几条老断言全靠这个默认值 */
  const rC2 = S.exportDoors(rC.roomsFinal, [doorC], { a: "r1", b: "r2" });
  check("用例 C：省略 origin 参数 → 按 (0,0) 处理，at 一样是 1500",
        rC2.list.length === 1 && rC2.list[0].at === 1500);
});

/* ============ 测试 2：镜像同步 ============ */

/* 造一对房间。分两类：
 *   A 自由随机   —— 大多数不相邻，专门压 why 那条分支
 *   B 结构造对   —— 一定是相邻的，专门压成功分支（纯随机瞎扔几乎撞不到相邻，测试会空转）
 * 故意掺 0 尺寸、负数、.5 小数，把「尺寸没填全」「负数间隙」这两条也逼出来。 */
function pairA() {
  const r = () => (Math.random() < 0.12 ? 0 : (Math.random() < 0.5 ? rnd(40) * 100 : rnd(40) * 100 + 0.5));
  const a = { x: rnd(30) * 100, y: rnd(30) * 100, w: r(), h: r() };
  const b = { x: rnd(30) * 100, y: rnd(30) * 100, w: r(), h: r() };
  if (Math.random() < 0.25) { b.x = a.x; b.y = a.y; b.w = a.w; b.h = a.h; }   // 完全重合
  return [a, b, [0, 1500, 300, -800, 99999, 1000.5, 0.5][rnd(7)],
                 [900, 800, 0, -5, 300, 1, 4200, 1000.5][rnd(8)]];
}
function pairB() {
  const f = () => (Math.random() < 0.4 ? rnd(30) * 100 + 0.5 : rnd(30) * 100);
  const a = { x: rnd(20) * 100, y: rnd(20) * 100, w: f() + 100, h: f() + 100 };
  const kind = rnd(4);
  const gap = Math.random() < 0.35 ? 0 : (Math.random() < 0.5 ? 240 : rnd(5) * 120);  // 0 = 贴死那条特殊路径
  const b = { x: 0, y: 0, w: f() + 100, h: f() + 100 };
  const prefix = rnd(300);
  if (kind === 0 || kind === 1) {        // 左右相邻：x 上分开，y 上保证盖住 a 的整段
    b.y = a.y - prefix;
    b.h = (a.y + a.h + rnd(300)) - b.y;
    b.x = (kind === 0) ? a.x + a.w + gap : a.x - b.w - gap;
  } else {                               // 上下相邻：y 上分开，x 上保证盖住 a 的整段
    b.x = a.x - prefix;
    b.w = (a.x + a.w + rnd(300)) - b.x;
    b.y = (kind === 2) ? a.y + a.h + gap : a.y - b.h - gap;
  }
  if (Math.random() < 0.15) { b.x += 0.5; b.y += 0.5; }   // 半毫米脏数据
  const vertical = (kind === 0 || kind === 1);
  const lo = vertical ? Math.max(a.y, b.y) : Math.max(a.x, b.x);
  const hi = vertical ? Math.min(a.y + a.h, b.y + b.h) : Math.min(a.x + a.w, b.x + b.w);
  const start = vertical ? a.y : a.x;
  const span = hi - lo;
  const roll = Math.random();
  let width, at;
  if (span <= 0.01) {                    // 理论上不会发生（上面已经保证盖住整段），兜底
    width = 900; at = 0;
  } else if (roll < 0.45) {              // 合法：随便摆一个位置
    width = Math.min(900, span);
    at = (lo + width / 2 + Math.random() * Math.max(0, span - width)) - start;
  } else if (roll < 0.62) {              // 合法：正好顶在最危险的两个浮点边界上（±半根头发）
    width = Math.min(900, span);
    const edge = Math.random() < 0.5 ? lo + width / 2 : hi - width / 2;
    at = (edge - start) + (rnd(3) - 1) * 1e-9;
  } else if (roll < 0.75) {              // 刚好放不下：比共用段宽一丁点
    width = span + 1e-6 + rnd(500);
    at = lo - start + width / 2;
  } else {                               // 乱来
    width = [900, 0, -5, 4200, 1000.5][rnd(5)];
    at = [0, 1500, -800, 99999, 1000.5][rnd(5)];
  }
  return [a, b, at, width];
}

test("测试 2：doorAxis + doorRectOf 与 house.html 的 doorRect 逐字段一致", () => {
  let nOk = 0, nBad = 0, bad = null;
  for (let i = 0; i < 2000; i++) {
    const [a, b, at, width] = (i % 3 === 0) ? pairB() : pairA();
    const x = S.doorRect(a, b, at, width);
    const y = H.doorRect(a, b, at, width);
    const diff = [];
    if (x.ok !== y.ok) diff.push(`ok ${x.ok}≠${y.ok}`);
    if (x.why !== y.why) diff.push(`why「${x.why}」≠「${y.why}」`);
    if (x.vertical !== y.vertical) diff.push(`vertical ${x.vertical}≠${y.vertical}`);
    if (!near(S.numOr(x.wallT, 0), S.numOr(y.wallT, 0), 1e-6)) diff.push(`wallT ${x.wallT}≠${y.wallT}`);
    if (!near(S.numOr(x.at, 0), S.numOr(y.at, 0), 1e-6)) diff.push(`at ${x.at}≠${y.at}`);
    for (const k of ["x", "y", "w", "h"]) {
      const xv = x.rect && x.rect[k], yv = y.rect && y.rect[k];
      if ((xv === undefined) !== (yv === undefined) || (xv !== undefined && !near(xv, yv, 1e-6)))
        diff.push(`rect.${k} ${xv}≠${yv}`);
    }
    for (const k of ["lo", "hi"]) {
      const xv = x.span && x.span[k], yv = y.span && y.span[k];
      if ((xv === undefined) !== (yv === undefined) || (xv !== undefined && !near(xv, yv, 1e-6)))
        diff.push(`span.${k} ${xv}≠${yv}`);
    }
    if (diff.length) { nBad++; if (!bad) bad = { a, b, at, width, diff }; }
    else if (x.ok) nOk++;
  }
  console.log(`     2000 组里 ${nOk} 组是"合法的门"、${nBad} 组不一致`);
  check("2000 组随机户型，两个工具的判定逐字段一致", nBad === 0,
        bad ? JSON.stringify(bad).slice(0, 400) : "");
  check("随机样本确实覆盖到了成功分支（否则这条测试是空转）", nOk > 200, `只有 ${nOk} 组`);
});

/* ============ 测试 3：本工具自己的语义 ============ */

/* 两间左右相邻的房：缝 [3000, 3240]，共用段 0~3000（竖墙） */
const A0 = { id: "a", name: "客厅", x: 0, y: 0, w: 3000, h: 3000 };
const B0 = { id: "b", name: "主卧", x: 3240, y: 0, w: 3000, h: 3000 };
const TWO = [A0, B0];

test("测试 3a：点墙命中（findWallGap）", () => {
  const hit = (rooms, x, y, slop = 12, minW = 300, doors = []) =>
    S.findWallGap(rooms, x, y, slop, minW, doors);

  const h1 = hit(TWO, 3120, 1500);
  check("点在墙缝正中 → 命中", !!h1);
  check("命中的是客厅↔主卧这一对", !!h1 && h1.a.id === "a" && h1.b.id === "b");
  check(`判成竖墙、墙厚 240（得到 ${h1 && h1.axis}/${h1 && h1.wallT}）`,
        !!h1 && h1.axis === "v" && h1.wallT === 240);
  check("共用段是 0~3000", !!h1 && h1.lo === 0 && h1.hi === 3000);

  check("点在房间内部（离缝 500mm）→ 不命中（应落到选中房间）", hit(TWO, 2500, 1500) === null);
  check("点在共用段端头外 500mm → 不命中", hit(TWO, 3120, 3500) === null);
  check("端头外 10mm（在 12px 容差内）→ 仍命中（门心会被夹回去）", !!hit(TWO, 3120, 3010));

  // 斜对角摆的两间房永远开不了门
  const D = { id: "d", name: "斜的", x: 5000, y: 5000, w: 3000, h: 3000 };
  check("斜对角的两间房判为不相邻（doorAxis.ok = false）", !S.doorAxis(A0, D).ok);
  check("点斜对角的空档 → 不命中", hit([A0, D], 3300, 3300) === null);

  // 共用段太短（500mm）：门槛设 300 时认，设 600 时不认
  const E = { id: "e", name: "小间", x: 3240, y: 2500, w: 3000, h: 3000 };
  check("共用段 500mm ≥ 门槛 300mm → 命中", !!hit([A0, E], 3120, 2700, 12, 300));
  check("共用段 500mm < 门槛 600mm → 不命中", hit([A0, E], 3120, 2700, 12, 600) === null);

  // 缝里夹着第三间房 → 不许开门（house.html 会把那块面积算两遍，且不报错）
  const C = { id: "c", name: "管道井", x: 3000, y: 0, w: 240, h: 1400 };
  check("缝里夹着第三间房 → 不命中（否则 house.html 静默算错面积）",
        hit(TWO.concat([C]), 3120, 1500) === null);
  check("同一道墙、避开第三间房的那一段 → 仍能命中", !!hit(TWO.concat([C]), 3120, 2500));

  // 已有门时：门洞矩形仍然算"在墙上"（手势那边靠"门优先"挡，这里确认几何是对的）
  const d = { id: "d1", a: "a", b: "b", x: 3120, y: 1500, width: 900, threshold: false };
  const g = S.doorView(d, TWO, [d]);
  check("门洞矩形沿墙长 900、厚 240", g.ok && Math.abs(g.rect.h - 900) < 1e-9);
  check("门洞落在墙缝里", g.wallT === 240 && g.gapLo === 3000 && g.gapHi === 3240);
});

test("测试 3b：exportDoors 的三类结局", () => {
  /* 这一组夹具里的房间**已经是导出坐标**（整体从 (0,0) 开始），
   * 所以原点就是 0。还是显式传进去：这个参数一旦有人漏掉，
   * 注释里那句「门得先减掉原点」就没人看得见了。 */
  const ORG0 = { x: 0, y: 0 };
  const roomsF = [{ id: "r1", name: "客厅", x: 0, y: 0, w: 3000, h: 3000 },
                  { id: "r2", name: "主卧", x: 3240, y: 0, w: 3000, h: 3000 }];
  const map = { a: "r1", b: "r2" };

  // ① pos 漂出共用段 → 夹紧，**仍然要留在 list 里**，不许丢
  const far = { id: "d1", a: "a", b: "b", x: 3120, y: 99999, width: 900, threshold: false };
  const r1 = S.exportDoors(roomsF, [far], map, ORG0);
  check("门心漂到 99999 → 夹紧后仍然导出，不算丢", r1.list.length === 1 && r1.dropped.length === 0);
  check(`夹紧后 at = 2550（离起点 2550，得到 ${r1.list[0].at}）`, r1.list[0].at === 2550);
  // from/to 必须真的写进去（少了它们 house.html 会报"门洞指向了不存在的房间"）
  check("导出的门带着 from/to（r1↔r2）",
        r1.list[0].from === "r1" && r1.list[0].to === "r2");
  // from 取"在共用轴上起点更大"的那间：这里两间 y 都是 0，平手时取 A（也就是草图里的 a）
  const r1b = S.exportDoors(roomsF,
    [Object.assign({}, far, { y: 1500 })], map);
  check("from 取起点更大的那间，保证 at 就是用户看到的数", r1b.list[0].from === "r1");

  // ② 墙比门窄 → 丢弃，且原因里带可用宽度
  const wide = { id: "d2", a: "a", b: "b", x: 3120, y: 1500, width: 4200, threshold: false };
  const r2 = S.exportDoors(roomsF, [wide], map, ORG0);
  check("门比共用段宽 → 丢弃", r2.list.length === 0 && r2.dropped.length === 1);
  check(`丢弃原因里报了可用宽度：「${r2.dropped[0].why}」`,
        /3000mm/.test(r2.dropped[0].why) && /4200mm/.test(r2.dropped[0].why));

  // ③ 指向不存在的房间 / a === b
  const gone = { id: "d3", a: "a", b: "zz", x: 3120, y: 1500, width: 900, threshold: false };
  const same = { id: "d4", a: "a", b: "a", x: 3120, y: 1500, width: 900, threshold: false };
  const r3 = S.exportDoors(roomsF, [gone, same], map, ORG0);
  check("指向已删房间 / 同一间房 → 都丢弃", r3.list.length === 0 && r3.dropped.length === 2);

  // ④ 同墙两道门叠在一起 → 后一道丢弃
  const x1 = { id: "d5", a: "a", b: "b", x: 3120, y: 1000, width: 900, threshold: false };
  const x2 = { id: "d6", a: "a", b: "b", x: 3120, y: 1200, width: 900, threshold: false };
  const r4 = S.exportDoors(roomsF, [x1, x2], map, ORG0);
  check("同一道墙上两道门重叠 → 只留一道", r4.list.length === 1 && r4.dropped.length === 1);
  check(`原因是「重叠」：「${r4.dropped[0].why}」`, /重叠/.test(r4.dropped[0].why));

  // ⑤ 平移取整后的房间必须重算 at（坐标带 .5 时最容易露馅）
  const roomsH = [{ id: "r1", name: "客厅", x: 0, y: 0, w: 3000, h: 3000 },
                  { id: "r2", name: "主卧", x: 3241, y: 0, w: 3000, h: 3000 }];
  const dd = { id: "d7", a: "a", b: "b", x: 3120.5, y: 1500.5, width: 900, threshold: false };
  const r5 = S.exportDoors(roomsH, [dd], map, ORG0);
  check("半毫米坐标 → 仍然导出", r5.list.length === 1);
  check(`at 是整数（得到 ${r5.list[0].at}）`, Number.isInteger(r5.list[0].at));
  const back = H.doorRect(roomsH[0], roomsH[1], r5.list[0].at, 900);
  check(`取整后的 at 反算回 house.html 仍合法，洞口 y=1051（得到 ${back.rect && back.rect.y}）`,
        back.ok && back.rect.y === 1051);
});

test("测试 3c：拖动边界（freeRangeOnWall）", () => {
  const ax = S.doorAxis(A0, B0);
  const me = { id: "d1", a: "a", b: "b", x: 3120, y: 1500, width: 900, threshold: false };

  check("墙上只有自己 → 有可用区间", S.freeRangeOnWall(ax, [me], me, 1500) !== null);
  const solo = S.freeRangeOnWall(ax, [me], me, 1500);
  check(`独自一人时中心可落在 450~2550（得到 ${solo.lo}~${solo.hi}）`,
        solo.lo === 450 && solo.hi === 2550);

  // 右边来了一道门（中心 2000，占 1550~2450）→ 往右只能到 1100，正好贴上
  const other = { id: "d2", a: "a", b: "b", x: 3120, y: 2000, width: 900, threshold: false };
  const rng = S.freeRangeOnWall(ax, [me, other], me, 1500);
  check(`右边有门时上限收到 1100（得到 ${rng && rng.hi}）`, rng !== null && rng.hi === 1100);
  check("下限不受影响，仍是 450（不会跳到墙的另一头）", rng.lo === 450);
  check("区间非空，拖到头就停住、不会变成红色状态", rng.hi - rng.lo >= 0);

  // 正好压在别人门上 → 无解
  const onTop = { id: "d3", a: "a", b: "b", x: 3120, y: 1500, width: 900, threshold: false };
  check("当前位置正压在别人的门上 → 无解", S.freeRangeOnWall(ax, [me, onTop], me, 1500) === null);

  // 门比整道墙还宽 → 无解
  const huge = { id: "d4", a: "a", b: "b", width: 4200, threshold: false };
  check("门比墙还宽 → 无解", S.freeRangeOnWall(ax, [huge], huge, 1500) === null);
});

test("测试 3d：存档过滤与编号（sanitizeDoors / nextSeq）", () => {
  const ids = ["a", "b"];
  check("老存档没有 doors 字段 → 返回空数组，不抛异常", S.sanitizeDoors(undefined, ids).length === 0);
  check("doors 不是数组 → 空数组", S.sanitizeDoors("坏了", ids).length === 0);
  check("数组里混了垃圾 → 吃掉", S.sanitizeDoors([null, 42], ids).length === 0);

  const good = { id: "d1", a: "a", b: "b", x: 1, y: 2, width: 900, threshold: 1 };
  const s = S.sanitizeDoors([good], ids);
  check("合法的门留下，threshold 归一化成布尔", s.length === 1 && s[0].threshold === true);

  check("门指向已删掉的房间 → 吃掉",
        S.sanitizeDoors([Object.assign({}, good, { b: "zz" })], ids).length === 0);
  check("a === b → 吃掉", S.sanitizeDoors([Object.assign({}, good, { b: "a" })], ids).length === 0);
  check("门宽 0 → 吃掉", S.sanitizeDoors([Object.assign({}, good, { width: 0 })], ids).length === 0);
  check("坐标是 NaN → 吃掉", S.sanitizeDoors([Object.assign({}, good, { x: NaN })], ids).length === 0);

  /* ★ 撞号回归：5 间房 + 一道 d6，旧实现只扫房间 → seq = 5 → 下次开门生成 d6 和存档里那道撞号 */
  const rs = [{ id: "r1" }, { id: "r2" }, { id: "r3" }, { id: "r4" }, { id: "r5" }];
  check("5 间房、没有门 → 5", S.nextSeq(rs, []) === 5);
  check(`5 间房 + 一道 d6 → 6（只扫房间的实现会给出 5，下次开门就和 d6 撞号）`,
        S.nextSeq(rs, [{ id: "d6" }]) === 6);
  check("空存档 → 0", S.nextSeq([], []) === 0);
});

/* ============ 测试 4：批量贴尺寸（parseRoomLines） ============ */
/* 一行一间房。这不是「能用就行」的辅助功能：认错一行会静悄悄生成一间尺寸错的房，
 * 用户拖着它摆好、导给 house.html、排完砖才发现——所以下面每条断言都在钉住
 * 「要么认对，要么报错，不许猜」。 */
test("测试 4a：一行一间房——各种分隔符与写法", () => {
  const one = (line, name, w, h) => {
    const o = S.parseRoomLines(line, 1);
    const r = o.rooms[0];
    check(`「${line}」→ ${name} ${w}×${h}`,
          o.rooms.length === 1 && !o.errors.length && !!r &&
          r.name === name && r.w === w && r.h === h,
          o.errors.length ? `报错：${o.errors[0].why}` : JSON.stringify(o.rooms));
  };
  one("客厅 4200x3600", "客厅", 4200, 3600);
  one("主卧 3300×3000", "主卧", 3300, 3000);          // 全角乘号
  one("次卧 3300*3000", "次卧", 3300, 3000);          // 星号
  one("客厅 4200X3600", "客厅", 4200, 3600);          // 大写 X
  one("厨房,1800,3000", "厨房", 1800, 3000);          // 半角逗号
  one("厨房，1800，3000", "厨房", 1800, 3000);        // 全角逗号
  one("阳台 1500 4200", "阳台", 1500, 4200);          // 纯空格
  one("客厅, 4200, 3600", "客厅", 4200, 3600);        // 逗号后带空格
  one("客厅4200x3600", "客厅", 4200, 3600);           // 名字和数字贴着
  one("主卧：3300×3000", "主卧", 3300, 3000);         // 中文冒号
  one("客厅 4200mm x 3600mm", "客厅", 4200, 3600);    // 带 mm
  one("客厅 4200-3600", "客厅", 4200, 3600);          // 中间画个横杠
  one("书房 长2700 宽3300", "书房", 2700, 3300);      // 带「长 / 宽」二字
  /* ★ 名字里带数字：正则锚在行尾才认得出这是名字，不锚会把 2 当成长度，
     尺寸整条错位成 2×3000。 */
  one("卧室2 3000x3000", "卧室2", 3000, 3000);
  one("房间1 3000x3000", "房间1", 3000, 3000);
});

test("测试 4b：省了名字就自动编号（房间N）", () => {
  const o = S.parseRoomLines("3000x3000\n3300x3000", 1);
  check("两行都没名字 → 房间1、房间2",
        o.rooms.length === 2 && o.rooms[0].name === "房间1" && o.rooms[1].name === "房间2",
        JSON.stringify(o.rooms.map((r) => r.name)));

  const o7 = S.parseRoomLines("3000x3000", 7);
  check("startNo=7 → 房间7（不跟现有房间撞名）", o7.rooms[0].name === "房间7",
        o7.rooms[0].name);

  /* 有名字的行不该占号：否则「客厅 + 两行没名字」会从 房间2 开始，中间空一个号。 */
  const mix = S.parseRoomLines("客厅 4200x3600\n3000x3000\n3300x3000", 1);
  check("有名字的行不占号 → 客厅、房间1、房间2",
        mix.rooms.map((r) => r.name).join("/") === "客厅/房间1/房间2",
        mix.rooms.map((r) => r.name).join("/"));
});

test("测试 4c：认不出来就报错，绝不猜", () => {
  const bad = (line, why) => {
    const o = S.parseRoomLines(line, 1);
    check(`「${line}」→ 报错不加房（${why}）`,
          o.rooms.length === 0 && o.errors.length === 1,
          JSON.stringify(o));
  };
  bad("客厅 4200", "只有一个数");
  bad("客厅 大", "根本没有数");
  bad("客厅 4200x0", "宽是 0");
  bad("客厅 0x3000", "长是 0");
  /* ★ 这条是本次新加的守卫：4.2 米写成 4.2 会变成 4×4 毫米的房间，
     看着像加成功了——比报错糟得多。 */
  const m = S.parseRoomLines("客厅 4.2x3.6", 1);
  check("「客厅 4.2x3.6」（把米当毫米）→ 报错，并提示该写 4200",
        m.rooms.length === 0 && m.errors.length === 1 && /4200/.test(m.errors[0].why),
        JSON.stringify(m.errors));
  const e = S.parseRoomLines("客厅 1e3x2000", 1);
  check("「客厅 1e3x2000」（科学计数法）→ 报错，不漏成 3×2000 的房间",
        e.rooms.length === 0, JSON.stringify(e));
});

test("测试 4d：空行与注释行跳过，且不占行号、不占编号", () => {
  const o = S.parseRoomLines("客厅 4200x3600\n\n   \n# 备注\n// 也跳过\n主卧 3300x3000", 1);
  check("空行/纯空格/# // 全跳过 → 剩 2 间房、0 条报错",
        o.rooms.length === 2 && o.errors.length === 0, JSON.stringify(o));
  check("跳过的行不占用自动编号 → 一间都没自动编号",
        o.rooms[0].name === "客厅" && o.rooms[1].name === "主卧",
        o.rooms.map((r) => r.name).join("/"));

  const crlf = S.parseRoomLines("客厅 4200x3600\r\n主卧 3300x3000", 1);
  check("Windows 换行（\\r\\n）也认", crlf.rooms.length === 2, JSON.stringify(crlf));

  const empty = S.parseRoomLines("", 1);
  check("空字符串 → 空的房间和空的报错，不抛异常",
        empty.rooms.length === 0 && empty.errors.length === 0);
  check("null → 同上", S.parseRoomLines(null, 1).rooms.length === 0);
});

test("测试 4e：报错行号要准——用户是对着输入框数行号的", () => {
  const o = S.parseRoomLines("客厅 4200x3600\n\n主卧 3300x3000\n瞎写\n次卧 3300x3000", 5);
  check("第 4 行写坏了 → errors[0].line === 4（空行不占号，报错行不占编号）",
        o.errors.length === 1 && o.errors[0].line === 4 && o.errors[0].text === "瞎写",
        JSON.stringify(o.errors));
  check("其余 3 行照常加进来，且顺序不乱",
        o.rooms.map((r) => r.name).join("/") === "客厅/主卧/次卧",
        o.rooms.map((r) => r.name).join("/"));

  const two = S.parseRoomLines("瞎写\n客厅 4200x3600\n又瞎写", 1);
  check("多行出错 → 行号按出现顺序给出 1、3",
        two.errors.map((e) => e.line).join(",") === "1,3",
        two.errors.map((e) => e.line).join(","));
});

test("测试 4f：小数取整——毫米没有小数位", () => {
  const o = S.parseRoomLines("客厅 4200.6x3600.4", 1);
  check("4200.6 × 3600.4 → 4201 × 3600（四舍五入到毫米）",
        o.rooms[0].w === 4201 && o.rooms[0].h === 3600, JSON.stringify(o.rooms[0]));
});

/* ============ 测试 5：草稿模式（未量的房间 + 拖角改大小） ============
 * 这一组守的是「先画个大概、以后再填实测」这条路。三个后果都不是崩溃型的，
 * 而是**悄没声地错**：标记丢了 → 房间看着是量过的；拖成 0 宽 → 刷新后房间消失。
 * 所以全部由机器盯着。 */

test("测试 5a：est 标记——缺省算「已量」，标回去要连键一起删掉", () => {
  const fresh = { id: "r1", name: "客厅", x: 0, y: 0, w: 3000, h: 3000 };
  check("新房间（没有 est 键）→ isEst 为 false（老存档一个字节都不变）", S.isEst(fresh) === false);
  check("null / undefined 也不炸", S.isEst(null) === false && S.isEst(undefined) === false);

  const r = { id: "r2", name: "主卧", x: 0, y: 0, w: 3000, h: 3000 };
  S.markEst(r);
  check("markEst 之后 isEst 为 true", S.isEst(r) === true);
  check("序列化出来就是 est:true", JSON.stringify(r).includes('"est":true'), JSON.stringify(r));

  S.markMeasured(r);
  check("markMeasured 之后 isEst 为 false", S.isEst(r) === false);
  /* ★ 这条是「老存档逐位不变」的锁：必须是 delete，写成 r.est = false
   *   会让每个已量的房间都多出一个 "est":false，存档就不是原来那个了。 */
  check("markMeasured 是把键删掉，不是写成 false（\"est\" in r === false）",
        !("est" in r), JSON.stringify(r));
  check("删干净后字段正好是改动前那 6 个",
        Object.keys(r).sort().join(",") === "h,id,name,w,x,y", Object.keys(r).join(","));
  check("反复标来标去不会留下痕迹",
        (() => { S.markEst(r); S.markMeasured(r); S.markEst(r); S.markMeasured(r);
                 return Object.keys(r).length === 6; })());
  check("传 null 不炸", (S.markEst(null), S.markMeasured(null), true));
});

test("测试 5b：拖角——对角钉死，返回新矩形，不改传进来的对象", () => {
  const R = { id: "r1", x: 1000, y: 2000, w: 3000, h: 4000 };   // 右下角在 (4000, 6000)

  const c2 = S.resizeByCorner(R, 2, 5000, 7000, 300);           // 右下角拖到 (5000,7000)
  check("右下：左上角原地不动，右下角跟着走",
        c2.x === 1000 && c2.y === 2000 && c2.w === 4000 && c2.h === 5000, JSON.stringify(c2));

  const c0 = S.resizeByCorner(R, 0, 500, 1500, 300);            // 左上角拖到 (500,1500)
  check("左上：右下角钉死在 (4000,6000)",
        c0.x === 500 && c0.y === 1500 && c0.w === 3500 && c0.h === 4500
        && c0.x + c0.w === 4000 && c0.y + c0.h === 6000, JSON.stringify(c0));

  const c1 = S.resizeByCorner(R, 1, 5000, 1500, 300);           // 右上
  check("右上：左下角钉死；上边动、下边不动",
        c1.x === 1000 && c1.y === 1500 && c1.w === 4000 && c1.h === 4500, JSON.stringify(c1));

  const c3 = S.resizeByCorner(R, 3, 500, 7000, 300);            // 左下
  check("左下：右上角钉死；左边动、右边不动",
        c3.x === 500 && c3.y === 2000 && c3.w === 3500 && c3.h === 5000, JSON.stringify(c3));

  check("R 本身一个字段都没被改", R.x === 1000 && R.y === 2000 && R.w === 3000 && R.h === 4000,
        JSON.stringify(R));
});

test("测试 5c：拖角的下限——永远不会拖出 loadSketch 会丢掉的房间", () => {
  const R = { x: 1000, y: 2000, w: 3000, h: 4000 };
  check("右下拖到左边老远 → 宽度正好卡在 300，不是 0 也不是负数",
        S.resizeByCorner(R, 2, -99999, -99999, 300).w === 300
        && S.resizeByCorner(R, 2, -99999, -99999, 300).h === 300);
  const up = S.resizeByCorner(R, 0, 99999, 99999, 300);
  check("左上拖到右下老远 → 右下角仍然钉死，边长卡在 300",
        up.x === 3700 && up.y === 5700 && up.w === 300 && up.h === 300, JSON.stringify(up));
  check("缩到极限时「钉死」和「撞下限」同时成立：x+w 还是 4000", up.x + up.w === 4000);
  check("minMM 传 0 / 不传 → 兜底 300（引擎段读不到外面的 MIN_ROOM_MM）",
        S.resizeByCorner(R, 2, -99999, -99999, 0).w === 300
        && S.resizeByCorner(R, 2, -99999, -99999).w === 300);

  /* 穷举一遍：不管往哪儿拖，出来的房间都必须是 loadSketch 愿意留下的那种
     （w>0 && h>0），否则页面一刷新房间就凭空消失了。 */
  let bad = null;
  for (const corner of [0, 1, 2, 3]) {
    for (const tx of [-5000, 0, 1000, 3999, 4000, 4001, 9000]) {
      for (const ty of [-5000, 0, 2000, 5999, 6000, 6001, 9000]) {
        const n = S.resizeByCorner(R, corner, tx, ty, 300);
        if (!(n.w > 0 && n.h > 0 && n.w >= 300 && n.h >= 300)) bad = { corner, tx, ty, n };
      }
    }
  }
  check("4 个角 × 49 个落点：边长一律 >= 300（没有能被拖成 0 的房间）", bad === null,
        bad ? JSON.stringify(bad) : "");
});

test("测试 5d：角把手命中——取最近的角，不是先撞上谁算谁", () => {
  const R = { x: 0, y: 0, w: 1000, h: 1000 };
  const hit = (x, y, slop) => S.cornerHit(R, x, y, slop);

  check("正压四个角 → 0 / 1 / 2 / 3",
        hit(0, 0, 20) === 0 && hit(1000, 0, 20) === 1
        && hit(1000, 1000, 20) === 2 && hit(0, 1000, 20) === 3);
  check("差一点也算（正好等于 slop 时算命中）", hit(20, 20, 20) === 0);
  check("超出 slop 就不算", hit(21, 0, 20) === -1);
  check("房间正中不命中", hit(500, 500, 20) === -1);
  check("传 null → -1（没有选中房间时不该炸）", S.cornerHit(null, 0, 0, 20) === -1);

  /* ★ 这条才是「取最近」的锁：slop 放到 600 时，(550,0) 同时落在左上和右上
   *   的命中框里。按循环顺序先撞上 0（左上），可它离右上更近——手指明明压在
   *   右边，抓到的却是左边那个角，房间会朝反方向变形。房间被拖小以后四个角
   *   挤在一起，这就是常态。 */
  check("两点都在范围内时，取更近的那个（(550,0) → 右上而不是左上）",
        S.cornerHit(R, 550, 0, 600) === 1, String(S.cornerHit(R, 550, 0, 600)));
  check("下边同理（(450,1000) → 左下而不是右下）",
        S.cornerHit(R, 450, 1000, 600) === 3, String(S.cornerHit(R, 450, 1000, 600)));
});

test("测试 5e：拖角吸附——候选边要排除自己，且吸的是最近的一条", () => {
  const rooms = [
    { id: "self", x: 1000, y: 0,    w: 2000, h: 3000 },
    { id: "b",    x: 4000, y: 0,    w: 3000, h: 3000 },
  ];
  const xs = S.edgeCands(rooms, "self", 240, "x");
  check("排除自己：自己的 4 条边一个都不在里面",
        !xs.includes(1000) && !xs.includes(3000), JSON.stringify(xs));
  check("邻居的边各带 ±gap 两个候选（4000-240、4000、7000、7000+240）",
        xs.join(",") === "3760,4000,7000,7240", JSON.stringify(xs));
  const ys = S.edgeCands(rooms, "self", 240, "y");
  check("竖轴同理（邻居 y 是 0~3000）", ys.join(",") === "-240,0,3000,3240", JSON.stringify(ys));

  check("差得比容差远 → 原样不动（3500 离最近的 3760 还差 260）",
        S.snapToEdges(3500, xs, 100) === 3500);
  check("差在容差内 → 吸过去（3740 离 3760 只差 20）",
        S.snapToEdges(3740, xs, 100) === 3760);
  check("正好等于容差不算（要严格小于）", S.snapToEdges(3660, xs, 100) === 3660);
  check("多个候选都在范围内时取最近的",
        S.snapToEdges(3900, [3760, 4000, 7000], 200) === 4000,
        String(S.snapToEdges(3900, [3760, 4000, 7000], 200)));
  check("候选表空 → 原样返回", S.snapToEdges(1234, [], 500) === 1234);
});

/* ============ 汇总 ============ */
console.log(`\n${_fail ? "❌" : "✅"} 通过 ${_pass} 条，失败 ${_fail} 条`);
process.exit(_fail ? 1 : 0);
