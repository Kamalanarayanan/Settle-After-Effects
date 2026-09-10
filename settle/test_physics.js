const physics = require('./client/js/physics.js');

let pass = 0;
let fail = 0;

function check(label, condition, detail) {
  if (condition) {
    pass++;
    console.log('  PASS  ' + label + (detail ? '  (' + detail + ')' : ''));
  } else {
    fail++;
    console.log('  FAIL  ' + label + (detail ? '  (' + detail + ')' : ''));
  }
}

function base(overrides) {
  return Object.assign({
    width: 500,
    height: 500,
    fps: 30,
    duration: 2,
    gravity: 981,
    gravityX: 0,
    gravityY: 1,
    wind: 0,
    substeps: 4,
    walls: 'none',
    positionIterations: 8,
    velocityIterations: 6,
    sleeping: false
  }, overrides || {});
}

function dynamic(overrides) {
  return Object.assign({
    index: 1,
    name: 'Dynamic',
    bodyType: 'dynamic',
    preset: 'Custom',
    shape: 'circle',
    color: '#78dec4',
    x: 250,
    y: 50,
    width: 40,
    height: 40,
    density: 1,
    bounce: 0.2,
    friction: 0.2,
    airDrag: 0.01,
    gravityScale: 1,
    velocityX: 0,
    velocityY: 0,
    angularVelocity: 0,
    fixedRotation: false
  }, overrides || {});
}

function passive(overrides) {
  return Object.assign({
    index: 2,
    name: 'Passive',
    bodyType: 'static',
    preset: 'Passive surface',
    shape: 'box',
    color: '#efb34d',
    x: 250,
    y: 450,
    width: 500,
    height: 40,
    bounce: 0.1,
    friction: 0.5
  }, overrides || {});
}

console.log('\n1. Dynamic and Passive collision');
let result = physics.simulate(base({ bodies: [dynamic({ bounce: 0.7 }), passive()] }));
let ball = result.bodies[0];
let maxY = Math.max.apply(null, ball.positions.map(p => p[1]));
check('returns one sample per frame plus the initial state', ball.positions.length === 61, ball.positions.length + ' samples');
check('Passive floor stops the Dynamic body', maxY < 412, 'lowest centre ' + maxY.toFixed(2));
check('the collision produces a bounce', ball.positions[ball.positions.length - 1][1] < maxY - 10);

console.log('\n2. Balloon preset');
result = physics.simulate(base({
  duration: 2.5,
  bodies: [
    dynamic({
      name: 'Balloon', y: 330, width: 50, height: 50,
      density: 0.15, bounce: 0.72, friction: 0.08,
      airDrag: 0.045, gravityScale: -0.35
    }),
    passive({ name: 'Ceiling box', y: 150, height: 20 })
  ]
}));
let balloon = result.bodies[0];
let minY = Math.min.apply(null, balloon.positions.map(p => p[1]));
check('negative gravity makes Balloon rise', balloon.positions[15][1] < balloon.positions[0][1]);
check('Balloon reacts to the Passive ceiling', minY > 183, 'highest centre ' + minY.toFixed(2));

console.log('\n3. Per-body gravity control');
result = physics.simulate(base({
  duration: 1,
  bodies: [dynamic({ gravityScale: 0, airDrag: 0 }), passive()]
}));
ball = result.bodies[0];
check('gravity scale zero keeps an idle body in place', Math.abs(ball.positions[ball.positions.length - 1][1] - 50) < 0.01);

console.log('\n4. Kinematic sampling');
const path = [];
for (let f = 0; f <= 30; f++) path.push({ x: 100 + f * 5, y: 250, angle: 0 });
result = physics.simulate(base({
  duration: 1,
  gravity: 0,
  bodies: [
    dynamic({ x: 250, y: 250, gravityScale: 0, airDrag: 0, bounce: 0 }),
    Object.assign(passive({
      index: 2, name: 'Animated pusher', bodyType: 'kinematic',
      x: 100, y: 250, width: 80, height: 100
    }), { path })
  ]
}));
ball = result.bodies[0];
check('Kinematic AE path pushes a Dynamic body', ball.positions[ball.positions.length - 1][0] > 270,
  'final x ' + ball.positions[ball.positions.length - 1][0].toFixed(2));

console.log('\n5. Seeded natural motion');
const organicBalloon = dynamic({
  name: 'Organic Balloon', y: 330, width: 50, height: 50,
  density: 0.12, bounce: 0.68, friction: 0.08, airDrag: 0.055,
  gravityScale: -0.35, naturalMotion: 0.75, turbulence: 90,
  liftVariation: 0.3, wobble: 26, seed: 4242
});
const organicScene = base({
  duration: 2,
  bodies: [organicBalloon, passive({ name: 'Ceiling', y: 80, height: 20 })]
});
const organicA = physics.simulate(organicScene);
const organicB = physics.simulate(organicScene);
const organicDifferent = physics.simulate(base({
  duration: 2,
  bodies: [Object.assign({}, organicBalloon, { seed: 9898 }),
    passive({ name: 'Ceiling', y: 80, height: 20 })]
}));
const organicTrack = organicA.bodies[0].positions;
const organicDifferentTrack = organicDifferent.bodies[0].positions;
const xTravel = Math.max.apply(null, organicTrack.map(p => p[0])) -
  Math.min.apply(null, organicTrack.map(p => p[0]));
check('Natural Motion creates visible lateral drift', xTravel > 5, 'x range ' + xTravel.toFixed(2));
check('the same seed is exactly repeatable',
  JSON.stringify(organicA.bodies[0]) === JSON.stringify(organicB.bodies[0]));
check('a different seed creates a different path',
  Math.abs(organicTrack[organicTrack.length - 1][0] -
           organicDifferentTrack[organicDifferentTrack.length - 1][0]) > 1);

console.log('\n6. Metal collision weight');
function impactScene(hitterDensity) {
  return base({
    width: 900, height: 300, duration: 1.4, gravity: 0,
    bodies: [
      dynamic({
        index: 1, name: 'Hitter', shape: 'box', x: 100, y: 150,
        width: 70, height: 70, density: hitterDensity, bounce: 0.08,
        friction: 0.38, airDrag: 0, gravityScale: 0, velocityX: 320
      }),
      dynamic({
        index: 2, name: 'Plastic target', shape: 'box', x: 260, y: 150,
        width: 70, height: 70, density: 0.7, bounce: 0.2,
        friction: 0.3, airDrag: 0.01, gravityScale: 0
      })
    ]
  });
}
const metalImpact = physics.simulate(impactScene(12));
const plasticImpact = physics.simulate(impactScene(0.7));
const metalTargetX = metalImpact.bodies[1].positions[metalImpact.frameCount][0];
const lightTargetX = plasticImpact.bodies[1].positions[plasticImpact.frameCount][0];
check('Metal transfers more collision momentum than Plastic',
  metalTargetX > lightTargetX + 20,
  'metal target ' + metalTargetX.toFixed(2) + ', light target ' + lightTargetX.toFixed(2));

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
