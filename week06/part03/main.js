"use strict";

// ------------------------------------------------------------
// Sphere subdivision (same style as your code: no midpoint reuse)
// With this approach:
//   vertices(s) = 4 * 4^s
//   triangles(s) = 4 * 4^s
//   indices(s) = 3 * triangles(s) = 12 * 4^s
// ------------------------------------------------------------
function subdivideSphere(positions, indices) {
  const triangles = indices.length / 3;
  const newIndices = [];

  for (let i = 0; i < triangles; ++i) {
    const i0 = indices[i * 3 + 0];
    const i1 = indices[i * 3 + 1];
    const i2 = indices[i * 3 + 2];

    const c01 = positions.length;
    const c12 = positions.length + 1;
    const c20 = positions.length + 2;

    positions.push(normalize(add(positions[i0], positions[i1])));
    positions.push(normalize(add(positions[i1], positions[i2])));
    positions.push(normalize(add(positions[i2], positions[i0])));

    // 4 new triangles
    newIndices.push(
      i0,  c01, c20,
      c20, c01, c12,
      c12, c01, i1,
      c20, c12, i2
    );
  }
  return newIndices;
}

function subdivideIndices(indices) {
  const triangles = indices.length / 3;
  const newIndices = [];
  for (let i = 0; i < triangles; ++i) {
    const i0 = indices[i * 3 + 0];
    const i1 = indices[i * 3 + 1];
    const i2 = indices[i * 3 + 2];

    const c01 = triangles + i * 3 + 0;
    const c12 = triangles + i * 3 + 1;
    const c20 = triangles + i * 3 + 2;

    newIndices.push(
      i0,  c01, c20,
      c20, c01, c12,
      c12, c01, i1,
      c20, c12, i2
    );
  }
  return newIndices;
}

function courseIndices(indices) {
  // undo one level: from 12 indices per old triangle back to 3
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

// -------------------- UI --------------------
function getOptions() {
  return {
    mipmapEnabled: document.getElementById("toggle-mipmap").checked,
    wrappingMode: document.getElementById("texture-wrapping").value,
    magFilter: document.getElementById("mag-filter").value,
    minFilter: document.getElementById("min-filter").value,
    mipmapFilter: document.getElementById("mipmap-filter").value,
  };
}

function wireUI(onChange) {
  const ids = ["toggle-mipmap", "texture-wrapping", "mag-filter", "min-filter", "mipmap-filter"];
  for (const id of ids) document.getElementById(id).onchange = onChange;
}

async function loadImageBitmap(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to load image: ${url}`);
  const blob = await resp.blob();
  return await createImageBitmap(blob, { colorSpaceConversion: "none" });
}

// -------------------- Orbit controls --------------------
function makeOrbit(canvas) {
  const state = {
    yaw: 0.0,
    pitch: 0.0,
    dragging: false,
    lastX: 0,
    lastY: 0,
    radius: 4.0,
  };

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  canvas.addEventListener("mousedown", (e) => {
    state.dragging = true;
    state.lastX = e.clientX;
    state.lastY = e.clientY;
  });

  window.addEventListener("mouseup", () => {
    state.dragging = false;
  });

  window.addEventListener("mousemove", (e) => {
    if (!state.dragging) return;
    const dx = e.clientX - state.lastX;
    const dy = e.clientY - state.lastY;
    state.lastX = e.clientX;
    state.lastY = e.clientY;

    state.yaw += dx * 0.005;
    state.pitch += dy * 0.005;
    state.pitch = clamp(state.pitch, -1.2, 1.2);
  });

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    state.radius *= (e.deltaY > 0) ? 1.05 : 0.95;
    state.radius = clamp(state.radius, 2.0, 12.0);
  }, { passive: false });

  return state;
}

async function main() {
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();

  const canvas = document.getElementById("my-canvas");
  const context = canvas.getContext("webgpu");
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: canvasFormat, alphaMode: "opaque" });

  // ---------- sphere base (tetrahedron) ----------
  const M_SQRT2 = Math.sqrt(2.0);
  const M_SQRT6 = Math.sqrt(6.0);

  let positions = [
    vec3(0.0, 0.0, 1.0),
    vec3(0.0, 2.0 * M_SQRT2 / 3.0, -1.0 / 3.0),
    vec3(-M_SQRT6 / 3.0, -M_SQRT2 / 3.0, -1.0 / 3.0),
    vec3(M_SQRT6 / 3.0, -M_SQRT2 / 3.0, -1.0 / 3.0),
  ];

  let indices = new Uint32Array([
    0, 1, 2,
    0, 3, 1,
    1, 3, 2,
    0, 2, 3,
  ]);

  const maxSubdivisions = 8;
  const minSubdivisions = 0;

  let subdivisions = 6;
  let calculatedSubdivisions = 0;

  // Precompute up to initial level
  for (let i = 0; i < subdivisions; ++i) {
    indices = new Uint32Array(subdivideSphere(positions, indices));
    calculatedSubdivisions++;
  }

  // UI counters
  const valueText = document.getElementById("value");
  valueText.textContent = String(subdivisions);

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

  document.getElementById("minus").onclick = () => {
    if (subdivisions <= minSubdivisions) return;
    subdivisions--;
    valueText.textContent = String(subdivisions);
    indices = new Uint32Array(courseIndices(indices));
    requestAnimationFrame(render);
  };

  // ---------- buffers (allocate for max) ----------
  const maxVerts = 4 * (4 ** maxSubdivisions);
  const maxIdx = 12 * (4 ** maxSubdivisions);

  const positionBuffer = device.createBuffer({
    size: sizeof["vec3"] * maxVerts,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });

  const indexBuffer = device.createBuffer({
    size: 4 * maxIdx, // uint32
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });

  // ---------- matrices ----------
  const bgcolor = vec4(0.0, 0.0, 0.0, 1.0); // black
  const Mst = mat4(
    1.0, 0.0, 0.0, 0.0,
    0.0, 1.0, 0.0, 0.0,
    0.0, 0.0, 0.5, 0.5,
    0.0, 0.0, 0.0, 1.0
  );

  let projection = mult(Mst, perspective(45, canvas.width / canvas.height, 0.1, 100.0));
  const M = mat4();

  const uniformBuffer = device.createBuffer({
    size: 64, // mat4
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // ---------- shader/pipeline ----------
  const wgslFile = document.getElementById("wgsl").src;
  const wgslCode = await fetch(wgslFile, { cache: "reload" }).then(r => r.text());
  const shader = device.createShaderModule({ code: wgslCode });

  const msaaCount = 4;

  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: shader,
      entryPoint: "main_vs",
      buffers: [{
        arrayStride: sizeof["vec3"],
        attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }],
      }],
    },
    fragment: {
      module: shader,
      entryPoint: "main_fs",
      targets: [{ format: canvasFormat }],
    },
    primitive: { topology: "triangle-list", frontFace: "ccw", cullMode: "back" },
    multisample: { count: msaaCount },
    depthStencil: { depthWriteEnabled: true, depthCompare: "less", format: "depth24plus" },
  });

  const msaaTexture = device.createTexture({
    size: [canvas.width, canvas.height, 1],
    format: canvasFormat,
    sampleCount: msaaCount,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  const depthTexture = device.createTexture({
    size: [canvas.width, canvas.height, 1],
    format: "depth24plus",
    sampleCount: msaaCount,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  // ---------- texture (earth.jpg) + mipmaps ----------
  // Put earth.jpg here: week06/assets/earth.jpg
  const earthURL = "../assets/earth.jpg";
  const img = await loadImageBitmap(earthURL);

  const mipCount = numMipLevels(img.width, img.height);

  // Create once with full mip chain
  const texture = device.createTexture({
    size: [img.width, img.height, 1],
    format: "rgba8unorm",
    mipLevelCount: mipCount,
    usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
  });

  // Upload base level (flipY makes UV feel natural)
  device.queue.copyExternalImageToTexture(
    { source: img, flipY: true },
    { texture: texture, mipLevel: 0 },
    { width: img.width, height: img.height }
  );
  generateMipmap(device, texture);

  // Sampler + view can change when UI changes
  let sampler = null;
  let textureView = null;

  function updateSamplerAndView() {
    const opt = getOptions();

    // if mipmapping disabled: use only base mip level via a view (mipLevelCount: 1)
    textureView = texture.createView({
      baseMipLevel: 0,
      mipLevelCount: opt.mipmapEnabled ? mipCount : 1,
    });

    sampler = device.createSampler({
      addressModeU: opt.wrappingMode,
      addressModeV: opt.wrappingMode,
      magFilter: opt.magFilter,
      minFilter: opt.minFilter,
      mipmapFilter: opt.mipmapEnabled ? opt.mipmapFilter : "nearest",
    });

    // UI: disable mipmap filter menu when mipmapping is off
    document.getElementById("mipmap-filter").disabled = !opt.mipmapEnabled;
  }

  updateSamplerAndView();

  // ---------- orbit + animation ----------
  const orbit = makeOrbit(canvas);

  let shouldAnimate = false;
  document.getElementById("toggle-animate").onclick = () => {
    shouldAnimate = !shouldAnimate;
    if (shouldAnimate) {
      lastTime = performance.now();
      requestAnimationFrame(animate);
    }
  };

  let lastTime = performance.now();

  function computeEye() {
    const r = orbit.radius;
    const cy = Math.cos(orbit.pitch);
    const sy = Math.sin(orbit.pitch);
    const cx = Math.cos(orbit.yaw);
    const sx = Math.sin(orbit.yaw);

    // yaw around Y, pitch up/down
    const x = r * sx * cy;
    const y = r * sy;
    const z = r * cx * cy;
    return vec3(x, y, z);
  }

  function render() {
    // upload geometry
    device.queue.writeBuffer(positionBuffer, 0, flatten(positions));
    device.queue.writeBuffer(indexBuffer, 0, indices);

    // camera
    const eye = computeEye();
    const V = lookAt(eye, vec3(0, 0, 0), vec3(0, 1, 0));
    const mvp = mult(projection, mult(V, M));
    device.queue.writeBuffer(uniformBuffer, 0, flatten(mvp));

    // bind group
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: sampler },
        { binding: 2, resource: textureView },
      ],
    });

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
    pass.setIndexBuffer(indexBuffer, "uint32");
    pass.drawIndexed(indices.length);
    pass.end();

    device.queue.submit([encoder.finish()]);
  }

  function animate(t) {
    const dt = (t - lastTime);
    lastTime = t;

    orbit.yaw += dt * 0.0012; // auto spin

    render();
    if (shouldAnimate) requestAnimationFrame(animate);
  }

  function onUIChange() {
    updateSamplerAndView();
    render();
  }

  wireUI(onUIChange);

  // initial draw
  render();

  // also redraw while dragging orbit
  window.addEventListener("mousemove", () => {
    if (orbit.dragging) render();
  });
  canvas.addEventListener("wheel", () => render());
}

window.onload = main;
