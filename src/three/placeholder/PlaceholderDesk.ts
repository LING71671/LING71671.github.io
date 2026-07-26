import * as THREE from 'three';
import { NODES } from '../config/naming';
import { LAYOUT, DESK_TOP_Y } from '../config/layout';

/**
 * 开发期占位场景：Three.js 基本几何体按命名契约搭建整张书桌。
 * 节点名严格取自 config/naming.ts —— GLTF 完成后换入即插即用。
 * 风格化 low-poly：温暖木色 + 奶油纸 + 黄铜。
 */

const MAT = {
  wood: new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 0.75 }),
  woodDark: new THREE.MeshStandardMaterial({ color: 0x5a3d22, roughness: 0.8 }),
  floor: new THREE.MeshStandardMaterial({ color: 0x4a3421, roughness: 0.95 }),
  wall: new THREE.MeshStandardMaterial({ color: 0xcbb89a, roughness: 1 }),
  paper: new THREE.MeshStandardMaterial({ color: 0xf5efe0, roughness: 0.9 }),
  paperDim: new THREE.MeshStandardMaterial({ color: 0xe8dfc8, roughness: 0.9 }),
  brass: new THREE.MeshStandardMaterial({
    color: 0xb08a3e,
    metalness: 0.85,
    roughness: 0.35,
  }),
  dark: new THREE.MeshStandardMaterial({ color: 0x1c1a17, roughness: 0.6 }),
  ink: new THREE.MeshStandardMaterial({ color: 0x2b2117, roughness: 0.7 }),
  ceramic: new THREE.MeshStandardMaterial({ color: 0xfbf6ea, roughness: 0.4 }),
  coffee: new THREE.MeshStandardMaterial({ color: 0x2f1c0e, roughness: 0.25 }),
  stickyNote: new THREE.MeshStandardMaterial({ color: 0xf2dd8b, roughness: 0.9 }),
  leaf: new THREE.MeshStandardMaterial({ color: 0x5f7a4f, roughness: 0.9 }),
  glass: new THREE.MeshStandardMaterial({
    color: 0xdfeef5,
    transparent: true,
    opacity: 0.12,
    roughness: 0.1,
  }),
};

function box(
  w: number,
  h: number,
  d: number,
  mat: THREE.Material,
  name = '',
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function cylinder(
  rTop: number,
  rBottom: number,
  h: number,
  mat: THREE.Material,
  seg = 24,
  name = '',
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, seg), mat);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** 显示器屏幕内容：CanvasTexture 画一个暖色调项目页面 */
export function createScreenTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 288;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#14110d';
  ctx.fillRect(0, 0, 512, 288);
  // 顶栏
  ctx.fillStyle = '#241f18';
  ctx.fillRect(0, 0, 512, 36);
  ctx.fillStyle = '#c9a45c';
  ctx.font = '16px sans-serif';
  ctx.fillText('Projects', 16, 24);
  // 项目卡片
  const colors = ['#8a6a42', '#5f7a4f', '#a8853c', '#6b4a2b'];
  for (let i = 0; i < 4; i++) {
    const x = 20 + (i % 2) * 240;
    const y = 52 + Math.floor(i / 2) * 112;
    ctx.fillStyle = colors[i]!;
    ctx.fillRect(x, y, 220, 72);
    ctx.fillStyle = '#e9dcc2';
    ctx.fillRect(x, y + 80, 140, 8);
    ctx.fillStyle = '#7d6d52';
    ctx.fillRect(x, y + 94, 90, 6);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function buildRoom(): THREE.Group {
  const room = new THREE.Group();
  room.name = 'room';

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 6), MAT.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = LAYOUT.floorY;
  floor.receiveShadow = true;
  room.add(floor);

  // 后墙：窗洞四周由 4 块板拼成
  const { window: win } = LAYOUT;
  const wallZ = LAYOUT.wallZ;
  const wallH = 3;
  const wallW = 8;
  const left = win.x - win.w / 2;
  const right = win.x + win.w / 2;
  const bottom = win.y - win.h / 2;
  const top = win.y + win.h / 2;

  const mkWall = (w: number, h: number, x: number, y: number) => {
    if (w <= 0 || h <= 0) return;
    const seg = new THREE.Mesh(new THREE.PlaneGeometry(w, h), MAT.wall);
    seg.position.set(x, y, wallZ);
    seg.receiveShadow = true;
    room.add(seg);
  };
  mkWall(left - -wallW / 2, wallH, (-wallW / 2 + left) / 2, wallH / 2); // 窗左
  mkWall(wallW / 2 - right, wallH, (right + wallW / 2) / 2, wallH / 2); // 窗右
  mkWall(win.w, bottom, win.x, bottom / 2); // 窗下
  mkWall(win.w, wallH - top, win.x, (top + wallH) / 2); // 窗上

  return room;
}

function buildWindow(): THREE.Group {
  const { window: win } = LAYOUT;
  const root = new THREE.Group();
  root.name = NODES.windowRoot;
  root.position.set(win.x, win.y, win.z);

  const frameT = 0.045;
  const frame = new THREE.Group();
  const mkBar = (w: number, h: number, x: number, y: number) => {
    const bar = box(w, h, 0.05, MAT.woodDark);
    bar.position.set(x, y, 0);
    frame.add(bar);
  };
  mkBar(win.w + frameT, frameT, 0, win.h / 2); // 上
  mkBar(win.w + frameT, frameT, 0, -win.h / 2); // 下
  mkBar(frameT, win.h, -win.w / 2, 0); // 左
  mkBar(frameT, win.h, win.w / 2, 0); // 右
  mkBar(frameT * 0.7, win.h, 0, 0); // 中梃
  root.add(frame);

  const glass = new THREE.Mesh(new THREE.PlaneGeometry(win.w, win.h), MAT.glass);
  glass.name = NODES.windowGlass;
  root.add(glass);

  // 窗台绿植（装饰）
  const pot = cylinder(0.045, 0.035, 0.07, MAT.ceramic);
  pot.name = 'decor_plant_pot';
  pot.position.set(-win.w / 2 + 0.12, -win.h / 2 + 0.035, 0.09);
  root.add(pot);
  for (let i = 0; i < 3; i++) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), MAT.leaf);
    leaf.name = 'decor_plant_leaf';
    leaf.scale.set(0.7, 1.3, 0.7);
    leaf.position.set(
      -win.w / 2 + 0.12 + (i - 1) * 0.025,
      -win.h / 2 + 0.12 + (i % 2) * 0.02,
      0.09,
    );
    leaf.castShadow = true;
    root.add(leaf);
  }

  return root;
}

function buildDesk(): THREE.Group {
  const { desk, drawer } = LAYOUT;
  const group = new THREE.Group();
  group.name = NODES.deskBody;

  const top = box(desk.w, desk.thickness, desk.d, MAT.wood);
  top.position.set(0, desk.topY - desk.thickness / 2, -0.08);
  group.add(top);

  const legH = desk.topY - desk.thickness;
  const legPositions: Array<[number, number]> = [
    [-desk.w / 2 + 0.05, -0.08 - desk.d / 2 + 0.05],
    [desk.w / 2 - 0.05, -0.08 - desk.d / 2 + 0.05],
    [-desk.w / 2 + 0.05, -0.08 + desk.d / 2 - 0.05],
    [desk.w / 2 - 0.05, -0.08 + desk.d / 2 - 0.05],
  ];
  for (const [x, z] of legPositions) {
    const leg = box(0.06, legH, 0.06, MAT.woodDark);
    leg.position.set(x, legH / 2, z);
    group.add(leg);
  }

  // 前梁（抽屉安放处）
  const apron = box(desk.w - 0.16, 0.16, 0.02, MAT.woodDark);
  apron.position.set(0, desk.topY - desk.thickness - 0.08, -0.08 + desk.d / 2 - 0.02);
  group.add(apron);

  // —— 抽屉 ——
  const drawerRoot = new THREE.Group();
  drawerRoot.name = NODES.drawerRoot;
  drawerRoot.position.set(
    drawer.x,
    desk.topY - desk.thickness - 0.08,
    -0.08 + desk.d / 2 - 0.02,
  );
  const housing = box(drawer.faceW + 0.04, drawer.faceH + 0.04, 0.02, MAT.woodDark);
  housing.position.z = -0.02;
  drawerRoot.add(housing);

  // 可动抽屉：原点在关闭位，+Z 为拉出方向
  const slide = new THREE.Group();
  slide.name = NODES.drawerSlide;
  const face = box(drawer.faceW, drawer.faceH, 0.018, MAT.wood);
  face.position.z = 0.009;
  slide.add(face);
  const bodyBox = box(drawer.faceW - 0.03, drawer.faceH - 0.03, drawer.depth, MAT.woodDark);
  bodyBox.position.z = -drawer.depth / 2;
  slide.add(bodyBox);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.014, 12, 8), MAT.brass);
  knob.name = 'decor_drawer_knob';
  knob.position.z = 0.026;
  knob.castShadow = true;
  slide.add(knob);
  // 抽屉里的「About Me」小册子
  const book = box(drawer.faceW - 0.14, 0.02, 0.16, MAT.ink);
  book.name = 'decor_drawer_book';
  book.position.set(0, -drawer.faceH / 2 + 0.035, -0.12);
  slide.add(book);
  drawerRoot.add(slide);
  group.add(drawerRoot);

  return group;
}

function buildLamp(): THREE.Group {
  const { lamp } = LAYOUT;
  const root = new THREE.Group();
  root.name = NODES.lampRoot;
  root.position.set(lamp.x, DESK_TOP_Y, lamp.z);

  const base = cylinder(0.075, 0.09, 0.025, MAT.brass);
  base.position.y = 0.0125;
  root.add(base);

  const pole = cylinder(0.011, 0.011, lamp.poleH, MAT.brass);
  pole.position.y = 0.025 + lamp.poleH / 2;
  root.add(pole);

  // 灯头：原点在关节（杆顶）
  const head = new THREE.Group();
  head.name = NODES.lampHead;
  head.position.y = 0.025 + lamp.poleH;
  head.rotation.z = -0.75; // 朝桌面中心倾斜

  const shade = new THREE.Mesh(
    new THREE.ConeGeometry(0.085, 0.12, 24, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0xb08a3e,
      metalness: 0.85,
      roughness: 0.35,
      side: THREE.DoubleSide,
    }),
  );
  shade.name = 'decor_lamp_shade';
  shade.position.y = 0.02;
  shade.rotation.x = Math.PI;
  shade.castShadow = true;
  head.add(shade);

  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.028, 16, 12),
    new THREE.MeshStandardMaterial({
      color: 0xfff3d6,
      emissive: 0xffb46b,
      emissiveIntensity: 0,
      roughness: 0.4,
    }),
  );
  bulb.name = NODES.lampBulb;
  bulb.position.y = -0.01;
  head.add(bulb);

  root.add(head);
  return root;
}

function buildMonitor(screenTexture: THREE.Texture): THREE.Group {
  const { monitor } = LAYOUT;
  const root = new THREE.Group();
  root.name = NODES.monitorRoot;
  root.position.set(monitor.x, DESK_TOP_Y, monitor.z);

  const foot = cylinder(0.11, 0.13, 0.018, MAT.dark);
  foot.position.y = 0.009;
  root.add(foot);
  const neck = box(0.03, monitor.standH, 0.02, MAT.dark);
  neck.position.y = 0.018 + monitor.standH / 2;
  root.add(neck);

  const frameW = monitor.screenW + 0.03;
  const frameH = monitor.screenH + 0.03;
  const frame = box(frameW, frameH, 0.03, MAT.dark);
  frame.position.y = monitor.standH + frameH / 2;
  root.add(frame);

  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(monitor.screenW, monitor.screenH),
    new THREE.MeshStandardMaterial({
      color: 0x0a0908,
      map: screenTexture,
      emissive: 0xffffff,
      emissiveMap: screenTexture,
      emissiveIntensity: 0.55,
      roughness: 0.35,
    }),
  );
  screen.name = NODES.monitorScreen;
  screen.position.set(0, monitor.standH + frameH / 2, 0.017);
  root.add(screen);

  return root;
}

function buildNotebook(): THREE.Group {
  const { notebook } = LAYOUT;
  const root = new THREE.Group();
  root.name = NODES.notebookRoot;
  root.position.set(notebook.x, DESK_TOP_Y, notebook.z);
  root.rotation.y = -0.06;

  const pageL = box(notebook.w / 2 - 0.004, 0.012, notebook.d, MAT.paper);
  pageL.position.set(-notebook.w / 4, 0.006, 0);
  pageL.rotation.z = 0.03;
  root.add(pageL);
  const pageR = box(notebook.w / 2 - 0.004, 0.012, notebook.d, MAT.paperDim);
  pageR.position.set(notebook.w / 4, 0.006, 0);
  pageR.rotation.z = -0.03;
  root.add(pageR);
  const spine = box(0.015, 0.016, notebook.d, MAT.ink);
  spine.name = 'decor_notebook_spine';
  spine.position.y = 0.008;
  root.add(spine);

  // 一支钢笔
  const pen = cylinder(0.004, 0.004, 0.13, MAT.ink, 10);
  pen.name = 'decor_pen';
  pen.rotation.z = Math.PI / 2;
  pen.rotation.y = 0.5;
  pen.position.set(notebook.w / 4, 0.018, notebook.d / 2 - 0.03);
  root.add(pen);

  return root;
}

function buildCoffee(): THREE.Group {
  const { coffee } = LAYOUT;
  const root = new THREE.Group();
  root.name = NODES.coffeeRoot;
  root.position.set(coffee.x, DESK_TOP_Y, coffee.z);

  const saucer = cylinder(coffee.r + 0.025, coffee.r + 0.015, 0.008, MAT.ceramic);
  saucer.position.y = 0.004;
  root.add(saucer);

  const cup = cylinder(coffee.r, coffee.r * 0.82, coffee.h, MAT.ceramic);
  cup.position.y = 0.008 + coffee.h / 2;
  root.add(cup);

  const liquid = cylinder(coffee.r - 0.006, coffee.r - 0.006, 0.004, MAT.coffee, 20);
  liquid.position.y = 0.008 + coffee.h - 0.008;
  root.add(liquid);

  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.006, 8, 16), MAT.ceramic);
  handle.name = 'decor_cup_handle';
  handle.position.set(coffee.r + 0.014, 0.008 + coffee.h / 2, 0);
  handle.castShadow = true;
  root.add(handle);

  const steamAnchor = new THREE.Object3D();
  steamAnchor.name = NODES.coffeeSteamAnchor;
  steamAnchor.position.y = 0.008 + coffee.h + 0.02;
  root.add(steamAnchor);

  return root;
}

function buildCalendar(): THREE.Group {
  const { calendar } = LAYOUT;
  const root = new THREE.Group();
  root.name = NODES.calendarRoot;
  root.position.set(calendar.x, DESK_TOP_Y, calendar.z);
  root.rotation.y = -0.35;

  const lean = 0.28;
  const front = box(calendar.w, calendar.h, 0.004, MAT.paper);
  front.position.set(0, calendar.h / 2, calendar.h * 0.14);
  front.rotation.x = -lean;
  root.add(front);
  const back = box(calendar.w, calendar.h, 0.004, MAT.paperDim);
  back.position.set(0, calendar.h / 2, -calendar.h * 0.14);
  back.rotation.x = lean;
  root.add(back);

  const dateBlock = box(calendar.w * 0.42, calendar.h * 0.3, 0.003, MAT.brass);
  dateBlock.name = 'decor_calendar_date';
  dateBlock.position.set(0, calendar.h * 0.62, calendar.h * 0.14 + 0.004);
  dateBlock.rotation.x = -lean;
  root.add(dateBlock);

  return root;
}

function buildSticky(): THREE.Group {
  const { sticky } = LAYOUT;
  const root = new THREE.Group();
  root.name = NODES.stickyRoot;
  root.position.set(sticky.x, DESK_TOP_Y, sticky.z);

  const offsets: Array<[number, number, number]> = [
    [-0.02, 0.0, -0.12],
    [0.055, 0.045, 0.31],
    [-0.045, -0.055, 0.55],
  ];
  offsets.forEach(([x, z, rot], i) => {
    const note = new THREE.Mesh(
      new THREE.PlaneGeometry(sticky.size, sticky.size),
      MAT.stickyNote,
    );
    note.name = `decor_sticky_${i}`;
    note.rotation.x = -Math.PI / 2;
    note.rotation.z = rot;
    note.position.set(x, 0.002 + i * 0.0012, z);
    note.receiveShadow = true;
    root.add(note);
  });

  return root;
}

function buildClock(): THREE.Group {
  const { clock } = LAYOUT;
  const root = new THREE.Group();
  root.name = NODES.clockRoot;
  root.position.set(clock.x, DESK_TOP_Y, clock.z);
  root.rotation.y = 0.12;

  const faceY = clock.standH + clock.faceR;

  // 底座与支架
  const base = box(0.09, 0.02, 0.05, MAT.brass);
  base.position.y = 0.01;
  root.add(base);
  const stand = box(0.016, clock.standH, 0.016, MAT.brass);
  stand.position.y = 0.02 + clock.standH / 2 - 0.01;
  root.add(stand);

  // 外圈
  const bezel = new THREE.Mesh(
    new THREE.TorusGeometry(clock.faceR + 0.006, 0.008, 12, 40),
    MAT.brass,
  );
  bezel.name = 'decor_clock_bezel';
  bezel.position.y = faceY;
  bezel.castShadow = true;
  root.add(bezel);

  // 表盘：原点在圆心，+Z 朝外
  const face = new THREE.Mesh(
    new THREE.CircleGeometry(clock.faceR, 48),
    new THREE.MeshStandardMaterial({ color: 0xefe6cf, roughness: 0.85 }),
  );
  face.name = NODES.clockFace;
  face.position.y = faceY;
  root.add(face);

  // 刻度：60 根，整点加粗（材质独立，校准接近时可整体提亮）
  const ticks = new THREE.Group();
  ticks.name = 'clock_ticks';
  ticks.position.set(0, faceY, 0.002);
  const tickMat = new THREE.MeshStandardMaterial({
    color: 0x5a4c3a,
    emissive: 0xc9a45c,
    emissiveIntensity: 0,
    roughness: 0.7,
  });
  for (let i = 0; i < 60; i++) {
    const major = i % 5 === 0;
    const tick = new THREE.Mesh(
      new THREE.BoxGeometry(major ? 0.004 : 0.002, major ? 0.012 : 0.006, 0.001),
      tickMat,
    );
    const angle = (i / 60) * Math.PI * 2;
    const r = clock.faceR - 0.011;
    tick.position.set(Math.sin(angle) * r, Math.cos(angle) * r, 0);
    tick.rotation.z = -angle;
    ticks.add(tick);
  }
  root.add(ticks);

  // 指针：原点在旋转轴心，指向 12 点为局部 +Y，绕局部 Z 旋转
  const mkHand = (
    len: number,
    width: number,
    mat: THREE.Material,
    name: string,
    zOffset: number,
  ) => {
    const geo = new THREE.BoxGeometry(width, len, 0.0016);
    geo.translate(0, len / 2 - len * 0.12, 0); // 轴心附近留一点尾巴
    const hand = new THREE.Mesh(geo, mat);
    hand.name = name;
    hand.position.set(0, faceY, 0.004 + zOffset);
    hand.castShadow = false;
    return hand;
  };
  root.add(mkHand(clock.faceR * 0.52, 0.006, MAT.ink, NODES.clockHandHour, 0));
  root.add(mkHand(clock.faceR * 0.78, 0.004, MAT.ink, NODES.clockHandMinute, 0.002));
  const secondMat = new THREE.MeshStandardMaterial({ color: 0xa8853c, roughness: 0.5 });
  root.add(mkHand(clock.faceR * 0.85, 0.0018, secondMat, NODES.clockHandSecond, 0.004));

  // 轴帽
  const hub = new THREE.Mesh(new THREE.SphereGeometry(0.006, 12, 8), MAT.brass);
  hub.name = 'decor_clock_hub';
  hub.position.set(0, faceY, 0.008);
  root.add(hub);

  // 分针碰撞代理：覆盖整个表盘的透明圆盘（拖动判定用，放宽命中）
  const hit = new THREE.Mesh(
    new THREE.CircleGeometry(clock.faceR + 0.02, 24),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  hit.name = NODES.hitClockMinute;
  hit.position.set(0, faceY, 0.01);
  root.add(hit);

  return root;
}

/** 桌面小装饰：相框 */
function buildDecor(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'decor_misc';

  const frame = new THREE.Group();
  frame.name = 'decor_photo_frame';
  frame.position.set(-0.72, DESK_TOP_Y, -0.28);
  frame.rotation.y = 0.5;
  const border = box(0.09, 0.11, 0.008, MAT.woodDark);
  border.position.y = 0.055;
  border.rotation.x = -0.12;
  frame.add(border);
  const photo = new THREE.Mesh(
    new THREE.PlaneGeometry(0.07, 0.09),
    new THREE.MeshStandardMaterial({ color: 0x8a9db0, roughness: 0.8 }),
  );
  photo.position.set(0, 0.055, 0.005);
  photo.rotation.x = -0.12;
  frame.add(photo);
  group.add(frame);

  return group;
}

export interface PlaceholderScene {
  root: THREE.Group;
  screenTexture: THREE.CanvasTexture;
}

export function buildPlaceholderScene(): PlaceholderScene {
  const root = new THREE.Group();
  root.name = 'desk_scene_root';

  const screenTexture = createScreenTexture();

  root.add(buildRoom());
  root.add(buildWindow());
  root.add(buildDesk());
  root.add(buildLamp());
  root.add(buildMonitor(screenTexture));
  root.add(buildNotebook());
  root.add(buildCoffee());
  root.add(buildCalendar());
  root.add(buildSticky());
  root.add(buildClock());
  root.add(buildDecor());

  return { root, screenTexture };
}
