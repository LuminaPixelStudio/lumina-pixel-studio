/* ============================================================
   Lumina — 3D Earth hero visual (homepage only)

   Desktop: custom day/night shader (real terminator + city lights
   on the dark side only), separate independently-drifting cloud
   layer, Fresnel atmosphere rim + soft outer halo, starfield.

   Mobile/low-power: a lighter MeshPhongMaterial globe (day map +
   ocean specular only, no clouds/night layer) to keep payload and
   shader cost down, per the responsive/performance requirements.

   Progressive enhancement: if WebGL or the textures fail, nothing
   renders here and the plain dark .site-bg gradient (set in
   styles.css) stays visible — never a flat Earth photo.
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
    day4k: TEX_BASE + 'earth_atmos_4096.jpg',
    day2k: TEX_BASE + 'earth_atmos_2048.jpg',
    specular: TEX_BASE + 'earth_specular_2048.jpg',
    night: TEX_BASE + 'earth_lights_2048.png',
    clouds: TEX_BASE + 'earth_clouds_1024.png'
  };

  var renderer, scene, camera, clock;
  var earthGroup, earthMesh, cloudMesh;
  var stars;
  var rafId = null;
  var disposed = false;

  var baseRotationSpeed = (Math.PI * 2) / 115; // one full spin ~every 115s
  var mouseX = 0, mouseY = 0, lastMoveTime = 0;
  var parallaxX = 0, parallaxY = 0;

  var sunDirection = new THREE.Vector3(4.5, 1.6, 3.2).normalize();

  var SHARED_VERTEX = [
    'varying vec2 vUv;',
    'varying vec3 vNormalW;',
    'void main() {',
    '  vUv = uv;',
    '  vNormalW = normalize( mat3( modelMatrix ) * normal );',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );',
    '}'
  ].join('\n');

  var EARTH_FRAGMENT = [
    'uniform sampler2D dayTexture;',
    'uniform sampler2D nightTexture;',
    'uniform sampler2D specularTexture;',
    'uniform vec3 sunDirection;',
    'varying vec2 vUv;',
    'varying vec3 vNormalW;',
    'void main() {',
    '  vec3 dayColor = texture2D( dayTexture, vUv ).rgb;',
    '  vec3 nightColor = texture2D( nightTexture, vUv ).rgb;',
    '  float oceanMask = texture2D( specularTexture, vUv ).r;',
    '  float sunAmount = dot( normalize(vNormalW), normalize(sunDirection) );',
    '  float dayMix = smoothstep( -0.22, 0.35, sunAmount );',
    '  vec3 color = mix( nightColor * 1.4, dayColor, dayMix );',
    '  float spec = pow( max( sunAmount, 0.0 ), 18.0 ) * oceanMask * dayMix;',
    '  color += vec3(0.85, 0.92, 1.0) * spec * 0.4;',
    '  float terminatorGlow = (1.0 - abs(sunAmount)) * (1.0 - dayMix) * dayMix * 4.0;',
    '  color += vec3(1.0, 0.55, 0.25) * clamp(terminatorGlow, 0.0, 1.0) * 0.12;',
    '  gl_FragColor = vec4( color, 1.0 );',
    '}'
  ].join('\n');

  var CLOUD_FRAGMENT = [
    'uniform sampler2D cloudsTexture;',
    'uniform vec3 sunDirection;',
    'varying vec2 vUv;',
    'varying vec3 vNormalW;',
    'void main() {',
    '  vec4 cloudSample = texture2D( cloudsTexture, vUv );',
    '  float sunAmount = dot( normalize(vNormalW), normalize(sunDirection) );',
    '  float dayMix = smoothstep( -0.3, 0.25, sunAmount );',
    '  float alpha = cloudSample.a * mix(0.12, 0.8, dayMix);',
    '  gl_FragColor = vec4( cloudSample.rgb, alpha );',
    '}'
  ].join('\n');

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
      size: isSmallScreen ? 0.9 : 1.1,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.6,
      depthWrite: false
    });
    return new THREE.Points(geo, mat);
  }

  function composeEarthPosition() {
    // Large globe entering from the right edge; tucked lower on small
    // screens so it sits clear of the (full-width, top-anchored) text.
    if (isSmallScreen) {
      return { x: 1.7, y: -2.55, radius: 2.05 };
    }
    return { x: 3.55, y: -0.35, radius: 2.7 };
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

    var maxAniso = renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1;
    if (loaded.day) loaded.day.anisotropy = maxAniso;

    var pos = composeEarthPosition();
    earthGroup = new THREE.Group();
    earthGroup.position.set(pos.x, pos.y, 0);
    earthGroup.rotation.z = THREE.MathUtils.degToRad(-11);
    scene.add(earthGroup);

    var segments = isSmallScreen ? 44 : 96;
    var radius = pos.radius;
    var geometry = new THREE.SphereGeometry(radius, segments, segments);

    var earthMaterial;
    if (isPremium) {
      earthMaterial = new THREE.ShaderMaterial({
        uniforms: {
          dayTexture: { value: loaded.day },
          nightTexture: { value: loaded.night },
          specularTexture: { value: loaded.specular },
          sunDirection: { value: sunDirection }
        },
        vertexShader: SHARED_VERTEX,
        fragmentShader: EARTH_FRAGMENT
      });
    } else {
      earthMaterial = new THREE.MeshPhongMaterial({
        map: loaded.day,
        specularMap: loaded.specular,
        specular: new THREE.Color(0x2a2a2a),
        shininess: 8
      });
      var sun = new THREE.DirectionalLight(0xffffff, 1.1);
      sun.position.copy(sunDirection).multiplyScalar(6);
      scene.add(sun);
      scene.add(new THREE.AmbientLight(0x1c2740, 0.35));
    }

    earthMesh = new THREE.Mesh(geometry, earthMaterial);
    earthMesh.rotation.y = Math.PI * 0.15;
    earthGroup.add(earthMesh);

    if (isPremium && loaded.clouds) {
      var cloudGeometry = new THREE.SphereGeometry(radius * 1.012, segments, segments);
      var cloudMaterial = new THREE.ShaderMaterial({
        uniforms: {
          cloudsTexture: { value: loaded.clouds },
          sunDirection: { value: sunDirection }
        },
        vertexShader: SHARED_VERTEX,
        fragmentShader: CLOUD_FRAGMENT,
        transparent: true,
        depthWrite: false
      });
      cloudMesh = new THREE.Mesh(cloudGeometry, cloudMaterial);
      cloudMesh.rotation.y = earthMesh.rotation.y;
      earthGroup.add(cloudMesh);
    }

    var rim = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 1.016, segments, segments),
      buildAtmosphereMaterial(0x6ec3ff, 0.5, 2.1)
    );
    earthGroup.add(rim);

    var halo = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 1.3, Math.max(24, segments - 32), Math.max(24, segments - 32)),
      buildAtmosphereMaterial(0x3572d6, 0.3, 4.0)
    );
    earthGroup.add(halo);

    stars = buildStarfield(isSmallScreen ? 220 : 650);
    scene.add(stars);

    window.addEventListener('resize', onResize, { passive: true });

    if (!prefersReducedMotion) {
      window.addEventListener('mousemove', onMouseMove, { passive: true });
      document.addEventListener('visibilitychange', onVisibilityChange);
    }
    window.addEventListener('pagehide', dispose);

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
      clock.getDelta();
      rafId = requestAnimationFrame(animate);
    }
  }

  function onResize() {
    if (!camera || !renderer) return;
    var wasSmall = isSmallScreen;
    isSmallScreen = window.innerWidth < 780;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    // Crossing the small-screen breakpoint changes composition enough
    // (layout, geometry detail, texture tier) that a soft reload of the
    // scene is simpler and safer than trying to patch it live.
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
    var failed = false;
    var isPremium = !isSmallScreen;

    var jobs = isPremium
      ? ['day4k:day', 'night:night', 'specular:specular', 'clouds:clouds']
      : ['day2k:day', 'specular:specular'];

    var pending = jobs.length;

    function done() {
      pending--;
      if (pending <= 0 && !failed) callback(result, isPremium);
    }
    function fail() {
      failed = true; // static dark background stays as-is; no crash
    }

    jobs.forEach(function (job) {
      var parts = job.split(':');
      var texKey = parts[0], resultKey = parts[1];
      loader.load(TEXTURES[texKey], function (tex) { result[resultKey] = tex; done(); }, undefined, fail);
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
