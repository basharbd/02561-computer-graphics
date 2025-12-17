"use strict";

// ---------------- Sphere subdivision ----------------
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

    newIndices.push(
      i0,  c01, c20,
      c20, c01, c12,
      c12, c01, i1,
      c20, c12, i2
    );
  }
  return newIndices;
}

// ---------------- UI helpers ----------------
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
  if (!resp.ok) throw new Error(`Failed to load: ${url}`);
  const blob = await resp.blob();
  return await createImageBitmap(blob, { colorSpaceConversion: "none" });
}

// ---------------- Main ----------------
async function main() {
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();

  const canvas = document.getElementById("my-canvas");
  const context = canvas.getContext("webgpu");
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: canvasFormat, alphaMode: "opaque" });

  // ---- Sphere geometry (tetrahedron -> subdiv) ----
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

  const subdivisions = 6;
  for (let i = 0; i < subdivisions; ++i) {
    indices = new Uint32Array(subdivideSphere(positions, indices));
  }

  // ---- Buffers ----
  const positionBuffer = device.createBuffer({
    size: sizeof["vec3"] * positions.length,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(positionBuffer, 0, flatten(positions));

  const indexBuffer = device.createBuffer({
    size: 4 * indices.length, // uint32
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(indexBuffer, 0, indices);

  // ---- Matrices ----
  const bgcolor = vec4(0, 0, 0, 1);

  const Mst = mat4(
    1.0, 0.0, 0.0, 0.0,
    0.0, 1.0, 0.0, 0.0,
    0.0, 0.0, 0.5, 0.5,
    0.0, 0.0, 0.0, 1.0
  );

  const projection = mult(Mst, perspective(45, canvas.width / canvas.height, 0.1, 100.0));
  const M = mat4();

  const uniformBuffer = device.createBuffer({
    size: sizeof["mat4"],
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // ---- Load WGSL ----
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

  // ---- Cube map images (FIXED: Order and Paths) ----
  // Standard Cubemap Order:
  // 0: Positive X (Right)
  // 1: Negative X (Left)
  // 2: Positive Y (Top)
  // 3: Negative Y (Bottom)
  // 4: Positive Z (Front)
  // 5: Negative Z (Back)
  
  const cubemapFiles = [
    "../textures/cm_right.png",   // POSITIVE_X
    "../textures/cm_left.png",    // NEGATIVE_X
    "../textures/cm_top.png",     // POSITIVE_Y
    "../textures/cm_bottom.png",  // NEGATIVE_Y
    "../textures/cm_front.png",   // POSITIVE_Z
    "../textures/cm_back.png",    // NEGATIVE_Z
  ];

  const imgs = await Promise.all(cubemapFiles.map(loadImageBitmap));
  const w = imgs[0].width, h = imgs[0].height;

  // mip chain size (same for all faces)
  const mipCount = numMipLevels(w, h);

  // Create cube texture as a 2D array with 6 layers
  const cubeTex = device.createTexture({
    dimension: "2d",
    size: [w, h, 6],
    format: "rgba8unorm",
    mipLevelCount: mipCount,
    usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
  });

  // Upload each face into its layer (FIXED: flipY: true)
  for (let layer = 0; layer < 6; ++layer) {
    device.queue.copyExternalImageToTexture(
      { source: imgs[layer], flipY: true }, // <--- Fixed here for upside-down issue
      { texture: cubeTex, mipLevel: 0, origin: [0, 0, layer] },
      { width: w, height: h }
    );
  }

  // Generate mipmaps once (requirement)
  generateMipmap(device, cubeTex);

  // Sampler + view updated from UI
  let sampler = null;
  let cubeView = null;

  function updateSamplerAndView() {
    const opt = getOptions();

    // If mipmapping disabled: expose only mip 0
    cubeView = cubeTex.createView({
      dimension: "cube",
      baseMipLevel: 0,
      mipLevelCount: opt.mipmapEnabled ? mipCount : 1,
    });

    sampler = device.createSampler({
      addressModeU: opt.wrappingMode,
      addressModeV: opt.wrappingMode,
      addressModeW: opt.wrappingMode,
      magFilter: opt.magFilter,
      minFilter: opt.minFilter,
      mipmapFilter: opt.mipmapEnabled ? opt.mipmapFilter : "nearest",
    });

    document.getElementById("mipmap-filter").disabled = !opt.mipmapEnabled;
  }

  updateSamplerAndView();

  // ---- Camera orbit ----
  const r = 4.0;
  let angle = 0.0;

  let shouldAnimate = false;
  document.getElementById("toggle-animate").onclick = () => {
    shouldAnimate = !shouldAnimate;
    if (shouldAnimate) {
      lastTime = performance.now();
      requestAnimationFrame(animate);
    }
  };

  function render() {
    const eye = vec3(r * Math.sin(angle), 0.0, r * Math.cos(angle));
    const V = lookAt(eye, vec3(0, 0, 0), vec3(0, 1, 0));
    const mvp = mult(projection, mult(V, M));
    device.queue.writeBuffer(uniformBuffer, 0, flatten(mvp));

    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: sampler },
        { binding: 2, resource: cubeView },
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

  let lastTime = performance.now();
  function animate(t) {
    const dt = t - lastTime;
    lastTime = t;
    angle += dt * 0.0012;
    render();
    if (shouldAnimate) requestAnimationFrame(animate);
  }

  function onUIChange() {
    updateSamplerAndView();
    render();
  }
  wireUI(onUIChange);

  render();
}

window.onload = main;