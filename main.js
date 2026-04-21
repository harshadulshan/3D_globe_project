import * as THREE from 'three';
import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-webgl';
import * as handPoseDetection from '@tensorflow-models/hand-pose-detection';

// Scene setup
const canvas = document.getElementById('globe-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 2.5;

const loader = new THREE.TextureLoader();

const earthDayTexture = loader.load('https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/earth_atmos_2048.jpg');
const earthNightTexture = loader.load('https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/earth_lights_2048.png');
const earthClouds = loader.load('https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/earth_clouds_1024.png');
const earthNormal = loader.load('https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/earth_normal_2048.jpg');
const earthSpecular = loader.load('https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/earth_specular_2048.jpg');

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
    void main() {
      vUv = uv;
      vNormal = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D dayTexture;
    uniform sampler2D nightTexture;
    uniform vec3 sunDirection;
    varying vec2 vUv;
    varying vec3 vNormal;
    void main() {
      float intensity = dot(vNormal, normalize(sunDirection));
      vec4 dayColor = texture2D(dayTexture, vUv);
      vec4 nightColor = texture2D(nightTexture, vUv);
      float blendFactor = smoothstep(-0.1, 0.3, intensity);
      gl_FragColor = mix(nightColor, dayColor, blendFactor);
    }
  `,
});

const globeGroup = new THREE.Group();
scene.add(globeGroup);

const globeGeometry = new THREE.SphereGeometry(1, 64, 64);
const globe = new THREE.Mesh(globeGeometry, dayNightMaterial);
globeGroup.add(globe);

const cloudGeometry = new THREE.SphereGeometry(1.01, 64, 64);
const cloudMaterial = new THREE.MeshPhongMaterial({
  map: earthClouds,
  transparent: true,
  opacity: 0.4,
});
globeGroup.add(new THREE.Mesh(cloudGeometry, cloudMaterial));

const atmosphereGeometry = new THREE.SphereGeometry(1.08, 64, 64);
const atmosphereMaterial = new THREE.MeshPhongMaterial({
  color: 0x0044ff,
  transparent: true,
  opacity: 0.08,
  side: THREE.FrontSide,
});
globeGroup.add(new THREE.Mesh(atmosphereGeometry, atmosphereMaterial));

const starGeometry = new THREE.BufferGeometry();
const starCount = 8000;
const starPositions = new Float32Array(starCount * 3);
for (let i = 0; i < starCount * 3; i++) {
  starPositions[i] = (Math.random() - 0.5) * 200;
}
starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
scene.add(new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xffffff, size: 0.07 })));

const sunLight = new THREE.DirectionalLight(0xffffff, 1.5);
sunLight.position.set(5, 3, 5);
scene.add(sunLight);
scene.add(new THREE.AmbientLight(0x111111));

// Helper
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
let userLat = null;
let userLon = null;

function addLocationMarker(lat, lon) {
  if (locationMarker) globeGroup.remove(locationMarker);
  locationMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.02, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0x00ffff })
  );
  const pos = latLonToVector3(lat, lon, 1.02);
  locationMarker.position.set(pos.x, pos.y, pos.z);
  globeGroup.add(locationMarker);
  globeGroup.rotation.y = -(lon + 180) * (Math.PI / 180);
}

// ISS marker
const issMarker = new THREE.Mesh(
  new THREE.SphereGeometry(0.03, 16, 16),
  new THREE.MeshBasicMaterial({ color: 0xff6600 })
);
globeGroup.add(issMarker);

async function fetchISS() {
  try {
    const res = await fetch('https://api.wheretheiss.at/v1/satellites/25544');
    const data = await res.json();
    const pos = latLonToVector3(data.latitude, data.longitude, 1.05);
    issMarker.position.set(pos.x, pos.y, pos.z);
    document.getElementById('iss-coords').textContent = `Lat: ${data.latitude.toFixed(2)}, Lon: ${data.longitude.toFixed(2)}`;
    document.getElementById('iss-alt').textContent = `Altitude: ${data.altitude.toFixed(1)} km`;
    document.getElementById('iss-vel').textContent = `Speed: ${data.velocity.toFixed(1)} km/h`;
  } catch {
    document.getElementById('iss-coords').textContent = 'ISS data unavailable';
  }
}
fetchISS();
setInterval(fetchISS, 5000);

// Earthquake markers
const earthquakeMarkers = [];

async function fetchEarthquakes() {
  try {
    const res = await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson');
    const data = await res.json();
    earthquakeMarkers.forEach(m => globeGroup.remove(m));
    earthquakeMarkers.length = 0;

    data.features.forEach(quake => {
      const [lon, lat] = quake.geometry.coordinates;
      const mag = quake.properties.mag;
      if (!mag || mag < 1) return;

      const size = Math.max(0.008, mag * 0.008);
      const color = mag >= 6 ? 0xff0000 : mag >= 4 ? 0xff6600 : 0xffff00;

      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(size, 8, 8),
        new THREE.MeshBasicMaterial({ color })
      );
      const pos = latLonToVector3(lat, lon, 1.02);
      marker.position.set(pos.x, pos.y, pos.z);
      marker.userData = { lat, lon, mag, place: quake.properties.place };
      globeGroup.add(marker);
      earthquakeMarkers.push(marker);
    });
  } catch {
    console.log('Earthquake data unavailable');
  }
}
fetchEarthquakes();
setInterval(fetchEarthquakes, 60000);

// Terminator
function getSunPosition() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((now - start) / 86400000);
  const declination = -23.45 * Math.cos((360 / 365) * (dayOfYear + 10) * Math.PI / 180);
  const hours = now.getUTCHours() + now.getUTCMinutes() / 60;
  const sunLon = -(hours - 12) * 15;
  return { lat: declination, lon: sunLon };
}

function drawTerminator() {
  const existing = globeGroup.getObjectByName('terminator');
  if (existing) globeGroup.remove(existing);
  const sun = getSunPosition();
  const sunLatRad = sun.lat * Math.PI / 180;
  if (Math.abs(sun.lat) >= 89.9) return;
  const points = [];
  for (let lon = -180; lon <= 180; lon += 2) {
    const lonRad = (lon - sun.lon) * Math.PI / 180;
    const tanVal = -Math.cos(lonRad) / Math.tan(sunLatRad);
    const lat = Math.atan(tanVal) * 180 / Math.PI;
    if (isFinite(lat)) points.push(latLonToVector3(lat, lon, 1.015));
  }
  if (points.length < 2) return;
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.7 }));
  line.name = 'terminator';
  globeGroup.add(line);
}
drawTerminator();
setInterval(drawTerminator, 60000);

// Country borders
async function drawCountryBorders() {
  try {
    const res = await fetch('https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson');
    const data = await res.json();
    const allPoints = [];
    data.features.forEach(feature => {
      const geometries = feature.geometry.type === 'MultiPolygon'
        ? feature.geometry.coordinates
        : [feature.geometry.coordinates];
      geometries.forEach(polygon => {
        polygon.forEach(ring => {
          ring.forEach(([lon, lat]) => allPoints.push(latLonToVector3(lat, lon, 1.002)));
          allPoints.push(new THREE.Vector3(NaN, NaN, NaN));
        });
      });
    });
    const geometry = new THREE.BufferGeometry().setFromPoints(allPoints);
    globeGroup.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.15 })));
  } catch {
    console.log('Country borders unavailable');
  }
}
drawCountryBorders();

// Geolocation
if (navigator.geolocation) {
  navigator.geolocation.getCurrentPosition((pos) => {
    userLat = pos.coords.latitude;
    userLon = pos.coords.longitude;
    document.getElementById('coords').textContent = `Lat: ${userLat.toFixed(4)}, Lon: ${userLon.toFixed(4)}`;
    addLocationMarker(userLat, userLon);
    fetchWeather(userLat, userLon);
  }, () => {
    document.getElementById('coords').textContent = 'Location access denied';
  });
}

async function fetchWeather(lat, lon) {
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`);
    const data = await res.json();
    document.getElementById('weather').textContent = `Temp: ${data.current_weather.temperature}°C | Wind: ${data.current_weather.windspeed} km/h`;
  } catch {
    document.getElementById('weather').textContent = 'Weather unavailable';
  }
}

// UTC Clock
function updateClock() {
  const now = new Date();
  document.getElementById('utc-time').textContent = `UTC: ${now.toUTCString().slice(17, 25)}`;
}
setInterval(updateClock, 1000);
updateClock();

// Mouse controls
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const clickPopup = document.getElementById('click-popup');
let mouseDownPos = { x: 0, y: 0 };
let isDragging = false;
let previousMousePosition = { x: 0, y: 0 };

canvas.addEventListener('mousedown', (e) => {
  isDragging = true;
  mouseDownPos = { x: e.clientX, y: e.clientY };
  previousMousePosition = { x: e.clientX, y: e.clientY };
});

canvas.addEventListener('click', async (e) => {
  const dx = e.clientX - mouseDownPos.x;
  const dy = e.clientY - mouseDownPos.y;
  if (Math.sqrt(dx * dx + dy * dy) > 5) return;

  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObject(globe);

  if (intersects.length > 0) {
    const localPoint = intersects[0].point.clone();
    globeGroup.worldToLocal(localPoint);
    localPoint.normalize();
    const lat = Math.asin(Math.max(-1, Math.min(1, localPoint.y))) * 180 / Math.PI;
    let lon = Math.atan2(localPoint.x, -localPoint.z) * 180 / Math.PI;
    lon = -(lon + 180);
    const rotationDeg = (globeGroup.rotation.y * 180 / Math.PI) % 360;
    lon = lon + rotationDeg;
    if (lon > 180) lon -= 360;
    if (lon < -180) lon += 360;
    lon = -lon;

    document.getElementById('popup-country').textContent = 'Looking up...';
    document.getElementById('popup-coords').textContent = `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`;
    clickPopup.style.display = 'block';
    clickPopup.style.left = e.clientX + 15 + 'px';
    clickPopup.style.top = e.clientY - 10 + 'px';

    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=6&accept-language=en`);
      const data = await res.json();
      document.getElementById('popup-country').textContent = data?.address?.country || 'Ocean / Unknown';
    } catch {
      document.getElementById('popup-country').textContent = 'Ocean / Unknown';
    }
    setTimeout(() => { clickPopup.style.display = 'none'; }, 4000);
  }
});

canvas.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  globeGroup.rotation.y += (e.clientX - previousMousePosition.x) * 0.005;
  globeGroup.rotation.x += (e.clientY - previousMousePosition.y) * 0.005;
  previousMousePosition = { x: e.clientX, y: e.clientY };
});

canvas.addEventListener('mouseup', () => { isDragging = false; });
canvas.addEventListener('mouseleave', () => { isDragging = false; });

canvas.addEventListener('wheel', (e) => {
  camera.position.z += e.deltaY * 0.001;
  camera.position.z = Math.max(1.5, Math.min(5, camera.position.z));
});

let lastTouchDistance = null;
canvas.addEventListener('touchstart', (e) => {
  if (e.touches.length === 1) {
    isDragging = true;
    previousMousePosition = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
});
canvas.addEventListener('touchmove', (e) => {
  if (e.touches.length === 1 && isDragging) {
    globeGroup.rotation.y += (e.touches[0].clientX - previousMousePosition.x) * 0.005;
    globeGroup.rotation.x += (e.touches[0].clientY - previousMousePosition.y) * 0.005;
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
canvas.addEventListener('touchend', () => { isDragging = false; lastTouchDistance = null; });

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Hand gesture setup
const webcamElement = document.getElementById('webcam');
const handCanvas = document.getElementById('hand-canvas');
const handCtx = handCanvas.getContext('2d');
const gestureLabel = document.getElementById('gesture-label');

let detector = null;
let lastHandX = null;
let lastHandY = null;
let lastPinchDistance = null;

async function setupHandDetection() {
  await tf.setBackend('webgl');
  await tf.ready();

  const model = handPoseDetection.SupportedModels.MediaPipeHands;
  const detectorConfig = {
    runtime: 'tfjs',
    modelType: 'lite',
    maxHands: 1,
  };

  detector = await handPoseDetection.createDetector(model, detectorConfig);

  const stream = await navigator.mediaDevices.getUserMedia({ video: true });
  webcamElement.srcObject = stream;

  webcamElement.onloadedmetadata = () => {
    handCanvas.width = webcamElement.videoWidth;
    handCanvas.height = webcamElement.videoHeight;
    detectHands();
  };
}

function getFingerTip(hand, finger) {
  const tips = { thumb: 4, index: 8, middle: 12, ring: 16, pinky: 20 };
  return hand.keypoints[tips[finger]];
}

function getPinchDistance(hand) {
  const thumb = getFingerTip(hand, 'thumb');
  const index = getFingerTip(hand, 'index');
  if (!thumb || !index) return null;
  return Math.sqrt(Math.pow(thumb.x - index.x, 2) + Math.pow(thumb.y - index.y, 2));
}

function countRaisedFingers(hand) {
  const tips = [8, 12, 16, 20];
  const bases = [6, 10, 14, 18];
  let count = 0;
  tips.forEach((tip, i) => {
    if (hand.keypoints[tip].y < hand.keypoints[bases[i]].y) count++;
  });
  return count;
}

async function detectHands() {
  if (!detector) return;

  handCtx.clearRect(0, 0, handCanvas.width, handCanvas.height);

  const hands = await detector.estimateHands(webcamElement);

  if (hands.length > 0) {
    const hand = hands[0];

    // Draw hand dots
    hand.keypoints.forEach(kp => {
      handCtx.beginPath();
      handCtx.arc(kp.x, kp.y, 4, 0, Math.PI * 2);
      handCtx.fillStyle = '#00ffff';
      handCtx.fill();
    });

    const wrist = hand.keypoints[0];
    const raisedFingers = countRaisedFingers(hand);
    const pinchDist = getPinchDistance(hand);

    // Open hand — rotate globe
    if (raisedFingers >= 3) {
      gestureLabel.textContent = '✋ Gesture: Rotating';
      if (lastHandX !== null && lastHandY !== null) {
        const deltaX = wrist.x - lastHandX;
        const deltaY = wrist.y - lastHandY;
        globeGroup.rotation.y += deltaX * 0.01;
        globeGroup.rotation.x += deltaY * 0.01;
      }
      lastHandX = wrist.x;
      lastHandY = wrist.y;
      lastPinchDistance = null;

    // Pinch — zoom
    } else if (raisedFingers <= 1 && pinchDist !== null) {
      gestureLabel.textContent = '🤏 Gesture: Zooming';
      if (lastPinchDistance !== null) {
        const delta = pinchDist - lastPinchDistance;
        camera.position.z -= delta * 0.01;
        camera.position.z = Math.max(1.5, Math.min(5, camera.position.z));
      }
      lastPinchDistance = pinchDist;
      lastHandX = null;
      lastHandY = null;

    } else {
      gestureLabel.textContent = '🤚 Gesture: Detected';
      lastHandX = null;
      lastHandY = null;
      lastPinchDistance = null;
    }

  } else {
    gestureLabel.textContent = '🤚 Gesture: None';
    lastHandX = null;
    lastHandY = null;
    lastPinchDistance = null;
  }

  requestAnimationFrame(detectHands);
}

setupHandDetection().catch(err => {
  console.log('Hand detection setup failed:', err);
  gestureLabel.textContent = '❌ Camera unavailable';
});

// Animation loop
function animate() {
  requestAnimationFrame(animate);
  if (!isDragging) {
    globeGroup.rotation.y += 0.0008;
  }
  renderer.render(scene, camera);
}

animate();
