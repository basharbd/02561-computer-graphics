"use strict";

async function main() {
  // --- WebGPU bootstrap ---
  const gpu = navigator.gpu;
  const adapter = await gpu.requestAdapter();
  const device = await adapter.requestDevice();

  const canvas = document.getElementById("my-canvas");
  const context = canvas.getContext("webgpu");
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();

  context.configure({
    device: device,
    format: canvasFormat,
  });

  // --- Scene geometry (3 quads) ---
  // 0..3   : ground quad (y = -1)
  // 4..7   : quad A (object)
  // 8..11  : quad B (object)
  let positions = [
    // Ground quad
    vec3(-2, -1, -1),
    vec3(2, -1, -1),
    vec3(2, -1, -5),
    vec3(-2, -1, -5),

    // Quad A
    vec3(0.25, -0.5, -1.25),
    vec3(0.75, -0.5, -1.25),
    vec3(0.75, -0.5, -1.75),
    vec3(0.25, -0.5, -1.75),

    // Quad B
    vec3(-1, -1, -2.5),
    vec3(-1, -1, -3.0),
    vec3(-1, 0, -3.0),
    vec3(-1, 0, -2.5),
  ];

  // Two triangles per quad (triangle-list)
  let indices = new Uint32Array([
    // Ground
    0, 1, 2,
    0, 2, 3,

    // Quad A
    4, 5, 6,
    4, 6, 7,

    // Quad B
    8, 9, 10,
    8, 10, 11,
  ]);

  // --- GPU buffers: positions + indices ---
  const positionBuffer = device.createBuffer({
    size: sizeof["vec3"] * positions.length,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });

  const positionBufferLayout = {
    arrayStride: sizeof["vec3"],
    attributes: [{ format: "float32x3", offset: 0, shaderLocation: 0 }],
  };

  // NOTE: index buffer size is kept exactly as in your code (no logic changes)
  const indicesBuffer = device.createBuffer({
    size: sizeof["vec3"] * indices.length,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });

  // --- UVs: same (0..1) mapping per quad ---
  // 0..3   : ground UVs
  // 4..7   : quad A UVs
  // 8..11  : quad B UVs
  const texcoords = [
    // Ground quad
    vec2(0.0, 0.0),
    vec2(1.0, 0.0),
    vec2(1.0, 1.0),
    vec2(0.0, 1.0),

    // Quad A
    vec2(0.0, 0.0),
    vec2(1.0, 0.0),
    vec2(1.0, 1.0),
    vec2(0.0, 1.0),

    // Quad B
    vec2(0.0, 0.0),
    vec2(1.0, 0.0),
    vec2(1.0, 1.0),
    vec2(0.0, 1.0),
  ];

  const texcoordBuffer = device.createBuffer({
    size: sizeof["vec2"] * texcoords.length,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });

  const texcoordBufferLayout = {
    arrayStride: sizeof["vec2"],
    attributes: [{ format: "float32x2", offset: 0, shaderLocation: 1 }],
  };

  // Upload static geometry once
  device.queue.writeBuffer(positionBuffer, 0, flatten(positions));
  device.queue.writeBuffer(indicesBuffer, 0, indices);
  device.queue.writeBuffer(texcoordBuffer, 0, flatten(texcoords));

  // --- Texture: ground image (xamp23.png) ---
  const filename = "../textures/xamp23.png";
  const response = await fetch(filename);
  const blob = await response.blob();
  const img = await createImageBitmap(blob, { colorSpaceConversion: "none" });

  const textureGround = device.createTexture({
    size: [img.width, img.height, 1],
    format: "rgba8unorm",
    usage:
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.RENDER_ATTACHMENT,
  });

  device.queue.copyExternalImageToTexture(
    { source: img, flipY: true },
    { texture: textureGround },
    { width: img.width, height: img.height }
  );

  // Sampler for the ground texture (linear filtering, clamp)
  textureGround.sampler = device.createSampler({
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
    minFilter: "linear",
    magFilter: "linear",
  });

  // --- Texture: 1x1 red (used for objects + shadows) ---
  const textureRed = device.createTexture({
    size: [1, 1, 1],
    format: "rgba8unorm",
    usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
  });

  device.queue.writeTexture(
    { texture: textureRed },
    new Uint8Array([255, 0, 0, 255]),
    { offset: 0, bytesPerRow: 4, rowsPerImage: 1 },
    [1, 1, 1]
  );

  textureRed.sampler = device.createSampler({
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
    minFilter: "nearest",
    magFilter: "linear",
  });

  // --- Clear color ---
  const bgcolor = vec4(0.3921, 0.5843, 0.9294, 1.0);

  // --- Uniform buffers ---
  // uniformBuffer: main MVP + visibility scalar (padded)
  // uniformBufferShadow: shadow MVP + visibility scalar (padded)
  const uniformBuffer = device.createBuffer({
    size: sizeof["mat4"] + 4 * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const uniformBufferShadow = device.createBuffer({
    size: sizeof["mat4"] + 4 * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // --- Projection setup (MV.js uses NDC z in [-1,1], WebGPU wants [0,1]) ---
  const Mst = mat4(
    1.0, 0.0, 0.0, 0.0,
    0.0, 1.0, 0.0, 0.0,
    0.0, 0.0, 0.5, 0.5,
    0.0, 0.0, 0.0, 1.0
  );

  const center = translate(0, 0, 0);
  const M = center;

  const fov = 90;
  let projection = perspective(fov, canvas.width / canvas.height, 1, 20);
  projection = mult(Mst, projection);

  const V = mat4(); // identity view (camera at origin, looking down -Z in this setup)
  const mvp = mult(projection, mult(V, M));

  // Initialize main uniforms
  device.queue.writeBuffer(uniformBuffer, 0, flatten(mvp));
  device.queue.writeBuffer(uniformBuffer, sizeof["mat4"], new Float32Array([1.0]));

  // --- Shaders ---
  const wgslfile = document.getElementById("wgsl").src;
  const wgslcode = await fetch(wgslfile, { cache: "reload" }).then((r) => r.text());
  const wgsl = device.createShaderModule({ code: wgslcode });

  // --- Pipeline (single pipeline, different bind groups for textures) ---
  const msaaCount = 4;

  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: wgsl,
      entryPoint: "main_vs",
      buffers: [positionBufferLayout, texcoordBufferLayout],
    },
    fragment: {
      module: wgsl,
      entryPoint: "main_fs",
      targets: [{ format: canvasFormat }],
    },
    primitive: {
      topology: "triangle-list",
      frontFace: "ccw",
      cullMode: "none",
    },
    multisample: { count: msaaCount },
    depthStencil: {
      depthWriteEnabled: true,
      depthCompare: "less",
      format: "depth24plus",
    },
  });

  // --- MSAA + depth attachments ---
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

  // --- Bind groups (same layout, different textures/uniforms) ---
  // Ground uses ground texture + main MVP
  const bindGroupGround = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: textureGround.sampler },
      { binding: 2, resource: textureGround.createView() },
    ],
  });

  // Shadows use shadow MVP + red texture (acts as "shadow color")
  const bindGroupShadows = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBufferShadow } },
      { binding: 1, resource: textureRed.sampler },
      { binding: 2, resource: textureRed.createView() },
    ],
  });

  // Objects use main MVP + red texture
  const bindGroupObjects = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: textureRed.sampler },
      { binding: 2, resource: textureRed.createView() },
    ],
  });

  // --- Animation toggle ---
  let shouldAnimate = false;

  document.getElementById("toggle-animate").onclick = () => {
    shouldAnimate = !shouldAnimate;
    if (shouldAnimate) {
      lastTime = performance.now();
      requestAnimationFrame(animate);
    }
  };

  let angle = 0;

  function render() {
    // --- Build planar shadow projection matrix for plane y = -1 ---
    const epsilon = 0.0001; // small lift to reduce z-fighting
    const r = 2.0;

    // Moving point light position
    const l = vec3(r * Math.sin(angle), 2, -2 + r * Math.cos(angle));

    // Ground plane: n=(0,1,0), d=1 means y=-1 (n·x + d = 0)
    const n = vec3(0, 1, 0);
    const d = 1.0 - epsilon;

    // Shadow projection matrix (classic planar shadow matrix form)
    const a = d + dot(n, l);
    const Mshadow = mat4(
      a - l[0] * n[0], -l[0] * n[1], -l[0] * n[2], -l[0] * d,
      -l[1] * n[0], a - l[1] * n[1], -l[1] * n[2], -l[1] * d,
      -l[2] * n[0], -l[2] * n[1], a - l[2] * n[2], -l[2] * d,
      -n[0], -n[1], -n[2], a - d
    );

    // Shadow MVP uses same projection/view as scene
    const mvpShadow = mult(projection, mult(V, Mshadow));

    // Upload shadow uniforms (MVP + visibility)
    device.queue.writeBuffer(uniformBufferShadow, 0, flatten(mvpShadow));
    device.queue.writeBuffer(uniformBufferShadow, sizeof["mat4"], new Float32Array([0.0]));

    // --- Render pass ---
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: msaaTexture.createView(),
          resolveTarget: context.getCurrentTexture().createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: bgcolor[0], g: bgcolor[1], b: bgcolor[2], a: bgcolor[3] },
        },
      ],
      depthStencilAttachment: {
        view: depthTexture.createView(),
        depthLoadOp: "clear",
        depthClearValue: 1.0,
        depthStoreOp: "store",
      },
    });

    pass.setPipeline(pipeline);
    pass.setIndexBuffer(indicesBuffer, "uint32");
    pass.setVertexBuffer(0, positionBuffer);
    pass.setVertexBuffer(1, texcoordBuffer);

    // Draw: ground (textured)
    pass.setBindGroup(0, bindGroupGround);
    pass.drawIndexed(6);

    // Draw: shadow polygons (same geometry as objects, but with shadow MVP)
    pass.setBindGroup(0, bindGroupShadows);
    pass.drawIndexed(indices.length - 6, 1, 6);

    // Draw: objects (red)
    pass.setBindGroup(0, bindGroupObjects);
    pass.drawIndexed(indices.length - 6, 1, 6);

    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  let lastTime = performance.now();

  function animate(timestamp) {
    // Advance light angle
    angle += (timestamp - lastTime) * 0.0015;
    lastTime = timestamp;

    render();

    if (shouldAnimate) requestAnimationFrame(animate);
  }

  // First frame
  render();
}

window.onload = function () {
  main();
};
