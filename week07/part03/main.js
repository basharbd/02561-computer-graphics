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

async function loadCubemapWithFallback(files) {
  const bases = ["../textures/", "../cubemaps/"];
  let lastErr = null;
  for (const base of bases) {
    try {
      const imgs = await Promise.all(files.map(f => loadImageBitmap(base + f)));
      console.log("[cubemap] loaded from", base);
      return imgs;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("Cubemap load failed.");
}

// ---------------- Main ----------------
async function main() {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("WebGPU adapter not available.");
  const device = await adapter.requestDevice();

  const canvas = document.getElementById("my-canvas");
  const context = canvas.getContext("webgpu");
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: canvasFormat, alphaMode: "opaque" });

  // ---- Background quad in CLIP space ----
  const zFar = 0.9999;
  const bgPositions = [
    vec3(-1, -1, zFar),
    vec3( 1, -1, zFar),
    vec3( 1,  1, zFar),
    vec3(-1,  1, zFar),
  ];
  const bgIndices = new Uint32Array([0, 1, 2, 0, 2, 3]);

  // ---- Sphere geometry ----
  const M_SQRT2 = Math.sqrt(2.0);
  const M_SQRT6 = Math.sqrt(6.0);

  let spherePositions = [
    vec3(0.0, 0.0, 1.0),
    vec3(0.0, 2.0 * M_SQRT2 / 3.0, -1.0 / 3.0),
    vec3(-M_SQRT6 / 3.0, -M_SQRT2 / 3.0, -1.0 / 3.0),
    vec3(M_SQRT6 / 3.0, -M_SQRT2 / 3.0, -1.0 / 3.0),
  ];

  let sphereIndices = new Uint32Array([
    0, 1, 2,
    0, 3, 1,
    1, 3, 2,
    0, 2, 3,
  ]);

  const subdivisions = 6;
  for (let i = 0; i < subdivisions; ++i) {
    sphereIndices = new Uint32Array(subdivideSphere(spherePositions, sphereIndices));
  }

  // ---- Buffers ----
  function makeVB(vec3Array) {
    const b = device.createBuffer({
      size: sizeof["vec3"] * vec3Array.length,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(b, 0, flatten(vec3Array));
    return b;
  }

  function makeIB(u32) {
    const b = device.createBuffer({
      size: 4 * u32.length,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(b, 0, u32);
    return b;
  }

  const bgVB = makeVB(bgPositions);
  const bgIB = makeIB(bgIndices);

  const sphereVB = makeVB(spherePositions);
  const sphereIB = makeIB(sphereIndices);

  // ---- Load WGSL ----
  const wgslFile = document.getElementById("wgsl").src;
  const wgslCode = await fetch(wgslFile, { cache: "reload" }).then(r => r.text());
  const shader = device.createShaderModule({ code: wgslCode });

  // ---- MSAA + Depth ----
  const msaaCount = 4;

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

  // ---- Pipelines (bg: depth always, sphere: depth less) ----
  const vLayout = {
    arrayStride: sizeof["vec3"],
    attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }],
  };

  const pipelineBg = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: shader, entryPoint: "main_vs", buffers: [vLayout] },
    fragment: { module: shader, entryPoint: "main_fs", targets: [{ format: canvasFormat }] },
    primitive: { topology: "triangle-list", cullMode: "none" },
    multisample: { count: msaaCount },
    depthStencil: { depthWriteEnabled: false, depthCompare: "always", format: "depth24plus" },
  });

  const pipelineSphere = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: shader, entryPoint: "main_vs", buffers: [vLayout] },
    fragment: { module: shader, entryPoint: "main_fs", targets: [{ format: canvasFormat }] },
    primitive: { topology: "triangle-list", frontFace: "ccw", cullMode: "back" },
    multisample: { count: msaaCount },
    depthStencil: { depthWriteEnabled: true, depthCompare: "less", format: "depth24plus" },
  });

  // ---- Cubemap load (+X,-X,+Y,-Y,+Z,-Z) using worksheet naming ----
  const cubemapFiles = [
    "cm_left.png",   // POSITIVE_X
    "cm_right.png",  // NEGATIVE_X
    "cm_top.png",    // POSITIVE_Y
    "cm_bottom.png", // NEGATIVE_Y
    "cm_back.png",   // POSITIVE_Z
    "cm_front.png",  // NEGATIVE_Z
  ];

  const imgs = await loadCubemapWithFallback(cubemapFiles);
  const w = imgs[0].width, h = imgs[0].height;
  const mipCount = numMipLevels(w, h);

  const cubeTex = device.createTexture({
    dimension: "2d",
    size: [w, h, 6],
    format: "rgba8unorm",
    mipLevelCount: mipCount,
    usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
  });

  for (let layer = 0; layer < 6; ++layer) {
    device.queue.copyExternalImageToTexture(
      { source: imgs[layer], flipY: true },
      { texture: cubeTex, mipLevel: 0, origin: [0, 0, layer] },
      { width: w, height: h }
    );
  }

  generateMipmap(device, cubeTex);

  // ---- Uniforms: mvp + mtex + eye(vec4) + flags(vec4<u32>) ----
  const OFF_MVP = 0;
  const OFF_MTEX = sizeof["mat4"];
  const OFF_EYE = sizeof["mat4"] * 2;
  const VEC4_BYTES = sizeof["vec4"] ?? 16;
  const OFF_FLAGS = OFF_EYE + VEC4_BYTES;
  const UNIFORM_BYTES = OFF_FLAGS + 16; // flags vec4<u32>

  const uniformBg = device.createBuffer({
    size: UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const uniformSphere = device.createBuffer({
    size: UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // ---- Sampler/View/Bindgroups from UI ----
  let sampler = null;
  let cubeView = null;
  let bgBind = null;
  let spBind = null;

  function rebuildSamplerViewAndBindGroups() {
    const opt = getOptions();

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

    bgBind = device.createBindGroup({
      layout: pipelineBg.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBg } },
        { binding: 1, resource: sampler },
        { binding: 2, resource: cubeView },
      ],
    });

    spBind = device.createBindGroup({
      layout: pipelineSphere.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformSphere } },
        { binding: 1, resource: sampler },
        { binding: 2, resource: cubeView },
      ],
    });
  }

  rebuildSamplerViewAndBindGroups();

  // ---- Camera / matrices ----
  const Mst = mat4(
    1.0, 0.0, 0.0, 0.0,
    0.0, 1.0, 0.0, 0.0,
    0.0, 0.0, 0.5, 0.5,
    0.0, 0.0, 0.0, 1.0
  );

  // (you can tune this)
  const fovy = 105; // wider -> less zoomed background
  const projection = mult(Mst, perspective(fovy, canvas.width / canvas.height, 0.1, 100.0));

  const M = mat4();

  const r = 2.2;
  let angle = 0.0;

  function rotationOnlyInverseView(V) {
    const invV = inverse(V);
    invV[0][3] = 0.0;
    invV[1][3] = 0.0;
    invV[2][3] = 0.0;
    invV[3] = vec4(0.0, 0.0, 0.0, 1.0);
    return invV;
  }

  function writeUniforms(buf, mvp, mtex, eye3, reflectiveFlag) {
    device.queue.writeBuffer(buf, OFF_MVP, flatten(mvp));
    device.queue.writeBuffer(buf, OFF_MTEX, flatten(mtex));

    const eye4 = vec4(eye3[0], eye3[1], eye3[2], 1.0);
    device.queue.writeBuffer(buf, OFF_EYE, flatten(eye4));

    // flags.x = reflective (0 or 1)
    device.queue.writeBuffer(buf, OFF_FLAGS, new Uint32Array([reflectiveFlag, 0, 0, 0]));
  }

  function render() {
    const eye = vec3(r * Math.sin(angle), 0.0, r * Math.cos(angle));
    const V = lookAt(eye, vec3(0, 0, 0), vec3(0, 1, 0));

    const mvpSphere = mult(projection, mult(V, M));

    const invP = inverse(projection);
    const invVrot = rotationOnlyInverseView(V);
    const mtexBg = mult(invVrot, invP);

    // background: clip positions => mvp = I, mtex = clip->world dir, reflective=0
    writeUniforms(uniformBg, mat4(), mtexBg, eye, 0);

    // sphere: worldPos=unit sphere inPos => mtex = I, reflective=1
    writeUniforms(uniformSphere, mvpSphere, mat4(), eye, 1);

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: msaaTexture.createView(),
        resolveTarget: context.getCurrentTexture().createView(),
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
      }],
      depthStencilAttachment: {
        view: depthTexture.createView(),
        depthLoadOp: "clear",
        depthClearValue: 1.0,
        depthStoreOp: "store",
      },
    });

    // draw background first
    pass.setPipeline(pipelineBg);
    pass.setBindGroup(0, bgBind);
    pass.setVertexBuffer(0, bgVB);
    pass.setIndexBuffer(bgIB, "uint32");
    pass.drawIndexed(bgIndices.length);

    // draw reflective sphere
    pass.setPipeline(pipelineSphere);
    pass.setBindGroup(0, spBind);
    pass.setVertexBuffer(0, sphereVB);
    pass.setIndexBuffer(sphereIB, "uint32");
    pass.drawIndexed(sphereIndices.length);

    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  // ---- Animate toggle ----
  let shouldAnimate = false;
  let lastTime = performance.now();

  document.getElementById("toggle-animate").onclick = () => {
    shouldAnimate = !shouldAnimate;
    if (shouldAnimate) {
      lastTime = performance.now();
      requestAnimationFrame(animate);
    }
  };

  function animate(t) {
    const dt = t - lastTime;
    lastTime = t;
    angle += dt * 0.0012;
    render();
    if (shouldAnimate) requestAnimationFrame(animate);
  }

  wireUI(() => {
    rebuildSamplerViewAndBindGroups();
    render();
  });

  render();
}

window.onload = () => { main().catch(err => console.error(err)); };
