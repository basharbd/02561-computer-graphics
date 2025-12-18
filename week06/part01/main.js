"use strict";

function createCheckerboardTexture(texSize, numRows, numCols) {
  // RGBA8 texels
  const texels = new Uint8Array(4 * texSize * texSize);

  for (let i = 0; i < texSize; ++i) {
    for (let j = 0; j < texSize; ++j) {
      // choose patch index
      const patchx = Math.floor(i / (texSize / numRows));
      const patchy = Math.floor(j / (texSize / numCols));
      const c = (patchx % 2 !== patchy % 2) ? 255 : 0;

      // write one texel (RGBA)
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
  if (!navigator.gpu) throw new Error("WebGPU not supported.");

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("Failed to get GPU adapter.");
  const device = await adapter.requestDevice();

  const canvas = document.getElementById("my-canvas");
  const context = canvas.getContext("webgpu");
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();

  context.configure({
    device,
    format: canvasFormat,
    alphaMode: "opaque",
  });

  // Ground quad positions (world space)
  const positions = [
    vec3(-4, -1,  -1),
    vec3( 4, -1,  -1),
    vec3( 4, -1, -21),
    vec3(-4, -1, -21),
  ];

  // Two triangles
  const indices = new Uint32Array([
    0, 1, 2,
    0, 2, 3,
  ]);

  // UVs (repeat)
  const texcoords = [
    vec2(-1.5,  0.0),
    vec2( 2.5,  0.0),
    vec2( 2.5, 10.0),
    vec2(-1.5, 10.0),
  ];

  // Position buffer
  const positionBuffer = device.createBuffer({
    size: sizeof["vec3"] * positions.length,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(positionBuffer, 0, flatten(positions));

  // Texcoord buffer
  const texcoordBuffer = device.createBuffer({
    size: sizeof["vec2"] * texcoords.length,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(texcoordBuffer, 0, flatten(texcoords));

  // Index buffer
  const indexBuffer = device.createBuffer({
    size: indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(indexBuffer, 0, indices);

  // Clear color
  const bgcolor = vec4(0.3921, 0.5843, 0.9294, 1.0);

  // Depth remap matrix (clip z -> [0,1])
  const Mst = mat4(
    1.0, 0.0, 0.0, 0.0,
    0.0, 1.0, 0.0, 0.0,
    0.0, 0.0, 0.5, 0.5,
    0.0, 0.0, 0.0, 1.0
  );

  // MVP (identity view/model)
  const fov = 90;
  let projection = perspective(fov, canvas.width / canvas.height, 0.1, 100.0);
  projection = mult(Mst, projection);

  const V = mat4();
  const M = mat4();
  const mvp = mult(projection, mult(V, M));

  // Uniform buffer (mat4)
  const uniformBuffer = device.createBuffer({
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, flatten(mvp));

  // Build procedural checkerboard texture
  const texSize = 64;
  const texels = createCheckerboardTexture(texSize, 8, 8);

  const texture = device.createTexture({
    size: [texSize, texSize, 1],
    format: "rgba8unorm",
    usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
  });

  // Upload texels (bytesPerRow must be 256-aligned)
  device.queue.writeTexture(
    { texture },
    texels,
    { bytesPerRow: texSize * 4, rowsPerImage: texSize },
    { width: texSize, height: texSize, depthOrArrayLayers: 1 }
  );

  // Sampler (repeat + nearest)
  const sampler = device.createSampler({
    addressModeU: "repeat",
    addressModeV: "repeat",
    magFilter: "nearest",
    minFilter: "nearest",
    mipmapFilter: "nearest",
  });

  // Load WGSL
  const wgslCode = await fetch("shader.wgsl", { cache: "reload" }).then((r) => r.text());
  const shaderModule = device.createShaderModule({ code: wgslCode });

  // Render pipeline
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

  // Depth attachment
  const depthTexture = device.createTexture({
    size: [canvas.width, canvas.height, 1],
    format: "depth24plus",
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  // Bind group: MVP + sampler + texture
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: sampler },
      { binding: 2, resource: texture.createView() },
    ],
  });

  // Encode one render pass
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

  // Draw quad
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
