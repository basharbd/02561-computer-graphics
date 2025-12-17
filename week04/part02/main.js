"use strict";

// ---------------------------------------------------------
// Helpers: sphere from subdivided tetrahedron (with edge cache)
// ---------------------------------------------------------

function edgeKey(a, b) {
  return (a < b) ? `${a}_${b}` : `${b}_${a}`;
}

function subdivideOnce(positions, indices) {
  const newPositions = positions.slice();
  const newIndices = [];
  const midpointCache = new Map(); // edgeKey -> new vertex index

  function getMid(i0, i1) {
    const key = edgeKey(i0, i1);
    if (midpointCache.has(key)) return midpointCache.get(key);

    const m = normalize(add(newPositions[i0], newPositions[i1])); // project to unit sphere
    const idx = newPositions.length;
    newPositions.push(m);
    midpointCache.set(key, idx);
    return idx;
  }

  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t + 0];
    const i1 = indices[t + 1];
    const i2 = indices[t + 2];

    const a = getMid(i0, i1);
    const b = getMid(i1, i2);
    const c = getMid(i2, i0);

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

// ---------------------------------------------------------
// Main
// ---------------------------------------------------------

async function main() {
  // --- WebGPU setup ---
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();

  const canvas = document.getElementById("my-canvas");
  const context = canvas.getContext("webgpu");
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();

  context.configure({ device, format: canvasFormat });

  // --- Base tetrahedron (normalized) ---
  const M_SQRT2 = Math.sqrt(2.0);
  const M_SQRT6 = Math.sqrt(6.0);

  const basePositions = [
    vec3(0.0, 0.0, 1.0),
    vec3(0.0, (2.0 * M_SQRT2) / 3.0, -1.0 / 3.0),
    vec3(-M_SQRT6 / 3.0, -M_SQRT2 / 3.0, -1.0 / 3.0),
    vec3( M_SQRT6 / 3.0, -M_SQRT2 / 3.0, -1.0 / 3.0),
  ].map(v => normalize(v));

  const baseIndices = new Uint32Array([
    0, 1, 2,
    0, 3, 1,
    1, 3, 2,
    0, 2, 3,
  ]);

  // --- UI state ---
  const maxSubdivisions = 8;
  let subdivisions = 0;
  const valueText = document.getElementById("value");
  valueText.textContent = subdivisions;

  // --- Buffer sizing (FIXED) ---
  // Base triangles = 4, each level multiplies by 4
  // triangles(L) = 4 * 4^L
  // indexCount(L) = 3 * triangles(L) = 12 * 4^L
  const maxIndexCount = 12 * (4 ** maxSubdivisions);
  const maxIndexBytes = maxIndexCount * 4;         // uint32
  const maxVertexCount = maxIndexCount;            // safe upper bound
  const maxVertexBytes = maxVertexCount * 3 * 4;   // vec3f -> 3 floats

  const positionBuffer = device.createBuffer({
    size: maxVertexBytes,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });

  const indexBuffer = device.createBuffer({
    size: maxIndexBytes,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });

  const posLayout = {
    arrayStride: sizeof["vec3"],
    attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }],
  };

  // --- MVP (as you did, but simplified) ---
  const CLEAR = vec4(0.3921, 0.5843, 0.9294, 1.0);

  // WebGPU depth is [0,1] like DirectX -> keep your Mst trick
  const Mst = mat4(
    1.0, 0.0, 0.0, 0.0,
    0.0, 1.0, 0.0, 0.0,
    0.0, 0.0, 0.5, 0.5,
    0.0, 0.0, 0.0, 1.0
  );

  let P = perspective(45, canvas.width / canvas.height, 0.1, 100.0);
  P = mult(Mst, P);

  const eye = vec3(0, 0, 3);
  const V = lookAt(eye, vec3(0, 0, 0), vec3(0, 1, 0));
  const M = mat4(); // identity
  const mvp = mult(P, mult(V, M));

  const uniformBuffer = device.createBuffer({
    size: sizeof["mat4"],
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, flatten(mvp));

  // --- Shader + pipeline ---
  const wgslURL = document.getElementById("wgsl").src;
  const wgslCode = await fetch(wgslURL, { cache: "reload" }).then(r => r.text());
  const shader = device.createShaderModule({ code: wgslCode });

  const FRONT_FACE = "ccw"; // if looks wrong with culling -> change to "cw"

  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: shader, entryPoint: "main_vs", buffers: [posLayout] },
    fragment: { module: shader, entryPoint: "main_fs", targets: [{ format: canvasFormat }] },

    primitive: {
      topology: "triangle-list",
      frontFace: FRONT_FACE,
      cullMode: "back",
    },

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

  // --- Depth texture ---
  const depthTexture = device.createTexture({
    size: { width: canvas.width, height: canvas.height },
    format: "depth24plus",
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  // --- Current mesh ---
  let positions = [];
  let indices = new Uint32Array([]);

  function uploadMesh() {
    const mesh = buildSphere(subdivisions, basePositions, baseIndices);
    positions = mesh.positions;
    indices = mesh.indices;

    device.queue.writeBuffer(positionBuffer, 0, flatten(positions));
    device.queue.writeBuffer(indexBuffer, 0, indices);
  }

  function render() {
    const encoder = device.createCommandEncoder();

    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: CLEAR[0], g: CLEAR[1], b: CLEAR[2], a: CLEAR[3] },
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
    pass.setIndexBuffer(indexBuffer, "uint32");
    pass.drawIndexed(indices.length);
    pass.end();

    device.queue.submit([encoder.finish()]);
  }

  // --- UI ---
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

  // First draw
  uploadMesh();
  render();
}

window.onload = () => { main(); };
