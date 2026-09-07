/* ==========================================================================
   AEROTWIN-AI PROTOTYPE — MULTI-PAGE APPLICATION ENGINE
   Three.js 3D Aero-Piston Engine, Multi-Page Router, Simulator Lab & Reports
   ========================================================================== */

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

function buildAeroPistonEngine() {
  engineGroup = new THREE.Group();
  scene.add(engineGroup);
  interactiveMeshes = [];

  const crankcaseMat = new THREE.MeshStandardMaterial({ color: 0x485868, metalness: 0.85, roughness: 0.28 });
  const cylinderBlockMat = new THREE.MeshStandardMaterial({ color: 0x2A3540, metalness: 0.9, roughness: 0.35 });
  const finMat = new THREE.MeshStandardMaterial({ color: 0x5C6D7E, metalness: 0.8, roughness: 0.3 });
  const chromeMat = new THREE.MeshStandardMaterial({ color: 0xDCE8F0, metalness: 0.95, roughness: 0.15 });
  const goldBrassMat = new THREE.MeshStandardMaterial({ color: 0xC8963E, metalness: 0.8, roughness: 0.25 });
  const exhaustMat = new THREE.MeshStandardMaterial({ color: 0x332B25, metalness: 0.7, roughness: 0.4, emissive: 0xFF3300, emissiveIntensity: 0.4 });
  const carbonPropMat = new THREE.MeshStandardMaterial({ color: 0x15181C, metalness: 0.3, roughness: 0.4 });

  // Center Crankcase Block
  const crankcaseGeo = new THREE.BoxGeometry(1.6, 1.1, 2.2);
  const crankcase = new THREE.Mesh(crankcaseGeo, crankcaseMat);
  crankcase.castShadow = true;
  crankcase.userData = { compKey: 'oil' };
  engineGroup.add(crankcase);
  interactiveMeshes.push(crankcase);

  for (let r = -0.8; r <= 0.8; r += 0.35) {
    const ribGeo = new THREE.BoxGeometry(1.65, 0.08, 0.1);
    const rib = new THREE.Mesh(ribGeo, crankcaseMat);
    rib.position.set(0, 0.55, r);
    engineGroup.add(rib);
  }

  // Front Propeller Reduction Gearbox (PRGB) Housing
  const prgbGeo = new THREE.CylinderGeometry(0.45, 0.65, 0.9, 24);
  const prgb = new THREE.Mesh(prgbGeo, crankcaseMat);
  prgb.rotation.x = Math.PI / 2;
  prgb.position.set(0, 0.15, 1.4);
  prgb.userData = { compKey: 'rpm' };
  engineGroup.add(prgb);
  interactiveMeshes.push(prgb);

  // Propeller Group
  propellerGroup = new THREE.Group();
  propellerGroup.position.set(0, 0.15, 1.9);

  const spinnerGeo = new THREE.ConeGeometry(0.35, 0.7, 24);
  const spinner = new THREE.Mesh(spinnerGeo, chromeMat);
  spinner.rotation.x = Math.PI / 2;
  spinner.userData = { compKey: 'rpm' };
  propellerGroup.add(spinner);
  interactiveMeshes.push(spinner);

  for (let b = 0; b < 3; b++) {
    const bladeArm = new THREE.Group();
    bladeArm.rotation.z = (b * Math.PI * 2) / 3;

    const bladeGeo = new THREE.BoxGeometry(0.2, 2.2, 0.04);
    const blade = new THREE.Mesh(bladeGeo, carbonPropMat);
    blade.position.set(0, 1.1, 0);
    blade.rotation.y = 0.25;
    blade.userData = { compKey: 'rpm' };
    interactiveMeshes.push(blade);

    const tipGeo = new THREE.BoxGeometry(0.205, 0.25, 0.045);
    const tipMat = new THREE.MeshBasicMaterial({ color: 0xFBBF24 });
    const tip = new THREE.Mesh(tipGeo, tipMat);
    tip.position.set(0, 2.05, 0);

    bladeArm.add(blade);
    bladeArm.add(tip);
    propellerGroup.add(bladeArm);
  }
  engineGroup.add(propellerGroup);

  // 4 Boxer Cylinders
  const cylinderConfigs = [
    { id: 1, side: -1, z: 0.55 },
    { id: 2, side: 1, z: 0.55 },
    { id: 3, side: -1, z: -0.55 },
    { id: 4, side: 1, z: -0.55 }
  ];

  cylinderHeads = [];
  pistons = [];

  cylinderConfigs.forEach(cfg => {
    const cylGroup = new THREE.Group();
    cylGroup.position.set(cfg.side * 0.8, 0, cfg.z);

    const barrelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.95, 20);
    const barrel = new THREE.Mesh(barrelGeo, cylinderBlockMat);
    barrel.rotation.z = Math.PI / 2;
    barrel.position.x = cfg.side * 0.45;
    barrel.userData = { compKey: 'cht' };
    cylGroup.add(barrel);
    interactiveMeshes.push(barrel);

    for (let f = 0.1; f <= 0.85; f += 0.08) {
      const finGeo = new THREE.CylinderGeometry(0.48, 0.48, 0.02, 20);
      const fin = new THREE.Mesh(finGeo, finMat);
      fin.rotation.z = Math.PI / 2;
      fin.position.x = cfg.side * f;
      cylGroup.add(fin);
    }

    const headGeo = new THREE.BoxGeometry(0.3, 0.72, 0.72);
    const headMat = new THREE.MeshStandardMaterial({
      color: 0x3E4E5E,
      metalness: 0.8,
      roughness: 0.3,
      emissive: 0x00D2FF,
      emissiveIntensity: 0.1
    });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.x = cfg.side * 0.98;
    head.userData = { compKey: 'cht' };
    cylGroup.add(head);
    cylinderHeads.push(head);
    interactiveMeshes.push(head);

    const plugGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.25, 12);
    const plug = new THREE.Mesh(plugGeo, goldBrassMat);
    plug.position.set(cfg.side * 1.05, 0.38, 0);
    plug.userData = { compKey: 'cht' };
    cylGroup.add(plug);
    interactiveMeshes.push(plug);

    const wireGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.8, 8);
    const wireMat = new THREE.MeshBasicMaterial({ color: 0xEF4444 });
    const wire = new THREE.Mesh(wireGeo, wireMat);
    wire.position.set(cfg.side * 0.7, 0.45, 0);
    wire.rotation.z = -cfg.side * 0.5;
    cylGroup.add(wire);

    const pistonGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.35, 16);
    const piston = new THREE.Mesh(pistonGeo, chromeMat);
    piston.rotation.z = Math.PI / 2;
    piston.position.x = cfg.side * 0.45;
    cylGroup.add(piston);
    pistons.push({ mesh: piston, side: cfg.side, basePos: cfg.side * 0.45, phase: cfg.id * Math.PI * 0.5 });

    cylGroup.userData = { defaultX: cylGroup.position.x, side: cfg.side };
    engineGroup.add(cylGroup);
  });

  // Exhaust & Turbo
  const pipeCurveLeft = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.9, -0.2, 0.55),
    new THREE.Vector3(-1.05, -0.6, 0.1),
    new THREE.Vector3(-0.8, -0.7, -0.6),
    new THREE.Vector3(0, -0.7, -1.3)
  ]);
  const pipeGeoLeft = new THREE.TubeGeometry(pipeCurveLeft, 30, 0.09, 12, false);
  const pipeLeft = new THREE.Mesh(pipeGeoLeft, exhaustMat);
  pipeLeft.userData = { compKey: 'egt' };
  engineGroup.add(pipeLeft);
  exhaustPipes.push(pipeLeft);
  interactiveMeshes.push(pipeLeft);

  const pipeCurveRight = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.9, -0.2, 0.55),
    new THREE.Vector3(1.05, -0.6, 0.1),
    new THREE.Vector3(0.8, -0.7, -0.6),
    new THREE.Vector3(0, -0.7, -1.3)
  ]);
  const pipeGeoRight = new THREE.TubeGeometry(pipeCurveRight, 30, 0.09, 12, false);
  const pipeRight = new THREE.Mesh(pipeGeoRight, exhaustMat);
  pipeRight.userData = { compKey: 'egt' };
  engineGroup.add(pipeRight);
  exhaustPipes.push(pipeRight);
  interactiveMeshes.push(pipeRight);

  const turboGeo = new THREE.TorusGeometry(0.35, 0.16, 16, 24);
  const turbo = new THREE.Mesh(turboGeo, goldBrassMat);
  turbo.position.set(0, -0.65, -1.4);
  turbo.userData = { compKey: 'egt' };
  engineGroup.add(turbo);
  interactiveMeshes.push(turbo);

  const tailpipeGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.7, 16);
  const tailpipe = new THREE.Mesh(tailpipeGeo, exhaustMat);
  tailpipe.rotation.x = Math.PI / 2;
  tailpipe.position.set(0.2, -0.65, -1.8);
  tailpipe.userData = { compKey: 'egt' };
  engineGroup.add(tailpipe);
  exhaustPipes.push(tailpipe);
  interactiveMeshes.push(tailpipe);

  // Fuel Rails
  const fuelRailMat = new THREE.MeshStandardMaterial({ color: 0x38BDF8, metalness: 0.9, roughness: 0.2 });
  const fuelRailGeo = new THREE.CylinderGeometry(0.04, 0.04, 1.8, 12);
  const fuelRailLeft = new THREE.Mesh(fuelRailGeo, fuelRailMat);
  fuelRailLeft.position.set(-0.7, 0.35, 0);
  fuelRailLeft.rotation.x = Math.PI / 2;
  fuelRailLeft.userData = { compKey: 'fuel' };
  engineGroup.add(fuelRailLeft);
  interactiveMeshes.push(fuelRailLeft);

  const fuelRailRight = new THREE.Mesh(fuelRailGeo, fuelRailMat);
  fuelRailRight.position.set(0.7, 0.35, 0);
  fuelRailRight.rotation.x = Math.PI / 2;
  fuelRailRight.userData = { compKey: 'fuel' };
  engineGroup.add(fuelRailRight);
  interactiveMeshes.push(fuelRailRight);

  // Oil Filter & Sump
  const oilFilterGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.5, 16);
  const oilFilterMat = new THREE.MeshStandardMaterial({ color: 0x1E3A8A, metalness: 0.6, roughness: 0.3 });
  const oilFilter = new THREE.Mesh(oilFilterGeo, oilFilterMat);
  oilFilter.position.set(-0.6, -0.4, 0.8);
  oilFilter.userData = { compKey: 'oil' };
  engineGroup.add(oilFilter);
  interactiveMeshes.push(oilFilter);

  const sumpGeo = new THREE.BoxGeometry(1.2, 0.3, 1.6);
  const sump = new THREE.Mesh(sumpGeo, crankcaseMat);
  sump.position.set(0, -0.65, 0);
  sump.userData = { compKey: 'oil' };
  engineGroup.add(sump);
  interactiveMeshes.push(sump);

  // Vibration Transducer
  const vibSensorGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.08, 12);
  const vibSensorMat = new THREE.MeshStandardMaterial({ color: 0xF59E0B, metalness: 0.9, roughness: 0.2 });
  const vibSensor = new THREE.Mesh(vibSensorGeo, vibSensorMat);
  vibSensor.position.set(0.4, 0.58, 0.3);
  vibSensor.userData = { compKey: 'vib' };
  engineGroup.add(vibSensor);
  interactiveMeshes.push(vibSensor);
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

function toggleExplodedView() {
  isExploded = !isExploded;
  const btn = document.getElementById('btnExplodeView');
  if (btn) {
    btn.innerHTML = isExploded ?
      '<i class="fa-solid fa-compress"></i> Normal View' :
      '<i class="fa-solid fa-arrows-split-up-and-left"></i> Cutaway View';
  }

  engineGroup.children.forEach(child => {
    if (child.userData && child.userData.defaultX !== undefined) {
      const targetX = isExploded ?
        child.userData.defaultX + (child.userData.side * 0.6) :
        child.userData.defaultX;
      child.position.x = targetX;
    }
  });
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
// 4. DYNAMIC EVALUATION: GO / CAUTION / INSPECTION REQUIRED
// ==========================================================================
function evaluateMissionDecision(healthPct, rulHrs, activeFaultClass, egt, vib) {
  let recommendation = "GO";
  let statusClass = "go-status";
  let badgeClass = "badge-go";
  let description = "Engine fit for planned mission";
  let feasibilityScore = 88;

  const isSevereFault = activeFaultClass !== 0 && activeFaultClass !== undefined;

  if (healthPct < 50 || rulHrs < 15 || (isSevereFault && (egt > 820 || vib > 0.3))) {
    recommendation = "INSPECTION REQUIRED";
    statusClass = "nogo-status";
    badgeClass = "badge-inspection";
    description = "Immediate ground inspection required";
    feasibilityScore = 35;
  } else if (healthPct < 75 || rulHrs < 25 || plannedMissionDurationHrs > (rulHrs * 0.75) || isSevereFault) {
    recommendation = "CAUTION";
    statusClass = "caution-status";
    badgeClass = "badge-caution";
    description = "Degradation trend detected; monitor telemetry";
    feasibilityScore = 68;
  }

  const decisionText = document.getElementById('missionDecisionText');
  if (decisionText) {
    decisionText.textContent = `RECOMMENDATION: ${recommendation}`;
    decisionText.className = badgeClass;
  }

  const readinessChip = document.getElementById('readinessChip');
  if (readinessChip) {
    readinessChip.className = `readiness-chip ${statusClass}`;
    document.getElementById('readinessText').textContent = recommendation;
    document.getElementById('readinessDesc').textContent = description;
    const icon = document.getElementById('readinessIcon');
    if (icon) {
      icon.className = recommendation === 'GO' ? 'fa-solid fa-circle-check' :
                       recommendation === 'CAUTION' ? 'fa-solid fa-triangle-exclamation' : 'fa-solid fa-circle-xmark';
    }
  }

  document.getElementById('feasibilityPct').textContent = `${feasibilityScore}%`;
  document.getElementById('feasibilityStatus').textContent = recommendation === 'GO' ? 'Optimal' : recommendation === 'CAUTION' ? 'Acceptable' : 'High Risk';
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
// 6. SIMULATOR LAB LOGIC (DATASETS, PRESETS, INDEPENDENT EXECUTION)
// ==========================================================================
function initSimulatorLab() {
  // Preset buttons
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeSimulatorPreset = btn.dataset.preset;
    });
  });

  // Run Lab Simulation Button
  document.getElementById('btnRunLabSim')?.addEventListener('click', runLabSimulation);

  // Transfer Lab Run to Main 3D Twin
  document.getElementById('btnTransferToTwin')?.addEventListener('click', () => {
    if (LAB_SIMULATION_DATA.length) {
      renderTelemetryData(LAB_SIMULATION_DATA);
      navigateToPage('twin-engine');
    } else {
      alert('Run a simulation first.');
    }
  });

  // File Uploader Setup
  const dropZone = document.getElementById('datasetDropZone');
  const fileInput = document.getElementById('datasetFileInput');
  const fileInfo = document.getElementById('uploadFileInfo');

  if (dropZone && fileInput) {
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.style.borderColor = '#00D2FF';
    });
    dropZone.addEventListener('dragleave', () => {
      dropZone.style.borderColor = '#1E3B56';
    });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.style.borderColor = '#1E3B56';
      if (e.dataTransfer.files.length) {
        handleUploadedFile(e.dataTransfer.files[0]);
      }
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files.length) {
        handleUploadedFile(fileInput.files[0]);
      }
    });
  }
}

function handleUploadedFile(file) {
  const fileInfo = document.getElementById('uploadFileInfo');
  if (!fileInfo) return;
  fileInfo.style.display = 'block';
  fileInfo.innerHTML = `Loaded: <strong>${file.name}</strong> (${(file.size / 1024).toFixed(1)} KB)`;

  const reader = new FileReader();
  reader.onload = function(e) {
    const text = e.target.result;
    const lines = text.trim().split('\n');
    fileInfo.innerHTML = `Loaded: <strong>${file.name}</strong> &bull; Detected ${lines.length - 1} flight telemetry cycles &bull; Ready to Simulate`;
  };
  reader.readAsText(file);
}

let liveMissionActive = false;
let liveMissionTimer = null;
let liveCycleCount = 0;
let liveFaultSeverity = 0;
let liveTargetFault = null;

async function runLabSimulation() {
  const faultName = activeSimulatorPreset === 'healthy' ? null : activeSimulatorPreset;
  startLiveMission(faultName);
}

async function simulateNewMission() {
  const faultName = document.getElementById('faultSelect').value || null;
  startLiveMission(faultName);
}

function startLiveMission(faultName) {
  const btn = document.getElementById('runBtn');
  const btnLab = document.getElementById('btnRunLabSim');
  const status = document.getElementById('runStatus');
  const summary = document.getElementById('simResultSummary');
  const playBtn = document.getElementById('playBtn');
  
  if (liveMissionActive) {
    clearInterval(liveMissionTimer);
  }
  
  TELEMETRY_DATA = [];
  liveCycleCount = 0;
  liveFaultSeverity = 0;
  liveTargetFault = faultName || 'healthy';
  liveMissionActive = true;
  isPlaying = true; 

  if (btn) btn.disabled = true;
  if (btnLab) btnLab.disabled = true;
  const missionTitle = liveTargetFault.replace(/_/g, ' ').toUpperCase();
  if (status) status.textContent = `Live Mission Streaming • ${missionTitle}`;
  if (summary) summary.textContent = `Live Mission Streaming • ${missionTitle}`;
  if (playBtn) playBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';

  setConnectionStatus(true);
  
  const speedMultiplier = parseInt(document.getElementById('speedSelect')?.value || '4', 10);
  const intervalMs = Math.max(100, 1000 / speedMultiplier);
  
  liveMissionTimer = setInterval(liveMissionTick, intervalMs);
}

async function liveMissionTick() {
  liveCycleCount++;
  
  // Base stochastic reading
  let reading = {
    throttle_pct: 72 + (Math.random() * 4 - 2),
    mission_altitude_m: 2500 + (Math.random() * 50 - 25),
    mission_airspeed_kmh: 130 + (Math.random() * 5 - 2.5),
    rpm: 5120 + (Math.random() * 40 - 20),
    oil_pressure_kpa: 135 + (Math.random() * 4 - 2),
    oil_temp_c: 83 + (Math.random() * 2 - 1),
    fuel_flow_lph: 22 + (Math.random() * 1 - 0.5),
    vibration_rms_g: 0.08 + (Math.random() * 0.02 - 0.01),
    cht_1_c: 110 + (Math.random() * 4 - 2),
    cht_2_c: 110 + (Math.random() * 4 - 2),
    cht_3_c: 110 + (Math.random() * 4 - 2),
    cht_4_c: 110 + (Math.random() * 4 - 2),
    egt_1_c: 700 + (Math.random() * 10 - 5),
    egt_2_c: 700 + (Math.random() * 10 - 5),
    egt_3_c: 700 + (Math.random() * 10 - 5),
    egt_4_c: 700 + (Math.random() * 10 - 5)
  };

  // Fault Progression (Stochastic Degradation)
  if (liveTargetFault && liveTargetFault !== 'healthy') {
    if (liveCycleCount > 5) {
       liveFaultSeverity += (Math.random() * 0.08); // dynamic drift
    }
    
    // Apply realistic deviations
    if (liveTargetFault === 'cooling_airflow_blockage') {
      reading.cht_1_c += liveFaultSeverity * 15;
      reading.cht_2_c += liveFaultSeverity * 15;
      reading.cht_3_c += liveFaultSeverity * 15;
      reading.cht_4_c += liveFaultSeverity * 15;
      reading.oil_temp_c += liveFaultSeverity * 4;
    } else if (liveTargetFault === 'exhaust_valve_leak') {
      reading.egt_1_c += liveFaultSeverity * 25;
      reading.egt_2_c += liveFaultSeverity * 25;
      reading.vibration_rms_g += liveFaultSeverity * 0.1;
    } else if (liveTargetFault === 'bearing_wear') {
      reading.vibration_rms_g += liveFaultSeverity * 0.2;
      reading.oil_pressure_kpa -= liveFaultSeverity * 8;
      reading.oil_temp_c += liveFaultSeverity * 5;
    } else if (liveTargetFault === 'fuel_pump_degradation') {
      reading.fuel_flow_lph -= liveFaultSeverity * 2;
      reading.rpm -= liveFaultSeverity * 80;
    } else if (liveTargetFault === 'spark_plug_fouling') {
      reading.cht_1_c -= liveFaultSeverity * 12;
      reading.rpm -= liveFaultSeverity * 50;
      reading.vibration_rms_g += liveFaultSeverity * 0.05;
    } else if (liveTargetFault === 'fuel_injector_clog') {
      reading.fuel_flow_lph -= liveFaultSeverity * 1.5;
      reading.egt_1_c -= liveFaultSeverity * 20;
    } else if (liveTargetFault === 'oil_starvation') {
      reading.oil_pressure_kpa -= liveFaultSeverity * 12;
      reading.oil_temp_c += liveFaultSeverity * 10;
      reading.vibration_rms_g += liveFaultSeverity * 0.15;
    }
  }
  
  // Stream to AI Backend
  try {
    const res = await fetch('/api/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reading: reading, history: TELEMETRY_DATA.slice(-20) })
    });
    
    if (!res.ok) throw new Error(await res.text());
    const aiResult = await res.json();
    
    const fullCycleData = {
      cycle: liveCycleCount,
      ...reading,
      ...aiResult,
      // Create twin baselines for charting aesthetics
      cht_1_twin: 110, cht_2_twin: 110, cht_3_twin: 110, cht_4_twin: 110,
      egt_1_twin: 700, egt_2_twin: 700, egt_3_twin: 700, egt_4_twin: 700,
      oil_pressure_twin: 135, vibration_twin: 0.08
    };
    
    TELEMETRY_DATA.push(fullCycleData);
    if (TELEMETRY_DATA.length > 250) TELEMETRY_DATA.shift(); // rolling window
    
    appendTelemetryData(fullCycleData);
    updateCycle(TELEMETRY_DATA.length - 1);
    
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
    CHARTS.simTemp.data.datasets[0].data.push((d.cht_1_c + d.cht_2_c + d.cht_3_c + d.cht_4_c) / 4);
    CHARTS.simTemp.data.datasets[1].data.push((d.cht_1_twin + d.cht_2_twin + d.cht_3_twin + d.cht_4_twin) / 4);
    CHARTS.simTemp.data.datasets[2].data.push((d.egt_1_c + d.egt_2_c + d.egt_3_c + d.egt_4_c) / 4);
    if (CHARTS.simTemp.data.labels.length > 50) {
      CHARTS.simTemp.data.labels.shift();
      CHARTS.simTemp.data.datasets.forEach(ds => ds.data.shift());
    }
    CHARTS.simTemp.update();
  }
  
  if (CHARTS.simMech) {
    CHARTS.simMech.data.labels.push(lbl);
    CHARTS.simMech.data.datasets[0].data.push(d.oil_pressure_kpa);
    CHARTS.simMech.data.datasets[1].data.push(d.vibration_rms_g);
    if (CHARTS.simMech.data.labels.length > 50) {
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
    if (runBtn) runBtn.disabled = false;
    if (labBtn) labBtn.disabled = false;
  } else {
    if (TELEMETRY_DATA.length > 0 || liveCycleCount === 0) {
      if (liveCycleCount === 0) {
         startLiveMission(document.getElementById('faultSelect').value || null);
      } else {
         liveMissionActive = true;
         isPlaying = true;
         if (btn) btn.innerHTML = '<i class="fa-solid fa-pause"></i>';
         const speedMultiplier = parseInt(document.getElementById('speedSelect')?.value || '4', 10);
         const intervalMs = Math.max(100, 1000 / speedMultiplier);
         liveMissionTimer = setInterval(liveMissionTick, intervalMs);
         
         const runBtn = document.getElementById('runBtn');
         const labBtn = document.getElementById('btnRunLabSim');
         if (runBtn) runBtn.disabled = true;
         if (labBtn) labBtn.disabled = true;
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
    const res = await fetch('/api/history?limit=25');
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
    const res = await fetch('/api/predict', {
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
  fetch('/api/health')
    .then(r => setConnectionStatus(r.ok))
    .catch(() => setConnectionStatus(false));

  simulateNewMission();
});
