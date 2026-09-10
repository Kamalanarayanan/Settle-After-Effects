(function () {
  'use strict';

  var csi = new CSInterface();
  var isCEP = typeof window.__adobe_cep__ !== 'undefined';
  var activeRole = 'dynamic';
  var activePreset = 'balloon';
  var comp = null;
  var simulation = null;
  var playing = false;
  var playStartedAt = 0;
  var playStartFrame = 0;

  var PRESETS = {
    balloon: {
      label: 'Balloon', color: '#cf78df', shape: 'circle',
      density: 0.12, bounce: 0.68, friction: 0.08, airDrag: 0.055,
      gravityScale: -0.35, fixedRotation: false,
      naturalMotion: 0.75, turbulence: 90, liftVariation: 0.3, wobble: 26,
      motionHelp: 'Smooth air drift, changing lift, and wobble'
    },
    rubber: {
      label: 'Rubber', color: '#e95658', shape: 'circle',
      density: 0.9, bounce: 0.86, friction: 0.45, airDrag: 0.008,
      gravityScale: 1, fixedRotation: false,
      naturalMotion: 0.15, turbulence: 8, liftVariation: 0, wobble: 6,
      motionHelp: 'Small variation keeps repeated bounces from matching'
    },
    plastic: {
      label: 'Plastic', color: '#58aaf0', shape: 'box',
      density: 0.7, bounce: 0.34, friction: 0.32, airDrag: 0.01,
      gravityScale: 1, fixedRotation: false,
      naturalMotion: 0.05, turbulence: 2, liftVariation: 0, wobble: 1,
      motionHelp: 'Very subtle variation'
    },
    metal: {
      label: 'Metal', color: '#aeb4bd', shape: 'box',
      density: 12, bounce: 0.08, friction: 0.38, airDrag: 0,
      gravityScale: 1.08, fixedRotation: false,
      naturalMotion: 0.02, turbulence: 0.5, liftVariation: 0, wobble: 0.5,
      motionHelp: 'Heavy impact with almost no artificial drift'
    },
    wood: {
      label: 'Wood', color: '#bc7c42', shape: 'box',
      density: 0.65, bounce: 0.24, friction: 0.58, airDrag: 0.008,
      gravityScale: 1, fixedRotation: false,
      naturalMotion: 0.06, turbulence: 2, liftVariation: 0, wobble: 2,
      motionHelp: 'Small natural differences'
    },
    ice: {
      label: 'Ice', color: '#8edcf0', shape: 'box',
      density: 0.92, bounce: 0.08, friction: 0.015, airDrag: 0.004,
      gravityScale: 1, fixedRotation: false,
      naturalMotion: 0.03, turbulence: 1, liftVariation: 0, wobble: 1,
      motionHelp: 'Minimal variation while sliding'
    },
    foam: {
      label: 'Foam', color: '#91cb69', shape: 'box',
      density: 0.08, bounce: 0.42, friction: 0.7, airDrag: 0.025,
      gravityScale: 1, fixedRotation: false,
      naturalMotion: 0.3, turbulence: 35, liftVariation: 0.05, wobble: 12,
      motionHelp: 'Light drift and soft rotational variation'
    },
    cardboard: {
      label: 'Cardboard', color: '#b79561', shape: 'box',
      density: 0.25, bounce: 0.12, friction: 0.62, airDrag: 0.018,
      gravityScale: 1, fixedRotation: false,
      naturalMotion: 0.1, turbulence: 6, liftVariation: 0, wobble: 4,
      motionHelp: 'A little drag and unevenness'
    }
  };

  function $(id) { return document.getElementById(id); }

  function call(expression, callback) {
    // A tiny read-only demo response keeps the interface previewable in an
    // ordinary browser during release QA. After Effects always takes the CEP
    // branch below.
    if (!isCEP) {
      var demo = expression.indexOf('settleComp') === 0
        ? { ok: true, name: 'Balloon Demo', width: 1920, height: 1080,
            frameRate: 24, duration: 5, selectedCount: 1 }
        : expression.indexOf('settleBodyList') === 0
          ? { ok: true, rows: [
              { index: 1, name: 'Balloon', bodyType: 'dynamic', preset: 'Balloon', color: '#cf78df' },
              { index: 2, name: 'Box Collider', bodyType: 'static', preset: 'Passive surface', color: '#efb34d' }
            ] }
          : { ok: false, error: 'This action is available inside After Effects.' };
      window.setTimeout(function () { callback(demo); }, 0);
      return;
    }
    csi.evalScript(expression, function (raw) {
      var result;
      try {
        result = JSON.parse(raw);
      } catch (err) {
        result = { ok: false, error: 'After Effects returned an unreadable response.' };
      }
      callback(result);
    });
  }

  function hostCall(name, payload, callback) {
    call(name + '(' + JSON.stringify(JSON.stringify(payload || {})) + ')', callback);
  }

  function showNotice(message, kind) {
    var el = $('notice');
    if (!message) {
      el.hidden = true;
      el.textContent = '';
      el.className = 'notice';
      return;
    }
    el.hidden = false;
    el.textContent = message;
    el.className = 'notice ' + (kind || '');
  }

  function showResult(id, message, kind) {
    var el = $(id);
    el.textContent = message || '';
    el.className = 'result ' + (kind || '');
  }

  function setTabs() {
    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener('click', function () {
        for (var t = 0; t < tabs.length; t++) {
          tabs[t].classList.remove('is-on');
          tabs[t].setAttribute('aria-selected', 'false');
        }
        this.classList.add('is-on');
        this.setAttribute('aria-selected', 'true');

        var panels = document.querySelectorAll('.panel');
        for (var p = 0; p < panels.length; p++) panels[p].classList.remove('is-on');
        $(this.getAttribute('data-panel')).classList.add('is-on');
        if (this.getAttribute('data-panel') === 'simulate') drawPreview();
      });
    }
  }

  function roleLabel(role) {
    if (role === 'static') return 'Passive';
    if (role === 'kinematic') return 'Kinematic';
    return 'Dynamic';
  }

  function selectRole(role) {
    activeRole = role;
    var buttons = document.querySelectorAll('.role');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle('is-on', buttons[i].getAttribute('data-role') === role);
    }

    var help = {
      dynamic: 'Dynamic bodies are fully controlled by physics.',
      static: 'Passive bodies stay fixed and act as floors, walls, or obstacles.',
      kinematic: 'Kinematic bodies follow existing AE animation and can push Dynamic bodies.'
    };
    $('role-help').textContent = help[role];
    $('material-section').style.opacity = role === 'static' ? '0.72' : '1';
    $('natural-motion').disabled = role !== 'dynamic';
    $('new-variation').disabled = role !== 'dynamic';
    updateApplyLabel();
  }

  function selectPreset(name) {
    activePreset = name;
    var buttons = document.querySelectorAll('.preset');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle('is-on', buttons[i].getAttribute('data-preset') === name);
    }
    var preset = PRESETS[name];
    $('shape').value = preset.shape;
    $('density').value = preset.density;
    $('bounce').value = preset.bounce;
    $('friction').value = preset.friction;
    $('air-drag').value = preset.airDrag;
    $('gravity-scale').value = preset.gravityScale;
    $('natural-motion').value = preset.naturalMotion;
    $('natural-motion-help').textContent = preset.motionHelp;
    $('fixed-rotation').checked = preset.fixedRotation;
    syncAdvancedOutputs();
    updateApplyLabel();
  }

  function updateApplyLabel() {
    var selected = comp ? comp.selectedCount : 0;
    var target = selected === 1 ? 'selected layer' : 'selected layers';
    if (activeRole === 'static') {
      $('apply-body').textContent = 'Make ' + target + ' Passive';
    } else if (activeRole === 'kinematic') {
      $('apply-body').textContent = 'Make ' + target + ' Kinematic';
    } else {
      $('apply-body').textContent = 'Apply ' + PRESETS[activePreset].label + ' to ' + target;
    }
    $('apply-body').disabled = !selected;
    $('remove-body').disabled = !selected;
  }

  function syncAdvancedOutputs() {
    $('bounce-out').textContent = Number($('bounce').value).toFixed(2);
    $('friction-out').textContent = Number($('friction').value).toFixed(2);
    $('air-drag-out').textContent = Number($('air-drag').value).toFixed(3);
    $('natural-motion-out').textContent = Math.round(Number($('natural-motion').value) * 100) + '%';
  }

  function currentConfig() {
    var preset = PRESETS[activePreset];
    return {
      bodyType: activeRole,
      preset: activeRole === 'static' ? 'Passive surface' : preset.label,
      color: activeRole === 'static' ? '#efb34d' :
             activeRole === 'kinematic' ? '#73a7ff' : preset.color,
      shape: $('shape').value,
      density: Number($('density').value),
      bounce: Number($('bounce').value),
      friction: Number($('friction').value),
      frictionStatic: 0.5,
      airDrag: Number($('air-drag').value),
      gravityScale: activeRole === 'dynamic' ? Number($('gravity-scale').value) : 0,
      velocityX: Number($('velocity-x').value),
      velocityY: Number($('velocity-y').value),
      angularVelocity: Number($('angular-velocity').value),
      fixedRotation: $('fixed-rotation').checked === true,
      naturalMotion: Number($('natural-motion').value),
      turbulence: preset.turbulence,
      liftVariation: preset.liftVariation,
      wobble: preset.wobble,
      seed: Number($('variation-seed').value) || 1337
    };
  }

  function applyBody() {
    showNotice('');
    $('apply-body').disabled = true;
    hostCall('settleApplyBody', currentConfig(), function (result) {
      if (!result.ok) {
        showNotice(result.error);
        updateApplyLabel();
        return;
      }
      showNotice(result.count + ' layer' + (result.count === 1 ? '' : 's') +
        ' configured as ' + roleLabel(activeRole) + '.', 'info');
      refresh();
    });
  }

  function removeBody() {
    call('settleRemoveBody()', function (result) {
      if (!result.ok) showNotice(result.error);
      else showNotice('Physics settings removed from ' + result.count + ' layer' +
        (result.count === 1 ? '' : 's') + '.', 'info');
      refresh();
    });
  }

  function bodyRow(body) {
    var row = document.createElement('div');
    row.className = 'body-row';

    var dot = document.createElement('span');
    dot.className = 'body-dot ' + body.bodyType;
    if (body.color) dot.style.background = body.color;

    var main = document.createElement('div');
    main.className = 'body-main';
    var name = document.createElement('div');
    name.className = 'body-name';
    name.textContent = body.name;
    var meta = document.createElement('div');
    meta.className = 'body-meta';
    meta.textContent = body.preset || roleLabel(body.bodyType);
    main.appendChild(name);
    main.appendChild(meta);

    var role = document.createElement('span');
    role.className = 'body-role';
    role.textContent = roleLabel(body.bodyType);

    row.appendChild(dot);
    row.appendChild(main);
    row.appendChild(role);
    return row;
  }

  function refreshBodies() {
    call('settleBodyList()', function (result) {
      var host = $('body-list');
      host.innerHTML = '';
      if (!result.ok) {
        host.innerHTML = '<div class="empty">Could not read configured bodies.</div>';
        return;
      }
      $('body-count').textContent = result.rows.length + ' configured';
      if (!result.rows.length) {
        host.innerHTML = '<div class="empty">Configured layers will appear here.</div>';
        return;
      }
      for (var i = 0; i < result.rows.length; i++) host.appendChild(bodyRow(result.rows[i]));
    });
  }

  function refresh() {
    call('settleComp()', function (result) {
      if (!result.ok) {
        comp = null;
        $('comp-name').textContent = 'No composition';
        $('selection-summary').textContent = result.error;
        updateApplyLabel();
        return;
      }
      comp = result;
      $('comp-name').textContent = result.name;
      $('selection-summary').textContent = result.selectedCount
        ? result.selectedCount + ' layer' + (result.selectedCount === 1 ? '' : 's') + ' selected · ' +
          result.width + ' × ' + result.height + ' · ' + result.frameRate.toFixed(2) + ' fps'
        : 'Select one or more layers in the timeline.';
      updateApplyLabel();
      refreshBodies();
    });
  }

  function sceneOptions() {
    return {
      durationMode: $('duration-mode').value,
      gravity: Number($('gravity').value),
      gravityX: 0,
      gravityY: 1,
      wind: Number($('wind').value),
      substeps: Number($('quality').value),
      walls: $('walls').value,
      positionIterations: Number($('quality').value) >= 8 ? 10 : 8,
      velocityIterations: Number($('quality').value) >= 8 ? 8 : 6
    };
  }

  function runSimulation() {
    showNotice('');
    showResult('simulation-summary', 'Reading the configured layers…');
    $('run-preview').disabled = true;
    $('bake').disabled = true;
    stopPreview();

    hostCall('settlePhysicsScene', sceneOptions(), function (result) {
      $('run-preview').disabled = false;
      if (!result.ok) {
        showResult('simulation-summary', result.error, 'error');
        return;
      }
      try {
        simulation = SettlePhysics.simulate(result.scene);
      } catch (err) {
        simulation = null;
        showResult('simulation-summary', err.message || String(err), 'error');
        return;
      }

      $('preview-empty').hidden = true;
      $('preview-frame').disabled = false;
      $('preview-frame').max = simulation.frameCount;
      $('preview-frame').value = 0;
      $('play-preview').disabled = false;
      $('bake').disabled = false;
      drawPreview(0);
      showResult('simulation-summary',
        simulation.bodies.length + ' bodies · ' + simulation.frameCount +
        ' frames · preview ready. No AE keyframes changed.', 'success');
      startPreview();
    });
  }

  function anchorPosition(center, angleDegrees, offsetX, offsetY) {
    var a = angleDegrees * Math.PI / 180;
    var ox = offsetX * Math.cos(a) - offsetY * Math.sin(a);
    var oy = offsetX * Math.sin(a) + offsetY * Math.cos(a);
    return [center[0] - ox, center[1] - oy];
  }

  function bakeSimulation() {
    if (!simulation) return;
    stopPreview();
    $('bake').disabled = true;
    showResult('simulation-summary', 'Baking keyframes into After Effects…');

    var payload = {
      start: simulation.start,
      frameDuration: simulation.frameDuration,
      motionBlur: $('motion-blur').checked === true,
      bodies: []
    };

    for (var i = 0; i < simulation.bodies.length; i++) {
      var body = simulation.bodies[i];
      if (body.bodyType !== 'dynamic') continue;
      var positions = [];
      for (var f = 0; f < body.positions.length; f++) {
        positions.push(anchorPosition(body.positions[f], body.angles[f], body.offsetX, body.offsetY));
      }
      payload.bodies.push({
        index: body.index,
        name: body.name,
        positions: positions,
        rotations: body.angles
      });
    }

    hostCall('settleBake', payload, function (result) {
      $('bake').disabled = false;
      if (!result.ok) {
        showResult('simulation-summary', result.error, 'error');
        return;
      }
      showResult('simulation-summary',
        'Baked ' + result.layers + ' layer' + (result.layers === 1 ? '' : 's') +
        ' with ' + result.keys + ' keyframes. One Cmd+Z reverts the bake.', 'success');
    });
  }

  function resizeCanvas() {
    var canvas = $('preview');
    var rect = canvas.getBoundingClientRect();
    var ratio = window.devicePixelRatio || 1;
    var width = Math.max(1, Math.round(rect.width * ratio));
    var height = Math.max(1, Math.round(rect.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function drawPreview(frameNumber) {
    var canvas = $('preview');
    resizeCanvas();
    var ctx = canvas.getContext('2d');
    var width = canvas.width;
    var height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    if (!simulation) return;

    var frame = Math.max(0, Math.min(simulation.frameCount,
      frameNumber === undefined ? Number($('preview-frame').value) : frameNumber));
    $('preview-frame').value = frame;
    $('preview-time').textContent = formatTime(frame / simulation.fps);

    var pad = 12 * (window.devicePixelRatio || 1);
    var scale = Math.min((width - pad * 2) / simulation.width,
                         (height - pad * 2) / simulation.height);
    var offsetX = (width - simulation.width * scale) / 2;
    var offsetY = (height - simulation.height * scale) / 2;

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);
    ctx.strokeStyle = 'rgba(255,255,255,.2)';
    ctx.lineWidth = 1 / scale;
    ctx.strokeRect(0, 0, simulation.width, simulation.height);

    for (var i = 0; i < simulation.bodies.length; i++) {
      var body = simulation.bodies[i];
      var pos = body.positions[frame] || body.positions[body.positions.length - 1];
      var angle = (body.angles[frame] || 0) * Math.PI / 180;
      ctx.save();
      ctx.translate(pos[0], pos[1]);
      ctx.rotate(angle);
      ctx.fillStyle = body.color || '#78dec4';
      ctx.globalAlpha = body.bodyType === 'static' ? 0.72 : 0.9;
      ctx.strokeStyle = body.bodyType === 'static' ? '#f4c66d' : 'rgba(255,255,255,.65)';
      ctx.lineWidth = 1.5 / scale;
      if (body.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(0, 0, Math.min(body.width, body.height) / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.rect(-body.width / 2, -body.height / 2, body.width, body.height);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();
  }

  function formatTime(seconds) {
    var mins = Math.floor(seconds / 60);
    var secs = Math.floor(seconds % 60);
    var frames = simulation ? Math.floor((seconds % 1) * simulation.fps) : 0;
    return mins + ':' + (secs < 10 ? '0' : '') + secs + ':' + (frames < 10 ? '0' : '') + frames;
  }

  function startPreview() {
    if (!simulation) return;
    playing = true;
    $('play-preview').textContent = '❚❚';
    playStartFrame = Number($('preview-frame').value);
    if (playStartFrame >= simulation.frameCount) playStartFrame = 0;
    playStartedAt = performance.now();
    requestAnimationFrame(previewTick);
  }

  function stopPreview() {
    playing = false;
    $('play-preview').textContent = '▶';
  }

  function previewTick(now) {
    if (!playing || !simulation) return;
    var elapsed = (now - playStartedAt) / 1000;
    var frame = playStartFrame + Math.floor(elapsed * simulation.fps);
    if (frame > simulation.frameCount) {
      frame = 0;
      playStartFrame = 0;
      playStartedAt = now;
    }
    drawPreview(frame);
    requestAnimationFrame(previewTick);
  }

  function cleanSettings() {
    var levels = [0.25, 0.5, 1, 2.5, 5];
    return {
      tolerance: levels[Number($('cleanup-strength').value)],
      position: $('reduce-position').checked,
      rotation: $('reduce-rotation').checked,
      scale: $('reduce-scale').checked,
      smooth: $('smooth').checked
    };
  }

  function updateCleanupLabel() {
    var labels = [
      'Maximum accuracy · approximately 0.25 px tolerance',
      'Accurate · approximately 0.5 px tolerance',
      'Balanced · approximately 1 px tolerance',
      'Compact · approximately 2.5 px tolerance',
      'Fewest keys · approximately 5 px tolerance'
    ];
    $('cleanup-label').textContent = labels[Number($('cleanup-strength').value)];
  }

  function runClean() {
    var opts = cleanSettings();
    showResult('clean-summary', 'Cleaning keyframes…');
    hostCall('settleReduce', opts, function (result) {
      var list = $('clean-list');
      list.innerHTML = '';
      if (!result.ok) {
        showResult('clean-summary', result.error, 'error');
        return;
      }
      var cut = result.totalBefore
        ? Math.round(100 * (1 - result.totalAfter / result.totalBefore)) : 0;
      showResult('clean-summary',
        result.totalBefore + ' keys became ' + result.totalAfter + ' · ' + cut +
        '% fewer · worst measured error ' + result.worstError + '.', 'success');
      for (var i = 0; i < result.report.length; i++) {
        var item = result.report[i];
        var row = document.createElement('div');
        row.className = 'body-row';
        var dot = document.createElement('span');
        dot.className = 'body-dot';
        var main = document.createElement('div');
        main.className = 'body-main';
        var name = document.createElement('div');
        name.className = 'body-name';
        name.textContent = item.layer + ' · ' + item.property;
        var meta = document.createElement('div');
        meta.className = 'body-meta';
        meta.textContent = item.skipped
          ? 'Skipped: ' + item.skipped
          : item.before + ' → ' + item.after + ' keys · error ' + item.error;
        main.appendChild(name);
        main.appendChild(meta);
        row.appendChild(dot);
        row.appendChild(main);
        list.appendChild(row);
      }
    });
  }

  function runAudit() {
    call('settleAudit("selected")', function (result) {
      var list = $('audit-list');
      list.innerHTML = '';
      if (!result.ok) {
        showNotice(result.error);
        return;
      }
      for (var i = 0; i < result.rows.length; i++) {
        var item = result.rows[i];
        var issues = [];
        if (item.blocked) issues.push(item.blocked);
        if (item.hasExpression) issues.push('Transform expression');
        if (item.separated) issues.push('Separated position');
        if (item.anchorOffset !== null && item.anchorOffset > 2) issues.push('Anchor ' + item.anchorOffset + ' px off-centre');
        if (!issues.length) issues.push('Ready');

        var row = document.createElement('div');
        row.className = 'body-row';
        var dot = document.createElement('span');
        dot.className = 'body-dot ' + (issues[0] === 'Ready' ? '' : 'static');
        var main = document.createElement('div');
        main.className = 'body-main';
        var name = document.createElement('div');
        name.className = 'body-name';
        name.textContent = item.name;
        var meta = document.createElement('div');
        meta.className = 'body-meta';
        meta.textContent = issues.join(' · ');
        main.appendChild(name);
        main.appendChild(meta);
        row.appendChild(dot);
        row.appendChild(main);
        list.appendChild(row);
      }
    });
  }

  function wire() {
    setTabs();

    function setAboutOpen(open) {
      $('about-overlay').hidden = !open;
      document.body.classList.toggle('about-open', open);
      if (open) $('close-about').focus();
      else $('open-about').focus();
    }

    $('open-about').addEventListener('click', function () { setAboutOpen(true); });
    $('close-about').addEventListener('click', function () { setAboutOpen(false); });
    $('about-overlay').addEventListener('click', function (event) {
      if (event.target === this) setAboutOpen(false);
    });
    document.addEventListener('keydown', function (event) {
      if ((!$('about-overlay').hidden) && (event.key === 'Escape' || event.keyCode === 27)) {
        setAboutOpen(false);
      }
    });

    var roles = document.querySelectorAll('.role');
    for (var i = 0; i < roles.length; i++) {
      roles[i].addEventListener('click', function () {
        selectRole(this.getAttribute('data-role'));
      });
    }

    var presets = document.querySelectorAll('.preset');
    for (var p = 0; p < presets.length; p++) {
      presets[p].addEventListener('click', function () {
        selectPreset(this.getAttribute('data-preset'));
      });
    }

    $('bounce').addEventListener('input', syncAdvancedOutputs);
    $('friction').addEventListener('input', syncAdvancedOutputs);
    $('air-drag').addEventListener('input', syncAdvancedOutputs);
    $('natural-motion').addEventListener('input', syncAdvancedOutputs);
    $('new-variation').addEventListener('click', function () {
      $('variation-seed').value = Math.floor(Math.random() * 999999) + 1;
      showNotice('New repeatable variation selected. Apply it to the selected layers.', 'info');
    });
    $('refresh').addEventListener('click', refresh);
    $('apply-body').addEventListener('click', applyBody);
    $('remove-body').addEventListener('click', removeBody);
    $('run-preview').addEventListener('click', runSimulation);
    $('bake').addEventListener('click', bakeSimulation);
    $('play-preview').addEventListener('click', function () {
      if (playing) stopPreview();
      else startPreview();
    });
    $('preview-frame').addEventListener('input', function () {
      stopPreview();
      drawPreview(Number(this.value));
    });
    $('cleanup-strength').addEventListener('input', updateCleanupLabel);
    $('run-clean').addEventListener('click', runClean);
    $('run-audit').addEventListener('click', runAudit);
    window.addEventListener('resize', function () { drawPreview(); });
  }

  wire();
  selectRole('dynamic');
  selectPreset('balloon');
  updateCleanupLabel();
  refresh();
}());
