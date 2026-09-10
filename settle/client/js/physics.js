/*
 * Settle physics core.
 *
 * Browser: exposes window.SettlePhysics and uses the bundled Matter global.
 * Tests:   module.exports = factory(require('./matter.min.js')).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./matter.min.js'));
  } else {
    root.SettlePhysics = factory(root.Matter);
  }
}(this, function (Matter) {
  'use strict';

  if (!Matter) throw new Error('Settle requires Matter.js.');

  var Engine = Matter.Engine;
  var Bodies = Matter.Bodies;
  var Body = Matter.Body;
  var Composite = Matter.Composite;

  function number(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : fallback;
  }

  function clamp(value, low, high) {
    return Math.max(low, Math.min(high, number(value, low)));
  }

  function radians(degrees) {
    return degrees * Math.PI / 180;
  }

  function degrees(radiansValue) {
    return radiansValue * 180 / Math.PI;
  }

  function lerp(a, b, u) {
    return a + (b - a) * u;
  }

  function seededValue(seed, index) {
    var x = Math.sin((seed + index * 1013.17) * 12.9898) * 43758.5453;
    return (x - Math.floor(x)) * 2 - 1;
  }

  // Value noise with a smoothstep blend. Unlike frame-by-frame randomness this
  // produces slow, organic forces without jitter, and the same seed always
  // produces the same preview and bake.
  function smoothNoise(seed, x) {
    var i = Math.floor(x);
    var u = x - i;
    u = u * u * (3 - 2 * u);
    return lerp(seededValue(seed, i), seededValue(seed, i + 1), u);
  }

  function pathState(path, frameFloat) {
    if (!path || !path.length) return null;
    if (frameFloat <= 0) return path[0];
    if (frameFloat >= path.length - 1) return path[path.length - 1];
    var i = Math.floor(frameFloat);
    var u = frameFloat - i;
    var a = path[i];
    var b = path[i + 1];
    return {
      x: lerp(a.x, b.x, u),
      y: lerp(a.y, b.y, u),
      angle: lerp(a.angle, b.angle, u)
    };
  }

  function createBody(spec) {
    var options = {
      label: spec.name || ('Layer ' + spec.index),
      isStatic: spec.bodyType === 'static' || spec.bodyType === 'kinematic',
      angle: radians(number(spec.angle, 0)),
      friction: clamp(spec.friction, 0, 1),
      frictionStatic: clamp(number(spec.frictionStatic, 0.5), 0, 10),
      frictionAir: clamp(spec.airDrag, 0, 0.25),
      restitution: clamp(spec.bounce, 0, 1),
      slop: 0.02
    };

    var width = Math.max(2, number(spec.width, 40));
    var height = Math.max(2, number(spec.height, 40));
    var x = number(spec.x, 0);
    var y = number(spec.y, 0);
    var body;

    if (spec.shape === 'circle') {
      body = Bodies.circle(x, y, Math.max(1, Math.min(width, height) / 2), options);
    } else {
      body = Bodies.rectangle(x, y, width, height, options);
    }

    // Matter makes static bodies maximally rough and non-bouncy internally.
    // Restore the authored surface values so a Passive floor can still be ice,
    // rubber, wood, and so on.
    if (options.isStatic) {
      body.friction = options.friction;
      body.frictionStatic = options.frictionStatic;
      body.restitution = options.restitution;
    }

    if (!options.isStatic) {
      Body.setDensity(body, Math.max(0.00001, number(spec.density, 1) * 0.001));
      if (spec.fixedRotation === true) Body.setInertia(body, Infinity);
      Body.setVelocity(body, {
        x: number(spec.velocityX, 0) / 60,
        y: number(spec.velocityY, 0) / 60
      });
      Body.setAngularVelocity(body, radians(number(spec.angularVelocity, 0)) / 60);
    }

    body.plugin.settle = {
      index: spec.index,
      name: spec.name,
      preset: spec.preset,
      bodyType: spec.bodyType,
      shape: spec.shape,
      color: spec.color || '#8ed9c8',
      gravityScale: number(spec.gravityScale, 1),
      naturalMotion: clamp(spec.naturalMotion, 0, 1),
      turbulence: Math.max(0, number(spec.turbulence, 0)),
      liftVariation: Math.max(0, number(spec.liftVariation, 0)),
      wobble: Math.max(0, number(spec.wobble, 0)),
      seed: Math.floor(number(spec.seed, 1337)),
      path: spec.path || null,
      offsetX: number(spec.offsetX, 0),
      offsetY: number(spec.offsetY, 0)
    };
    return body;
  }

  function createWalls(scene, mode) {
    if (mode === 'none') return [];
    var width = number(scene.width, 1920);
    var height = number(scene.height, 1080);
    var thick = Math.max(width, height) * 0.08 + 20;
    var wallOptions = { isStatic: true, friction: 0.5, restitution: 0.2, label: 'Comp wall' };
    var walls = [Bodies.rectangle(width / 2, height + thick / 2, width + thick * 2, thick, wallOptions)];
    if (mode === 'all') {
      walls.push(Bodies.rectangle(width / 2, -thick / 2, width + thick * 2, thick, wallOptions));
      walls.push(Bodies.rectangle(-thick / 2, height / 2, thick, height + thick * 2, wallOptions));
      walls.push(Bodies.rectangle(width + thick / 2, height / 2, thick, height + thick * 2, wallOptions));
    }
    return walls;
  }

  function capture(body) {
    return {
      x: body.position.x,
      y: body.position.y,
      angle: degrees(body.angle)
    };
  }

  function simulate(scene) {
    if (!scene || !scene.bodies || !scene.bodies.length) {
      throw new Error('No configured bodies were found.');
    }

    var fps = Math.max(1, number(scene.fps, 24));
    var duration = Math.max(1 / fps, number(scene.duration, 1));
    var frameCount = Math.max(1, Math.round(duration * fps));
    var substeps = Math.round(clamp(scene.substeps, 1, 12));
    var delta = 1000 / fps / substeps;
    var gravity = number(scene.gravity, 981);
    var gravityX = number(scene.gravityX, 0);
    var gravityY = number(scene.gravityY, 1);
    var mag = Math.sqrt(gravityX * gravityX + gravityY * gravityY) || 1;
    gravityX /= mag;
    gravityY /= mag;

    var engine = Engine.create({ enableSleeping: scene.sleeping !== false });
    engine.positionIterations = Math.round(clamp(scene.positionIterations, 4, 12));
    engine.velocityIterations = Math.round(clamp(scene.velocityIterations, 3, 10));
    engine.constraintIterations = 2;
    engine.gravity.x = gravityX;
    engine.gravity.y = gravityY;
    engine.gravity.scale = gravity / 1000000;

    var records = [];
    var matterBodies = [];
    var dynamicCount = 0;
    for (var i = 0; i < scene.bodies.length; i++) {
      var spec = scene.bodies[i];
      var matterBody = createBody(spec);
      matterBodies.push(matterBody);
      records.push({
        index: spec.index,
        name: spec.name,
        preset: spec.preset,
        bodyType: spec.bodyType,
        shape: spec.shape,
        width: spec.width,
        height: spec.height,
        color: spec.color || '#8ed9c8',
        offsetX: number(spec.offsetX, 0),
        offsetY: number(spec.offsetY, 0),
        positions: [],
        angles: []
      });
      if (spec.bodyType === 'dynamic') dynamicCount++;
    }

    if (!dynamicCount) throw new Error('Assign at least one layer as Dynamic.');

    Composite.add(engine.world, matterBodies.concat(createWalls(scene, scene.walls || 'none')));

    function captureFrame() {
      for (var c = 0; c < matterBodies.length; c++) {
        var state = capture(matterBodies[c]);
        records[c].positions.push([state.x, state.y]);
        records[c].angles.push(state.angle);
      }
    }

    captureFrame();
    for (var frame = 1; frame <= frameCount; frame++) {
      for (var sub = 0; sub < substeps; sub++) {
        var frameFloat = (frame - 1) + (sub + 1) / substeps;
        var timeSeconds = frameFloat / fps;

        for (var b = 0; b < matterBodies.length; b++) {
          var body = matterBodies[b];
          var meta = body.plugin.settle;

          if (meta.bodyType === 'kinematic') {
            var ks = pathState(meta.path, frameFloat);
            if (ks) {
              Body.setPosition(body, { x: ks.x, y: ks.y }, true);
              Body.setAngle(body, radians(ks.angle), true);
            }
            continue;
          }

          if (meta.bodyType !== 'dynamic') continue;

          // Matter applies the global gravity inside Engine.update. This adds
          // only the difference needed for per-body gravity, including zero or
          // negative values for floating and balloon presets.
          var liftNoise = meta.naturalMotion * meta.liftVariation *
            smoothNoise(meta.seed + 31, timeSeconds * 0.42);
          var effectiveGravityScale = meta.gravityScale * (1 + liftNoise);
          var gravityDifference = effectiveGravityScale - 1;
          if (gravityDifference !== 0) {
            Body.applyForce(body, body.position, {
              x: body.mass * engine.gravity.x * engine.gravity.scale * gravityDifference,
              y: body.mass * engine.gravity.y * engine.gravity.scale * gravityDifference
            });
          }

          if (meta.naturalMotion > 0 && meta.turbulence > 0) {
            var drift = meta.turbulence * meta.naturalMotion * (
              smoothNoise(meta.seed + 71, timeSeconds * 0.55) * 0.72 +
              smoothNoise(meta.seed + 211, timeSeconds * 1.13) * 0.28
            );
            Body.applyForce(body, body.position, {
              x: body.mass * drift / 1000000,
              y: 0
            });
          }

          if (meta.naturalMotion > 0 && meta.wobble > 0 &&
              body.inertia !== Infinity) {
            var angularAcceleration = radians(meta.wobble) * meta.naturalMotion *
              smoothNoise(meta.seed + 401, timeSeconds * 0.68);
            body.torque += body.inertia * angularAcceleration / 1000000;
          }

          var wind = number(scene.wind, 0);
          if (wind !== 0) {
            Body.applyForce(body, body.position, {
              x: body.mass * wind / 1000000,
              y: 0
            });
          }
        }

        Engine.update(engine, delta);
      }
      captureFrame();
    }

    return {
      start: number(scene.start, 0),
      fps: fps,
      frameDuration: 1 / fps,
      frameCount: frameCount,
      width: scene.width,
      height: scene.height,
      bodies: records
    };
  }

  return {
    simulate: simulate,
    _pathState: pathState,
    _createBody: createBody,
    _smoothNoise: smoothNoise
  };
}));
