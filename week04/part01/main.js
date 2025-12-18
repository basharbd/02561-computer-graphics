"use strict";

// Subdivision sphere: tetrahedron -> subdivide -> normalize to unit sphere

function edgeKey(i, j) {
  // Stable key for an undirected edge (i,j)
  return (i < j) ? `${i}_${j}` : `${j}_${i}`;
}

function subdivideOnce(positions, indices) {
  // Create a refined mesh (4 triangles for each original triangle)
  const newPositions = positions.slice();   // copy vec3 array
  const newIndices = [];
  const cache = new Map();                  // edgeKey -> midpoint vertex index

  function getMid(i0, i1) {
    // Midpoint on the unit sphere (cached so shared edges reuse vertices)
    const key = edgeKey(i0, i1);
    if (cache.has(key)) return cache.get(key);

    const m = normalize(add(newPositions[i0], newPositions[i1]));
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
  // Repeatedly subdivide starting from the tetrahedron
  let pos = basePositions.slice();
  let ind = new Uint32Array(baseIndices);

  for (let k = 0; k < level; k++) {
    const r = subdivideOnce(pos, ind);
    pos = r.positions;
    ind = r.indices;
  }
  return { positions: pos, indices: ind };
}

// Closed-form upper bounds for tetrahedron subdivision
function maxCounts(maxLevel) {
  const pow = 4 ** maxLevel;
  const maxVertexCount = 2 * pow + 2;
  const maxIndexCount = 12 * pow;
  return { maxVertexCount, maxIndexCount };
}

async function main() {
  // WebGPU setup (request high-performance adapter)
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

  // Base tetrahedron (normalized to unit sphere)
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

  // UI state
  const maxSubdivisions = 8;
  let subdivisions = 0;

  const valueText = document.getElementById("value");
  valueText.textContent = subdivisions;

  // Pre-allocate GPU buffers using worst-case counts
  const { maxVertexCount, maxIndexCount } = maxCounts(maxSubdivisions);

  const maxVertexBytes = maxVertexCount * 3 * 4; // vec3 -> 3 floats
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

  // Depth buffer (Z-buffer)
  const depthFormat = "depth24plus";
  let depthTexture = device.createTexture({
    size: { width: canvas.width, height: canvas.height },
    format: depthFormat,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  // Clear color
  const bgcolor = vec4(0.3921, 0.5843, 0.9294, 1.0);

  // Depth mapping: MV.js helpers often assume NDC z in [-1,1], WebGPU uses [0,1]
  const Mst = mat4(
    1.0, 0.0, 0.0, 0.0,
    0.0, 1.0, 0.0, 0.0,
    0.0, 0.0, 0.5, 0.5,
    0.0, 0.0, 0.0, 1.0
  );

  // Projection + view + model
  let P = perspective(45, canvas.width / canvas.height, 0.1, 100.0);
  P = mult(Mst, P);

  const eye = vec3(0, 0, -4);
  const V = lookAt(eye, vec3(0, 0, 0), vec3(0, 1, 0));
  const M = mat4();

  const mvp = mult(P, mult(V, M));

  // Uniform buffer (MVP matrix)
  const uniformBuffer = device.createBuffer({
    size: sizeof["mat4"],
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, flatten(mvp));

  // Load WGSL + create pipeline (with depth testing)
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

  // Current mesh CPU data
  let positions = [];
  let indices = new Uint32Array([]);

  function updateMeshAndUpload() {
    // Build mesh for current subdivision level and upload to GPU buffers
    const mesh = buildSphere(subdivisions, basePositions, baseIndices);
    positions = mesh.positions;
    indices = mesh.indices;

    device.queue.writeBuffer(positionBuffer, 0, flatten(positions));
    device.queue.writeBuffer(indicesBuffer, 0, indices);
  }

  function render() {
    // Clear + draw indexed triangles with depth testing
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

  // UI handlers: +/- subdivision level
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
}

window.onload = () => { main(); };
