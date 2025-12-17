"use strict";

// ============================================================
// Subdivision sphere (tetrahedron -> subdivide -> project to unit sphere)
// ============================================================

function edgeKey(i, j) {
  return (i < j) ? `${i}_${j}` : `${j}_${i}`;
}

function subdivideOnce(positions, indices) {
  const newPositions = positions.slice();   // copy array of vec3
  const newIndices = [];
  const cache = new Map();                  // edgeKey -> midpoint vertex index

  function getMid(i0, i1) {
    const key = edgeKey(i0, i1);
    if (cache.has(key)) return cache.get(key);

    const m = normalize(add(newPositions[i0], newPositions[i1])); // on unit sphere
    const idx = newPositions.length;
    newPositions.push(m);
    cache.set(key, idx);
    return idx;
  }

  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t + 0];
    const i1 = indices[t + 1];
    const i2 = indices[t + 2];

    const a = getMid(i0, i1);
    const b = getMid(i1, i2);
    const c = getMid(i2, i0);

    // 4 new triangles
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

// tetrahedron subdivision closed-form counts:
// triangles(L) = 4^(L+1)
// indices(L)   = 3 * triangles(L) = 3*4^(L+1) = 12*4^L
// vertices(L)  = 2*4^L + 2
function maxCounts(maxLevel) {
  const pow = 4 ** maxLevel;
  const maxVertexCount = 2 * pow + 2;
  const maxIndexCount = 12 * pow;
  return { maxVertexCount, maxIndexCount };
}

// ============================================================
// Main
// ============================================================

async function main() {
  const gpu = navigator.gpu;
  const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
  const device = await adapter.requestDevice();

  const canvas = document.getElementById("my-canvas");
  const context = canvas.getContext("webgpu");
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();

  context.configure({
    device,
    format: canvasFormat,
    alphaMode: "opaque",
  });

  // ----------------------------
  // Base tetrahedron on unit sphere
  // ----------------------------
  const M_SQRT2 = Math.sqrt(2.0);
  const M_SQRT6 = Math.sqrt(6.0);

  const basePositions = [
    vec3(0.0, 0.0, 1.0),
    vec3(0.0, 2.0 * M_SQRT2 / 3.0, -1.0 / 3.0),
    vec3(-M_SQRT6 / 3.0, -M_SQRT2 / 3.0, -1.0 / 3.0),
    vec3( M_SQRT6 / 3.0, -M_SQRT2 / 3.0, -1.0 / 3.0),
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
  // Correct GPU buffer sizes (based on maxSubdivisions)
  // ----------------------------
  const { maxVertexCount, maxIndexCount } = maxCounts(maxSubdivisions);

  const maxVertexBytes = maxVertexCount * 3 * 4; // vec3f -> 3 floats
  const maxIndexBytes  = maxIndexCount * 4;      // uint32

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

  // ----------------------------
  // Depth (Z-buffer)
  // ----------------------------
  const depthFormat = "depth24plus";
  let depthTexture = device.createTexture({
    size: { width: canvas.width, height: canvas.height },
    format: depthFormat,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  // ----------------------------
  // MVP (DirectX/WebGPU depth: [0,1]) => apply Mst on projection
  // ----------------------------
  const bgcolor = vec4(0.3921, 0.5843, 0.9294, 1.0);

  perceivedNeedsMstNote();

  const Mst = mat4(
    1.0, 0.0, 0.0, 0.0,
    0.0, 1.0, 0.0, 0.0,
    0.0, 0.0, 0.5, 0.5,
    0.0, 0.0, 0.0, 1.0
  );

  let P = perspective(45, canvas.width / canvas.height, 0.1, 100.0);
  P = mult(Mst, P);

  const eye = vec3(0, 0, -4);
  const V = lookAt(eye, vec3(0, 0, 0), vec3(0, 1, 0));
  const M = mat4(); // identity

  const mvp = mult(P, mult(V, M));

  const uniformBuffer = device.createBuffer({
    size: sizeof["mat4"],
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, flatten(mvp));

  // ----------------------------
  // Load WGSL + pipeline (with depthStencil)
  // ----------------------------
  const wgslfile = document.getElementById("wgsl").src;
  const wgslcode = await fetch(wgslfile, { cache: "reload" }).then(r => r.text());
  const wgsl = device.createShaderModule({ code: wgslcode });

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
    primitive: { topology: "triangle-list" },
    depthStencil: {
      format: depthFormat,
      depthWriteEnabled: true,
      depthCompare: "less",
    },
  });

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  // ----------------------------
  // Current mesh
  // ----------------------------
  let positions = [];
  let indices = new Uint32Array([]);

  function updateMeshAndUpload() {
    const mesh = buildSphere(subdivisions, basePositions, baseIndices);
    positions = mesh.positions;
    indices = mesh.indices;

    // upload only what we need (buffer big enough already)
    device.queue.writeBuffer(positionBuffer, 0, flatten(positions));
    device.queue.writeBuffer(indicesBuffer, 0, indices);
  }

  function render() {
    const encoder = device.createCommandEncoder();

    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
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

  // ----------------------------
  // UI handlers
  // ----------------------------
  document.getElementById("plus").onclick = () => {
    if (subdivisions < maxSubdivisions) {
      subdivisions++;
      valueText.textContent = subdivisions;
      updateMeshAndUpload();
      requestAnimationFrame(render);
    }
  };

  document.getElementById("minus").onclick = () => {
    if (subdivisions > 0) {
      subdivisions--;
      valueText.textContent = subdivisions;
      updateMeshAndUpload();
      requestAnimationFrame(render);
    }
  };

  // First draw
  updateMeshAndUpload();
  render();

  // tiny helper: just to make it obvious why Mst exists
  function perceivedNeedsMstNote() {
    // WebGPU depth range is [0,1], while many matrix helpers assume [-1,1].
    // Multiplying by Mst maps z from [-1,1] -> [0,1].
  }
}

window.onload = () => { main(); };
