// Three.js Field Disc Shooter 3D

let scene, camera, renderer, controls;
let container;
let player, playerBody;
// Approximate VRC Spin Up field: square 12x12 (units are arbitrary). Half-dimensions = 6
let fieldBounds = { halfWidth: 6, halfLength: 6 };
let keys = {};
let clock;
let projectiles = [];
let discsOnField = [];
let inventory = 0;
let score = 0;
// Two corner high goals (approximate): we will detect scoring near ring centers
let goalGroups = [];
let highGoalZones = []; // { center: THREE.Vector3, radius: number, height: number, thickness: number }
let overlayEl, scoreEl, inventoryEl;
let timerEl;
let endOverlayEl, endSummaryEl;
let runStartTime = null;
let finished = false;
let runElapsedMs = 0;
// Tunables
const TURN_SMOOTH_BASE = 0.2;     // smaller base => faster turn response
const CAMERA_SMOOTH_BASE = 0.3;   // smaller base => faster camera follow
const GRAVITY = 9.8;              // m/s^2
const DISC_BOUNCE = 0.35;         // ground bounce energy retention (less bouncy)
const WALL_BOUNCE = 0.6;          // wall bounce energy retention
const AIR_DRAG = 0.22;            // linear drag for discs (horizontal)
const GROUND_FRICTION = 3.5;      // rolling friction when on ground
let camYaw = 0; // camera heading
const PAN_SENSITIVITY = 0.007;    // radians per pixel for right-drag pan
let isPanning = false;
let lastPanX = 0;

// Inventory/visual constants
const INVENTORY_MAX = 3;
const DISC_THICKNESS = 0.12; // matches makeDisc height
let heldGroup;

// Player dimensions (visual and hitbox are the same)
const PLAYER_RADIUS = 0.45;
const PLAYER_HEIGHT = 1.2;

// Third-person orbit camera parameters (Fortnite-style)
let camPitch = 0.2; // radians; 0 = horizontal, + tilts downward
const ORBIT_YAW_SENSITIVITY = 0.0025 * 1.5; // +25%
const ORBIT_PITCH_SENSITIVITY = 0.0020 * 1.5; // +25%
const PITCH_MIN = 0.0;            // do not look upward above horizon
const PITCH_MAX = Math.PI / 2;    // allow straight-down view
let isRightMouseDown = false;

if (typeof THREE === 'undefined') {
  showLibError();
} else {
  init();
  animate();
}

function init() {
  container = document.getElementById('container');
  overlayEl = document.getElementById('overlay');
  scoreEl = document.getElementById('score');
  inventoryEl = document.getElementById('inventory');
  timerEl = document.getElementById('timer');
  endOverlayEl = document.getElementById('end-overlay');
  endSummaryEl = document.getElementById('end-summary');

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b111b);

  clock = new THREE.Clock();

  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);
  camera.position.set(0, 8, 14);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

  // Custom chase camera replaces orbit controls

  addLights();
  buildSpinUpField();
  buildSpinUpGoals();
  spawnPlayer();
  scatterDiscs(12);

  window.addEventListener('resize', onWindowResize);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  renderer.domElement.addEventListener('mousedown', (e) => {
    if (e.button === 2) {
      // RMB: engage orbit/pan
      isRightMouseDown = true;
      e.preventDefault();
      return;
    }
    if (e.button === 0) shoot();
  });
  renderer.domElement.addEventListener('mousemove', (e) => {
    // Orbit only while RMB held; cursor always visible (no pointer lock)
    if (!isRightMouseDown) return;
    const dx = (typeof e.movementX === 'number') ? e.movementX : 0;
    const dy = (typeof e.movementY === 'number') ? e.movementY : 0;
    // Standard feel: move right -> rotate right; move up -> look up
    camYaw -= dx * ORBIT_YAW_SENSITIVITY;
    camPitch = THREE.MathUtils.clamp(camPitch + dy * ORBIT_PITCH_SENSITIVITY, PITCH_MIN, PITCH_MAX);
  });
  renderer.domElement.addEventListener('mouseup', (e) => {
    if (e.button === 2) {
      isRightMouseDown = false;
      // stay locked; nothing else to do
    }
  });
  renderer.domElement.addEventListener('mouseleave', () => {});
  renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
}

function addLights() {
  const hemi = new THREE.HemisphereLight(0x99bbff, 0x224466, 0.8);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 1.0);
  dir.position.set(8, 16, 10);
  dir.castShadow = true;
  dir.shadow.mapSize.set(2048, 2048);
  scene.add(dir);
}

function buildSpinUpField() {
  const group = new THREE.Group();
  scene.add(group);

  // Floor (attempt texture fallback to solid color)
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x2a2e38, roughness: 1, metalness: 0 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(fieldBounds.halfWidth * 2, fieldBounds.halfLength * 2), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  tryLoadFieldTexture(floorMat);

  // Low perimeter walls (visual + bounce)
  const wallH = 0.3;
  const wallT = 0.1;
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x555a66, roughness: 0.6, metalness: 0.05 });
  const wallGeos = [
    // +X wall
    { x: fieldBounds.halfWidth, z: 0, w: wallT, l: fieldBounds.halfLength * 2 },
    // -X wall
    { x: -fieldBounds.halfWidth, z: 0, w: wallT, l: fieldBounds.halfLength * 2 },
    // +Z wall
    { x: 0, z: fieldBounds.halfLength, w: fieldBounds.halfWidth * 2, l: wallT },
    // -Z wall
    { x: 0, z: -fieldBounds.halfLength, w: fieldBounds.halfWidth * 2, l: wallT }
  ];
  wallGeos.forEach(info => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(info.w, wallH, info.l), wallMat);
    wall.position.set(info.x, wallH / 2, info.z);
    wall.castShadow = true; wall.receiveShadow = true;
    group.add(wall);
  });

  // Tile grid lines (white), approximate field markings
  const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 });
  const lines = new THREE.Group();
  for (let x = -fieldBounds.halfWidth; x <= fieldBounds.halfWidth; x += 1) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x, 0.01, -fieldBounds.halfLength),
      new THREE.Vector3(x, 0.01, fieldBounds.halfLength)
    ]);
    lines.add(new THREE.Line(geo, lineMat));
  }
  for (let z = -fieldBounds.halfLength; z <= fieldBounds.halfLength; z += 1) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-fieldBounds.halfWidth, 0.01, z),
      new THREE.Vector3(fieldBounds.halfWidth, 0.01, z)
    ]);
    lines.add(new THREE.Line(geo, lineMat));
  }
  group.add(lines);
}

function buildSpinUpGoals() {
  // Two disc-golf style baskets at opposite corners
  const rimRadius = 0.9;   // top rim radius
  const rimThickness = 0.12;
  const rimY = 1.6;        // rim height
  const basketDepth = 0.6; // vertical distance from rim to lower basket ring
  const offset = 0.9;      // in from corner

  const rimMatA = new THREE.MeshStandardMaterial({ color: 0x4aa3ff, roughness: 0.4, metalness: 0.1 });
  const rimMatB = new THREE.MeshStandardMaterial({ color: 0xff6a6a, roughness: 0.4, metalness: 0.1 });
  const postMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.2, roughness: 0.6 });
  const netMat = new THREE.MeshStandardMaterial({ color: 0x88aadd, transparent: true, opacity: 0.18 });

  const corners = [
    new THREE.Vector3(fieldBounds.halfWidth - offset, rimY, fieldBounds.halfLength - offset),
    new THREE.Vector3(-fieldBounds.halfWidth + offset, rimY, -fieldBounds.halfLength + offset)
  ];
  const rimMats = [rimMatA, rimMatB];

  corners.forEach((center, i) => {
    const group = new THREE.Group();
    scene.add(group);
    goalGroups.push(group);

    // Top rim (torus, horizontal)
    const rim = new THREE.Mesh(new THREE.TorusGeometry(rimRadius, rimThickness, 16, 64), rimMats[i]);
    rim.rotation.x = Math.PI / 2; // make hole axis vertical
    rim.position.copy(center);
    rim.castShadow = true; rim.receiveShadow = true;
    group.add(rim);

    // Lower ring (smaller) to form basket bottom
    const lowerRadius = rimRadius * 0.65;
    const lower = new THREE.Mesh(new THREE.TorusGeometry(lowerRadius, rimThickness * 0.6, 12, 48), postMat);
    lower.rotation.x = Math.PI / 2;
    lower.position.set(center.x, center.y - basketDepth, center.z);
    lower.castShadow = true; lower.receiveShadow = true;
    group.add(lower);

    // Vertical post
    const postHeight = center.y;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, postHeight, 16), postMat);
    post.position.set(center.x, postHeight / 2, center.z);
    post.castShadow = true; post.receiveShadow = true;
    group.add(post);

    // Net/basket cylinder (transparent)
    const net = new THREE.Mesh(new THREE.CylinderGeometry(rimRadius * 0.95, lowerRadius * 0.95, basketDepth, 24, 1, true), netMat);
    net.position.set(center.x, center.y - basketDepth / 2, center.z);
    net.castShadow = false; net.receiveShadow = false;
    group.add(net);

    // Chains (lines) from rim to lower ring
    const chainCount = 16;
    const chainGeo = new THREE.BufferGeometry();
    const chainMat = new THREE.LineBasicMaterial({ color: 0xbbc7dd, transparent: true, opacity: 0.6 });
    for (let c = 0; c < chainCount; c++) {
      const a = (c / chainCount) * Math.PI * 2;
      const x1 = center.x + Math.cos(a) * (rimRadius - rimThickness * 0.4);
      const z1 = center.z + Math.sin(a) * (rimRadius - rimThickness * 0.4);
      const x2 = center.x + Math.cos(a) * (lowerRadius - rimThickness * 0.4);
      const z2 = center.z + Math.sin(a) * (lowerRadius - rimThickness * 0.4);
      const points = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x1, center.y, z1),
        new THREE.Vector3(x2, center.y - basketDepth, z2)
      ]);
      const line = new THREE.Line(points, chainMat);
      group.add(line);
    }

    // Scoring volume: interior cylinder under the rim
    const innerRadius = rimRadius - rimThickness * 1.4; // inside of rim
    const yMin = center.y - basketDepth * 0.95;
    const yMax = center.y + rimThickness * 1.0;
    highGoalZones.push({ center: center.clone(), innerRadius, yMin, yMax });
  });
}

function tryLoadFieldTexture(floorMat) {
  if (!THREE || !THREE.TextureLoader) return;
  const loader = new THREE.TextureLoader();
  // If the texture isn't available, silently skip
  const candidates = ['spinupfield.png', '/spinupfield.png'];
  loader.load(candidates[0], (tex) => {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 1);
    floorMat.map = tex;
    floorMat.needsUpdate = true;
  }, undefined, () => {});
}

function spawnPlayer() {
  // Use a cylinder so the hitbox matches the shape exactly
  const bodyGeo = new THREE.CylinderGeometry(PLAYER_RADIUS, PLAYER_RADIUS, PLAYER_HEIGHT, 24);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x7ccfff, roughness: 0.4, metalness: 0.1 });
  playerBody = new THREE.Mesh(bodyGeo, bodyMat);
  playerBody.castShadow = true; playerBody.receiveShadow = true;
  playerBody.position.set(0, PLAYER_HEIGHT / 2, 4);
  scene.add(playerBody);

  // Visual stack of held discs mounted atop the robot
  heldGroup = new THREE.Group();
  heldGroup.position.y = PLAYER_HEIGHT / 2;
  playerBody.add(heldGroup);

  player = {
    velocity: new THREE.Vector3(),
    speed: 8,
    maxSpeed: 9,
    friction: 8
  };

  // Initialize camera heading to player's facing
  camYaw = playerBody.rotation.y;
}

function updateHeldStack() {
  if (!heldGroup) return;
  // Clear current visuals
  while (heldGroup.children.length > 0) {
    const child = heldGroup.children[0];
    heldGroup.remove(child);
  }
  // Rebuild stack
  for (let i = 0; i < inventory; i++) {
    const disc = makeDisc(0xffcf66);
    disc.position.set(0, DISC_THICKNESS * (i + 0.5), 0);
    heldGroup.add(disc);
  }
}

function scatterDiscs(count) {
  for (let i = 0; i < count; i++) {
    const disc = makeDisc(0xffcf66);
    const x = randInRange(-fieldBounds.halfWidth + 1.2, fieldBounds.halfWidth - 1.2);
    const z = randInRange(-fieldBounds.halfLength + 4, fieldBounds.halfLength - 2);
    disc.position.set(x, 0.11, z);
    scene.add(disc);
    discsOnField.push(disc);
  }
}

function makeDisc(color = 0xff8855) {
  const geo = new THREE.CylinderGeometry(0.35, 0.35, 0.12, 24);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function onKeyDown(e) {
  keys[e.key.toLowerCase()] = true;
  // Rebind pickup to Space
  if (e.code === 'Space' || e.key === ' ') tryPickup();
  if (e.key === 'r' || e.key === 'R') resetGame();
  // Overlay continue now uses Enter to avoid conflict with Space pickup
  if ((e.key === 'Enter' || e.code === 'Enter') && !overlayEl.classList.contains('hidden')) {
    overlayEl.classList.add('hidden');
  }
}

function onKeyUp(e) {
  keys[e.key.toLowerCase()] = false;
}

function tryPickup() {
  if (inventory >= INVENTORY_MAX) return;
  let pickedIndex = -1;
  for (let i = 0; i < discsOnField.length; i++) {
    const d = discsOnField[i];
    if (d.position.distanceTo(playerBody.position) < 1.1) {
      pickedIndex = i;
      break;
    }
  }
  if (pickedIndex >= 0) {
    const disc = discsOnField.splice(pickedIndex, 1)[0];
    scene.remove(disc);
    inventory += 1;
    if (inventoryEl) inventoryEl.textContent = inventory;
    updateHeldStack();
    ensureRunStarted();
    return;
  }

  // Also allow picking up active projectiles nearby
  for (let i = 0; i < projectiles.length; i++) {
    const pm = projectiles[i].mesh;
    if (pm.position.distanceTo(playerBody.position) < 1.1) {
      scene.remove(pm);
      projectiles.splice(i, 1);
      inventory += 1;
      if (inventoryEl) inventoryEl.textContent = inventory;
      updateHeldStack();
      ensureRunStarted();
      return;
    }
  }
}

function shoot() {
  if (inventory <= 0) return;
  ensureRunStarted();

  const disc = makeDisc(0xff8855);
  const start = playerBody.position.clone();

  // Build a 45° shot relative to the ground, aligned with camera facing
  const camDir = new THREE.Vector3();
  camera.getWorldDirection(camDir);
  const horiz = new THREE.Vector3(camDir.x, 0, camDir.z);
  if (horiz.lengthSq() < 1e-6) {
    horiz.set(Math.sin(playerBody.rotation.y), 0, Math.cos(playerBody.rotation.y));
  }
  horiz.normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const c = 0.70710678; // cos(45) = sin(45)
  const shotDir = new THREE.Vector3(
    horiz.x * c + up.x * c,
    horiz.y * c + up.y * c,
    horiz.z * c + up.z * c
  ).normalize();

  // Spawn slightly in front of the player along the aim, raised a bit
  disc.position.copy(start.clone().add(shotDir.clone().multiplyScalar(0.8)));
  disc.position.y = Math.max(disc.position.y, 0.9);
  scene.add(disc);

  const speed = 9; // 10% slower
  const velocity = shotDir.multiplyScalar(speed);
  projectiles.push({ mesh: disc, velocity });

  inventory -= 1;
  if (inventoryEl) inventoryEl.textContent = inventory;
  updateHeldStack();
}

function resetGame() {
  // Clear projectiles
  projectiles.forEach(p => scene.remove(p.mesh));
  projectiles = [];
  // Clear field discs
  discsOnField.forEach(d => scene.remove(d));
  discsOnField = [];
  // Respawn discs
  scatterDiscs(12);
  // Reset player
  playerBody.position.set(0, PLAYER_HEIGHT / 2, 4);
  player.velocity.set(0, 0, 0);
  // Clear input states to avoid stuck movement after reset
  for (const k in keys) keys[k] = false;
  isRightMouseDown = false;
  // HUD
  inventory = 0; if (inventoryEl) inventoryEl.textContent = inventory; updateHeldStack();
  score = 0; scoreEl.textContent = score;
  finished = false; runStartTime = null; runElapsedMs = 0;
  if (timerEl) timerEl.textContent = formatTime(0);
  if (endOverlayEl) endOverlayEl.classList.add('hidden');
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.033, clock.getDelta());

  updatePlayer(dt);
  updateProjectiles(dt);
  updateChaseCamera(dt);
  updateTimerDisplay();

  renderer.render(scene, camera);
}

function updatePlayer(dt) {
  const dir = new THREE.Vector3();
  if (keys['w'] || keys['arrowup']) dir.z += 1;   // forward
  if (keys['s'] || keys['arrowdown']) dir.z -= 1; // backward
  if (keys['a'] || keys['arrowleft']) dir.x -= 1; // left (flipped)
  if (keys['d'] || keys['arrowright']) dir.x += 1; // right (flipped)

  if (dir.lengthSq() > 0) {
    dir.normalize();
    // Use camera-relative movement for intuitive controls
    const camForward = new THREE.Vector3();
    camera.getWorldDirection(camForward);
    camForward.y = 0; camForward.normalize();
    // Right-hand basis: right = forward x up
    const camRight = new THREE.Vector3().crossVectors(camForward, new THREE.Vector3(0, 1, 0)).normalize();
    const move = new THREE.Vector3()
      .add(camForward.multiplyScalar(dir.z))
      .add(camRight.multiplyScalar(dir.x))
      .normalize()
      .multiplyScalar(player.speed);
    player.velocity.x = move.x;
    player.velocity.z = move.z;
    ensureRunStarted();
  } else {
    // Friction
    const decay = Math.max(0, 1 - player.friction * dt);
    player.velocity.x *= decay;
    player.velocity.z *= decay;
    if (player.velocity.length() < 0.02) player.velocity.set(0, 0, 0);
  }

  // Integrate
  playerBody.position.addScaledVector(player.velocity, dt);
  playerBody.position.y = PLAYER_HEIGHT / 2;

  // Clamp to field
  playerBody.position.x = THREE.MathUtils.clamp(playerBody.position.x, -fieldBounds.halfWidth + PLAYER_RADIUS, fieldBounds.halfWidth - PLAYER_RADIUS);
  playerBody.position.z = THREE.MathUtils.clamp(playerBody.position.z, -fieldBounds.halfLength + PLAYER_RADIUS, fieldBounds.halfLength - PLAYER_RADIUS);

  // Face movement direction with smoothed yaw to prevent jitter
  if (player.velocity.lengthSq() > 0.001) {
    // Rotate player to match camera facing while moving
    const targetYaw = camYaw;
    const t = 1 - Math.pow(TURN_SMOOTH_BASE, dt);
    playerBody.rotation.y = lerpAngle(playerBody.rotation.y, targetYaw, t);
  }
}

function updateChaseCamera(dt) {
  const camDistance = 6.0;
  // Normalize camYaw to prevent numeric creep
  if (camYaw > Math.PI) camYaw -= Math.PI * 2;
  if (camYaw < -Math.PI) camYaw += Math.PI * 2;
  // Direction from player toward where camera looks
  // Build direction where the camera is looking.
  // camPitch: 0 = horizontal; + tilts downward toward ground.
  const dir = new THREE.Vector3(
    Math.sin(camYaw) * Math.cos(camPitch),
    -Math.sin(camPitch),
    Math.cos(camYaw) * Math.cos(camPitch)
  ).normalize();
  const desired = playerBody.position.clone().sub(dir.clone().multiplyScalar(camDistance));
  // Keep camera above ground (slight epsilon)
  desired.y = Math.max(0.05, desired.y);
  // Remove damping: snap camera directly to desired position
  camera.position.copy(desired);
  const focus = playerBody.position.clone().add(new THREE.Vector3(0, PLAYER_HEIGHT * 0.6, 0));
  camera.lookAt(focus);
}

function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    // Integrate with gravity
    p.velocity.y -= GRAVITY * dt;
    p.mesh.position.addScaledVector(p.velocity, dt);

    // Air drag (horizontal only)
    const drag = Math.max(0, 1 - AIR_DRAG * dt);
    p.velocity.x *= drag;
    p.velocity.z *= drag;

    // Bounce off bounds
    const px = p.mesh.position.x;
    const pz = p.mesh.position.z;
    let bounced = false;
    if (px < -fieldBounds.halfWidth + 0.4) { p.mesh.position.x = -fieldBounds.halfWidth + 0.4; p.velocity.x *= -WALL_BOUNCE; bounced = true; }
    if (px > fieldBounds.halfWidth - 0.4)  { p.mesh.position.x = fieldBounds.halfWidth - 0.4;  p.velocity.x *= -WALL_BOUNCE; bounced = true; }
    if (pz < -fieldBounds.halfLength + 0.4) { p.mesh.position.z = -fieldBounds.halfLength + 0.4; p.velocity.z *= -WALL_BOUNCE; bounced = true; }
    if (pz > fieldBounds.halfLength - 0.4)  { p.mesh.position.z = fieldBounds.halfLength - 0.4;  p.velocity.z *= -WALL_BOUNCE; bounced = true; }
    if (bounced) p.velocity.multiplyScalar(0.9);

    // Ground collision
    const yMin = 0.11;
    if (p.mesh.position.y < yMin) {
      p.mesh.position.y = yMin;
      if (Math.abs(p.velocity.y) > 0.5) {
        p.velocity.y *= -DISC_BOUNCE;
        // friction on ground contact
        p.velocity.x *= 0.75;
        p.velocity.z *= 0.75;
      } else {
        p.velocity.y = 0;
      }
    }

    // Rolling friction and visual roll when on/near ground
    const onGround = p.mesh.position.y <= yMin + 1e-3 && Math.abs(p.velocity.y) < 1e-3;
    if (onGround) {
      const frictionFactor = Math.max(0, 1 - GROUND_FRICTION * dt);
      p.velocity.x *= frictionFactor;
      p.velocity.z *= frictionFactor;

      // Visual roll based on horizontal speed
      const vx = p.velocity.x, vz = p.velocity.z;
      const speedH = Math.hypot(vx, vz);
      if (speedH > 1e-4) {
        const radius = 0.35;
        const roll = (speedH / radius) * dt; // radians
        const axis = new THREE.Vector3(-vz, 0, vx).normalize();
        p.mesh.rotateOnAxis(axis, roll);
      }
    }

    // Goal detection: interior cylinder under each rim
    const pos = p.mesh.position;
    let scored = false;
    for (let g = 0; g < highGoalZones.length; g++) {
      const zone = highGoalZones[g];
      const dx = pos.x - zone.center.x;
      const dz = pos.z - zone.center.z;
      const radial = Math.sqrt(dx * dx + dz * dz);
      if (radial <= zone.innerRadius && pos.y >= zone.yMin && pos.y <= zone.yMax) {
        scored = true;
        break;
      }
    }
    if (scored) {
      score += 1;
      scoreEl.textContent = score;
      scene.remove(p.mesh);
      projectiles.splice(i, 1);
      if (score >= 12 && !finished) {
        finishRun();
      }
      continue;
    }

    // Convert to ground disc if very slow and on ground (so it can be picked up)
    if (p.velocity.lengthSq() < 0.05 && p.mesh.position.y <= yMin + 0.001) {
      // Stop moving and become a pickup disc
      p.velocity.set(0, 0, 0);
      discsOnField.push(p.mesh);
      projectiles.splice(i, 1);
      continue;
    }
  }
}

function showGoalOverlay() {
  // Disabled: no full-screen goal overlay
  if (!overlayEl) return;
  if (!overlayEl.classList.contains('hidden')) overlayEl.classList.add('hidden');
}

function randInRange(min, max) {
  return Math.random() * (max - min) + min;
}

function lerpAngle(a, b, t) {
  // Wrap to [-PI, PI]
  let diff = (b - a + Math.PI) % (Math.PI * 2);
  if (diff < 0) diff += Math.PI * 2;
  diff -= Math.PI;
  return a + diff * t;
}

function showLibError() {
  const overlay = document.createElement('div');
  overlay.style.position = 'fixed';
  overlay.style.inset = '0';
  overlay.style.display = 'grid';
  overlay.style.placeItems = 'center';
  overlay.style.background = 'rgba(0,0,0,0.6)';
  overlay.style.color = '#fff';
  overlay.style.fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif";
  overlay.style.zIndex = '9999';
  overlay.innerHTML = '<div style="background: rgba(20,26,38,0.95); border: 1px solid rgba(255,255,255,0.12); border-radius: 14px; padding: 20px 24px; text-align:center; max-width: 520px;">\
  <h2 style="margin:0 0 8px; color:#7ccfff;">Three.js failed to load</h2>\
  <div style="opacity:0.9;">Check your internet connection or CDN access.\
  <div style=\"margin-top:10px\">If you are offline, we can switch to local files.</div></div></div>';
  document.body.appendChild(overlay);
}

function ensureRunStarted() {
  if (finished) return;
  if (runStartTime == null) runStartTime = performance.now();
}

function formatTime(ms) {
  const total = Math.max(0, Math.floor(ms));
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const mm = String(m);
  const ss = String(s).padStart(2, '0');
  const ms3 = String(total % 1000).padStart(3, '0');
  return `${mm}:${ss}.${ms3}`;
}

async function finishRun() {
  finished = true;
  const end = performance.now();
  const elapsed = runStartTime == null ? 0 : Math.floor(end - runStartTime);
  runElapsedMs = elapsed;
  let username = (typeof window !== 'undefined' && window.localStorage && localStorage.getItem('username')) || '';
  try {
    const input = prompt('Enter username for leaderboard', username || 'Player');
    if (input !== null) {
      username = String(input).trim() || 'Anonymous';
      if (window.localStorage) localStorage.setItem('username', username);
    } else if (!username) {
      username = 'Anonymous';
    }
  } catch {
    username = username || 'Anonymous';
  }

  let summary = `Time: ${formatTime(elapsed)}`;
  try {
    if (window.Leaderboard && window.Leaderboard.ready) {
      const { rank } = await window.Leaderboard.submitRun(username, elapsed);
      if (typeof rank === 'number' && isFinite(rank)) {
        summary += ` — Placed #${rank}`;
      } else {
        // Prefer cached full leaderboard if available
        try {
          const getAll = window.Leaderboard && typeof window.Leaderboard.getAllRows === 'function' ? window.Leaderboard.getAllRows : null;
          const rows = getAll ? getAll() : null;
          if (Array.isArray(rows) && rows.length > 0) {
            let faster = 0;
            for (let i = 0; i < rows.length; i++) {
              const t = rows[i] && rows[i].timeMs;
              if (typeof t === 'number' && t < elapsed) faster += 1;
            }
            const place = faster + 1;
            if (place > 0 && isFinite(place)) summary += ` — Placed #${place}`;
          } else {
            // Final fallback: compute rank via RTDB REST if available
            const cfg = (window && window.FIREBASE_CONFIG) || {};
            if (cfg.databaseURL) {
              try {
                const orderBy = encodeURIComponent('"timeMs"');
                const url = `${cfg.databaseURL.replace(/\/$/, '')}/runs.json?orderBy=${orderBy}&endAt=${elapsed}`;
                const resp = await fetch(url);
                const data = await resp.json();
                let faster = 0;
                if (data && typeof data === 'object') {
                  Object.values(data).forEach((val) => {
                    if (val && typeof val.timeMs === 'number' && val.timeMs < elapsed) faster += 1;
                  });
                }
                const place = faster + 1;
                if (place > 0 && isFinite(place)) summary += ` — Placed #${place}`;
              } catch (_) {
                // ignore; show time only
              }
            }
          }
        } catch (_) {
          // ignore; show time only
        }
      }
    }
  } catch (e) {
    console.warn('Submit failed', e);
  }

  if (endSummaryEl && endOverlayEl) {
    endSummaryEl.textContent = summary;
    endOverlayEl.classList.remove('hidden');
  }
}

function updateTimerDisplay() {
  if (!timerEl) return;
  let ms = 0;
  if (finished) {
    ms = runElapsedMs;
  } else if (runStartTime != null) {
    ms = Math.floor(performance.now() - runStartTime);
  }
  timerEl.textContent = formatTime(ms);
}


