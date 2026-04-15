import * as THREE from 'three';

// Scene setup
const canvas = document.getElementById('globe-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 2.5;

// Texture loader
const loader = new THREE.TextureLoader();

const earthDayTexture = loader.load('https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/earth_atmos_2048.jpg');
const earthNightTexture = loader.load('https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/earth_lights_2048.png');
const earthClouds = loader.load('https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/earth_clouds_1024.png');
const earthNormal = loader.load('https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/earth_normal_2048.jpg');
const earthSpecular = loader.load('https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/earth_specular_2048.jpg');

// Custom shader material for day/night blend
const dayNightMaterial = new THREE.ShaderMaterial({
  uniforms: {
    dayTexture: { value: earthDayTexture },
    nightTexture: { value: earthNightTexture },
    normalMap: { value: earthNormal },
    specularMap: { value: earthSpecular },
    sunDirection: { value: new THREE.Vector3(5, 3, 5).normalize() },
  },
  vertexShader: `
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vPosition;

    void main() {
      vUv = uv;
      vNormal = normalize(normalMatrix * normal);
      vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D dayTexture;
    uniform sampler2D nightTexture;
    uniform vec3 sunDirection;

    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vPosition;

    void main() {
      vec3 sunDir = normalize(sunDirection);
      float intensity = dot(vNormal, sunDir);

      vec4 dayColor = texture2D(dayTexture, vUv);
      vec4 nightColor = texture2D(nightTexture, vUv);

      float blendFactor = smoothstep(-0.1, 0.3, intensity);

      vec4 color = mix(nightColor, dayColor, blendFactor);

      gl_FragColor = color;
    }
  `,
});

// Globe
const globeGeometry = new THREE.SphereGeometry(1, 64, 64);
const globe = new THREE.Mesh(globeGeometry, dayNightMaterial);
scene.add(globe);

// Cloud layer
const cloudGeometry = new THREE.SphereGeometry(1.01, 64, 64);
const cloudMaterial = new THREE.MeshPhongMaterial({
  map: earthClouds,
  transparent: true,
  opacity: 0.4,
});
const clouds = new THREE.Mesh(cloudGeometry, cloudMaterial);
scene.add(clouds);

// Atmosphere glow
const atmosphereGeometry = new THREE.SphereGeometry(1.08, 64, 64);
const atmosphereMaterial = new THREE.MeshPhongMaterial({
  color: 0x0044ff,
  transparent: true,
  opacity: 0.08,
  side: THREE.FrontSide,
});
const atmosphere = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
scene.add(atmosphere);

// Stars background
const starGeometry = new THREE.BufferGeometry();
const starCount = 8000;
const starPositions = new Float32Array(starCount * 3);
for (let i = 0; i < starCount * 3; i++) {
  starPositions[i] = (Math.random() - 0.5) * 200;
}
starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
const starMaterial = new THREE.PointsMaterial({ color: 0xffffff, size: 0.07 });
const stars = new THREE.Points(starGeometry, starMaterial);
scene.add(stars);

// Sun light
const sunLight = new THREE.DirectionalLight(0xffffff, 1.5);
sunLight.position.set(5, 3, 5);
scene.add(sunLight);

const ambientLight = new THREE.AmbientLight(0x111111);
scene.add(ambientLight);

// Helper function
function latLonToVector3(lat, lon, radius) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

// Location marker
let locationMarker = null;

function addLocationMarker(lat, lon) {
  if (locationMarker) scene.remove(locationMarker);
  const markerGeometry = new THREE.SphereGeometry(0.02, 16, 16);
  const markerMaterial = new THREE.MeshBasicMaterial({ color: 0x00ffff });
  locationMarker = new THREE.Mesh(markerGeometry, markerMaterial);
  const pos = latLonToVector3(lat, lon, 1.02);
  locationMarker.position.set(pos.x, pos.y, pos.z);
  scene.add(locationMarker);

  globe.rotation.y = -(lon + 180) * (Math.PI / 180);
  clouds.rotation.y = globe.rotation.y;
}

// ISS marker
const issGeometry = new THREE.SphereGeometry(0.025, 16, 16);
const issMaterial = new THREE.MeshBasicMaterial({ color: 0xff6600 });
const issMarker = new THREE.Mesh(issGeometry, issMaterial);
scene.add(issMarker);

// ISS label panel
const issPanel = document.getElementById('iss-info');

async function fetchISS() {
  try {
    const res = await fetch('https://api.wheretheiss.at/v1/satellites/25544');
    const data = await res.json();
    const lat = data.latitude;
    const lon = data.longitude;
    const alt = data.altitude.toFixed(1);
    const vel = data.velocity.toFixed(1);

    const pos = latLonToVector3(lat, lon, 1.05);
    issMarker.position.set(pos.x, pos.y, pos.z);

    document.getElementById('iss-coords').textContent = `Lat: ${lat.toFixed(2)}, Lon: ${lon.toFixed(2)}`;
    document.getElementById('iss-alt').textContent = `Altitude: ${alt} km`;
    document.getElementById('iss-vel').textContent = `Speed: ${vel} km/h`;
  } catch {
    document.getElementById('iss-coords').textContent = 'ISS data unavailable';
  }
}

fetchISS();
setInterval(fetchISS, 5000);

// Geolocation
if (navigator.geolocation) {
  navigator.geolocation.getCurrentPosition((pos) => {
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    document.getElementById('coords').textContent = `Lat: ${lat.toFixed(4)}, Lon: ${lon.toFixed(4)}`;
    addLocationMarker(lat, lon);
    fetchWeather(lat, lon);
  }, () => {
    document.getElementById('coords').textContent = 'Location access denied';
  });
}

// Weather
async function fetchWeather(lat, lon) {
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`);
    const data = await res.json();
    const temp = data.current_weather.temperature;
    const wind = data.current_weather.windspeed;
    document.getElementById('weather').textContent = `Temp: ${temp}°C | Wind: ${wind} km/h`;
  } catch {
    document.getElementById('weather').textContent = 'Weather unavailable';
  }
}

// UTC Clock
function updateClock() {
  const now = new Date();
  const utc = now.toUTCString().slice(17, 25);
  document.getElementById('utc-time').textContent = `UTC: ${utc}`;
}
setInterval(updateClock, 1000);
updateClock();

// Mouse drag rotation
let isDragging = false;
let previousMousePosition = { x: 0, y: 0 };

canvas.addEventListener('mousedown', (e) => {
  isDragging = true;
  previousMousePosition = { x: e.clientX, y: e.clientY };
});

canvas.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  const deltaX = e.clientX - previousMousePosition.x;
  const deltaY = e.clientY - previousMousePosition.y;
  globe.rotation.y += deltaX * 0.005;
  globe.rotation.x += deltaY * 0.005;
  clouds.rotation.y = globe.rotation.y;
  clouds.rotation.x = globe.rotation.x;
  atmosphere.rotation.y = globe.rotation.y;
  previousMousePosition = { x: e.clientX, y: e.clientY };
});

canvas.addEventListener('mouseup', () => { isDragging = false; });
canvas.addEventListener('mouseleave', () => { isDragging = false; });

// Scroll to zoom
canvas.addEventListener('wheel', (e) => {
  camera.position.z += e.deltaY * 0.001;
  camera.position.z = Math.max(1.5, Math.min(5, camera.position.z));
});

// Touch support
let lastTouchDistance = null;

canvas.addEventListener('touchstart', (e) => {
  if (e.touches.length === 1) {
    isDragging = true;
    previousMousePosition = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
});

canvas.addEventListener('touchmove', (e) => {
  if (e.touches.length === 1 && isDragging) {
    const deltaX = e.touches[0].clientX - previousMousePosition.x;
    const deltaY = e.touches[0].clientY - previousMousePosition.y;
    globe.rotation.y += deltaX * 0.005;
    globe.rotation.x += deltaY * 0.005;
    clouds.rotation.y = globe.rotation.y;
    previousMousePosition = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  if (e.touches.length === 2) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (lastTouchDistance) {
      camera.position.z -= (distance - lastTouchDistance) * 0.005;
      camera.position.z = Math.max(1.5, Math.min(5, camera.position.z));
    }
    lastTouchDistance = distance;
  }
});

canvas.addEventListener('touchend', () => {
  isDragging = false;
  lastTouchDistance = null;
});

// Window resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Animation loop
function animate() {
  requestAnimationFrame(animate);
  if (!isDragging) {
    globe.rotation.y += 0.0008;
    clouds.rotation.y += 0.0010;
  }
  renderer.render(scene, camera);
}

animate();