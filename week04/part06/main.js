"use strict";

/**
 * Subdivide a triangle mesh on a sphere by:
 * - For each triangle (i0,i1,i2), create 3 midpoints on edges (0-1, 1-2, 2-0)
 * - Normalize midpoints to push them back onto the unit sphere
 * - Replace the original triangle by 4 smaller triangles
 *
 * NOTE: This version APPENDS 3 new vertices per triangle (no edge sharing),
 * so vertex count grows fast and duplicates midpoints along shared edges.
 *
 * @param {any[]} positions   Array of vec3
 * @param {Uint32Array} indices  Triangle indices (3 per triangle)
 * @returns {number[]} newIndices  Plain JS array of new indices (uint32 later)
 */
function subdivideSphere(positions, indices) {
  const triangles = indices.length / 3;
  const newIndices = [];
  for (let i = 0; i < triangles; ++i) {
    const i0 = indices[i * 3 + 0];
    const i1 = indices[i * 3 + 1];
    const i2 = indices[i * 3 + 2];

    // Indices of the 3 new midpoint vertices that will be appended
    const c01 = positions.length;
    const c12 = positions.length + 1;
    const c20 = positions.length + 2;

    // Create 3 midpoints (then normalize to unit sphere)
    positions.push(normalize(add(positions[i0], positions[i1])));
    positions.push(normalize(add(positions[i1], positions[i2])));
    positions.push(normalize(add(positions[i2], positions[i0])));

    // Replace 1 triangle by 4 triangles (keeps winding consistent with input)
    newIndices.push(
      i0, c01, c20,
      c20, c01, c12,
      c12, c01, i1,
      c20, c12, i2
    );
  }
  return newIndices;
}

/**
 * Subdivide indices ONLY (no new vertex generation).
 * Assumes the vertex array already contains the midpoints in the expected order.
 *
 * This matches the layout produced by subdivideSphere():
 * - For each original triangle i, its 3 new vertices are stored at:
 *   base = triangles + i*3 + {0,1,2}
 *
 * @param {Uint32Array} indices
 * @returns {number[]} newIndices
 */
function subdivideIndices(indices) {
  const triangles = indices.length / 3;
  const newIndices = [];
  for (let i = 0; i < triangles; ++i) {
    const i0 = indices[i * 3 + 0];
    const i1 = indices[i * 3 + 1];
    const i2 = indices[i * 3 + 2];

    // Expected midpoint indices (must already exist in positions[])
    const c01 = triangles + i * 3 + 0;
    const c12 = triangles + i * 3 + 1;
    const c20 = triangles + i * 3 + 2;

    // Same 4-triangle pattern as subdivideSphere()
    newIndices.push(
      i0, c01, c20,
      c20, c01, c12,
      c12, c01, i1,
      c20, c12, i2
    );
  }
  return newIndices;
}

/**
 * Coarsen one subdivision step by extracting the "original" triangle
 * from each 4-triangle block of 12 indices.
 *
 * After subdivision, each original triangle expands into 4 triangles => 12 indices:
 *   [ i0,c01,c20,  c20,c01,c12,  c12,c01,i1,  c20,c12,i2 ]
 * We keep only the original corners (i0, i1, i2) by reading:
 *   i0  from offset 0
 *   i1  from offset 8
 *   i2  from offset 11
 *
 * @param {Uint32Array} indices
 * @returns {number[]} newIndices
 */
function courseIndices(indices) {
  const triangles = indices.length / 12;
  const newIndices = [];
  for (let i = 0; i < triangles; ++i) {
    const i0 = indices[i * 12 + 0];
    const i1 = indices[i * 12 + 8];
    const i2 = indices[i * 12 + 11];
    newIndices.push(i0, i1, i2);
  }
  return newIndices;
}

async function main() {
  // --- WebGPU availability check ---
  if (!navigator.gpu) throw new Error("WebGPU not supported.");

  // --- Adapter + Device ---
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("Failed to get GPU adapter.");
  const device = await adapter.requestDevice();

  // --- Canvas + Context ---
  const canvas = document.getElementById("my-canvas");
  const context = canvas.getContext("webgpu");
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: canvasFormat, alphaMode: "opaque" });

  // --- Start from tetrahedron (later pushed toward a sphere by normalization) ---
  const M_SQRT2 = Math.sqrt(2.0);
  const M_SQRT6 = Math.sqrt(6.0);
  let positions = [
    vec3(0.0, 0.0, 1.0),
    vec3(0.0, 2.0 * M_SQRT2 / 3.0, -1.0 / 3.0),
    vec3(-M_SQRT6 / 3.0, -M_SQRT2 / 3.0, -1.0 / 3.0),
    vec3( M_SQRT6 / 3.0, -M_SQRT2 / 3.0, -1.0 / 3.0),
  ];

  // --- Tetrahedron faces (4 triangles) ---
  let indices = new Uint32Array([
    0, 1, 2,
    0, 3, 1,
    1, 3, 2,
    0, 2, 3,
  ]);

  // --- Subdivision state ---
  const maxSubdivisions = 8;
  const minSubdivisions = 0;
  let subdivisions = 0;

  // Tracks how many times we actually GENERATED new vertices in positions[]
  // (so we don’t regenerate if we go down/up again)
  let calculatedSubdivisions = 0;

  // --- UI: subdivision readout ---
  const valueText = document.getElementById("value");
  valueText.textContent = String(subdivisions);

  // + button:
  // - If we exceeded calculatedSubdivisions, we must generate new vertices (subdivideSphere)
  // - Otherwise, only rebuild indices (subdivideIndices) assuming vertices already exist
  document.getElementById("plus").onclick = () => {
    if (subdivisions >= maxSubdivisions) return;
    subdivisions++;
    valueText.textContent = String(subdivisions);

    if (subdivisions > calculatedSubdivisions) {
      indices = new Uint32Array(subdivideSphere(positions, indices));
      calculatedSubdivisions++;
    } else {
      indices = new Uint32Array(subdivideIndices(indices));
    }
    requestAnimationFrame(render);
  };

  // - button:
  // - Coarsen indices one step by extracting original triangles from each 4-triangle block
  document.getElementById("minus").onclick = () => {
    if (subdivisions <= minSubdivisions) return;
    subdivisions--;
    valueText.textContent = String(subdivisions);
    indices = new Uint32Array(courseIndices(indices));
    requestAnimationFrame(render);
  };

  // --- UI: shading sliders ---
  const emittedRadianceSlider = document.getElementById("emitted-radiance");
  const ambientRadianceSlider = document.getElementById("ambient-radiance");
  const diffuseSlider = document.getElementById("diffuse");
  const specularSlider = document.getElementById("specular");
  const shininessSlider = document.getElementById("shininess");

  // Current slider values (copied into uniform buffer each frame)
  let emittedRadiance = parseFloat(emittedRadianceSlider.value);
  let ambientRadiance = parseFloat(ambientRadianceSlider.value);
  let diffuse = parseFloat(diffuseSlider.value);
  let specular = parseFloat(specularSlider.value);
  let shininess = parseFloat(shininessSlider.value);

  // On slider change: update value and re-render once
  emittedRadianceSlider.oninput = () => { emittedRadiance = parseFloat(emittedRadianceSlider.value); requestAnimationFrame(render); };
  ambientRadianceSlider.oninput = () => { ambientRadiance = parseFloat(ambientRadianceSlider.value); requestAnimationFrame(render); };
  diffuseSlider.oninput = () => { diffuse = parseFloat(diffuseSlider.value); requestAnimationFrame(render); };
  specularSlider.oninput = () => { specular = parseFloat(specularSlider.value); requestAnimationFrame(render); };
  shininessSlider.oninput = () => { shininess = parseFloat(shininessSlider.value); requestAnimationFrame(render); };

  // --- Orbit animation toggle ---
  let shouldAnimate = false;
  let lastTime = performance.now();
  let angle = 0;
  const r = 4;

  document.getElementById("toggle-animate").onclick = () => {
    shouldAnimate = !shouldAnimate;
    if (shouldAnimate) {
      lastTime = performance.now();
      requestAnimationFrame(animate);
    }
  };

  // --- GPU buffers (pre-allocated for the maximum subdivision level) ---
  // Position buffer: vec3 per vertex.
  // NOTE: This code uses a simplified size estimate tied to 4^(L+1).
  const positionBuffer = device.createBuffer({
    size: sizeof["vec3"] * (4 ** (maxSubdivisions + 1)),
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });

  // Index buffer: 3 indices per triangle.
  // triangles(L) = 4 * 4^L, so indices(L) = 3 * triangles(L)
  const maxTriangles = 4 * (4 ** maxSubdivisions);
  const maxIndexCount = maxTriangles * 3;
  const indicesBuffer = device.createBuffer({
    size: 4 * maxIndexCount,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });

  // Vertex layout: position only (vec3) at location(0)
  const positionBufferLayout = {
    arrayStride: sizeof["vec3"],
    attributes: [{ format: "float32x3", offset: 0, shaderLocation: 0 }],
  };

  // Uniform buffer layout expected by your WGSL:
  // [ eye.xyz, L_e, L_a, k_d, k_s, s ] = 8 floats (32 bytes)
  // then mvp matrix (mat4 = 64 bytes) at offset 32
  const uniformBuffer = device.createBuffer({
    size: 4 * 8 + sizeof["mat4"],
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // --- Depth range fix: convert OpenGL-style clip z [-1,1] -> WebGPU [0,1] ---
  const Mst = mat4(
    1.0, 0.0, 0.0, 0.0,
    0.0, 1.0, 0.0, 0.0,
    0.0, 0.0, 0.5, 0.5,
    0.0, 0.0, 0.0, 1.0
  );

  // Model matrix (identity / no transform here)
  const M = translate(0, 0, 0);

  // Perspective projection (then apply Mst for WebGPU depth)
  let projection = perspective(45, canvas.width / canvas.height, 0.1, 100);
  projection = mult(Mst, projection);

  // Background clear color
  const bgcolor = vec4(0.3921, 0.5843, 0.9294, 1.0); // cornflower

  // --- WGSL load + pipeline setup ---
  const wgslFile = document.getElementById("wgsl").src;
  const wgslCode = await fetch(wgslFile, { cache: "reload" }).then(r => r.text());
  const shader = device.createShaderModule({ code: wgslCode });

  const msaaCount = 4;

  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: shader, entryPoint: "main_vs", buffers: [positionBufferLayout] },
    fragment: { module: shader, entryPoint: "main_fs", targets: [{ format: canvasFormat }] },
    primitive: { topology: "triangle-list", frontFace: "ccw", cullMode: "back" },
    multisample: { count: msaaCount },
    depthStencil: { depthWriteEnabled: true, depthCompare: "less", format: "depth24plus" },
  });

  // MSAA color buffer (resolve into swapchain texture)
  const msaaTexture = device.createTexture({
    size: { width: canvas.width, height: canvas.height },
    format: canvasFormat,
    sampleCount: msaaCount,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  // MSAA depth buffer
  const depthTexture = device.createTexture({
    size: { width: canvas.width, height: canvas.height },
    format: "depth24plus",
    sampleCount: msaaCount,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  // Bind group: single uniform buffer at group(0), binding(0)
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  // --- Draw one frame ---
  function render() {
    // Orbit camera around Y axis (eye on a circle of radius r)
    const eye = vec3(r * Math.sin(angle), 0, r * Math.cos(angle));

    // View matrix looking at origin
    const V = lookAt(eye, vec3(0, 0, 0), vec3(0, 1, 0));

    // MVP = P * V * M
    const mvp = mult(projection, mult(V, M));

    // Pack uniforms:
    //  - first 8 floats: eye.xyz + (Le, La, kd, ks, s)
    //  - then mat4 at byte offset 32
    const uniformFloats = new Float32Array([
      ...flatten(eye),
      emittedRadiance,
      ambientRadiance,
      diffuse,
      specular,
      shininess,
    ]);

    // Upload current uniforms + geometry
    device.queue.writeBuffer(uniformBuffer, 0, uniformFloats);
    device.queue.writeBuffer(uniformBuffer, 4 * 8, flatten(mvp));
    device.queue.writeBuffer(positionBuffer, 0, flatten(positions));
    device.queue.writeBuffer(indicesBuffer, 0, indices);

    // Encode render commands
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
      }
    });

    // Bind pipeline + resources + draw
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, positionBuffer);
    pass.setIndexBuffer(indicesBuffer, "uint32");
    pass.drawIndexed(indices.length);
    pass.end();

    // Submit to GPU
    device.queue.submit([encoder.finish()]);
  }

  // --- Animation loop ---
  function animate(t) {
    // Integrate time to update orbit angle
    angle += (t - lastTime) * 0.0025;
    lastTime = t;

    render();
    if (shouldAnimate) requestAnimationFrame(animate);
  }

  // First frame
  render();
}

window.onload = () => { main(); };
