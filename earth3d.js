/* ============================================================
   Lumina — 3D Earth hero visual (homepage only)
   Progressive enhancement: if WebGL/textures fail to load, the
   original static earth-bg.jpg (set in styles.css) stays visible
   and this script simply does nothing further.
   ============================================================ */
(function () {
  var canvas = document.getElementById('earth3d-canvas');
  if (!canvas || typeof THREE === 'undefined') return;

  var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var isSmallScreen = window.innerWidth < 700;

  var TEXTURES = {
    map: 'https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg',
    specular: 'https://threejs.org/examples/textures/planets/earth_specular_2048.jpg',
    normal: 'https://threejs.org/examples/textures/planets/earth_normal_2048.jpg'
  };

  var renderer, scene, camera, clock;
  var earthGroup, earthMesh;
  var stars;
  var rafId = null;
  var disposed = false;

  var baseRotationSpeed = 0.045; // radians/sec — one full spin roughly every 2.3 minutes
  var mouseX = 0, mouseY = 0, lastMoveTime = 0;
  var parallaxX = 0, parallaxY = 0;

  function buildAtmosphereMaterial(color, coefficient, power) {
    return new THREE.ShaderMaterial({
      uniforms: {
        glowColor: { value: new THREE.Color(color) },
        coefficient: { value: coefficient },
        power: { value: power }
      },
      vertexShader: [
        'varying vec3 vNormal;',
        'void main() {',
        '  vNormal = normalize( normalMatrix * normal );',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform vec3 glowColor;',
        'uniform float coefficient;',
        'uniform float power;',
        'varying vec3 vNormal;',
        'void main() {',
        '  float intensity = pow( coefficient - dot( vNormal, vec3(0.0, 0.0, 1.0) ), power );',
        '  gl_FragColor = vec4( glowColor, 1.0 ) * intensity;',
        '}'
      ].join('\n'),
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false
    });
  }

  function buildStarfield(count) {
    var positions = new Float32Array(count * 3);
    for (var i = 0; i < count; i++) {
      var radius = 40 + Math.random() * 60;
      var theta = Math.random() * Math.PI * 2;
      var phi = Math.acos((Math.random() * 2) - 1);
      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = radius * Math.cos(phi) - 20;
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    var mat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: isSmallScreen ? 0.9 : 1.15,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.55,
      depthWrite: false
    });
    return new THREE.Points(geo, mat);
  }

  function init(loadedTextures) {
    scene = new THREE.Scene();
    clock = new THREE.Clock();

    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 200);
    camera.position.set(0, 0, 7.2);

    renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isSmallScreen ? 1.5 : 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 0);
    if ('outputEncoding' in renderer && THREE.sRGBEncoding) {
      renderer.outputEncoding = THREE.sRGBEncoding;
    }

    // ---- lighting: single "sun" + faint ambient fill so the night side
    // reads as darker, not pure black ----
    var sun = new THREE.DirectionalLight(0xffffff, 1.15);
    sun.position.set(5, 2.2, 4);
    scene.add(sun);
    scene.add(new THREE.AmbientLight(0x223355, 0.28));

    // ---- earth group, offset to sit lower-right like the previous photo ----
    earthGroup = new THREE.Group();
    earthGroup.position.set(1.9, -0.95, 0);
    scene.add(earthGroup);

    var segments = isSmallScreen ? 40 : 72;
    var radius = 2.35;
    var geometry = new THREE.SphereGeometry(radius, segments, segments);

    var materialOptions = {
      map: loadedTextures.map,
      specularMap: loadedTextures.specular,
      specular: new THREE.Color(0x333333),
      shininess: 9
    };
    if (loadedTextures.normal) {
      materialOptions.normalMap = loadedTextures.normal;
      materialOptions.normalScale = new THREE.Vector2(0.75, 0.75);
    }
    var material = new THREE.MeshPhongMaterial(materialOptions);
    earthMesh = new THREE.Mesh(geometry, material);
    earthMesh.rotation.y = Math.PI * 0.15;
    earthGroup.add(earthMesh);

    // tilt the axis slightly for a more natural, less "flat" look
    earthGroup.rotation.z = THREE.MathUtils.degToRad(-11);

    var rim = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 1.015, segments, segments),
      buildAtmosphereMaterial(0x5fb8ff, 0.55, 2.3)
    );
    earthGroup.add(rim);

    var halo = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 1.32, Math.max(24, segments - 24), Math.max(24, segments - 24)),
      buildAtmosphereMaterial(0x2f6fd6, 0.32, 4.2)
    );
    earthGroup.add(halo);

    stars = buildStarfield(isSmallScreen ? 260 : 700);
    scene.add(stars);

    window.addEventListener('resize', onResize, { passive: true });

    if (!prefersReducedMotion) {
      window.addEventListener('mousemove', onMouseMove, { passive: true });
      document.addEventListener('visibilitychange', onVisibilityChange);
    }
    window.addEventListener('pagehide', dispose);

    // reveal: fade the 3D canvas in and fade the flat photo out
    document.body.classList.add('earth3d-active');

    if (prefersReducedMotion) {
      renderer.render(scene, camera);
    } else {
      rafId = requestAnimationFrame(animate);
    }
  }

  function onMouseMove(e) {
    mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
    mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
    lastMoveTime = performance.now();
  }

  function onVisibilityChange() {
    if (document.hidden) {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
    } else if (!disposed && !rafId) {
      clock.getDelta(); // avoid a large jump on resume
      rafId = requestAnimationFrame(animate);
    }
  }

  function onResize() {
    if (!camera || !renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  function animate() {
    if (disposed) return;
    var delta = Math.min(clock.getDelta(), 0.1);

    var idleFor = performance.now() - lastMoveTime;
    var mouseActive = idleFor < 1200;
    var targetX = mouseActive ? mouseX * 0.16 : 0;
    var targetY = mouseActive ? mouseY * 0.09 : 0;
    parallaxX += (targetX - parallaxX) * 0.035;
    parallaxY += (targetY - parallaxY) * 0.035;

    earthMesh.rotation.y += baseRotationSpeed * delta;
    earthGroup.rotation.y = parallaxX;
    earthGroup.rotation.x = parallaxY;

    if (stars) stars.rotation.y += 0.0015 * delta;

    renderer.render(scene, camera);
    rafId = requestAnimationFrame(animate);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (rafId) cancelAnimationFrame(rafId);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('visibilitychange', onVisibilityChange);

    scene.traverse(function (obj) {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        var mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach(function (m) {
          for (var key in m) {
            if (m[key] && m[key].isTexture) m[key].dispose();
          }
          m.dispose();
        });
      }
    });
    renderer.dispose();
    renderer.forceContextLoss();
  }

  function loadTextures(callback) {
    var loader = new THREE.TextureLoader();
    loader.crossOrigin = 'anonymous';
    var result = {};
    var pending = isSmallScreen ? 2 : 3; // skip normal map on small screens
    var failed = false;

    function done() {
      pending--;
      if (pending <= 0 && !failed) callback(result);
    }
    function fail() {
      if (failed) return;
      failed = true; // let the static fallback background show instead
    }

    loader.load(TEXTURES.map, function (tex) { result.map = tex; done(); }, undefined, fail);
    loader.load(TEXTURES.specular, function (tex) { result.specular = tex; done(); }, undefined, fail);
    if (!isSmallScreen) {
      loader.load(TEXTURES.normal, function (tex) { result.normal = tex; done(); }, undefined, fail);
    }
  }

  function start() {
    try {
      if (!window.WebGLRenderingContext) return;
      loadTextures(init);
    } catch (err) {
      // WebGL unsupported or failed — original static background remains visible
    }
  }

  if (document.readyState === 'complete') {
    start();
  } else {
    window.addEventListener('load', start);
  }
})();
