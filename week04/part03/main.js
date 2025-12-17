"use strict";

// ============================================================
// Sphere subdivision (simple + safe buffer sizing)
// ============================================================

function edgeKey(i, j) {
  return (i < j) ? `${i}_${j}` : `${j}_${i}`;
}

function subdivideOnce(positions, indices) {
  const newPositions = positions.slice();
  const newIndices = [];
  const cache = new Map(); // edgeKey -> midpointIndex

  function midpointIndex(i0, i1) {
    const key = edgeKey(i0, i1);
    if (cache.has(key)) return cache.get(key);

    const m = normalize(add(newPositions[i0], newPositions[i1])); // project to unit sphere
    const idx = newPositions.length;
    newPositions.push(m);
    cache.set(key, idx);
    return idx;
  }

  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t + 0];
    const i1 = indices[t + 1];
    const i2 = indices[t + 2];

    const a = midpointIndex(i0, i1);
    const b = midpointIndex(i1, i2);
    const c = midpointIndex(i2, i0);

    // 4 triangles
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
  let pos = basePositions.slice();
  let ind = new Uint32Array(baseIndices);

  for (let k = 0; k < level; k++) {
    const r = subdivideOnce(pos, ind);
    pos = r.positions;
    ind = r.indices;
  }
  return { positions: pos, indices: ind };
}

// ============================================================
// Main
// ============================================================

async function main() {
  const gpu = navigator.gpu;
  const adapter = await gpu.requestAdapter();
  const device = await adapter.requestDevice();

  const canvas = document.getElementById("my-canvas");
  const context = canvas.getContext("webgpu");
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();

  context.configure({ device, format: canvasFormat });

  // ----------------------------
  // Base tetrahedron (normalized)
  // ----------------------------
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

  // ----------------------------
  // UI state
  // ----------------------------
  const maxSubdivisions = 8;
  let subdivisions = 0;

  const valueText = document.getElementById("value");
  valueText.textContent = subdivisions;

  // ----------------------------
  // Correct max buffer sizing
  // triangles(level L) = 4 * 4^L = 4^(L+1)
  // indexCount = 3 * triangles = 12 * 4^L
  // ----------------------------
  const maxIndexCount = 12 * (4 ** maxSubdivisions);
  const maxIndexBytes = 4 * maxIndexCount;                 // uint32
  const maxVertexCount = maxIndexCount;                    // safe upper bound
  const maxVertexBytes = 4 * 3 * maxVertexCount;           // vec3f

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
    attributes: [{ format: "float32x3", offset: 0, shaderLocation: 0 }],
  };

  // ----------------------------
  // Camera + MVP (WebGPU depth [0,1])
  // ----------------------------
  const bgcolor = vec4(0.3921, 0.5843, 0.9294, 1.0);

  const Mst = mat4(
    1.0, 0.0, 0.0, 0.0,
    0.0, 1.0, 0.0, 0.0,
    0.0, 0.0, 0.5, 0.5,
    0.0, 0.0, 0.0, 1.0
  );

  let P = perspective(45, canvas.width / canvas.height, 0.1, 100.0);
  P = mult(Mst, P);

  const M = mat4(); // identity model

  // uniform buffer stores MVP
  const uniformBuffer = device.createBuffer({
    size: sizeof["mat4"],
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // ----------------------------
  // WGSL + pipeline (depth + culling + MSAA)
  // ----------------------------
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
      format: "depth24plus",
      depthWriteEnabled: true,
      depthCompare: "less",
    },
  });

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  // MSAA + depth textures
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

  // ----------------------------
  // Mesh state
  // ----------------------------
  let positions = [];
  let indices = new Uint32Array([]);

  function updateMesh() {
    const mesh = buildSphere(subdivisions, basePositions, baseIndices);
    positions = mesh.positions;
    indices = mesh.indices;

    device.queue.writeBuffer(positionBuffer, 0, flatten(positions));
    device.queue.writeBuffer(indicesBuffer, 0, indices);
  }

  // ----------------------------
  // Orbit camera animation
  // ----------------------------
  let shouldAnimate = false;
  const animBtn = document.getElementById("toggle-animate");

  const orbit = {
    r: 4.0,
    y: 1.0,
    angle: 0.0,
    speed: 0.9, // radians/sec (feel free to tweak)
    lastT: performance.now()
  };

  function writeMVP() {
    const eye = vec3(
      orbit.r * Math.sin(orbit.angle),
      orbit.y,
      orbit.r * Math.cos(orbit.angle)
    );
    const V = lookAt(eye, vec3(0, 0, 0), vec3(0, 1, 0));
    const mvp = mult(P, mult(V, M));
    device.queue.writeBuffer(uniformBuffer, 0, flatten(mvp));
  }

  function render() {
    writeMVP();

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

  function animate(t) {
    const dt = (t - orbit.lastT) / 1000.0;
    orbit.lastT = t;
    orbit.angle += orbit.speed * dt;

    render();

    if (shouldAnimate) requestAnimationFrame(animate);
  }

  // ----------------------------
  // UI handlers
  // ----------------------------
  document.getElementById("plus").onclick = () => {
    if (subdivisions < maxSubdivisions) {
      subdivisions++;
      valueText.textContent = subdivisions;
      updateMesh();
      render();
    }
  };

  document.getElementById("minus").onclick = () => {
    if (subdivisions > 0) {
      subdivisions--;
      valueText.textContent = subdivisions;
      updateMesh();
      render();
    }
  };

  animBtn.onclick = () => {
    shouldAnimate = !shouldAnimate;
    animBtn.textContent = shouldAnimate ? "Animate: ON" : "Animate: OFF";
    orbit.lastT = performance.now();
    if (shouldAnimate) requestAnimationFrame(animate);
  };

  // First draw
  updateMesh();
  render();
}

window.onload = () => { main(); };
