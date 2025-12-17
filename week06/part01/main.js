"use strict";

function createCheckerboardTexture(texSize, numRows, numCols) {
  const texels = new Uint8Array(4 * texSize * texSize);

  for (let i = 0; i < texSize; ++i) {
    for (let j = 0; j < texSize; ++j) {
      const patchx = Math.floor(i / (texSize / numRows));
      const patchy = Math.floor(j / (texSize / numCols));
      const c = (patchx % 2 !== patchy % 2) ? 255 : 0;

      const idx = 4 * (i * texSize + j);
      texels[idx + 0] = c;
      texels[idx + 1] = c;
      texels[idx + 2] = c;
      texels[idx + 3] = 255;
    }
  }
  return texels;
}

async function main() {
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();

  const canvas = document.getElementById("my-canvas");
  const context = canvas.getContext("webgpu");
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();

  context.configure({
    device,
    format: canvasFormat,
    alphaMode: "opaque",
  });

  // Rectangle in world space
  const positions = [
    vec3(-4, -1,  -1),
    vec3( 4, -1,  -1),
    vec3( 4, -1, -21),
    vec3(-4, -1, -21),
  ];

  const indices = new Uint32Array([
    0, 1, 2,
    0, 2, 3,
  ]);

  // Texture coordinates (repeat 4x width, 10x length)
  const texcoords = [
    vec2(-1.5,  0.0),
    vec2( 2.5,  0.0),
    vec2( 2.5, 10.0),
    vec2(-1.5, 10.0),
  ];

  // --- Buffers ---
  const positionBuffer = device.createBuffer({
    size: sizeof["vec3"] * positions.length,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(positionBuffer, 0, flatten(positions));

  const texcoordBuffer = device.createBuffer({
    size: sizeof["vec2"] * texcoords.length,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(texcoordBuffer, 0, flatten(texcoords));

  
  const indexBuffer = device.createBuffer({
    size: indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(indexBuffer, 0, indices);

  // --- Matrices ---
  const bgcolor = vec4(0.3921, 0.5843, 0.9294, 1.0); // Cornflower blue

  const Mst = mat4(
    1.0, 0.0, 0.0, 0.0,
    0.0, 1.0, 0.0, 0.0,
    0.0, 0.0, 0.5, 0.5,
    0.0, 0.0, 0.0, 1.0
  );

  const fov = 90;
  let projection = perspective(fov, canvas.width / canvas.height, 0.1, 100.0);
  projection = mult(Mst, projection);

  const V = mat4(); // "default view matrix" (identity)
  const M = mat4(); // identity model
  const mvp = mult(projection, mult(V, M));

  const uniformBuffer = device.createBuffer({
    size: 64, // mat4x4<f32> = 64 bytes
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, flatten(mvp));

  // --- Texture (procedural checkerboard) ---
  const texSize = 64;
  const texels = createCheckerboardTexture(texSize, 8, 8);

  const texture = device.createTexture({
    size: [texSize, texSize, 1],
    format: "rgba8unorm",
    usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
  });

  // bytesPerRow must be multiple of 256 — here 64*4 = 256 ✅
  device.queue.writeTexture(
    { texture },
    texels,
    { bytesPerRow: texSize * 4, rowsPerImage: texSize },
    { width: texSize, height: texSize, depthOrArrayLayers: 1 }
  );

  const sampler = device.createSampler({
    addressModeU: "repeat",
    addressModeV: "repeat",
    magFilter: "nearest",
    minFilter: "nearest",
    mipmapFilter: "nearest",
  });

  // --- Shaders ---
  const wgslCode = await fetch("shader.wgsl", { cache: "reload" }).then(r => r.text());
  const shaderModule = device.createShaderModule({ code: wgslCode });

  // --- Pipeline ---
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: shaderModule,
      entryPoint: "main_vs",
      buffers: [
        {
          arrayStride: sizeof["vec3"],
          attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }],
        },
        {
          arrayStride: sizeof["vec2"],
          attributes: [{ shaderLocation: 1, offset: 0, format: "float32x2" }],
        },
      ],
    },
    fragment: {
      module: shaderModule,
      entryPoint: "main_fs",
      targets: [{ format: canvasFormat }],
    },
    primitive: {
      topology: "triangle-list",
      frontFace: "ccw",
      cullMode: "back",
    },
    depthStencil: {
      depthWriteEnabled: true,
      depthCompare: "less",
      format: "depth24plus",
    },
  });

  const depthTexture = device.createTexture({
    size: [canvas.width, canvas.height, 1],
    format: "depth24plus",
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: sampler },
      { binding: 2, resource: texture.createView() },
    ],
  });

  // --- Render ---
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
  pass.setVertexBuffer(1, texcoordBuffer);
  pass.setIndexBuffer(indexBuffer, "uint32");
  pass.drawIndexed(indices.length);
  pass.end();

  device.queue.submit([encoder.finish()]);
}

window.addEventListener("load", main);
