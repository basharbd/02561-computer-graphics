"use strict";

// Sphere via recursive subdivision (midpoint cache)

function edgeKey(i, j) {
  // Stable edge key (order-independent)
  return (i < j) ? `${i}_${j}` : `${j}_${i}`;
}

function subdivideOnce(positions, indices) {
  // Create a refined mesh from one subdivision step
  const newPositions = positions.slice();
  const newIndices = [];
  const cache = new Map(); // edgeKey -> midpointIndex

  function midpointIndex(i0, i1) {
    // Reuse midpoint vertices so shared edges don't create duplicates
    const key = edgeKey(i0, i1);
    if (cache.has(key)) return cache.get(key);

    // Midpoint projected back onto the unit sphere
    const m = normalize(add(newPositions[i0], newPositions[i1]));
    const idx = newPositions.length;
    newPositions.push(m);

    cache.set(key, idx);
    return idx;
  }

  for (let t = 0; t < indices.length; t += 3) {
    // Original triangle (i0, i1, i2)
    const i0 = indices[t + 0];
    const i1 = indices[t + 1];
    const i2 = indices[t + 2];

    // Midpoints on each edge
    const a = midpointIndex(i0, i1);
    const b = midpointIndex(i1, i2);
    const c = midpointIndex(i2, i0);

    // Split into 4 triangles (keep CCW winding)
    newIndices.push(
      i0, a, c,
      a, i1, b,
      c, b, i2,
      a, b, c
    );
  }

  return { positions: newPositions, indices: new Uint32Array(newIndices) };
}

function buildSphere(level, basePositions, baseIndices) {
  // Repeated subdivision starting from the base tetrahedron
  let pos = basePositions.slice();
  let ind = new Uint32Array(baseIndices);

  for (let k = 0; k < level; k++) {
    const r = subdivideOnce(pos, ind);
    pos = r.positions;
    ind = r.indices;
  }
  return { positions: pos, indices: ind };
}

async function main() {
  // Basic WebGPU availability checks
  const gpu = navigator.gpu;
  if (!gpu) {
    alert("WebGPU not supported in this browser.");
    return;
  }

  const adapter = await gpu.requestAdapter();
  if (!adapter) {
    alert("No suitable GPU adapter found.");
    return;
  }
  const device = await adapter.requestDevice();

  // Canvas + context
  const canvas = document.getElementById("my-canvas");
  const context = canvas.getContext("webgpu");
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: canvasFormat });

  // Base tetrahedron (normalized to unit sphere)
  const M_SQRT2 = Math.sqrt(2.0);
  const M_SQRT6 = Math.sqrt(6.0);

  const basePositions = [
    vec3(0.0, 0.0, 1.0),
    vec3(0.0, 2.0 * M_SQRT2 / 3.0, -1.0 / 3.0),
    vec3(-M_SQRT6 / 3.0, -M_SQRT2 / 3.0, -1.0 / 3.0),
    vec3(M_SQRT6 / 3.0, -M_SQRT2 / 3.0, -1.0 / 3.0),
  ].map(v => normalize(v));

  const baseIndices = new Uint32Array([
    0, 1, 2,
    0, 3, 1,
    1, 3, 2,
    0, 2, 3,
  ]);

  // UI: subdivision controls
  const maxSubdivisions = 8;
  let subdivisions = 0;

  const valueText = document.getElementById("value");
  valueText.textContent = subdivisions;

  // UI: shading parameters
  const elLe = document.getElementById("emitted-radiance");
  const elLa = document.getElementById("ambient-radiance");
  const elKd = document.getElementById("diffuse");
  const elKs = document.getElementById("specular");
  const elS  = document.getElementById("shininess");

  const vLe = document.getElementById("val-Le");
  const vLa = document.getElementById("val-La");
  const vKd = document.getElementById("val-kd");
  const vKs = document.getElementById("val-ks");
  const vS  = document.getElementById("val-s");

  let Le = parseFloat(elLe.value);
  let La = parseFloat(elLa.value);
  let kd = parseFloat(elKd.value);
  let ks = parseFloat(elKs.value);
  let shininess = parseFloat(elS.value);

  function syncSliderText() {
    // Keep slider readouts in sync with current values
    vLe.textContent = Le.toFixed(2);
    vLa.textContent = La.toFixed(2);
    vKd.textContent = kd.toFixed(2);
    vKs.textContent = ks.toFixed(2);
    vS.textContent  = (shininess >= 100 ? shininess.toFixed(0) : shininess.toFixed(1));
  }
  syncSliderText();

  function onSliderInput() {
    // Update params and redraw
    Le = parseFloat(elLe.value);
    La = parseFloat(elLa.value);
    kd = parseFloat(elKd.value);
    ks = parseFloat(elKs.value);
    shininess = parseFloat(elS.value);
    syncSliderText();
    requestAnimationFrame(render);
  }

  elLe.addEventListener("input", onSliderInput);
  elLa.addEventListener("input", onSliderInput);
  elKd.addEventListener("input", onSliderInput);
  elKs.addEventListener("input", onSliderInput);
  elS.addEventListener("input", onSliderInput);

  // Camera orbit animation state
  let shouldAnimate = false;
  const btnAnim = document.getElementById("toggle-animate");

  const orbitR = 4.0;
  let angle = 0.0;
  let lastTime = performance.now();

  btnAnim.onclick = () => {
    // Toggle orbit animation
    shouldAnimate = !shouldAnimate;
    btnAnim.textContent = shouldAnimate ? "Stop" : "Animate";
    if (shouldAnimate) {
      lastTime = performance.now();
      requestAnimationFrame(animate);
    }
  };

  // Buffer sizing for worst case (safe upper bounds)
  // triangles(L) = 4 * 4^L, indexCount(L) = 12 * 4^L
  const maxIndexCount = 12 * (4 ** maxSubdivisions);
  const maxIndexBytes = Uint32Array.BYTES_PER_ELEMENT * maxIndexCount;

  // Conservative vertex bound (enough space for all midpoints)
  const maxVertexCount = maxIndexCount;
  const maxVertexBytes = sizeof["vec3"] * maxVertexCount;

  const positionBuffer = device.createBuffer({
    size: maxVertexBytes,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });

  const indicesBuffer = device.createBuffer({
    size: maxIndexBytes,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });

  const positionBufferLayout = {
    arrayStride: sizeof["vec3"],
    attributes: [{
      format: "float32x3",
      offset: 0,
      shaderLocation: 0,
    }],
  };

  // Background color
  const bgcolor = vec4(0.3921, 0.5843, 0.9294, 1.0);

  // Depth fix: MV.js projection helpers often assume clip z in [-1,1], WebGPU expects [0,1]
  const Mst = mat4(
    1.0, 0.0, 0.0, 0.0,
    0.0, 1.0, 0.0, 0.0,
    0.0, 0.0, 0.5, 0.5,
    0.0, 0.0, 0.0, 1.0
  );

  let P = perspective(45, canvas.width / canvas.height, 0.1, 100.0);
  P = mult(Mst, P);

  const M = mat4(); // model = identity

  // Uniform layout (mat4 + 3 vec4) = 28 floats
  const uniformFloats = new Float32Array(28);

  const uniformBuffer = device.createBuffer({
    size: uniformFloats.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // Load WGSL and create pipeline
  const wgslfile = document.getElementById("wgsl").src;
  const wgslcode = await fetch(wgslfile, { cache: "reload" }).then(r => r.text());
  const wgsl = device.createShaderModule({ code: wgslcode });

  const msaaCount = 4;

  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: wgsl,
      entryPoint: "main_vs",
      buffers: [positionBufferLayout],
    },
    fragment: {
      module: wgsl,
      entryPoint: "main_fs",
      targets: [{ format: canvasFormat }],
    },
    primitive: {
      topology: "triangle-list",
      frontFace: "ccw",
      cullMode: "back",
    },
    multisample: { count: msaaCount },
    depthStencil: {
      depthWriteEnabled: true,
      depthCompare: "less",
      format: "depth24plus",
    },
  });

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  // MSAA + depth attachments
  const msaaTexture = device.createTexture({
    size: { width: canvas.width, height: canvas.height },
    format: canvasFormat,
    sampleCount: msaaCount,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  const depthTexture = device.createTexture({
    size: { width: canvas.width, height: canvas.height },
    format: "depth24plus",
    sampleCount: msaaCount,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  // Current mesh data
  let positions = [];
  let indices = new Uint32Array([]);

  function uploadMesh() {
    // Rebuild sphere mesh for current subdivision level and upload
    const mesh = buildSphere(subdivisions, basePositions, baseIndices);
    positions = mesh.positions;
    indices = mesh.indices;

    device.queue.writeBuffer(positionBuffer, 0, flatten(positions));
    device.queue.writeBuffer(indicesBuffer, 0, indices);
  }

  // Subdivision buttons
  document.getElementById("plus").onclick = () => {
    if (subdivisions < maxSubdivisions) {
      subdivisions++;
      valueText.textContent = subdivisions;
      uploadMesh();
      requestAnimationFrame(render);
    }
  };

  document.getElementById("minus").onclick = () => {
    if (subdivisions > 0) {
      subdivisions--;
      valueText.textContent = subdivisions;
      uploadMesh();
      requestAnimationFrame(render);
    }
  };

  function updateUniforms() {
    // Orbiting eye point around Y axis
    const eye = vec3(orbitR * Math.sin(angle), 0.0, orbitR * Math.cos(angle));
    const V = lookAt(eye, vec3(0, 0, 0), vec3(0, 1, 0));
    const mvp = mult(P, mult(V, M));

    // Pack uniforms: mvp | eye | (Le,La,kd,ks) | (shininess,0,0,0)
    uniformFloats.set(flatten(mvp), 0);
    uniformFloats.set([eye[0], eye[1], eye[2], 1.0], 16);
    uniformFloats.set([Le, La, kd, ks], 20);
    uniformFloats.set([shininess, 0.0, 0.0, 0.0], 24);

    device.queue.writeBuffer(uniformBuffer, 0, uniformFloats);
  }

  function render() {
    // Update camera + shading params before drawing
    updateUniforms();

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: msaaTexture.createView(),
        resolveTarget: context.getCurrentTexture().createView(),
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: bgcolor[0], g: bgcolor[1], b: bgcolor[2], a: bgcolor[3] },
      }],
      depthStencilAttachment: {
        view: depthTexture.createView(),
        depthLoadOp: "clear",
        depthClearValue: 1.0,
        depthStoreOp: "store",
      },
    });

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, positionBuffer);
    pass.setIndexBuffer(indicesBuffer, "uint32");
    pass.drawIndexed(indices.length);

    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  function animate(ts) {
    // Simple time-based orbit step
    const dt = ts - lastTime;
    lastTime = ts;
    angle += dt * 0.0025;

    render();
    if (shouldAnimate) requestAnimationFrame(animate);
  }

  // Initial mesh + first draw
  uploadMesh();
  render();
}

window.onload = () => { main(); };
