/* ==========================================================================
   AEROTWIN-AI PROTOTYPE — MULTI-PAGE APPLICATION ENGINE
   Three.js 3D Aero-Piston Engine, Multi-Page Router, Simulator Lab & Reports
   ========================================================================== */

// --- Global API Configuration ---
const API_BASE = "http://localhost:8000";

// --- Global State ---
let TELEMETRY_DATA = [];
let currentCycleIdx = 0;
let isPlaying = false;
let playInterval = null;
let currentFaultSimulated = "healthy";
let isAutoRotating = false;
let lastFocusedFault = null;

// Independent Simulator Lab State
let LAB_SIMULATION_DATA = [];
let activeSimulatorPreset = "healthy";

// Planned Mission settings for interactive feasibility
let plannedMissionDurationHrs = 4.0;
let plannedMaxAltitudeFt = 18000;

// --- Charts Registry ---
const CHARTS = {};

// --- Color Theme Constants ---
const APP_COLORS = {
  blue: '#38BDF8',
  orange: '#FB923C',
  red: '#EF4444',
  green: '#10B981',
  yellow: '#F59E0B',
  cyan: '#00D2FF',
  purple: '#C084FC',
  dimLine: 'rgba(255, 255, 255, 0.08)',
  textSecondary: '#94A3B8'
};

// ==========================================================================
// 1. MULTI-PAGE NAVIGATION ROUTER
// ==========================================================================
const VALID_PAGES = [
  'twin-engine',
  'simulator',
  'health-rul',
  'fault-detection',
  'mission-analysis',
  'alerts',
  'reports',
  'settings'
];

function navigateToPage(pageId) {
  if (!VALID_PAGES.includes(pageId)) pageId = 'twin-engine';

  // 1. Update active sidebar item
  document.querySelectorAll('.sidebar-nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === pageId);
  });

  // 2. Update active page view
  document.querySelectorAll('.page-view').forEach(view => {
    view.classList.remove('active-page');
  });
  const targetView = document.getElementById(`page-${pageId}`);
  if (targetView) {
    targetView.classList.add('active-page');
  }

  // 3. Update window hash without jump
  if (window.location.hash !== `#/${pageId}`) {
    window.history.pushState(null, '', `#/${pageId}`);
  }

  // 4. Handle Three.js resize when switching to Twin Engine
  if (pageId === 'twin-engine' && renderer && camera) {
    setTimeout(() => {
      const container = document.getElementById('threeEngineContainer');
      if (container) {
        const w = container.clientWidth;
        const h = container.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      }
    }, 50);
  }

  // 5. Trigger resize on Chart.js charts
  setTimeout(() => {
    Object.values(CHARTS).forEach(chart => {
      if (chart && typeof chart.resize === 'function') {
        chart.resize();
      }
    });
  }, 100);

  // 6. Refresh history table if on reports page
  if (pageId === 'reports') {
    loadMissionHistory();
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function handleHashChange() {
  const hash = window.location.hash.replace('#/', '').replace('#', '');
  if (VALID_PAGES.includes(hash)) {
    navigateToPage(hash);
  } else {
    navigateToPage('twin-engine');
  }
}

// ==========================================================================
// 2. THREE.JS 3D AERO-PISTON ENGINE SCENE
// ==========================================================================
let scene, camera, renderer, controls;
let engineGroup, propellerGroup, pistons = [], exhaustPipes = [], cylinderHeads = [], interactiveMeshes = [];
let isExploded = false;
let isThermalEnabled = true;
let raycaster, mouse;

const COMPONENT_CAM_TARGETS = {
  rpm: { pos: new THREE.Vector3(0, 0.5, 4.2), target: new THREE.Vector3(0, 0.15, 1.9), name: "Propeller & PRGB Reduction Hub" },
  cht: { pos: new THREE.Vector3(-3.2, 1.2, 0.6), target: new THREE.Vector3(-0.98, 0, 0.55), name: "Cylinder Heads (Cyl 1-4)" },
  egt: { pos: new THREE.Vector3(2.5, -1.0, -3.2), target: new THREE.Vector3(0, -0.65, -1.4), name: "Exhaust Manifold & Turbocharger" },
  oil: { pos: new THREE.Vector3(-2.8, -1.2, 2.2), target: new THREE.Vector3(-0.6, -0.4, 0.8), name: "Oil Sump & Filter System" },
  fuel: { pos: new THREE.Vector3(2.4, 2.0, 0.5), target: new THREE.Vector3(0.7, 0.35, 0), name: "Fuel Rails & Injectors" },
  vib: { pos: new THREE.Vector3(1.8, 2.2, 1.5), target: new THREE.Vector3(0.4, 0.58, 0.3), name: "Vibration Transducer Sensor" }
};

function initThreeEngine() {
  const container = document.getElementById('threeEngineContainer');
  if (!container) return;

  const width = container.clientWidth || 500;
  const height = container.clientHeight || 440;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x070E15);
  scene.fog = new THREE.FogExp2(0x070E15, 0.04);

  camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
  camera.position.set(4.5, 2.8, 4.8);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  container.appendChild(renderer.domElement);

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.maxDistance = 14;
  controls.minDistance = 2.0;
  controls.target.set(0, 0, 0);

  const ambientLight = new THREE.AmbientLight(0x2A3E52, 1.8);
  scene.add(ambientLight);

  const keyLight = new THREE.DirectionalLight(0xEEF6FF, 2.2);
  keyLight.position.set(6, 8, 5);
  keyLight.castShadow = true;
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0x00D2FF, 1.4);
  fillLight.position.set(-6, -2, -4);
  scene.add(fillLight);

  const topRimLight = new THREE.PointLight(0x38BDF8, 2.0, 10);
  topRimLight.position.set(0, 4, 0);
  scene.add(topRimLight);

  const gridHelper = new THREE.GridHelper(10, 20, 0x00D2FF, 0x142838);
  gridHelper.position.y = -1.5;
  scene.add(gridHelper);

  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  renderer.domElement.addEventListener('click', onEngineCanvasClick);

  buildAeroPistonEngine();

  document.getElementById('btnResetCamera')?.addEventListener('click', () => {
    smoothMoveCamera(new THREE.Vector3(4.5, 2.8, 4.8), new THREE.Vector3(0, 0, 0));
  });

  document.getElementById('btnExplodeView')?.addEventListener('click', toggleExplodedView);
  document.getElementById('btnToggleThermal')?.addEventListener('click', () => {
    isThermalEnabled = !isThermalEnabled;
    updateEngineThermalGlow(
      parseFloat(document.getElementById('disp-cht')?.textContent || 312),
      parseFloat(document.getElementById('disp-egt')?.textContent || 854)
    );
  });

  document.getElementById('btnAutoRotate')?.addEventListener('click', () => {
    isAutoRotating = !isAutoRotating;
    controls.autoRotate = isAutoRotating;
    controls.autoRotateSpeed = 2.5;
    document.getElementById('btnAutoRotate').style.color = isAutoRotating ? '#00D2FF' : '';
  });

  // View Selector
  const viewSelect = document.getElementById('cameraViewSelect');
  if (viewSelect) {
    viewSelect.addEventListener('change', (e) => setCameraView(e.target.value));
  }

  window.addEventListener('resize', () => {
    if (!container) return;
    const newW = container.clientWidth;
    const newH = container.clientHeight;
    camera.aspect = newW / newH;
    camera.updateProjectionMatrix();
    renderer.setSize(newW, newH);
  });

  animateThree();
}

// Sub-assembly groups for exploded/sectional views
let leftBank, rightBank, exhaustAssembly, intakeAssembly, crankcaseGroup, gearboxGroup;
let crankcaseMeshes = [], intakeMeshes = [], airflowParticles = null, airflowActive = false;
let isSectional = false;

function buildAeroPistonEngine() {
  engineGroup = new THREE.Group();
  scene.add(engineGroup);
  interactiveMeshes = [];
  cylinderHeads = [];
  exhaustPipes = [];
  pistons = [];

  // ── Materials ────────────────────────────────────────────────────────────────
  const crankcaseMat  = new THREE.MeshStandardMaterial({ color: 0x4A5A6B, metalness: 0.88, roughness: 0.25 });
  const alloyMat      = new THREE.MeshStandardMaterial({ color: 0x2E3C4A, metalness: 0.92, roughness: 0.30 });
  const finMat        = new THREE.MeshStandardMaterial({ color: 0x607080, metalness: 0.80, roughness: 0.28 });
  const chromeMat     = new THREE.MeshStandardMaterial({ color: 0xD8E8F4, metalness: 0.96, roughness: 0.12 });
  const steelMat      = new THREE.MeshStandardMaterial({ color: 0xA0B0C0, metalness: 0.95, roughness: 0.18 });
  const brassMat      = new THREE.MeshStandardMaterial({ color: 0xC8963E, metalness: 0.82, roughness: 0.22 });
  const exhaustMat    = new THREE.MeshStandardMaterial({ color: 0x2E2620, metalness: 0.70, roughness: 0.42, emissive: 0xFF3300, emissiveIntensity: 0.35 });
  const carbonPropMat = new THREE.MeshStandardMaterial({ color: 0x141820, metalness: 0.30, roughness: 0.45 });
  const rubberMat     = new THREE.MeshStandardMaterial({ color: 0x1A1A1A, metalness: 0.05, roughness: 0.90 });
  const fuelRailMat   = new THREE.MeshStandardMaterial({ color: 0x38BDF8, metalness: 0.92, roughness: 0.18 });
  const oilMat        = new THREE.MeshStandardMaterial({ color: 0x1E3A8A, metalness: 0.65, roughness: 0.32 });
  const plasticBlack  = new THREE.MeshStandardMaterial({ color: 0x0D1117, metalness: 0.10, roughness: 0.80 });

  // ── Crankcase Block ──────────────────────────────────────────────────────────
  crankcaseGroup = new THREE.Group();
  engineGroup.add(crankcaseGroup);

  const caseGeo   = new THREE.BoxGeometry(1.55, 1.00, 2.10);
  const caseMain  = new THREE.Mesh(caseGeo, crankcaseMat);
  caseMain.castShadow = true;
  caseMain.userData = { compKey: 'oil' };
  crankcaseGroup.add(caseMain);
  crankcaseMeshes.push(caseMain);
  interactiveMeshes.push(caseMain);

  // Case ribs
  for (let r = -0.85; r <= 0.85; r += 0.28) {
    const ribGeo = new THREE.BoxGeometry(1.60, 0.07, 0.09);
    const rib    = new THREE.Mesh(ribGeo, finMat);
    rib.position.set(0, 0.52, r);
    crankcaseGroup.add(rib);
    crankcaseMeshes.push(rib);
  }

  // Crankshaft (inside crankcase, visible in sectional)
  const crankGeo  = new THREE.CylinderGeometry(0.12, 0.12, 2.0, 20);
  const crankMesh = new THREE.Mesh(crankGeo, chromeMat);
  crankMesh.rotation.z = Math.PI / 2;
  crankMesh.position.set(0, -0.15, 0);
  crankMesh.userData = { compKey: 'rpm' };
  crankcaseGroup.add(crankMesh);
  interactiveMeshes.push(crankMesh);

  // Crank throws
  const throwOffsets = [-0.75, -0.25, 0.25, 0.75];
  throwOffsets.forEach(zOff => {
    const throwGeo  = new THREE.BoxGeometry(0.55, 0.08, 0.18);
    const throwMesh = new THREE.Mesh(throwGeo, steelMat);
    throwMesh.position.set(0, -0.10, zOff);
    crankcaseGroup.add(throwMesh);
  });

  // Oil sump
  const sumpGeo  = new THREE.BoxGeometry(1.18, 0.28, 1.90);
  const sump     = new THREE.Mesh(sumpGeo, crankcaseMat);
  sump.position.set(0, -0.64, 0);
  sump.userData  = { compKey: 'oil' };
  crankcaseGroup.add(sump);
  crankcaseMeshes.push(sump);
  interactiveMeshes.push(sump);

  // Oil drain plug
  const drainGeo  = new THREE.CylinderGeometry(0.07, 0.07, 0.12, 12);
  const drainPlug = new THREE.Mesh(drainGeo, brassMat);
  drainPlug.position.set(0.3, -0.80, 0.5);
  drainPlug.userData = { compKey: 'oil' };
  crankcaseGroup.add(drainPlug);

  // Oil filter
  const oilFiltGeo  = new THREE.CylinderGeometry(0.16, 0.16, 0.44, 16);
  const oilFilter   = new THREE.Mesh(oilFiltGeo, oilMat);
  oilFilter.position.set(-0.72, -0.28, 0.80);
  oilFilter.userData = { compKey: 'oil' };
  crankcaseGroup.add(oilFilter);
  interactiveMeshes.push(oilFilter);

  // Oil pump body
  const oilPumpGeo  = new THREE.BoxGeometry(0.26, 0.22, 0.36);
  const oilPump     = new THREE.Mesh(oilPumpGeo, alloyMat);
  oilPump.position.set(-0.70, -0.52, 0.30);
  oilPump.userData  = { compKey: 'oil' };
  crankcaseGroup.add(oilPump);
  interactiveMeshes.push(oilPump);

  // Starter motor
  const starterGeo  = new THREE.CylinderGeometry(0.10, 0.10, 0.55, 14);
  const starter     = new THREE.Mesh(starterGeo, plasticBlack);
  starter.rotation.z = Math.PI / 2;
  starter.position.set(0.68, -0.45, -0.90);
  crankcaseGroup.add(starter);

  // ── Propeller Reduction Gearbox ──────────────────────────────────────────────
  gearboxGroup = new THREE.Group();
  gearboxGroup.position.set(0, 0.10, 1.35);
  engineGroup.add(gearboxGroup);

  const prgbGeo    = new THREE.CylinderGeometry(0.42, 0.60, 0.88, 24);
  const prgbMesh   = new THREE.Mesh(prgbGeo, crankcaseMat);
  prgbMesh.rotation.x = Math.PI / 2;
  prgbMesh.userData = { compKey: 'rpm' };
  gearboxGroup.add(prgbMesh);
  interactiveMeshes.push(prgbMesh);

  // PRGB front cover
  const prgbCoverGeo  = new THREE.CylinderGeometry(0.44, 0.44, 0.10, 24);
  const prgbCover     = new THREE.Mesh(prgbCoverGeo, alloyMat);
  prgbCover.rotation.x = Math.PI / 2;
  prgbCover.position.z = 0.49;
  gearboxGroup.add(prgbCover);

  // Prop flange bolts (5 bolts)
  for (let b = 0; b < 5; b++) {
    const angle   = (b / 5) * Math.PI * 2;
    const boltGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.06, 8);
    const bolt    = new THREE.Mesh(boltGeo, brassMat);
    bolt.rotation.x = Math.PI / 2;
    bolt.position.set(Math.cos(angle) * 0.34, Math.sin(angle) * 0.34, 0.55);
    gearboxGroup.add(bolt);
  }

  // ── Propeller ────────────────────────────────────────────────────────────────
  propellerGroup = new THREE.Group();
  propellerGroup.position.set(0, 0.10, 1.96);
  engineGroup.add(propellerGroup);

  // Spinner
  const spinnerGeo = new THREE.ConeGeometry(0.32, 0.62, 24);
  const spinner    = new THREE.Mesh(spinnerGeo, chromeMat);
  spinner.rotation.x = Math.PI / 2;
  spinner.position.z = 0.20;
  spinner.userData = { compKey: 'rpm' };
  propellerGroup.add(spinner);
  interactiveMeshes.push(spinner);

  // Spinner back plate
  const spBackGeo = new THREE.CylinderGeometry(0.33, 0.33, 0.06, 20);
  const spBack    = new THREE.Mesh(spBackGeo, steelMat);
  spBack.rotation.x = Math.PI / 2;
  propellerGroup.add(spBack);

  // 3 blades
  for (let b = 0; b < 3; b++) {
    const bladeArm = new THREE.Group();
    bladeArm.rotation.z = (b / 3) * Math.PI * 2;

    // Blade body (tapered)
    const bladeShapeGeo = new THREE.BoxGeometry(0.19, 2.30, 0.038);
    const blade         = new THREE.Mesh(bladeShapeGeo, carbonPropMat);
    blade.position.set(0, 1.15, 0);
    blade.rotation.y = 0.24;
    blade.userData   = { compKey: 'rpm' };
    interactiveMeshes.push(blade);

    // Tip stripe
    const tipGeo = new THREE.BoxGeometry(0.195, 0.22, 0.042);
    const tip    = new THREE.Mesh(tipGeo, new THREE.MeshBasicMaterial({ color: 0xFBBF24 }));
    tip.position.set(0, 2.14, 0);

    bladeArm.add(blade, tip);
    propellerGroup.add(bladeArm);
  }

  // ── Cylinder Banks (4 cylinders: 2 left, 2 right) ────────────────────────────
  const cylinderConfigs = [
    { id: 0, side: -1, z:  0.60 },  // Left-front
    { id: 1, side:  1, z:  0.60 },  // Right-front
    { id: 2, side: -1, z: -0.60 },  // Left-rear
    { id: 3, side:  1, z: -0.60 },  // Right-rear
  ];

  leftBank  = new THREE.Group();
  rightBank = new THREE.Group();
  engineGroup.add(leftBank);
  engineGroup.add(rightBank);

  // Save default bank positions for explode
  leftBank.userData  = { defaultX: 0 };
  rightBank.userData = { defaultX: 0 };

  cylinderConfigs.forEach(cfg => {
    const bank      = cfg.side === -1 ? leftBank : rightBank;
    const cylGroup  = new THREE.Group();
    cylGroup.position.set(cfg.side * 0.78, 0, cfg.z);
    cylGroup.userData = { defaultX: cfg.side * 0.78, side: cfg.side };

    // ── Cylinder barrel ──
    const barrelGeo = new THREE.CylinderGeometry(0.370, 0.370, 0.88, 22);
    const barrel    = new THREE.Mesh(barrelGeo, alloyMat);
    barrel.rotation.z = Math.PI / 2;
    barrel.position.x  = cfg.side * 0.44;
    barrel.userData    = { compKey: 'cht' };
    cylGroup.add(barrel);
    crankcaseMeshes.push(barrel);
    interactiveMeshes.push(barrel);

    // ── Deep cooling fins (12 fins per cylinder) ──
    for (let f = 0; f < 12; f++) {
      const t      = f / 11;
      const finR   = 0.46 + Math.sin(t * Math.PI) * 0.04;
      const finGeo = new THREE.CylinderGeometry(finR, finR, 0.022, 22);
      const fin    = new THREE.Mesh(finGeo, finMat);
      fin.rotation.z  = Math.PI / 2;
      fin.position.x  = cfg.side * (0.06 + t * 0.82);
      cylGroup.add(fin);
      crankcaseMeshes.push(fin);
    }

    // ── Cylinder head ──
    const headGeo = new THREE.BoxGeometry(0.28, 0.72, 0.74);
    const headMat = new THREE.MeshStandardMaterial({
      color: 0x3A4D5E, metalness: 0.82, roughness: 0.28,
      emissive: 0x00D2FF, emissiveIntensity: 0.10
    });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.x = cfg.side * 1.00;
    head.userData   = { compKey: 'cht' };
    cylGroup.add(head);
    cylinderHeads.push(head);
    crankcaseMeshes.push(head);
    interactiveMeshes.push(head);

    // Head cooling fins
    for (let hf = 0; hf < 6; hf++) {
      const hFinGeo = new THREE.BoxGeometry(0.06, 0.74 + hf * 0.02, 0.016);
      const hFin    = new THREE.Mesh(hFinGeo, finMat);
      hFin.position.set(cfg.side * 1.02, 0, -0.30 + hf * 0.12);
      cylGroup.add(hFin);
      crankcaseMeshes.push(hFin);
    }

    // ── Valve cover (top of head) ──
    const vcGeo   = new THREE.BoxGeometry(0.12, 0.66, 0.66);
    const vCover  = new THREE.Mesh(vcGeo, alloyMat);
    vCover.position.x = cfg.side * 1.10;
    vCover.userData   = { compKey: 'cht' };
    cylGroup.add(vCover);
    crankcaseMeshes.push(vCover);

    // ── Spark plugs (2 per cylinder: top and side) ──
    const plugPositions = [
      { y: 0.38, z: 0.12 },
      { y: 0.38, z: -0.12 }
    ];
    plugPositions.forEach(pp => {
      const plugGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.22, 12);
      const plug    = new THREE.Mesh(plugGeo, brassMat);
      plug.position.set(cfg.side * 1.04, pp.y, pp.z);
      plug.userData = { compKey: 'cht' };
      cylGroup.add(plug);
      interactiveMeshes.push(plug);

      // Ignition wire
      const wireGeo = new THREE.CylinderGeometry(0.020, 0.020, 0.70, 8);
      const wire    = new THREE.Mesh(wireGeo, new THREE.MeshBasicMaterial({ color: 0xFF2222 }));
      wire.position.set(cfg.side * 0.72, 0.48, pp.z);
      wire.rotation.z = -cfg.side * 0.45;
      cylGroup.add(wire);
    });

    // ── Intake valve stub ──
    const intakeValveGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.18, 10);
    const intakeValve    = new THREE.Mesh(intakeValveGeo, steelMat);
    intakeValve.position.set(cfg.side * 1.06, -0.18, 0.18);
    intakeValve.rotation.z = Math.PI / 2;
    intakeValve.userData   = { compKey: 'fuel' };
    cylGroup.add(intakeValve);

    // ── Exhaust valve stub ──
    const exhaustValveGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.18, 10);
    const exhaustValve    = new THREE.Mesh(exhaustValveGeo, steelMat);
    exhaustValve.position.set(cfg.side * 1.06, -0.18, -0.18);
    exhaustValve.rotation.z = Math.PI / 2;
    exhaustValve.userData   = { compKey: 'egt' };
    cylGroup.add(exhaustValve);

    // ── Piston (inside barrel, visible in sectional) ──
    const pistonGeo = new THREE.CylinderGeometry(0.345, 0.345, 0.30, 18);
    const piston    = new THREE.Mesh(pistonGeo, chromeMat);
    piston.rotation.z = Math.PI / 2;
    piston.position.x = cfg.side * 0.44;
    piston.userData   = { compKey: 'cht' };
    cylGroup.add(piston);
    pistons.push({ mesh: piston, side: cfg.side, basePos: cfg.side * 0.44, phase: cfg.id * Math.PI * 0.5 });

    // Piston rings (2)
    [0.06, -0.06].forEach(rOff => {
      const ringGeo = new THREE.TorusGeometry(0.345, 0.015, 8, 20);
      const ring    = new THREE.Mesh(ringGeo, steelMat);
      ring.rotation.y = Math.PI / 2;
      ring.position.x = cfg.side * 0.44 + rOff;
      cylGroup.add(ring);
    });

    // ── Wrist pin ──
    const wristGeo = new THREE.CylinderGeometry(0.030, 0.030, 0.56, 10);
    const wristPin = new THREE.Mesh(wristGeo, steelMat);
    wristPin.position.set(cfg.side * 0.44, 0, 0);
    cylGroup.add(wristPin);

    // ── Connecting rod ──
    const conRodCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(cfg.side * 0.46, 0, 0),
      new THREE.Vector3(cfg.side * 0.24, -0.14, 0),
      new THREE.Vector3(0, -0.14, 0)
    ]);
    const conRodGeo = new THREE.TubeGeometry(conRodCurve, 16, 0.030, 8, false);
    const conRod    = new THREE.Mesh(conRodGeo, steelMat);
    conRod.userData = { compKey: 'vib' };
    cylGroup.add(conRod);

    // ── Fuel injector ──
    const injGeo  = new THREE.CylinderGeometry(0.028, 0.028, 0.28, 10);
    const injMesh = new THREE.Mesh(injGeo, brassMat);
    injMesh.position.set(cfg.side * 0.86, 0.32, 0.24);
    injMesh.userData = { compKey: 'fuel' };
    cylGroup.add(injMesh);
    interactiveMeshes.push(injMesh);

    bank.add(cylGroup);
  });

  // ── Intake Manifold Assembly ─────────────────────────────────────────────────
  intakeAssembly = new THREE.Group();
  engineGroup.add(intakeAssembly);
  intakeAssembly.userData = { defaultY: 0 };

  // Air filter / throttle body box on top
  const airBoxGeo  = new THREE.BoxGeometry(1.30, 0.38, 0.70);
  const airBox     = new THREE.Mesh(airBoxGeo, plasticBlack);
  airBox.position.set(0, 0.82, 0.20);
  airBox.userData  = { compKey: 'fuel' };
  intakeAssembly.add(airBox);
  intakeMeshes.push(airBox);
  interactiveMeshes.push(airBox);

  // Throttle body
  const tBodyGeo   = new THREE.CylinderGeometry(0.14, 0.14, 0.30, 16);
  const tBody      = new THREE.Mesh(tBodyGeo, alloyMat);
  tBody.position.set(0, 0.72, 0.52);
  tBody.userData   = { compKey: 'fuel' };
  intakeAssembly.add(tBody);
  intakeMeshes.push(tBody);

  // ECU/Ignition module
  const ecuGeo  = new THREE.BoxGeometry(0.42, 0.22, 0.30);
  const ecus    = new THREE.Mesh(ecuGeo, plasticBlack);
  ecus.position.set(0.52, 0.86, -0.35);
  intakeAssembly.add(ecus);
  intakeMeshes.push(ecus);

  // Intake runners to each cylinder (left bank)
  [0.60, -0.60].forEach(zCfg => {
    const runnerCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.70, zCfg),
      new THREE.Vector3(-0.50, 0.50, zCfg),
      new THREE.Vector3(-0.80, 0.10, zCfg)
    ]);
    const runnerGeo = new THREE.TubeGeometry(runnerCurve, 20, 0.055, 10, false);
    const runner    = new THREE.Mesh(runnerGeo, alloyMat);
    runner.userData = { compKey: 'fuel' };
    intakeAssembly.add(runner);
    intakeMeshes.push(runner);
    interactiveMeshes.push(runner);
  });
  // Right bank
  [0.60, -0.60].forEach(zCfg => {
    const runnerCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.70, zCfg),
      new THREE.Vector3(0.50, 0.50, zCfg),
      new THREE.Vector3(0.80, 0.10, zCfg)
    ]);
    const runnerGeo = new THREE.TubeGeometry(runnerCurve, 20, 0.055, 10, false);
    const runner    = new THREE.Mesh(runnerGeo, alloyMat);
    runner.userData = { compKey: 'fuel' };
    intakeAssembly.add(runner);
    intakeMeshes.push(runner);
    interactiveMeshes.push(runner);
  });

  // Fuel rail – left
  const fuelRailGeo  = new THREE.CylinderGeometry(0.038, 0.038, 1.72, 12);
  const fuelRailL    = new THREE.Mesh(fuelRailGeo, fuelRailMat);
  fuelRailL.position.set(-0.72, 0.32, 0);
  fuelRailL.rotation.x = Math.PI / 2;
  fuelRailL.userData    = { compKey: 'fuel' };
  intakeAssembly.add(fuelRailL);
  intakeMeshes.push(fuelRailL);
  interactiveMeshes.push(fuelRailL);

  // Fuel rail – right
  const fuelRailR = new THREE.Mesh(fuelRailGeo, fuelRailMat);
  fuelRailR.position.set(0.72, 0.32, 0);
  fuelRailR.rotation.x = Math.PI / 2;
  fuelRailR.userData    = { compKey: 'fuel' };
  intakeAssembly.add(fuelRailR);
  intakeMeshes.push(fuelRailR);
  interactiveMeshes.push(fuelRailR);

  // ── Exhaust System ───────────────────────────────────────────────────────────
  exhaustAssembly = new THREE.Group();
  engineGroup.add(exhaustAssembly);
  exhaustAssembly.userData = { defaultZ: 0 };

  // Exhaust runners from each cylinder
  const exhaustRunnerConfigs = [
    { start: new THREE.Vector3(-0.9, -0.25, 0.62), end: new THREE.Vector3(-0.75, -0.55, 0) },
    { start: new THREE.Vector3(0.9, -0.25, 0.62),  end: new THREE.Vector3(0.75, -0.55, 0) },
    { start: new THREE.Vector3(-0.9, -0.25, -0.62), end: new THREE.Vector3(-0.75, -0.55, 0) },
    { start: new THREE.Vector3(0.9, -0.25, -0.62),  end: new THREE.Vector3(0.75, -0.55, 0) },
  ];

  exhaustRunnerConfigs.forEach(rc => {
    const mid       = new THREE.Vector3().lerpVectors(rc.start, rc.end, 0.5).add(new THREE.Vector3(0, -0.15, 0));
    const curve     = new THREE.CatmullRomCurve3([rc.start, mid, rc.end]);
    const rGeo      = new THREE.TubeGeometry(curve, 24, 0.072, 10, false);
    const rMesh     = new THREE.Mesh(rGeo, exhaustMat);
    rMesh.userData  = { compKey: 'egt' };
    exhaustAssembly.add(rMesh);
    exhaustPipes.push(rMesh);
    interactiveMeshes.push(rMesh);
  });

  // Collector pipes (left + right converge to rear)
  [-0.65, 0.65].forEach(xSide => {
    const colCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(xSide, -0.55, 0),
      new THREE.Vector3(xSide * 0.6, -0.65, -0.70),
      new THREE.Vector3(0, -0.65, -1.25)
    ]);
    const colGeo  = new THREE.TubeGeometry(colCurve, 28, 0.090, 10, false);
    const colMesh = new THREE.Mesh(colGeo, exhaustMat);
    colMesh.userData = { compKey: 'egt' };
    exhaustAssembly.add(colMesh);
    exhaustPipes.push(colMesh);
    interactiveMeshes.push(colMesh);
  });

  // Turbocharger / muffler body
  const turboGeo  = new THREE.TorusGeometry(0.32, 0.15, 16, 24);
  const turbo     = new THREE.Mesh(turboGeo, brassMat);
  turbo.position.set(0, -0.62, -1.38);
  turbo.userData  = { compKey: 'egt' };
  exhaustAssembly.add(turbo);
  exhaustPipes.push(turbo);
  interactiveMeshes.push(turbo);

  // Turbo compressor housing
  const compGeo  = new THREE.CylinderGeometry(0.18, 0.22, 0.28, 18);
  const compHsg  = new THREE.Mesh(compGeo, alloyMat);
  compHsg.position.set(0.28, -0.48, -1.38);
  compHsg.userData = { compKey: 'egt' };
  exhaustAssembly.add(compHsg);

  // Tailpipe
  const tailGeo  = new THREE.CylinderGeometry(0.11, 0.10, 0.68, 14);
  const tailpipe = new THREE.Mesh(tailGeo, exhaustMat);
  tailpipe.rotation.x = Math.PI / 2;
  tailpipe.position.set(0, -0.62, -1.78);
  tailpipe.userData = { compKey: 'egt' };
  exhaustAssembly.add(tailpipe);
  exhaustPipes.push(tailpipe);
  interactiveMeshes.push(tailpipe);

  // ── Vibration Transducer Sensors ─────────────────────────────────────────────
  const vibSensorPositions = [
    { x:  0.42, y: 0.56, z:  0.30 },
    { x: -0.42, y: 0.56, z: -0.30 }
  ];
  vibSensorPositions.forEach(vp => {
    const vsGeo  = new THREE.CylinderGeometry(0.065, 0.065, 0.072, 12);
    const vsMat  = new THREE.MeshStandardMaterial({ color: 0xF59E0B, metalness: 0.90, roughness: 0.20 });
    const vs     = new THREE.Mesh(vsGeo, vsMat);
    vs.position.set(vp.x, vp.y, vp.z);
    vs.userData  = { compKey: 'vib' };
    crankcaseGroup.add(vs);
    interactiveMeshes.push(vs);
  });
}





function onEngineCanvasClick(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(interactiveMeshes, false);

  if (intersects.length > 0) {
    const compKey = intersects[0].object.userData?.compKey;
    if (compKey) {
      focusComponent(compKey);
    }
  }
}

function focusComponent(metricKey) {
  const targetData = COMPONENT_CAM_TARGETS[metricKey];
  if (!targetData) return;

  smoothMoveCamera(targetData.pos, targetData.target);

  document.querySelectorAll('.metric-card').forEach(c => c.classList.remove('section-focused'));
  const card = document.querySelector(`.metric-card[data-metric="${metricKey}"]`);
  if (card) {
    card.classList.add('section-focused');
    setTimeout(() => card.classList.remove('section-focused'), 2000);
  }

  document.querySelectorAll('.callout-tag').forEach(t => t.style.transform = '');
  const tag = document.getElementById(`callout-${metricKey}`);
  if (tag) {
    tag.style.transform = 'scale(1.25)';
    setTimeout(() => tag.style.transform = '', 2000);
  }

  const statusEl = document.getElementById('runStatus');
  if (statusEl) {
    statusEl.textContent = `Inspecting Subsystem: ${targetData.name}`;
  }
}

function smoothMoveCamera(targetPos, targetLookAt) {
  const startPos = camera.position.clone();
  const startLookAt = controls.target.clone();
  let progress = 0;

  function step() {
    progress += 0.05;
    camera.position.lerpVectors(startPos, targetPos, progress);
    controls.target.lerpVectors(startLookAt, targetLookAt, progress);
    controls.update();

    if (progress < 1) {
      requestAnimationFrame(step);
    }
  }
  step();
}

function animateThree() {
  requestAnimationFrame(animateThree);

  const rpm = parseFloat(document.getElementById('disp-rpm')?.textContent || 5120);
  const rotationSpeed = (rpm / 60) * 0.015;
  const vib = parseFloat(document.getElementById('disp-vib')?.textContent || 0.1);
  const time = performance.now() * 0.005;

  if (propellerGroup) {
    propellerGroup.rotation.z += rotationSpeed;
  }

  // Engine Vibration Shaking
  if (engineGroup && !isExploded) {
    const shakeAmt = Math.max(0, vib - 0.15) * 0.12;
    if (shakeAmt > 0) {
      engineGroup.position.x = Math.sin(time * 20) * shakeAmt;
      engineGroup.position.y = Math.cos(time * 18) * (shakeAmt * 0.6);
    } else {
      engineGroup.position.x = 0;
      engineGroup.position.y = 0;
    }
  }

  pistons.forEach(p => {
    p.mesh.position.x = p.basePos + Math.sin(time * (rpm / 1000) + p.phase) * (p.side * 0.12);
  });

  controls.update();
  renderer.render(scene, camera);
}


// ── Camera View Controller ────────────────────────────────────────────────────
const ENGINE_VIEWS = {
  isometric_fl:  { pos: new THREE.Vector3( 3.8,  2.6,  3.6), tgt: new THREE.Vector3(0, 0.1, 0) },
  front:         { pos: new THREE.Vector3( 0.0,  0.0,  5.8), tgt: new THREE.Vector3(0, 0.0, 0) },
  rear:          { pos: new THREE.Vector3( 0.0,  0.0, -5.8), tgt: new THREE.Vector3(0, 0.0, 0) },
  right_side:    { pos: new THREE.Vector3( 5.2,  0.0,  0.0), tgt: new THREE.Vector3(0, 0.0, 0) },
  right:         { pos: new THREE.Vector3( 4.0,  1.5,  2.0), tgt: new THREE.Vector3(0, 0.0, 0) },
  top:           { pos: new THREE.Vector3( 0.0,  6.5,  0.0), tgt: new THREE.Vector3(0, 0.0, 0) },
  bottom:        { pos: new THREE.Vector3( 0.0, -6.5,  0.0), tgt: new THREE.Vector3(0, 0.0, 0) },
  isometric_rr:  { pos: new THREE.Vector3(-3.8,  2.6, -3.6), tgt: new THREE.Vector3(0, 0.1, 0) },
  exploded:      { pos: new THREE.Vector3( 4.5,  3.0,  4.8), tgt: new THREE.Vector3(0, 0.1, 0) },
  sectional:     { pos: new THREE.Vector3( 0.0,  0.0,  5.5), tgt: new THREE.Vector3(0, 0.0, 0) },
  airflow:       { pos: new THREE.Vector3( 3.8,  2.2,  3.6), tgt: new THREE.Vector3(0, 0.1, 0) },
};

function setCameraView(viewKey) {
  const view = ENGINE_VIEWS[viewKey];
  if (!view) return;

  // Reset previous special modes
  if (viewKey !== 'exploded' && isExploded) setExplodedState(false);
  if (viewKey !== 'sectional' && isSectional) setSectionalState(false);
  if (viewKey !== 'airflow' && airflowActive) setAirflowState(false);

  smoothMoveCamera(view.pos, view.tgt);

  if (viewKey === 'exploded')  setExplodedState(true);
  if (viewKey === 'sectional') setSectionalState(true);
  if (viewKey === 'airflow')   setAirflowState(true);
}

function setExplodedState(explode) {
  isExploded = explode;
  const btn = document.getElementById('btnExplodeView');
  if (btn) {
    btn.innerHTML = explode ?
      '<i class="fa-solid fa-compress"></i> Normal View' :
      '<i class="fa-solid fa-arrows-split-up-and-left"></i> Cutaway View';
  }

  const targets = [
    { group: leftBank,       from: new THREE.Vector3(0, 0, 0), to: new THREE.Vector3(-1.10, 0.28, 0) },
    { group: rightBank,      from: new THREE.Vector3(0, 0, 0), to: new THREE.Vector3( 1.10, 0.28, 0) },
    { group: intakeAssembly, from: new THREE.Vector3(0, 0, 0), to: new THREE.Vector3( 0,    0.75, 0) },
    { group: exhaustAssembly,from: new THREE.Vector3(0, 0, 0), to: new THREE.Vector3( 0,   -0.55, -0.60) },
    { group: gearboxGroup,   from: new THREE.Vector3(0, 0.10, 1.35), to: new THREE.Vector3(0, 0.10, 2.20) },
    { group: propellerGroup, from: new THREE.Vector3(0, 0.10, 1.96), to: new THREE.Vector3(0, 0.10, 3.10) },
  ];

  targets.forEach(t => {
    if (!t.group) return;
    const startPos = t.group.position.clone();
    const endPos   = explode ? t.from.clone().add(t.to) : (t.group === gearboxGroup ? new THREE.Vector3(0, 0.10, 1.35) : t.group === propellerGroup ? new THREE.Vector3(0, 0.10, 1.96) : new THREE.Vector3(0, 0, 0));
    let progress = 0;
    function step() {
      progress += 0.04;
      t.group.position.lerpVectors(startPos, endPos, Math.min(progress, 1));
      if (progress < 1) requestAnimationFrame(step);
    }
    step();
  });
}

function setSectionalState(on) {
  isSectional = on;
  crankcaseMeshes.forEach(m => {
    if (!m.material) return;
    if (!(m.material instanceof THREE.MeshStandardMaterial)) return;
    m.material = m.material.clone();
    m.material.transparent = on;
    m.material.opacity     = on ? 0.18 : 1.0;
    m.material.depthWrite  = !on;
  });
  intakeMeshes.forEach(m => {
    if (!m.material) return;
    m.material = m.material.clone();
    m.material.transparent = on;
    m.material.opacity     = on ? 0.22 : 1.0;
    m.material.depthWrite  = !on;
  });
}

function setAirflowState(on) {
  airflowActive = on;
  let canvas = document.getElementById('airflowCanvas');
  const container = document.getElementById('threeEngineContainer');
  if (!canvas && on) {
    canvas = document.createElement('canvas');
    canvas.id = 'airflowCanvas';
    container.style.position = 'relative';
    container.appendChild(canvas);
  }
  if (!canvas) return;
  canvas.width  = container.clientWidth;
  canvas.height = container.clientHeight;
  canvas.classList.toggle('visible', on);

  if (!on) {
    if (airflowParticles) cancelAnimationFrame(airflowParticles);
    airflowParticles = null;
    return;
  }

  const ctx    = canvas.getContext('2d');
  // Intake particles (blue) and exhaust particles (orange)
  const intakeP   = Array.from({ length: 32 }, (_, i) => ({ t: i / 32, speed: 0.004 + Math.random() * 0.003, w: canvas.width, h: canvas.height }));
  const exhaustP  = Array.from({ length: 32 }, (_, i) => ({ t: i / 32, speed: 0.003 + Math.random() * 0.003, w: canvas.width, h: canvas.height }));

  function drawAirflow() {
    if (!airflowActive) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const W = canvas.width, H = canvas.height;

    // Intake flow path (top → left cylinders)
    intakeP.forEach(p => {
      p.t += p.speed;
      if (p.t > 1) p.t -= 1;
      const x = W * 0.50 - p.t * W * 0.26;
      const y = H * 0.18 + p.t * H * 0.44;
      const alpha = 0.7 - p.t * 0.4;
      const r = 3 - p.t * 1.5;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(56,189,248,${alpha})`;
      ctx.fill();
    });

    // Exhaust flow path (right cylinders → rear lower)
    exhaustP.forEach(p => {
      p.t += p.speed;
      if (p.t > 1) p.t -= 1;
      const x = W * 0.62 + p.t * W * 0.12;
      const y = H * 0.58 + p.t * H * 0.28;
      const alpha = 0.8 - p.t * 0.5;
      const r = 4 - p.t * 2;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(251,146,60,${alpha})`;
      ctx.fill();
    });

    // Legend
    ctx.font = '11px JetBrains Mono, monospace';
    ctx.fillStyle = 'rgba(56,189,248,0.9)';
    ctx.fillText('● Intake Airflow', 14, H - 28);
    ctx.fillStyle = 'rgba(251,146,60,0.9)';
    ctx.fillText('● Exhaust Flow',   14, H - 12);

    airflowParticles = requestAnimationFrame(drawAirflow);
  }
  drawAirflow();
}

function toggleExplodedView() {
  setExplodedState(!isExploded);
}


function updateEngineThermalGlow(cht, egt) {
  if (!isThermalEnabled) {
    exhaustPipes.forEach(p => {
      p.material.emissiveIntensity = 0.05;
      p.material.emissive.setHex(0x332B25);
    });
    cylinderHeads.forEach(h => {
      h.material.emissiveIntensity = 0.05;
    });
    return;
  }

  const egtNorm = Math.max(0, Math.min(1, (egt - 500) / 450));
  exhaustPipes.forEach(p => {
    p.material.emissiveIntensity = 0.2 + (egtNorm * 1.6);
    if (egt > 800) {
      p.material.emissive.setHex(0xFF2200);
    } else if (egt > 650) {
      p.material.emissive.setHex(0xFF7700);
    } else {
      p.material.emissive.setHex(0x552200);
    }
  });

  const chtNorm = Math.max(0, Math.min(1, (cht - 80) / 270));
  cylinderHeads.forEach(h => {
    h.material.emissiveIntensity = 0.1 + (chtNorm * 0.8);
    if (cht > 300) {
      h.material.emissive.setHex(0xEF4444);
    } else {
      h.material.emissive.setHex(0x00D2FF);
    }
  });
}

// ==========================================================================
// 3. CHART.JS INITIALIZATION
// ==========================================================================
function initCharts() {
  const commonOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(8, 17, 26, 0.95)',
        titleColor: '#00D2FF',
        bodyColor: '#FFFFFF',
        borderColor: '#1E3B56',
        borderWidth: 1,
        bodyFont: { family: 'JetBrains Mono', size: 10 },
        titleFont: { family: 'Inter', size: 11, weight: 'bold' }
      }
    },
    scales: {
      x: {
        grid: { color: APP_COLORS.dimLine, drawBorder: false },
        ticks: { color: APP_COLORS.textSecondary, font: { size: 9, family: 'JetBrains Mono' } }
      },
      y: {
        grid: { color: APP_COLORS.dimLine, drawBorder: false },
        ticks: { color: APP_COLORS.textSecondary, font: { size: 9, family: 'JetBrains Mono' } }
      }
    },
    elements: {
      point: { radius: 0, hitRadius: 8, hoverRadius: 4 }
    }
  };

  // Health Degradation Trend Chart
  const ctxHealth = document.getElementById('healthDegradationChart')?.getContext('2d');
  if (ctxHealth) {
    CHARTS.healthDegradation = new Chart(ctxHealth, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: 'Health Index (%)',
          data: [],
          borderColor: APP_COLORS.blue,
          backgroundColor: 'rgba(56, 189, 248, 0.15)',
          borderWidth: 2,
          pointRadius: 2,
          pointBackgroundColor: APP_COLORS.blue,
          fill: true
        }]
      },
      options: {
        ...commonOptions,
        scales: {
          ...commonOptions.scales,
          y: { ...commonOptions.scales.y, min: 0, max: 100 }
        }
      }
    });
  }

  // RUL Prediction Chart
  const ctxRul = document.getElementById('rulPredictionChart')?.getContext('2d');
  if (ctxRul) {
    CHARTS.rulPrediction = new Chart(ctxRul, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          { label: 'RUL Prediction (hrs)', data: [], borderColor: APP_COLORS.cyan, borderWidth: 2 },
          { label: 'Threshold (15 hrs)', data: [], borderColor: APP_COLORS.red, borderDash: [5, 4], borderWidth: 1.5 }
        ]
      },
      options: commonOptions
    });
  }

  // Mission Profile Altitude Chart
  const ctxMission = document.getElementById('missionProfileChart')?.getContext('2d');
  if (ctxMission) {
    CHARTS.missionProfile = new Chart(ctxMission, {
      type: 'line',
      data: {
        labels: ['0h', '0.5h', '1.0h', '1.5h', '2.0h', '2.5h', '3.0h', '3.5h', '4.0h'],
        datasets: [{
          label: 'Altitude (ft)',
          data: [0, 8500, 14200, 18000, 16500, 18200, 15000, 7500, 0],
          borderColor: APP_COLORS.blue,
          backgroundColor: 'rgba(37, 99, 235, 0.2)',
          fill: true,
          tension: 0.4,
          borderWidth: 2
        }]
      },
      options: commonOptions
    });
  }

  // Simulator Lab Result Charts
  const ctxSimTemp = document.getElementById('simTempChart')?.getContext('2d');
  if (ctxSimTemp) {
    CHARTS.simTemp = new Chart(ctxSimTemp, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          { label: 'CHT Actual', data: [], borderColor: APP_COLORS.orange, borderWidth: 1.5 },
          { label: 'CHT Twin Baseline', data: [], borderColor: APP_COLORS.cyan, borderDash: [4, 3], borderWidth: 1.5 },
          { label: 'EGT Actual', data: [], borderColor: APP_COLORS.red, borderWidth: 1.5 }
        ]
      },
      options: commonOptions
    });
  }

  const ctxSimMech = document.getElementById('simMechanicalChart')?.getContext('2d');
  if (ctxSimMech) {
    CHARTS.simMech = new Chart(ctxSimMech, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          { label: 'Oil Press (kPa)', data: [], borderColor: APP_COLORS.purple, borderWidth: 1.5 },
          { label: 'Vibration RMS (g)', data: [], borderColor: APP_COLORS.green, borderWidth: 1.5 }
        ]
      },
      options: commonOptions
    });
  }

  drawHealthGauge(82);
  drawFeasibilityDonut(72);
}

function drawHealthGauge(value) {
  const canvas = document.getElementById('healthIndexCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h - 6;
  const radius = w / 2 - 12;

  ctx.lineWidth = 9;
  ctx.strokeStyle = '#142636';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, radius, Math.PI, 0, false);
  ctx.stroke();

  const pct = Math.max(0, Math.min(100, value)) / 100;
  const endAngle = Math.PI + (pct * Math.PI);
  const grad = ctx.createLinearGradient(0, cy, w, cy);
  grad.addColorStop(0, '#38BDF8');
  grad.addColorStop(0.7, '#10B981');
  grad.addColorStop(1, '#00D2FF');

  ctx.strokeStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, Math.PI, endAngle, false);
  ctx.stroke();
}

function drawFeasibilityDonut(pct) {
  const canvas = document.getElementById('feasibilityDonut');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;
  const radius = 48;

  ctx.lineWidth = 10;
  ctx.strokeStyle = '#132433';
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();

  const startAngle = -Math.PI / 2;
  const endAngle = startAngle + (pct / 100) * (Math.PI * 2);
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#F59E0B');
  grad.addColorStop(1, '#10B981');

  ctx.strokeStyle = grad;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, radius, startAngle, endAngle);
  ctx.stroke();
}

// ==========================================================================
// 4. DYNAMIC EVALUATION: CONTINUE / CONTINUE + MONITOR / ABORT/RETURN / CRITICAL → ABORT
//    Decisions are SCENARIO-AWARE: each scenario has its own health/severity thresholds.
//    No values are hardcoded to a fixed fault — they depend on the evolving condition
//    and mission requirements (planned duration, altitude, phase).
// ==========================================================================
function evaluateMissionDecision(healthPct, rulHrs, activeFaultClass, egt, vib, severityPct = 0, scenarioKey = 'healthy', extraContext = {}) {
  let recommendation = "CONTINUE";
  let statusClass = "go-status";
  let badgeClass = "badge-continue";
  let description = "Engine operating nominal; flight cleared to continue";
  let feasibilityScore = 92;

  // Retrieve scenario-specific thresholds (fall back to safe defaults if scenario unknown)
  const scenarioCfg = SIM_SCENARIOS[scenarioKey] || SIM_SCENARIOS['healthy'];
  const sev = scenarioCfg.sevThresholds || {};

  // Per-scenario critical thresholds (with universal backstops)
  const critHealth    = sev.criticalHealth ?? 55;
  const abortHealth   = sev.abortHealth   ?? 70;
  const monitorHealth = sev.monitorHealth ?? 85;
  const critSev       = sev.criticalSev   ?? 65;
  const abortSev      = sev.abortSev      ?? 40;
  const monitorSev    = sev.monitorSev    ?? 18;
  const critEgt       = sev.criticalEgt   ?? 820;
  const abortEgt      = sev.abortEgt      ?? 780;
  const critVib       = sev.criticalVib   ?? 0.35;
  const abortVib      = sev.abortVib      ?? 0.28;

  // Extra context from residuals (scenario-specific sensor deltas)
  const oilPDev  = extraContext.oilPDev  ?? 0;
  const fuelDev  = extraContext.fuelDev  ?? 0;
  const rpmDev   = extraContext.rpmDev   ?? 0;

  // Scenario-specific additional checks
  const oilCrit  = sev.criticalOilPDev != null  ? (oilPDev  <= sev.criticalOilPDev)  : false;
  const oilAbort = sev.abortOilPDev    != null  ? (oilPDev  <= sev.abortOilPDev)     : false;
  const fuelCrit = sev.criticalFuelDev != null  ? (fuelDev  <= sev.criticalFuelDev)   : false;
  const fuelAbort= sev.abortFuelDev    != null  ? (fuelDev  <= sev.abortFuelDev)      : false;
  const rpmCrit  = sev.criticalRpmDev  != null  ? (rpmDev   <= sev.criticalRpmDev)    : false;
  const rpmAbort = sev.abortRpmDev     != null  ? (rpmDev   <= sev.abortRpmDev)       : false;

  const isFault = activeFaultClass !== 0 && activeFaultClass !== undefined && activeFaultClass !== 'healthy';

  // Mission deadline pressure — if RUL margin is tight, escalate decision level
  const rulMarginCritical = rulHrs < 5;
  const rulMarginAbort    = rulHrs < plannedMissionDurationHrs;
  const rulMarginMonitor  = rulHrs < (plannedMissionDurationHrs * 1.5);

  // Build decision tier flags
  const isCriticalStress = egt > critEgt || vib > critVib || healthPct < critHealth ||
                            severityPct >= critSev || oilCrit || fuelCrit || rpmCrit;
  const isAbortStress    = egt > abortEgt || vib > abortVib || healthPct < abortHealth ||
                            rulMarginAbort || severityPct >= abortSev ||
                            oilAbort || fuelAbort || rpmAbort;
  const isMonitorStress  = isFault || healthPct < monitorHealth || rulMarginMonitor ||
                            severityPct >= monitorSev;

  if (isCriticalStress || rulMarginCritical) {
    recommendation = "CRITICAL → ABORT";
    statusClass = "nogo-status";
    badgeClass = "badge-critical";
    description = `${scenarioCfg.name}: Critical anomaly in ${scenarioCfg.component} — immediate emergency abort & descent`;
    feasibilityScore = Math.max(10, Math.round(20 - (100 - healthPct) * 0.1));
  } else if (isAbortStress) {
    recommendation = "ABORT/RETURN";
    statusClass = "nogo-status";
    badgeClass = "badge-abort";
    description = `${scenarioCfg.name}: Degradation in ${scenarioCfg.component} threatens completion — execute controlled RTB`;
    feasibilityScore = Math.max(30, Math.round(55 - severityPct * 0.2 - (100 - healthPct) * 0.2));
  } else if (isMonitorStress) {
    recommendation = "CONTINUE + MONITOR";
    statusClass = "caution-status";
    badgeClass = "badge-monitor";
    description = `${scenarioCfg.name}: Divergence in ${scenarioCfg.component} detected — increase sampling & monitor closely`;
    feasibilityScore = Math.max(55, Math.round(78 - severityPct * 0.2));
  } else {
    recommendation = "CONTINUE";
    statusClass = "go-status";
    badgeClass = "badge-continue";
    description = `${scenarioCfg.name}: ${scenarioCfg.component} nominal — cleared to continue mission`;
    feasibilityScore = Math.min(98, Math.round(90 + (healthPct - 90) * 0.5));
  }

  const decisionText = document.getElementById('missionDecisionText');
  if (decisionText) {
    decisionText.textContent = `DECISION: ${recommendation}`;
    decisionText.className = badgeClass;
  }

  const readinessChip = document.getElementById('readinessChip');
  if (readinessChip) {
    readinessChip.className = `readiness-chip ${statusClass}`;
    document.getElementById('readinessText').textContent = recommendation;
    document.getElementById('readinessDesc').textContent = description;
    const icon = document.getElementById('readinessIcon');
    if (icon) {
      icon.className = recommendation === 'CONTINUE' ? 'fa-solid fa-circle-check' :
                       recommendation === 'CONTINUE + MONITOR' ? 'fa-solid fa-triangle-exclamation' : 'fa-solid fa-plane-slash';
    }
  }

  document.getElementById('feasibilityPct').textContent = `${feasibilityScore}%`;
  document.getElementById('feasibilityStatus').textContent = recommendation === 'CONTINUE' ? 'Optimal' : recommendation === 'CONTINUE + MONITOR' ? 'Acceptable' : 'High Risk';
  drawFeasibilityDonut(feasibilityScore);

  const homeFeas = document.getElementById('homeFeasVal');
  const homeRec = document.getElementById('homeRecVal');
  if (homeFeas) homeFeas.textContent = `${feasibilityScore}%`;
  if (homeRec) homeRec.textContent = recommendation;

  return { recommendation, description, feasibilityScore };
}

// ==========================================================================
// 5. TELEMETRY RENDER & CYCLE UPDATE
// ==========================================================================
function renderTelemetryData(trace) {
  TELEMETRY_DATA = trace;
  const cycles = TELEMETRY_DATA.map(d => `C${d.cycle}`);

  if (CHARTS.healthDegradation) {
    CHARTS.healthDegradation.data.labels = cycles;
    CHARTS.healthDegradation.data.datasets[0].data = TELEMETRY_DATA.map(d => d.mission_reliability_pct);
    CHARTS.healthDegradation.update();
  }

  if (CHARTS.rulPrediction) {
    CHARTS.rulPrediction.data.labels = cycles;
    CHARTS.rulPrediction.data.datasets[0].data = TELEMETRY_DATA.map(d => (d.predicted_RUL * 0.3).toFixed(1));
    CHARTS.rulPrediction.data.datasets[1].data = TELEMETRY_DATA.map(() => 15);
    CHARTS.rulPrediction.update();
  }

  const scrub = document.getElementById('scrub');
  if (scrub) {
    scrub.max = TELEMETRY_DATA.length - 1;
    scrub.value = 0;
  }
  document.getElementById('scrubEnd').textContent = `Cycle ${TELEMETRY_DATA.length} (End)`;

  updateCycle(0);
}

function updateCycle(index) {
  if (!TELEMETRY_DATA.length || index < 0 || index >= TELEMETRY_DATA.length) return;
  currentCycleIdx = index;
  const d = TELEMETRY_DATA[index];

  document.getElementById('scrubMid').textContent = `Cycle ${d.cycle}`;

  const avgCht = Math.round((d.cht_1_c + d.cht_2_c + d.cht_3_c + d.cht_4_c) / 4);
  const avgEgt = Math.round((d.egt_1_c + d.egt_2_c + d.egt_3_c + d.egt_4_c) / 4);
  const barOilP = (d.oil_pressure_kpa / 27.5).toFixed(1);
  const fuelKgH = (d.fuel_flow_lph * 0.75).toFixed(1);

  document.getElementById('disp-rpm').textContent = Math.round(d.rpm).toLocaleString();
  document.getElementById('disp-cht').textContent = avgCht;
  document.getElementById('disp-egt').textContent = avgEgt;
  document.getElementById('disp-oilp').textContent = barOilP;
  document.getElementById('disp-fuel').textContent = fuelKgH;
  document.getElementById('disp-vib').textContent = d.vibration_rms_g.toFixed(2);

  document.getElementById('callout-rpm-val').textContent = `${Math.round(d.rpm).toLocaleString()} RPM`;
  document.getElementById('callout-cht-val').textContent = `CHT: ${avgCht} °C`;
  document.getElementById('callout-egt-val').textContent = `EGT: ${avgEgt} °C`;
  document.getElementById('callout-oil-val').textContent = `${barOilP} bar • ${Math.round(d.oil_temp_c)} °C`;
  document.getElementById('callout-fuel-val').textContent = `${fuelKgH} kg/h`;
  document.getElementById('callout-vib-val').textContent = `${d.vibration_rms_g.toFixed(2)} g RMS`;

  document.getElementById('opThrottleVal').textContent = `${Math.round(d.throttle_pct)}%`;
  document.getElementById('opAltitudeVal').textContent = `${Math.round(d.mission_altitude_m * 3.28084).toLocaleString()} ft`;
  document.getElementById('opSpeedVal').textContent = `${(d.mission_airspeed_kmh / 1234.8).toFixed(2)} M`;

  const healthPct = Math.round(d.mission_reliability_pct);
  document.getElementById('healthIndexVal').textContent = `${healthPct}%`;
  document.getElementById('healthGrade').textContent = healthPct > 80 ? 'Good' : healthPct > 50 ? 'Fair' : 'Critical';
  drawHealthGauge(healthPct);

  const homeHealth = document.getElementById('homeHealthVal');
  if (homeHealth) homeHealth.innerHTML = `${healthPct}% <small>${healthPct > 80 ? 'Good' : healthPct > 50 ? 'Fair' : 'Critical'}</small>`;

  const rulHrs = (d.predicted_RUL * 0.3).toFixed(1);
  document.getElementById('kpiRulVal').textContent = rulHrs;
  document.getElementById('rulPredictionHighlight').innerHTML = `RUL: ${rulHrs} hrs <small>(± 6.2 hrs)</small>`;

  const isHealthy = d.predicted_fault_class === 0;
  const diagFault = d.predicted_fault_name.replace(/_/g, ' ').toUpperCase();
  document.getElementById('diagFaultName').textContent = isHealthy ? 'Nominal Operation' : diagFault;

  // Auto-focus on affected component in 3D during active playback if a fault is confident
  if (isPlaying && !isHealthy && d.fault_confidence > 0.8 && lastFocusedFault !== d.predicted_fault_name) {
    lastFocusedFault = d.predicted_fault_name;
    const faultToCompMap = {
      'cooling_airflow_blockage': 'cht',
      'bearing_wear': 'vib',
      'fuel_pump_degradation': 'fuel',
      'exhaust_valve_leak': 'egt',
      'spark_plug_fouling': 'cht',
      'fuel_injector_clog': 'fuel',
      'oil_starvation': 'oil'
    };
    const compKey = faultToCompMap[d.predicted_fault_name];
    if (compKey) {
      focusComponent(compKey);
    }
  }
  if (isHealthy) {
    lastFocusedFault = null;
  }

  const homeFault = document.getElementById('homeFaultVal');
  if (homeFault) homeFault.textContent = isHealthy ? 'Nominal' : d.predicted_fault_name.replace(/_/g, ' ');

  const confPct = Math.round(d.fault_confidence * 100);
  document.getElementById('diagConfidenceVal').textContent = `${confPct}%`;
  document.getElementById('diagConfidenceBar').style.width = `${confPct}%`;

  const diagBadge = document.getElementById('diagStatusBadge');
  if (diagBadge) {
    diagBadge.className = isHealthy ? 'status-indicator-badge badge-nominal' : 'status-indicator-badge badge-warning';
    diagBadge.textContent = isHealthy ? 'Nominal Status' : 'Potential Fault';
  }

  const sevBadge = document.getElementById('diagSeverityBadge');
  if (sevBadge) {
    if (isHealthy) {
      sevBadge.className = 'severity-badge sev-low';
      sevBadge.textContent = 'Low';
    } else if (confPct > 75) {
      sevBadge.className = 'severity-badge sev-high';
      sevBadge.textContent = 'High';
    } else {
      sevBadge.className = 'severity-badge sev-med';
      sevBadge.textContent = 'Medium';
    }
  }

  const egtDev = Math.round(((avgEgt - (d.egt_1_twin || 600)) / (d.egt_1_twin || 600)) * 100);
  const vibDev = Math.round((d.vibration_rms_g / 0.25) * 28);
  const chtDev = Math.round(((avgCht - (d.cht_1_twin || 100)) / (d.cht_1_twin || 100)) * 100);
  const rpmDev = Math.round(Math.abs(d.rpm - (d.rpm_twin || d.rpm)) / 100);

  document.getElementById('dev-egt-val').textContent = (egtDev >= 0 ? '+' : '') + `${egtDev}%`;
  document.getElementById('dev-egt-bar').style.width = `${Math.min(100, Math.abs(egtDev) * 2.5)}%`;

  document.getElementById('dev-vib-val').textContent = `+${Math.min(99, vibDev)}%`;
  document.getElementById('dev-vib-bar').style.width = `${Math.min(100, vibDev * 2.5)}%`;

  document.getElementById('dev-cht-val').textContent = (chtDev >= 0 ? '+' : '') + `${chtDev}%`;
  document.getElementById('dev-cht-bar').style.width = `${Math.min(100, Math.abs(chtDev) * 2.5)}%`;

  document.getElementById('dev-rpm-val').textContent = `+${Math.min(25, rpmDev)}%`;
  document.getElementById('dev-rpm-bar').style.width = `${Math.min(100, rpmDev * 4)}%`;

  evaluateMissionDecision(healthPct, parseFloat(rulHrs), d.predicted_fault_class, avgEgt, d.vibration_rms_g);

  const riskList = document.getElementById('riskFactorsList');
  if (riskList) {
    const risks = [];
    if (avgEgt > 780) risks.push(`<li><i class="fa-solid fa-circle-dot dot-orange"></i> EGT high (${avgEgt} °C) approaching thermal limit</li>`);
    if (d.vibration_rms_g > 0.25) risks.push(`<li><i class="fa-solid fa-circle-dot dot-orange"></i> Mechanical vibration elevated (${d.vibration_rms_g.toFixed(2)} g RMS)</li>`);
    if (parseFloat(rulHrs) < plannedMissionDurationHrs * 1.5) risks.push(`<li><i class="fa-solid fa-circle-dot dot-yellow"></i> RUL margin (${rulHrs}h) close to planned flight (${plannedMissionDurationHrs}h)</li>`);
    if (risks.length === 0) risks.push(`<li><i class="fa-solid fa-circle-dot dot-green" style="color:#10B981"></i> All flight risk factors within nominal bounds</li>`);
    riskList.innerHTML = risks.join('');
  }

  const alertCount = isHealthy ? 0 : 2;
  document.getElementById('sidebarAlertCount').textContent = alertCount;
  document.getElementById('sysStatusText').textContent = isHealthy ? 'All Systems Operational' : 'Telemetry Advisory Active';

  updateEngineThermalGlow(avgCht, avgEgt);
}

// ==========================================================================
// 6. SIMULATOR LAB LOGIC — CLOSED-LOOP INTELLIGENCE & 12 SCENARIOS
// ==========================================================================
let ALL_SYNTHETIC_DATA = [];
let SYNTHETIC_UNITS = {};         // { uid: [rows…] }
let SYNTHETIC_SCENARIOS = {};     // { fault_name: [uid, uid, …] }
let ACTIVE_UNIT_DATA = [];
let liveMissionActive = false;
let liveMissionTimer = null;
let liveCycleCount = 0;
let liveTargetFault = null;
let lastPhaseLabel = '';
let hasLoggedFaultTimeline = false;
let currentOodaStage = 0;

// The 12 User-Requested Operational Scenarios & Physics Mappings
// Each scenario includes:
//   baseFault     – synthetic dataset fault label to select unit trajectories from
//   sevThresholds – sensor-specific critical trigger values for SCENARIO-AWARE decision engine
//   oodaHints     – what each OODA stage label shows dynamically in the UI
const SIM_SCENARIOS = {
  'healthy': {
    name: 'Healthy',
    label: '✅ Healthy (Nominal Baseline)',
    baseFault: 'healthy',
    component: 'All Propulsion Subsystems Nominal',
    camKey: 'rpm',
    desc: 'Normal flight operation within all nominal thermal and mechanical tolerances.',
    sevThresholds: { criticalHealth: 55, abortHealth: 72, monitorHealth: 88,
                     criticalSev: 65, abortSev: 40, monitorSev: 15 },
    oodaHints: ['Scanning all sensor channels for baseline deviation',
                'Cross-checking physics model residuals',
                'All parameters within nominal limits',
                'RUL trend stable; no mission risk projected',
                'Decision engine: CONTINUE mission',
                'Continuous nominal monitoring active']
  },
  'overheating': {
    name: 'Overheating',
    label: '🔥 Overheating',
    baseFault: 'cooling_airflow_blockage',
    component: 'Cylinder Heads & Cooling Baffles',
    camKey: 'cht',
    desc: 'Rapid CHT & oil temperature accumulation threatening thermal overload.',
    sevThresholds: { criticalHealth: 58, abortHealth: 72, monitorHealth: 85,
                     criticalSev: 60, abortSev: 38, monitorSev: 18,
                     criticalEgt: 810, abortEgt: 775 },
    oodaHints: ['CHT deviation detected — thermal rise above baseline',
                'AI isolating cooling-path degradation signature',
                'Assessing cylinder head thermal stress index',
                'Predicting time-to-overheat at current rate',
                'Thermal risk decision: evaluating abort threshold',
                'Monitoring CHT delta at accelerated 2-cycle rate']
  },
  'oil_starvation': {
    name: 'Low Oil Pressure / Oil Starvation',
    label: '⚠️ Low Oil Pressure / Oil Starvation',
    baseFault: 'oil_starvation',
    component: 'Oil Sump, Pump & Lubrication Loop',
    camKey: 'oil',
    desc: 'Severe drop in lubrication pressure creating friction heating and seizure risk.',
    sevThresholds: { criticalHealth: 60, abortHealth: 74, monitorHealth: 86,
                     criticalSev: 55, abortSev: 35, monitorSev: 15,
                     criticalOilPDev: -25, abortOilPDev: -15 },
    oodaHints: ['Oil pressure residual: significant negative deviation detected',
                'Lubrication loop integrity analysis via AI pipeline',
                'Assessing seizure risk from friction coefficient rise',
                'Predicting bearing damage onset at current oil loss rate',
                'Critical lubrication hazard — decision escalated',
                'Oil pressure trending — emergency monitoring loop']
  },
  'oil_pump_degradation': {
    name: 'Oil Pump Degradation',
    label: '⚙️ Oil Pump Degradation',
    baseFault: 'oil_starvation',
    component: 'Positive Displacement Oil Pump',
    camKey: 'oil',
    desc: 'Progressive mechanical delivery decay in the oil circulation pump.',
    sevThresholds: { criticalHealth: 58, abortHealth: 70, monitorHealth: 83,
                     criticalSev: 60, abortSev: 38, monitorSev: 18,
                     criticalOilPDev: -20, abortOilPDev: -12 },
    oodaHints: ['Gradual oil pressure loss pattern detected in residuals',
                'Pump discharge capacity degradation model fitting',
                'Severity scoring: progressive mechanical wear index',
                'Projecting pump failure onset from degradation slope',
                'Return-to-base threshold: evaluating maintenance urgency',
                'Pump efficiency monitoring — next inspection interval']
  },
  'fuel_system_fault': {
    name: 'Fuel-System Fault',
    label: '⛽ Fuel-System Fault',
    baseFault: 'fuel_pump_degradation',
    component: 'Mechanical Fuel Pump & Supply Lines',
    camKey: 'fuel',
    desc: 'Loss of fuel delivery pressure leading to lean mixture and combustion surge.',
    sevThresholds: { criticalHealth: 55, abortHealth: 70, monitorHealth: 84,
                     criticalSev: 58, abortSev: 36, monitorSev: 16,
                     criticalFuelDev: -18, abortFuelDev: -10 },
    oodaHints: ['Fuel flow rate drop below twin baseline detected',
                'Lean-mixture EGT spike pattern being analyzed by AI',
                'Severity: fuel-starvation combustion instability risk',
                'Predicting engine flame-out probability at current rate',
                'Fuel emergency: decision threshold exceeded — RTB',
                'Fuel flow monitoring — cross-checking with RPM drift']
  },
  'injector_fault': {
    name: 'Injector Fault',
    label: '💉 Injector Fault',
    baseFault: 'fuel_injector_clog',
    component: 'Electronic Fuel Injectors & Rail',
    camKey: 'fuel',
    desc: 'Nozzle spray restriction causing cylinder thermal asymmetry.',
    sevThresholds: { criticalHealth: 57, abortHealth: 71, monitorHealth: 84,
                     criticalSev: 60, abortSev: 38, monitorSev: 17,
                     criticalEgt: 800, abortEgt: 760 },
    oodaHints: ['Inter-cylinder EGT asymmetry anomaly detected',
                'AI isolating injector-clog signature from residuals',
                'Severity: cylinder thermal imbalance stress index',
                'Predicting piston/valve damage risk from hot-spot',
                'Cylinder asymmetry: deciding injector isolation feasibility',
                'EGT spread monitoring — watching for runaway cylinder']
  },
  'misfire_ignition': {
    name: 'Misfire / Ignition Fault',
    label: '⚡ Misfire / Ignition Fault',
    baseFault: 'spark_plug_fouling',
    component: 'Dual Spark Plugs & Ignition Harness',
    camKey: 'cht',
    desc: 'Fouled electrodes causing cylinder misfire, unburnt fuel exhaust surge & vibration.',
    sevThresholds: { criticalHealth: 56, abortHealth: 71, monitorHealth: 84,
                     criticalSev: 58, abortSev: 36, monitorSev: 16,
                     criticalVib: 0.32, abortVib: 0.24 },
    oodaHints: ['RPM dropout and vibration spike pattern detected',
                'AI correlating misfire signature with CHT/EGT drop',
                'Severity: combustion-event skip rate and unburnt fuel',
                'Predicting catalyst damage and EGT surge trajectory',
                'Misfire risk: deciding between monitor and abort',
                'Ignition health monitoring — dual-magneto cross-check']
  },
  'combustion_instability': {
    name: 'Combustion Instability',
    label: '🔥 Combustion Instability',
    baseFault: 'exhaust_valve_leak',
    component: 'Exhaust Valves & Exhaust Manifold',
    camKey: 'egt',
    desc: 'Valve seating loss producing cyclic pressure blowby and high exhaust thermal transients.',
    sevThresholds: { criticalHealth: 58, abortHealth: 72, monitorHealth: 85,
                     criticalSev: 60, abortSev: 38, monitorSev: 18,
                     criticalEgt: 815, abortEgt: 780 },
    oodaHints: ['EGT cyclic instability and pressure blowby signature detected',
                'AI analyzing exhaust valve seating loss from residuals',
                'Severity: combustion efficiency loss index computed',
                'Predicting valve failure and power-loss event onset',
                'Combustion risk: escalating decision to ABORT/RETURN',
                'EGT variance monitoring — valve thermal stress loop']
  },
  'progressive_engine_wear': {
    name: 'Progressive Engine Wear',
    label: '⏳ Progressive Engine Wear',
    baseFault: 'bearing_wear',
    component: 'Crankshaft Bearings & Liners',
    camKey: 'vib',
    desc: 'Gradual mechanical wear reducing efficiency and increasing internal friction.',
    sevThresholds: { criticalHealth: 52, abortHealth: 67, monitorHealth: 80,
                     criticalSev: 65, abortSev: 42, monitorSev: 20,
                     criticalVib: 0.30, abortVib: 0.22 },
    oodaHints: ['Progressive vibration trend and RUL decay detected',
                'AI fitting bearing wear model to longitudinal residuals',
                'Severity: cumulative damage index from friction rise',
                'RUL projection: estimating remaining useful life slope',
                'Wear-rate decision: planned maintenance vs continue',
                'Long-term wear monitoring — trend slope watching']
  },
  'high_vibration': {
    name: 'High Vibration / Mechanical Imbalance',
    label: '📈 High Vibration / Mechanical Imbalance',
    baseFault: 'bearing_wear',
    component: 'Crankcase & Propeller Reduction Hub',
    camKey: 'vib',
    desc: 'Elevated RMS vibration and harmonic oscillation exceeding safe airframe limits.',
    sevThresholds: { criticalHealth: 55, abortHealth: 68, monitorHealth: 82,
                     criticalSev: 58, abortSev: 36, monitorSev: 16,
                     criticalVib: 0.33, abortVib: 0.25 },
    oodaHints: ['RMS vibration spike above airframe-safe threshold detected',
                'AI isolating harmonic imbalance signature from baseline',
                'Severity: structural resonance risk index assessed',
                'Predicting fatigue failure onset in propeller hub',
                'Vibration emergency: abort threshold evaluation active',
                'Vibration RMS monitoring — gearbox resonance scan']
  },
  'sensor_drift': {
    name: 'Sensor Drift / Failure',
    label: '📡 Sensor Drift / Failure',
    baseFault: 'cooling_airflow_blockage',
    component: 'Transducer Sensor Harness',
    camKey: 'vib',
    desc: 'Telemetry transducer drift creating persistent residuals against physics baseline.',
    sevThresholds: { criticalHealth: 60, abortHealth: 73, monitorHealth: 87,
                     criticalSev: 62, abortSev: 40, monitorSev: 18 },
    oodaHints: ['Persistent multi-sensor bias detected vs physics twin',
                'AI discriminating sensor drift from real engine fault',
                'Severity: data-quality degradation index computed',
                'Predicting decision-confidence loss from sensor failure',
                'Sensor anomaly: deciding with reduced telemetry fidelity',
                'Sensor health monitoring — redundant channel cross-check']
  },
  'intake_restriction': {
    name: 'Air-Intake Restriction',
    label: '🌪️ Air-Intake Restriction',
    baseFault: 'cooling_airflow_blockage',
    component: 'Air Intake Manifold & Air Filter',
    camKey: 'cht',
    desc: 'Restricted manifold induction airflow reducing volumetric efficiency.',
    sevThresholds: { criticalHealth: 57, abortHealth: 71, monitorHealth: 84,
                     criticalSev: 60, abortSev: 38, monitorSev: 17,
                     criticalRpmDev: -12, abortRpmDev: -7 },
    oodaHints: ['RPM and manifold pressure drop below induction baseline',
                'AI analyzing air/fuel ratio shift from intake blockage',
                'Severity: volumetric efficiency loss index computed',
                'Predicting power loss trajectory and altitude impact',
                'Induction fault: evaluating mission altitude feasibility',
                'MAP and RPM monitoring — induction system health loop']
  }
};

function getFaultComponentDetails(faultKeyOrName) {
  const scenario = SIM_SCENARIOS[faultKeyOrName];
  if (scenario) {
    return { component: scenario.component, key: scenario.camKey };
  }
  const map = {
    'spark_plug_fouling': { component: 'Cylinder Spark Plugs (Cyl 1-4)', key: 'cht' },
    'exhaust_valve_leak': { component: 'Exhaust Valves & Exhaust Manifold', key: 'egt' },
    'cooling_airflow_blockage': { component: 'Cylinder Heads & Air Baffles', key: 'cht' },
    'fuel_injector_clog': { component: 'Fuel Injectors & Fuel Rail', key: 'fuel' },
    'oil_starvation': { component: 'Oil Sump, Pump & Lubrication Loop', key: 'oil' },
    'bearing_wear': { component: 'Crankshaft Bearings & Crankcase', key: 'vib' },
    'fuel_pump_degradation': { component: 'Mechanical Fuel Pump & Supply Lines', key: 'fuel' },
    'healthy': { component: 'All Subsystems Operating Nominally', key: 'rpm' }
  };
  return map[faultKeyOrName] || { component: 'Engine Subsystem', key: 'rpm' };
}

async function loadSyntheticDataset() {
  const statusEl = document.getElementById('simDatasetStatus');
  try {
    const res = await fetch(`${API_BASE}/data/synthetic_train.csv`);
    if (!res.ok) throw new Error("Could not fetch synthetic_train.csv");
    const text = await res.text();
    const lines = text.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim());

    let parsed = [];
    for (let i = 1; i < lines.length; i++) {
      const vals = lines[i].split(',');
      if (vals.length !== headers.length) continue;
      let row = {};
      headers.forEach((h, idx) => {
        let v = vals[idx].trim();
        row[h] = isNaN(v) ? v : parseFloat(v);
      });
      parsed.push(row);
    }
    ALL_SYNTHETIC_DATA = parsed;

    // Group rows by unit_number
    SYNTHETIC_UNITS = {};
    parsed.forEach(row => {
      const uid = parseInt(row.unit_number, 10);
      if (!SYNTHETIC_UNITS[uid]) SYNTHETIC_UNITS[uid] = [];
      SYNTHETIC_UNITS[uid].push(row);
    });

    // Build scenario index: for each unique fault_name, collect unit_numbers
    SYNTHETIC_SCENARIOS = {};
    Object.keys(SYNTHETIC_UNITS).forEach(uid => {
      const uidNum = parseInt(uid, 10);
      const rows = SYNTHETIC_UNITS[uidNum];
      const faultRows = rows.filter(r => r.fault_name && r.fault_name !== 'healthy');
      let label = 'healthy';
      if (faultRows.length > 0) {
        const counts = {};
        faultRows.forEach(r => { counts[r.fault_name] = (counts[r.fault_name] || 0) + 1; });
        label = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
      }
      if (!SYNTHETIC_SCENARIOS[label]) SYNTHETIC_SCENARIOS[label] = [];
      SYNTHETIC_SCENARIOS[label].push(uidNum);
    });

    if (statusEl) {
      statusEl.textContent = `12 Conditions Available • ${Object.keys(SYNTHETIC_UNITS).length} runs`;
      statusEl.style.color = '#10B981';
    }

    populateScenarioDropdown();
  } catch (err) {
    console.error("Failed to load synthetic dataset", err);
    if (statusEl) {
      statusEl.textContent = 'Dataset Offline';
      statusEl.style.color = '#EF4444';
    }
  }
}

function populateScenarioDropdown() {
  const sel = document.getElementById('simScenarioSelect');
  if (!sel) return;
  sel.innerHTML = '';

  Object.entries(SIM_SCENARIOS).forEach(([key, cfg]) => {
    const baseFault = cfg.baseFault;
    const uids = SYNTHETIC_SCENARIOS[baseFault] || [];
    const count = uids.length;
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = `${cfg.label} (${count} ${count === 1 ? 'run' : 'runs'})`;
    sel.appendChild(opt);
  });

  sel.value = 'healthy';
  updateTrajectoryDropdown('healthy');
  updateScenarioInfo('healthy');

  sel.addEventListener('change', () => {
    updateTrajectoryDropdown(sel.value);
    updateScenarioInfo(sel.value);
  });
}

function updateTrajectoryDropdown(scenarioKey) {
  const trajSel = document.getElementById('simTrajectorySelect');
  if (!trajSel) return;
  trajSel.innerHTML = '<option value="random">🎲 Random Valid Trajectory (Auto)</option>';

  const cfg = SIM_SCENARIOS[scenarioKey] || SIM_SCENARIOS['healthy'];
  const uids = SYNTHETIC_SCENARIOS[cfg.baseFault] || [];
  uids.forEach(uid => {
    const rows = SYNTHETIC_UNITS[uid] || [];
    const opt = document.createElement('option');
    opt.value = uid;
    opt.textContent = `Unit #${uid} (${rows.length} cycles)`;
    trajSel.appendChild(opt);
  });
}

function updateScenarioInfo(scenarioKey) {
  const info = document.getElementById('scenarioInfo');
  if (!info) return;
  const cfg = SIM_SCENARIOS[scenarioKey] || SIM_SCENARIOS['healthy'];
  const uids = SYNTHETIC_SCENARIOS[cfg.baseFault] || [];
  const sampleLen = uids.length ? SYNTHETIC_UNITS[uids[0]].length : 0;

  info.innerHTML = `
    <strong>${cfg.name}</strong>: ${cfg.desc}<br>
    Target Subsystem: <span style="color:#00D2FF;font-weight:600;">${cfg.component}</span> &bull;
    <strong>${uids.length}</strong> matching synthetic trajectories (${sampleLen} cycles average)
  `;
}

function updateOodaPipelineUI(stepIndex, severityLevel = 'normal', scenarioKey = 'healthy', overrideHints = null) {
  const stepIds   = ['oodaDetect', 'oodaAnalyze', 'oodaSeverity', 'oodaRisk', 'oodaDecide', 'oodaMonitor'];
  const stepTexts = ['Detect', 'Analyze', 'Severity', 'Predict Risk', 'Decide', 'Monitor Loop'];
  const scenarioCfg = SIM_SCENARIOS[scenarioKey] || SIM_SCENARIOS['healthy'];
  const hints = overrideHints || scenarioCfg.oodaHints || stepTexts.map(t => t);

  stepIds.forEach((id, idx) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('active', 'active-warn', 'active-danger', 'completed');

    if (idx < stepIndex) {
      // Steps before current = completed (dim highlight)
      el.classList.add('completed');
    } else if (idx === stepIndex) {
      // Current active step
      if (severityLevel === 'critical') el.classList.add('active-danger');
      else if (severityLevel === 'warn') el.classList.add('active-warn');
      else el.classList.add('active');
    }

    // Update tooltip / title with scenario-specific hint for this step
    const hint = hints[idx] || stepTexts[idx];
    el.title = hint;

    // Update the text label if a <span class="ooda-txt"> exists
    const txtSpan = el.querySelector('.ooda-txt');
    if (txtSpan) {
      // Keep the original short label; append active step hint as subtitle when active
      txtSpan.textContent = stepTexts[idx];
      // Add a dynamic sub-hint below the step label when this step is active
      const existingHintEl = el.querySelector('.ooda-hint');
      if (existingHintEl) existingHintEl.remove();
      if (idx === stepIndex && hint !== stepTexts[idx]) {
        const hintEl = document.createElement('span');
        hintEl.className = 'ooda-hint';
        hintEl.textContent = hint;
        el.appendChild(hintEl);
      }
    }
  });
}

function addTimelineNode(phase, cycle, color = '#4fc3e8', faultInfo = null, telemetrySummary = null) {
  const container = document.getElementById('missionTimeline');
  if (!container) return;

  const node = document.createElement('div');
  node.className = 'timeline-node';
  node.style.borderLeftColor = color;

  let faultHtml = '';
  if (faultInfo) {
    faultHtml = `
      <div class="timeline-fault-alert">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <span><strong>${faultInfo.name.replace(/_/g, ' ').toUpperCase()}</strong> &bull; Component: <span class="comp-tag">${faultInfo.component}</span> &bull; Confidence: <strong>${(faultInfo.confidence * 100).toFixed(0)}%</strong></span>
      </div>
    `;
  }

  let teleHtml = '';
  if (telemetrySummary) {
    teleHtml = `
      <div class="timeline-metrics-summary">
        <span>RPM: ${telemetrySummary.rpm}</span>
        <span>CHT: ${telemetrySummary.cht}°C</span>
        <span>EGT: ${telemetrySummary.egt}°C</span>
        <span>Oil: ${telemetrySummary.oil} bar</span>
        <span>Alt: ${telemetrySummary.alt}m</span>
      </div>
    `;
  }

  node.innerHTML = `
    <div class="timeline-node-header">
      <span class="timeline-phase-tag" style="background:${color}22; color:${color}; border:1px solid ${color}44;">
        <i class="fa-solid fa-location-dot"></i> ${phase}
      </span>
      <span class="timeline-cycle-tag">Cycle #${cycle}</span>
    </div>
    ${faultHtml}
    ${teleHtml}
  `;

  container.appendChild(node);
  container.scrollTop = container.scrollHeight;
}

function initSimulatorLab() {
  loadSyntheticDataset();

  // Run Lab Simulation Button
  document.getElementById('btnRunLabSim')?.addEventListener('click', runLabSimulation);
  document.getElementById('btnStopLabSim')?.addEventListener('click', stopLabSimulation);

  // Transfer Lab Run to Main 3D Twin
  document.getElementById('btnTransferToTwin')?.addEventListener('click', () => {
    if (TELEMETRY_DATA.length) {
      renderTelemetryData(TELEMETRY_DATA);
      navigateToPage('twin-engine');
    } else {
      alert('Run a simulation first.');
    }
  });

  document.getElementById('btnTransferFinalToTwin')?.addEventListener('click', () => {
    if (TELEMETRY_DATA.length) {
      renderTelemetryData(TELEMETRY_DATA);
      navigateToPage('twin-engine');
    }
  });
}

function stopLabSimulation() {
  if (liveMissionActive) {
    clearInterval(liveMissionTimer);
    liveMissionTimer = null;
    liveMissionActive = false;
    isPlaying = false;

    const btn = document.getElementById('btnRunLabSim');
    const stopBtn = document.getElementById('btnStopLabSim');
    const runBtn = document.getElementById('runBtn');
    if (btn) btn.disabled = false;
    if (stopBtn) stopBtn.style.display = 'none';
    if (runBtn) runBtn.disabled = false;

    const phaseSpan = document.getElementById('currentMissionPhase');
    if (phaseSpan) phaseSpan.textContent = 'PAUSED';
    const phaseBadge = document.getElementById('simPhaseBadge');
    if (phaseBadge) {
      phaseBadge.textContent = 'PAUSED';
      phaseBadge.style.color = '#F59E0B';
      phaseBadge.style.borderColor = '#F59E0B';
    }
  }
}

async function runLabSimulation() {
  const sel = document.getElementById('simScenarioSelect');
  const trajSel = document.getElementById('simTrajectorySelect');
  const scenarioKey = sel ? sel.value : 'healthy';
  const selectedUid = trajSel ? trajSel.value : 'random';
  startLiveMission(scenarioKey, selectedUid);
}

async function simulateNewMission() {
  const faultName = document.getElementById('faultSelect')?.value || null;
  startLiveMission(faultName || 'healthy', 'random');
}

function startLiveMission(scenarioKey, specificUid = 'random') {
  if (!ALL_SYNTHETIC_DATA.length) {
    alert("Dataset is still loading. Please try again in a moment.");
    return;
  }

  const cfg = SIM_SCENARIOS[scenarioKey] || SIM_SCENARIOS['healthy'];
  const baseFault = cfg.baseFault;
  const uids = SYNTHETIC_SCENARIOS[baseFault] || SYNTHETIC_SCENARIOS['healthy'] || [1];

  let selectedUid;
  if (specificUid && specificUid !== 'random') {
    selectedUid = parseInt(specificUid, 10);
  } else {
    selectedUid = uids[Math.floor(Math.random() * uids.length)];
  }

  ACTIVE_UNIT_DATA = SYNTHETIC_UNITS[selectedUid] || SYNTHETIC_UNITS[uids[0]];

  const btn = document.getElementById('runBtn');
  const btnLab = document.getElementById('btnRunLabSim');
  const stopBtn = document.getElementById('btnStopLabSim');
  const status = document.getElementById('runStatus');
  const summary = document.getElementById('simResultSummary');
  const playBtn = document.getElementById('playBtn');
  const finalSummaryDiv = document.getElementById('missionFinalSummary');
  const timelineDiv = document.getElementById('missionTimeline');
  const phaseSpan = document.getElementById('currentMissionPhase');
  const phaseBadge = document.getElementById('simPhaseBadge');
  const decBadge = document.getElementById('simDecisionBadge');

  if (liveMissionActive) {
    clearInterval(liveMissionTimer);
  }

  TELEMETRY_DATA = [];
  liveCycleCount = 0;
  liveTargetFault = scenarioKey;
  liveMissionActive = true;
  isPlaying = true;
  lastPhaseLabel = '';
  hasLoggedFaultTimeline = false;
  currentOodaStage = 0;

  // Clear charts
  if (CHARTS.simTemp) {
    CHARTS.simTemp.data.labels = [];
    CHARTS.simTemp.data.datasets.forEach(ds => ds.data = []);
    CHARTS.simTemp.update();
  }
  if (CHARTS.simMech) {
    CHARTS.simMech.data.labels = [];
    CHARTS.simMech.data.datasets.forEach(ds => ds.data = []);
    CHARTS.simMech.update();
  }

  if (finalSummaryDiv) finalSummaryDiv.style.display = 'none';
  if (timelineDiv) timelineDiv.innerHTML = '';
  if (phaseSpan) phaseSpan.textContent = 'TAKEOFF';
  if (phaseBadge) {
    phaseBadge.textContent = 'TAKEOFF';
    phaseBadge.style.color = '#00D2FF';
    phaseBadge.style.borderColor = 'rgba(0, 210, 255, 0.4)';
  }
  if (decBadge) {
    decBadge.textContent = 'CONTINUE';
    decBadge.className = 'sim-decision-badge badge-continue';
  }

  if (btn) btn.disabled = true;
  if (btnLab) btnLab.disabled = true;
  if (stopBtn) stopBtn.style.display = 'inline-flex';

  const missionTitle = `${cfg.name} &bull; Unit #${selectedUid} (${ACTIVE_UNIT_DATA.length} cycles)`;
  if (status) status.innerHTML = `Replaying: ${missionTitle}`;
  if (summary) summary.innerHTML = `Live Mission Streaming &bull; ${missionTitle}`;
  if (playBtn) playBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';

  setConnectionStatus(true);

  const speedVal = parseInt(document.getElementById('simSpeedSelect')?.value || document.getElementById('speedSelect')?.value || '4', 10);
  const intervalMs = Math.max(50, 1000 / speedVal);

  liveMissionTimer = setInterval(liveMissionTick, intervalMs);
}

function getMissionPhase(cycleIdx, totalCycles, altitudeM, throttlePct) {
  const pct = cycleIdx / totalCycles;
  if (pct <= 0.03 || cycleIdx <= 2) return 'TAKEOFF';
  if (pct <= 0.12) return 'CLIMB';
  if (pct > 0.90) return 'DESCENT';
  if (altitudeM !== undefined && Math.abs(altitudeM - 4500) > 200) return 'HIGH-LOAD / ALTITUDE VARIATION';
  if (throttlePct !== undefined && throttlePct > 80) return 'HIGH-LOAD / ALTITUDE VARIATION';
  return 'CRUISE';
}

async function liveMissionTick() {
  if (liveCycleCount >= ACTIVE_UNIT_DATA.length) {
    clearInterval(liveMissionTimer);
    liveMissionActive = false;
    isPlaying = false;

    // Final phase marker
    const phaseSpan = document.getElementById('currentMissionPhase');
    if (phaseSpan) phaseSpan.textContent = 'MISSION COMPLETE';
    const phaseBadge = document.getElementById('simPhaseBadge');
    if (phaseBadge) {
      phaseBadge.textContent = 'MISSION COMPLETE';
      phaseBadge.style.color = '#10B981';
      phaseBadge.style.borderColor = '#10B981';
    }

    addTimelineNode('MISSION COMPLETE', liveCycleCount, '#10B981', null, {
      rpm: Math.round(TELEMETRY_DATA[TELEMETRY_DATA.length - 1]?.rpm || 2000),
      cht: Math.round(TELEMETRY_DATA[TELEMETRY_DATA.length - 1]?.cht_1_c || 95),
      egt: Math.round(TELEMETRY_DATA[TELEMETRY_DATA.length - 1]?.egt_1_c || 600),
      oil: (TELEMETRY_DATA[TELEMETRY_DATA.length - 1]?.oil_pressure_kpa / 27.5).toFixed(1),
      alt: Math.round(TELEMETRY_DATA[TELEMETRY_DATA.length - 1]?.mission_altitude_m || 0)
    });

    const status = document.getElementById('runStatus');
    if (status) status.textContent = "Mission Completed";
    const summary = document.getElementById('simResultSummary');
    if (summary) summary.innerHTML = `<span style="color:#10B981;font-weight:bold;">Mission Complete (${ACTIVE_UNIT_DATA.length} cycles)</span>`;

    // Build Final Summary from the last telemetry point
    const finalSummaryDiv = document.getElementById('missionFinalSummary');
    if (finalSummaryDiv && TELEMETRY_DATA.length > 0) {
      finalSummaryDiv.style.display = 'block';
      const last = TELEMETRY_DATA[TELEMETRY_DATA.length - 1];
      const health = last.mission_reliability_pct ?? 100;
      const faultName = last.predicted_fault_name || 'healthy';
      const rul = last.predicted_RUL ?? 125;
      const conf = last.fault_confidence ?? 0;
      const compInfo = getFaultComponentDetails(faultName);

      const decisionObj = evaluateMissionDecision(
        health, (rul * 0.3), last.predicted_fault_class,
        (last.egt_1_c || 600), (last.vibration_rms_g || 0.08), last.severity_pct || 0
      );

      document.getElementById('summaryHealthVal').textContent = health.toFixed(1) + '%';
      document.getElementById('summaryFaultVal').textContent =
        faultName !== 'healthy'
          ? faultName.replace(/_/g, ' ').toUpperCase() + ` (${(conf * 100).toFixed(0)}% conf)`
          : 'NOMINAL (NONE)';
      document.getElementById('summaryCompVal').textContent = `Affected Component: ${compInfo.component}`;
      document.getElementById('summaryRulVal').textContent = `${rul.toFixed(1)} cycles`;
      document.getElementById('summaryRulHrsVal').textContent = `${(rul * 0.3).toFixed(1)} hrs estimated flight`;
      document.getElementById('summaryReliabilityVal').textContent = health.toFixed(1) + '%';

      const successProb = Math.min(100, health * 0.6 + (rul / 125) * 40);
      document.getElementById('summarySuccessVal').textContent = successProb.toFixed(1) + '%';

      const recEl = document.getElementById('summaryRecVal');
      recEl.textContent = decisionObj.recommendation;
      recEl.style.color = decisionObj.recommendation === 'CONTINUE' ? '#10B981' :
                          decisionObj.recommendation === 'CONTINUE + MONITOR' ? '#F59E0B' :
                          decisionObj.recommendation === 'ABORT/RETURN' ? '#FB923C' : '#EF4444';
      document.getElementById('summaryRecDesc').textContent = decisionObj.description;
    }

    const btn = document.getElementById('runBtn');
    const btnLab = document.getElementById('btnRunLabSim');
    const stopBtn = document.getElementById('btnStopLabSim');
    const playBtn = document.getElementById('playBtn');
    if (btn) btn.disabled = false;
    if (btnLab) btnLab.disabled = false;
    if (stopBtn) stopBtn.style.display = 'none';
    if (playBtn) playBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
    return;
  }

  const baseRow = ACTIVE_UNIT_DATA[liveCycleCount];
  const totalCycles = ACTIVE_UNIT_DATA.length;
  liveCycleCount++;

  // Step the OODA Closed-Loop Intelligence Ribbon sequentially through all 6 stages
  // Stage 0: Detect | 1: Analyze | 2: Severity | 3: Risk | 4: Decide | 5: Monitor Loop
  currentOodaStage = (currentOodaStage + 1) % 6;

  // Determine mission phase from actual synthetic telemetry
  const phase = getMissionPhase(
    liveCycleCount, totalCycles,
    baseRow.mission_altitude_m, baseRow.throttle_pct
  );

  const phaseSpan = document.getElementById('currentMissionPhase');
  const phaseBadge = document.getElementById('simPhaseBadge');
  const cycleCounter = document.getElementById('simCycleCounter');

  if (cycleCounter) {
    cycleCounter.textContent = `Cycle ${liveCycleCount} / ${totalCycles}`;
  }

  if (phase !== lastPhaseLabel) {
    if (phaseSpan) phaseSpan.textContent = phase;
    if (phaseBadge) {
      phaseBadge.textContent = phase;
      const phaseColors = {
        'TAKEOFF': '#00D2FF',
        'CLIMB': '#38BDF8',
        'CRUISE': '#10B981',
        'HIGH-LOAD / ALTITUDE VARIATION': '#F59E0B',
        'DESCENT': '#A855F7',
        'MISSION COMPLETE': '#10B981'
      };
      const col = phaseColors[phase] || '#00D2FF';
      phaseBadge.style.color = col;
      phaseBadge.style.borderColor = col;
      addTimelineNode(phase, liveCycleCount, col, null, {
        rpm: Math.round(baseRow.rpm),
        cht: Math.round((baseRow.cht_1_c + baseRow.cht_2_c + baseRow.cht_3_c + baseRow.cht_4_c) / 4),
        egt: Math.round((baseRow.egt_1_c + baseRow.egt_2_c + baseRow.egt_3_c + baseRow.egt_4_c) / 4),
        oil: (baseRow.oil_pressure_kpa / 27.5).toFixed(1),
        alt: Math.round(baseRow.mission_altitude_m)
      });
    }
    lastPhaseLabel = phase;
  }

  // Controlled stochastic micro-variation
  const jitter = (val, maxPct = 0.008) => {
    if (val === 0 || val === undefined) return val;
    return val * (1 + (Math.random() - 0.5) * maxPct * 2);
  };

  let reading = {
    throttle_pct:         jitter(baseRow.throttle_pct, 0.012),
    mission_altitude_m:   jitter(baseRow.mission_altitude_m, 0.015),
    mission_airspeed_kmh: jitter(baseRow.mission_airspeed_kmh, 0.015),
    rpm:                  jitter(baseRow.rpm, 0.006),
    oil_pressure_kpa:     jitter(baseRow.oil_pressure_kpa, 0.01),
    oil_temp_c:           jitter(baseRow.oil_temp_c, 0.008),
    fuel_flow_lph:        jitter(baseRow.fuel_flow_lph, 0.01),
    vibration_rms_g:      baseRow.vibration_rms_g + (Math.random() - 0.5) * 0.008,
    cht_1_c:              jitter(baseRow.cht_1_c, 0.01),
    cht_2_c:              jitter(baseRow.cht_2_c, 0.01),
    cht_3_c:              jitter(baseRow.cht_3_c, 0.01),
    cht_4_c:              jitter(baseRow.cht_4_c, 0.01),
    egt_1_c:              jitter(baseRow.egt_1_c, 0.01),
    egt_2_c:              jitter(baseRow.egt_2_c, 0.01),
    egt_3_c:              jitter(baseRow.egt_3_c, 0.01),
    egt_4_c:              jitter(baseRow.egt_4_c, 0.01)
  };

  // Stage 1: Detect (Residual computation)
  const avgCht = (reading.cht_1_c + reading.cht_2_c + reading.cht_3_c + reading.cht_4_c) / 4;
  const avgChtTwin = (baseRow.cht_1_twin + baseRow.cht_2_twin + baseRow.cht_3_twin + baseRow.cht_4_twin) / 4;
  const avgEgt = (reading.egt_1_c + reading.egt_2_c + reading.egt_3_c + reading.egt_4_c) / 4;
  const avgEgtTwin = (baseRow.egt_1_twin + baseRow.egt_2_twin + baseRow.egt_3_twin + baseRow.egt_4_twin) / 4;

  const rpmDev = ((reading.rpm - baseRow.rpm_twin) / baseRow.rpm_twin * 100);
  const chtDev = ((avgCht - avgChtTwin) / avgChtTwin * 100);
  const egtDev = ((avgEgt - avgEgtTwin) / avgEgtTwin * 100);
  const oilPDev = ((reading.oil_pressure_kpa - baseRow.oil_pressure_twin) / baseRow.oil_pressure_twin * 100);
  const fuelDev = ((reading.fuel_flow_lph - baseRow.fuel_flow_twin) / baseRow.fuel_flow_twin * 100);
  const vibDev = (reading.vibration_rms_g - 0.08);

  // Stage 2: Analyze (Stream to AI Model)
  try {
    const res = await fetch(`${API_BASE}/api/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reading: reading, history: TELEMETRY_DATA.slice(-20) })
    });

    if (!res.ok) throw new Error(await res.text());
    const aiResult = await res.json();

    const faultName = aiResult.predicted_fault_name || 'healthy';
    const compInfo = getFaultComponentDetails(faultName);
    const confPct = Math.round((aiResult.fault_confidence || 0) * 100);
    const healthVal = aiResult.mission_reliability_pct ?? 100;
    const rulVal = aiResult.predicted_RUL ?? 125;
    const rulHrs = rulVal * 0.3;

    // Stage 3: Assess Severity
    const baseSev = baseRow.fault_severity ? baseRow.fault_severity * 100 : 0;
    const anomalySev = Math.max(
      Math.abs(chtDev) / 25 * 100,
      Math.abs(egtDev) / 20 * 100,
      Math.abs(oilPDev) / 30 * 100,
      Math.max(0, vibDev) / 0.25 * 100,
      baseSev
    );
    const severityPct = Math.min(100, Math.max(0, Math.round(faultName === 'healthy' && confPct > 70 ? 0 : anomalySev)));

    // Stage 4: Predict Future Risk
    const missionRiskPct = Math.min(100, Math.max(0, Math.round((100 - healthVal) * 0.7 + severityPct * 0.3)));
    const successVal = Math.max(0, Math.min(100, healthVal * 0.6 + (rulVal / 125) * 40));

    // Stage 5: Decide (Closed-loop Tactical Decision — SCENARIO-AWARE, never hardcoded)
    const decisionObj = evaluateMissionDecision(
      healthVal, rulHrs, aiResult.predicted_fault_class,
      avgEgt, reading.vibration_rms_g, severityPct,
      liveTargetFault,
      { oilPDev, fuelDev, rpmDev }
    );

    // Stage 6: Monitor Loop — advance OODA UI through all 6 sequential stages with severity colour
    const sevLevel = decisionObj.recommendation === 'CRITICAL → ABORT' ? 'critical' :
                     decisionObj.recommendation === 'ABORT/RETURN' || decisionObj.recommendation === 'CONTINUE + MONITOR' ? 'warn' : 'normal';
    updateOodaPipelineUI(currentOodaStage, sevLevel, liveTargetFault);

    const fullCycleData = {
      cycle: liveCycleCount,
      phase: phase,
      severity_pct: severityPct,
      mission_risk_pct: missionRiskPct,
      tactical_decision: decisionObj.recommendation,
      ...reading,
      ...aiResult,
      cht_1_twin: baseRow.cht_1_twin, cht_2_twin: baseRow.cht_2_twin,
      cht_3_twin: baseRow.cht_3_twin, cht_4_twin: baseRow.cht_4_twin,
      egt_1_twin: baseRow.egt_1_twin, egt_2_twin: baseRow.egt_2_twin,
      egt_3_twin: baseRow.egt_3_twin, egt_4_twin: baseRow.egt_4_twin,
      oil_pressure_twin: baseRow.oil_pressure_twin,
      oil_temp_twin: baseRow.oil_temp_twin,
      fuel_flow_twin: baseRow.fuel_flow_twin,
      vibration_twin: 0.08
    };

    TELEMETRY_DATA.push(fullCycleData);

    // Update Decision Badge in header of Live Telemetry
    const decBadge = document.getElementById('simDecisionBadge');
    if (decBadge) {
      decBadge.textContent = decisionObj.recommendation;
      decBadge.className = 'sim-decision-badge ' +
        (decisionObj.recommendation === 'CONTINUE' ? 'badge-continue' :
         decisionObj.recommendation === 'CONTINUE + MONITOR' ? 'badge-monitor' :
         decisionObj.recommendation === 'ABORT/RETURN' ? 'badge-abort' : 'badge-critical');
    }

    // Update Live Metric Cells
    const setValAndDev = (valId, devId, valText, devText, isWarn, isAlert) => {
      const vEl = document.getElementById(valId);
      const dEl = document.getElementById(devId);
      if (vEl) vEl.textContent = valText;
      if (dEl) {
        dEl.textContent = devText;
        dEl.className = 'smc-dev ' + (isAlert ? 'dev-alert' : isWarn ? 'dev-warn' : '');
      }
    };

    setValAndDev('simRpmVal', 'simRpmDev', Math.round(reading.rpm).toLocaleString(), `Δ ${rpmDev >= 0 ? '+' : ''}${rpmDev.toFixed(1)}%`, Math.abs(rpmDev) > 5, Math.abs(rpmDev) > 10);
    setValAndDev('simChtVal', 'simChtDev', `${Math.round(avgCht)}°C`, `Δ ${chtDev >= 0 ? '+' : ''}${chtDev.toFixed(1)}%`, Math.abs(chtDev) > 8, Math.abs(chtDev) > 15);
    setValAndDev('simEgtVal', 'simEgtDev', `${Math.round(avgEgt)}°C`, `Δ ${egtDev >= 0 ? '+' : ''}${egtDev.toFixed(1)}%`, Math.abs(egtDev) > 8, Math.abs(egtDev) > 15);
    setValAndDev('simOilPVal', 'simOilPDev', `${(reading.oil_pressure_kpa / 27.5).toFixed(1)} bar`, `Δ ${oilPDev >= 0 ? '+' : ''}${oilPDev.toFixed(1)}%`, Math.abs(oilPDev) > 10, Math.abs(oilPDev) > 20);
    setValAndDev('simFuelVal', 'simFuelDev', `${(reading.fuel_flow_lph * 0.75).toFixed(1)} kg/h`, `Δ ${fuelDev >= 0 ? '+' : ''}${fuelDev.toFixed(1)}%`, Math.abs(fuelDev) > 10, Math.abs(fuelDev) > 20);
    setValAndDev('simVibVal', 'simVibDev', `${reading.vibration_rms_g.toFixed(2)} g`, reading.vibration_rms_g > 0.3 ? `+${vibDev.toFixed(2)}g (HIGH)` : 'Nominal', reading.vibration_rms_g > 0.22, reading.vibration_rms_g > 0.35);

    // AI Diagnostics Strip
    const elHealth = document.getElementById('simAiHealthVal');
    const elSev = document.getElementById('simAiSevVal');
    const elFault = document.getElementById('simAiFaultVal');
    const elComp = document.getElementById('simAiCompVal');
    const elConf = document.getElementById('simAiConfVal');
    const elRul = document.getElementById('simAiRulVal');
    const elRisk = document.getElementById('simAiRiskVal');
    const elDec = document.getElementById('simAiDecVal');

    if (elHealth) elHealth.textContent = `${healthVal.toFixed(1)}%`;
    if (elSev) {
      elSev.textContent = `${severityPct}%`;
      elSev.className = severityPct > 60 ? 'val-red' : severityPct > 25 ? 'val-orange' : 'val-green';
    }
    if (elFault) elFault.textContent = faultName === 'healthy' ? 'NOMINAL' : faultName.replace(/_/g, ' ').toUpperCase();
    if (elComp) elComp.textContent = compInfo.component;
    if (elConf) elConf.textContent = `${confPct}%`;
    if (elRul) elRul.textContent = `${rulVal.toFixed(1)} cyc (${rulHrs.toFixed(1)}h)`;
    if (elRisk) {
      elRisk.textContent = `${missionRiskPct}%`;
      elRisk.className = missionRiskPct > 60 ? 'val-red' : missionRiskPct > 30 ? 'val-orange' : 'val-purple';
    }
    if (elDec) {
      elDec.textContent = decisionObj.recommendation;
      elDec.style.color = decisionObj.recommendation === 'CONTINUE' ? '#10B981' :
                          decisionObj.recommendation === 'CONTINUE + MONITOR' ? '#F59E0B' :
                          decisionObj.recommendation === 'ABORT/RETURN' ? '#FB923C' : '#EF4444';
    }

    // Connect detected fault to 3D engine: highlight affected component
    if (faultName !== 'healthy' && confPct >= 70 && !hasLoggedFaultTimeline) {
      hasLoggedFaultTimeline = true;
      addTimelineNode('FAULT DETECTED', liveCycleCount, '#EF4444', {
        name: faultName,
        component: compInfo.component,
        confidence: aiResult.fault_confidence
      });
      focusComponent(compInfo.key);
    }

    // Append to charts
    appendTelemetryData(fullCycleData);
    updateCycle(TELEMETRY_DATA.length - 1);

    // Immediate Abort / Termination check if critical condition detected
    if (decisionObj.recommendation === 'CRITICAL → ABORT') {
      clearInterval(liveMissionTimer);
      liveMissionTimer = null;
      liveMissionActive = false;
      isPlaying = false;

      const phaseSpan = document.getElementById('currentMissionPhase');
      if (phaseSpan) phaseSpan.textContent = 'EMERGENCY ABORT';
      const phaseBadge = document.getElementById('simPhaseBadge');
      if (phaseBadge) {
        phaseBadge.textContent = 'EMERGENCY ABORT';
        phaseBadge.style.color = '#EF4444';
        phaseBadge.style.borderColor = '#EF4444';
      }

      addTimelineNode('CRITICAL FAULT — MISSION ABORTED', liveCycleCount, '#EF4444', {
        name: faultName !== 'healthy' ? faultName : liveTargetFault,
        component: compInfo.component,
        confidence: aiResult.fault_confidence || 0.95
      }, {
        rpm: Math.round(reading.rpm),
        cht: Math.round(avgCht),
        egt: Math.round(avgEgt),
        oil: (reading.oil_pressure_kpa / 27.5).toFixed(1),
        alt: Math.round(reading.mission_altitude_m)
      });

      const status = document.getElementById('runStatus');
      if (status) status.textContent = `Mission Terminated Early (Critical Condition at Cycle ${liveCycleCount})`;
      const summary = document.getElementById('simResultSummary');
      if (summary) summary.innerHTML = `<span style="color:#EF4444;font-weight:bold;"><i class="fa-solid fa-triangle-exclamation"></i> Emergency Abort Executed at Cycle ${liveCycleCount} of ${totalCycles}</span>`;

      // Build Final Summary immediately at Abort point
      const finalSummaryDiv = document.getElementById('missionFinalSummary');
      if (finalSummaryDiv) {
        finalSummaryDiv.style.display = 'block';
        document.getElementById('summaryHealthVal').textContent = healthVal.toFixed(1) + '%';
        document.getElementById('summaryFaultVal').textContent =
          faultName !== 'healthy'
            ? faultName.replace(/_/g, ' ').toUpperCase() + ` (${confPct}% conf)`
            : 'CRITICAL ANOMALY DETECTED';
        document.getElementById('summaryCompVal').textContent = `Affected Component: ${compInfo.component}`;
        document.getElementById('summaryRulVal').textContent = `${rulVal.toFixed(1)} cycles`;
        document.getElementById('summaryRulHrsVal').textContent = `${rulHrs.toFixed(1)} hrs estimated flight`;
        document.getElementById('summaryReliabilityVal').textContent = healthVal.toFixed(1) + '%';
        document.getElementById('summarySuccessVal').textContent = successVal.toFixed(1) + '%';

        const recEl = document.getElementById('summaryRecVal');
        recEl.textContent = decisionObj.recommendation;
        recEl.style.color = '#EF4444';
        document.getElementById('summaryRecDesc').textContent = decisionObj.description;
      }

      const btn = document.getElementById('runBtn');
      const btnLab = document.getElementById('btnRunLabSim');
      const stopBtn = document.getElementById('btnStopLabSim');
      const playBtn = document.getElementById('playBtn');
      if (btn) btn.disabled = false;
      if (btnLab) btnLab.disabled = false;
      if (stopBtn) stopBtn.style.display = 'none';
      if (playBtn) playBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
    }

  } catch (err) {
    console.error("Live streaming error: ", err);
    setConnectionStatus(false);
  }
}

function appendTelemetryData(d) {
  const lbl = `C${d.cycle}`;
  
  if (CHARTS.healthDegradation) {
    CHARTS.healthDegradation.data.labels.push(lbl);
    CHARTS.healthDegradation.data.datasets[0].data.push(d.mission_reliability_pct);
    if (CHARTS.healthDegradation.data.labels.length > 50) {
      CHARTS.healthDegradation.data.labels.shift();
      CHARTS.healthDegradation.data.datasets[0].data.shift();
    }
    CHARTS.healthDegradation.update();
  }

  if (CHARTS.rulPrediction) {
    CHARTS.rulPrediction.data.labels.push(lbl);
    CHARTS.rulPrediction.data.datasets[0].data.push((d.predicted_RUL * 0.3).toFixed(1));
    CHARTS.rulPrediction.data.datasets[1].data.push(15);
    if (CHARTS.rulPrediction.data.labels.length > 50) {
      CHARTS.rulPrediction.data.labels.shift();
      CHARTS.rulPrediction.data.datasets[0].data.shift();
      CHARTS.rulPrediction.data.datasets[1].data.shift();
    }
    CHARTS.rulPrediction.update();
  }
  
  if (CHARTS.simTemp) {
    CHARTS.simTemp.data.labels.push(lbl);
    const avgCht = (d.cht_1_c + d.cht_2_c + d.cht_3_c + d.cht_4_c) / 4;
    const avgChtTwin = (d.cht_1_twin + d.cht_2_twin + d.cht_3_twin + d.cht_4_twin) / 4;
    const avgEgt = (d.egt_1_c + d.egt_2_c + d.egt_3_c + d.egt_4_c) / 4;
    CHARTS.simTemp.data.datasets[0].data.push(Math.round(avgCht));
    CHARTS.simTemp.data.datasets[1].data.push(Math.round(avgChtTwin));
    CHARTS.simTemp.data.datasets[2].data.push(Math.round(avgEgt));
    if (CHARTS.simTemp.data.labels.length > 60) {
      CHARTS.simTemp.data.labels.shift();
      CHARTS.simTemp.data.datasets.forEach(ds => ds.data.shift());
    }
    CHARTS.simTemp.update();
  }
  
  if (CHARTS.simMech) {
    CHARTS.simMech.data.labels.push(lbl);
    CHARTS.simMech.data.datasets[0].data.push(parseFloat((d.oil_pressure_kpa / 27.5).toFixed(1)));
    CHARTS.simMech.data.datasets[1].data.push(parseFloat(d.vibration_rms_g.toFixed(2)));
    if (CHARTS.simMech.data.labels.length > 60) {
      CHARTS.simMech.data.labels.shift();
      CHARTS.simMech.data.datasets.forEach(ds => ds.data.shift());
    }
    CHARTS.simMech.update();
  }
  
  const scrub = document.getElementById('scrub');
  if (scrub) {
    scrub.max = TELEMETRY_DATA.length - 1;
    scrub.value = TELEMETRY_DATA.length - 1;
  }
  const scrubEnd = document.getElementById('scrubEnd');
  if (scrubEnd) scrubEnd.textContent = `Live: Cycle ${liveCycleCount}`;
}

function togglePlayback() {
  const btn = document.getElementById('playBtn');
  if (liveMissionActive) {
    clearInterval(liveMissionTimer);
    liveMissionTimer = null;
    liveMissionActive = false;
    isPlaying = false;
    if (btn) btn.innerHTML = '<i class="fa-solid fa-play"></i>';
    const runBtn = document.getElementById('runBtn');
    const labBtn = document.getElementById('btnRunLabSim');
    const stopBtn = document.getElementById('btnStopLabSim');
    if (runBtn) runBtn.disabled = false;
    if (labBtn) labBtn.disabled = false;
    if (stopBtn) stopBtn.style.display = 'none';
  } else {
    if (TELEMETRY_DATA.length > 0 || liveCycleCount === 0) {
      if (liveCycleCount === 0) {
         startLiveMission(document.getElementById('faultSelect')?.value || 'healthy', 'random');
      } else {
         liveMissionActive = true;
         isPlaying = true;
         if (btn) btn.innerHTML = '<i class="fa-solid fa-pause"></i>';
         const speedMultiplier = parseInt(document.getElementById('simSpeedSelect')?.value || document.getElementById('speedSelect')?.value || '4', 10);
         const intervalMs = Math.max(50, 1000 / speedMultiplier);
         liveMissionTimer = setInterval(liveMissionTick, intervalMs);
         
         const runBtn = document.getElementById('runBtn');
         const labBtn = document.getElementById('btnRunLabSim');
         const stopBtn = document.getElementById('btnStopLabSim');
         if (runBtn) runBtn.disabled = true;
         if (labBtn) labBtn.disabled = true;
         if (stopBtn) stopBtn.style.display = 'inline-flex';
      }
    }
  }
}


function setConnectionStatus(ok) {
  const el = document.getElementById('connStatus');
  if (el) {
    el.innerHTML = ok ?
      '<span class="conn-dot conn-ok"></span> API Connected' :
      '<span class="conn-dot conn-bad"></span> API Offline';
  }
}

// ==========================================================================
// 8. ALERTS MANAGEMENT
// ==========================================================================
const ACTIVE_ALERTS = [
  { id: 0, time: '10:21:08 AM', title: 'Combustion Instability Detected', severity: 'High', status: 'Active', details: 'EGT deviation high (+32% over twin baseline)', cycle: 120 },
  { id: 1, time: '10:15:32 AM', title: 'Vibration Level High', severity: 'Medium', status: 'Active', details: 'Vibration above normal range (0.35g RMS)', cycle: 95 },
  { id: 2, time: '10:05:11 AM', title: 'Oil Pressure Fluctuation', severity: 'Low', status: 'Acknowledged', details: 'Minor fluctuations observed (4.9 bar nominal)', cycle: 40 }
];

function renderAlertsTable(filter = 'all') {
  const tbody = document.getElementById('alertsTableBody');
  if (!tbody) return;

  const filtered = ACTIVE_ALERTS.filter(a => {
    if (filter === 'active') return a.status === 'Active';
    if (filter === 'ack') return a.status === 'Acknowledged';
    return true;
  });

  tbody.innerHTML = filtered.map(a => `
    <tr class="clickable-alert-row" onclick="jumpToAlertCycle(${a.cycle})" title="Click to jump timeline to this event">
      <td>${a.time}</td>
      <td><strong>${a.title}</strong></td>
      <td><span class="sev-pill sev-${a.severity === 'High' ? 'high' : a.severity === 'Medium' ? 'med' : 'low'}"><i class="fa-solid fa-circle"></i> ${a.severity}</span></td>
      <td><span class="status-pill status-${a.status === 'Active' ? 'active' : 'ack'}">${a.status}</span></td>
      <td>${a.details}</td>
      <td>
        <button class="ack-btn" onclick="event.stopPropagation(); ackAlert(${a.id})" ${a.status === 'Acknowledged' ? 'disabled' : ''}>
          ${a.status === 'Acknowledged' ? 'Done' : 'Acknowledge'}
        </button>
      </td>
    </tr>
  `).join('');
}

window.ackAlert = function(id) {
  const alert = ACTIVE_ALERTS.find(a => a.id === id);
  if (alert) {
    alert.status = 'Acknowledged';
    renderAlertsTable();
  }
};

window.jumpToAlertCycle = function(cycle) {
  const scrub = document.getElementById('scrub');
  if (scrub && TELEMETRY_DATA.length) {
    const targetIdx = Math.min(TELEMETRY_DATA.length - 1, Math.max(0, cycle - 1));
    scrub.value = targetIdx;
    updateCycle(targetIdx);
    navigateToPage('twin-engine');
  }
};

// ==========================================================================
// 9. REPORTS GENERATION & SQLITE HISTORY
// ==========================================================================
async function loadMissionHistory() {
  const tbody = document.getElementById('historyTableBody');
  if (!tbody) return;

  try {
    const res = await fetch(`${API_BASE}/api/history?limit=25`);
    if (!res.ok) throw new Error(await res.text());
    const runs = await res.json();

    if (!runs.length) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:#64748B;">No missions recorded yet. Run a simulation to log runs.</td></tr>`;
      return;
    }

    tbody.innerHTML = runs.map(r => `
      <tr>
        <td><strong>#${r.id}</strong></td>
        <td>${r.created_at ? r.created_at.slice(0, 19).replace('T', ' ') : 'Just now'}</td>
        <td><span class="nav-badge-pill home-pill">${r.mode}</span></td>
        <td>${(r.fault_name || 'Healthy').replace(/_/g, ' ')}</td>
        <td><strong style="color:${r.predicted_fault_name === 'healthy' ? '#10B981' : '#F59E0B'}">${r.predicted_fault_name.replace(/_/g, ' ')}</strong></td>
        <td>${r.fault_confidence ? Math.round(r.fault_confidence * 100) + '%' : '98%'}</td>
        <td>${r.predicted_rul ? (r.predicted_rul * 0.3).toFixed(1) + ' hrs' : '35.6 hrs'}</td>
        <td>${r.mission_reliability_pct ? Math.round(r.mission_reliability_pct) + '%' : '82%'}</td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" style="color:#EF4444;">Error loading history: ${err.message}</td></tr>`;
  }
}

function generateComprehensiveReportData() {
  const cur = TELEMETRY_DATA[currentCycleIdx] || {};
  const healthPct = Math.round(cur.mission_reliability_pct || 82);
  const rulHrs = ((cur.predicted_RUL || 35.6) * 0.3).toFixed(1);
  const avgCht = Math.round((cur.cht_1_c || 312));
  const avgEgt = Math.round((cur.egt_1_c || 854));
  const vib = (cur.vibration_rms_g || 0.35).toFixed(2);

  const decision = evaluateMissionDecision(healthPct, parseFloat(rulHrs), cur.predicted_fault_class, avgEgt, parseFloat(vib));

  return {
    timestamp: new Date().toUTCString(),
    cycle: cur.cycle || 1,
    simulatedCondition: currentFaultSimulated.replace(/_/g, ' ').toUpperCase(),
    predictedFault: (cur.predicted_fault_name || 'healthy').replace(/_/g, ' ').toUpperCase(),
    confidence: cur.fault_confidence ? `${Math.round(cur.fault_confidence * 100)}%` : '98%',
    healthPct,
    rulCycles: cur.predicted_RUL || 120,
    rulHrs,
    rpm: Math.round(cur.rpm || 5120),
    cht: avgCht,
    egt: avgEgt,
    oilP: (cur.oil_pressure_kpa ? (cur.oil_pressure_kpa / 27.5).toFixed(1) : '4.9'),
    oilT: Math.round(cur.oil_temp_c || 83),
    fuelFlow: (cur.fuel_flow_lph ? (cur.fuel_flow_lph * 0.75).toFixed(1) : '26.3'),
    vibration: vib,
    altitude: Math.round((cur.mission_altitude_m || 2500) * 3.28084),
    airspeed: Math.round(cur.mission_airspeed_kmh || 130),
    throttle: Math.round(cur.throttle_pct || 72),
    decision: decision.recommendation,
    decisionDesc: decision.description,
    feasibilityScore: decision.feasibilityScore,
    plannedDuration: `${plannedMissionDurationHrs} hrs`,
    plannedAlt: `${plannedMaxAltitudeFt.toLocaleString()} ft`
  };
}

function openComprehensiveReportModal() {
  const rep = generateComprehensiveReportData();
  const container = document.getElementById('printableReportContent');
  if (!container) return;

  const recClass = rep.decision === 'GO' ? 'rep-rec-go' : rep.decision === 'CAUTION' ? 'rep-rec-caution' : 'rep-rec-inspection';

  container.innerHTML = `
    <div class="rep-sheet">
      <div class="rep-top-banner">
        <div class="rep-logo-title">
          <h2>AEROTWIN-AI DIGITAL TWIN REPORT</h2>
          <p>Autonomous AI Propulsion Health Certification &bull; Smart India Hackathon 2026</p>
        </div>
        <div class="rep-meta">
          <div><strong>Date:</strong> ${rep.timestamp}</div>
          <div><strong>UAV Platform:</strong> MALE Surveillance Unit 07</div>
          <div><strong>Engine:</strong> ROTAX 914 F/UL Horizontally Opposed Piston</div>
          <div><strong>Mission Cycle:</strong> #${rep.cycle}</div>
        </div>
      </div>

      <div class="rep-recommendation-box ${recClass}">
        <div>
          <span style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;opacity:0.8;">Executive Flight Recommendation</span>
          <h3 style="font-size:22px;font-weight:bold;margin:2px 0;">${rep.decision}</h3>
          <p style="font-size:12px;">${rep.decisionDesc}</p>
        </div>
        <div style="text-align:right;">
          <span style="font-size:10px;text-transform:uppercase;opacity:0.8;">Mission Feasibility</span>
          <div style="font-size:24px;font-weight:bold;font-family:'JetBrains Mono';">${rep.feasibilityScore}%</div>
        </div>
      </div>

      <div class="rep-grid-two">
        <div class="rep-block">
          <h4><i class="fa-solid fa-heart-pulse"></i> AI Diagnostics &amp; Prognostics</h4>
          <table class="rep-table">
            <tr><td>Engine Health Index</td><td><strong>${rep.healthPct}%</strong></td></tr>
            <tr><td>Predicted RUL</td><td><strong>${rep.rulHrs} hrs</strong> (${rep.rulCycles} cycles)</td></tr>
            <tr><td>Detected Anomaly</td><td><strong>${rep.predictedFault}</strong></td></tr>
            <tr><td>Diagnostic Confidence</td><td><strong>${rep.confidence}</strong></td></tr>
            <tr><td>Simulated State</td><td><strong>${rep.simulatedCondition}</strong></td></tr>
          </table>
        </div>

        <div class="rep-block">
          <h4><i class="fa-solid fa-gauge-high"></i> Operating &amp; Mission Parameters</h4>
          <table class="rep-table">
            <tr><td>Planned Mission Duration</td><td>${rep.plannedDuration}</td></tr>
            <tr><td>Operating Altitude</td><td>${rep.altitude.toLocaleString()} ft (Max: ${rep.plannedAlt})</td></tr>
            <tr><td>Airspeed</td><td>${rep.airspeed} km/h</td></tr>
            <tr><td>Throttle Setting</td><td>${rep.throttle}%</td></tr>
            <tr><td>Sensor Transducer Status</td><td>Nominal (1 Hz Telemetry)</td></tr>
          </table>
        </div>
      </div>

      <div class="rep-block">
        <h4><i class="fa-solid fa-microchip"></i> Live Engine Sensor Telemetry Snapshot</h4>
        <table class="rep-table" style="font-size:11.5px;">
          <thead>
            <tr><th>Channel</th><th>Actual Value</th><th>Twin Baseline</th><th>Status</th></tr>
          </thead>
          <tbody>
            <tr><td>Crankshaft RPM</td><td>${rep.rpm.toLocaleString()} rpm</td><td>4,800 - 5,500 rpm</td><td><span style="color:#10B981">Nominal</span></td></tr>
            <tr><td>Cylinder Head Temp (CHT)</td><td>${rep.cht} °C</td><td>90 - 135 °C</td><td><span style="color:${rep.cht > 140 ? '#EF4444' : '#10B981'}">${rep.cht > 140 ? 'High' : 'Normal'}</span></td></tr>
            <tr><td>Exhaust Gas Temp (EGT)</td><td>${rep.egt} °C</td><td>600 - 800 °C</td><td><span style="color:${rep.egt > 820 ? '#EF4444' : '#10B981'}">${rep.egt > 820 ? 'High' : 'Normal'}</span></td></tr>
            <tr><td>Oil Pressure &amp; Temp</td><td>${rep.oilP} bar &bull; ${rep.oilT} °C</td><td>4.5 bar &bull; 80 °C</td><td><span style="color:#10B981">Normal</span></td></tr>
            <tr><td>Fuel Flow Rate</td><td>${rep.fuelFlow} kg/h</td><td>22.0 kg/h</td><td><span style="color:#10B981">Normal</span></td></tr>
            <tr><td>Vibration RMS</td><td>${rep.vibration} g</td><td>&lt; 0.20 g</td><td><span style="color:${parseFloat(rep.vibration) > 0.3 ? '#F59E0B' : '#10B981'}">${parseFloat(rep.vibration) > 0.3 ? 'Elevated' : 'Normal'}</span></td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('reportModal').style.display = 'flex';
}

function downloadComprehensivePDF() {
  const rep = generateComprehensiveReportData();
  const { jsPDF } = window.jspdf || {};

  if (!jsPDF) {
    window.print();
    return;
  }

  const doc = new jsPDF();
  doc.setFillColor(7, 14, 21);
  doc.rect(0, 0, 210, 297, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 210, 255);
  doc.setFontSize(18);
  doc.text('AEROTWIN-AI — DIGITAL TWIN ENGINEERING REPORT', 14, 20);

  doc.setFontSize(9.5);
  doc.setTextColor(148, 163, 184);
  doc.text(`Generated: ${rep.timestamp} | Aircraft: MALE UAV Unit 07`, 14, 28);
  doc.text(`Engine: ROTAX 914 F/UL Horizontally Opposed 4-Cylinder Turbocharged`, 14, 34);

  doc.setDrawColor(30, 59, 86);
  doc.line(14, 38, 196, 38);

  const recColor = rep.decision === 'GO' ? [16, 185, 129] : rep.decision === 'CAUTION' ? [245, 158, 11] : [239, 68, 68];
  doc.setFillColor(recColor[0], recColor[1], recColor[2]);
  doc.roundedRect(14, 44, 182, 18, 2, 2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(13);
  doc.text(`FLIGHT RECOMMENDATION: ${rep.decision} (${rep.feasibilityScore}% Feasibility)`, 20, 55);

  doc.setFontSize(11);
  doc.setTextColor(0, 210, 255);
  doc.text('1. AI Health & Prognostics Summary', 14, 72);

  const metrics = [
    ['Engine Health Index:', `${rep.healthPct}%`],
    ['Remaining Useful Life (RUL):', `${rep.rulHrs} hrs (${rep.rulCycles} cycles)`],
    ['AI Detected Fault / Anomaly:', rep.predictedFault],
    ['Diagnostic Confidence:', rep.confidence],
    ['Crankshaft RPM:', `${rep.rpm.toLocaleString()} rpm`],
    ['Cylinder Head Temp (CHT Avg):', `${rep.cht} °C`],
    ['Exhaust Gas Temp (EGT Avg):', `${rep.egt} °C`],
    ['Oil Pressure & Temp:', `${rep.oilP} bar | ${rep.oilT} °C`],
    ['Fuel Flow Rate:', `${rep.fuelFlow} kg/h`],
    ['Vibration Level:', `${rep.vibration} g RMS`],
    ['Flight Altitude & Speed:', `${rep.altitude.toLocaleString()} ft | ${rep.airspeed} km/h`]
  ];

  let y = 80;
  metrics.forEach(([label, val]) => {
    doc.setTextColor(148, 163, 184);
    doc.text(label, 18, y);
    doc.setTextColor(255, 255, 255);
    doc.text(String(val), 100, y);
    y += 8;
  });

  doc.setDrawColor(30, 59, 86);
  doc.line(14, y + 4, 196, y + 4);

  doc.setFontSize(10);
  doc.setTextColor(16, 185, 129);
  doc.text('Smart India Hackathon 2026 - AI Digital Twin Certification Engine', 14, y + 14);

  doc.save(`AeroTwin_Comprehensive_Report_${Date.now()}.pdf`);
}

function exportAllTelemetry() {
  if (!TELEMETRY_DATA.length) {
    alert('No telemetry data to export. Run a mission first.');
    return;
  }
  const jsonStr = JSON.stringify(TELEMETRY_DATA, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `AeroTwin_Telemetry_FullPackage_${Date.now()}.json`;
  a.click();
}

// ==========================================================================
// 10. MANUAL SENSOR SCORING (/api/predict)
// ==========================================================================
const MANUAL_FIELDS = [
  ['throttle_pct', 60], ['mission_altitude_m', 4500], ['mission_airspeed_kmh', 130], ['rpm', 4280],
  ['oil_pressure_kpa', 137], ['oil_temp_c', 83], ['fuel_flow_lph', 11.3], ['vibration_rms_g', 0.08],
  ['cht_1_c', 59], ['cht_2_c', 59], ['cht_3_c', 59], ['cht_4_c', 59],
  ['egt_1_c', 541], ['egt_2_c', 541], ['egt_3_c', 541], ['egt_4_c', 541]
];

function buildManualForm() {
  const container = document.getElementById('manualForm');
  if (!container) return;
  container.innerHTML = MANUAL_FIELDS.map(([k, def]) => `
    <label>
      <span>${k.replace(/_/g, ' ')}</span>
      <input type="number" step="any" id="man_${k}" value="${def}">
    </label>
  `).join('');
}

async function scoreManualTelemetry() {
  const reading = {};
  MANUAL_FIELDS.forEach(([name]) => {
    reading[name] = parseFloat(document.getElementById(`man_${name}`).value);
  });

  const btn = document.getElementById('scoreBtn');
  const resBox = document.getElementById('manualResult');
  btn.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/api/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reading })
    });
    const d = await res.json();

    resBox.style.display = 'block';
    resBox.innerHTML = `
      <div style="color:#00D2FF;font-weight:bold;margin-bottom:4px;">Diagnostic Result:</div>
      <div>Predicted Fault: <strong style="color:#FFF;">${d.predicted_fault_name.replace(/_/g, ' ')}</strong></div>
      <div>Confidence: <strong>${Math.round(d.fault_confidence * 100)}%</strong></div>
      <div>RUL Estimate: <strong>${d.predicted_RUL} cycles</strong></div>
      <div>Reliability: <strong>${d.mission_reliability_pct}%</strong></div>
    `;
    setConnectionStatus(true);
  } catch (err) {
    resBox.style.display = 'block';
    resBox.innerHTML = `<span style="color:#EF4444;">Error: ${err.message}</span>`;
  } finally {
    btn.disabled = false;
  }
}

// ==========================================================================
// 11. LOGIN & MODAL TOGGLES
// ==========================================================================
function toggleLoginModal(show) {
  const modal = document.getElementById('loginModal');
  if (modal) modal.style.display = show ? 'flex' : 'none';
}

window.fakeLogin = function() {
  const user = document.getElementById('loginUser').value;
  alert(`Authenticated as ${user}. Ground Station session active.`);
  toggleLoginModal(false);
};

window.togglePasswordVisibility = function() {
  const input = document.getElementById('loginPass');
  input.type = input.type === 'password' ? 'text' : 'password';
};

// ==========================================================================
// 12. BOOTSTRAP INITIALIZATION & EVENT WIRING
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
  // 1. Initialize 3D Engine & Charts
  initThreeEngine();
  initCharts();
  renderAlertsTable();
  buildManualForm();
  initSimulatorLab();

  // 2. Multi-Page Navigation Wiring
  document.querySelectorAll('.sidebar-nav-item[data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      navigateToPage(btn.dataset.page);
    });
  });

  document.getElementById('brandHomeLink')?.addEventListener('click', () => navigateToPage('twin-engine'));
  document.getElementById('returnHomeBtn')?.addEventListener('click', () => navigateToPage('twin-engine'));

  window.addEventListener('hashchange', handleHashChange);
  handleHashChange();

  // 3. Live Clock
  setInterval(() => {
    const clock = document.getElementById('clock');
    const now = new Date();
    if (clock) clock.textContent = `${now.toLocaleTimeString()} UTC`;
  }, 1000);

  // 4. Metric Cards & 3D Picking
  document.querySelectorAll('.metric-card[data-metric]').forEach(card => {
    card.addEventListener('click', () => {
      focusComponent(card.dataset.metric);
    });
  });

  document.querySelectorAll('.callout-tag[data-target-comp]').forEach(tag => {
    tag.addEventListener('click', () => {
      focusComponent(tag.dataset.targetComp);
    });
  });

  document.querySelectorAll('.clickable-contrib[data-metric]').forEach(item => {
    item.addEventListener('click', () => {
      focusComponent(item.dataset.metric);
    });
  });

  // 5. Interactive Mission Specs
  document.getElementById('specDurationBox')?.addEventListener('click', () => {
    plannedMissionDurationHrs = plannedMissionDurationHrs === 4.0 ? 6.0 : plannedMissionDurationHrs === 6.0 ? 2.0 : 4.0;
    document.getElementById('mDuration').textContent = `${plannedMissionDurationHrs.toFixed(1)} hrs`;
    if (TELEMETRY_DATA.length) updateCycle(currentCycleIdx);
  });

  document.getElementById('specAltBox')?.addEventListener('click', () => {
    plannedMaxAltitudeFt = plannedMaxAltitudeFt === 18000 ? 22000 : plannedMaxAltitudeFt === 22000 ? 12000 : 18000;
    document.getElementById('mMaxAlt').textContent = `${plannedMaxAltitudeFt.toLocaleString()} ft`;
    if (TELEMETRY_DATA.length) updateCycle(currentCycleIdx);
  });

  // 6. Report Generation
  document.getElementById('headerGenReportBtn')?.addEventListener('click', openComprehensiveReportModal);
  document.getElementById('btnGenComprehensiveReport')?.addEventListener('click', openComprehensiveReportModal);
  document.getElementById('closeReportModal')?.addEventListener('click', () => {
    document.getElementById('reportModal').style.display = 'none';
  });
  document.getElementById('btnDownloadPdfReport')?.addEventListener('click', downloadComprehensivePDF);
  document.getElementById('btnPrintReport')?.addEventListener('click', () => window.print());

  document.getElementById('btnExportHealth')?.addEventListener('click', openComprehensiveReportModal);
  document.getElementById('btnExportMission')?.addEventListener('click', openComprehensiveReportModal);
  document.getElementById('btnExportAlerts')?.addEventListener('click', openComprehensiveReportModal);
  document.getElementById('btnExportAll')?.addEventListener('click', exportAllTelemetry);
  document.getElementById('btnRefreshHistory')?.addEventListener('click', loadMissionHistory);

  // 7. Simulation & Playback Controls
  document.getElementById('runBtn')?.addEventListener('click', simulateNewMission);
  document.getElementById('playBtn')?.addEventListener('click', togglePlayback);
  document.getElementById('scrub')?.addEventListener('input', e => updateCycle(parseInt(e.target.value, 10)));

  // 8. View Switchers
  document.getElementById('btnView3D')?.addEventListener('click', () => {
    document.getElementById('btnView3D').classList.add('active');
    document.getElementById('btnViewSchematic').classList.remove('active');
    document.getElementById('threeEngineContainer').style.display = 'block';
    document.getElementById('schematicContainer').style.display = 'none';
  });

  document.getElementById('btnViewSchematic')?.addEventListener('click', () => {
    document.getElementById('btnViewSchematic').classList.add('active');
    document.getElementById('btnView3D').classList.remove('active');
    document.getElementById('threeEngineContainer').style.display = 'none';
    document.getElementById('schematicContainer').style.display = 'flex';
  });

  // 9. Modals & Scoring
  document.getElementById('openLoginBtn')?.addEventListener('click', () => toggleLoginModal(true));
  document.getElementById('closeLoginModal')?.addEventListener('click', () => toggleLoginModal(false));
  document.getElementById('scoreBtn')?.addEventListener('click', scoreManualTelemetry);

  // 10. Alert Filters
  document.querySelectorAll('.filter-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderAlertsTable(btn.dataset.filter);
    });
  });

  // Check health and run initial simulation
  fetch(`${API_BASE}/api/health`)
    .then(r => setConnectionStatus(r.ok))
    .catch(() => setConnectionStatus(false));

  simulateNewMission();
});
