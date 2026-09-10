// Runs host/index.jsx against a fake After Effects DOM.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ---- fake DOM ---------------------------------------------------------------

class Prop {
  constructor(dims, times, values) {
    this.dims = dims;
    this.times = times.slice();
    this.values = values.slice();
    this.canVaryOverTime = true;
    this.expressionEnabled = false;
    this.dimensionsSeparated = false;
    this.interp = [];
    this.autoBez = [];
  }
  get numKeys() { return this.times.length; }
  get value() { return this.dims === 1 ? this.values[0] : this.values[0].slice(); }
  keyTime(i) { return this.times[i - 1]; }
  keyValue(i) { return this.values[i - 1]; }
  valueAtTime(t) {
    // Linear interpolation between the stored keys, which is what a baked
    // per-frame sim effectively is.
    const T = this.times;
    if (t <= T[0]) return this.values[0];
    if (t >= T[T.length - 1]) return this.values[T.length - 1];
    for (let i = 0; i < T.length - 1; i++) {
      if (t >= T[i] && t <= T[i + 1]) {
        const u = (t - T[i]) / (T[i + 1] - T[i]);
        if (this.dims === 1) return this.values[i] + (this.values[i + 1] - this.values[i]) * u;
        return this.values[i].map((v, d) => v + (this.values[i + 1][d] - v) * u);
      }
    }
    return this.values[0];
  }
  removeKey(i) { this.times.splice(i - 1, 1); this.values.splice(i - 1, 1); }
  setValuesAtTimes(times, values) {
    if (times.length !== values.length) throw new Error('length mismatch');
    this.times = times.slice();
    this.values = values.slice();
  }
  setInterpolationTypeAtKey(i, a) { this.interp[i - 1] = a; }
  setTemporalAutoBezierAtKey(i, b) { this.autoBez[i - 1] = b; }
}

class Layer {
  constructor(name, index, opts = {}) {
    this.name = name;
    this.index = index;
    this.enabled = true;
    this.threeDLayer = !!opts.threeD;
    this.comment = opts.comment || '';
    this.parent = opts.parent || null;
    this.inPoint = 0;
    this.outPoint = 6;
    this.motionBlur = false;
    this._rect = opts.rect || { top: -50, left: -50, width: 100, height: 100 };
    this._anchor = opts.anchor || [0, 0];
    this._props = {
      'ADBE Position': opts.position || new Prop(2, [0], [[0, 0]]),
      'ADBE Rotate Z': opts.rotation || new Prop(1, [0], [0]),
      'ADBE Anchor Point': new Prop(2, [0], [this._anchor]),
      'ADBE Scale': new Prop(2, [0], [[100, 100]])
    };
  }
  sourceRectAtTime() { return this._rect; }
  property(n) {
    if (n === 'ADBE Transform Group') return { property: (k) => this._props[k] };
    return this._props[n];
  }
}

function makeComp(fps, layers) {
  const markers = { numKeys: 0, keys: [], keyValue(i) { return this.keys[i - 1]; },
    removeKey(i) { this.keys.splice(i - 1, 1); this.numKeys--; },
    setValueAtTime(t, v) { this.keys.push(v); this.numKeys++; } };
  return {
    name: 'TEST_COMP', width: 1920, height: 1080, pixelAspect: 1,
    frameRate: fps, frameDuration: 1 / fps, duration: 6,
    workAreaStart: 0, workAreaDuration: 6, motionBlur: false,
    shutterAngle: 180, shutterPhase: -90, time: 0,
    numLayers: layers.length,
    layer(i) { return layers[i - 1]; },
    selectedLayers: layers,
    markerProperty: markers,
    __isComp: true
  };
}

// ---- sandbox ----------------------------------------------------------------

let COMP = null;
const sandbox = {
  CompItem: function () {}, CameraLayer: function () {}, LightLayer: function () {},
  ShapeLayer: function () {}, TextLayer: function () {},
  KeyframeInterpolationType: { BEZIER: 'bez', LINEAR: 'lin' },
  MarkerValue: function (c) { this.comment = c; this.duration = 0; },
  app: {
    version: '26.0',
    project: { get activeItem() { return COMP; } },
    beginUndoGroup(n) { sandbox.__undo = (sandbox.__undo || 0) + 1; },
    endUndoGroup() { sandbox.__undo--; }
  },
  $: { writeln: console.log }
};
sandbox.global = sandbox;

const ctx = vm.createContext(sandbox);
// activeItem instanceof CompItem must pass for the real code path.
vm.runInContext('CompItem = function(){}; CompItem.prototype = {};', ctx);
const src = fs.readFileSync(path.join(__dirname, 'host', 'index.jsx'), 'utf8');
vm.runInContext(src, ctx);
vm.runInContext('function __mkcomp(o){ var c = new CompItem(); for (var k in o) c[k]=o[k]; return c; }', ctx);

function setComp(raw) {
  sandbox.__raw = raw;
  COMP = vm.runInContext('__mkcomp(__raw)', ctx);
}

function run(expr) { return JSON.parse(vm.runInContext(expr, ctx)); }

// ---- fixtures ---------------------------------------------------------------

function bakedBounce(fps, dur, g, e) {
  const times = [], values = [];
  let y = 100, vy = 0, x = 200, vx = 180;
  const floor = 900, dt = 1 / 240;
  let t = 0;
  const n = Math.round(dur * fps);
  for (let f = 0; f <= n; f++) {
    const target = f / fps;
    while (t < target - 1e-9) {
      vy += g * dt; y += vy * dt; x += vx * dt; t += dt;
      if (y > floor) { y = floor; vy = -vy * e; }
    }
    times.push(f / fps);
    values.push([x, y]);
  }
  return new Prop(2, times, values);
}

let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + label + (detail ? '  (' + detail + ')' : '')); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '  (' + detail + ')' : '')); }
}

// ---- 1. comp facts ----------------------------------------------------------

console.log('\n1. comp facts');
setComp(makeComp(24, [new Layer('A', 1)]));
let r = run('settleComp()');
check('reads the comp', r.ok && r.name === 'TEST_COMP');
check('frame rate', r.frameRate === 24, r.frameRate + ' fps');
check('reports motion blur state', r.motionBlur === false);

COMP = null;
r = run('settleComp()');
check('fails cleanly with no comp', !r.ok && /composition/i.test(r.error));

// ---- 2. audit ---------------------------------------------------------------

console.log('\n2. audit');
const offAnchor = new Layer('OffAnchor', 1, { anchor: [40, 30] });   // centroid 0,0
const threeD = new Layer('ThreeD', 2, { threeD: true });
const keyed = new Layer('Keyed', 3, { position: bakedBounce(24, 2, 2119, 0.6) });
const expr = new Layer('Expr', 4);
expr.property('ADBE Transform Group').property('ADBE Position').expressionEnabled = true;

setComp(makeComp(24, [offAnchor, threeD, keyed, expr]));
r = run('settleAudit("all")');
check('audits every layer', r.ok && r.rows.length === 4);

const byName = {};
r.rows.forEach(x => byName[x.name] = x);
check('measures anchor offset', Math.abs(byName.OffAnchor.anchorOffset - 50) < 0.5,
  byName.OffAnchor.anchorOffset + ' px, expected 50');
check('blocks 3D layers', !!byName.ThreeD.blocked);
check('counts keys at risk', byName.Keyed.posKeys === 49, byName.Keyed.posKeys + ' keys');
check('spots expressions', byName.Expr.hasExpression === true);
check('reads bounds', byName.OffAnchor.width === 100 && byName.OffAnchor.height === 100);

// ---- 3. reduce --------------------------------------------------------------

console.log('\n3. reduce');
const posProp = bakedBounce(24, 6, 2119, 0.6);
const before = posProp.numKeys;
const original = { times: posProp.times.slice(), values: posProp.values.map(v => v.slice()) };
const L = new Layer('Ball', 1, { position: posProp });
setComp(makeComp(24, [L]));

r = run('settleReduce("{\\"tolerance\\":2,\\"position\\":true,\\"rotation\\":false,\\"scale\\":false,\\"smooth\\":false}")');
check('reduce succeeds', r.ok, r.ok ? '' : r.error);
check('cuts keys', r.totalAfter < r.totalBefore, before + ' -> ' + r.totalAfter);
check('honours the tolerance', r.worstError <= 2.0, 'worst error ' + r.worstError + ' px');
check('closes the undo group', sandbox.__undo === 0, 'depth ' + sandbox.__undo);

// Independently verify the surviving curve against the original samples.
let maxDev = 0;
for (let i = 0; i < original.times.length; i++) {
  const got = posProp.valueAtTime(original.times[i]);
  const want = original.values[i];
  const d = Math.hypot(got[0] - want[0], got[1] - want[1]);
  if (d > maxDev) maxDev = d;
}
check('curve holds within tolerance when replayed', maxDev <= 2.0 + 1e-6, 'max deviation ' + maxDev.toFixed(3) + ' px');
check('keys stay time-ordered', posProp.times.every((t, i) => i === 0 || t > posProp.times[i - 1]));
check('key and value counts match', posProp.times.length === posProp.values.length);

// ---- 4. guard rails ---------------------------------------------------------

console.log('\n4. guard rails');
const exprL = new Layer('E', 1);
exprL.property('ADBE Transform Group').property('ADBE Position').expressionEnabled = true;
exprL.property('ADBE Transform Group').property('ADBE Position').times = [0, 1, 2, 3, 4];
exprL.property('ADBE Transform Group').property('ADBE Position').values = [[0,0],[1,1],[2,2],[3,3],[4,4]];
setComp(makeComp(24, [exprL]));
r = run('settleReduce("{\\"tolerance\\":1,\\"position\\":true,\\"rotation\\":false,\\"scale\\":false,\\"smooth\\":false}")');
check('skips expression properties', r.ok && r.report[0].skipped === 'has an expression', r.ok ? r.report[0].skipped : r.error);

const sep = new Layer('S', 1);
const sp = sep.property('ADBE Transform Group').property('ADBE Position');
sp.dimensionsSeparated = true;
sp.times = [0,1,2,3,4]; sp.values = [[0,0],[1,1],[2,2],[3,3],[4,4]];
setComp(makeComp(24, [sep]));
r = run('settleReduce("{\\"tolerance\\":1,\\"position\\":true,\\"rotation\\":false,\\"scale\\":false,\\"smooth\\":false}")');
check('skips separated dimensions', r.ok && r.report[0].skipped === 'dimensions are separated');

setComp(makeComp(24, []));
r = run('settleReduce("{\\"tolerance\\":1,\\"position\\":true,\\"rotation\\":false,\\"scale\\":false,\\"smooth\\":false}")');
check('refuses with nothing selected', !r.ok && /[Ss]elect/.test(r.error));

// 1D rotation
const rotProp = new Prop(1, [], []);
for (let f = 0; f <= 96; f++) { rotProp.times.push(f / 24); rotProp.values.push(f < 48 ? f * 7.5 : 360); }
const rl = new Layer('R', 1, { rotation: rotProp });
setComp(makeComp(24, [rl]));
r = run('settleReduce("{\\"tolerance\\":0.5,\\"position\\":false,\\"rotation\\":true,\\"scale\\":false,\\"smooth\\":true}")');
check('handles 1D rotation', r.ok && r.totalAfter <= 4, r.ok ? '97 -> ' + r.totalAfter + ' keys' : r.error);
check('writes plain numbers, not arrays', typeof rotProp.values[0] === 'number', typeof rotProp.values[0]);
check('applies bezier when smoothing', rotProp.interp[0] === 'bez');

// ---- 5. marker round trip ---------------------------------------------------

console.log('\n5. comp marker round trip');
setComp(makeComp(24, [new Layer('A', 1)]));
r = run('settleSaveSetup("{\\"worldH\\":8,\\"fallT\\":2}")');
check('saves', r.ok);
r = run('settleLoadSetup()');
check('loads back', r.ok && r.found && JSON.parse(r.payload).worldH === 8, r.found ? r.payload : 'not found');
run('settleSaveSetup("{\\"worldH\\":3}")');
r = run('settleLoadSetup()');
check('overwrites rather than stacking', JSON.parse(r.payload).worldH === 3 && COMP.markerProperty.numKeys === 1,
  COMP.markerProperty.numKeys + ' marker(s)');

// ---- 6. physics body round trip and bake -----------------------------------

console.log('\n6. physics body setup');
const ballBody = new Layer('Balloon', 1, {
  rect: { top: -25, left: -25, width: 50, height: 50 },
  position: new Prop(2, [0], [[200, 300]])
});
const floorBody = new Layer('Floor', 2, {
  rect: { top: -20, left: -300, width: 600, height: 40 },
  position: new Prop(2, [0], [[300, 500]])
});
setComp(makeComp(24, [ballBody, floorBody]));

COMP.selectedLayers = [ballBody];
const balloonConfig = {
  bodyType: 'dynamic', preset: 'Balloon', color: '#cf78df', shape: 'circle',
  density: 0.15, bounce: 0.72, friction: 0.08, airDrag: 0.045,
  gravityScale: -0.35, velocityX: 0, velocityY: 0,
  angularVelocity: 0, fixedRotation: false,
  naturalMotion: 0.75, turbulence: 90, liftVariation: 0.3,
  wobble: 26, seed: 4242
};
r = run('settleApplyBody(' + JSON.stringify(JSON.stringify(balloonConfig)) + ')');
check('assigns a Dynamic preset', r.ok && r.count === 1, r.ok ? ballBody.comment : r.error);

COMP.selectedLayers = [floorBody];
const floorConfig = {
  bodyType: 'static', preset: 'Passive surface', color: '#efb34d', shape: 'box',
  density: 1, bounce: 0.1, friction: 0.6, airDrag: 0,
  gravityScale: 0, velocityX: 0, velocityY: 0,
  angularVelocity: 0, fixedRotation: true
};
r = run('settleApplyBody(' + JSON.stringify(JSON.stringify(floorConfig)) + ')');
check('assigns a Passive body', r.ok && r.count === 1);

r = run('settleBodyList()');
check('lists both configured bodies', r.ok && r.rows.length === 2, r.ok ? r.rows.length + ' bodies' : r.error);

r = run('settlePhysicsScene(' + JSON.stringify(JSON.stringify({
  durationMode: 'workarea', gravity: 981, gravityX: 0, gravityY: 1,
  wind: 0, substeps: 4, walls: 'none'
})) + ')');
check('exports a physics scene', r.ok && r.scene.bodies.length === 2, r.ok ? r.scene.bodies.length + ' bodies' : r.error);
check('preserves negative per-body gravity', r.ok && r.scene.bodies[0].gravityScale === -0.35);
check('preserves seeded natural motion',
  r.ok && r.scene.bodies[0].naturalMotion === 0.75 &&
  r.scene.bodies[0].turbulence === 90 && r.scene.bodies[0].seed === 5251);
check('exports layer dimensions', r.ok && r.scene.bodies[0].width === 50 && r.scene.bodies[1].width === 600);

const bakePayload = {
  start: 0,
  frameDuration: 1 / 24,
  motionBlur: true,
  bodies: [{
    index: 1,
    name: 'Balloon',
    positions: [[200, 300], [200, 290], [200, 278]],
    rotations: [0, 2, 4]
  }]
};
r = run('settleBake(' + JSON.stringify(JSON.stringify(bakePayload)) + ')');
check('bakes simulated positions and rotations', r.ok && r.layers === 1 && r.keys === 6, r.ok ? r.keys + ' keys' : r.error);
check('enables motion blur when requested', COMP.motionBlur === true && ballBody.motionBlur === true);
check('bake is one closed undo group', sandbox.__undo === 0, 'depth ' + sandbox.__undo);

COMP.selectedLayers = [ballBody];
r = run('settleRemoveBody()');
check('removes body settings without touching other comments', r.ok && !/SETTLE_BODY/.test(ballBody.comment));

// ---- 7. JSON escaping -------------------------------------------------------

console.log('\n7. serialising');
setComp(makeComp(24, [new Layer('quote " back\\slash \t tab', 1)]));
r = run('settleAudit("all")');
check('escapes hostile layer names', r.ok && r.rows[0].name === 'quote " back\\slash \t tab', r.ok ? JSON.stringify(r.rows[0].name) : r.error);

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
