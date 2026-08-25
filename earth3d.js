/* ============================================================
   Lumina — 3D Earth hero visual (homepage only)

   Rebuilt to use ONLY standard, well-tested Three.js material
   properties rather than a hand-written shader:
     map          = day/albedo colour texture
     specularMap  = ocean mask (data, not colour)
     emissive +
     emissiveMap  = city lights (self-lit, so they read correctly
                    regardless of the day/night lighting angle)
   Lighting (one DirectionalLight "sun" + a low AmbientLight fill)
   does the day/night shading — the same battle-tested lighting
   model Three.js has used for a decade, instead of custom GLSL.

   Loading: nothing is added to the scene, and the canvas is never
   revealed, until every texture has finished loading AND at least
   one full frame has been rendered off-screen. This guarantees the
   very first pixels the visitor sees are already correct — never a
   flat colour, a placeholder, or a partially-textured globe.
   ============================================================ */
(function () {
  var canvas = document.getElementById('earth3d-canvas');
  if (!canvas || typeof THREE === 'undefined') return;

  var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var isSmallScreen = window.innerWidth < 780;

  // Verified textures hosted on the official three.js examples CDN
  // (NASA Blue Marble / Solar System Scope derived, CC BY 4.0).
  var TEX_BASE = 'https://threejs.org/examples/textures/planets/';
  var TEXTURES = {
    day: TEX_BASE + 'earth_atmos_2048.jpg',
    specular: TEX_BASE + 'earth_specular_2048.jpg',
    night: TEX_BASE + 'earth_lights_2048.png',
    clouds: TEX_BASE + 'earth_clouds_1024.png'
  };

  var renderer, scene, camera, clock;
  var earthGroup, earthMesh, cloudMesh;
  var stars;
  var rafId = null;
  var disposed = false;
  var resizeTimer = null;

  var baseRotationSpeed = (Math.PI * 2) / 120; // one full spin ~every 120s
  var mouseX = 0, mouseY = 0, lastMoveTime = 0;
  var parallaxX = 0, parallaxY = 0;

  var sunDirection = new THREE.Vector3(4.2, 1.4, 3.6).normalize();

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
      positions[i * 3 + 2] = radius * Math.cos(phi) - 15;
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    var mat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: isSmallScreen ? 0.85 : 1.05,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.55,
      depthWrite: false
    });
    return new THREE.Points(geo, mat);
  }

  function composeEarthPosition() {
    // Large globe on the right, extending off the edge, but with a
    // clear gap from the text column so it doesn't crowd the headline.
    if (isSmallScreen) {
      return { x: 1.55, y: -2.5, radius: 1.9 };
    }
    return { x: 4.05, y: -0.3, radius: 2.35 };
  }

  function prepColorTexture(tex, maxAniso) {
    if (!tex) return;
    if (THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = maxAniso;
    tex.needsUpdate = true;
  }

  function init(loaded, isPremium) {
    scene = new THREE.Scene();
    clock = new THREE.Clock();

    camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 200);
    camera.position.set(0, 0, 7.4);

    renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isSmallScreen ? 1.5 : 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 0);
    if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;
    if (THREE.ACESFilmicToneMapping) {
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
    }

    // Colour textures need sRGB decoding explicitly — this was the root
    // cause of the earlier washed-out/incorrect-colour globe. The
    // specular map is a data mask, not colour, so it's left as-is.
    var maxAniso = renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1;
    prepColorTexture(loaded.day, maxAniso);
    prepColorTexture(loaded.night, maxAniso);
    prepColorTexture(loaded.clouds, maxAniso);
    if (loaded.specular) loaded.specular.anisotropy = maxAniso;

    var sun = new THREE.DirectionalLight(0xffffff, 1.35);
    sun.position.copy(sunDirection).multiplyScalar(6);
    scene.add(sun);
    scene.add(new THREE.AmbientLight(0x1c2740, 0.4));

    var pos = composeEarthPosition();
    earthGroup = new THREE.Group();
    earthGroup.position.set(pos.x, pos.y, 0);
    earthGroup.rotation.z = THREE.MathUtils.degToRad(-11);
    scene.add(earthGroup);

    var segments = isSmallScreen ? 48 : 100;
    var radius = pos.radius;
    var geometry = new THREE.SphereGeometry(radius, segments, segments);

    var materialOptions = {
      map: loaded.day,
      specularMap: loaded.specular,
      specular: new THREE.Color(0x333333),
      shininess: 10
    };
    if (isPremium && loaded.night) {
      materialOptions.emissive = new THREE.Color(0xffffff);
      materialOptions.emissiveMap = loaded.night;
      materialOptions.emissiveIntensity = 1.15;
    }
    var earthMaterial = new THREE.MeshPhongMaterial(materialOptions);

    earthMesh = new THREE.Mesh(geometry, earthMaterial);
    earthMesh.rotation.y = Math.PI * 0.15;
    earthGroup.add(earthMesh);

    if (isPremium && loaded.clouds) {
      var cloudMaterial = new THREE.MeshLambertMaterial({
        map: loaded.clouds,
        transparent: true,
        opacity: 0.55,
        depthWrite: false
      });
      cloudMesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius * 1.012, segments, segments),
        cloudMaterial
      );
      cloudMesh.rotation.y = earthMesh.rotation.y;
      earthGroup.add(cloudMesh);
    }

    var rim = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 1.016, segments, segments),
      buildAtmosphereMaterial(0x6ec3ff, 0.5, 2.1)
    );
    earthGroup.add(rim);

    var halo = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 1.3, Math.max(24, segments - 36), Math.max(24, segments - 36)),
      buildAtmosphereMaterial(0x3572d6, 0.3, 4.0)
    );
    earthGroup.add(halo);

    stars = buildStarfield(isSmallScreen ? 200 : 600);
    scene.add(stars);

    window.addEventListener('resize', onResize, { passive: true });
    if (!prefersReducedMotion) {
      window.addEventListener('mousemove', onMouseMove, { passive: true });
      document.addEventListener('visibilitychange', onVisibilityChange);
    }
    window.addEventListener('pagehide', dispose);

    // Render at least one full frame while still fully transparent
    // (opacity 0), THEN reveal on the following frame. By the time the
    // fade-in transition starts, correct pixels already exist in the
    // canvas — nothing incomplete or wrong is ever visible.
    renderer.render(scene, camera);
    requestAnimationFrame(function () {
      renderer.render(scene, camera);
      document.body.classList.add('earth3d-active');
      if (prefersReducedMotion) {
        renderer.render(scene, camera);
      } else {
        rafId = requestAnimationFrame(animate);
      }
    });
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
      clock.getDelta();
      rafId = requestAnimationFrame(animate);
    }
  }

  function onResize() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(handleResize, 250);
  }

  function handleResize() {
    if (!camera || !renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);

    var wasSmall = isSmallScreen;
    isSmallScreen = window.innerWidth < 780;
    // Only rebuild the scene if the device tier actually changed
    // (e.g. rotating a tablet) — not on routine window resizing.
    if (wasSmall !== isSmallScreen) {
      dispose();
      disposed = false;
      document.body.classList.remove('earth3d-active');
      start();
    }
  }

  function animate() {
    if (disposed) return;
    var delta = Math.min(clock.getDelta(), 0.1);

    var idleFor = performance.now() - lastMoveTime;
    var mouseActive = idleFor < 1200;
    var targetX = mouseActive ? mouseX * 0.14 : 0;
    var targetY = mouseActive ? mouseY * 0.08 : 0;
    parallaxX += (targetX - parallaxX) * 0.035;
    parallaxY += (targetY - parallaxY) * 0.035;

    earthMesh.rotation.y += baseRotationSpeed * delta;
    if (cloudMesh) cloudMesh.rotation.y += baseRotationSpeed * 1.15 * delta;
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
    if (resizeTimer) clearTimeout(resizeTimer);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('visibilitychange', onVisibilityChange);

    if (scene) {
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
    }
    if (renderer) {
      renderer.dispose();
      renderer.forceContextLoss();
    }
  }

  function loadTextures(callback) {
    var loader = new THREE.TextureLoader();
    loader.crossOrigin = 'anonymous';
    var result = {};
    var requiredFailed = false;
    var isPremium = !isSmallScreen;

    // day + specular are proven to load reliably — the globe requires
    // them. night/clouds are enhancements only: if either 404s or errors,
    // the globe still renders correctly, just without that extra layer,
    // rather than the whole thing silently failing to appear at all.
    var required = ['day:day', 'specular:specular'];
    var optional = isPremium ? ['night:night', 'clouds:clouds'] : [];

    var requiredPending = required.length;
    var optionalPending = optional.length;

    function tryFinish() {
      if (requiredPending <= 0 && optionalPending <= 0 && !requiredFailed) {
        callback(result, isPremium);
      }
    }

    required.forEach(function (job) {
      var parts = job.split(':');
      loader.load(
        TEXTURES[parts[0]],
        function (tex) { result[parts[1]] = tex; requiredPending--; tryFinish(); },
        undefined,
        function () { requiredFailed = true; } // plain dark background stays; no broken globe
      );
    });

    optional.forEach(function (job) {
      var parts = job.split(':');
      loader.load(
        TEXTURES[parts[0]],
        function (tex) { result[parts[1]] = tex; optionalPending--; tryFinish(); },
        undefined,
        function () { optionalPending--; tryFinish(); } // just skip this layer
      );
    });
  }

  function start() {
    try {
      if (!window.WebGLRenderingContext) return;
      loadTextures(init);
    } catch (err) {
      // WebGL unsupported or failed — plain dark background remains
    }
  }

  if (document.readyState === 'complete') {
    start();
  } else {
    window.addEventListener('load', start);
  }
})();
